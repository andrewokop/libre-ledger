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
  unit,
  selected,
  onSelect
}: {
  data: FlowPeriod[]
  unit: 'rub' | 'quantity'
  selected: number
  onSelect: (index: number) => void
}) {
  function selectAt(clientX: number, element: HTMLDivElement) {
    const bounds = element.getBoundingClientRect()
    const scale = element.clientWidth ? bounds.width / element.clientWidth : 1
    const fraction = Math.max(
      0,
      Math.min(
        1,
        (clientX - bounds.left - 65 * scale) /
          Math.max(1, bounds.width - 77 * scale)
      )
    )
    onSelect(Math.round(fraction * (data.length - 1)))
  }
  return (
    <div
      className="v3-chart-wrap"
      aria-label="Линейный график продаж"
      onPointerDown={(event) => selectAt(event.clientX, event.currentTarget)}
      onPointerMove={(event) => selectAt(event.clientX, event.currentTarget)}
      onTouchStart={(event) => {
        if (event.touches[0])
          selectAt(event.touches[0].clientX, event.currentTarget)
      }}
      onTouchMove={(event) => {
        if (event.touches[0])
          selectAt(event.touches[0].clientX, event.currentTarget)
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
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
          <Tooltip content={() => null} cursor={{ stroke: '#aab5d9' }} />
          <Line
            type="linear"
            dataKey={unit === 'rub' ? 'sales' : 'quantity'}
            stroke="#3d4dc2"
            strokeWidth={3}
            dot={(props: { cx?: number; cy?: number; index?: number }) =>
              props.index === selected ? (
                <circle
                  key={props.index}
                  cx={props.cx}
                  cy={props.cy}
                  r={5}
                  fill="#fff"
                  stroke="#3d4dc2"
                  strokeWidth={3}
                />
              ) : (
                <circle key={props.index} cx={props.cx} cy={props.cy} r={0} />
              )
            }
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
