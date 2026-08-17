import { money } from '../lib/orders'

export default function PriceList({ data }) {
  return (
    <div className="card no-print">
      <h2>Price List</h2>
      {data.catalogue.map(item => (
        <div className="kv" key={item.id}>
          <span className={`k ${item.gf ? 'gf' : ''}`}>{item.name}</span>
          <span className="v">{item.price ? money(item.price) : '—'}</span>
        </div>
      ))}
      <p className="note mt">Prices are per full sandwich. One full sandwich = 2 halves.</p>
    </div>
  )
}
