import { useState } from 'react'
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronDown,
  Pencil
} from 'lucide-react'
import {
  expiryLabel,
  isActive,
  shortDate,
  type EntryRef,
  type Movement,
  type Workspace
} from './types'
import { Amount } from './ui'

export function History({
  movements,
  onEdit,
  workspace,
  initialRange
}: {
  movements: Movement[]
  onEdit: (ref: EntryRef) => void
  workspace?: Workspace
  initialRange?: { start: string; end: string }
}) {
  const [filter, setFilter] = useState<
    'all' | 'sale' | 'purchase' | 'writeoff'
  >(initialRange ? 'sale' : 'all')
  const [start, setStart] = useState(initialRange?.start ?? '')
  const [end, setEnd] = useState(initialRange?.end ?? '')
  const [status, setStatus] = useState<'all' | 'active' | 'cancelled'>('all')
  const filtered = movements.filter(
    (movement) =>
      (filter === 'all' || movement.type === filter) &&
      (!start || movement.date >= start) &&
      (!end || movement.date <= end) &&
      (status === 'all' ||
        (status === 'active' ? isActive(movement) : !isActive(movement)))
  )
  return (
    <section className="panel history-panel">
      <div className="panel-head">
        <h2>Журнал операций</h2>
        <span className="history-count">Записей: {filtered.length}</span>
      </div>
      <div className="history-filters" aria-label="Тип операции">
        {(
          [
            ['all', 'Все'],
            ['sale', 'Продажи'],
            ['purchase', 'Закупки'],
            ['writeoff', 'Списания']
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={`filter-chip ${filter === value ? 'filter-chip-active' : ''}`}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
        <label className="filter-select">
          <select
            aria-label="Статус операции"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="all">Все статусы</option>
            <option value="active">Активные</option>
            <option value="cancelled">Отменённые</option>
          </select>
          <ChevronDown size={17} />
        </label>
      </div>
      <div className="history-date-filters">
        <label>
          С{' '}
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          По{' '}
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        {(start || end) && (
          <button
            className="text-link"
            onClick={() => {
              setStart('')
              setEnd('')
            }}
          >
            Все даты
          </button>
        )}
      </div>
      <div className="table-scroll">
        <table className="data-table history-table">
          <thead>
            <tr>
              <th scope="col">Дата</th>
              <th scope="col">Операция</th>
              <th scope="col">Модель</th>
              <th scope="col">Количество</th>
              <th scope="col">Сумма</th>
              <th scope="col" aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((movement) => (
              <tr
                key={movement.id}
                className={
                  !isActive(movement) ? 'operation-cancelled' : undefined
                }
              >
                <td className="history-date">{shortDate(movement.date)}</td>
                <td className="history-type">
                  <span className={`type-badge ${movement.type}`}>
                    {movement.type === 'sale' ? (
                      <ArrowUpRight size={16} />
                    ) : (
                      <ArrowDownLeft size={16} />
                    )}
                    {movement.type === 'sale'
                      ? 'Продажа'
                      : movement.type === 'writeoff'
                        ? 'Списание'
                        : 'Закупка'}
                  </span>
                  {!isActive(movement) && (
                    <span className="cancelled-badge">Отменена</span>
                  )}
                </td>
                <td className="history-model">
                  {movement.name}
                  {movement.type === 'purchase' && 'expiry' in movement && (
                    <small className="operation-note">
                      {movement.expiry ? `Годен до: ${expiryLabel(movement.expiry)}` : 'Срок не указан'}
                    </small>
                  )}
                  {movement.type !== 'purchase' &&
                    'allocations' in movement &&
                    movement.allocations?.length &&
                    workspace && (
                      <small className="operation-note">
                        {movement.allocations
                          .map(
                            (a) =>
                              `${expiryLabel(workspace.purchases.find((p) => p.id === a.purchaseId)?.expiry)}: ${a.quantity} шт.`
                          )
                          .join(' · ')}
                      </small>
                    )}
                  {movement.type === 'writeoff' && 'reason' in movement && (
                    <small className="operation-note">{movement.reason}</small>
                  )}
                  {movement.note && (
                    <small className="operation-note">{movement.note}</small>
                  )}
                </td>
                <td className="history-quantity">{movement.quantity} шт.</td>
                <td
                  className={
                    movement.type === 'sale'
                      ? 'history-positive'
                      : 'history-negative'
                  }
                >
                  <Amount value={movement.amount} signed />
                </td>
                <td className="history-delete">
                  <button
                    className="text-link"
                    aria-label={`Изменить ${movement.type === 'sale' ? 'продажу' : movement.type === 'writeoff' ? 'списание' : 'закупку'} ${movement.name}`}
                    onClick={() =>
                      onEdit({ type: movement.type, id: movement.id })
                    }
                  >
                    <Pencil size={17} />
                    Изменить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <div className="empty-state">
            <ArrowLeftRight size={35} />
            <strong>{movements.length ? 'По этим условиям операций нет' : 'Здесь пока нет записей'}</strong>
            <span>{movements.length ? 'Измените фильтры или посмотрите всю историю.' : 'Операции появятся после добавления закупки или продажи.'}</span>
            {movements.length > 0 && (
              <button className="text-link" onClick={() => {
                setFilter('all')
                setStatus('all')
                setStart('')
                setEnd('')
              }}>Сбросить фильтры</button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
