import { useCallback, useEffect, useMemo, useState } from 'react'
import Calendar from './components/Calendar'
import DayDetail from './components/DayDetail'
import KeyGate from './components/KeyGate'
import PriceList from './components/PriceList'
import WeekSummary from './components/WeekSummary'
import { clearStoredKey, fetchOrders, getStoredKey, keyFromUrl, storeKey } from './lib/api'
import { auDate, dateKey, defaultSelectedDate, parseKey, startOfMonth, weekOf } from './lib/orders'

const today = (() => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
})()

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') ?? 'dark')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])
  return [theme, () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))]
}

export default function App() {
  const [theme, toggleTheme] = useTheme()

  const [accessKey, setAccessKey] = useState(() => keyFromUrl() || getStoredKey())
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [selected, setSelected] = useState(null)
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(today))
  const [hideZero, setHideZero] = useState(false)

  // Load orders whenever we have a key to try.
  useEffect(() => {
    if (!accessKey) return
    let cancelled = false
    setBusy(true)
    setError('')

    fetchOrders(accessKey)
      .then(payload => {
        if (cancelled) return
        storeKey(accessKey)
        setData(payload)
        const start = defaultSelectedDate(payload, today)
        setSelected(start)
        setViewMonth(startOfMonth(parseKey(start)))
      })
      .catch(err => {
        if (cancelled) return
        clearStoredKey()
        setData(null)
        setAccessKey('')
        setError(err.message)
      })
      .finally(() => !cancelled && setBusy(false))

    return () => { cancelled = true }
  }, [accessKey])

  const selectDate = useCallback(key => {
    setSelected(key)
    setViewMonth(startOfMonth(parseKey(key)))
  }, [])

  // Arrow keys step through days.
  useEffect(() => {
    if (!data || !selected) return
    const onKey = e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.target instanceof HTMLInputElement) return
      const d = parseKey(selected)
      d.setDate(d.getDate() + (e.key === 'ArrowRight' ? 1 : -1))
      selectDate(dateKey(d))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, selected, selectDate])

  const weekLabel = useMemo(() => {
    if (!selected) return ''
    const week = weekOf(parseKey(selected))
    return `Week of ${auDate(week[0])} – ${auDate(week[6])}`
  }, [selected])

  if (!data) {
    return <KeyGate onSubmit={setAccessKey} error={error} busy={busy} />
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Sandwich Order Display</h1>
          <div className="sub">{weekLabel}</div>
        </div>
        <button className="icon-btn" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>

      <div className="layout">
        <div className="col">
          <Calendar
            data={data}
            viewMonth={viewMonth}
            setViewMonth={setViewMonth}
            selected={selected}
            onSelect={selectDate}
            today={today}
          />
          <WeekSummary data={data} selected={selected} onSelect={selectDate} />
          <PriceList data={data} />
        </div>

        <div className="col">
          <DayDetail data={data} selected={selected} hideZero={hideZero} setHideZero={setHideZero} />
        </div>
      </div>
    </>
  )
}
