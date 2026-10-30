import { describe, expect, it } from 'vitest'
import { salesFlow } from './financeFlow'
import type { Workspace } from './types'

const workspace = (): Workspace => ({
  models: [],
  purchases: [],
  sales: [
    {
      id: 'paid',
      modelId: 'm',
      date: '2026-10-08',
      quantity: 2,
      unitPrice: 200,
      costBasis: 0
    },
    {
      id: 'free',
      modelId: 'm',
      date: '2026-10-28',
      quantity: 3,
      unitPrice: 0,
      costBasis: 0
    },
    {
      id: 'cancelled',
      modelId: 'm',
      date: '2026-10-08',
      quantity: 1,
      unitPrice: 500,
      costBasis: 0,
      status: 'cancelled'
    },
    {
      id: 'future',
      modelId: 'm',
      date: '2026-10-29',
      quantity: 1,
      unitPrice: 999,
      costBasis: 0
    }
  ]
})

describe('sales chart calendar periods', () => {
  it('groups the month into weeks and distinguishes free sales from no events', () => {
    const flow = salesFlow(workspace(), 1, '2026-10-28')
    expect(flow.periods).toHaveLength(4)
    expect(flow.periods[1]).toMatchObject({ start: '2026-10-08', sales: 400, quantity: 2, count: 1 })
    expect(flow.periods[3]).toMatchObject({ sales: 0, quantity: 3, count: 1 })
    expect(flow.periods[0]).toMatchObject({ sales: 0, quantity: 0, count: 0 })
    expect(flow).toMatchObject({ sales: 400, quantity: 5, count: 2 })
  })
  it('covers two calendar months', () => {
    expect(salesFlow(workspace(), 2, '2026-10-28').start).toBe('2026-09-01')
  })
  it('covers three calendar months in contiguous weeks through today', () => {
    const flow = salesFlow(workspace(), 3, '2026-10-28')
    expect(flow.start).toBe('2026-08-01')
    expect(flow.periods[0]).toMatchObject({
      start: '2026-08-01',
      end: '2026-08-07'
    })
    expect(flow.periods.at(-1)?.end).toBe('2026-10-28')
    expect(flow.periods.reduce((sum, period) => sum + period.quantity, 0)).toBe(
      5
    )
  })
  it('crosses year boundaries and includes leap day', () => {
    const data = workspace()
    data.sales = [{ ...data.sales[0], date: '2024-02-29' }]
    const flow = salesFlow(data, 6, '2024-02-29')
    expect(flow.start).toBe('2023-09-01')
    expect(flow.periods.at(-1)?.end).toBe('2024-02-29')
    expect(flow.sales).toBe(400)
  })
})
