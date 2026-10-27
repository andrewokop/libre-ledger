import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money } from './types'

type MonthFlow = { month: string; sales: number; expenses: number }

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip"><span>{label}</span>{payload.map((item) => <strong key={item.name}><i style={{ background: item.color }} />{item.name}: {money(item.value)} ₽</strong>)}</div>
}

export default function FinanceChart({ data }: { data: MonthFlow[] }) {
  return <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 10, right: 3, left: -21, bottom: 0 }}><defs><linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a9cbb0" stopOpacity={0.32} /><stop offset="92%" stopColor="#a9cbb0" stopOpacity={0.015} /></linearGradient><linearGradient id="expenses-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e6b59a" stopOpacity={0.28} /><stop offset="92%" stopColor="#e6b59a" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#ffffff" strokeOpacity={0.1} strokeDasharray="4 6" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#b3c1b5', fontSize: 11 }} dy={9} /><YAxis axisLine={false} tickLine={false} tick={{ fill: '#b3c1b5', fontSize: 10 }} tickFormatter={(value: number) => value >= 1000 ? `${Math.round(value / 1000)}к` : String(value)} /><Tooltip content={<ChartTooltip />} /><Area type="monotone" dataKey="sales" name="Продажи" stroke="#b6d8b8" strokeWidth={2.5} fill="url(#sales-fill)" activeDot={{ r: 4, fill: '#b6d8b8', stroke: '#284638', strokeWidth: 2 }} /><Area type="monotone" dataKey="expenses" name="Закупки" stroke="#e8b398" strokeWidth={2} fill="url(#expenses-fill)" activeDot={{ r: 4, fill: '#e8b398', stroke: '#284638', strokeWidth: 2 }} /></AreaChart></ResponsiveContainer></div>
}
