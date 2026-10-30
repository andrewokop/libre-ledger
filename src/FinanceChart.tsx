import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { money } from './types'
import type { FlowPeriod } from './financeFlow'

function axisAmount(value: number) {
  if (value >= 1e9) return `${money(Math.round(value / 1e8) / 10)} млрд`
  if (value >= 1e6) return `${money(Math.round(value / 1e5) / 10)} млн`
  if (value >= 1000) return `${money(Math.round(value / 100) / 10)} тыс.`
  return money(value)
}

export default function FinanceChart({
  data,
  unit
}: {
  data: FlowPeriod[]
  unit: 'rub' | 'quantity'
}) {
  return (
    <div className="v3-chart-wrap" aria-label="Линейный график продаж">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          accessibilityLayer
          aria-label="Продажи: используйте стрелки для просмотра значений"
          data={data}
          margin={{ top: 16, right: 12, left: 0, bottom: 8 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="#d7dced"
            strokeDasharray="3 5"
          />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            minTickGap={24}
            tick={{ fill: '#36425e', fontSize: 14 }}
            dy={9}
          />
          <YAxis
            width={65}
            axisLine={false}
            tickLine={false}
            tickCount={4}
            tick={{ fill: '#36425e', fontSize: 14 }}
            tickFormatter={axisAmount}
            allowDecimals={unit === 'rub'}
          />
          <Tooltip
            isAnimationActive={false}
            wrapperStyle={{ maxWidth: '100%' }}
            cursor={{ stroke: '#aab5d9' }}
            content={({ active, payload }) => {
              const point: FlowPeriod | undefined = payload?.[0]?.payload
              return active && point ? (
                <div className="v3-chart-tooltip" role="status">
                  <span>{point.range}</span>
                  <strong>{money(point.sales)} ₽</strong>
                  <span>{point.quantity} шт.</span>
                </div>
              ) : null
            }}
          />
          <Line
            type="linear"
            dataKey={unit === 'rub' ? 'sales' : 'quantity'}
            stroke="#3d4dc2"
            strokeWidth={3}
            dot={data.length === 1 ? { r: 4, fill: '#3d4dc2' } : false}
            activeDot={{
              r: 5,
              fill: '#fff',
              stroke: '#3d4dc2',
              strokeWidth: 3
            }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
