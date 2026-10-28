import { hasStockForSales, availableOn } from './accounting'
import { EMPTY_WORKSPACE, isActive, today, type Model, type Purchase, type Sale, type Workspace } from './types'

export const SCHEMA_VERSION = 2
export const MAX_WORKSPACE_BYTES = 750_000
export type Action =
  | { id: string; kind: 'model/save'; model: Model; expected: number | null }
  | { id: string; kind: 'model/delete'; modelId: string; expected: number; related: string }
  | { id: string; kind: 'purchase/save'; entry: Purchase; expected: number | null }
  | { id: string; kind: 'sale/save'; entry: Sale; expected: number | null }
  | { id: string; kind: 'purchase/delete' | 'sale/delete'; entryId: string; expected: number }

export class ConflictError extends Error {
  constructor(message = 'Эта запись изменилась на другом устройстве. Обновите данные перед редактированием.') { super(message); this.name = 'ConflictError' }
}
export class GenerationError extends Error {
  constructor() { super('Учёт был очищен или заменён на другом устройстве. Старые изменения не отправлены.'); this.name = 'GenerationError' }
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректный формат данных.')
  return value as Record<string, unknown>
}
const text = (value: unknown, max: number, label: string, allowEmpty = false) => {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`Проверьте поле «${label}» (до ${max} символов).`)
  return value.trim()
}
const number = (value: unknown, label: string, integer = false) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000_000 || (integer && (!Number.isSafeInteger(value) || value < 1)) || (!integer && Math.abs(value * 100 - Math.round(value * 100)) > .00001)) throw new Error(`Проверьте поле «${label}»: ${integer ? 'нужно целое положительное число' : 'нужна сумма от 0 до 100 000 000 ₽ с точностью до копейки'}.`)
  return value
}
function date(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Укажите дату операции.')
  const parsed = new Date(`${value}T12:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < '2000-01-01' || value > today()) throw new Error('Дата должна существовать и не быть в будущем.')
  return value
}
function version(value: unknown) {
  if (value === undefined) return 0
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Повреждена версия записи.')
  return value
}
function entry(value: unknown) {
  const item = object(value)
  if (item.status !== undefined && item.status !== 'active' && item.status !== 'cancelled') throw new Error('Неизвестный статус операции.')
  return { id: text(item.id, 100, 'Идентификатор'), modelId: text(item.modelId, 100, 'Модель'), date: date(item.date), quantity: number(item.quantity, 'Количество', true), unitPrice: number(item.unitPrice, 'Цена'), status: item.status === 'cancelled' ? 'cancelled' as const : 'active' as const, note: text(item.note ?? '', 500, 'Комментарий', true), version: version(item.version) }
}
export function parseWorkspace(value: unknown): Workspace {
  const data = object(value)
  if (!Array.isArray(data.models) || !Array.isArray(data.purchases) || !Array.isArray(data.sales)) throw new Error('Файл должен содержать модели, закупки и продажи.')
  if (data.models.length > 100 || data.purchases.length + data.sales.length > 3000) throw new Error('Превышен лимит: 100 моделей или 3000 операций в рабочем пространстве.')
  const workspace: Workspace = {
    models: data.models.map((value) => {
      const model = object(value)
      const color = text(model.color, 7, 'Цвет')
      if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('Укажите корректный цвет модели.')
      return { id: text(model.id, 100, 'Идентификатор'), name: text(model.name, 120, 'Название модели'), color, version: version(model.version) }
    }),
    purchases: data.purchases.map((value) => ({ ...entry(value), extra: number(object(value).extra, 'Доставка'), sold: 0 })),
    sales: data.sales.map((value) => ({ ...entry(value), costBasis: 0 })),
  }
  for (const list of [workspace.models, workspace.purchases, workspace.sales]) {
    if (new Set(list.map((item) => item.id)).size !== list.length) throw new Error('Найдены повторяющиеся идентификаторы записей.')
  }
  if (new Set(workspace.models.map((model) => model.name.toLocaleLowerCase('ru'))).size !== workspace.models.length) throw new Error('Модель с таким названием уже существует.')
  const totals = [workspace.purchases.reduce((sum, item) => sum + item.quantity * item.unitPrice + item.extra, 0), workspace.sales.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)]
  if (totals.some((value) => value > 1_000_000_000_000)) throw new Error('Сумма операций превышает поддерживаемую точность учёта (1 трлн ₽).')
  const modelIds = new Set(workspace.models.map((model) => model.id))
  if ([...workspace.purchases, ...workspace.sales].some((item) => !modelIds.has(item.modelId))) throw new Error('У операции отсутствует модель. Восстановите её или удалите связанную операцию.')
  if (!hasStockForSales(workspace)) throw new Error('Изменение создаст отрицательный остаток. Проверьте даты и количество, включая более поздние продажи.')
  if (new TextEncoder().encode(JSON.stringify(workspace)).length > MAX_WORKSPACE_BYTES) throw new Error('Учёт приблизился к лимиту облачного документа. Скачайте архив перед очисткой старых операций.')
  return workspace
}
export function relatedFingerprint(workspace: Workspace, modelId: string) {
  return JSON.stringify([...workspace.purchases.map((item) => ({ ...item, kind: 'p' })), ...workspace.sales.map((item) => ({ ...item, kind: 's' }))].filter((item) => item.modelId === modelId).map((item) => [item.kind, item.id, item.version ?? 0]).sort((a, b) => String(a[1]).localeCompare(String(b[1]))))
}
function replace<T extends { id: string; version?: number }>(items: T[], item: T, expected: number | null): T[] {
  const current = items.find((candidate) => candidate.id === item.id)
  if ((expected === null && current) || (expected !== null && (!current || (current.version ?? 0) !== expected))) throw new ConflictError()
  const next = { ...item, version: (expected ?? 0) + 1 }
  return current ? items.map((candidate) => candidate.id === item.id ? next : candidate) : [...items, next]
}
function remove<T extends { id: string; version?: number }>(items: T[], entryId: string, expected: number) {
  const current = items.find((item) => item.id === entryId)
  if (!current || (current.version ?? 0) !== expected) throw new ConflictError()
  return items.filter((item) => item.id !== entryId)
}
export function applyAction(workspace: Workspace, action: Action): Workspace {
  let next: Workspace
  switch (action.kind) {
    case 'model/save': next = { ...workspace, models: replace(workspace.models, action.model, action.expected) }; break
    case 'model/delete': {
      if (relatedFingerprint(workspace, action.modelId) !== action.related) throw new ConflictError('Связанные операции изменились. Проверьте их перед удалением модели.')
      next = { models: remove(workspace.models, action.modelId, action.expected), purchases: workspace.purchases.filter((item) => item.modelId !== action.modelId), sales: workspace.sales.filter((item) => item.modelId !== action.modelId) }; break
    }
    case 'purchase/save': next = { ...workspace, purchases: replace(workspace.purchases, action.entry, action.expected) }; break
    case 'sale/save': next = { ...workspace, sales: replace(workspace.sales, action.entry, action.expected) }; break
    case 'purchase/delete': next = { ...workspace, purchases: remove(workspace.purchases, action.entryId, action.expected) }; break
    case 'sale/delete': next = { ...workspace, sales: remove(workspace.sales, action.entryId, action.expected) }; break
  }
  return parseWorkspace(next)
}
export function availableForSale(workspace: Workspace, modelId: string, targetDate: string, excludeId?: string) {
  const reduced = { ...workspace, sales: workspace.sales.filter((sale) => sale.id !== excludeId) }
  let balance = availableOn(reduced, modelId, targetDate)
  let available = balance
  const days = new Map<string, number>()
  for (const purchase of reduced.purchases.filter(isActive).filter((item) => item.modelId === modelId && item.date > targetDate)) days.set(purchase.date, (days.get(purchase.date) ?? 0) + purchase.quantity)
  for (const sale of reduced.sales.filter(isActive).filter((item) => item.modelId === modelId && item.date > targetDate)) days.set(sale.date, (days.get(sale.date) ?? 0) - sale.quantity)
  for (const [, change] of [...days].sort(([a], [b]) => a.localeCompare(b))) { balance += change; available = Math.min(available, balance) }
  return Math.max(0, available)
}
export function parseBackup(value: unknown) {
  const data = object(value)
  return parseWorkspace('workspace' in data ? data.workspace : data)
}
export function emptyWorkspace() { return structuredClone(EMPTY_WORKSPACE) }
