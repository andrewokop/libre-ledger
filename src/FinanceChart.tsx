import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money } from './types'

type MonthFlow = { month: string; sales: number; expenses: number }

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip"><span>{label}</span>{payload.map((item) => <strong key={item.name}><i style={{ background: item.color }} />{item.name}: {money(item.value)} ₽</strong>)}</div>
}

export default function FinanceChart({ data }: { data: MonthFlow[] }) {
  return <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 10, right: 3, left: -21, bottom: 0 }}><defs><linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8fae9e" stopOpacity={0.2} /><stop offset="92%" stopColor="#8fae9e" stopOpacity={0.015} /></linearGradient><linearGradient id="expenses-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d2a38c" stopOpacity={0.17} /><stop offset="92%" stopColor="#d2a38c" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#eceee9" strokeDasharray="4 6" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#929890', fontSize: 11 }} dy={9} /><YAxis axisLine={false} tickLine={false} tick={{ fill: '#929890', fontSize: 10 }} tickFormatter={(value: number) => value >= 1000 ? `${Math.round(value / 1000)}к` : String(value)} /><Tooltip content={<ChartTooltip />} /><Area type="monotone" dataKey="sales" name="Продажи" stroke="#7e9b8b" strokeWidth={2.5} fill="url(#sales-fill)" activeDot={{ r: 4, fill: '#7e9b8b', stroke: '#fff', strokeWidth: 2 }} /><Area type="monotone" dataKey="expenses" name="Закупки" stroke="#c3957f" strokeWidth={2} fill="url(#expenses-fill)" activeDot={{ r: 4, fill: '#c3957f', stroke: '#fff', strokeWidth: 2 }} /></AreaChart></ResponsiveContainer></div>
}
