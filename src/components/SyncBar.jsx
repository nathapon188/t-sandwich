import { auDate } from '../lib/orders'

const stamp = iso => {
  if (!iso) return 'never synced'
  const d = new Date(iso)
  return `${auDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function SyncBar({
  readOnly, editing, setEditing, dirty, saving, updatedAt, message, error,
  onSave, onDiscard, onImport, onExport, onReload,
}) {
  if (readOnly) {
    return (
      <div className="card no-print sync-bar">
        <div className="sync-row">
          <span className="status">Last synced {stamp(updatedAt)}</span>
          <button className="btn" onClick={onReload} disabled={saving}>Refresh</button>
        </div>
        <p className="note mt">Viewing only. Open on a computer to edit or import orders.</p>
      </div>
    )
  }

  return (
    <div className="card no-print sync-bar">
      <div className="sync-row">
        <label className="switch">
          <input
            type="checkbox"
            checked={editing}
            onChange={e => setEditing(e.target.checked)}
          />
          <span>Edit mode</span>
        </label>

        <span className={`status ${dirty ? 'status-dirty' : ''}`}>
          {dirty ? 'Unsaved changes' : `Last synced ${stamp(updatedAt)}`}
        </span>

        <div className="sync-actions">
          <button className="btn" onClick={onImport} disabled={saving}>Import from image</button>
          <button className="btn" onClick={onExport}>Export JSON</button>
          <button className="btn" onClick={onReload} disabled={saving || dirty}>Reload</button>
          <button className="btn" onClick={onDiscard} disabled={!dirty || saving}>Discard</button>
          <button className="btn btn-primary" onClick={onSave} disabled={!dirty || saving}>
            {saving ? 'Syncing…' : 'Sync changes'}
          </button>
        </div>
      </div>

      {error && <p className="sync-error">{error}</p>}
      {!error && message && <p className="sync-note">{message}</p>}
    </div>
  )
}
