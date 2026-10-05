import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Returns a ref to attach to the element, and its height in pixels.
 * ResizeObserver (not a resize listener) catches the element growing even when the window doesn't.
 * useLayoutEffect (not useEffect) avoids a visible one-frame jump on the first measurement.
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
