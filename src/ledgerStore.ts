import {
  applyAction,
  ConflictError,
  emptyWorkspace,
  financialFingerprint,
  GenerationError,
  parseWorkspace,
  type Action
} from './domain'
import { id, settingsFor, type Workspace } from './types'
import type { CloudAdapter, CloudState } from './syncProtocol'

export type SyncStatus =
  | 'local'
  | 'loading'
  | 'saving'
  | 'pending'
  | 'offline'
  | 'synced'
  | 'error'
  | 'conflict'
export type LedgerState = {
  workspace: Workspace
  uid: string | null
  ready: boolean
  status: SyncStatus
  message: string
  pending: number
  busy: boolean
  storageError: boolean
  recovery: Workspace | null
  lastConfirmedAt: number | null
}
type Cache = {
  schemaVersion?: number
  base: CloudState
  pending: Action[]
  recovery: Workspace | null
}
type StoragePort = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>
const PREFIX = 'libre-ledger-v3:'
const LEGACY_PREFIX = 'libre-ledger-v2:'
export const browserStorage: StoragePort = {
  get length() {
    return window.localStorage.length
  },
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
  key: (index) => window.localStorage.key(index)
}
const message = (error: unknown) => {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : ''
  if (code === 'permission-denied')
    return 'Облако отклонило доступ. Проверьте аккаунт и подтверждение почты; локальную копию можно скачать.'
  if (code === 'resource-exhausted')
    return 'Достигнута бесплатная квота облака. Изменения остаются на устройстве; повторите отправку позже.'
  return error instanceof Error
    ? error.message
    : 'Не удалось сохранить изменения.'
}

export class LedgerStore {
  private listeners = new Set<() => void>()
  private cache: Cache
  private state: LedgerState
  private unsubscribe: (() => void) | null = null
  private epoch = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private writing = false
  private resetting = false
  private failures = 0
  private disposed = false
  private cacheBlocked = false

  constructor(
    private adapter: CloudAdapter,
    private storage: StoragePort
  ) {
    const storageError = false
    this.cache = {
      base: {
        workspace: emptyWorkspace(),
        generation: id(),
        revision: 0,
        appliedIds: []
      },
      pending: [],
      recovery: null
    }
    this.state = {
      workspace: this.cache.base.workspace,
      uid: null,
      ready: !storageError,
      status: 'local',
      message: storageError
        ? 'Браузер запретил сохранение. Разрешите локальное хранилище для этого сайта.'
        : '',
      pending: 0,
      busy: false,
      storageError,
      recovery: null,
      lastConfirmedAt: null
    }
    this.load(null)
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = () => this.state
  private emit(patch: Partial<LedgerState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  private key(uid = this.state.uid) {
    return `${PREFIX}${uid ?? 'guest'}`
  }
  private persist(cache = this.cache) {
    if (this.cacheBlocked) return false
    try {
      this.storage.setItem(
        this.key(),
        JSON.stringify({ ...cache, schemaVersion: 3 })
      )
      return true
    } catch {
      this.emit({
        storageError: true,
        message:
          'Не удалось сохранить данные на устройстве. Освободите место или скачайте резервную копию.',
        status: 'error'
      })
      return false
    }
  }
  private load(uid: string | null): boolean {
    this.cacheBlocked = false
    try {
      const saved = this.storage.getItem(this.key(uid))
      const legacy =
        saved === null
          ? this.storage.getItem(`${LEGACY_PREFIX}${uid ?? 'guest'}`)
          : null
      const raw = saved ?? legacy
      if (raw !== null) {
        const parsed = JSON.parse(raw) as Cache
        if (
          (saved !== null && parsed.schemaVersion !== 3) ||
          (legacy !== null &&
            parsed.schemaVersion !== undefined &&
            parsed.schemaVersion !== 2)
        )
          throw new Error('Неизвестная версия локальной копии.')
        if (
          !parsed.base ||
          typeof parsed.base.generation !== 'string' ||
          !parsed.base.generation ||
          !Array.isArray(parsed.pending) ||
          !Array.isArray(parsed.base.appliedIds) ||
          !Number.isSafeInteger(parsed.base.revision) ||
          parsed.base.revision < 0
        )
          throw new Error('Повреждена локальная копия.')
        const rawWorkspace = parsed.base.workspace as Workspace & {
          schemaVersion?: unknown
        }
        if (
          rawWorkspace?.schemaVersion !== undefined &&
          rawWorkspace.schemaVersion !== 2 &&
          rawWorkspace.schemaVersion !== 3
        )
          throw new Error('Неизвестная версия локального учёта.')
        const pending = (parsed.pending as Action[]).map((action) =>
          legacy !== null &&
          action.kind === 'sale/save' &&
          !action.entry.allocations?.length
            ? { ...action, legacy: true }
            : action
        )
        let migratedWorkspace = parseWorkspace(rawWorkspace)
        // A v2 queue may contain historical sales even when its base was empty.
        if (
          legacy !== null &&
          pending.some(
            (action) =>
              action.kind === 'sale/save' && 'legacy' in action && action.legacy
          ) &&
          !rawWorkspace.settings
        )
          migratedWorkspace = {
            ...migratedWorkspace,
            settings: {
              ...settingsFor(migratedWorkspace),
              costingMethod: 'average'
            }
          }
        const base = { ...parsed.base, workspace: migratedWorkspace }
        const workspace = pending.reduce(applyAction, base.workspace)
        this.cache = {
          base,
          pending,
          recovery: parsed.recovery ? parseWorkspace(parsed.recovery) : null
        }
        this.emit({
          workspace,
          uid,
          ready: !uid || base.revision > 0,
          pending: pending.length,
          recovery: this.cache.recovery,
          status: uid ? 'loading' : 'local',
          message: '',
          busy: false,
          storageError: false,
          lastConfirmedAt: null
        })
        if (legacy !== null && !this.persist()) return false
        return true
      }
    } catch {
      this.cacheBlocked = true
      this.emit({
        uid,
        ready: false,
        storageError: true,
        status: 'error',
        message:
          'Локальная копия повреждена или создана более новой версией. Данные сохранены на устройстве; обновите приложение или восстановите копию.',
        lastConfirmedAt: null
      })
      return false
    }
    this.cache = {
      base: {
        workspace: emptyWorkspace(),
        generation: id(),
        revision: 0,
        appliedIds: []
      },
      pending: [],
      recovery: null
    }
    this.emit({
      workspace: this.cache.base.workspace,
      uid,
      ready: !uid,
      pending: 0,
      recovery: null,
      status: uid ? 'loading' : 'local',
      busy: false,
      storageError: false,
      lastConfirmedAt: null
    })
    return true
  }
  async setOwner(uid: string | null, keepCurrent = false) {
    this.disposed = false
    const epoch = ++this.epoch
    this.unsubscribe?.()
    this.unsubscribe = null
    clearTimeout(this.timer)
    this.writing = false
    this.resetting = false
    this.failures = 0
    if (!keepCurrent && !this.load(uid)) return
    if (!uid) return
    try {
      const stop = await this.adapter.subscribe(
        uid,
        (remote, cached) => {
          if (epoch === this.epoch && !this.disposed)
            this.receive(remote, cached)
        },
        (error) => {
          if (epoch === this.epoch && !this.disposed)
            this.emit({
              status: 'error',
              message: message(error),
              ...('code' in error && error.code === 'unsupported-schema'
                ? { ready: false }
                : {})
            })
        }
      )
      if (epoch !== this.epoch || this.disposed) stop()
      else this.unsubscribe = stop
    } catch (error) {
      if (epoch === this.epoch)
        this.emit({ status: 'error', message: message(error) })
    }
  }
  private receive(remote: CloudState, cached = false) {
    if (this.resetting || remote.revision < this.cache.base.revision) return
    if (
      this.cache.base.revision > 0 &&
      remote.generation !== this.cache.base.generation &&
      this.cache.pending.length
    ) {
      this.cache = {
        base: remote,
        pending: [],
        recovery: this.cache.recovery ?? this.state.workspace
      }
      this.persist()
      this.emit({
        workspace: remote.workspace,
        ready: true,
        pending: 0,
        recovery: this.cache.recovery,
        status: 'conflict',
        message:
          'Учёт очищен на другом устройстве. Старые изменения не возвращены в облако; их можно скачать отдельной копией.'
      })
      return
    }
    const pending = this.cache.pending.filter(
      (action) => !remote.appliedIds.includes(action.id)
    )
    // If an empty v2 cloud was migrated before its offline history arrived,
    // retain its historical average method before replaying that history.
    if (
      pending.some(
        (action) =>
          action.kind === 'sale/save' && 'legacy' in action && action.legacy
      ) &&
      settingsFor(remote.workspace).costingMethod === 'lot' &&
      !remote.workspace.purchases.length &&
      !remote.workspace.sales.length &&
      !remote.workspace.writeOffs?.length &&
      !pending.some((action) => action.kind === 'settings/save')
    ) {
      const settings = settingsFor(remote.workspace)
      pending.unshift({
        id: id(),
        kind: 'settings/save',
        expected: settings.version,
        ledger: financialFingerprint(remote.workspace),
        settings: { ...settings, costingMethod: 'average' }
      })
    }
    this.cache = { ...this.cache, base: remote, pending }
    try {
      const workspace = pending.reduce(applyAction, remote.workspace)
      const persisted = this.persist()
      this.emit({
        workspace,
        ready: true,
        pending: pending.length,
        ...(!cached ? { lastConfirmedAt: Date.now() } : {}),
        ...(persisted
          ? {
              status: cached
                ? ('offline' as const)
                : pending.length
                  ? ('pending' as const)
                  : ('synced' as const),
              message: cached
                ? 'Показана локальная копия. Облачное сохранение продолжится при подключении.'
                : ''
            }
          : {}),
        recovery: this.cache.recovery
      })
      if (!cached && pending.length) this.schedule()
    } catch (error) {
      this.cache.recovery ??= this.state.workspace
      this.persist()
      this.emit({
        ready: true,
        pending: pending.length,
        status: 'conflict',
        message: message(error),
        recovery: this.cache.recovery
      })
    }
  }
  dispatch(action: Action) {
    if (
      !this.state.ready ||
      this.state.busy ||
      this.state.status === 'conflict' ||
      this.state.storageError
    )
      throw new Error(
        'Сначала дождитесь загрузки или разрешите проблему сохранения.'
      )
    const workspace = applyAction(this.state.workspace, action)
    const next = this.state.uid
      ? { ...this.cache, pending: [...this.cache.pending, action] }
      : { ...this.cache, base: { ...this.cache.base, workspace }, pending: [] }
    if (!this.persist(next))
      throw new Error('Изменение не сохранено: хранилище браузера недоступно.')
    this.cache = next
    this.emit({
      workspace,
      pending: next.pending.length,
      status: this.state.uid ? 'pending' : 'local',
      message: ''
    })
    if (this.state.uid) this.schedule()
  }
  private schedule(delay = 500) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.flush()
    }, delay)
  }
  async flush() {
    const uid = this.state.uid
    if (
      !uid ||
      !this.cache.pending.length ||
      this.writing ||
      this.resetting ||
      this.state.status === 'conflict' ||
      !this.state.ready ||
      this.disposed
    )
      return
    const epoch = this.epoch
    this.writing = true
    this.emit({ status: 'saving', message: '' })
    try {
      const remote = await this.adapter.commit(
        uid,
        this.cache.base.generation,
        this.cache.pending.slice(0, 100)
      )
      if (epoch !== this.epoch || this.disposed) return
      this.failures = 0
      this.receive(remote)
    } catch (error) {
      if (epoch !== this.epoch || this.disposed) return
      if (
        error instanceof ConflictError ||
        error instanceof GenerationError ||
        !(error instanceof Error) ||
        !('code' in error) ||
        ![
          'unavailable',
          'aborted',
          'deadline-exceeded',
          'resource-exhausted'
        ].includes(String(error.code))
      ) {
        this.cache.recovery ??= this.state.workspace
        this.persist()
        this.emit({
          status: 'conflict',
          message: message(error),
          recovery: this.cache.recovery
        })
      } else {
        this.emit({
          status: 'offline',
          message:
            String(error.code) === 'resource-exhausted'
              ? message(error)
              : 'Изменения сохранены на устройстве и ожидают отправки. Проверьте интернет или повторите синхронизацию.'
        })
        this.schedule(
          Math.min(60_000, 3000 * 2 ** Math.min(this.failures++, 5))
        )
      }
    } finally {
      if (epoch === this.epoch) {
        this.writing = false
        if (this.cache.pending.length && this.state.status === 'pending')
          this.schedule()
      }
    }
  }
  async replace(workspace: Workspace = emptyWorkspace()) {
    const next = parseWorkspace(workspace)
    if (this.state.storageError)
      throw new Error('Сначала разрешите сохранение в браузере.')
    const uid = this.state.uid
    if (!uid) {
      const replacement = {
        base: {
          workspace: next,
          generation: id(),
          revision: 0,
          appliedIds: []
        },
        pending: [],
        recovery: null
      }
      if (!this.persist(replacement))
        throw new Error('Не удалось сохранить новый учёт.')
      this.cache = replacement
      this.emit({
        workspace: next,
        status: 'local',
        pending: 0,
        message: '',
        recovery: null,
        ready: true
      })
      return
    }
    if (!this.state.ready || this.state.busy)
      throw new Error('Дождитесь загрузки облака.')
    const epoch = ++this.epoch
    // The existing subscription remains valid; its callbacks are reattached below.
    this.unsubscribe?.()
    this.unsubscribe = null
    clearTimeout(this.timer)
    this.writing = false
    this.resetting = true
    this.emit({ busy: true, status: 'saving', message: '' })
    try {
      const remote = await this.adapter.replace(
        uid,
        this.cache.base.generation,
        next
      )
      if (epoch !== this.epoch || this.disposed) return
      this.cache = { base: remote, pending: [], recovery: null }
      const persisted = this.persist()
      this.emit({
        workspace: next,
        pending: 0,
        recovery: null,
        busy: false,
        ready: true,
        ...(persisted ? { status: 'synced' as const, message: '' } : {})
      })
    } catch (error) {
      if (epoch === this.epoch)
        this.emit({
          busy: false,
          status: 'error',
          message: `Замена не выполнена. ${message(error)}`
        })
      throw error
    } finally {
      if (epoch === this.epoch && !this.disposed) {
        this.resetting = false
        await this.setOwner(uid, true)
      }
    }
  }
  acceptCloud() {
    const replacement = {
      ...this.cache,
      pending: [],
      recovery: this.cache.recovery ?? this.state.workspace
    }
    if (!this.persist(replacement))
      throw new Error('Не удалось сохранить облачную копию на устройстве.')
    this.cache = replacement
    this.emit({
      workspace: this.cache.base.workspace,
      pending: 0,
      recovery: this.cache.recovery,
      status: this.state.uid ? 'synced' : 'local',
      message: ''
    })
  }
  retry = () => {
    if (this.cacheBlocked) {
      void this.setOwner(this.state.uid)
      return
    }
    if (this.state.storageError) {
      if (!this.state.ready) {
        void this.setOwner(this.state.uid)
        return
      }
      if (!this.persist()) return
      this.emit({
        storageError: false,
        message: '',
        status: this.state.uid ? 'loading' : 'local'
      })
    }
    if (this.cache.pending.length) void this.flush()
    else if (this.state.uid) void this.setOwner(this.state.uid)
  }
  dispose() {
    this.disposed = true
    ++this.epoch
    this.unsubscribe?.()
    clearTimeout(this.timer)
    this.listeners.clear()
  }
}
