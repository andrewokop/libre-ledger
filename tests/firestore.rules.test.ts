import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, runTransaction, serverTimestamp, setDoc, setLogLevel } from 'firebase/firestore'
import { mergeActions, newCloud, parseCloud, toCloud } from '../src/syncProtocol'

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('Firestore access rules and transactions', () => {
  let env: RulesTestEnvironment
  beforeAll(async () => {
    setLogLevel('silent')
    env = await initializeTestEnvironment({ projectId: 'demo-libre-audit', firestore: { host: '127.0.0.1', port: 8088, rules: readFileSync('firestore.rules','utf8') } })
  })
  beforeEach(async () => { await env.clearFirestore() })
  afterAll(async () => { await env?.cleanup() })
  const owner = () => env.authenticatedContext('owner', { email: 'andrewokop@gmail.com', email_verified: true }).firestore()
  const reference = () => doc(owner(),'users/owner/workspace/main')
  const initial = () => ({ ...toCloud(newCloud('generation')), updatedAt: serverTimestamp() })
  it('allows a verified owner to create and read their workspace', async () => {
    await assertSucceeds(setDoc(reference(), initial()))
    await assertSucceeds(getDoc(reference()))
  })
  it('denies anonymous, unverified, wrong-email and wrong-UID access', async () => {
    await setDoc(reference(),initial())
    const clients = [env.unauthenticatedContext(), env.authenticatedContext('owner',{email:'andrewokop@gmail.com',email_verified:false}), env.authenticatedContext('owner',{email:'other@example.com',email_verified:true}), env.authenticatedContext('other',{email:'andrewokop@gmail.com',email_verified:true})]
    for(const context of clients) { const ref=doc(context.firestore(),'users/owner/workspace/main'); await assertFails(getDoc(ref)); await assertFails(setDoc(ref,initial())) }
  })
  it('rejects malformed documents and arbitrary fields', async () => {
    await assertFails(setDoc(reference(), {...initial(),models:'wrong'}))
    await assertFails(setDoc(reference(), {...initial(),schemaVersion:1}))
    await assertFails(setDoc(reference(), {...initial(),admin:true}))
    await assertFails(setDoc(reference(), {...initial(),updatedAt:new Date(0)}))
  })
  it('rejects unversioned old clients and stale revisions after migration', async () => {
    await setDoc(reference(),initial())
    await assertFails(setDoc(reference(),{models:[],purchases:[],sales:[]}))
    await assertFails(setDoc(reference(),initial()))
    await assertSucceeds(setDoc(reference(),{...initial(),revision:2,appliedIds:['new-action']}))
  })
  it('only permits an empty migration of legacy records', async () => {
    await env.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(),'users/owner/workspace/main'), {models:[{id:'old'}],purchases:[],sales:[]}) })
    await assertFails(setDoc(reference(),{...initial(),models:[{id:'seeded'}]}))
    await assertSucceeds(setDoc(reference(),initial()))
    expect((await getDoc(reference())).data()?.models).toEqual([])
  })
  it('denies collection listing, unrelated documents and raw deletes', async () => {
    await setDoc(reference(),initial())
    await assertFails(getDocs(collection(owner(),'users')))
    await assertFails(setDoc(doc(owner(),'users/owner/workspace/extra'),initial()))
    await assertFails(deleteDoc(reference()))
  })
  it('merges simultaneous device transactions without losing independent edits', async () => {
    await setDoc(reference(),initial())
    await Promise.all(['first','second'].map(key => { const db=owner(); return runTransaction(db,async transaction => {
      const ref=doc(db,'users/owner/workspace/main')
      const snapshot=await transaction.get(ref)
      const remote=parseCloud(snapshot.data()!)
      const next=mergeActions(remote,'generation',[{id:key,kind:'model/save',expected:null,model:{id:key,name:key,color:'#526df4'}}])
      transaction.set(ref,{...toCloud(next),updatedAt:serverTimestamp()})
    }) }))
    expect((await getDoc(reference())).data()?.models).toHaveLength(2)
  })
  it('permits a versioned model write without a transaction', async () => {
    const db=owner(), ref=doc(db,'users/owner/workspace/main')
    await setDoc(ref,initial())
    const next=mergeActions(parseCloud((await getDoc(ref)).data()!),'generation',[{id:'model',kind:'model/save',expected:null,model:{id:'model',name:'Товар',color:'#526df4'}}])
    await assertSucceeds(setDoc(ref,{...toCloud(next),updatedAt:serverTimestamp()}))
  })
  it('permits a sequential transaction', async () => {
    const db=owner(), ref=doc(db,'users/owner/workspace/main')
    await setDoc(ref,initial())
    await runTransaction(db, async transaction => {
      const previous=parseCloud((await transaction.get(ref)).data()!)
      transaction.set(ref,{...toCloud(previous),revision:previous.revision+1,appliedIds:['transaction'],updatedAt:serverTimestamp()})
    })
  })
})
