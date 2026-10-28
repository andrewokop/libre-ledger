import { isActive, type Workspace } from './types'

export type FlowMonths = 1 | 3 | 6
export type FlowPeriod = { key: string; label: string; range: string; start: string; end: string; sales: number; expenses: number }
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const asDate = (value: string) => new Date(`${value}T12:00:00`)
const rangeFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
const monthLabels = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
export const formatFlowRange = (start: string, end: string) => rangeFormatter.formatRange(asDate(start), asDate(end))

// Calendar months through today. The one-month view groups days into readable
// seven-day intervals; longer views compare complete months and the current one.
export function financeFlow(workspace: Workspace, months: FlowMonths, end: string) {
  const endDate = asDate(end)
  const startDate = new Date(endDate.getFullYear(), endDate.getMonth() - months + 1, 1, 12)
  const start = dateKey(startDate)
  const periods: FlowPeriod[] = []
  const add = (first: Date, last: Date, label: string) => {
    const from = dateKey(first), to = dateKey(last)
    periods.push({ key: from, label, range: formatFlowRange(from, to), start: from, end: to, sales: 0, expenses: 0 })
  }
  if (months === 1) {
    for (let day = 1; day <= endDate.getDate(); day += 7) {
      const lastDay = Math.min(day + 6, endDate.getDate())
      add(new Date(endDate.getFullYear(), endDate.getMonth(), day, 12), new Date(endDate.getFullYear(), endDate.getMonth(), lastDay, 12), day === lastDay ? String(day) : `${day}–${lastDay}`)
    }
  } else {
    for (let index = 0; index < months; index++) {
      const first = new Date(startDate.getFullYear(), startDate.getMonth() + index, 1, 12)
      const last = index === months - 1 ? endDate : new Date(first.getFullYear(), first.getMonth() + 1, 0, 12)
      add(first, last, monthLabels[first.getMonth()])
    }
  }
  for (const sale of workspace.sales.filter(isActive)) {
    const period = periods.find((item) => sale.date >= item.start && sale.date <= item.end)
    if (period) period.sales += sale.quantity * sale.unitPrice
  }
  for (const purchase of workspace.purchases.filter(isActive)) {
    const period = periods.find((item) => purchase.date >= item.start && purchase.date <= item.end)
    if (period) period.expenses += purchase.quantity * purchase.unitPrice + purchase.extra
  }
  return { periods, start, end, range: formatFlowRange(start, end), sales: periods.reduce((sum, item) => sum + item.sales, 0), expenses: periods.reduce((sum, item) => sum + item.expenses, 0) }
}
