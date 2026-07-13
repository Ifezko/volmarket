import { useEffect, useState } from 'react'

// A ticking wall-clock in ms, so the match clocks (see matchClock) advance without a manual
// refresh. Coarse by default - the clocks only display whole minutes - but cheap either way.
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
