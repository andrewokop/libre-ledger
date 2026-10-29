import {
  isActive,
  settingsFor,
  type Allocation,
  type EntryRef,
  type Movement,
  type Purchase,
  type Workspace
} from './types'

export type LotStats = {
  purchase: Purchase
  remaining: number
  sold: number
  writtenOff: number
  revenue: number
  cogs: number
  stockValue: number
  estimated: boolean
}
const cents = (value: number) => Math.round(value * 100)
const share = (total: number, units: number, quantity: number) =>
  Number(
    (BigInt(total) * BigInt(units) * 2n + BigInt(quantity)) /
      (BigInt(quantity) * 2n)
  )
export function derive(workspace: Workspace) {
  const method = settingsFor(workspace).costingMethod
  const lots: LotStats[] = workspace.purchases
    .filter(isActive)
    .map((purchase) => ({
      purchase,
      remaining: 0,
      sold: 0,
      writtenOff: 0,
      revenue: 0,
      cogs: 0,
      stockValue: 0,
      estimated: false
    }))
  const byId = new Map(lots.map((lot) => [lot.purchase.id, lot]))
  const balances = new Map<string, { quantity: number; value: number }>()
  const unassignedModels = [
    ...new Set(
      workspace.sales
        .filter(isActive)
        .filter((sale) => !sale.allocations)
        .map((sale) => sale.modelId)
    )
  ]
  const allocationsByEntry = new Map<string, Allocation[]>()
  const movementCosts = new Map<string, number>()
  let revenue = 0,
    cogs = 0,
    writeOffCost = 0
  let revenueCents = 0,
    cogsCents = 0,
    writeOffCents = 0
  const lotRevenueCents = new Map<string, number>()
  const events = [
    ...workspace.purchases
      .filter(isActive)
      .map((entry) => ({ type: 'purchase' as const, entry })),
    ...workspace.sales
      .filter(isActive)
      .map((entry) => ({ type: 'sale' as const, entry })),
    ...(workspace.writeOffs ?? [])
      .filter(isActive)
      .map((entry) => ({ type: 'writeoff' as const, entry }))
  ].sort(
    (a, b) =>
      a.entry.date.localeCompare(b.entry.date) ||
      (a.type === 'purchase' && b.type !== 'purchase'
        ? -1
        : b.type === 'purchase' && a.type !== 'purchase'
          ? 1
          : a.entry.id.localeCompare(b.entry.id))
  )
  const futureReserved = new Map<string, number>()
  for (const { type, entry } of events)
    if (type !== 'purchase' && 'allocations' in entry && entry.allocations)
      for (const allocation of entry.allocations)
        futureReserved.set(
          allocation.purchaseId,
          (futureReserved.get(allocation.purchaseId) ?? 0) + allocation.quantity
        )
  for (const { type, entry } of events) {
    const balance = balances.get(entry.modelId) ?? { quantity: 0, value: 0 }
    if (type === 'purchase') {
      const purchase = entry as Purchase
      byId.get(entry.id)!.remaining += entry.quantity
      balance.quantity += entry.quantity
      balance.value +=
        method === 'lot'
          ? cents(purchase.unitPrice) * purchase.quantity +
            cents(purchase.extra)
          : purchase.unitPrice * purchase.quantity + purchase.extra
      balances.set(entry.modelId, balance)
      continue
    }
    if (balance.quantity < entry.quantity)
      throw new Error(
        'Изменение создаст отрицательный остаток. Проверьте даты и количество, включая более поздние продажи.'
      )
    const average = balance.quantity ? balance.value / balance.quantity : 0
    let allocations: Allocation[]
    if ('allocations' in entry && entry.allocations) {
      allocations = entry.allocations
      for (const allocation of allocations)
        futureReserved.set(
          allocation.purchaseId,
          (futureReserved.get(allocation.purchaseId) ?? 0) - allocation.quantity
        )
    } else {
      if (method === 'lot')
        throw new Error(
          'Уточните партии старых продаж в разделе «Операции» перед переходом на учёт по партиям.'
        )
      const available = lots.filter(
        (lot) =>
          lot.purchase.modelId === entry.modelId &&
          lot.remaining > (futureReserved.get(lot.purchase.id) ?? 0)
      )
      const total = available.reduce(
        (sum, lot) =>
          sum + lot.remaining - (futureReserved.get(lot.purchase.id) ?? 0),
        0
      )
      if (total < entry.quantity)
        throw Error(
          'Недостаточно товара для старой продажи с учётом подтверждённых партий следующих операций. Уточните партии в истории.'
        )
      const quotas = available.map((lot) => ({
        lot,
        exact:
          (entry.quantity *
            (lot.remaining - (futureReserved.get(lot.purchase.id) ?? 0))) /
          total
      }))
      allocations = quotas.map(({ lot, exact }) => ({
        purchaseId: lot.purchase.id,
        quantity: Math.floor(exact)
      }))
      let left =
        entry.quantity -
        allocations.reduce((sum, item) => sum + item.quantity, 0)
      for (const { index } of quotas
        .map(({ exact }, index) => ({
          index,
          fraction: exact - Math.floor(exact)
        }))
        .sort((a, b) => b.fraction - a.fraction)) {
        if (!left) break
        allocations[index].quantity++
        left--
      }
      allocations = allocations.filter((item) => item.quantity > 0)
    }
    if (
      allocations.reduce((sum, item) => sum + item.quantity, 0) !==
        entry.quantity ||
      new Set(allocations.map((item) => item.purchaseId)).size !==
        allocations.length
    )
      throw new Error(
        'Количество по партиям должно совпадать с количеством операции.'
      )
    let cost = 0
    for (const allocation of allocations) {
      const lot = byId.get(allocation.purchaseId)
      if (
        !lot ||
        lot.purchase.modelId !== entry.modelId ||
        lot.purchase.date > entry.date
      )
        throw new Error('Выбранная партия недоступна на дату операции.')
      if (
        !Number.isSafeInteger(allocation.quantity) ||
        allocation.quantity < 1 ||
        allocation.quantity > lot.remaining
      )
        throw new Error(
          `Недостаточно товара в выбранной партии от ${lot.purchase.date}. Проверьте последующие операции.`
        )
      const totalCost =
        cents(lot.purchase.unitPrice) * lot.purchase.quantity +
        cents(lot.purchase.extra)
      const previousUnits = lot.sold + lot.writtenOff
      const partCost =
        method === 'lot'
          ? share(
              totalCost,
              previousUnits + allocation.quantity,
              lot.purchase.quantity
            ) - share(totalCost, previousUnits, lot.purchase.quantity)
          : average * allocation.quantity
      cost += partCost
      lot.cogs += method === 'lot' ? partCost / 100 : partCost
      lot.remaining -= allocation.quantity
      if (type === 'sale') {
        lot.sold += allocation.quantity
        lot.revenue +=
          ('unitPrice' in entry ? entry.unitPrice : 0) * allocation.quantity
        lotRevenueCents.set(
          lot.purchase.id,
          (lotRevenueCents.get(lot.purchase.id) ?? 0) +
            cents('unitPrice' in entry ? entry.unitPrice : 0) *
              allocation.quantity
        )
      } else lot.writtenOff += allocation.quantity
    }
    allocationsByEntry.set(
      `${type}:${entry.id}`,
      allocations.map((item) => ({ ...item }))
    )
    const recordedCost =
      method === 'lot' ? cost / 100 : average * entry.quantity
    movementCosts.set(`${type}:${entry.id}`, recordedCost)
    cogs += recordedCost
    if (type === 'writeoff') writeOffCost += recordedCost
    if (method === 'lot') {
      cogsCents += cost
      if (type === 'writeoff') writeOffCents += cost
    }
    balance.quantity -= entry.quantity
    balance.value = Math.max(
      0,
      balance.value - (method === 'lot' ? cost : average * entry.quantity)
    )
    balances.set(entry.modelId, balance)
    if (type === 'sale' && 'unitPrice' in entry) {
      revenue += entry.quantity * entry.unitPrice
      revenueCents += cents(entry.unitPrice) * entry.quantity
    }
  }
  if (method === 'lot') {
    revenue = revenueCents / 100
    cogs = cogsCents / 100
    writeOffCost = writeOffCents / 100
  }
  const averageCosts = new Map<string, number>()
  for (const [modelId, balance] of balances)
    averageCosts.set(
      modelId,
      balance.quantity
        ? balance.value / balance.quantity / (method === 'lot' ? 100 : 1)
        : 0
    )
  for (const lot of lots) {
    lot.estimated = unassignedModels.includes(lot.purchase.modelId)
    const totalCost =
      cents(lot.purchase.unitPrice) * lot.purchase.quantity +
      cents(lot.purchase.extra)
    if (method === 'lot') {
      lot.cogs =
        share(totalCost, lot.sold + lot.writtenOff, lot.purchase.quantity) / 100
      lot.revenue = (lotRevenueCents.get(lot.purchase.id) ?? 0) / 100
    }
    lot.stockValue =
      method === 'lot'
        ? (totalCost -
            share(
              totalCost,
              lot.sold + lot.writtenOff,
              lot.purchase.quantity
            )) /
          100
        : lot.remaining * (averageCosts.get(lot.purchase.modelId) ?? 0)
  }
  const stockValue =
    [...balances.values()].reduce((sum, balance) => sum + balance.value, 0) /
    (method === 'lot' ? 100 : 1)
  const quantity = [...balances.values()].reduce(
    (sum, balance) => sum + balance.quantity,
    0
  )
  const investments =
    workspace.purchases
      .filter(isActive)
      .reduce(
        (sum, p) => sum + cents(p.unitPrice) * p.quantity + cents(p.extra),
        0
      ) / 100
  const salesQuantity = workspace.sales
    .filter(isActive)
    .reduce((sum, s) => sum + s.quantity, 0)
  const freeQuantity = workspace.sales
    .filter(isActive)
    .filter((s) => s.unitPrice === 0)
    .reduce((sum, s) => sum + s.quantity, 0)
  const purchasedQuantity = workspace.purchases
    .filter(isActive)
    .reduce((sum, p) => sum + p.quantity, 0)
  const writeOffQuantity = (workspace.writeOffs ?? [])
    .filter(isActive)
    .reduce((sum, w) => sum + w.quantity, 0)
  const movements: Movement[] = [
    ...workspace.purchases.map((p) => ({
      ...p,
      type: 'purchase' as const,
      name:
        workspace.models.find((m) => m.id === p.modelId)?.name ??
        'Удалённая модель',
      amount: -(p.quantity * p.unitPrice + p.extra)
    })),
    ...workspace.sales.map((s) => ({
      ...s,
      type: 'sale' as const,
      name:
        workspace.models.find((m) => m.id === s.modelId)?.name ??
        'Удалённая модель',
      amount: s.quantity * s.unitPrice
    })),
    ...(workspace.writeOffs ?? []).map((w) => ({
      ...w,
      type: 'writeoff' as const,
      name:
        workspace.models.find((m) => m.id === w.modelId)?.name ??
        'Удалённая модель',
      amount: -(movementCosts.get(`writeoff:${w.id}`) ?? 0)
    }))
  ].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  return {
    lots: lots.sort((a, b) => b.purchase.date.localeCompare(a.purchase.date)),
    revenue,
    cogs,
    writeOffCost,
    stockValue,
    quantity,
    investments,
    profit:
      method === 'lot' ? (revenueCents - cogsCents) / 100 : revenue - cogs,
    movements,
    averageCosts,
    salesQuantity,
    freeQuantity,
    purchasedQuantity,
    writeOffQuantity,
    unassignedModels,
    allocationsByEntry,
    movementCosts,
    chart: []
  }
}
export function availableOn(
  workspace: Workspace,
  modelId: string,
  date: string
) {
  return (
    workspace.purchases
      .filter(isActive)
      .filter((p) => p.modelId === modelId && p.date <= date)
      .reduce((sum, p) => sum + p.quantity, 0) -
    workspace.sales
      .filter(isActive)
      .filter((s) => s.modelId === modelId && s.date <= date)
      .reduce((sum, s) => sum + s.quantity, 0) -
    (workspace.writeOffs ?? [])
      .filter(isActive)
      .filter((w) => w.modelId === modelId && w.date <= date)
      .reduce((sum, w) => sum + w.quantity, 0)
  )
}
export function hasStockForSales(workspace: Workspace) {
  try {
    derive(workspace)
    return true
  } catch {
    return false
  }
}
export function withoutEntry(workspace: Workspace, ref?: EntryRef): Workspace {
  return ref
    ? {
        ...workspace,
        sales: workspace.sales.filter(
          (s) => ref.type !== 'sale' || s.id !== ref.id
        ),
        writeOffs: (workspace.writeOffs ?? []).filter(
          (w) => ref.type !== 'writeoff' || w.id !== ref.id
        )
      }
    : workspace
}
