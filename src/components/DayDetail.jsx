import { DOW_FULL, auDate, dayTotals, dowIndex, hasOrder, money, parseKey } from '../lib/orders'
import SlotCard from './SlotCard'

export default function DayDetail({ data, selected, hideZero, setHideZero }) {
  const date = parseKey(selected)
  const totals = dayTotals(data, selected)
  const ordered = hasOrder(data, selected)

  return (
    <>
      <div className="card">
        <div className="detail-head">
          <div>
            <div className="date">{DOW_FULL[dowIndex(date)]} {auDate(date)}</div>
            <div className="meta">
              {ordered
                ? `${data.slots.length} collection times · ${data.catalogue.length} line items`
                : 'No order recorded for this day'}
            </div>
          </div>
          <div className="stats">
            <div className="stat"><div className="label">Full</div><div className="value">{totals.full}</div></div>
            <div className="stat"><div className="label">Halves</div><div className="value">{totals.half}</div></div>
            <div className="stat"><div className="label">Day total</div><div className="value accent">{money(totals.price)}</div></div>
          </div>
        </div>
      </div>

      {ordered ? (
        <div className="slots">
          {data.slots.map(slot => (
            <SlotCard key={slot.id} data={data} dateKey={selected} slot={slot} hideZero={hideZero} />
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="empty">
            <strong>Nothing scheduled</strong>
            Pick a highlighted day on the calendar to see its order breakdown.
          </div>
        </div>
      )}

      <div className="card no-print">
        <div className="toolbar">
          <label>
            <input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)} />
            Hide zero-quantity items
          </label>
          <button className="btn" onClick={() => window.print()}>Print day sheet</button>
        </div>
      </div>
    </>
  )
}
