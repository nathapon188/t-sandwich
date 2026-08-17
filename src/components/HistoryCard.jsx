import { auDate } from '../lib/orders'

const label = id => {
  const d = new Date(id)
  if (Number.isNaN(d.getTime())) return id
  return `${auDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Every sync snapshots the version it replaced, so a bad edit can be rolled
 * back. Restoring loads the old version into the editor; it only becomes live
 * once it is synced.
 */
export default function HistoryCard({ snapshots, busy, onRestore }) {
  return (
    <div className="card no-print">
      <h2>History</h2>

      {snapshots.length === 0 ? (
        <div className="empty">No previous versions yet.</div>
      ) : (
        snapshots.slice(0, 8).map(id => (
          <div className="kv" key={id}>
            <span className="k">{label(id)}</span>
            <button className="link-btn" disabled={busy} onClick={() => onRestore(id)}>
              Restore
            </button>
          </div>
        ))
      )}

      <p className="note mt">
        Restoring loads that version into the editor. It only replaces the live
        version once you sync.
      </p>
    </div>
  )
}
