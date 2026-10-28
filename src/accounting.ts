import { isActive, type Movement, type Purchase, type Workspace } from './types'

export type LotStats = { purchase: Purchase; remaining: number; sold: number; revenue: number; cogs: number }

export function derive(workspace: Workspace) {
  const lots: LotStats[] = workspace.purchases.filter(isActive).map((purchase) => ({ purchase, remaining: 0, sold: 0, revenue: 0, cogs: 0 }))
  let revenue = 0
  let cogs = 0
  const modelBalances = new Map<string, { quantity: number; value: number }>()
  const events = [
    ...workspace.purchases.filter(isActive).map((purchase) => ({ type: 'purchase' as const, date: purchase.date, id: purchase.id, purchase })),
    ...workspace.sales.filter(isActive).map((sale) => ({ type: 'sale' as const, date: sale.date, id: sale.id, sale })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? a.id.localeCompare(b.id) : a.type === 'purchase' ? -1 : 1))

  for (const event of events) {
    if (event.type === 'purchase') {
      const batch = event.purchase
      const purchaseLot = lots.find((item) => item.purchase.id === batch.id)
      if (purchaseLot) purchaseLot.remaining += batch.quantity
      const balance = modelBalances.get(batch.modelId) ?? { quantity: 0, value: 0 }
      balance.quantity += batch.quantity
      balance.value += batch.quantity * batch.unitPrice + batch.extra
      modelBalances.set(batch.modelId, balance)
      continue
    }
    const sale = event.sale
    const balance = modelBalances.get(sale.modelId) ?? { quantity: 0, value: 0 }
    const averageCost = balance.quantity > 0 ? balance.value / balance.quantity : 0
    const saleCogs = sale.quantity * averageCost
    const modelLots = lots.filter((lot) => lot.purchase.modelId === sale.modelId && lot.remaining > 0)
    const totalRemaining = modelLots.reduce((sum, lot) => sum + lot.remaining, 0)
    let unitsToAllocate = Math.min(sale.quantity, totalRemaining)
    const quotas = modelLots.map((lot) => ({ lot, units: totalRemaining ? Math.min(lot.remaining, unitsToAllocate * lot.remaining / totalRemaining) : 0 }))
    const allocations = quotas.map(({ lot, units }) => ({ lot, units: Math.floor(units) }))
    unitsToAllocate -= allocations.reduce((sum, item) => sum + item.units, 0)
    const remainderOrder = quotas.map(({ lot, units }, index) => ({ index, fraction: units - Math.floor(units), room: lot.remaining - allocations[index].units })).sort((a, b) => b.fraction - a.fraction)
    for (const item of remainderOrder) {
      if (unitsToAllocate <= 0) break
      if (item.room <= 0) continue
      allocations[item.index].units += 1
      unitsToAllocate -= 1
    }
    for (const { lot, units } of allocations) {
      if (!units) continue
      lot.remaining -= units
      lot.sold += units
      lot.revenue += sale.unitPrice * units
      lot.cogs += averageCost * units
    }
    balance.quantity = Math.max(0, balance.quantity - sale.quantity)
    balance.value = Math.max(0, balance.value - saleCogs)
    modelBalances.set(sale.modelId, balance)
    revenue += sale.quantity * sale.unitPrice
    cogs += saleCogs
  }

  const stockValue = [...modelBalances.values()].reduce((sum, balance) => sum + balance.value, 0)
  const quantity = [...modelBalances.values()].reduce((sum, balance) => sum + balance.quantity, 0)
  const investments = workspace.purchases.filter(isActive).reduce((sum, purchase) => sum + purchase.quantity * purchase.unitPrice + purchase.extra, 0)
  const profit = revenue - cogs
  const movementByMonth = new Map<string, { month: string; sales: number; expenses: number }>()
  for (const sale of workspace.sales.filter(isActive)) {
    const key = sale.date.slice(0, 7)
    const item = movementByMonth.get(key) ?? { month: '', sales: 0, expenses: 0 }
    item.month = new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(new Date(`${key}-15T12:00:00`)).replace('.', '')
    item.sales += sale.quantity * sale.unitPrice
    movementByMonth.set(key, item)
  }
  for (const purchase of workspace.purchases.filter(isActive)) {
    const key = purchase.date.slice(0, 7)
    const item = movementByMonth.get(key) ?? { month: '', sales: 0, expenses: 0 }
    item.month = new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(new Date(`${key}-15T12:00:00`)).replace('.', '')
    item.expenses += purchase.quantity * purchase.unitPrice + purchase.extra
    movementByMonth.set(key, item)
  }
  const chart = [...movementByMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([, value]) => value)
  const movements: Movement[] = [
    ...workspace.purchases.map((purchase) => ({ ...purchase, type: 'purchase' as const, name: workspace.models.find((model) => model.id === purchase.modelId)?.name ?? 'Удалённая модель', amount: -(purchase.quantity * purchase.unitPrice + purchase.extra) })),
    ...workspace.sales.map((sale) => ({ ...sale, type: 'sale' as const, name: workspace.models.find((model) => model.id === sale.modelId)?.name ?? 'Удалённая модель', amount: sale.quantity * sale.unitPrice })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  const averageCosts = new Map([...modelBalances.entries()].map(([modelId, balance]) => [modelId, balance.quantity ? balance.value / balance.quantity : 0]))
  return { lots: lots.sort((a, b) => b.purchase.date.localeCompare(a.purchase.date)), revenue, cogs, stockValue, quantity, investments, profit, chart, movements, averageCosts }
}

export function availableOn(workspace: Workspace, modelId: string, date: string) {
  const events = [
    ...workspace.purchases.filter(isActive).filter((purchase) => purchase.modelId === modelId && purchase.date <= date).map((purchase) => ({ date: purchase.date, type: 'purchase' as const, quantity: purchase.quantity })),
    ...workspace.sales.filter(isActive).filter((sale) => sale.modelId === modelId && sale.date <= date).map((sale) => ({ date: sale.date, type: 'sale' as const, quantity: sale.quantity })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'purchase' ? -1 : 1))
  return Math.max(0, events.reduce((balance, event) => balance + (event.type === 'purchase' ? event.quantity : -event.quantity), 0))
}

export function hasStockForSales(workspace: Workspace) {
  const events = [
    ...workspace.purchases.filter(isActive).map((purchase) => ({ modelId: purchase.modelId, date: purchase.date, type: 'purchase' as const, quantity: purchase.quantity })),
    ...workspace.sales.filter(isActive).map((sale) => ({ modelId: sale.modelId, date: sale.date, type: 'sale' as const, quantity: sale.quantity })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'purchase' ? -1 : 1))
  const balances = new Map<string, number>()
  for (const event of events) {
    const next = (balances.get(event.modelId) ?? 0) + (event.type === 'purchase' ? event.quantity : -event.quantity)
    if (next < 0) return false
    balances.set(event.modelId, next)
  }
  return true
}
