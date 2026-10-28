import { describe, expect, it } from 'vitest'
import { financeFlow } from './financeFlow'
import type { Workspace } from './types'

function workspace(): Workspace {
  return {
    models: [{ id: 'm', name: 'Товар', color: '#526df4' }],
    purchases: [{ id: 'p', modelId: 'm', date: '2026-10-07', quantity: 10, unitPrice: 100, extra: 70, sold: 0 }],
    sales: [
      { id: 's1', modelId: 'm', date: '2026-10-08', quantity: 2, unitPrice: 200, costBasis: 0 },
      { id: 's2', modelId: 'm', date: '2026-10-28', quantity: 1, unitPrice: 220, costBasis: 0 },
      { id: 'cancelled', modelId: 'm', date: '2026-10-08', quantity: 1, unitPrice: 500, costBasis: 0, status: 'cancelled' },
      { id: 'future', modelId: 'm', date: '2026-10-29', quantity: 1, unitPrice: 999, costBasis: 0 },
      { id: 'old', modelId: 'm', date: '2026-07-31', quantity: 1, unitPrice: 100, costBasis: 0 },
    ],
  }
}

describe('calendar periods for sales and purchases', () => {
  it('compares current-month weeks, includes delivery, excludes cancelled and future entries', () => {
    const flow = financeFlow(workspace(), 1, '2026-10-28')
    expect(flow.start).toBe('2026-10-01')
    expect(flow.periods.map(({ label }) => label)).toEqual(['1–7', '8–14', '15–21', '22–28'])
    expect(flow.periods.map(({ sales }) => sales)).toEqual([0, 400, 0, 220])
    expect(flow.periods.map(({ expenses }) => expenses)).toEqual([1070, 0, 0, 0])
    expect(flow.sales).toBe(620); expect(flow.expenses).toBe(1070)
  })
  it('compares three calendar months through today without including the previous month', () => {
    const data = workspace(); data.sales.push({ ...data.sales[0], id: 'august', date: '2026-08-01', unitPrice: 50 })
    const flow = financeFlow(data, 3, '2026-10-28')
    expect(flow.start).toBe('2026-08-01'); expect(flow.end).toBe('2026-10-28')
    expect(flow.periods.map(({ sales }) => sales)).toEqual([100, 0, 620])
    expect(flow.periods[2].end).toBe('2026-10-28')
  })
  it('keeps six months ordered across the year boundary', () => {
    const flow = financeFlow({ models: [], purchases: [], sales: [] }, 6, '2026-01-15')
    expect(flow.periods.map(({ start }) => start)).toEqual(['2025-08-01', '2025-09-01', '2025-10-01', '2025-11-01', '2025-12-01', '2026-01-01'])
    expect(flow.periods[4].end).toBe('2025-12-31'); expect(flow.periods[5].end).toBe('2026-01-15')
    expect(flow.sales).toBe(0); expect(flow.expenses).toBe(0)
  })
  it('includes leap day once in the final weekly interval', () => {
    const data = workspace(); data.sales = [{ ...data.sales[0], date: '2024-02-29' }]
    const flow = financeFlow(data, 1, '2024-02-29')
    expect(flow.periods).toHaveLength(5); expect(flow.periods[4]).toMatchObject({ label: '29', start: '2024-02-29', end: '2024-02-29', sales: 400 })
    expect(flow.sales).toBe(400)
  })
  it('shows only elapsed days on the first day of a month', () => {
    const flow = financeFlow(workspace(), 1, '2026-10-01')
    expect(flow.periods).toHaveLength(1); expect(flow.periods[0]).toMatchObject({ start: '2026-10-01', end: '2026-10-01', label: '1', sales: 0, expenses: 0 })
  })
})
