// Tells you how tall an element currently is, and keeps telling you when it
// changes. Used for the composer: it grows as you type, and the spacer at the
// end of the conversation has to grow with it.

import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Returns a ref to attach to the element, and its height in pixels.
 *
 * ResizeObserver is the browser API that watches an element's size. It is the
 * honest way to do this: reading the height once on mount would go stale the
 * moment the textarea grows a line, and listening to window resize would miss
 * that case entirely, because the window did not resize — the element did.
 *
 * useLayoutEffect and not useEffect: this runs before the browser paints, so
 * the first measurement lands without a visible one-frame jump.
 */
export function useElementHeight<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new ResizeObserver(() => {
      setHeight(element.getBoundingClientRect().height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, height]
}
