// Keeps the view glued to the bottom of a scrolling box while new content
// arrives — unless the user scrolled up, in which case it gets out of the way.

import { useCallback, useEffect, useRef, useState } from 'react'

/** How far from the bottom still counts as "the user is at the bottom". */
const PIN_THRESHOLD_PX = 64

function distanceFromBottom(element: HTMLElement): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight
}

export function useStickToBottom<S extends HTMLElement, C extends HTMLElement>() {
  const scrollRef = useRef<S>(null)
  const contentRef = useRef<C>(null)
  // Two copies of the same truth, on purpose: the ref is what the listeners
  // read (always current, never triggers a render), the state is what React
  // reads to show or hide the button.
  const isPinnedRef = useRef(true)
  const [isPinned, setIsPinned] = useState(true)
  // Set while scrollToBottom's smooth-scroll animation is in flight, so the
  // scroll listener below can tell "the user scrolled" apart from "the
  // animation we started is still moving toward the bottom".
  const isAutoScrollingRef = useRef(false)

  const setPinned = useCallback((value: boolean) => {
    isPinnedRef.current = value
    setIsPinned(value)
  }, [])

  // 1. What the user wants. Every scroll — wheel, trackpad, keyboard, and our
  //    own programmatic one — ends up here asking the same question.
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const handleScroll = () => {
      const atBottom = distanceFromBottom(element) <= PIN_THRESHOLD_PX
      if (isAutoScrollingRef.current) {
        if (atBottom) isAutoScrollingRef.current = false // the animation arrived
        return // ignore intermediate events while it's still animating
      }
      setPinned(atBottom)
    }
    element.addEventListener('scroll', handleScroll, { passive: true })
    return () => element.removeEventListener('scroll', handleScroll)
  }, [setPinned])

  // 2. When the content grew. A new token does NOT fire a scroll event:
  //    scrollTop did not move, the floor did. Only a ResizeObserver sees it.
  useEffect(() => {
    const element = scrollRef.current
    const content = contentRef.current
    if (!element || !content) return

    const observer = new ResizeObserver(() => {
      // Instant, not smooth: a smooth scroll per token would fight the next one.
      if (isPinnedRef.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    // Pin first: if the content is still growing, the observer takes over from
    // here and keeps following, instead of landing short.
    setPinned(true)
    isAutoScrollingRef.current = true
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [setPinned])

  return { scrollRef, contentRef, isPinned, scrollToBottom }
}
