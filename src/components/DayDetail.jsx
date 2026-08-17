import { DOW_FULL, auDate, dayTotals, dowIndex, hasOrder, money, parseKey } from '../lib/orders'
import SlotCard from './SlotCard'

export default function DayDetail({
  data, selected, hideZero, setHideZero, editing, onQty, onAddDay, onRemoveDay,
}) {
  const date = parseKey(selected)
  const totals = dayTotals(data, selected)
  const ordered = hasOrder(data, selected)
  const dayExists = Boolean(data.orders[selected])

  return (
    <>
      <div className="card">
        <div className="detail-head">
          <div>
            <div className="date">{DOW_FULL[dowIndex(date)]} {auDate(date)}</div>
            <div className="meta">
              {dayExists
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

      {dayExists ? (
        <div className="slots">
          {data.slots.map(slot => (
            <SlotCard
              key={slot.id}
              data={data}
              dateKey={selected}
              slot={slot}
              hideZero={hideZero}
              editing={editing}
              onQty={onQty}
            />
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="empty">
            <strong>Nothing scheduled</strong>
            {editing
              ? 'Add an order for this day to start entering quantities.'
              : 'Pick a highlighted day on the calendar, or switch on Edit to add one.'}
          </div>
          {editing && (
            <button className="btn btn-primary mt" onClick={() => onAddDay(selected)}>
              Add order for {auDate(date)}
            </button>
          )}
        </div>
      )}

      <div className="card no-print">
        <div className="toolbar">
          <label>
            <input
              type="checkbox"
              checked={hideZero}
              disabled={editing}
              onChange={e => setHideZero(e.target.checked)}
            />
            Hide zero-quantity items
          </label>
          <button className="btn" onClick={() => window.print()}>Print day sheet</button>
          {editing && dayExists && (
            <button className="btn btn-danger" onClick={() => onRemoveDay(selected)}>
              Delete this day
            </button>
          )}
          {ordered || !editing ? null : <span className="note">Nothing ordered yet for this day.</span>}
        </div>
      </div>
    </>
  )
}
