import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money } from './types'

type MonthFlow = { month: string; sales: number; expenses: number }

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip"><span>{label}</span>{payload.map((item) => <strong key={item.name}><i style={{ background: item.color }} />{item.name}: {money(item.value)} ₽</strong>)}</div>
}

export default function FinanceChart({ data }: { data: MonthFlow[] }) {
  return <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 14, right: 8, left: -8, bottom: 4 }}><defs><linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#91c9f4" stopOpacity={0.38} /><stop offset="92%" stopColor="#91c9f4" stopOpacity={0.02} /></linearGradient><linearGradient id="expenses-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#efbd9d" stopOpacity={0.25} /><stop offset="92%" stopColor="#efbd9d" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#ffffff" strokeOpacity={0.12} strokeDasharray="4 6" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#c3d6ea', fontSize: 13 }} dy={9} /><YAxis axisLine={false} tickLine={false} tick={{ fill: '#c3d6ea', fontSize: 12 }} tickFormatter={(value: number) => value >= 1000 ? `${Math.round(value / 1000)}к` : String(value)} /><Tooltip content={<ChartTooltip />} /><Area type="monotone" dataKey="sales" name="Продажи" stroke="#9bd3ff" strokeWidth={3} fill="url(#sales-fill)" activeDot={{ r: 5, fill: '#9bd3ff', stroke: '#203c5b', strokeWidth: 2 }} /><Area type="monotone" dataKey="expenses" name="Закупки" stroke="#efbd9d" strokeWidth={2.5} fill="url(#expenses-fill)" activeDot={{ r: 5, fill: '#efbd9d', stroke: '#203c5b', strokeWidth: 2 }} /></AreaChart></ResponsiveContainer></div>
}
