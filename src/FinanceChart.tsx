import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money } from './types'
import { useReducedMotion } from './ui'

type MonthFlow = { month: string; sales: number; expenses: number }

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip"><span>{label}</span>{payload.map((item) => <strong key={item.name}><i style={{ background: item.color }} />{item.name}: {money(item.value)} ₽</strong>)}</div>
}

export default function FinanceChart({ data }: { data: MonthFlow[] }) {
  const reducedMotion = useReducedMotion()
  return <div className="chart-wrap" role="img" aria-label="Продажи показаны синими столбцами, закупки и доставка — оранжевой линией"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 15, right: 8, left: -20, bottom: 6 }} barCategoryGap="30%"><CartesianGrid vertical={false} stroke="#e9ebf4" strokeDasharray="3 5" /><XAxis dataKey="month" axisLine={false} tickLine={false} minTickGap={32} tick={{ fill: '#6d7490', fontSize: 14 }} dy={12} /><YAxis axisLine={false} tickLine={false} tickCount={4} tick={{ fill: '#6d7490', fontSize: 14 }} tickFormatter={(value: number) => value >= 1000 ? `${Math.round(value / 1000)}к` : String(value)} /><Tooltip cursor={{ fill: '#f0f2ff', radius: 6 }} content={<ChartTooltip />} /><Bar dataKey="sales" name="Продажи" fill="#5267ee" radius={[5, 5, 0, 0]} maxBarSize={30} isAnimationActive={!reducedMotion} animationDuration={600} /><Line type="linear" dataKey="expenses" name="Закупки и доставка" stroke="#cf713f" strokeWidth={2.5} dot={{ r: 3, fill: '#fff', stroke: '#cf713f', strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={!reducedMotion} animationDuration={700} /></ComposedChart></ResponsiveContainer></div>
}
