import {
  DOW_SHORT, MONTHS, auDate, dateKey, dayTotals, dowIndex, hasOrder, money,
} from '../lib/orders'

const CELLS = 42 // 6 weeks, so the grid height never jumps between months

export default function Calendar({ data, viewMonth, setViewMonth, selected, onSelect, today }) {
  const lead = dowIndex(viewMonth)
  const start = new Date(viewMonth)
  start.setDate(1 - lead)

  const days = Array.from({ length: CELLS }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })

  const shiftMonth = step =>
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + step, 1))

  const goToday = () => {
    setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1))
    onSelect(dateKey(today))
  }

  const todayKey = dateKey(today)

  return (
    <div className="card">
      <div className="cal-head">
        <div className="month">{MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}</div>
        <div className="nav">
          <button onClick={() => shiftMonth(-1)} title="Previous month" aria-label="Previous month">‹</button>
          <button onClick={goToday} className="wide">Today</button>
          <button onClick={() => shiftMonth(1)} title="Next month" aria-label="Next month">›</button>
        </div>
      </div>

      <div className="cal-grid">
        {DOW_SHORT.map(d => <div className="dow" key={d}>{d}</div>)}

        {days.map(d => {
          const key = dateKey(d)
          const ordered = hasOrder(data, key)
          const cls = [
            'day',
            d.getMonth() !== viewMonth.getMonth() && 'out',
            key === todayKey && 'today',
            ordered && 'has-order',
            key === selected && 'selected',
          ].filter(Boolean).join(' ')

          return (
            <button
              key={key}
              className={cls}
              onClick={() => onSelect(key)}
              aria-pressed={key === selected}
              title={ordered ? `${auDate(d)} — ${money(dayTotals(data, key).price)}` : auDate(d)}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>

      <div className="legend">
        <span><i /> Order placed</span>
        <span className="faint">Arrow keys move day</span>
      </div>
    </div>
  )
}
