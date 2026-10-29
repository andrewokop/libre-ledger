import { describe, expect, it } from 'vitest'
import { derive } from './accounting'
import {
  applyAction,
  availableLots,
  financialFingerprint,
  splitDelivery,
  parseBackup,
  parseWorkspace,
  suggestAllocations
} from './domain'
import { mergeActions, newCloud } from './syncProtocol'
import {
  DEFAULT_SETTINGS,
  expiredOn,
  expiryEnd,
  type Purchase,
  type Sale,
  type Workspace,
  type WriteOff
} from './types'

const model = { id: 'm', name: 'Товар', color: '#526df4', salePrice: 0 }
const purchase = (
  id: string,
  quantity: number,
  unitPrice: number,
  extra = 0,
  expiry?: string
): Purchase => ({
  id,
  modelId: 'm',
  date: '2025-01-01',
  quantity,
  unitPrice,
  extra,
  sold: 0,
  version: 1,
  ...(expiry ? { expiry } : {})
})
const sale = (
  id: string,
  date: string,
  quantity: number,
  unitPrice: number,
  allocations?: Sale['allocations']
): Sale => ({
  id,
  modelId: 'm',
  date,
  quantity,
  unitPrice,
  costBasis: 0,
  version: 1,
  ...(allocations ? { allocations } : {})
})
const workspace = (purchases: Purchase[], sales: Sale[] = []): Workspace => ({
  models: [model],
  purchases,
  sales,
  writeOffs: [],
  settings: { ...DEFAULT_SETTINGS }
})
const alloc = (purchaseId: string, quantity: number) => ({
  purchaseId,
  quantity
})

describe('actual lot accounting', () => {
  it('distributes delivery kopecks across partial and complete disposals without losing value', () => {
    const p = purchase('p', 3, 1, 0.01)
    const s1 = sale('s1', '2025-01-02', 1, 2, [alloc('p', 1)])
    const s2 = sale('s2', '2025-01-03', 1, 2, [alloc('p', 1)])
    const data = workspace([p], [s1, s2])
    const partial = derive(data)
    expect(partial.cogs).toBeCloseTo(2.01, 8)
    expect(partial.stockValue).toBeCloseTo(1, 8)
    expect(partial.investments).toBeCloseTo(
      partial.cogs + partial.stockValue,
      8
    )
    const all = derive({
      ...data,
      sales: [...data.sales, sale('s3', '2025-01-04', 1, 2, [alloc('p', 1)])]
    })
    expect(all.cogs).toBeCloseTo(3.01, 8)
    expect(all.stockValue).toBe(0)
    expect(all.quantity).toBe(0)
  })
  it('counts free purchases and gifts, charging delivery cost against profit', () => {
    const stats = derive(
      workspace(
        [purchase('p', 2, 0, 0.02)],
        [sale('s', '2025-01-02', 1, 0, [alloc('p', 1)])]
      )
    )
    expect(stats).toMatchObject({
      investments: 0.02,
      purchasedQuantity: 2,
      salesQuantity: 1,
      freeQuantity: 1,
      revenue: 0,
      quantity: 1
    })
    expect(stats.profit).toBeCloseTo(-0.01, 8)
    expect(stats.stockValue).toBeCloseTo(0.01, 8)
  })
  it('costs a multi-lot sale from the selected lots', () => {
    const data = workspace(
      [purchase('a', 2, 10), purchase('b', 2, 20, 2)],
      [sale('s', '2025-01-02', 2, 30, [alloc('a', 1), alloc('b', 1)])]
    )
    const stats = derive(data)
    expect(stats).toMatchObject({
      revenue: 60,
      cogs: 31,
      profit: 29,
      stockValue: 31,
      quantity: 2,
      salesQuantity: 2
    })
    expect(stats.lots.find((l) => l.purchase.id === 'a')).toMatchObject({
      sold: 1,
      remaining: 1,
      cogs: 10,
      revenue: 30
    })
    expect(stats.lots.find((l) => l.purchase.id === 'b')).toMatchObject({
      sold: 1,
      remaining: 1,
      cogs: 21,
      revenue: 30
    })
  })
  it('releases a cancelled write-off and restores the same lot and cost', () => {
    const w: WriteOff = {
      id: 'w',
      modelId: 'm',
      date: '2025-01-02',
      quantity: 1,
      allocations: [alloc('p', 1)],
      reason: 'Порча',
      version: 1
    }
    const data = workspace([purchase('p', 2, 10)])
    const active = parseWorkspace({ ...data, writeOffs: [w] })
    expect(derive(active)).toMatchObject({
      writeOffQuantity: 1,
      writeOffCost: 10,
      profit: -10,
      quantity: 1
    })
    const cancelled = applyAction(active, {
      id: 'c',
      kind: 'writeoff/save',
      entry: { ...w, status: 'cancelled' },
      expected: 1
    })
    expect(derive(cancelled)).toMatchObject({
      writeOffQuantity: 0,
      writeOffCost: 0,
      quantity: 2,
      profit: 0
    })
    const restored = applyAction(cancelled, {
      id: 'r',
      kind: 'writeoff/save',
      entry: { ...cancelled.writeOffs![0], status: 'active' },
      expected: 2
    })
    expect(derive(restored)).toMatchObject({
      writeOffQuantity: 1,
      writeOffCost: 10,
      quantity: 1,
      profit: -10
    })
  })
})

describe('expiry and lot constraints', () => {
  it('accepts month/year in the future or absent and rejects malformed values; expiry ends on the last day', () => {
    expect(
      parseWorkspace(
        workspace([purchase('a', 1, 1, 0, '2099-12'), purchase('b', 1, 1)])
      ).purchases.map((p) => p.expiry)
    ).toEqual(['2099-12', undefined])
    for (const expiry of ['2025-00', '2025-13', '2025-1', '2025-02-01'])
      expect(() =>
        parseWorkspace(workspace([purchase('p', 1, 1, 0, expiry)]))
      ).toThrow()
    expect(expiryEnd('2024-02')).toBe('2024-02-29')
    expect(expiredOn('2024-02', '2024-02-29')).toBe(false)
    expect(expiredOn('2024-02', '2024-03-01')).toBe(true)
  })
  it('reserves later allocations and offers an edited sale its own units', () => {
    const data = workspace(
      [purchase('p', 3, 1, 0, '2099-01')],
      [sale('later', '2025-01-10', 2, 2, [alloc('p', 2)])]
    )
    expect(availableLots(data, 'm', '2025-01-02')[0].remaining).toBe(1)
    expect(suggestAllocations(data, 'm', '2025-01-02', 2)).toEqual([
      alloc('p', 1)
    ])
    expect(
      availableLots(data, 'm', '2025-01-10', { type: 'sale', id: 'later' })[0]
        .remaining
    ).toBe(3)
    expect(() =>
      applyAction(data, {
        id: 'a',
        kind: 'sale/save',
        entry: sale('earlier', '2025-01-02', 2, 2, [alloc('p', 2)]),
        expected: null
      })
    ).toThrow()
  })
  it('returns cancelled sale units and refuses restoration after they are consumed', () => {
    const s = sale('s', '2025-01-02', 1, 2, [alloc('p', 1)])
    const data = workspace([purchase('p', 1, 1)], [s])
    const cancelled = applyAction(data, {
      id: 'cancel',
      kind: 'sale/save',
      entry: { ...s, status: 'cancelled' },
      expected: 1
    })
    expect(derive(cancelled)).toMatchObject({
      quantity: 1,
      revenue: 0,
      profit: 0
    })
    const used = applyAction(cancelled, {
      id: 'use',
      kind: 'sale/save',
      entry: sale('s2', '2025-01-03', 1, 2, [alloc('p', 1)]),
      expected: null
    })
    expect(() =>
      applyAction(used, {
        id: 'restore',
        kind: 'sale/save',
        entry: { ...cancelled.sales[0], status: 'active' },
        expected: 2
      })
    ).toThrow()
  })
  it('rejects a second queued sale of the last unit after another sale wins', () => {
    const cloud = {
      ...newCloud('generation'),
      workspace: workspace([purchase('p', 1, 1)])
    }
    const first = mergeActions(cloud, 'generation', [
      {
        id: 'first',
        kind: 'sale/save',
        entry: sale('s1', '2025-01-02', 1, 2, [alloc('p', 1)]),
        expected: null
      }
    ])
    expect(() =>
      mergeActions(first, 'generation', [
        {
          id: 'second',
          kind: 'sale/save',
          entry: sale('s2', '2025-01-02', 1, 2, [alloc('p', 1)]),
          expected: null
        }
      ])
    ).toThrow()
    expect(derive(first.workspace).quantity).toBe(0)
  })
  it('rejects used purchase deletion, cancellation, reduction or moving it after the sale', () => {
    const p = purchase('p', 2, 1)
    const data = workspace(
      [p],
      [sale('s', '2025-01-02', 2, 2, [alloc('p', 2)])]
    )
    expect(() =>
      applyAction(data, {
        id: 'd',
        kind: 'purchase/delete',
        entryId: 'p',
        expected: 1
      })
    ).toThrow()
    for (const entry of [
      { ...p, status: 'cancelled' as const },
      { ...p, quantity: 1 },
      { ...p, date: '2025-01-03' }
    ])
      expect(() =>
        applyAction(data, {
          id: 'e',
          kind: 'purchase/save',
          entry,
          expected: 1
        })
      ).toThrow()
  })
  it('rejects wrong allocation sums, duplicate lots, wrong model and backdated sale', () => {
    const p = purchase('p', 2, 1)
    const other = { ...purchase('q', 1, 1), modelId: 'other' }
    const data = {
      ...workspace([p, other]),
      models: [model, { id: 'other', name: 'Другая', color: '#526df4' }]
    }
    for (const bad of [
      sale('s', '2025-01-02', 2, 1, [alloc('p', 1)]),
      sale('s', '2025-01-02', 2, 1, [alloc('p', 1), alloc('p', 1)]),
      sale('s', '2025-01-02', 1, 1, [alloc('q', 1)]),
      sale('s', '2024-12-31', 1, 1, [alloc('p', 1)])
    ])
      expect(() => parseWorkspace({ ...data, sales: [bad] })).toThrow()
  })
})

describe('legacy migration and backup', () => {
  it('reserves explicit later allocations when estimating earlier legacy sales without changing average totals', () => {
    const data = parseWorkspace({
      ...workspace(
        [purchase('a', 1, 10), purchase('b', 1, 20)],
        [
          sale('legacy', '2025-01-02', 1, 30),
          sale('known', '2025-01-03', 1, 30, [alloc('a', 1)])
        ]
      ),
      settings: { ...DEFAULT_SETTINGS, costingMethod: 'average' }
    })
    const stats = derive(data)
    expect(stats.allocationsByEntry.get('sale:legacy')).toEqual([alloc('b', 1)])
    expect(stats.allocationsByEntry.get('sale:known')).toEqual([alloc('a', 1)])
    expect(stats).toMatchObject({
      revenue: 60,
      cogs: 30,
      profit: 30,
      stockValue: 0,
      unassignedModels: ['m']
    })
  })
  it('retains moving-average historical financial totals and marks unknown lots', () => {
    const legacy = {
      models: [model],
      purchases: [purchase('a', 2, 10), purchase('b', 2, 20)],
      sales: [sale('s', '2025-01-02', 2, 30)]
    }
    const migrated = parseBackup({ schemaVersion: 2, workspace: legacy })
    const stats = derive(migrated)
    expect(migrated.settings?.costingMethod).toBe('average')
    expect(stats).toMatchObject({
      revenue: 60,
      cogs: 30,
      profit: 30,
      stockValue: 30,
      quantity: 2,
      investments: 60,
      unassignedModels: ['m']
    })
    expect(stats.lots.every((lot) => lot.estimated)).toBe(true)
    expect(() =>
      applyAction(migrated, {
        id: 'change',
        kind: 'settings/save',
        settings: { ...migrated.settings!, costingMethod: 'lot' },
        expected: 0
      })
    ).toThrow()
  })
  it('round trips new fields and rejects unknown backup versions', () => {
    const data = workspace(
      [purchase('p', 2, 0, 0.01, '2099-12')],
      [sale('s', '2025-01-02', 1, 0, [alloc('p', 1)])]
    )
    data.settings = {
      ...DEFAULT_SETTINGS,
      storeName: 'Склад',
      chartMonths: 6,
      chartUnit: 'quantity',
      lotSelection: 'manual'
    }
    const restored = parseBackup(
      JSON.parse(JSON.stringify({ schemaVersion: 3, workspace: data }))
    )
    expect(restored.settings).toEqual(data.settings)
    expect(restored.models[0].salePrice).toBe(0)
    expect(restored.purchases[0].expiry).toBe('2099-12')
    expect(restored.sales[0].allocations).toEqual([alloc('p', 1)])
    expect(derive(restored).profit).toBeCloseTo(-0.01, 8)
    expect(() => parseBackup({ schemaVersion: 999, workspace: data })).toThrow()
    expect(() => parseWorkspace({ ...data, schemaVersion: 999 })).toThrow()
    expect(() =>
      parseBackup({
        schemaVersion: 3,
        workspace: { ...data, schemaVersion: 999 }
      })
    ).toThrow()
  })
})

describe('financial policy concurrency', () => {
  it('requires the matching ledger for changing method and rejects stale previews after purchases or sales', () => {
    const data = parseWorkspace({
      ...workspace(
        [purchase('p', 3, 10)],
        [sale('s', '2025-01-02', 1, 20, [alloc('p', 1)])]
      ),
      settings: { ...DEFAULT_SETTINGS, costingMethod: 'average' }
    })
    const desired = { ...data.settings!, costingMethod: 'lot' as const }
    const ledger = financialFingerprint(data)
    expect(() =>
      applyAction(data, {
        id: 'missing',
        kind: 'settings/save',
        settings: desired,
        expected: 0
      })
    ).toThrow()
    const withPurchase = applyAction(data, {
      id: 'p2',
      kind: 'purchase/save',
      entry: purchase('p2', 1, 10),
      expected: null
    })
    const withSale = applyAction(data, {
      id: 's2',
      kind: 'sale/save',
      entry: sale('s2', '2025-01-03', 1, 20, [alloc('p', 1)]),
      expected: null
    })
    for (const changed of [withPurchase, withSale])
      expect(() =>
        applyAction(changed, {
          id: 'stale',
          kind: 'settings/save',
          settings: desired,
          expected: 0,
          ledger
        })
      ).toThrow()
    const converted = applyAction(data, {
      id: 'convert',
      kind: 'settings/save',
      settings: desired,
      expected: 0,
      ledger
    })
    expect(converted.settings?.costingMethod).toBe('lot')
    expect(derive(converted)).toMatchObject({
      revenue: 20,
      cogs: 10,
      stockValue: 20
    })
  })
  it('rejects queued sales whose frozen costing method differs from the remote policy', () => {
    const data = workspace([purchase('p', 2, 10)])
    const entry = sale('s', '2025-01-02', 1, 20, [alloc('p', 1)])
    expect(() =>
      applyAction(data, {
        id: 'stale',
        kind: 'sale/save',
        entry,
        expected: null,
        costingMethod: 'average'
      })
    ).toThrow()
    expect(
      derive(
        applyAction(data, {
          id: 'fresh',
          kind: 'sale/save',
          entry,
          expected: null,
          costingMethod: 'lot'
        })
      ).quantity
    ).toBe(1)
  })
})

describe('exact kopeck totals', () => {
  it('sums fractional rubles across many lots, a free gift and a write-off without floating point tails', () => {
    const purchases = [
      purchase('a', 1, 0.1),
      purchase('b', 1, 0.2),
      purchase('c', 1, 0, 0.01),
      purchase('d', 1, 0),
      purchase('e', 1, 0)
    ]
    const sales = [
      sale('s1', '2025-01-02', 1, 0.1, [alloc('a', 1)]),
      sale('s2', '2025-01-02', 1, 0.2, [alloc('b', 1)]),
      sale('gift', '2025-01-02', 1, 0, [alloc('d', 1)])
    ]
    const writeOff: WriteOff = {
      id: 'w',
      modelId: 'm',
      date: '2025-01-03',
      quantity: 2,
      allocations: [alloc('c', 1), alloc('e', 1)],
      reason: 'Порча'
    }
    const stats = derive({
      ...workspace(purchases, sales),
      writeOffs: [writeOff]
    })
    expect(stats).toMatchObject({
      investments: 0.31,
      revenue: 0.3,
      cogs: 0.31,
      writeOffCost: 0.01,
      profit: -0.01,
      stockValue: 0,
      quantity: 0,
      freeQuantity: 1
    })
  })
})

describe('exact delivery allocation', () => {
  it('preserves every kopek even when multiplication exceeds Number safe integer', () => {
    const quantities = [99_999_999, 99_999_998, 99_999_997]
    const parts = splitDelivery(99_999_999.99, quantities)
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(9_999_999_999)
    const denominator = quantities.reduce((sum, q) => sum + BigInt(q), 0n)
    for (let index = 0; index < parts.length; index++) {
      const floor = Number(
        (9_999_999_999n * BigInt(quantities[index])) / denominator
      )
      expect(parts[index] === floor || parts[index] === floor + 1).toBe(true)
    }
  })
  it('uses stable tie order and rejects invalid amounts and quantities', () => {
    expect(splitDelivery(0.01, [1, 1, 1])).toEqual([1, 0, 0])
    expect(splitDelivery(0, [1, 2])).toEqual([0, 0])
    expect(() => splitDelivery(NaN, [1, 2])).toThrow()
    expect(() => splitDelivery(1, [1.5, 2])).toThrow()
  })
})
