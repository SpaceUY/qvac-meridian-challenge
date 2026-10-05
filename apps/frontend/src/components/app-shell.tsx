import { useState, type ReactNode } from 'react'
import { PanelLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/brand-mark'

type Props = {
  /** Left panel: new chat, corpus, engine status. Scrolls if it doesn't fit. */
  leftSidebar: ReactNode
  /** Pinned to the bottom of the left panel, outside the scroll. */
  leftFooter?: ReactNode
  /** Center column: the chat. */
  children: ReactNode
}

/** Sidebar opens by default only if the chat would still be readably wide alongside it. */
const MIN_CHAT_WIDTH = 420
/** Must match the aside's w-72 (18rem = 288px). */
const LEFT_PANEL_WIDTH = 288

function panelFits(windowWidth: number) {
  return windowWidth - LEFT_PANEL_WIDTH >= MIN_CHAT_WIDTH
}

export function AppShell({ leftSidebar, leftFooter, children }: Props) {
  const [leftOpen, setLeftOpen] = useState(() => panelFits(window.innerWidth))

  return (
    // overflow-hidden: clips instead of scrolling the whole page.
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {leftOpen ? (
        <aside className="flex w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
          <div className="flex shrink-0 items-center gap-2.5 px-4 pt-4 pb-5">
            <BrandMark />
            <strong className="flex-1 text-base font-semibold tracking-tight">Meridian Assistant</strong>
            <Button variant="ghost" size="icon" onClick={() => setLeftOpen(false)} aria-label="Collapse sidebar">
              <PanelLeft className="size-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{leftSidebar}</div>
          {leftFooter && <div className="shrink-0 px-4 pb-4">{leftFooter}</div>}
        </aside>
      ) : (
        // Only way back in once collapsed.
        <div className="flex shrink-0 p-3">
          <Button variant="ghost" size="icon" onClick={() => setLeftOpen(true)} aria-label="Expand sidebar">
            <PanelLeft className="size-4" />
          </Button>
        </div>
      )}
      {/* min-h-0: without it, main won't shrink below its content and the height chain breaks. */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
    </div>
  )
}
