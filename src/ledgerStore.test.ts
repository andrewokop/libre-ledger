import { afterEach, describe, expect, it } from 'vitest'
import { LedgerStore } from './ledgerStore'
import { mergeActions, newCloud, type CloudAdapter, type CloudState } from './syncProtocol'
import { emptyWorkspace, GenerationError, type Action } from './domain'
import type { Workspace } from './types'

class MemoryStorage {
  data = new Map<string, string>()
  fail = false
  get length() { return this.data.size }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { if (this.fail) throw new Error('quota'); this.data.set(key,value) }
  removeItem(key: string) { this.data.delete(key) }
}
class Backend implements CloudAdapter {
  remote = new Map<string, CloudState>()
  callbacks = new Map<string, Set<(state: CloudState, cached: boolean) => void>>()
  offline = false
  commits = 0
  async subscribe(uid: string, callback: (state: CloudState, cached: boolean) => void) {
    if (!this.remote.has(uid)) this.remote.set(uid,newCloud(`generation-${uid}`))
    const listeners = this.callbacks.get(uid) ?? new Set(); listeners.add(callback); this.callbacks.set(uid,listeners)
    callback(this.remote.get(uid)!, false)
    return () => { listeners.delete(callback) }
  }
  async commit(uid: string, generation: string, actions: Action[]) {
    this.commits++
    if (this.offline) throw Object.assign(new Error('offline'), { code: 'unavailable' })
    const next = mergeActions(this.remote.get(uid)!,generation,actions); this.push(uid,next); return next
  }
  push(uid: string, state: CloudState) { this.remote.set(uid,state); this.callbacks.get(uid)?.forEach((callback) => callback(state,false)) }
  async replace(uid: string, generation: string, workspace: Workspace) {
    const previous = this.remote.get(uid)!
    if (previous.generation !== generation) throw new Error('generation')
    const next = { workspace, generation: `${generation}-reset`, revision: previous.revision+1, appliedIds: [] }; this.push(uid,next); return next
  }
}
const instances: LedgerStore[]=[]
function make(backend = new Backend(), storage = new MemoryStorage()) { const store = new LedgerStore(backend,storage); instances.push(store); return {store,backend,storage} }
const add = (id = 'a'): Action => ({ id,kind:'model/save',expected:null,model:{id,name:`Товар ${id}`,color:'#526df4'} })
afterEach(() => { instances.splice(0).forEach((store) => store.dispose()) })
describe('local cache and cloud synchronization', () => {
  it('removes legacy seeded caches and never inserts default models', () => {
    const storage = new MemoryStorage(); storage.setItem('libre-ledger-v1-user','legacy'); storage.setItem('unrelated','keep')
    const {store}=make(undefined,storage)
    expect(store.getSnapshot().workspace).toEqual(emptyWorkspace()); expect(storage.getItem('libre-ledger-v1-user')).toBeNull(); expect(storage.getItem('unrelated')).toBe('keep')
  })
  it('keeps guest and account workspaces isolated and does not auto-import guest data', async () => {
    const {store}=make(); store.dispatch(add('guest'))
    await store.setOwner('owner'); expect(store.getSnapshot().workspace.models).toHaveLength(0)
    store.dispatch(add('private')); await store.flush()
    await store.setOwner(null); expect(store.getSnapshot().workspace.models.map((m)=>m.id)).toEqual(['guest'])
    await store.setOwner('owner'); expect(store.getSnapshot().workspace.models.map((m)=>m.id)).toEqual(['private'])
  })
  it('does not write idle snapshots back to the cloud', async () => { const {store,backend}=make(); await store.setOwner('owner'); expect(backend.commits).toBe(0); backend.push('owner',newCloud('generation-owner')); expect(backend.commits).toBe(0) })
  it('retains offline actions across reload, then syncs exactly once', async () => {
    const {store,backend,storage}=make(); await store.setOwner('owner'); backend.offline=true
    store.dispatch(add()); await store.flush(); expect(store.getSnapshot().status).toBe('offline'); expect(store.getSnapshot().pending).toBe(1)
    store.dispose(); const restored=make(backend,storage).store; await restored.setOwner('owner'); backend.offline=false; await restored.flush()
    expect(restored.getSnapshot().pending).toBe(0); expect(backend.remote.get('owner')!.workspace.models).toHaveLength(1)
  })
  it('does not drop queued edits when a newer remote snapshot arrives', async () => {
    const {store,backend}=make(); await store.setOwner('owner'); store.dispatch(add('local'))
    const remote=mergeActions(backend.remote.get('owner')!,'generation-owner',[add('remote')]); backend.push('owner',remote)
    expect(store.getSnapshot().workspace.models).toHaveLength(2); await store.flush(); expect(store.getSnapshot().pending).toBe(0)
  })
  it('blocks old queued edits after another device resets the workspace', async () => {
    const {store,backend}=make(); await store.setOwner('owner'); store.dispatch(add())
    backend.push('owner',{...newCloud('reset'),revision:2})
    expect(store.getSnapshot().workspace.models).toHaveLength(0); expect(store.getSnapshot().pending).toBe(0); expect(store.getSnapshot().recovery?.models).toHaveLength(1)
    await store.flush(); expect(backend.commits).toBe(0)
    store.acceptCloud(); expect(store.getSnapshot().recovery?.models).toHaveLength(1)
  })
  it('fully clears models, transactions and local pending state', async () => {
    const {store,backend}=make(); await store.setOwner('owner'); store.dispatch(add()); await store.flush(); await store.replace()
    expect(store.getSnapshot().workspace).toEqual(emptyWorkspace()); expect(backend.remote.get('owner')!.workspace).toEqual(emptyWorkspace()); expect(store.getSnapshot().pending).toBe(0)
  })
  it('preserves recovery when a reset races with an in-flight write', async () => {
    const {store,backend}=make(); await store.setOwner('owner')
    let reject!: (error: Error) => void
    backend.commit=()=>new Promise((_resolve,fail)=>{reject=fail})
    store.dispatch(add()); const writing=store.flush()
    backend.push('owner',{...newCloud('reset'),revision:2}); reject(new GenerationError()); await writing
    expect(store.getSnapshot().recovery?.models).toHaveLength(1)
    store.acceptCloud(); expect(store.getSnapshot().recovery?.models).toHaveLength(1)
    expect(store.getSnapshot().workspace.models).toHaveLength(0)
  })
  it('rejects a mutation when local durability fails', () => {
    const {store,storage}=make(); storage.fail=true; expect(()=>store.dispatch(add())).toThrow('не сохранено')
    expect(store.getSnapshot().workspace.models).toHaveLength(0); expect(store.getSnapshot().storageError).toBe(true)
    storage.fail=false; store.retry(); store.dispatch(add()); expect(store.getSnapshot().workspace.models).toHaveLength(1)
  })
  it('ignores callbacks from the previously signed in account', async () => {
    const {store,backend}=make(); await store.setOwner('first'); const old=[...backend.callbacks.get('first')!][0]; await store.setOwner('second')
    old(mergeActions(newCloud('generation-first'),'generation-first',[add('private')]),false)
    expect(store.getSnapshot().uid).toBe('second'); expect(store.getSnapshot().workspace.models).toHaveLength(0)
  })
  it('keeps the storage failure visible when a remote snapshot arrives', async () => {
    const {store,backend,storage}=make(); await store.setOwner('owner'); storage.fail=true
    backend.push('owner',mergeActions(newCloud('generation-owner'),'generation-owner',[add()]))
    expect(store.getSnapshot().status).toBe('error'); expect(store.getSnapshot().storageError).toBe(true)
    expect(store.getSnapshot().workspace.models).toHaveLength(1)
  })
  it('keeps the previous workspace when a local replacement cannot be persisted', async () => {
    const {store,storage}=make(); store.dispatch(add()); storage.fail=true
    await expect(store.replace()).rejects.toThrow('Не удалось сохранить')
    expect(store.getSnapshot().workspace.models).toHaveLength(1)
  })
  it('shows the completed cloud reset if the device runs out of storage afterward', async () => {
    const {store,backend,storage}=make(); await store.setOwner('owner'); store.dispatch(add()); await store.flush()
    storage.fail=true; await store.replace()
    expect(backend.remote.get('owner')!.workspace.models).toHaveLength(0)
    expect(store.getSnapshot().workspace.models).toHaveLength(0)
    expect(store.getSnapshot().status).toBe('error'); expect(store.getSnapshot().storageError).toBe(true)
  })
})
