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

/**
 * Adds and removes an element on every frame for twelve seconds after it mounts, then rests. The element
 * is toggled in the page's own frame callback rather than through state on a timer, so every frame the
 * settle samples differs from the one before however late a loaded machine runs timers or renders.
 */
export const SETTLE: string = `'use client'
import { useEffect } from 'react'

const BUSY_MS = 12_000

export function Settle(): React.JSX.Element {
  useEffect((): (() => void) => {
    const started: number = performance.now()
    const stopped: AbortController = new AbortController()
    const marker: HTMLSpanElement = document.createElement('span')
    marker.append('Settling')
    const step = (): void => {
      if (stopped.signal.aborted || performance.now() - started > BUSY_MS) {
        marker.remove()
        return
      }
      if (marker.isConnected) {
        marker.remove()
      } else {
        document.querySelector('.settle-region')?.append(marker)
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
    return (): void => {
      stopped.abort()
      marker.remove()
    }
  }, [])
  return <div className="settle-region" />
}
`
