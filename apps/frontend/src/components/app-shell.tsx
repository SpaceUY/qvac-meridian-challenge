import { useState, type ReactNode } from 'react'
import { PanelLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  /** Left panel: corpus + engine status. */
  leftSidebar: ReactNode
  /** Center column: the chat. */
  children: ReactNode
}

/**
 * The chassis of the entire screen: sidebar + chat, no top bar spanning both -
 * the app's identity lives inside the sidebar itself, not in a strip that
 * cuts across the conversation too.
 * Left = everything about the assistant (what it knows, what it runs on).
 * Center = the conversation.
 */
/**
 * A fixed-width panel "open by default" leaves the chat with an illegible
 * remainder on a narrow window. Instead, the startup depends on how much
 * space there is: the panel opens only if, even open, the chat still has a
 * reasonable width to read.
 */
const MIN_CHAT_WIDTH = 420
const LEFT_PANEL_WIDTH = 224

function panelFits(windowWidth: number) {
  return windowWidth - LEFT_PANEL_WIDTH >= MIN_CHAT_WIDTH
}

export function AppShell({ leftSidebar, children }: Props) {
  const [leftOpen, setLeftOpen] = useState(() => panelFits(window.innerWidth))

  return (
    // overflow-hidden: whatever doesn't fit in the window gets clipped right
    // here, instead of pushing the document. This is what stops the whole
    // page from scrolling.
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {leftOpen ? (
        <aside className="flex w-56 shrink-0 flex-col border-r">
          {/* shrink-0: the title never scrolls away with the corpus/engine list below it. */}
          <div className="flex shrink-0 items-center gap-2 p-3">
            <Button variant="ghost" size="icon" onClick={() => setLeftOpen(false)} aria-label="Collapse sidebar">
              <PanelLeft className="size-4" />
            </Button>
            <strong className="text-base font-semibold tracking-tight">Meridian Assistant</strong>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 pt-0">{leftSidebar}</div>
        </aside>
      ) : (
        // Collapsed: the only way back is this same toggle, now floating on its own.
        <div className="flex shrink-0 p-3">
          <Button variant="ghost" size="icon" onClick={() => setLeftOpen(true)} aria-label="Expand sidebar">
            <PanelLeft className="size-4" />
          </Button>
        </div>
      )}
      {/* min-h-0: without this, main refuses to measure smaller than its
          content and the whole height chain breaks. See the plan's diagnosis. */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
    </div>
  )
}
