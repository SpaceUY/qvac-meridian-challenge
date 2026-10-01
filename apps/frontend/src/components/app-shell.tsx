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

/**
 * The chassis of the entire screen: sidebar + chat, no top bar spanning both -
 * the app's identity lives inside the sidebar itself.
 * A fixed-width panel "open by default" leaves the chat with an illegible
 * remainder on a narrow window, so the panel opens only if, even open, the
 * chat still has a reasonable width to read.
 */
const MIN_CHAT_WIDTH = 420
/** Must match the aside's w-72 (18rem = 288px). */
const LEFT_PANEL_WIDTH = 288

function panelFits(windowWidth: number) {
  return windowWidth - LEFT_PANEL_WIDTH >= MIN_CHAT_WIDTH
}

export function AppShell({ leftSidebar, leftFooter, children }: Props) {
  const [leftOpen, setLeftOpen] = useState(() => panelFits(window.innerWidth))

  return (
    // overflow-hidden: whatever doesn't fit gets clipped here instead of scrolling the whole page.
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
        // Collapsed: the only way back is this same toggle, now floating on its own.
        <div className="flex shrink-0 p-3">
          <Button variant="ghost" size="icon" onClick={() => setLeftOpen(true)} aria-label="Expand sidebar">
            <PanelLeft className="size-4" />
          </Button>
        </div>
      )}
      {/* min-h-0: without this, main refuses to measure smaller than its content and the height chain breaks. */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
    </div>
  )
}
