import { useEffect, useRef, type RefObject } from 'react'

/** A ref that always holds the latest value - sidesteps stale closures in callbacks registered once on mount. */
export function useMirrorRef<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}
