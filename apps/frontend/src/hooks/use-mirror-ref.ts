import { useEffect, useRef, type RefObject } from 'react'

/**
 * A ref that always holds the latest value.
 *
 * Why it exists: a listener registered once on mount keeps the variables from
 * the render that created it — a stale closure. Reading through a ref sidesteps
 * that: the ref object never changes, only what is inside it.
 */
export function useMirrorRef<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}
