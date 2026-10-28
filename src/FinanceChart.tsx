import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money } from './types'

type MonthFlow = { month: string; sales: number; expenses: number }

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip"><span>{label}</span>{payload.map((item) => <strong key={item.name}><i style={{ background: item.color }} />{item.name}: {money(item.value)} ₽</strong>)}</div>
}

export default function FinanceChart({ data }: { data: MonthFlow[] }) {
  return <div className="chart-wrap" role="img" aria-label="Сравнение продаж и расходов на закупки за выбранный период"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 12, right: 0, left: -20, bottom: 4 }} barGap={3} barCategoryGap="24%"><CartesianGrid vertical={false} stroke="#e8e9e2" strokeDasharray="3 5" /><XAxis dataKey="month" axisLine={false} tickLine={false} minTickGap={22} tick={{ fill: '#7c8278', fontSize: 11 }} dy={10} /><YAxis axisLine={false} tickLine={false} tickCount={4} tick={{ fill: '#7c8278', fontSize: 11 }} tickFormatter={(value: number) => value >= 1000 ? `${Math.round(value / 1000)}к` : String(value)} /><Tooltip cursor={{ fill: '#f2f3ed', radius: 5 }} content={<ChartTooltip />} /><Bar dataKey="sales" name="Продажи" fill="#326451" radius={[4, 4, 0, 0]} maxBarSize={24} /><Bar dataKey="expenses" name="Закупки и доставка" fill="#c5c4e2" radius={[4, 4, 0, 0]} maxBarSize={24} /></BarChart></ResponsiveContainer></div>
}
