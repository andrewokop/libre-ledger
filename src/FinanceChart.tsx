import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money } from './types'
import { useReducedMotion } from './ui'
import type { FlowPeriod } from './financeFlow'

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { name: string; value: number; color: string; payload?: FlowPeriod }[] }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip"><span>{payload[0]?.payload?.range}</span>{payload.map((item) => <strong key={item.name}><i style={{ background: item.color }} />{item.name}: {money(item.value)} ₽</strong>)}</div>
}

function axisAmount(value: number) {
  if (value >= 1e9) return `${money(Math.round(value / 1e8) / 10)} млрд`
  if (value >= 1e6) return `${money(Math.round(value / 1e5) / 10)} млн`
  if (value >= 1000) return `${money(Math.round(value / 100) / 10)} тыс.`
  return money(value)
}

export default function FinanceChart({ data }: { data: FlowPeriod[] }) {
  const reducedMotion = useReducedMotion()
  return <div className="chart-wrap" aria-label="Синие столбцы — продажи, оранжевые — закупки с доставкой. Точные суммы доступны в таблице под графиком.">
    <ResponsiveContainer width="100%" height="100%"><BarChart data={data} accessibilityLayer margin={{ top: 12, right: 2, left: 0, bottom: 6 }} barCategoryGap="22%" barGap={3}>
      <CartesianGrid vertical={false} stroke="#b8c1d8" strokeDasharray="3 5" />
      <XAxis dataKey="label" axisLine={false} tickLine={false} interval={data.length === 5 ? 'preserveStartEnd' : 0} minTickGap={8} tick={{ fill: '#303d59', fontSize: 14, fontWeight: 500 }} dy={10} />
      <YAxis width={83} axisLine={false} tickLine={false} tickCount={4} tick={{ fill: '#303d59', fontSize: 14, fontWeight: 500 }} tickFormatter={axisAmount} />
      <Tooltip cursor={{ fill: '#eef0fb' }} content={<ChartTooltip />} wrapperStyle={{ zIndex: 5, maxWidth: '100%' }} />
      <Bar dataKey="sales" name="Продажи" fill="#3046bf" radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={!reducedMotion} animationDuration={350} />
      <Bar dataKey="expenses" name="Закупки и доставка" fill="#91451e" radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={!reducedMotion} animationDuration={350} />
    </BarChart></ResponsiveContainer>
  </div>
}
