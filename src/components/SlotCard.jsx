import { money, slotLines, slotTotals } from '../lib/orders'

export default function SlotCard({ data, dateKey, slot, hideZero }) {
  const lines = slotLines(data, dateKey, slot.id)
  const totals = slotTotals(data, dateKey, slot.id)
  const visible = hideZero ? lines.filter(l => l.full > 0) : lines

  return (
    <div className="card">
      <div className="slot-head">
        <h2 className="flush"><span className="dot" /> {slot.label}</h2>
        <span className="pill">{money(totals.price)}</span>
      </div>

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Full</th>
            <th>Half</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr><td colSpan={4} className="none">No items in this collection.</td></tr>
          ) : visible.map(line => (
            <tr
              key={line.item.id}
              className={`${line.full ? '' : 'zero'} ${line.item.gf ? 'gf' : ''}`}
            >
              <td>{line.item.name}</td>
              <td className="qty">{line.full}</td>
              <td className={line.half === null ? 'na' : 'qty'}>
                {line.half === null ? '—' : line.half}
              </td>
              <td className="price">{money(line.price)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Collection total</td>
            <td className="qty">{totals.full}</td>
            <td className="qty">{totals.half}</td>
            <td className="price accent">{money(totals.price)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
