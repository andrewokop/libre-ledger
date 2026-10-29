import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  setLogLevel
} from 'firebase/firestore'
import {
  mergeActions,
  newCloud,
  parseCloud,
  toCloud
} from '../src/syncProtocol'

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  'Firestore access rules and transactions',
  () => {
    let env: RulesTestEnvironment
    beforeAll(async () => {
      setLogLevel('silent')
      env = await initializeTestEnvironment({
        projectId: 'demo-libre-audit',
        firestore: {
          host: '127.0.0.1',
          port: 8088,
          rules: readFileSync('firestore.rules', 'utf8')
        }
      })
    })
    beforeEach(async () => {
      await env.clearFirestore()
    })
    afterAll(async () => {
      await env?.cleanup()
    })
    const owner = () =>
      env
        .authenticatedContext('owner', {
          email: 'andrewokop@gmail.com',
          email_verified: true
        })
        .firestore()
    const reference = () => doc(owner(), 'users/owner/workspace/main')
    const initial = () => ({
      ...toCloud(newCloud('generation')),
      updatedAt: serverTimestamp()
    })
    it('allows a verified owner to create and read their workspace', async () => {
      await assertSucceeds(setDoc(reference(), initial()))
      await assertSucceeds(getDoc(reference()))
    })
    it('denies anonymous, unverified, wrong-email and wrong-UID access', async () => {
      await setDoc(reference(), initial())
      const clients = [
        env.unauthenticatedContext(),
        env.authenticatedContext('owner', {
          email: 'andrewokop@gmail.com',
          email_verified: false
        }),
        env.authenticatedContext('owner', {
          email: 'other@example.com',
          email_verified: true
        }),
        env.authenticatedContext('other', {
          email: 'andrewokop@gmail.com',
          email_verified: true
        })
      ]
      for (const context of clients) {
        const ref = doc(context.firestore(), 'users/owner/workspace/main')
        await assertFails(getDoc(ref))
        await assertFails(setDoc(ref, initial()))
      }
    })
    it('rejects malformed documents and arbitrary fields', async () => {
      await assertFails(setDoc(reference(), { ...initial(), models: 'wrong' }))
      await assertFails(setDoc(reference(), { ...initial(), schemaVersion: 1 }))
      await assertFails(setDoc(reference(), { ...initial(), admin: true }))
      await assertFails(
        setDoc(reference(), { ...initial(), updatedAt: new Date(0) })
      )
    })
    it('rejects unversioned old clients and stale revisions after migration', async () => {
      await setDoc(reference(), initial())
      await assertFails(
        setDoc(reference(), { models: [], purchases: [], sales: [] })
      )
      await assertFails(setDoc(reference(), initial()))
      await assertSucceeds(
        setDoc(reference(), {
          ...initial(),
          revision: 2,
          appliedIds: ['new-action']
        })
      )
    })
    it('archives and preserves a nonempty v2 document during migration, blocking old clients afterwards', async () => {
      const db = owner(),
        ref = doc(db, 'users/owner/workspace/main'),
        backup = doc(db, 'users/owner/workspace/pre-v3')
      const old = {
        models: [{ id: 'm', name: 'Sensor', color: '#526df4' }],
        purchases: [
          {
            id: 'p',
            modelId: 'm',
            date: '2025-01-01',
            quantity: 2,
            unitPrice: 10,
            extra: 1,
            sold: 0
          }
        ],
        sales: [],
        schemaVersion: 2,
        generation: 'old',
        revision: 7,
        appliedIds: ['done'],
        updatedAt: new Date(0)
      }
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'users/owner/workspace/main'),
          old
        )
      })
      const migrated = {
        ...initial(),
        models: old.models,
        purchases: old.purchases,
        sales: old.sales,
        generation: old.generation,
        revision: 8,
        appliedIds: old.appliedIds
      }
      await assertFails(setDoc(ref, migrated))
      await assertSucceeds(
        runTransaction(db, async (tx) => {
          const snapshot = await tx.get(ref)
          await tx.get(backup)
          tx.set(backup, snapshot.data()!)
          tx.set(ref, migrated)
        })
      )
      expect((await getDoc(backup)).data()?.purchases).toEqual(old.purchases)
      await assertFails(
        setDoc(ref, {
          ...old,
          models: [],
          purchases: [],
          sales: [],
          revision: 9,
          updatedAt: serverTimestamp()
        })
      )
      await assertFails(setDoc(backup, old))
    })
    it('preserves a metadata-free legacy document and stores its original', async () => {
      const db = owner(),
        ref = doc(db, 'users/owner/workspace/main'),
        backup = doc(db, 'users/owner/workspace/pre-v3')
      const legacy = {
        models: [{ id: 'm', name: 'Sensor', color: '#526df4' }],
        purchases: [],
        sales: []
      }
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'users/owner/workspace/main'),
          legacy
        )
      })
      await assertSucceeds(
        runTransaction(db, async (tx) => {
          const old = (await tx.get(ref)).data()!
          await tx.get(backup)
          tx.set(backup, old)
          tx.set(ref, {
            ...initial(),
            models: old.models,
            purchases: old.purchases,
            sales: old.sales
          })
        })
      )
      expect((await getDoc(backup)).data()).toEqual(legacy)
      expect((await getDoc(ref)).data()?.models).toEqual(legacy.models)
    })
    it('rejects future schema downgrades', async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users/owner/workspace/main'), {
          schemaVersion: 99,
          models: [],
          purchases: [],
          sales: []
        })
      })
      await assertFails(setDoc(reference(), initial()))
    })
    it('denies collection listing, unrelated documents and raw deletes', async () => {
      await setDoc(reference(), initial())
      await assertFails(getDocs(collection(owner(), 'users')))
      await assertFails(
        setDoc(doc(owner(), 'users/owner/workspace/extra'), initial())
      )
      await assertFails(deleteDoc(reference()))
    })
    it('merges simultaneous device transactions without losing independent edits', async () => {
      await setDoc(reference(), initial())
      await Promise.all(
        ['first', 'second'].map((key) => {
          const db = owner()
          return runTransaction(db, async (transaction) => {
            const ref = doc(db, 'users/owner/workspace/main')
            const snapshot = await transaction.get(ref)
            const remote = parseCloud(snapshot.data()!)
            const next = mergeActions(remote, 'generation', [
              {
                id: key,
                kind: 'model/save',
                expected: null,
                model: { id: key, name: key, color: '#526df4' }
              }
            ])
            transaction.set(ref, {
              ...toCloud(next),
              updatedAt: serverTimestamp()
            })
          })
        })
      )
      expect((await getDoc(reference())).data()?.models).toHaveLength(2)
    })
    it('rejects concurrent sales of the same unit even when another lot has stock', async () => {
      let state = newCloud('generation')
      state = mergeActions(state, 'generation', [
        {
          id: 'model',
          kind: 'model/save',
          expected: null,
          model: { id: 'm', name: 'Sensor', color: '#526df4' }
        }
      ])
      for (const key of ['p1', 'p2'])
        state = mergeActions(state, 'generation', [
          {
            id: `add-${key}`,
            kind: 'purchase/save',
            expected: null,
            entry: {
              id: key,
              modelId: 'm',
              date: '2025-01-01',
              quantity: 1,
              unitPrice: 10,
              extra: 0,
              sold: 0
            }
          }
        ])
      await setDoc(reference(), {
        ...toCloud(state),
        revision: 1,
        updatedAt: serverTimestamp()
      })
      const attempts = await Promise.allSettled(
        ['s1', 's2'].map((key) => {
          const db = owner(),
            ref = doc(db, 'users/owner/workspace/main')
          return runTransaction(db, async (tx) => {
            const remote = parseCloud((await tx.get(ref)).data()!)
            const next = mergeActions(remote, 'generation', [
              {
                id: key,
                kind: 'sale/save',
                expected: null,
                entry: {
                  id: key,
                  modelId: 'm',
                  date: '2025-01-02',
                  quantity: 1,
                  unitPrice: 20,
                  costBasis: 0,
                  allocations: [{ purchaseId: 'p1', quantity: 1 }]
                }
              }
            ])
            tx.set(ref, { ...toCloud(next), updatedAt: serverTimestamp() })
          })
        })
      )
      expect(
        attempts.filter((result) => result.status === 'fulfilled')
      ).toHaveLength(1)
      expect(
        attempts.filter((result) => result.status === 'rejected')
      ).toHaveLength(1)
      expect((await getDoc(reference())).data()?.sales).toHaveLength(1)
    })
    it('permits a versioned model write without a transaction', async () => {
      const db = owner(),
        ref = doc(db, 'users/owner/workspace/main')
      await setDoc(ref, initial())
      const next = mergeActions(
        parseCloud((await getDoc(ref)).data()!),
        'generation',
        [
          {
            id: 'model',
            kind: 'model/save',
            expected: null,
            model: { id: 'model', name: 'Товар', color: '#526df4' }
          }
        ]
      )
      await assertSucceeds(
        setDoc(ref, { ...toCloud(next), updatedAt: serverTimestamp() })
      )
    })
    it('permits a sequential transaction', async () => {
      const db = owner(),
        ref = doc(db, 'users/owner/workspace/main')
      await setDoc(ref, initial())
      await runTransaction(db, async (transaction) => {
        const previous = parseCloud((await transaction.get(ref)).data()!)
        transaction.set(ref, {
          ...toCloud(previous),
          revision: previous.revision + 1,
          appliedIds: ['transaction'],
          updatedAt: serverTimestamp()
        })
      })
    })
  }
)
