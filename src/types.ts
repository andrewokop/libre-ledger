export type Model = { id: string; name: string; color: string; version?: number }
export type EntryStatus = 'active' | 'cancelled'
export type Purchase = { id: string; modelId: string; date: string; quantity: number; unitPrice: number; extra: number; sold: number; status?: EntryStatus; note?: string; version?: number }
export type Sale = { id: string; modelId: string; date: string; quantity: number; unitPrice: number; costBasis: number; status?: EntryStatus; note?: string; version?: number }
export type Workspace = { models: Model[]; purchases: Purchase[]; sales: Sale[] }
export type Movement = (Purchase | Sale) & { type: 'purchase' | 'sale'; name: string; amount: number }
export type EntryRef = { type: 'purchase' | 'sale'; id: string }
export const EMPTY_WORKSPACE: Workspace = { models: [], purchases: [], sales: [] }
export const isActive = (entry: { status?: EntryStatus }) => entry.status !== 'cancelled'
export const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
export const money = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Math.abs(value) < 0.005 ? 0 : value)
export const shortDate = (date: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`))
export const id = () => crypto.randomUUID()
export const modelAccent = (color: string) => ({ '#789c8b': '#526df4', '#b89569': '#f5a66b', '#8290a6': '#a493eb', '#b27c72': '#75b7ee', '#827a9a': '#bd83cf' }[color.toLowerCase()] ?? color)
