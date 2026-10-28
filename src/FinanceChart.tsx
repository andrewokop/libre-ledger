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
  return <div className="chart-wrap" role="img" aria-label="Продажи показаны синими столбцами, закупки и доставка — оранжевой линией"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 15, right: 8, left: 0, bottom: 6 }} barCategoryGap="30%"><CartesianGrid vertical={false} stroke="#b8c1d8" strokeDasharray="3 5" /><XAxis dataKey="month" axisLine={false} tickLine={false} minTickGap={32} tick={{ fill: '#303d59', fontSize: 15, fontWeight: 500 }} dy={12} /><YAxis width={90} axisLine={false} tickLine={false} tickCount={4} tick={{ fill: '#303d59', fontSize: 15, fontWeight: 500 }} tickFormatter={(value: number) => value >= 1e9 ? `${money(Math.round(value / 1e8) / 10)} млрд` : value >= 1e6 ? `${money(Math.round(value / 1e5) / 10)} млн` : value >= 1000 ? `${Math.round(value / 1000)}к` : String(value)} /><Tooltip cursor={{ fill: '#f0f2ff', radius: 6 }} content={<ChartTooltip />} /><Bar dataKey="sales" name="Продажи" fill="#3046bf" radius={[5, 5, 0, 0]} maxBarSize={30} isAnimationActive={!reducedMotion} animationDuration={600} /><Line type="linear" dataKey="expenses" name="Закупки и доставка" stroke="#91451e" strokeWidth={3} dot={{ r: 3, fill: '#fff', stroke: '#91451e', strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={!reducedMotion} animationDuration={700} /></ComposedChart></ResponsiveContainer></div>
}
