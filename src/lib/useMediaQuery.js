import { useEffect, useState } from 'react'

/** Live media-query match, so behaviour (not just styling) can differ by device. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const list = window.matchMedia(query)
    const update = event => setMatches(event.matches)
    setMatches(list.matches)
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])

  return matches
}

/** Phones and small tablets: view and browse only, no editing or import. */
export const MOBILE_QUERY = '(max-width: 760px)'
