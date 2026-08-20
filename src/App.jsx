import { useCallback, useEffect, useMemo, useState } from 'react'
import Calendar from './components/Calendar'
import DayDetail from './components/DayDetail'
import HistoryCard from './components/HistoryCard'
import ImportDialog from './components/ImportDialog'
import KeyGate from './components/KeyGate'
import PriceList from './components/PriceList'
import SyncBar from './components/SyncBar'
import WeekSummary from './components/WeekSummary'
import {
  clearStoredKey, fetchOrders, fetchSnapshot, fetchSnapshots,
  getStoredKey, keyFromUrl, saveOrders, storeKey,
} from './lib/api'
import { applyImport, ensureDay, isDirty, removeDay, setQty } from './lib/edit'
import { auDate, dateKey, defaultSelectedDate, parseKey, startOfMonth, weekOf } from './lib/orders'
import { MOBILE_QUERY, useMediaQuery } from './lib/useMediaQuery'

const today = (() => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
})()

const clone = doc => JSON.parse(JSON.stringify(doc))

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') ?? 'dark')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])
  return [theme, () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))]
}

function ReservationIcon() {
  return (
    <svg
      className="icon-svg"
      viewBox="0 0 24 24"
      width="21"
      height="21"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <mask id="reservation-icon-cut">
        <rect width="24" height="24" fill="#fff" stroke="none" />
        <circle cx="17.4" cy="16.6" r="6.3" fill="#000" stroke="none" />
      </mask>
      <g mask="url(#reservation-icon-cut)">
        <path d="M5.6 4.7V3.2a1.6 1.6 0 0 1 3.2 0v1.5" />
        <path d="M11.6 4.7V3.2a1.6 1.6 0 0 1 3.2 0v1.5" />
        <rect x="2.2" y="4.7" width="15.6" height="15.1" rx="2" />
        <rect x="4.7" y="9.1" width="2.6" height="2.4" rx="0.5" />
        <rect x="8.7" y="9.1" width="2.6" height="2.4" rx="0.5" />
        <rect x="12.7" y="9.1" width="2.6" height="2.4" rx="0.5" />
        <rect x="4.7" y="13.5" width="2.6" height="2.4" rx="0.5" />
        <rect x="8.7" y="13.5" width="2.6" height="2.4" rx="0.5" />
      </g>
      <circle cx="17.4" cy="16.6" r="5.2" />
      <path d="M15.1 16.7l1.8 1.8 3.2-3.7" />
    </svg>
  )
}

export default function App() {
  const [theme, toggleTheme] = useTheme()
  const isMobile = useMediaQuery(MOBILE_QUERY)

  const [accessKey, setAccessKey] = useState(() => keyFromUrl() || getStoredKey())
  const [doc, setDoc] = useState(null)        // working copy, possibly edited
  const [baseline, setBaseline] = useState(null) // last loaded or synced version
  const [gateError, setGateError] = useState('')
  const [busy, setBusy] = useState(false)

  const [selected, setSelected] = useState(null)
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(today))
  const [hideZero, setHideZero] = useState(false)

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [syncError, setSyncError] = useState('')
  const [snapshots, setSnapshots] = useState([])
  const [importOpen, setImportOpen] = useState(false)

  const dirty = isDirty(doc, baseline)

  // Editing and importing are desktop-only; never leave them on if the
  // viewport shrinks mid-session.
  useEffect(() => {
    if (isMobile) {
      setEditing(false)
      setImportOpen(false)
    }
  }, [isMobile])

  const loadSnapshots = useCallback(key => {
    fetchSnapshots(key).then(setSnapshots).catch(() => setSnapshots([]))
  }, [])

  // Load orders whenever we have a key to try.
  useEffect(() => {
    if (!accessKey) return
    let cancelled = false
    setBusy(true)
    setGateError('')

    fetchOrders(accessKey)
      .then(payload => {
        if (cancelled) return
        storeKey(accessKey)
        setDoc(payload)
        setBaseline(clone(payload))
        const start = defaultSelectedDate(payload, today)
        setSelected(start)
        setViewMonth(startOfMonth(parseKey(start)))
        loadSnapshots(accessKey)
      })
      .catch(err => {
        if (cancelled) return
        clearStoredKey()
        setDoc(null)
        setAccessKey('')
        setGateError(err.message)
      })
      .finally(() => !cancelled && setBusy(false))

    return () => { cancelled = true }
  }, [accessKey, loadSnapshots])

  // Don't let unsynced work vanish on a stray tab close.
  useEffect(() => {
    if (!dirty) return
    const warn = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const selectDate = useCallback(key => {
    setSelected(key)
    setViewMonth(startOfMonth(parseKey(key)))
  }, [])

  // Arrow keys step through days (desktop browsing aid).
  useEffect(() => {
    if (!doc || !selected) return
    const onKey = e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.target instanceof HTMLInputElement) return
      const d = parseKey(selected)
      d.setDate(d.getDate() + (e.key === 'ArrowRight' ? 1 : -1))
      selectDate(dateKey(d))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, selected, selectDate])

  const weekLabel = useMemo(() => {
    if (!selected) return ''
    const week = weekOf(parseKey(selected))
    return `Week of ${auDate(week[0])} – ${auDate(week[6])}`
  }, [selected])

  /* ---------------- editing ---------------- */

  const handleQty = (slotId, itemId, value) => {
    setDoc(current => setQty(current, selected, slotId, itemId, value))
    setMessage('')
  }

  const handleAddDay = key => {
    setDoc(current => ensureDay(current, key))
    setMessage('')
  }

  const handleRemoveDay = key => {
    if (!window.confirm(`Delete the whole order for ${auDate(parseKey(key))}?`)) return
    setDoc(current => removeDay(current, key))
    setMessage('')
  }

  /* ---------------- sync ---------------- */

  const handleSave = async () => {
    setSaving(true)
    setSyncError('')
    setMessage('')
    try {
      const saved = await saveOrders(accessKey, doc, baseline.updatedAt ?? null)
      setDoc(saved)
      setBaseline(clone(saved))
      setMessage('Synced. Everyone with the link and key sees this now.')
      loadSnapshots(accessKey)
    } catch (err) {
      setSyncError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    if (!window.confirm('Discard all unsynced changes?')) return
    setDoc(clone(baseline))
    setSyncError('')
    setMessage('Changes discarded.')
  }

  const handleReload = async () => {
    setSaving(true)
    setSyncError('')
    try {
      const fresh = await fetchOrders(accessKey)
      setDoc(fresh)
      setBaseline(clone(fresh))
      setMessage('Reloaded the latest synced version.')
      loadSnapshots(accessKey)
    } catch (err) {
      setSyncError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleRestore = async id => {
    setSaving(true)
    setSyncError('')
    try {
      const snapshot = await fetchSnapshot(accessKey, id)
      // Keep the current updatedAt so the concurrency check still works.
      setDoc({ ...snapshot, updatedAt: baseline.updatedAt ?? null })
      setMessage('Loaded that version into the editor. Sync to make it live.')
    } catch (err) {
      setSyncError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `sandwich-orders-${dateKey(today)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleApplyImport = days => {
    setDoc(current => applyImport(current, days))
    setImportOpen(false)
    setEditing(true)
    selectDate(days[0].dateKey)
    setMessage(`Applied ${days.length} day${days.length === 1 ? '' : 's'} from the image. Check them, then sync.`)
  }

  if (!doc) {
    return <KeyGate onSubmit={setAccessKey} error={gateError} busy={busy} />
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Sandwich Order Display</h1>
          <div className="sub">{weekLabel}</div>
        </div>
        <div className="topbar-actions">
          <button
            className="icon-btn"
            onClick={() => { window.location.href = 'https://tbooking.netlify.app' }}
            title="Go to tbooking.netlify.app"
            aria-label="Go to tbooking.netlify.app"
          >
            <ReservationIcon />
          </button>
          <button className="icon-btn" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </div>

      <div className="layout">
        <div className="col">
          <Calendar
            data={doc}
            viewMonth={viewMonth}
            setViewMonth={setViewMonth}
            selected={selected}
            onSelect={selectDate}
            today={today}
          />
          <WeekSummary data={doc} selected={selected} onSelect={selectDate} />
          {!isMobile && <PriceList data={doc} />}
        </div>

        <div className="col">
          <SyncBar
            readOnly={isMobile}
            editing={editing}
            setEditing={setEditing}
            dirty={dirty}
            saving={saving}
            updatedAt={baseline?.updatedAt}
            message={message}
            error={syncError}
            onSave={handleSave}
            onDiscard={handleDiscard}
            onImport={() => setImportOpen(true)}
            onExport={handleExport}
            onReload={handleReload}
          />

          <DayDetail
            data={doc}
            selected={selected}
            hideZero={hideZero}
            setHideZero={setHideZero}
            editing={editing}
            onQty={handleQty}
            onAddDay={handleAddDay}
            onRemoveDay={handleRemoveDay}
          />

          {isMobile && <PriceList data={doc} />}
          {!isMobile && <HistoryCard snapshots={snapshots} busy={saving} onRestore={handleRestore} />}
        </div>
      </div>

      {importOpen && !isMobile && (
        <ImportDialog
          doc={doc}
          weekStart={weekOf(parseKey(selected))[0]}
          onApply={handleApplyImport}
          onClose={() => setImportOpen(false)}
        />
      )}
    </>
  )
}
