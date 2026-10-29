import { describe, expect, it } from 'vitest'
import { derive } from './accounting'
import {
  applyAction,
  availableForSale,
  ConflictError,
  emptyWorkspace,
  parseBackup,
  parseWorkspace,
  relatedFingerprint,
  type Action
} from './domain'
import { mergeActions, newCloud } from './syncProtocol'
import type { Workspace } from './types'

const base: Workspace = {
  models: [{ id: 'm', name: 'Мой товар', color: '#526df4', version: 1 }],
  purchases: [
    {
      id: 'p',
      modelId: 'm',
      date: '2026-01-01',
      quantity: 10,
      unitPrice: 100,
      extra: 10,
      sold: 0,
      version: 1
    }
  ],
  sales: [
    {
      id: 's',
      modelId: 'm',
      date: '2026-01-10',
      quantity: 8,
      unitPrice: 200,
      costBasis: 0,
      version: 1
    }
  ]
}
describe('editable inventory invariants', () => {
  it('starts with no models or operations', () => {
    expect(emptyWorkspace()).toMatchObject({
      models: [],
      purchases: [],
      sales: [],
      writeOffs: [],
      settings: { costingMethod: 'lot' }
    })
  })
  it('does not offer historical stock already needed by later sales', () => {
    expect(availableForSale(base, 'm', '2026-01-05')).toBe(2)
    expect(availableForSale(base, 'm', '2025-12-31')).toBe(0)
  })
  it('allows editing a sale without counting itself twice', () => {
    expect(availableForSale(base, 'm', '2026-01-10', 's')).toBe(10)
  })
  it('rejects a historical sale that breaks later inventory', () => {
    expect(() =>
      applyAction(base, {
        id: 'a',
        kind: 'sale/save',
        entry: {
          ...base.sales[0],
          id: 'new',
          date: '2026-01-05',
          quantity: 3,
          allocations: [{ purchaseId: 'p', quantity: 3 }]
        },
        expected: null
      })
    ).toThrow('отрицательный остаток')
  })
  it('cancels and restores a sale without deleting its history', () => {
    const cancelled = applyAction(base, {
      id: 'a',
      kind: 'sale/save',
      entry: { ...base.sales[0], status: 'cancelled' },
      expected: 1
    })
    expect(derive(cancelled).quantity).toBe(10)
    expect(derive(cancelled).revenue).toBe(0)
    expect(derive(cancelled).movements).toHaveLength(2)
    const restored = applyAction(cancelled, {
      id: 'b',
      kind: 'sale/save',
      entry: { ...cancelled.sales[0], status: 'active' },
      expected: 2
    })
    expect(derive(restored).quantity).toBe(2)
    expect(derive(restored).revenue).toBe(1600)
  })
  it('blocks cancelling/deleting/reducing a purchase consumed by sales', () => {
    expect(() =>
      applyAction(base, {
        id: 'a',
        kind: 'purchase/delete',
        entryId: 'p',
        expected: 1
      })
    ).toThrow('отрицательный остаток')
    expect(() =>
      applyAction(base, {
        id: 'a',
        kind: 'purchase/save',
        entry: { ...base.purchases[0], status: 'cancelled' },
        expected: 1
      })
    ).toThrow('отрицательный остаток')
    expect(() =>
      applyAction(base, {
        id: 'a',
        kind: 'purchase/save',
        entry: { ...base.purchases[0], quantity: 7 },
        expected: 1
      })
    ).toThrow('отрицательный остаток')
  })
  it('recalculates costs and profit after a purchase price edit', () => {
    const updated = applyAction(base, {
      id: 'a',
      kind: 'purchase/save',
      entry: { ...base.purchases[0], unitPrice: 150 },
      expected: 1
    })
    expect(derive(updated).profit).toBeCloseTo(392)
    expect(derive(updated).stockValue).toBeCloseTo(302)
  })
  it('renames a model in the journal and deletes its entire related ledger atomically', () => {
    const updated = applyAction(base, {
      id: 'a',
      kind: 'model/save',
      model: { ...base.models[0], name: 'Новое название' },
      expected: 1
    })
    expect(
      derive(updated).movements.every(
        (entry) => entry.name === 'Новое название'
      )
    ).toBe(true)
    expect(
      applyAction(updated, {
        id: 'b',
        kind: 'model/delete',
        modelId: 'm',
        expected: 2,
        related: relatedFingerprint(updated, 'm')
      })
    ).toMatchObject({
      models: [],
      purchases: [],
      sales: [],
      writeOffs: [],
      settings: { costingMethod: 'average' }
    })
  })
  it('does not delete newly added related operations using a stale confirmation', () => {
    const updated = applyAction(base, {
      id: 'a',
      kind: 'sale/save',
      entry: {
        ...base.sales[0],
        id: 's2',
        quantity: 1,
        allocations: [{ purchaseId: 'p', quantity: 1 }]
      },
      expected: null
    })
    expect(() =>
      applyAction(updated, {
        id: 'b',
        kind: 'model/delete',
        modelId: 'm',
        expected: 1,
        related: relatedFingerprint(base, 'm')
      })
    ).toThrow(ConflictError)
  })
  it('rejects invalid imported numbers, dates, duplicate names and broken references', () => {
    for (const quantity of [NaN, Infinity, -1, 1.5, 0])
      expect(() =>
        parseWorkspace({
          ...base,
          purchases: [{ ...base.purchases[0], quantity }]
        })
      ).toThrow()
    for (const date of ['2026-02-30', '2099-01-01', 'wrong'])
      expect(() =>
        parseWorkspace({ ...base, sales: [{ ...base.sales[0], date }] })
      ).toThrow()
    expect(() =>
      parseWorkspace({
        ...base,
        models: [
          ...base.models,
          { ...base.models[0], id: 'm2', name: ' МОЙ ТОВАР ' }
        ]
      })
    ).toThrow('уже существует')
    expect(() =>
      parseWorkspace({
        ...base,
        sales: [{ ...base.sales[0], modelId: 'missing' }]
      })
    ).toThrow('отсутствует модель')
    expect(() =>
      parseWorkspace({
        ...base,
        purchases: [{ ...base.purchases[0], unitPrice: 0.001 }]
      })
    ).toThrow('копейки')
  })
  it('accepts validated legacy and versioned backup formats', () => {
    expect(parseBackup(base).models).toHaveLength(1)
    expect(
      parseBackup({ schemaVersion: 2, workspace: base }).sales
    ).toHaveLength(1)
  })
  it('allocates equal fractional remainders to different purchase lots', () => {
    const data: Workspace = {
      models: base.models,
      purchases: ['a', 'b', 'c'].map((id) => ({
        ...base.purchases[0],
        id,
        quantity: 2
      })),
      sales: [{ ...base.sales[0], quantity: 2 }]
    }
    expect(
      derive(data)
        .lots.map((lot) => lot.sold)
        .sort()
    ).toEqual([0, 1, 1])
  })
})
describe('transaction protocol', () => {
  const create = (id: string, name: string): Action => ({
    id,
    kind: 'model/save',
    expected: null,
    model: { id, name, color: '#526df4' }
  })
  it('merges independent offline changes from two devices', () => {
    const remote = mergeActions(newCloud('g'), 'g', [
      create('a', 'Первый товар')
    ])
    const merged = mergeActions(remote, 'g', [create('b', 'Второй товар')])
    expect(merged.workspace.models.map((model) => model.name)).toEqual([
      'Первый товар',
      'Второй товар'
    ])
  })
  it('makes retries idempotent even after the acknowledgement was lost', () => {
    const action = create('a', 'Товар')
    const remote = mergeActions(newCloud('g'), 'g', [action])
    expect(mergeActions(remote, 'g', [action])).toBe(remote)
  })
  it('rejects conflicting edits to the same model and stale writes after reset', () => {
    const remote = { ...newCloud('g'), workspace: base }
    const edited = mergeActions(remote, 'g', [
      {
        id: 'a',
        kind: 'model/save',
        model: { ...base.models[0], name: 'Изменено' },
        expected: 1
      }
    ])
    expect(() =>
      mergeActions(edited, 'g', [
        {
          id: 'b',
          kind: 'model/save',
          model: { ...base.models[0], name: 'Другое' },
          expected: 1
        }
      ])
    ).toThrow(ConflictError)
    expect(() =>
      mergeActions(newCloud('new-generation'), 'g', [
        create('c', 'Старые данные')
      ])
    ).toThrow('очищен')
  })
})
