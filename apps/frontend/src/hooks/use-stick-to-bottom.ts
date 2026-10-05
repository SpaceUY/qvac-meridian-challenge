// Keeps the view pinned to the bottom while new content arrives, unless the user scrolled up.

import { useCallback, useEffect, useRef, useState } from 'react'

/** How far from the bottom still counts as "the user is at the bottom". */
const PIN_THRESHOLD_PX = 64

function distanceFromBottom(element: HTMLElement): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight
}

export function useStickToBottom<S extends HTMLElement, C extends HTMLElement>() {
  const scrollRef = useRef<S>(null)
  const contentRef = useRef<C>(null)
  // Ref for listeners (always current, no render); state for React to show/hide the button.
  const isPinnedRef = useRef(true)
  const [isPinned, setIsPinned] = useState(true)
  // Lets the scroll listener tell a real user scroll apart from our own in-flight smooth-scroll.
  const isAutoScrollingRef = useRef(false)

  const setPinned = useCallback((value: boolean) => {
    isPinnedRef.current = value
    setIsPinned(value)
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const handleScroll = () => {
      const atBottom = distanceFromBottom(element) <= PIN_THRESHOLD_PX
      if (isAutoScrollingRef.current) {
        if (atBottom) isAutoScrollingRef.current = false
        return
      }
      setPinned(atBottom)
    }
    element.addEventListener('scroll', handleScroll, { passive: true })
    return () => element.removeEventListener('scroll', handleScroll)
  }, [setPinned])

  // A new token doesn't fire a scroll event (scrollTop didn't move, the floor did) - only ResizeObserver sees it.
  useEffect(() => {
    const element = scrollRef.current
    const content = contentRef.current
    if (!element || !content) return

    const observer = new ResizeObserver(() => {
      // Instant, not smooth - a smooth scroll per token would fight the next one.
      if (isPinnedRef.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    // Pin first so the observer keeps following if content is still growing.
    setPinned(true)
    isAutoScrollingRef.current = true
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [setPinned])

  return { scrollRef, contentRef, isPinned, scrollToBottom }
}
