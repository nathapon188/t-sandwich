import { DOW_SHORT, auDate, dateKey, dayTotals, dowIndex, hasOrder, money, parseKey, weekOf } from '../lib/orders'

export default function WeekSummary({ data, selected, onSelect }) {
  const week = weekOf(parseKey(selected))
  const ordered = week.filter(d => hasOrder(data, dateKey(d)))
  const total = ordered.reduce((s, d) => s + dayTotals(data, dateKey(d)).price, 0)

  return (
    <div className="card">
      <h2><span className="dot" /> Week Summary</h2>

      {ordered.length === 0 ? (
        <div className="empty">No orders recorded for this week.</div>
      ) : (
        <>
          {ordered.map(d => {
            const key = dateKey(d)
            return (
              <button
                key={key}
                className={`kv clickable ${key === selected ? 'active' : ''}`}
                onClick={() => onSelect(key)}
              >
                <span className="k">{DOW_SHORT[dowIndex(d)]} {auDate(d)}</span>
                <span className="v">{money(dayTotals(data, key).price)}</span>
              </button>
            )
          })}
          <div className="kv total-row">
            <span className="k">Week total</span>
            <span className="v accent">{money(total)}</span>
          </div>
        </>
      )}
    </div>
  )
}
