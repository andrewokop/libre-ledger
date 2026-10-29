import { lazy, Suspense, useMemo, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  AlertTriangle
} from 'lucide-react'
import type { derive } from './accounting'
import {
  expiredOn,
  expiryLabel,
  expirySoon,
  isActive,
  money,
  settingsFor,
  shortDate,
  today,
  type Workspace
} from './types'
import { Amount } from './ui'
import { salesFlow, type FlowMonths } from './financeFlow'

const FinanceChart = lazy(() => import('./FinanceChart'))
type Stats = ReturnType<typeof derive>

export function Overview({
  workspace,
  stats,
  onPage,
  onHistoryRange
}: {
  workspace: Workspace
  stats: Stats
  onPage: (page: 'overview' | 'inventory' | 'history' | 'settings') => void
  onHistoryRange?: (range: { start: string; end: string }) => void
}) {
  const settings = settingsFor(workspace)
  const [chartMonths, setChartMonths] = useState<FlowMonths>(
    settings.chartMonths
  )
  const [unit, setUnit] = useState<'rub' | 'quantity'>(settings.chartUnit)
  const [selected, setSelected] = useState<number | null>(null)
  const currentDate = today()
  const flow = useMemo(
    () => salesFlow(workspace, chartMonths, currentDate),
    [workspace, chartMonths, currentDate]
  )
  const selectedIndex =
    selected === null
      ? Math.max(
          0,
          flow.periods.map((period) => period.count > 0).lastIndexOf(true)
        )
      : Math.min(selected, flow.periods.length - 1)
  const point = flow.periods[selectedIndex]
  const salesQuantity = workspace.sales
    .filter(isActive)
    .reduce((sum, sale) => sum + sale.quantity, 0)
  const purchasedQuantity = workspace.purchases
    .filter(isActive)
    .reduce((sum, purchase) => sum + purchase.quantity, 0)
  const freeQuantity = workspace.sales
    .filter((sale) => isActive(sale) && sale.unitPrice === 0)
    .reduce((sum, sale) => sum + sale.quantity, 0)
  const lowStock =
    settings.lowStockThreshold > 0
      ? workspace.models
          .map((model) => ({
            model,
            quantity: stats.lots
              .filter(
                (lot) =>
                  lot.purchase.modelId === model.id &&
                  !expiredOn(lot.purchase.expiry, currentDate)
              )
              .reduce((sum, lot) => sum + lot.remaining, 0)
          }))
          .filter((item) => item.quantity <= settings.lowStockThreshold)
      : []
  const warnings = stats.lots
    .filter(
      (lot) =>
        lot.remaining > 0 &&
        (expiredOn(lot.purchase.expiry, currentDate) ||
          expirySoon(
            lot.purchase.expiry,
            settings.expiryWarningDays,
            currentDate
          ))
    )
    .sort((a, b) =>
      (a.purchase.expiry ?? '').localeCompare(b.purchase.expiry ?? '')
    )
  const metrics = [
    { id: 'profit', label: 'Прибыль', amount: stats.profit, detail: '' },
    {
      id: 'revenue',
      label: 'Продано',
      amount: stats.revenue,
      detail: `${salesQuantity} шт.${freeQuantity ? ` · бесплатно ${freeQuantity} шт.` : ''}`
    },
    {
      id: 'investments',
      label: 'Закуплено',
      amount: stats.investments,
      detail: `${purchasedQuantity} шт. · с доставкой`
    },
    {
      id: 'stockValue',
      label: 'На складе',
      amount: stats.stockValue,
      detail: `${stats.quantity} шт.`
    }
  ]
  const orderedMetrics = [...metrics].sort(
    (a, b) =>
      Number(b.id === settings.primaryMetric) -
      Number(a.id === settings.primaryMetric)
  )
  return (
    <div className="overview-content v3-overview">
      <section
        className="v3-finance"
        aria-label="Финансовые показатели за всё время"
      >
        <div className="v3-section-top">
          <h2>Финансы</h2>
          <span>За всё время</span>
        </div>
        <div className="v3-metrics">
          {orderedMetrics.map((metric) => (
            <div
              key={metric.id}
              className={`v3-metric v3-${metric.id} ${money(metric.amount).length >= 8 ? 'v3-long' : ''}`}
            >
              {metric.id === 'stockValue' ? (
                <button
                  className="v3-stock-button"
                  onClick={() => onPage('inventory')}
                >
                  <span>
                    {metric.label} <ArrowRight size={18} />
                  </span>
                  <strong>
                    <Amount value={metric.amount} />
                  </strong>
                  <small>{metric.detail}</small>
                </button>
              ) : (
                <>
                  <span>{metric.label}</span>
                  <strong>
                    <Amount value={metric.amount} />
                  </strong>
                  {metric.detail && <small>{metric.detail}</small>}
                </>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="v3-panel v3-chart-panel" aria-labelledby="flow-title">
        <div className="v3-chart-heading">
          <div>
            <h2 id="flow-title">Продажи</h2>
            <p>{flow.range}</p>
          </div>
          <div className="v3-segment" role="group" aria-label="Период графика">
            {(
              [
                [1, '1 мес.'],
                [3, '3 мес.'],
                [6, '6 мес.']
              ] as const
            ).map(([months, label]) => (
              <button
                key={months}
                aria-pressed={chartMonths === months}
                onClick={() => {
                  setChartMonths(months)
                  setSelected(null)
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="v3-chart-summary">
          <div>
            <span>За период</span>
            <strong>
              <Amount value={flow.sales} />
            </strong>
            <span>{flow.quantity} шт.</span>
          </div>
          <div className="v3-segment" role="group" aria-label="Единицы графика">
            <button
              aria-pressed={unit === 'rub'}
              onClick={() => setUnit('rub')}
            >
              ₽
            </button>
            <button
              aria-pressed={unit === 'quantity'}
              onClick={() => setUnit('quantity')}
            >
              шт.
            </button>
          </div>
        </div>
        {flow.count ? (
          <>
            <Suspense
              fallback={
                <div className="v3-chart-wrap" aria-label="Загрузка графика" />
              }
            >
              <FinanceChart
                data={flow.periods}
                unit={unit}
                selected={selectedIndex}
                onSelect={setSelected}
              />
            </Suspense>
            <div className="v3-point" aria-live="polite">
              <span>{point.range}</span>
              <strong>
                {money(point.sales)} ₽ · {point.quantity} шт.
              </strong>
              <span>
                {point.count ? `Операций: ${point.count}` : 'Нет продаж'}
              </span>
            </div>
            <label className="v3-slider">
              Выберите {chartMonths === 1 ? 'день' : 'неделю'}{' '}
              <input
                type="range"
                min="0"
                max={flow.periods.length - 1}
                value={selectedIndex}
                onChange={(event) => setSelected(Number(event.target.value))}
                aria-valuetext={`${point.range}: ${money(point.sales)} рублей, ${point.quantity} штук, операций ${point.count}`}
              />
            </label>
          </>
        ) : (
          <div className="v3-empty">За этот период продаж нет</div>
        )}
        <div className="v3-chart-foot">
          <span>
            {chartMonths === 1 ? 'По дням' : 'По неделям'} · включая бесплатные
            передачи
          </span>
          <button
            className="v3-link"
            onClick={() =>
              onHistoryRange
                ? onHistoryRange({ start: flow.start, end: flow.end })
                : onPage('history')
            }
          >
            Операции за период <ArrowRight size={18} />
          </button>
        </div>
      </section>
      {warnings.length > 0 && (
        <section className="v3-panel v3-warning" aria-labelledby="expiry-title">
          <div className="v3-section-top">
            <h2 id="expiry-title">
              <AlertTriangle size={20} /> Сроки партий
            </h2>
            <button className="v3-link" onClick={() => onPage('inventory')}>
              На склад <ArrowRight size={18} />
            </button>
          </div>
          <div className="v3-warning-list">
            {warnings.slice(0, 3).map((lot) => (
              <div key={lot.purchase.id}>
                <strong>
                  {workspace.models.find(
                    (model) => model.id === lot.purchase.modelId
                  )?.name ?? 'Товар'}
                </strong>
                <span>
                  {expiredOn(lot.purchase.expiry, currentDate)
                    ? 'Истёк'
                    : 'Годен до'}{' '}
                  {expiryLabel(lot.purchase.expiry)} · {lot.remaining} шт.
                </span>
              </div>
            ))}
          </div>
          {warnings.length > 3 && (
            <span>Ещё партий: {warnings.length - 3}</span>
          )}
        </section>
      )}
      {lowStock.length > 0 && (
        <section
          className="v3-panel v3-warning"
          aria-labelledby="low-stock-title"
        >
          <div className="v3-section-top">
            <h2 id="low-stock-title">Мало на складе</h2>
            <button className="v3-link" onClick={() => onPage('inventory')}>
              Проверить <ArrowRight size={18} />
            </button>
          </div>
          <div className="v3-warning-list">
            {lowStock.slice(0, 3).map(({ model, quantity }) => (
              <div key={model.id}>
                <strong>{model.name}</strong>
                <span>
                  {quantity
                    ? `${quantity} шт. доступно`
                    : 'Нет доступных партий'}
                </span>
              </div>
            ))}
          </div>
          {lowStock.length > 3 && (
            <span>Ещё моделей: {lowStock.length - 3}</span>
          )}
        </section>
      )}
      <section
        className="v3-panel v3-activity"
        aria-labelledby="activity-title"
      >
        <div className="v3-section-top">
          <h2 id="activity-title">Последние операции</h2>
          <button className="v3-link" onClick={() => onPage('history')}>
            Вся история <ArrowRight size={18} />
          </button>
        </div>
        <div>
          {stats.movements.slice(0, 4).map((movement) => (
            <div
              className="v3-activity-row"
              key={`${movement.type}-${movement.id}`}
            >
              <span className="v3-activity-icon">
                {movement.type === 'purchase' ? (
                  <ArrowDownLeft size={20} />
                ) : (
                  <ArrowUpRight size={20} />
                )}
              </span>
              <div>
                <strong>{movement.name}</strong>
                <span>
                  {movement.type === 'sale'
                    ? 'Продажа'
                    : movement.type === 'writeoff'
                      ? 'Списание'
                      : 'Закупка'}{' '}
                  · {movement.quantity} шт. · {shortDate(movement.date)}
                  {!isActive(movement) && ' · Отменена'}
                  {movement.type === 'sale' &&
                    movement.amount === 0 &&
                    ' · Бесплатно'}
                </span>
              </div>
              <strong className={!isActive(movement) ? 'v3-cancelled' : ''}>
                <Amount value={movement.amount} signed />
              </strong>
            </div>
          ))}
        </div>
        {!stats.movements.length && (
          <div className="v3-empty">
            Добавьте первую закупку, чтобы начать учёт.
          </div>
        )}
      </section>
    </div>
  )
}
