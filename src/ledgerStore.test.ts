import { afterEach, describe, expect, it } from 'vitest'
import { LedgerStore } from './ledgerStore'
import {
  mergeActions,
  newCloud,
  type CloudAdapter,
  type CloudState
} from './syncProtocol'
import { emptyWorkspace, GenerationError, type Action } from './domain'
import type { Workspace } from './types'

class MemoryStorage {
  data = new Map<string, string>()
  fail = false
  get length() {
    return this.data.size
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.fail) throw new Error('quota')
    this.data.set(key, value)
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
}
class Backend implements CloudAdapter {
  remote = new Map<string, CloudState>()
  callbacks = new Map<
    string,
    Set<(state: CloudState, cached: boolean) => void>
  >()
  offline = false
  commits = 0
  async subscribe(
    uid: string,
    callback: (state: CloudState, cached: boolean) => void
  ) {
    if (!this.remote.has(uid))
      this.remote.set(uid, newCloud(`generation-${uid}`))
    const listeners = this.callbacks.get(uid) ?? new Set()
    listeners.add(callback)
    this.callbacks.set(uid, listeners)
    callback(this.remote.get(uid)!, false)
    return () => {
      listeners.delete(callback)
    }
  }
  async commit(uid: string, generation: string, actions: Action[]) {
    this.commits++
    if (this.offline)
      throw Object.assign(new Error('offline'), { code: 'unavailable' })
    const next = mergeActions(this.remote.get(uid)!, generation, actions)
    this.push(uid, next)
    return next
  }
  push(uid: string, state: CloudState) {
    this.remote.set(uid, state)
    this.callbacks.get(uid)?.forEach((callback) => callback(state, false))
  }
  async replace(uid: string, generation: string, workspace: Workspace) {
    const previous = this.remote.get(uid)!
    if (previous.generation !== generation) throw new Error('generation')
    const next = {
      workspace,
      generation: `${generation}-reset`,
      revision: previous.revision + 1,
      appliedIds: []
    }
    this.push(uid, next)
    return next
  }
}
const instances: LedgerStore[] = []
function make(backend = new Backend(), storage = new MemoryStorage()) {
  const store = new LedgerStore(backend, storage)
  instances.push(store)
  return { store, backend, storage }
}
const add = (id = 'a'): Action => ({
  id,
  kind: 'model/save',
  expected: null,
  model: { id, name: `Товар ${id}`, color: '#526df4' }
})
afterEach(() => {
  instances.splice(0).forEach((store) => store.dispose())
})
describe('local cache and cloud synchronization', () => {
  it('retains legacy caches and never inserts default models', () => {
    const storage = new MemoryStorage()
    storage.setItem('libre-ledger-v1-user', 'legacy')
    storage.setItem('unrelated', 'keep')
    const { store } = make(undefined, storage)
    expect(store.getSnapshot().workspace).toEqual(emptyWorkspace())
    expect(storage.getItem('libre-ledger-v1-user')).toBe('legacy')
    expect(storage.getItem('unrelated')).toBe('keep')
  })
  it('migrates a v2 cache and offline queue without deleting the original', async () => {
    const storage = new MemoryStorage(),
      backend = new Backend()
    const original = JSON.stringify({
      base: newCloud('generation-owner'),
      pending: [add('queued')],
      recovery: null
    })
    storage.setItem('libre-ledger-v2:owner', original)
    const { store } = make(backend, storage)
    await store.setOwner('owner')
    expect(storage.getItem('libre-ledger-v2:owner')).toBe(original)
    expect(store.getSnapshot().workspace.models.map((m) => m.id)).toEqual([
      'queued'
    ])
    await store.flush()
    expect(backend.remote.get('owner')!.workspace.models).toHaveLength(1)
    await store.flush()
    expect(backend.remote.get('owner')!.workspace.models).toHaveLength(1)
  })
  it('replays a v2 offline purchase and sale without inventing lot allocations', async () => {
    const storage = new MemoryStorage(),
      backend = new Backend()
    const oldWorkspace = {
      models: [{ id: 'm', name: 'Sensor', color: '#526df4' }],
      purchases: [],
      sales: []
    }
    const pending = [
      {
        id: 'purchase',
        kind: 'purchase/save',
        expected: null,
        entry: {
          id: 'p',
          modelId: 'm',
          date: '2025-01-01',
          quantity: 1,
          unitPrice: 10,
          extra: 0,
          sold: 0
        }
      },
      {
        id: 'sale',
        kind: 'sale/save',
        expected: null,
        entry: {
          id: 's',
          modelId: 'm',
          date: '2025-01-02',
          quantity: 1,
          unitPrice: 20,
          costBasis: 0
        }
      }
    ]
    const original = JSON.stringify({
      base: {
        workspace: oldWorkspace,
        generation: 'generation-owner',
        revision: 1,
        appliedIds: []
      },
      pending,
      recovery: null
    })
    storage.setItem('libre-ledger-v2:owner', original)
    backend.remote.set('owner', {
      ...newCloud('generation-owner'),
      workspace: { ...emptyWorkspace(), models: oldWorkspace.models }
    })
    const { store } = make(backend, storage)
    await store.setOwner('owner')
    await store.flush()
    const result = backend.remote.get('owner')!.workspace
    expect(result.settings?.costingMethod).toBe('average')
    expect(result.sales).toHaveLength(1)
    expect(result.sales[0].allocations).toBeUndefined()
    expect(store.getSnapshot().pending).toBe(0)
    expect(storage.getItem('libre-ledger-v2:owner')).toBe(original)
  })
  it('does not change the costing method when remote history exists before legacy replay', async () => {
    const storage = new MemoryStorage(),
      backend = new Backend()
    const oldWorkspace = {
      models: [{ id: 'm', name: 'Sensor', color: '#526df4' }],
      purchases: [],
      sales: []
    }
    const pending = [
      {
        id: 'local-purchase',
        kind: 'purchase/save',
        expected: null,
        entry: {
          id: 'local-p',
          modelId: 'm',
          date: '2025-01-01',
          quantity: 1,
          unitPrice: 10,
          extra: 0,
          sold: 0
        }
      },
      {
        id: 'sale',
        kind: 'sale/save',
        expected: null,
        entry: {
          id: 's',
          modelId: 'm',
          date: '2025-01-02',
          quantity: 1,
          unitPrice: 20,
          costBasis: 0
        }
      }
    ]
    const original = JSON.stringify({
      base: {
        workspace: oldWorkspace,
        generation: 'generation-owner',
        revision: 1,
        appliedIds: []
      },
      pending,
      recovery: null
    })
    storage.setItem('libre-ledger-v2:owner', original)
    let remote = newCloud('generation-owner')
    remote = mergeActions(remote, 'generation-owner', [add('m')])
    remote = mergeActions(remote, 'generation-owner', [
      {
        id: 'purchase',
        kind: 'purchase/save',
        expected: null,
        entry: {
          id: 'p',
          modelId: 'm',
          date: '2025-01-01',
          quantity: 2,
          unitPrice: 10,
          extra: 0,
          sold: 0
        }
      }
    ])
    backend.remote.set('owner', remote)
    const { store } = make(backend, storage)
    await store.setOwner('owner')
    await store.flush()
    expect(store.getSnapshot().status).toBe('conflict')
    expect(store.getSnapshot().recovery?.sales).toHaveLength(1)
    expect(backend.remote.get('owner')!.workspace.settings?.costingMethod).toBe(
      'lot'
    )
    expect(backend.remote.get('owner')!.workspace.sales).toHaveLength(0)
    expect(storage.getItem('libre-ledger-v2:owner')).toBe(original)
  })
  it('blocks a future local cache without overwriting it or connecting', async () => {
    const storage = new MemoryStorage(),
      backend = new Backend()
    const original = JSON.stringify({
      schemaVersion: 99,
      base: newCloud('future'),
      pending: []
    })
    storage.setItem('libre-ledger-v3:owner', original)
    const { store } = make(backend, storage)
    await store.setOwner('owner')
    store.retry()
    expect(store.getSnapshot().ready).toBe(false)
    expect(storage.getItem('libre-ledger-v3:owner')).toBe(original)
    expect(backend.remote.has('owner')).toBe(false)
  })
  it('keeps guest and account workspaces isolated and does not auto-import guest data', async () => {
    const { store } = make()
    store.dispatch(add('guest'))
    await store.setOwner('owner')
    expect(store.getSnapshot().workspace.models).toHaveLength(0)
    store.dispatch(add('private'))
    await store.flush()
    await store.setOwner(null)
    expect(store.getSnapshot().workspace.models.map((m) => m.id)).toEqual([
      'guest'
    ])
    await store.setOwner('owner')
    expect(store.getSnapshot().workspace.models.map((m) => m.id)).toEqual([
      'private'
    ])
  })
  it('does not write idle snapshots back to the cloud', async () => {
    const { store, backend } = make()
    await store.setOwner('owner')
    expect(backend.commits).toBe(0)
    backend.push('owner', newCloud('generation-owner'))
    expect(backend.commits).toBe(0)
  })
  it('retains offline actions across reload, then syncs exactly once', async () => {
    const { store, backend, storage } = make()
    await store.setOwner('owner')
    backend.offline = true
    store.dispatch(add())
    await store.flush()
    expect(store.getSnapshot().status).toBe('offline')
    expect(store.getSnapshot().pending).toBe(1)
    store.dispose()
    const restored = make(backend, storage).store
    await restored.setOwner('owner')
    backend.offline = false
    await restored.flush()
    expect(restored.getSnapshot().pending).toBe(0)
    expect(backend.remote.get('owner')!.workspace.models).toHaveLength(1)
  })
  it('rejects the second concurrent sale of the same last unit on transaction retry', () => {
    let remote = newCloud('g')
    remote = mergeActions(remote, 'g', [add('m')])
    remote = mergeActions(remote, 'g', [
      {
        id: 'purchase',
        kind: 'purchase/save',
        expected: null,
        entry: {
          id: 'p',
          modelId: 'm',
          date: '2025-01-01',
          quantity: 1,
          unitPrice: 10,
          extra: 0,
          sold: 0
        }
      }
    ])
    remote = mergeActions(remote, 'g', [
      {
        id: 'purchase2',
        kind: 'purchase/save',
        expected: null,
        entry: {
          id: 'p2',
          modelId: 'm',
          date: '2025-01-01',
          quantity: 1,
          unitPrice: 10,
          extra: 0,
          sold: 0
        }
      }
    ])
    const sale = (id: string): Action => ({
      id,
      kind: 'sale/save',
      expected: null,
      entry: {
        id,
        modelId: 'm',
        date: '2025-01-02',
        quantity: 1,
        unitPrice: 20,
        costBasis: 0,
        allocations: [{ purchaseId: 'p', quantity: 1 }]
      }
    })
    const first = mergeActions(remote, 'g', [sale('first')])
    expect(() => mergeActions(first, 'g', [sale('second')])).toThrow()
    expect(mergeActions(first, 'g', [sale('first')])).toBe(first)
  })
  it('does not drop queued edits when a newer remote snapshot arrives', async () => {
    const { store, backend } = make()
    await store.setOwner('owner')
    store.dispatch(add('local'))
    const remote = mergeActions(
      backend.remote.get('owner')!,
      'generation-owner',
      [add('remote')]
    )
    backend.push('owner', remote)
    expect(store.getSnapshot().workspace.models).toHaveLength(2)
    await store.flush()
    expect(store.getSnapshot().pending).toBe(0)
  })
  it('blocks old queued edits after another device resets the workspace', async () => {
    const { store, backend } = make()
    await store.setOwner('owner')
    store.dispatch(add())
    backend.push('owner', { ...newCloud('reset'), revision: 2 })
    expect(store.getSnapshot().workspace.models).toHaveLength(0)
    expect(store.getSnapshot().pending).toBe(0)
    expect(store.getSnapshot().recovery?.models).toHaveLength(1)
    await store.flush()
    expect(backend.commits).toBe(0)
    store.acceptCloud()
    expect(store.getSnapshot().recovery?.models).toHaveLength(1)
  })
  it('fully clears models, transactions and local pending state', async () => {
    const { store, backend } = make()
    await store.setOwner('owner')
    store.dispatch(add())
    await store.flush()
    await store.replace()
    expect(store.getSnapshot().workspace).toEqual(emptyWorkspace())
    expect(backend.remote.get('owner')!.workspace).toEqual(emptyWorkspace())
    expect(store.getSnapshot().pending).toBe(0)
  })
  it('preserves recovery when a reset races with an in-flight write', async () => {
    const { store, backend } = make()
    await store.setOwner('owner')
    let reject!: (error: Error) => void
    backend.commit = () =>
      new Promise((_resolve, fail) => {
        reject = fail
      })
    store.dispatch(add())
    const writing = store.flush()
    backend.push('owner', { ...newCloud('reset'), revision: 2 })
    reject(new GenerationError())
    await writing
    expect(store.getSnapshot().recovery?.models).toHaveLength(1)
    store.acceptCloud()
    expect(store.getSnapshot().recovery?.models).toHaveLength(1)
    expect(store.getSnapshot().workspace.models).toHaveLength(0)
  })
  it('rejects a mutation when local durability fails', () => {
    const { store, storage } = make()
    storage.fail = true
    expect(() => store.dispatch(add())).toThrow('не сохранено')
    expect(store.getSnapshot().workspace.models).toHaveLength(0)
    expect(store.getSnapshot().storageError).toBe(true)
    storage.fail = false
    store.retry()
    store.dispatch(add())
    expect(store.getSnapshot().workspace.models).toHaveLength(1)
  })
  it('ignores callbacks from the previously signed in account', async () => {
    const { store, backend } = make()
    await store.setOwner('first')
    const old = [...backend.callbacks.get('first')!][0]
    await store.setOwner('second')
    old(
      mergeActions(newCloud('generation-first'), 'generation-first', [
        add('private')
      ]),
      false
    )
    expect(store.getSnapshot().uid).toBe('second')
    expect(store.getSnapshot().workspace.models).toHaveLength(0)
  })
  it('keeps the storage failure visible when a remote snapshot arrives', async () => {
    const { store, backend, storage } = make()
    await store.setOwner('owner')
    storage.fail = true
    backend.push(
      'owner',
      mergeActions(newCloud('generation-owner'), 'generation-owner', [add()])
    )
    expect(store.getSnapshot().status).toBe('error')
    expect(store.getSnapshot().storageError).toBe(true)
    expect(store.getSnapshot().workspace.models).toHaveLength(1)
  })
  it('keeps the previous workspace when a local replacement cannot be persisted', async () => {
    const { store, storage } = make()
    store.dispatch(add())
    storage.fail = true
    await expect(store.replace()).rejects.toThrow('Не удалось сохранить')
    expect(store.getSnapshot().workspace.models).toHaveLength(1)
  })
  it('shows the completed cloud reset if the device runs out of storage afterward', async () => {
    const { store, backend, storage } = make()
    await store.setOwner('owner')
    store.dispatch(add())
    await store.flush()
    storage.fail = true
    await store.replace()
    expect(backend.remote.get('owner')!.workspace.models).toHaveLength(0)
    expect(store.getSnapshot().workspace.models).toHaveLength(0)
    expect(store.getSnapshot().status).toBe('error')
    expect(store.getSnapshot().storageError).toBe(true)
  })
  it('does not overwrite an unknown future cache when Retry is pressed', async () => {
    const storage = new MemoryStorage()
    const raw = JSON.stringify({
      schemaVersion: 99,
      secretFutureData: 'preserve'
    })
    storage.setItem('libre-ledger-v3:guest', raw)
    const { store } = make(undefined, storage)
    store.retry()
    expect(storage.getItem('libre-ledger-v3:guest')).toBe(raw)
    expect(store.getSnapshot().ready).toBe(false)
  })
})
