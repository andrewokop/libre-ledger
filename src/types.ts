export type Page = 'overview' | 'inventory' | 'history' | 'settings'
export type Model = {
  id: string
  name: string
  color: string
  salePrice?: number
  version?: number
}
export type EntryStatus = 'active' | 'cancelled'
export type Allocation = { purchaseId: string; quantity: number }
export type Purchase = {
  id: string
  modelId: string
  date: string
  quantity: number
  unitPrice: number
  extra: number
  sold: number
  expiry?: string
  status?: EntryStatus
  note?: string
  version?: number
}
export type Sale = {
  id: string
  modelId: string
  date: string
  quantity: number
  unitPrice: number
  costBasis: number
  allocations?: Allocation[]
  status?: EntryStatus
  note?: string
  version?: number
}
export type WriteOff = {
  id: string
  modelId: string
  date: string
  quantity: number
  allocations: Allocation[]
  reason: string
  status?: EntryStatus
  note?: string
  version?: number
}
export type LedgerSettings = {
  version: number
  storeName: string
  homePage: Page
  primaryMetric: 'profit' | 'revenue' | 'investments' | 'stockValue'
  chartMonths: 1 | 3 | 6
  chartUnit: 'rub' | 'quantity'
  expiryWarningDays: number
  lowStockThreshold: number
  lotSelection: 'fefo' | 'fifo' | 'manual'
  costingMethod: 'average' | 'lot'
}
export type Workspace = {
  models: Model[]
  purchases: Purchase[]
  sales: Sale[]
  writeOffs?: WriteOff[]
  settings?: LedgerSettings
}
export type Movement = (Purchase | Sale | WriteOff) & {
  type: 'purchase' | 'sale' | 'writeoff'
  name: string
  amount: number
}
export type EntryRef = { type: 'purchase' | 'sale' | 'writeoff'; id: string }
export const DEFAULT_SETTINGS: LedgerSettings = {
  version: 0,
  storeName: 'Мой магазин',
  homePage: 'overview',
  primaryMetric: 'profit',
  chartMonths: 1,
  chartUnit: 'rub',
  expiryWarningDays: 60,
  lowStockThreshold: 3,
  lotSelection: 'fefo',
  costingMethod: 'lot'
}
export const EMPTY_WORKSPACE: Workspace = {
  models: [],
  purchases: [],
  sales: [],
  writeOffs: [],
  settings: { ...DEFAULT_SETTINGS }
}
export const settingsFor = (workspace: Workspace): LedgerSettings =>
  workspace.settings ?? {
    ...DEFAULT_SETTINGS,
    costingMethod:
      workspace.purchases.length || workspace.sales.length ? 'average' : 'lot'
  }
export const isActive = (entry: { status?: EntryStatus }) =>
  entry.status !== 'cancelled'
export const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
export const money = (value: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
    .format(Math.abs(value) < 0.005 ? 0 : value)
    .replace(/\u00a0/g, ' ')
export const shortDate = (date: string) =>
  new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(
    new Date(`${date}T12:00:00`)
  )
export const expiryLabel = (expiry?: string) =>
  expiry ? `${expiry.slice(5)}.${expiry.slice(0, 4)}` : 'Срок не указан'
export const expiryEnd = (expiry: string) => {
  const [year, month] = expiry.split('-').map(Number)
  const last = new Date(year, month, 0, 12)
  return `${expiry}-${String(last.getDate()).padStart(2, '0')}`
}
export const expiredOn = (expiry: string | undefined, date = today()) =>
  !!expiry && expiryEnd(expiry) < date
export const expirySoon = (
  expiry: string | undefined,
  days = 60,
  date = today()
) =>
  !!expiry &&
  !expiredOn(expiry, date) &&
  (new Date(`${expiryEnd(expiry)}T12:00:00`).getTime() -
    new Date(`${date}T12:00:00`).getTime()) /
    86400000 <=
    days
export const id = () => crypto.randomUUID()
export const modelAccent = (color: string) =>
  ({
    '#789c8b': '#526df4',
    '#b89569': '#f5a66b',
    '#8290a6': '#a493eb',
    '#b27c72': '#75b7ee',
    '#827a9a': '#bd83cf'
  })[color.toLowerCase()] ?? color
