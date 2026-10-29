import { derive, availableOn, withoutEntry } from './accounting'
import {
  EMPTY_WORKSPACE,
  DEFAULT_SETTINGS,
  expiredOn,
  isActive,
  settingsFor,
  today,
  type Allocation,
  type EntryRef,
  type LedgerSettings,
  type Model,
  type Purchase,
  type Sale,
  type Workspace,
  type WriteOff
} from './types'
export const SCHEMA_VERSION = 3
export const MAX_WORKSPACE_BYTES = 750_000
export type Action =
  | { id: string; kind: 'model/save'; model: Model; expected: number | null }
  | {
      id: string
      kind: 'model/delete'
      modelId: string
      expected: number
      related: string
    }
  | {
      id: string
      kind: 'purchase/save'
      entry: Purchase
      expected: number | null
    }
  | { id: string; kind: 'purchase/batch'; entries: Purchase[] }
  | {
      id: string
      kind: 'sale/save'
      entry: Sale
      expected: number | null
      legacy?: boolean
      costingMethod?: 'average' | 'lot'
    }
  | {
      id: string
      kind: 'writeoff/save'
      entry: WriteOff
      expected: number | null
      costingMethod?: 'average' | 'lot'
    }
  | {
      id: string
      kind: 'purchase/delete' | 'sale/delete' | 'writeoff/delete'
      entryId: string
      expected: number
    }
  | {
      id: string
      kind: 'settings/save'
      settings: LedgerSettings
      expected: number
      ledger?: string
    }
export class ConflictError extends Error {
  constructor(
    message = 'Эта запись изменилась на другом устройстве. Обновите данные перед редактированием.'
  ) {
    super(message)
    this.name = 'ConflictError'
  }
}
export class GenerationError extends Error {
  constructor() {
    super(
      'Учёт был очищен или заменён на другом устройстве. Старые изменения не отправлены.'
    )
    this.name = 'GenerationError'
  }
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Некорректный формат данных.')
  return value as Record<string, unknown>
}
const text = (
  value: unknown,
  max: number,
  label: string,
  allowEmpty = false
) => {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!allowEmpty && !value.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw Error(`Проверьте поле «${label}» (до ${max} символов).`)
  return value.trim()
}
const number = (value: unknown, label: string, integer = false) => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100_000_000 ||
    (integer && (!Number.isSafeInteger(value) || value < 1)) ||
    (!integer && Math.abs(value * 100 - Math.round(value * 100)) > 0.00001)
  )
    throw Error(
      `Проверьте поле «${label}»: ${integer ? 'нужно целое положительное число' : 'нужна сумма от 0 до 100 000 000 ₽ с точностью до копейки'}.`
    )
  return value
}
/** Split one delivery amount exactly; ties keep the input row order. Returns cents. */
export function splitDelivery(extra: number, quantities: number[]): number[] {
  const totalCents = Math.round(number(extra, 'Доставка') * 100)
  if (!quantities.length || quantities.length > 100)
    throw Error('Проверьте партии закупки.')
  const units = quantities.map((quantity) =>
    number(quantity, 'Количество', true)
  )
  const denominator = BigInt(units.reduce((sum, quantity) => sum + quantity, 0))
  const numerators = units.map(
    (quantity) => BigInt(totalCents) * BigInt(quantity)
  )
  const parts = numerators.map((value) => Number(value / denominator))
  let remainder = totalCents - parts.reduce((sum, value) => sum + value, 0)
  const order = numerators
    .map((value, index) => ({ index, remainder: value % denominator }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : a.remainder > b.remainder
          ? -1
          : 1
    )
  for (const item of order) {
    if (!remainder) break
    parts[item.index]++
    remainder--
  }
  return parts
}

function date(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw Error('Укажите дату операции.')
  const parsed = new Date(`${value}T12:00:00Z`)
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value ||
    value < '2000-01-01' ||
    value > today()
  )
    throw Error('Дата должна существовать и не быть в будущем.')
  return value
}
function version(value: unknown) {
  if (value === undefined) return 0
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw Error('Повреждена версия записи.')
  return value
}
function expiry(value: unknown) {
  if (value === undefined || value === '') return undefined
  const result = text(value, 7, 'Годен до')
  if (!/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(result))
    throw Error('Укажите срок в формате месяц и год.')
  return result
}
function allocations(value: unknown): Allocation[] {
  if (!Array.isArray(value) || value.length > 1000)
    throw Error('Выберите партии для операции.')
  return value.map((item) => {
    const data = object(item)
    return {
      purchaseId: text(data.purchaseId, 100, 'Партия'),
      quantity: number(data.quantity, 'Количество в партии', true)
    }
  })
}
function common(value: unknown) {
  const item = object(value)
  if (
    item.status !== undefined &&
    item.status !== 'active' &&
    item.status !== 'cancelled'
  )
    throw Error('Неизвестный статус операции.')
  return {
    id: text(item.id, 100, 'Идентификатор'),
    modelId: text(item.modelId, 100, 'Модель'),
    date: date(item.date),
    quantity: number(item.quantity, 'Количество', true),
    status:
      item.status === 'cancelled'
        ? ('cancelled' as const)
        : ('active' as const),
    note: text(item.note ?? '', 500, 'Комментарий', true),
    version: version(item.version)
  }
}
const choice = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string
): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    throw Error(`Проверьте настройку «${label}».`)
  return value as T
}
export function parseSettings(value: unknown): LedgerSettings {
  const s = object(value)
  const bounded = (value: unknown, max: number, label: string) => {
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > max
    )
      throw Error(`Проверьте настройку «${label}».`)
    return value
  }
  const months = s.chartMonths
  if (months !== 1 && months !== 3 && months !== 6)
    throw Error('Выберите период 1, 3 или 6 месяцев.')
  return {
    version: version(s.version),
    storeName: text(s.storeName, 60, 'Название магазина'),
    homePage: choice(
      s.homePage,
      ['overview', 'inventory', 'history', 'settings'],
      'Стартовый раздел'
    ),
    primaryMetric: choice(
      s.primaryMetric,
      ['profit', 'revenue', 'investments', 'stockValue'],
      'Главный показатель'
    ),
    chartMonths: months,
    chartUnit: choice(s.chartUnit, ['rub', 'quantity'], 'Единица графика'),
    expiryWarningDays: bounded(
      s.expiryWarningDays,
      730,
      'Предупреждение о сроке'
    ),
    lowStockThreshold: bounded(s.lowStockThreshold, 1_000_000, 'Малый остаток'),
    lotSelection: choice(
      s.lotSelection,
      ['fefo', 'fifo', 'manual'],
      'Выбор партий'
    ),
    costingMethod: choice(s.costingMethod, ['average', 'lot'], 'Метод учёта')
  }
}
export function parseWorkspace(value: unknown): Workspace {
  const data = object(value)
  if (
    data.schemaVersion !== undefined &&
    data.schemaVersion !== 2 &&
    data.schemaVersion !== 3
  )
    throw Error('Неизвестная версия данных. Обновите приложение.')
  if (
    !Array.isArray(data.models) ||
    !Array.isArray(data.purchases) ||
    !Array.isArray(data.sales) ||
    (data.writeOffs !== undefined && !Array.isArray(data.writeOffs))
  )
    throw Error('Файл должен содержать модели, закупки и продажи.')
  const writeOffs = (data.writeOffs ?? []) as unknown[]
  if (
    data.models.length > 100 ||
    data.purchases.length + data.sales.length + writeOffs.length > 3000
  )
    throw Error(
      'Превышен лимит: 100 моделей или 3000 операций в рабочем пространстве.'
    )
  const workspace: Workspace = {
    models: data.models.map((value) => {
      const m = object(value)
      const color = text(m.color, 7, 'Цвет')
      if (!/^#[\da-f]{6}$/i.test(color))
        throw Error('Укажите корректный цвет модели.')
      return {
        id: text(m.id, 100, 'Идентификатор'),
        name: text(m.name, 120, 'Название модели'),
        color,
        version: version(m.version),
        ...(m.salePrice !== undefined
          ? { salePrice: number(m.salePrice, 'Цена продажи') }
          : {})
      }
    }),
    purchases: data.purchases.map((value) => {
      const p = object(value)
      const e = expiry(p.expiry)
      return {
        ...common(p),
        unitPrice: number(p.unitPrice, 'Цена'),
        extra: number(p.extra, 'Доставка'),
        sold: 0,
        ...(e ? { expiry: e } : {})
      }
    }),
    sales: data.sales.map((value) => {
      const s = object(value)
      return {
        ...common(s),
        unitPrice: number(s.unitPrice, 'Цена'),
        costBasis: 0,
        ...(s.allocations !== undefined
          ? { allocations: allocations(s.allocations) }
          : {})
      }
    }),
    writeOffs: writeOffs.map((value) => {
      const w = object(value)
      return {
        ...common(w),
        reason: text(w.reason, 200, 'Причина списания'),
        allocations: allocations(w.allocations)
      }
    })
  }
  workspace.settings = data.settings
    ? parseSettings(data.settings)
    : {
        ...DEFAULT_SETTINGS,
        costingMethod:
          workspace.purchases.length || workspace.sales.length
            ? 'average'
            : 'lot'
      }
  for (const list of [
    workspace.models,
    workspace.purchases,
    workspace.sales,
    workspace.writeOffs!
  ])
    if (new Set(list.map((item) => item.id)).size !== list.length)
      throw Error('Найдены повторяющиеся идентификаторы записей.')
  if (
    new Set(workspace.models.map((m) => m.name.toLocaleLowerCase('ru')))
      .size !== workspace.models.length
  )
    throw Error('Модель с таким названием уже существует.')
  const totals = [
    workspace.purchases.reduce(
      (sum, p) => sum + p.quantity * p.unitPrice + p.extra,
      0
    ),
    workspace.sales.reduce((sum, s) => sum + s.quantity * s.unitPrice, 0)
  ]
  if (totals.some((total) => total > 1_000_000_000_000))
    throw Error(
      'Сумма операций превышает поддерживаемую точность учёта (1 трлн ₽).'
    )
  const models = new Set(workspace.models.map((m) => m.id))
  if (
    [...workspace.purchases, ...workspace.sales, ...workspace.writeOffs!].some(
      (item) => !models.has(item.modelId)
    )
  )
    throw Error(
      'У операции отсутствует модель. Восстановите её или удалите связанную операцию.'
    )
  derive(workspace)
  if (
    new TextEncoder().encode(JSON.stringify(workspace)).length >
    MAX_WORKSPACE_BYTES
  )
    throw Error(
      'Учёт приблизился к лимиту облачного документа. Скачайте архив перед очисткой старых операций.'
    )
  return workspace
}
export function relatedFingerprint(workspace: Workspace, modelId: string) {
  return JSON.stringify(
    [
      ...workspace.purchases.map((item) => ({ ...item, kind: 'p' })),
      ...workspace.sales.map((item) => ({ ...item, kind: 's' })),
      ...(workspace.writeOffs ?? []).map((item) => ({ ...item, kind: 'w' }))
    ]
      .filter((item) => item.modelId === modelId)
      .map((item) => [item.kind, item.id, item.version ?? 0])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  )
}
function replace<T extends { id: string; version?: number }>(
  items: T[],
  item: T,
  expected: number | null
) {
  const current = items.find((i) => i.id === item.id)
  if (
    (expected === null && current) ||
    (expected !== null && (!current || (current.version ?? 0) !== expected))
  )
    throw new ConflictError()
  const next = { ...item, version: (expected ?? 0) + 1 }
  return current
    ? items.map((i) => (i.id === item.id ? next : i))
    : [...items, next]
}
function remove<T extends { id: string; version?: number }>(
  items: T[],
  entryId: string,
  expected: number
) {
  const current = items.find((i) => i.id === entryId)
  if (!current || (current.version ?? 0) !== expected) throw new ConflictError()
  return items.filter((i) => i.id !== entryId)
}
export const financialFingerprint = (workspace: Workspace) =>
  JSON.stringify([
    workspace.purchases,
    workspace.sales,
    workspace.writeOffs ?? []
  ])
export function applyAction(workspace: Workspace, action: Action): Workspace {
  if (
    'costingMethod' in action &&
    action.costingMethod &&
    action.costingMethod !== settingsFor(workspace).costingMethod
  )
    throw new ConflictError(
      'Метод учёта изменился на другом устройстве. Проверьте операцию перед повторной отправкой.'
    )
  let next: Workspace
  switch (action.kind) {
    case 'model/save':
      next = {
        ...workspace,
        models: replace(workspace.models, action.model, action.expected)
      }
      break
    case 'model/delete':
      if (relatedFingerprint(workspace, action.modelId) !== action.related)
        throw new ConflictError(
          'Связанные операции изменились. Проверьте их перед удалением модели.'
        )
      next = {
        ...workspace,
        models: remove(workspace.models, action.modelId, action.expected),
        purchases: workspace.purchases.filter(
          (p) => p.modelId !== action.modelId
        ),
        sales: workspace.sales.filter((s) => s.modelId !== action.modelId),
        writeOffs: (workspace.writeOffs ?? []).filter(
          (w) => w.modelId !== action.modelId
        )
      }
      break
    case 'purchase/save':
      next = {
        ...workspace,
        purchases: replace(workspace.purchases, action.entry, action.expected)
      }
      break
    case 'purchase/batch': {
      let purchases = workspace.purchases
      for (const entry of action.entries)
        purchases = replace(purchases, entry, null)
      next = { ...workspace, purchases }
      break
    }
    case 'sale/save':
      if (
        action.expected === null &&
        !action.entry.allocations?.length &&
        !(
          action.legacy === true &&
          settingsFor(workspace).costingMethod === 'average'
        )
      )
        throw Error('Выберите партию для продажи.')
      next = {
        ...workspace,
        sales: replace(workspace.sales, action.entry, action.expected)
      }
      break
    case 'writeoff/save':
      next = {
        ...workspace,
        writeOffs: replace(
          workspace.writeOffs ?? [],
          action.entry,
          action.expected
        )
      }
      break
    case 'purchase/delete':
      next = {
        ...workspace,
        purchases: remove(workspace.purchases, action.entryId, action.expected)
      }
      break
    case 'sale/delete':
      next = {
        ...workspace,
        sales: remove(workspace.sales, action.entryId, action.expected)
      }
      break
    case 'writeoff/delete':
      next = {
        ...workspace,
        writeOffs: remove(
          workspace.writeOffs ?? [],
          action.entryId,
          action.expected
        )
      }
      break
    case 'settings/save': {
      const current = settingsFor(workspace)
      if (current.version !== action.expected)
        throw new ConflictError(
          'Настройки изменились на другом устройстве. Обновите страницу.'
        )
      if (
        action.settings.costingMethod !== current.costingMethod &&
        action.ledger !== financialFingerprint(workspace)
      )
        throw new ConflictError(
          'Операции изменились. Сравните результаты пересчёта заново.'
        )
      next = {
        ...workspace,
        settings: {
          ...parseSettings(action.settings),
          version: action.expected + 1
        }
      }
      break
    }
  }
  return parseWorkspace(next)
}
export function availableForSale(
  workspace: Workspace,
  modelId: string,
  targetDate: string,
  excludeId?: string
) {
  const reduced = {
    ...workspace,
    sales: workspace.sales.filter((s) => s.id !== excludeId)
  }
  let balance = availableOn(reduced, modelId, targetDate),
    available = balance
  const days = new Map<string, number>()
  for (const p of reduced.purchases
    .filter(isActive)
    .filter((p) => p.modelId === modelId && p.date > targetDate))
    days.set(p.date, (days.get(p.date) ?? 0) + p.quantity)
  for (const e of [...reduced.sales, ...(reduced.writeOffs ?? [])]
    .filter(isActive)
    .filter((e) => e.modelId === modelId && e.date > targetDate))
    days.set(e.date, (days.get(e.date) ?? 0) - e.quantity)
  for (const [, change] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    balance += change
    available = Math.min(available, balance)
  }
  return Math.max(0, available)
}
export function availableLots(
  workspace: Workspace,
  modelId: string,
  date: string,
  excludeRef?: EntryRef
) {
  const reduced = withoutEntry(workspace, excludeRef)
  const stats = derive(reduced)
  return stats.lots
    .filter(
      (lot) => lot.purchase.modelId === modelId && lot.purchase.date <= date
    )
    .map((lot) => ({
      purchase: lot.purchase,
      remaining: lot.remaining,
      estimated: lot.estimated
    }))
    .sort(
      (a, b) =>
        (a.purchase.expiry ?? '9999-99').localeCompare(
          b.purchase.expiry ?? '9999-99'
        ) ||
        a.purchase.date.localeCompare(b.purchase.date) ||
        a.purchase.id.localeCompare(b.purchase.id)
    )
}
export function suggestAllocations(
  workspace: Workspace,
  modelId: string,
  date: string,
  quantity: number,
  excludeRef?: EntryRef,
  mode = settingsFor(workspace).lotSelection
): Allocation[] {
  if (!Number.isSafeInteger(quantity) || quantity < 1) return []
  if (mode === 'manual') return []
  const lots = availableLots(workspace, modelId, date, excludeRef).filter(
    (lot) => lot.remaining > 0 && !expiredOn(lot.purchase.expiry, date)
  )
  if (mode === 'fifo')
    lots.sort(
      (a, b) =>
        a.purchase.date.localeCompare(b.purchase.date) ||
        a.purchase.id.localeCompare(b.purchase.id)
    )
  let remaining = quantity
  const result: Allocation[] = []
  for (const lot of lots) {
    const units = Math.min(remaining, lot.remaining)
    if (units > 0) result.push({ purchaseId: lot.purchase.id, quantity: units })
    remaining -= units
    if (remaining === 0) break
  }
  return result
}
export function parseBackup(value: unknown) {
  const data = object(value)
  if (
    data.schemaVersion !== undefined &&
    data.schemaVersion !== 2 &&
    data.schemaVersion !== 3
  )
    throw Error('Неизвестная версия резервной копии. Обновите приложение.')
  return parseWorkspace('workspace' in data ? data.workspace : data)
}
export function emptyWorkspace() {
  return structuredClone(EMPTY_WORKSPACE)
}
