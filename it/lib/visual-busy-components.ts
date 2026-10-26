// The client components of the visual fixture that keep a page busy, which is what the settle and the
// stability checks are judged against: one that never rests, and one that rests only after longer than a
// single settle ceiling.

/** Changes an element's width on every frame, forever. */
export const GROW: string = `'use client'
import { useEffect, useState } from 'react'

export function Grow(): React.JSX.Element {
  const [width, setWidth] = useState(100)
  useEffect((): (() => void) => {
    const timer = setInterval((): void => {
      setWidth((current: number): number => 100 + ((current - 90) % 1000))
    }, 16)
    return (): void => clearInterval(timer)
  }, [])
  return <div className="growth"><div style={{ width }} /></div>
}
`

/** Adds and removes an element on every frame for twelve seconds after it mounts, then rests. */
export const SETTLE: string = `'use client'
import { useEffect, useState } from 'react'

const BUSY_MS = 12_000

export function Settle(): React.JSX.Element {
  const [isShown, setIsShown] = useState(false)
  useEffect((): (() => void) => {
    const started: number = performance.now()
    const timer = setInterval((): void => {
      if (performance.now() - started > BUSY_MS) {
        clearInterval(timer)
        return
      }
      setIsShown((current: boolean): boolean => !current)
    }, 16)
    return (): void => clearInterval(timer)
  }, [])
  return <div>{isShown ? <span>Settling</span> : null}</div>
}
`
