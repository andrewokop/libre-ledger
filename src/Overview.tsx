import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Boxes, CircleHelp, Plus, TrendingUp, Wallet } from 'lucide-react'
import type { derive } from './App'
import { money, shortDate, today, type Model, type Workspace } from './types'

const FinanceChart = lazy(() => import('./FinanceChart'))
const currency = (value: number) => `${money(value)} ₽`
type Stats = ReturnType<typeof derive>

export function Overview({ workspace, stats, onPage, onSale }: {
  workspace: Workspace
  stats: Stats
  onPage: (page: 'overview' | 'inventory' | 'history' | 'settings') => void
  onSale: () => void
}) {
  const [chartMode, setChartMode] = useState<'days' | 'months'>('days')
  const margin = stats.revenue ? stats.profit / stats.revenue * 100 : 0
  const stock = workspace.models.map((model) => ({
    ...model,
    quantity: stats.lots.filter((lot) => lot.purchase.modelId === model.id).reduce((sum, lot) => sum + lot.remaining, 0),
    average: stats.averageCosts.get(model.id) ?? 0,
  }))
  const chart = useMemo(() => {
    const end = new Date(`${today()}T12:00:00`)
    const periods = Array.from({ length: chartMode === 'days' ? 14 : 6 }, (_, index) => {
      const date = new Date(end)
      if (chartMode === 'days') date.setDate(end.getDate() - 13 + index)
      else { date.setDate(1); date.setMonth(end.getMonth() - 5 + index) }
      const key = chartMode === 'days' ? date.toLocaleDateString('en-CA') : date.toLocaleDateString('en-CA').slice(0, 7)
      return { key, month: new Intl.DateTimeFormat('ru-RU', chartMode === 'days' ? { day: 'numeric', month: 'short' } : { month: 'short' }).format(date).replace('.', ''), sales: 0, expenses: 0 }
    })
    for (const sale of workspace.sales) {
      const period = periods.find((item) => item.key === (chartMode === 'days' ? sale.date : sale.date.slice(0, 7)))
      if (period) period.sales += sale.quantity * sale.unitPrice
    }
    for (const purchase of workspace.purchases) {
      const period = periods.find((item) => item.key === (chartMode === 'days' ? purchase.date : purchase.date.slice(0, 7)))
      if (period) period.expenses += purchase.quantity * purchase.unitPrice + purchase.extra
    }
    return periods
  }, [workspace, chartMode])
  const chartSales = chart.reduce((sum, item) => sum + item.sales, 0)
  const chartExpenses = chart.reduce((sum, item) => sum + item.expenses, 0)

  return <>
    <div className="section-caption"><span>Главное в цифрах</span><span className="period-label">За всё время</span></div>
    <section className="metrics-grid" aria-label="Основные показатели за всё время">
      <Metric icon={<TrendingUp size={19} />} label="Прибыль от продаж" value={currency(stats.profit)} note="Выручка минус себестоимость" tone="profit" detail={`Маржинальность ${margin.toFixed(1).replace('.', ',')}%`} />
      <Metric icon={<Wallet size={19} />} label="Выручка" value={currency(stats.revenue)} note={`${workspace.sales.length} операций продажи`} tone="revenue" detail="Все поступления от продаж" />
      <Metric icon={<Boxes size={19} />} label="Деньги в товаре" value={currency(stats.stockValue)} note="Стоимость текущих остатков" tone="capital" detail="С учётом доставки" />
      <Metric icon={<ArrowDownLeft size={19} />} label="На складе" value={`${stats.quantity} шт.`} note={`${stats.lots.filter((lot) => lot.remaining > 0).length} активных партий`} tone="stock" detail={`Моделей в наличии: ${stock.filter((model) => model.quantity > 0).length}`} />
    </section>

    <section className="overview-grid">
      <div className="panel chart-panel">
        <div className="panel-head"><div><div className="panel-kicker">ФИНАНСЫ В ДВИЖЕНИИ</div><h2>Пришло. Ушло.</h2></div><div className="segmented-control" aria-label="Период графика"><button aria-pressed={chartMode === 'days'} onClick={() => setChartMode('days')}>14 дней</button><button aria-pressed={chartMode === 'months'} onClick={() => setChartMode('months')}>6 месяцев</button></div></div>
        <div className="chart-totals"><div><span><i className="legend-dot legend-sales" />Продажи</span><strong>{currency(chartSales)}</strong></div><div><span><i className="legend-dot legend-expenses" />Закупки и доставка</span><strong>{currency(chartExpenses)}</strong></div></div>
        {chartSales || chartExpenses ? <Suspense fallback={<div className="chart-placeholder" aria-label="Загрузка графика" />}><FinanceChart data={chart} /></Suspense> : <div className="chart-empty"><ArrowLeftRightGraphic /><strong>Здесь появится движение денег</strong><span>В выбранном периоде пока нет операций</span></div>}
        <div className="chart-foot"><span>Денежный поток за период <span className="help-hint" title="Выручка минус все расходы на закупки за выбранный период. Может быть отрицательным, пока вложения находятся в товаре." tabIndex={0}><CircleHelp size={14} /></span></span><strong className={chartSales - chartExpenses >= 0 ? 'positive-text' : 'negative-text'}>{chartSales - chartExpenses > 0 ? '+' : ''}{currency(chartSales - chartExpenses)}</strong></div>
      </div>

      <div className="panel stock-panel">
        <div className="panel-head"><div><div className="panel-kicker">ГОТОВО К ПРОДАЖЕ</div><h2>На полках</h2></div><button className="icon-button panel-more" aria-label="Открыть склад" onClick={() => onPage('inventory')}><ArrowUpRight size={20} /></button></div>
        <div className="stock-total"><strong>{stats.quantity}</strong><span>сенсоров<br />в наличии</span><span className="stock-total-icon"><Boxes size={34} strokeWidth={1.2} /></span></div>
        <div className="stock-distribution" aria-label="Распределение остатков по моделям">{stock.filter((model) => model.quantity > 0).map((model) => <span key={model.id} style={{ flex: model.quantity, background: model.color }} title={`${model.name}: ${model.quantity} шт.`} />)}</div>
        <div className="stock-list">{stock.map((model) => <div className="stock-row" key={model.id}><span className="model-marker" style={{ background: model.color }} /><div className="stock-name"><strong>{model.name.replace('FreeStyle ', '')}</strong><span>{model.quantity ? `${currency(model.average)} / шт. · себестоимость` : 'Нет в наличии'}</span></div><strong className={`stock-quantity ${model.quantity <= 3 ? 'stock-low' : ''}`}>{model.quantity}<small> шт.</small></strong></div>)}</div>
        <button className="text-link stock-link" onClick={() => onPage('inventory')}>Открыть склад <ArrowRight size={16} /></button>
      </div>
    </section>

    <section className="lower-grid">
      <div className="panel lots-panel"><div className="panel-head"><div><div className="panel-kicker">ВОЗВРАТ ВЛОЖЕНИЙ</div><h2>Как окупаются партии</h2></div><button className="text-link" onClick={() => onPage('inventory')}>Все партии <ArrowUpRight size={15} /></button></div><div className="table-scroll"><table className="data-table lots-table"><thead><tr><th scope="col">МОДЕЛЬ / ЗАКУПКА</th><th scope="col">ОСТАТОК</th><th scope="col">ВЛОЖЕНО</th><th scope="col">ВЕРНУЛОСЬ</th><th scope="col">ОКУПАЕМОСТЬ</th></tr></thead><tbody>{stats.lots.slice(0, 4).map((lot) => <LotRow key={lot.purchase.id} lot={lot} model={workspace.models.find((model) => model.id === lot.purchase.modelId)} />)}</tbody></table>{!stats.lots.length && <div className="empty-state"><Boxes size={26} /><strong>Всё начинается с первой закупки</strong><span>Добавьте её кнопкой «Закупка» вверху страницы</span></div>}</div><div className="table-foot"><span>Возврат = выручка от партии ÷ вложения</span><span>{stats.lots.length} партий всего</span></div></div>
      <div className="panel activity-panel"><div className="panel-head"><div><div className="panel-kicker">ЛЕНТА МАГАЗИНА</div><h2>Последние операции</h2></div><span className="activity-live" title="Записи из вашего учёта" /></div><div className="activity-list">{stats.movements.slice(0, 4).map((movement) => <div className="activity-row" key={movement.id}><span className={`activity-icon ${movement.type === 'sale' ? 'activity-sale' : 'activity-buy'}`}>{movement.type === 'sale' ? <ArrowUpRight size={17} /> : <ArrowDownLeft size={17} />}</span><div className="activity-copy"><strong>{movement.name.replace('FreeStyle ', '')}</strong><span>{movement.type === 'sale' ? 'Продажа' : 'Закупка'} · {movement.quantity} шт. · {shortDate(movement.date)}</span></div><span className={movement.type === 'sale' ? 'activity-amount plus' : 'activity-amount minus'}>{movement.type === 'sale' ? '+' : '−'}{currency(Math.abs(movement.amount))}</span></div>)}</div>{!stats.movements.length && <div className="empty-state"><Wallet size={26} /><strong>Пока без записей</strong><span>Новые операции появятся здесь</span></div>}<div className="activity-actions"><button className="text-link" onClick={() => onPage('history')}>Вся история <ArrowRight size={15} /></button>{stats.quantity > 0 && <button className="activity-add" onClick={onSale} aria-label="Записать продажу"><Plus size={17} /></button>}</div></div>
    </section>
    <div className="insight-strip"><span className="insight-icon"><CheckGraphic /></span><span><strong>Себестоимость уже посчитана.</strong> Средняя цена закупки и доставка учитываются автоматически.</span><button onClick={() => onPage('settings')}>Как это работает <ArrowUpRight size={15} /></button></div>
  </>
}

function Metric({ icon, label, value, note, tone, detail }: { icon: ReactNode; label: string; value: string; note: string; tone: string; detail: string }) {
  return <div className={`metric-card metric-${tone}`}><div className="metric-top"><span className="metric-label">{label}</span><span className="metric-icon">{icon}</span></div><strong className="metric-value">{value}</strong><span className="metric-note">{note}</span><div className="metric-bottom">{tone === 'profit' && <span className="margin-dot" />}{detail}</div></div>
}

function LotRow({ lot, model }: { lot: Stats['lots'][number]; model?: Model }) {
  const invested = lot.purchase.quantity * lot.purchase.unitPrice + lot.purchase.extra
  const returned = invested ? lot.revenue / invested * 100 : 0
  return <tr><td><div className="lot-model-cell"><span className="model-marker" style={{ background: model?.color ?? '#9b9f98' }} /><span><strong>{model?.name.replace('FreeStyle ', '') ?? 'Сенсор'}</strong><small>{shortDate(lot.purchase.date)} · {lot.purchase.quantity} шт.</small></span></div></td><td><strong className="table-primary">{lot.remaining} шт.</strong><small className="table-secondary">в остатке из {lot.purchase.quantity}</small></td><td data-label="Вложено"><strong className="table-primary">{currency(invested)}</strong><small className="table-secondary">с доставкой</small></td><td data-label="Вернулось"><strong className="table-primary">{currency(lot.revenue)}</strong><small className="table-secondary">от {lot.sold} проданных</small></td><td data-label="Окупаемость"><div className="payback"><div className="payback-label"><strong className={returned >= 100 ? 'paid' : ''}>{Math.round(returned)}%</strong><span>{returned >= 100 ? 'окуплено' : 'возврат'}</span></div><div className="progress-track"><span style={{ width: `${Math.min(returned, 100)}%` }} /></div></div></td></tr>
}

function CheckGraphic() { return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="m4 9 3 3 7-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function ArrowLeftRightGraphic() { return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M5 9h18m-5-5 5 5-5 5M23 19H5m5-5-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg> }
