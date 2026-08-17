import { useState } from 'react'

export default function KeyGate({ onSubmit, error, busy }) {
  const [value, setValue] = useState('')

  const submit = e => {
    e.preventDefault()
    const key = value.trim()
    if (key) onSubmit(key)
  }

  return (
    <div className="gate">
      <form className="card gate-card" onSubmit={submit}>
        <h2><span className="dot" /> Sandwich Order Display</h2>
        <p className="gate-copy">Enter the access key to view the order schedule.</p>

        <input
          className="gate-input"
          type="password"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Access key"
          autoFocus
          autoComplete="off"
          aria-label="Access key"
        />

        {error && <p className="gate-error">{error}</p>}

        <button className="btn btn-primary" type="submit" disabled={busy || !value.trim()}>
          {busy ? 'Checking…' : 'View orders'}
        </button>

        <p className="note gate-note">
          The key is held by whoever shared the link with you. It is stored for this browser
          tab only and cleared when you close it.
        </p>
      </form>
    </div>
  )
}
