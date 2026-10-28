import { lazy, Suspense, useMemo, useState, type CSSProperties } from 'react'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Boxes, ChevronRight, CircleHelp, PackageOpen, TrendingUp } from 'lucide-react'
import type { derive } from './accounting'
import { isActive, modelAccent, money, shortDate, today, type Workspace } from './types'
import { Amount } from './ui'

const FinanceChart = lazy(() => import('./FinanceChart'))
type Stats = ReturnType<typeof derive>

export function Overview({ workspace, stats, onPage }: {
  workspace: Workspace
  stats: Stats
  onPage: (page: 'overview' | 'inventory' | 'history' | 'settings') => void
}) {
  const [chartMode, setChartMode] = useState<'days' | 'months'>('days')
  const [showFlowHelp, setShowFlowHelp] = useState(false)
  const margin = stats.revenue ? stats.profit / stats.revenue * 100 : 0
  const stock = workspace.models.map((model) => ({
    ...model, color: modelAccent(model.color),
    quantity: stats.lots.filter((lot) => lot.purchase.modelId === model.id).reduce((sum, lot) => sum + lot.remaining, 0),
    average: stats.averageCosts.get(model.id) ?? 0,
  }))
  const chart = useMemo(() => {
    const end = new Date(`${today()}T12:00:00`)
    const periods = Array.from({ length: chartMode === 'days' ? 14 : 6 }, (_, index) => {
      const date = new Date(end)
      if (chartMode === 'days') date.setDate(end.getDate() - 13 + index)
      else { date.setDate(1); date.setMonth(end.getMonth() - 5 + index) }
      const key = date.toLocaleDateString('en-CA').slice(0, chartMode === 'days' ? 10 : 7)
      return { key, month: new Intl.DateTimeFormat('ru-RU', chartMode === 'days' ? { day: 'numeric', month: 'short' } : { month: 'short' }).format(date).replace('.', ''), sales: 0, expenses: 0 }
    })
    const byKey = new Map(periods.map((period) => [period.key, period]))
    for (const sale of workspace.sales.filter(isActive)) {
      const period = byKey.get(sale.date.slice(0, chartMode === 'days' ? 10 : 7))
      if (period) period.sales += sale.quantity * sale.unitPrice
    }
    for (const purchase of workspace.purchases.filter(isActive)) {
      const period = byKey.get(purchase.date.slice(0, chartMode === 'days' ? 10 : 7))
      if (period) period.expenses += purchase.quantity * purchase.unitPrice + purchase.extra
    }
    return periods
  }, [workspace, chartMode])
  const chartSales = chart.reduce((sum, item) => sum + item.sales, 0)
  const chartExpenses = chart.reduce((sum, item) => sum + item.expenses, 0)
  const activeLots = stats.lots.filter((lot) => lot.remaining > 0).length

  return <div className={`overview-content ${[stats.revenue, stats.profit, stats.stockValue, chartSales, chartExpenses].some((amount) => money(amount).length > 12) ? 'overview-long-values' : ''}`} >
    <section className="finance-stage" aria-label="Финансовые показатели за всё время">
      <div className="finance-stage-head"><span>Финансовая картина</span><span className="period-label">За всё время</span></div>
      <div className="finance-revenue"><span className="finance-label">Выручка</span><strong className="revenue-value" style={{ '--amount-length': money(stats.revenue).length + 2 } as CSSProperties}><Amount value={stats.revenue} /></strong><span className="finance-detail">Продано {workspace.sales.filter(isActive).reduce((sum, sale) => sum + sale.quantity, 0)} шт.</span></div>
      <div className="finance-profit"><span className="finance-label"><TrendingUp size={19} />Прибыль от продаж</span><strong style={{ '--amount-length': money(stats.profit).length + 2 } as CSSProperties}><Amount value={stats.profit} /></strong><span className="finance-detail">После себестоимости товара</span></div>
      <button className="finance-capital" onClick={() => onPage('inventory')}><span className="finance-label"><Boxes size={19} />Деньги в товаре<ChevronRight size={17} /></span><strong style={{ '--amount-length': money(stats.stockValue).length + 2 } as CSSProperties}><Amount value={stats.stockValue} /></strong><span className="finance-detail">Вложено в текущие остатки</span></button>
      <div className="revenue-composition"><div className="composition-bar" aria-label={`Прибыль составляет ${margin.toFixed(1)}% выручки`}><span style={{ width: `${Math.max(0, Math.min(margin, 100))}%` }} /></div><div className="composition-labels"><span><i />Себестоимость <b>{money(stats.cogs)} ₽</b></span><span><i />Маржинальность <b>{margin.toFixed(1).replace('.', ',')}%</b></span></div></div>
    </section>

    <div className="overview-grid">
      <section className="panel chart-panel" aria-labelledby="flow-title">
        <div className="panel-head"><h2 id="flow-title">Движение денег</h2><div className="segmented-control" aria-label="Период графика"><button aria-pressed={chartMode === 'days'} onClick={() => setChartMode('days')}>14 дней</button><button aria-pressed={chartMode === 'months'} onClick={() => setChartMode('months')}>6 месяцев</button></div></div>
        <div className="chart-totals"><div><span><i className="legend-dot legend-sales" />Продажи</span><strong><Amount value={chartSales} /></strong></div><div><span><i className="legend-dot legend-expenses" />Закупки</span><strong><Amount value={chartExpenses} /></strong></div></div>
        {chartSales || chartExpenses ? <Suspense fallback={<div className="chart-placeholder" aria-label="Загрузка графика" />}><FinanceChart data={chart} /></Suspense> : <div className="chart-empty"><ArrowLeftRightGraphic /><strong>В этом периоде пока тихо</strong><span>Ваши продажи и закупки появятся здесь.</span></div>}
        <div className="chart-foot"><button className="flow-help" aria-expanded={showFlowHelp} aria-controls="flow-help" onClick={() => setShowFlowHelp(!showFlowHelp)}>Разница за период <CircleHelp size={17} /></button><strong className={chartSales - chartExpenses >= 0 ? 'positive-text' : 'negative-text'}><Amount value={chartSales - chartExpenses} signed /></strong></div>
        {showFlowHelp && <p id="flow-help" className="flow-explanation">Продажи минус закупки и доставка за выбранный период. Разница может быть отрицательной, пока деньги находятся в товаре. Прибыль от продаж показана выше.</p>}
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
