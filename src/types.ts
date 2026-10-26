export type Model = { id: string; name: string; color: string }
export type Purchase = {
  id: string
  modelId: string
  date: string
  quantity: number
  unitPrice: number
  extra: number
  sold: number
}
export type Sale = { id: string; modelId: string; date: string; quantity: number; unitPrice: number; costBasis: number }
export type Workspace = { models: Model[]; purchases: Purchase[]; sales: Sale[] }

export const initialWorkspace: Workspace = {
  models: [
    { id: 'libre-2', name: 'FreeStyle Libre 2', color: '#789c8b' },
    { id: 'libre-2-plus', name: 'FreeStyle Libre 2 Plus', color: '#b89569' },
    { id: 'libre-3', name: 'FreeStyle Libre 3', color: '#8290a6' },
    { id: 'libre-3-plus', name: 'FreeStyle Libre 3 Plus', color: '#b27c72' },
  ],
  purchases: [
    { id: 'p1', modelId: 'libre-2', date: '2026-10-01', quantity: 12, unitPrice: 2470, extra: 920, sold: 8 },
    { id: 'p2', modelId: 'libre-2', date: '2026-10-14', quantity: 10, unitPrice: 2530, extra: 600, sold: 2 },
    { id: 'p3', modelId: 'libre-3', date: '2026-10-06', quantity: 8, unitPrice: 3690, extra: 840, sold: 5 },
    { id: 'p4', modelId: 'libre-2-plus', date: '2026-09-22', quantity: 6, unitPrice: 2860, extra: 540, sold: 4 },
    { id: 'p5', modelId: 'libre-3-plus', date: '2026-10-20', quantity: 4, unitPrice: 4590, extra: 760, sold: 1 },
    { id: 'p6', modelId: 'libre-3', date: '2026-10-21', quantity: 5, unitPrice: 3580, extra: 450, sold: 0 },
  ],
  sales: [
    { id: 's1', modelId: 'libre-2', date: '2026-10-03', quantity: 2, unitPrice: 3490, costBasis: 0 },
    { id: 's2', modelId: 'libre-2', date: '2026-10-08', quantity: 3, unitPrice: 3590, costBasis: 0 },
    { id: 's3', modelId: 'libre-2', date: '2026-10-16', quantity: 3, unitPrice: 3690, costBasis: 0 },
    { id: 's4', modelId: 'libre-2', date: '2026-10-24', quantity: 2, unitPrice: 3590, costBasis: 0 },
    { id: 's5', modelId: 'libre-3', date: '2026-10-09', quantity: 2, unitPrice: 5190, costBasis: 0 },
    { id: 's6', modelId: 'libre-3', date: '2026-10-18', quantity: 2, unitPrice: 5290, costBasis: 0 },
    { id: 's7', modelId: 'libre-3', date: '2026-10-23', quantity: 1, unitPrice: 5290, costBasis: 0 },
    { id: 's8', modelId: 'libre-2-plus', date: '2026-10-02', quantity: 2, unitPrice: 4190, costBasis: 0 },
    { id: 's9', modelId: 'libre-2-plus', date: '2026-10-12', quantity: 2, unitPrice: 4290, costBasis: 0 },
    { id: 's10', modelId: 'libre-3-plus', date: '2026-10-25', quantity: 1, unitPrice: 5990, costBasis: 0 },
  ],
}

export const today = () => new Date().toLocaleDateString('en-CA')
export const money = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(value))
export const shortDate = (date: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))
export const id = () => crypto.randomUUID()
