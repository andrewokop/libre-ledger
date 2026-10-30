import { isActive, type Workspace } from './types'

export type FlowMonths = 1 | 2 | 3 | 6
export type FlowPeriod = {
  key: string
  label: string
  range: string
  start: string
  end: string
  sales: number
  quantity: number
  count: number
}
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const asDate = (value: string) => new Date(`${value}T12:00:00`)
const formatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
})
export const formatFlowRange = (start: string, end: string) =>
  start === end
    ? formatter.format(asDate(start))
    : formatter.formatRange(asDate(start), asDate(end))

// Calendar months through today; longer views use contiguous seven-day intervals.
export function salesFlow(
  workspace: Workspace,
  months: FlowMonths,
  end: string
) {
  const endDate = asDate(end)
  const first = new Date(
    endDate.getFullYear(),
    endDate.getMonth() - months + 1,
    1,
    12
  )
  const start = dateKey(first)
  const periods: FlowPeriod[] = []
  for (let cursor = new Date(first); cursor <= endDate;) {
    const last = new Date(cursor)
    last.setDate(last.getDate() + 6)
    if (last > endDate) last.setTime(endDate.getTime())
    const from = dateKey(cursor),
      to = dateKey(last)
    periods.push({
      key: from,
      start: from,
      end: to,
      label: `${cursor.getDate()}.${String(cursor.getMonth() + 1).padStart(2, '0')}`,
      range: formatFlowRange(from, to),
      sales: 0,
      quantity: 0,
      count: 0
    })
    cursor = new Date(last)
    cursor.setDate(cursor.getDate() + 1)
  }
  for (const sale of workspace.sales.filter(isActive)) {
    const period = periods.find(
      (item) => sale.date >= item.start && sale.date <= item.end
    )
    if (period) {
      period.sales += sale.quantity * sale.unitPrice
      period.quantity += sale.quantity
      period.count++
    }
  }
  return {
    periods,
    start,
    end,
    range: formatFlowRange(start, end),
    sales: periods.reduce((sum, item) => sum + item.sales, 0),
    quantity: periods.reduce((sum, item) => sum + item.quantity, 0),
    count: periods.reduce((sum, item) => sum + item.count, 0)
  }
}
export const financeFlow = salesFlow
