import { describe, expect, it } from 'vitest'
import { availableOn, derive } from './App'
import { authErrorMessage, isAllowedEmail } from './firebase'
import type { Workspace } from './types'

const workspace: Workspace = {
  models: [{ id: 'libre', name: 'Libre', color: '#789c8b' }],
  purchases: [
    { id: 'p1', modelId: 'libre', date: '2026-01-01', quantity: 10, unitPrice: 100, extra: 100, sold: 0 },
    { id: 'p2', modelId: 'libre', date: '2026-01-10', quantity: 10, unitPrice: 200, extra: 0, sold: 0 },
  ],
  sales: [
    { id: 's1', modelId: 'libre', date: '2026-01-05', quantity: 2, unitPrice: 200, costBasis: 0 },
    { id: 's2', modelId: 'libre', date: '2026-01-15', quantity: 3, unitPrice: 250, costBasis: 0 },
  ],
}

describe('inventory accounting', () => {
  it('applies moving-average costs and keeps the inventory value balanced', () => {
    const result = derive(workspace)

    expect(result.revenue).toBe(1150)
    expect(result.cogs).toBeCloseTo(700)
    expect(result.profit).toBeCloseTo(450)
    expect(result.quantity).toBe(15)
    expect(result.stockValue).toBeCloseTo(2400)
    expect(result.stockValue + result.cogs).toBeCloseTo(3100)
  })

  it('apportions sales over active purchase lots and preserves their unit counts', () => {
    const result = derive(workspace)
    console.log(result.lots.map((lot) => ({ id: lot.purchase.id, remaining: lot.remaining, sold: lot.sold, cogs: lot.cogs, revenue: lot.revenue })))

    expect(result.lots.map((lot) => lot.remaining).sort((a, b) => a - b)).toEqual([7, 8])
    expect(result.lots.reduce((sum, lot) => sum + lot.sold, 0)).toBe(5)
    expect(result.lots.reduce((sum, lot) => sum + lot.revenue, 0)).toBe(1150)
    expect(result.lots.reduce((sum, lot) => sum + lot.cogs, 0)).toBeCloseTo(700)
  })

  it('does not allow a historical sale before the opening purchase', () => {
    expect(availableOn(workspace, 'libre', '2025-12-31')).toBe(0)
    expect(availableOn(workspace, 'libre', '2026-01-05')).toBe(8)
    expect(availableOn(workspace, 'libre', '2026-01-15')).toBe(15)
  })
})

describe('personal Firebase access', () => {
  it('only allows the owner email, ignoring letter case and surrounding spaces', () => {
    expect(isAllowedEmail('andrewokop@gmail.com')).toBe(true)
    expect(isAllowedEmail(' AndrewOkop@Gmail.com ')).toBe(true)
    expect(isAllowedEmail('someone.else@gmail.com')).toBe(false)
    expect(isAllowedEmail(null)).toBe(false)
  })

  it('explains Firebase setup errors instead of showing an opaque HTTP 400', () => {
    expect(authErrorMessage({ code: 'auth/operation-not-allowed' })).toContain('Email/Password')
    expect(authErrorMessage({ code: 'auth/unauthorized-domain' })).toContain('andrewokop.github.io')
    expect(authErrorMessage({ code: 'permission-denied' })).toContain('firestore.rules')
  })
})
