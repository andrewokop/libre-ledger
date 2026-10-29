import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent
} from 'react'
import {
  ArrowDownLeft,
  ArrowLeftRight,
  Boxes,
  Check,
  ChevronDown,
  Cloud,
  Download,
  LayoutDashboard,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  X
} from 'lucide-react'
import {
  authenticate as authenticateUser,
  authErrorMessage,
  firebaseConfigured,
  isAllowedEmail,
  logout,
  observeAuth,
  saveWorkspace,
  subscribeWorkspace,
  replaceWorkspace,
  exportMigrationBackup,
  type AuthUser
} from './firebase'
import { derive } from './accounting'
import {
  relatedFingerprint,
  financialFingerprint,
  splitDelivery,
  SCHEMA_VERSION,
  type Action
} from './domain'
import { LedgerStore, browserStorage } from './ledgerStore'
import {
  id,
  isActive,
  settingsFor,
  type WriteOff,
  type LedgerSettings,
  type EntryRef,
  type Model,
  type Purchase,
  type Sale,
  type Workspace
} from './types'
import { Overview } from './Overview'
import { Inventory } from './Inventory'
import { History } from './History'
import { WorkspaceSettings } from './WorkspaceSettings'
import {
  ConfirmForm,
  EntryForm,
  FormError,
  LoginForm,
  ModalShell,
  ModelForm
} from './Forms'
import { BrandMark } from './ui'
export { derive, availableOn } from './accounting'

type Page = 'overview' | 'inventory' | 'history' | 'settings'
type Modal =
  | {
      kind: 'entry'
      type: 'purchase' | 'sale' | 'writeoff'
      entry?: Purchase | Sale | WriteOff
      initialModelId?: string
      initialPurchaseId?: string
    }
  | { kind: 'model'; model?: Model }
  | { kind: 'login' }
  | {
      kind: 'confirm'
      title: string
      description: string
      label: string
      action: () => void | Promise<void>
    }
  | null
const navItems = [
  { page: 'overview', label: 'Обзор', icon: LayoutDashboard },
  { page: 'inventory', label: 'Склад', icon: Boxes },
  { page: 'history', label: 'Операции', icon: ArrowLeftRight },
  { page: 'settings', label: 'Настройки', icon: Settings2 }
] as const
const syncLabels = {
  local: 'На устройстве',
  loading: 'Загрузка облака',
  saving: 'Сохраняем…',
  pending: 'Есть изменения',
  offline: 'Ожидаем сеть',
  synced: 'Синхронизировано',
  error: 'Ошибка сохранения',
  conflict: 'Конфликт данных'
}

export default function App() {
  const [store] = useState(
    () =>
      new LedgerStore(
        {
          subscribe: subscribeWorkspace,
          commit: saveWorkspace,
          replace: replaceWorkspace
        },
        browserStorage
      )
  )
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const workspace = state.workspace
  const preferences = settingsFor(workspace)
  const stats = useMemo(() => derive(workspace), [workspace])
  const [authReady, setAuthReady] = useState(!firebaseConfigured)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [page, setPage] = useState<Page>('overview')
  const [modal, setModal] = useState<Modal>(null)
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [loginBusy, setLoginBusy] = useState(false)
  const [historyRange, setHistoryRange] = useState<
    { start: string; end: string } | undefined
  >()
  const [startOwner, setStartOwner] = useState<string | null | undefined>(
    undefined
  )
  const [search, setSearch] = useState('')
  const [filterModel, setFilterModel] = useState('all')
  const [loginMode, setLoginMode] = useState<'login' | 'register'>('login')
  const syncLabel = syncLabels[state.status]
  const hasActivity =
    workspace.purchases.some(isActive) ||
    workspace.sales.some(isActive) ||
    (workspace.writeOffs ?? []).some(isActive)
  const editable =
    authReady &&
    state.ready &&
    !state.busy &&
    !state.storageError &&
    state.status !== 'conflict'
  useEffect(() => {
    let active = true
    let stop: () => void = () => undefined
    void observeAuth((nextUser) => {
      if (!active) return
      const allowed =
        nextUser && isAllowedEmail(nextUser.email) && nextUser.emailVerified
      setUser(allowed ? nextUser : null)
      setAuthReady(true)
      if (allowed || store.getSnapshot().uid) setModal(null)
      void store.setOwner(allowed ? nextUser.uid : null)
      if (nextUser && !isAllowedEmail(nextUser.email)) void logout()
    })
      .then((unsubscribe) => {
        if (active) stop = unsubscribe
        else unsubscribe()
      })
      .catch((error: unknown) => {
        if (active) {
          setAuthReady(true)
          setNotice(authErrorMessage(error))
        }
      })
    const online = () => store.retry()
    window.addEventListener('online', online)
    return () => {
      active = false
      stop()
      store.dispose()
      window.removeEventListener('online', online)
    }
  }, [store])
  useEffect(() => {
    if (!authReady || !state.ready || startOwner === state.uid) return
    setStartOwner(state.uid)
    setPage(settingsFor(state.workspace).homePage)
  }, [authReady, state.ready, state.uid, state.workspace, startOwner])
  useEffect(() => {
    try {
      const pref = JSON.parse(
        localStorage.getItem(`libre-appearance:${state.uid ?? 'guest'}`) ?? '{}'
      )
      document.documentElement.dataset.fontSize = [
        'normal',
        'large',
        'xlarge'
      ].includes(pref.font)
        ? pref.font
        : 'large'
      document.documentElement.dataset.reducedMotion = String(!!pref.reduced)
    } catch {
      document.documentElement.dataset.fontSize = 'large'
      document.documentElement.dataset.reducedMotion = 'false'
    }
    window.dispatchEvent(new Event('libre-appearance'))
  }, [state.uid])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    if (
      filterModel !== 'all' &&
      !workspace.models.some((model) => model.id === filterModel)
    )
      setFilterModel('all')
  }, [workspace.models, filterModel])
  function navigate(target: Page) {
    if (target === 'history') setHistoryRange(undefined)
    setPage(target)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }
  function openModal(next: Modal) {
    setFormError('')
    setModal(next)
  }
  function confirm(
    title: string,
    description: string,
    label: string,
    action: () => void | Promise<void>
  ) {
    openModal({ kind: 'confirm', title, description, label, action })
  }
  function mutate(action: Action, success: string) {
    try {
      store.dispatch(action)
      setModal(null)
      setFormError('')
      setNotice(success)
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Не удалось сохранить изменение.'
      )
    }
  }
  function editEntry(ref: EntryRef) {
    const entry = (
      ref.type === 'purchase'
        ? workspace.purchases
        : ref.type === 'sale'
          ? workspace.sales
          : (workspace.writeOffs ?? [])
    ).find((item) => item.id === ref.id)
    if (entry) openModal({ kind: 'entry', type: ref.type, entry })
  }
  function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (modal?.kind !== 'entry') return
    const data = new FormData(event.currentTarget)
    const readNumber = (name: string) => {
      const value = data.get(name)
      if (value === null || String(value).trim() === '')
        throw Error('Заполните обязательные числовые поля.')
      return Number(value)
    }
    try {
      const common = {
        id: modal.entry?.id ?? id(),
        modelId: String(data.get('modelId')),
        date: String(data.get('date')),
        quantity: readNumber('quantity'),
        note: String(data.get('note') ?? ''),
        status: modal.entry?.status ?? ('active' as const)
      }
      const expected = modal.entry ? (modal.entry.version ?? 0) : null
      if (modal.type === 'purchase') {
        const price = readNumber('unitPrice'),
          extra = Number(data.get('extra') || 0)
        const rows = data.get('purchases')
          ? (JSON.parse(String(data.get('purchases'))) as {
              quantity: number
              expiry: string
            }[])
          : null
        if (rows && !modal.entry) {
          if (
            !Array.isArray(rows) ||
            rows.length < 2 ||
            rows.length > 100 ||
            rows.some(
              (r) => !Number.isSafeInteger(r.quantity) || r.quantity < 1
            )
          )
            throw Error('Проверьте количества партий.')
          const parts = splitDelivery(
            extra,
            rows.map((row) => row.quantity)
          )
          mutate(
            {
              id: id(),
              kind: 'purchase/batch',
              entries: rows.map((r, index) => ({
                ...common,
                id: id(),
                quantity: r.quantity,
                unitPrice: price,
                extra: parts[index] / 100,
                sold: 0,
                ...(r.expiry ? { expiry: r.expiry } : {})
              }))
            },
            'Закупки сохранены'
          )
        } else
          mutate(
            {
              id: id(),
              kind: 'purchase/save',
              entry: {
                ...common,
                unitPrice: price,
                extra,
                sold: 0,
                ...(String(data.get('expiry') ?? '')
                  ? { expiry: String(data.get('expiry')) }
                  : {})
              },
              expected
            },
            'Закупка сохранена'
          )
      } else {
        const allocations = JSON.parse(String(data.get('allocations') ?? '[]'))
        if (modal.type === 'writeoff')
          mutate(
            {
              id: id(),
              kind: 'writeoff/save',
              costingMethod: preferences.costingMethod,
              entry: {
                ...common,
                allocations,
                reason: String(data.get('reason') ?? '')
              },
              expected
            },
            'Списание сохранено'
          )
        else
          mutate(
            {
              id: id(),
              kind: 'sale/save',
              costingMethod: preferences.costingMethod,
              entry: {
                ...common,
                unitPrice: readNumber('unitPrice'),
                costBasis: 0,
                allocations
              },
              expected
            },
            'Продажа сохранена'
          )
      }
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Проверьте поля операции.'
      )
    }
  }

  function toggleEntry() {
    if (modal?.kind !== 'entry' || !modal.entry) return
    const entry = {
      ...modal.entry,
      status:
        modal.entry.status === 'cancelled'
          ? ('active' as const)
          : ('cancelled' as const)
    }
    const actionId = id(),
      expected = modal.entry.version ?? 0
    if (modal.type === 'writeoff')
      mutate(
        {
          id: actionId,
          kind: 'writeoff/save',
          entry: entry as WriteOff,
          expected
        },
        entry.status === 'cancelled'
          ? 'Списание отменено'
          : 'Списание восстановлено'
      )
    else if (modal.type === 'purchase')
      mutate(
        {
          id: actionId,
          kind: 'purchase/save',
          entry: entry as Purchase,
          expected
        },
        entry.status === 'cancelled'
          ? 'Закупка отменена'
          : 'Закупка восстановлена'
      )
    else
      mutate(
        { id: actionId, kind: 'sale/save', entry: entry as Sale, expected },
        entry.status === 'cancelled'
          ? 'Продажа отменена. Товар возвращён на склад'
          : 'Продажа восстановлена'
      )
  }
  function deleteEntry() {
    if (modal?.kind !== 'entry' || !modal.entry) return
    const ref = modal
    const entry = modal.entry
    confirm(
      'Удалить операцию?',
      'Запись исчезнет из истории. Остатки и прибыль будут пересчитаны. Для несостоявшейся сделки лучше отменить операцию — её можно восстановить.',
      'Удалить операцию',
      () => {
        store.dispatch({
          id: id(),
          kind:
            ref.type === 'purchase'
              ? 'purchase/delete'
              : ref.type === 'sale'
                ? 'sale/delete'
                : 'writeoff/delete',
          entryId: entry.id,
          expected: entry.version ?? 0
        })
      }
    )
  }
  function saveModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (modal?.kind !== 'model') return
    const data = new FormData(event.currentTarget)
    mutate(
      {
        id: id(),
        kind: 'model/save',
        model: {
          id: modal.model?.id ?? id(),
          name: String(data.get('name')).trim(),
          color: String(data.get('color')),
          ...(String(data.get('salePrice') ?? '').trim() !== ''
            ? { salePrice: Number(data.get('salePrice')) }
            : {})
        },
        expected: modal.model ? (modal.model.version ?? 0) : null
      },
      'Модель сохранена'
    )
  }
  function deleteModel(model: Model) {
    const count = [
      ...workspace.purchases,
      ...workspace.sales,
      ...(workspace.writeOffs ?? [])
    ].filter((entry) => entry.modelId === model.id).length
    const related = relatedFingerprint(workspace, model.id)
    confirm(
      'Удалить модель?',
      `«${model.name}» будет удалена${count ? ` вместе со связанными операциями (${count}), включая отменённые` : ''}. Другие модели и операции сохранятся.`,
      count ? 'Удалить модель и операции' : 'Удалить модель',
      () => {
        store.dispatch({
          id: id(),
          kind: 'model/delete',
          modelId: model.id,
          expected: model.version ?? 0,
          related
        })
      }
    )
  }
  async function executeConfirm() {
    if (modal?.kind !== 'confirm' || confirmBusy) return
    setConfirmBusy(true)
    setFormError('')
    try {
      await modal.action()
      setModal(null)
      setSearch('')
      setFilterModel('all')
      setNotice('Изменения сохранены')
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Не удалось выполнить действие.'
      )
    } finally {
      setConfirmBusy(false)
    }
  }
  function download(data: Workspace, suffix = 'backup') {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              schemaVersion: SCHEMA_VERSION,
              exportedAt: new Date().toISOString(),
              workspace: data
            },
            null,
            2
          )
        ],
        { type: 'application/json' }
      )
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `libre-ledger-${suffix}-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('Резервная копия скачана')
  }
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loginBusy) return
    const data = new FormData(event.currentTarget)
    setLoginBusy(true)
    setFormError('')
    try {
      const result = await authenticateUser(
        String(data.get('email')),
        String(data.get('password')),
        loginMode === 'register'
      )
      setModal(null)
      setNotice(
        result === 'verification-sent'
          ? 'Письмо отправлено. Подтвердите адрес и войдите в аккаунт.'
          : 'Вход выполнен'
      )
    } catch (error) {
      setFormError(authErrorMessage(error))
    } finally {
      setLoginBusy(false)
    }
  }
  function saveSettings(settings: LedgerSettings) {
    store.dispatch({
      id: id(),
      kind: 'settings/save',
      settings,
      expected: settings.version,
      ledger: financialFingerprint(workspace)
    })
    setNotice('Настройки сохранены')
  }
  async function migrationBackup() {
    if (!state.uid) return
    try {
      const backup = await exportMigrationBackup(state.uid)
      if (!backup) {
        setNotice('Архив до обновления отсутствует')
        return
      }
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], {
          type: 'application/json'
        })
      )
      const link = document.createElement('a')
      link.href = url
      link.download = 'libre-before-v3.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setNotice(authErrorMessage(error))
    }
  }
  async function resetPassword(email = user?.email ?? '') {
    if (loginBusy) return
    if (!isAllowedEmail(email)) {
      setFormError('Укажите почту владельца аккаунта.')
      return
    }
    setLoginBusy(true)
    try {
      const { sendPasswordResetEmail, getAuth } = await import('firebase/auth')
      await sendPasswordResetEmail(getAuth(), email.trim().toLowerCase())
      setModal(null)
      setNotice('Письмо для восстановления пароля отправлено')
    } catch (error) {
      if (modal?.kind === 'login') setFormError(authErrorMessage(error))
      else setNotice(authErrorMessage(error))
    } finally {
      setLoginBusy(false)
    }
  }
  const pageTitle =
    navItems.find((item) => item.page === page)?.label ?? 'Обзор'
  const pageSubtitle = ''
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        К содержимому
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#overview"
          onClick={(event) => {
            event.preventDefault()
            navigate('overview')
          }}
          aria-label="Libre Ledger — на главную"
        >
          <span className="brand-mark">
            <BrandMark />
          </span>
          <span>
            libre<small>ledger</small>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">L</span>
          <span>
            <strong>{preferences.storeName}</strong>
            <small>Личный учёт</small>
          </span>
        </div>
        <nav className="nav-list" aria-label="Основная навигация">
          {navItems.map(({ page: target, label, icon: Icon }) => (
            <button
              key={target}
              aria-current={page === target ? 'page' : undefined}
              className={`nav-link ${page === target ? 'nav-active' : ''}`}
              onClick={() => navigate(target)}
            >
              <Icon size={22} strokeWidth={1.8} />
              <span>{label}</span>
              {target === 'inventory' && (
                <span className="nav-count">{stats.quantity}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sync-card">
            <ShieldCheck size={20} />
            <span>
              <strong>Состояние учёта</strong>
              <small>{syncLabel}</small>
            </span>
          </div>
          <button className="profile-row" onClick={() => navigate('settings')}>
            <span className="avatar">L</span>
            <span>
              <strong>{user ? 'Мой аккаунт' : 'Личный кабинет'}</strong>
              <small>{user ? 'Настройки аккаунта' : 'Подключить облако'}</small>
            </span>
            <ChevronDown size={18} />
          </button>
        </div>
      </aside>

      <main className="main-area" id="main-content">
        <header className="topbar">
          <a
            className="mobile-brand"
            href="#overview"
            onClick={(event) => {
              event.preventDefault()
              navigate('overview')
            }}
            aria-label="Libre Ledger — на главную"
          >
            <BrandMark />
            <span>
              libre<span>ledger</span>
            </span>
          </a>
          <span className="topbar-workspace">{preferences.storeName}</span>
          <div className="topbar-right">
            <span className="today-label">
              {new Intl.DateTimeFormat('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
              }).format(new Date())}
            </span>
            <button
              className={`connection ${state.status === 'synced' ? 'connection-live' : ''}`}
              onClick={() => navigate('settings')}
            >
              {user ? <Cloud size={18} /> : <ShieldCheck size={18} />}
              <span>{syncLabel}</span>
            </button>
          </div>
        </header>
        <div className="content-wrap">
          <div className="page-heading">
            <div>
              <h1>{page === 'overview' ? 'Обзор магазина' : pageTitle}</h1>
              {pageSubtitle && <p>{pageSubtitle}</p>}
            </div>
            {page !== 'settings' &&
              !(page === 'overview' && !hasActivity) &&
              state.ready &&
              authReady && (
                <div className="heading-actions">
                  {workspace.models.length > 0 && (
                    <button
                      className={`button ${stats.quantity ? 'button-quiet' : 'button-primary'}`}
                      onClick={() =>
                        openModal({ kind: 'entry', type: 'purchase' })
                      }
                      disabled={!editable}
                    >
                      <ArrowDownLeft size={20} />
                      Закупка
                    </button>
                  )}
                  {stats.quantity > 0 && (
                    <button
                      className="button button-primary"
                      disabled={!editable}
                      onClick={() => openModal({ kind: 'entry', type: 'sale' })}
                    >
                      <Plus size={21} />
                      Продажа
                    </button>
                  )}
                </div>
              )}
          </div>
          {(state.message || state.status === 'conflict') && (
            <div className="sync-alert" role="status">
              <div>
                <strong>
                  {state.status === 'conflict'
                    ? 'Нужно проверить изменения'
                    : 'Состояние сохранения'}
                </strong>
                <p>{state.message}</p>
              </div>
              <div className="alert-actions">
                {state.recovery && (
                  <button
                    className="button button-quiet"
                    onClick={() => download(state.recovery!, 'recovery')}
                  >
                    Скачать локальную копию
                  </button>
                )}
                {state.status === 'conflict' ? (
                  <button
                    className="button button-quiet"
                    onClick={() =>
                      confirm(
                        'Принять облачные данные?',
                        'Несохранённые изменения останутся в отдельной локальной копии, доступной для скачивания. Рабочий учёт будет загружен из облака.',
                        'Принять облачные данные',
                        () => store.acceptCloud()
                      )
                    }
                  >
                    Принять данные из облака
                  </button>
                ) : (
                  <button className="button button-quiet" onClick={store.retry}>
                    Повторить
                  </button>
                )}
              </div>
            </div>
          )}
          {!authReady || !state.ready ? (
            <div className="loading-state" role="status">
              <RefreshCw size={26} />
              <strong>Загружаем ваш учёт</strong>
              <p>
                Дождитесь облачных данных, чтобы не перезаписать их пустым
                списком.
              </p>
            </div>
          ) : (
            <div className="page-content" key={page}>
              {page === 'overview' &&
                (workspace.models.length === 0 ? (
                  <section className="welcome-panel">
                    <span className="welcome-mark">
                      <BrandMark />
                    </span>
                    <h2>
                      Ваш учёт начинается
                      <br />с вашего товара.
                    </h2>
                    <p>Добавьте модель товара и первую закупку.</p>
                    <button
                      className="button button-primary"
                      onClick={() => openModal({ kind: 'model' })}
                      disabled={!editable}
                    >
                      <Plus size={21} />
                      Добавить первую модель
                    </button>
                  </section>
                ) : !hasActivity ? (
                  <section className="welcome-panel">
                    <span className="welcome-mark">
                      <Boxes size={35} />
                    </span>
                    <h2>
                      Модели готовы.
                      <br />
                      Теперь — закупка.
                    </h2>
                    <p>Добавьте количество, стоимость и срок партии.</p>
                    <button
                      className="button button-primary"
                      onClick={() =>
                        openModal({ kind: 'entry', type: 'purchase' })
                      }
                      disabled={!editable}
                    >
                      <Plus size={21} />
                      Добавить первую закупку
                    </button>
                    {workspace.purchases.length +
                      workspace.sales.length +
                      (workspace.writeOffs?.length ?? 0) >
                      0 && (
                      <button
                        className="text-link"
                        onClick={() => navigate('history')}
                      >
                        Посмотреть отменённые операции
                      </button>
                    )}
                  </section>
                ) : (
                  <Overview
                    workspace={workspace}
                    stats={stats}
                    onPage={navigate}
                    onHistoryRange={(range) => {
                      setHistoryRange(range)
                      setPage('history')
                      window.scrollTo({ top: 0 })
                    }}
                  />
                ))}
              {page === 'inventory' && (
                <Inventory
                  workspace={workspace}
                  stats={stats}
                  search={search}
                  setSearch={setSearch}
                  filterModel={filterModel}
                  setFilterModel={setFilterModel}
                  onAddModel={() => openModal({ kind: 'model' })}
                  onEdit={editEntry}
                  onEditModel={(model) => openModal({ kind: 'model', model })}
                  onDeleteModel={deleteModel}
                  editable={editable}
                  onSell={(modelId, purchaseId) =>
                    openModal({
                      kind: 'entry',
                      type: 'sale',
                      initialModelId: modelId,
                      initialPurchaseId: purchaseId
                    })
                  }
                  onWriteOff={(modelId, purchaseId) =>
                    openModal({
                      kind: 'entry',
                      type: 'writeoff',
                      initialModelId: modelId,
                      initialPurchaseId: purchaseId
                    })
                  }
                />
              )}
              {page === 'history' && (
                <History
                  key={JSON.stringify(historyRange)}
                  movements={stats.movements}
                  workspace={workspace}
                  initialRange={historyRange}
                  onEdit={editEntry}
                />
              )}
              {page === 'settings' && (
                <WorkspaceSettings
                  onSave={saveSettings}
                  onEdit={editEntry}
                  onPasswordReset={() => {
                    void resetPassword()
                  }}
                  onMigrationBackup={
                    user
                      ? () => {
                          void migrationBackup()
                        }
                      : undefined
                  }
                  user={user}
                  state={state}
                  syncLabel={syncLabel}
                  onLogin={() => openModal({ kind: 'login' })}
                  onExport={() => download(workspace)}
                  onLogout={() => {
                    void logout().catch((error: unknown) =>
                      setNotice(authErrorMessage(error))
                    )
                  }}
                  onReset={() =>
                    confirm(
                      'Очистить весь учёт?',
                      `Будут удалены все модели (${workspace.models.length}) и операции (${workspace.purchases.length + workspace.sales.length + (workspace.writeOffs?.length ?? 0)})${user ? ' в вашем аккаунте, включая облако' : ' на этом устройстве'}. Восстановление возможно только из вашей резервной копии.`,
                      'Очистить весь учёт',
                      () => store.replace()
                    )
                  }
                  onImport={(replacement) =>
                    confirm(
                      'Восстановить учёт из файла?',
                      `Вместо текущего учёта будут загружены модели (${replacement.models.length}) и операции (${replacement.purchases.length + replacement.sales.length + (replacement.writeOffs?.length ?? 0)}) из файла. Сначала скачайте текущую копию, если она нужна.`,
                      'Восстановить учёт',
                      () => store.replace(replacement)
                    )
                  }
                  onRetry={store.retry}
                />
              )}
            </div>
          )}
          <footer className="footer">
            <span>
              <BrandMark />
              Libre Ledger
            </span>
            <button
              disabled={!authReady || !state.ready}
              onClick={() => download(workspace)}
            >
              <Download size={17} />
              Резервная копия
            </button>
          </footer>
        </div>
      </main>
      <nav className="bottom-nav" aria-label="Мобильная навигация">
        {navItems.map(({ page: target, label, icon: Icon }) => (
          <button
            key={target}
            aria-current={page === target ? 'page' : undefined}
            className={page === target ? 'bottom-active' : ''}
            onClick={() => navigate(target)}
          >
            <span>
              <Icon size={23} strokeWidth={page === target ? 2.2 : 1.7} />
            </span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {modal && (
        <ModalShell
          key={modal.kind}
          onClose={() => {
            if (!confirmBusy && !loginBusy) setModal(null)
          }}
        >
          {modal.kind === 'entry' && (
            <EntryForm
              type={modal.type}
              models={workspace.models}
              workspace={workspace}
              entry={modal.entry}
              initialModelId={modal.initialModelId}
              initialPurchaseId={modal.initialPurchaseId}
              error={formError}
              onSubmit={saveEntry}
              onClose={() => setModal(null)}
              onToggle={toggleEntry}
              onDelete={deleteEntry}
            />
          )}
          {modal.kind === 'model' && (
            <ModelForm
              model={modal.model}
              error={formError}
              onSubmit={saveModel}
              onClose={() => setModal(null)}
            />
          )}
          {modal.kind === 'login' && (
            <>
              <LoginForm
                onPasswordReset={(email) => {
                  void resetPassword(email)
                }}
                configured={firebaseConfigured}
                mode={loginMode}
                setMode={setLoginMode}
                busy={loginBusy}
                onSubmit={authenticate}
                onClose={() => setModal(null)}
              />
              <FormError message={formError} />
            </>
          )}
          {modal.kind === 'confirm' && (
            <ConfirmForm
              title={modal.title}
              description={modal.description}
              label={modal.label}
              busy={confirmBusy}
              error={formError}
              onConfirm={() => {
                void executeConfirm()
              }}
              onClose={() => setModal(null)}
            />
          )}
        </ModalShell>
      )}
      {notice && (
        <div className="toast" role="status">
          <span className="toast-check">
            <Check size={18} />
          </span>
          {notice}
          <button
            onClick={() => setNotice('')}
            aria-label="Закрыть уведомление"
          >
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  )
}
