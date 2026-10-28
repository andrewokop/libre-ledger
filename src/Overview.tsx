import { lazy, Suspense, useMemo, useState, type CSSProperties } from 'react'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Boxes, ChevronRight, PackageOpen, TrendingUp } from 'lucide-react'
import type { derive } from './accounting'
import { isActive, modelAccent, money, shortDate, today, type Workspace } from './types'
import { Amount } from './ui'
import { financeFlow, type FlowMonths } from './financeFlow'

const FinanceChart = lazy(() => import('./FinanceChart'))
type Stats = ReturnType<typeof derive>

export function Overview({ workspace, stats, onPage }: {
  workspace: Workspace
  stats: Stats
  onPage: (page: 'overview' | 'inventory' | 'history' | 'settings') => void
}) {
  const [chartMonths, setChartMonths] = useState<FlowMonths>(1)
  const stock = workspace.models.map((model) => ({
    ...model, color: modelAccent(model.color),
    quantity: stats.lots.filter((lot) => lot.purchase.modelId === model.id).reduce((sum, lot) => sum + lot.remaining, 0),
    average: stats.averageCosts.get(model.id) ?? 0,
  }))
  const currentDate = today()
  const flow = useMemo(() => financeFlow(workspace, chartMonths, currentDate), [workspace, chartMonths, currentDate])
  const chartSales = flow.sales
  const chartExpenses = flow.expenses
  const activeLots = stats.lots.filter((lot) => lot.remaining > 0).length

  return <div className={`overview-content ${[stats.revenue, stats.profit, stats.stockValue, chartSales, chartExpenses].some((amount) => money(amount).length > 12) ? 'overview-long-values' : ''}`} >
    <section className="finance-stage" aria-label="Финансовые показатели за всё время">
      <div className="finance-stage-head"><span>Финансовая картина</span><span className="period-label">За всё время</span></div>
      <div className="finance-revenue"><span className="finance-label"><TrendingUp size={19} />Прибыль от продаж</span><strong style={{ '--amount-length': money(stats.profit).length + 2, color: '#533a85' } as CSSProperties}><Amount value={stats.profit} /></strong><span className="finance-detail">Оборот минус закупочная стоимость и доставка проданных товаров.</span></div>
      <div className="finance-profit"><span className="finance-label">Оборот продаж</span><strong className="revenue-value" style={{ '--amount-length': money(stats.revenue).length + 2, color: '#2f409a' } as CSSProperties}><Amount value={stats.revenue} /></strong><span className="finance-detail">Сумма всех продаж до вычета себестоимости.</span><span className="finance-sales-count">Продано {workspace.sales.filter(isActive).reduce((sum, sale) => sum + sale.quantity, 0)} шт.</span></div>
      <button className="finance-capital" onClick={() => onPage('inventory')}><span className="finance-label"><Boxes size={19} />Стоимость остатков<ChevronRight size={17} /></span><strong style={{ '--amount-length': money(stats.stockValue).length + 2 } as CSSProperties}><Amount value={stats.stockValue} /></strong><span className="finance-detail">Закупочная стоимость и доставка товара, который ещё на складе.</span></button>
    </section>

    <div className="overview-grid">
      <section className="panel chart-panel" aria-labelledby="flow-title">
        <div className="panel-head"><div><h2 id="flow-title">Продажи и закупки</h2><p className="flow-range">{flow.range}</p></div><div className="segmented-control" role="group" aria-label="Период графика">{([[1, '1 месяц'], [3, '3 месяца'], [6, '6 месяцев']] as const).map(([months, label]) => <button key={months} aria-pressed={chartMonths === months} onClick={() => setChartMonths(months)}>{label}</button>)}</div></div>
        <div className="chart-totals"><div><span><i className="legend-dot legend-sales" />Продажи</span><strong><Amount value={chartSales} /></strong></div><div><span><i className="legend-dot legend-expenses" />Закупки и доставка</span><strong><Amount value={chartExpenses} /></strong></div></div>
        <p className="flow-caption">{chartMonths === 1 ? 'Текущий месяц по неделям' : 'Сравнение по месяцам'}. Суммы в рублях.</p>
        {chartSales || chartExpenses ? <Suspense fallback={<div className="chart-placeholder" aria-label="Загрузка графика" />}><FinanceChart data={flow.periods} /></Suspense> : <div className="chart-empty"><ArrowLeftRightGraphic /><strong>За этот период операций нет</strong><span>Выберите другой период или добавьте операцию.</span></div>}
        <div className="chart-foot"><span>Продажи минус закупки</span><strong className={chartSales - chartExpenses >= 0 ? 'positive-text' : 'negative-text'}><Amount value={chartSales - chartExpenses} signed /></strong></div>
        <p className="flow-explanation">Здесь закупки учтены целиком, включая товар на складе. Прибыль только от проданных товаров показана выше.</p>
        {(chartSales > 0 || chartExpenses > 0) && <details className="flow-data"><summary>Точные суммы {chartMonths === 1 ? 'по неделям' : 'по месяцам'}</summary><table className="flow-table"><caption>{flow.range}</caption><thead><tr><th scope="col">Период</th><th scope="col">Продажи</th><th scope="col">Закупки и доставка</th></tr></thead><tbody>{flow.periods.map((period) => <tr key={period.key}><th scope="row">{period.range}</th><td data-label="Продажи"><span><Amount value={period.sales} /></span></td><td data-label="Закупки и доставка"><span><Amount value={period.expenses} /></span></td></tr>)}</tbody></table></details>}
      </section>

      <section className="stock-panel" aria-labelledby="stock-title">
        <div className="panel-head"><h2 id="stock-title">На складе</h2><span className="stock-illustration"><Boxes size={28} strokeWidth={1.5} /></span></div>
        <div className="stock-total"><strong>{stats.quantity}</strong><span>единиц товара<br />в наличии</span><span className="stock-batch-count">{activeLots} партий</span></div>
        <div className="stock-distribution" aria-label="Количество шт. по моделям">{stock.filter((model) => model.quantity > 0).map((model) => <span key={model.id} style={{ flex: model.quantity, background: model.color }} title={`${model.name}: ${model.quantity} шт.`} />)}</div>
        <div className="stock-list">{stock.map((model) => <div className="stock-row" key={model.id} style={{ '--model-color': model.color } as CSSProperties}><span className="model-token">{model.name.slice(0, 2).toUpperCase()}</span><div className="stock-name"><strong>{model.name}</strong><span>{model.quantity ? `${money(model.average)} ₽ / шт.` : 'Нет в наличии'}</span></div><strong className={`stock-quantity ${model.quantity <= 3 ? 'stock-low' : ''}`}>{model.quantity}<small> шт.</small></strong></div>)}</div>
        <button className="stock-link" onClick={() => onPage('inventory')}>Управлять складом<ArrowRight size={19} /></button>
      </section>
    </div>

    <section className="lots-section" aria-labelledby="lots-title"><div className="section-head"><div><h2 id="lots-title">Вложения возвращаются</h2><p>Последние закупки и их окупаемость</p></div><button className="text-link" onClick={() => onPage('inventory')}>Все партии <ArrowUpRight size={19} /></button></div>
      <div className="lot-cards">{stats.lots.slice(0, 3).map((lot) => {
        const model = workspace.models.find((item) => item.id === lot.purchase.modelId)
        const invested = lot.purchase.quantity * lot.purchase.unitPrice + lot.purchase.extra
        const returned = invested ? lot.revenue / invested * 100 : 0
        return <button className="lot-card" key={lot.purchase.id} onClick={() => onPage('inventory')} style={{ '--model-color': modelAccent(model?.color ?? '#526df4') } as CSSProperties}><div className="lot-card-head"><span className="model-marker" /><strong>{model?.name ?? 'Товар'}</strong><ArrowUpRight size={18} /></div><span className="lot-date">Закупка {shortDate(lot.purchase.date)}</span><div className="lot-payback"><strong>{Math.round(returned)}<span>%</span></strong><span>{returned >= 100 ? 'вложения вернулись' : 'вложений вернулось'}</span></div><div className="progress-track"><span style={{ width: `${Math.min(returned, 100)}%` }} /></div><div className="lot-card-bottom"><span>Вернулось <b>{money(lot.revenue)} ₽</b></span><span>Вложено <b>{money(invested)} ₽</b></span></div></button>
      })}</div>{!stats.lots.length && <div className="empty-state"><PackageOpen size={35} /><strong>Добавьте первую закупку</strong><span>Здесь будут остатки и возврат вложений по партиям.</span></div>}
    </section>

    <section className="panel activity-panel" aria-labelledby="activity-title"><div className="panel-head"><h2 id="activity-title">Последние операции</h2><button className="text-link" onClick={() => onPage('history')}>Вся история <ArrowUpRight size={19} /></button></div><div className="activity-list">{stats.movements.slice(0, 4).map((movement) => <div className="activity-row" key={movement.id}><span className={`activity-icon ${movement.type === 'sale' ? 'activity-sale' : 'activity-buy'}`}>{movement.type === 'sale' ? <ArrowUpRight size={22} /> : <ArrowDownLeft size={22} />}</span><div className="activity-copy"><strong>{movement.name}</strong><span>{movement.type === 'sale' ? 'Продажа' : 'Закупка'} · {movement.quantity} шт. · {shortDate(movement.date)}{!isActive(movement) && ' · Отменена'}</span></div><strong className={`activity-amount ${!isActive(movement) ? 'cancelled-amount' : ''} ${movement.type === 'sale' ? 'positive-text' : 'negative-text'}`}><Amount value={movement.amount} signed /></strong></div>)}</div>{!stats.movements.length && <div className="empty-state"><ArrowLeftRightGraphic /><strong>Первая запись ещё впереди</strong><span>Добавьте закупку, чтобы начать учёт.</span></div>}</section>
  </div>
}

function ArrowLeftRightGraphic() { return <svg width="32" height="32" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M5 9h18m-5-5 5 5-5 5M23 19H5m5-5-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg> }
