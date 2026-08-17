import { useEffect, useRef, useState } from 'react'
import { importImage } from '../lib/api'
import { imageFromPaste, prepareImage } from '../lib/image'
import { mapExtraction } from '../lib/importMap'
import { auDate, dateKey, parseKey, weekOf } from '../lib/orders'

export default function ImportDialog({ accessKey, doc, weekStart, onApply, onClose }) {
  const [image, setImage] = useState(null)
  const [week, setWeek] = useState(() => dateKey(weekStart))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const fileInput = useRef(null)

  const takeFile = async file => {
    setError('')
    setResult(null)
    try {
      setImage(await prepareImage(file))
    } catch (err) {
      setImage(null)
      setError(err.message)
    }
  }

  // Paste a screenshot straight into the dialog.
  useEffect(() => {
    const onPaste = event => {
      const file = imageFromPaste(event)
      if (file) {
        event.preventDefault()
        takeFile(file)
      }
    }
    const onKey = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const extract = async () => {
    if (!image) return
    setBusy(true)
    setError('')
    try {
      const extraction = await importImage(accessKey, image.dataUrl)
      // The sheet only names weekdays, so the chosen week decides the dates.
      setResult(mapExtraction(extraction, doc, weekOf(parseKey(week))[0]))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const mondayLabel = auDate(weekOf(parseKey(week))[0])

  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label="Import orders from an image">
        <div className="modal-head">
          <h2 className="flush"><span className="dot" /> Import from image</h2>
          <button className="icon-btn small" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <p className="gate-copy">
          Paste a screenshot of the order spreadsheet (Ctrl+V) or choose a file. Claude reads
          it and shows you the result to check before anything changes.
        </p>

        <div
          className={`dropzone ${image ? 'filled' : ''}`}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault()
            const file = e.dataTransfer.files?.[0]
            if (file) takeFile(file)
          }}
          onClick={() => fileInput.current?.click()}
        >
          {image ? (
            <img src={image.dataUrl} alt="Screenshot to import" />
          ) : (
            <span>Paste, drop, or click to choose an image</span>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={e => e.target.files?.[0] && takeFile(e.target.files[0])}
          />
        </div>

        {image?.resized && (
          <p className="note">Resized to {image.width}x{image.height} for upload.</p>
        )}

        <div className="week-picker">
          <label htmlFor="import-week">Week starting</label>
          <input
            id="import-week"
            type="date"
            value={week}
            onChange={e => e.target.value && setWeek(e.target.value)}
          />
          <span className="note">
            The sheet only names weekdays, so Monday becomes {mondayLabel}.
          </span>
        </div>

        {error && <p className="gate-error">{error}</p>}

        {result && (
          <div className="review">
            <h3>Review</h3>
            {result.days.map(day => (
              <div className="review-day" key={day.dateKey}>
                <div className="review-day-head">{day.label}</div>
                {day.lines.length === 0 ? (
                  <div className="note">No quantities on this day.</div>
                ) : (
                  <table>
                    <thead>
                      <tr><th>Collection</th><th>Item</th><th>Full</th></tr>
                    </thead>
                    <tbody>
                      {day.lines.filter(l => l.full > 0).map((line, i) => (
                        <tr key={`${line.slotId}-${line.item.id}-${i}`}>
                          <td>{line.slotLabel}</td>
                          <td className={line.item.gf ? 'gf' : ''}>{line.item.name}</td>
                          <td className="qty">{line.full}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}

            {result.notes && <p className="note"><strong>Claude's notes:</strong> {result.notes}</p>}

            {result.issues.length > 0 && (
              <div className="issues">
                <strong>Check these before applying</strong>
                <ul>{result.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
              </div>
            )}

            <p className="note">
              Applying replaces the whole order for each day listed above. Nothing is shared
              with anyone until you sync.
            </p>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={extract} disabled={!image || busy}>
            {busy ? 'Reading image…' : result ? 'Read again' : 'Read image'}
          </button>
          <button
            className="btn btn-primary"
            disabled={!result || result.days.length === 0}
            onClick={() => onApply(result.days)}
          >
            Apply to calendar
          </button>
        </div>
      </div>
    </div>
  )
}
