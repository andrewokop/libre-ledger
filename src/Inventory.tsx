import { useState, type CSSProperties } from 'react'
import { Boxes, Pencil, Plus, Trash2 } from 'lucide-react'
import type { derive } from './accounting'
import {
  expiryLabel,
  expiredOn,
  expirySoon,
  settingsFor,
  modelAccent,
  money,
  shortDate,
  type EntryRef,
  type Model,
  type Workspace
} from './types'
import { Amount } from './ui'

export function Inventory({
  workspace,
  stats,
  search,
  setSearch,
  filterModel,
  setFilterModel,
  onAddModel,
  onEdit,
  onEditModel,
  onDeleteModel,
  onSell,
  onWriteOff,
  editable = true
}: {
  workspace: Workspace
  stats: ReturnType<typeof derive>
  search: string
  setSearch: (value: string) => void
  filterModel: string
  setFilterModel: (value: string) => void
  onAddModel: () => void
  onEdit: (ref: EntryRef) => void
  onEditModel: (model: Model) => void
  onDeleteModel: (model: Model) => void
  onSell?: (modelId: string, purchaseId?: string) => void
  onWriteOff?: (modelId: string, purchaseId?: string) => void
  editable?: boolean
}) {
  const [tab, setTab] = useState<'lots' | 'models'>(
    workspace.models.length ? 'lots' : 'models'
  )
  const [expiryFilter, setExpiryFilter] = useState('all')
  const [month, setMonth] = useState('')
  const filtered = stats.lots.filter(
    (lot) =>
      lot.remaining > 0 &&
      (filterModel === 'all' || lot.purchase.modelId === filterModel) &&
      (workspace.models
        .find((m) => m.id === lot.purchase.modelId)
        ?.name.toLocaleLowerCase('ru')
        .includes(search.toLocaleLowerCase('ru').trim()) ??
        false) &&
      (expiryFilter === 'all' ||
        (expiryFilter === 'unknown' && !lot.purchase.expiry) ||
        (expiryFilter === 'expired' && expiredOn(lot.purchase.expiry)) ||
        (expiryFilter === 'soon' &&
          expirySoon(
            lot.purchase.expiry,
            settingsFor(workspace).expiryWarningDays
          )) ||
        (expiryFilter === 'exact' && lot.purchase.expiry === month))
  )
  const groups = new Map<string, typeof filtered>()
  for (const lot of filtered) {
    const key = `${lot.purchase.modelId}|${lot.purchase.expiry ?? ''}`
    groups.set(key, [...(groups.get(key) ?? []), lot])
  }
  return (
    <div className="page-stack">
      <section className="inventory-summary">
        <div>
          <span>В наличии</span>
          <strong>
            {stats.quantity}
            <small> шт.</small>
          </strong>
        </div>
        <div>
          <span>Стоимость остатка</span>
          <strong>
            <Amount value={stats.stockValue} />
          </strong>
        </div>
        <div>
          <span>Партий в наличии</span>
          <strong>{stats.lots.filter((l) => l.remaining > 0).length}</strong>
        </div>
      </section>
      <section className="panel inventory-panel">
        <div className="panel-head">
          <h2>{tab === 'models' ? 'Мои модели' : 'Остатки по срокам'}</h2>
          <button
            className="button button-quiet"
            onClick={onAddModel}
            disabled={!editable}
          >
            <Plus size={20} />
            Новая модель
          </button>
        </div>
        <div className="workspace-tabs">
          <button aria-pressed={tab === 'lots'} onClick={() => setTab('lots')}>
            Партии
          </button>
          <button
            aria-pressed={tab === 'models'}
            onClick={() => setTab('models')}
          >
            Модели <span>{workspace.models.length}</span>
          </button>
        </div>
        {tab === 'models' ? (
          <div className="model-catalog">
            {workspace.models.map((model) => (
              <div
                className="catalog-row"
                key={model.id}
                style={
                  { '--model-color': modelAccent(model.color) } as CSSProperties
                }
              >
                <span className="model-marker" />
                <div className="catalog-copy">
                  <strong>{model.name}</strong>
                  <span>
                    В наличии:{' '}
                    {stats.lots
                      .filter((l) => l.purchase.modelId === model.id)
                      .reduce((s, l) => s + l.remaining, 0)}{' '}
                    шт.
                  </span>
                </div>
                <div className="catalog-actions">
                  <button
                    className="button button-quiet"
                    onClick={() => onEditModel(model)}
                    disabled={!editable}
                  >
                    <Pencil size={18} />
                    Изменить
                  </button>
                  <button
                    className="icon-button danger-icon"
                    onClick={() => onDeleteModel(model)}
                    disabled={!editable}
                    aria-label={`Удалить модель ${model.name}`}
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
            ))}
            {!workspace.models.length && (
              <div className="empty-state">
                <Boxes size={35} />
                <strong>Добавьте первую модель</strong>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="filter-row">
              <label className="search-field">
                <input
                  aria-label="Найти модель"
                  placeholder="Найти модель"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label className="filter-select">
                <select
                  aria-label="Фильтр по модели"
                  value={filterModel}
                  onChange={(e) => setFilterModel(e.target.value)}
                >
                  <option value="all">Все модели</option>
                  {workspace.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-select">
                <select
                  aria-label="Фильтр по сроку"
                  value={expiryFilter}
                  onChange={(e) => setExpiryFilter(e.target.value)}
                >
                  <option value="all">Все сроки</option>
                  <option value="soon">Скоро истекает</option>
                  <option value="expired">Просрочено</option>
                  <option value="unknown">Срок не указан</option>
                  <option value="exact">Конкретный месяц</option>
                </select>
              </label>
              {expiryFilter === 'exact' && (
                <input
                  aria-label="Месяц срока"
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                />
              )}
            </div>
            <div className="lot-groups">
              {[...groups.entries()].map(([key, lots]) => {
                const first = lots[0],
                  model = workspace.models.find(
                    (m) => m.id === first.purchase.modelId
                  )
                return (
                  <details
                    className={`lot-group ${expiredOn(first.purchase.expiry) ? 'lot-expired' : expirySoon(first.purchase.expiry, settingsFor(workspace).expiryWarningDays) ? 'lot-soon' : ''}`}
                    key={key}
                    style={
                      {
                        '--model-color': modelAccent(model?.color ?? '#526df4')
                      } as CSSProperties
                    }
                  >
                    <summary>
                      <span>
                        <strong>{model?.name ?? 'Товар'}</strong>
                        <small>
                          {expiryLabel(first.purchase.expiry)}
                          {expiredOn(first.purchase.expiry)
                            ? ' · просрочено'
                            : expirySoon(
                                  first.purchase.expiry,
                                  settingsFor(workspace).expiryWarningDays
                                )
                              ? ' · скоро истекает'
                              : ''}
                        </small>
                      </span>
                      <span>
                        <strong>
                          {lots.reduce((s, l) => s + l.remaining, 0)} шт.
                        </strong>
                        <small>
                          <Amount
                            value={lots.reduce((s, l) => s + l.stockValue, 0)}
                          />
                        </small>
                      </span>
                    </summary>
                    {lots.map((lot) => (
                      <div className="lot-detail" key={lot.purchase.id}>
                        <span>
                          Закупка {shortDate(lot.purchase.date)} ·{' '}
                          {lot.remaining} шт. · цена{' '}
                          {money(lot.purchase.unitPrice)} ₽/шт. · доставка{' '}
                          {money(lot.purchase.extra)} ₽ ·{' '}
                          <Amount value={lot.stockValue} />
                          {lot.estimated && <small>Остаток оценочный</small>}
                        </span>
                        <div className="lot-actions">
                          <button
                            className="text-link"
                            disabled={!editable}
                            onClick={() =>
                              onSell?.(lot.purchase.modelId, lot.purchase.id)
                            }
                          >
                            Продать
                          </button>
                          <button
                            className="text-link"
                            disabled={!editable}
                            onClick={() =>
                              onWriteOff?.(
                                lot.purchase.modelId,
                                lot.purchase.id
                              )
                            }
                          >
                            Списать
                          </button>
                          <button
                            className="text-link"
                            disabled={!editable}
                            onClick={() =>
                              onEdit({ type: 'purchase', id: lot.purchase.id })
                            }
                          >
                            Изменить
                          </button>
                        </div>
                      </div>
                    ))}
                  </details>
                )
              })}
              {!groups.size && (
                <div className="empty-state">
                  <Boxes size={35} />
                  <strong>Партии не найдены</strong>
                  <span>Измените фильтры или добавьте закупку.</span>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
