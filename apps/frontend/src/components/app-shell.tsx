import { useState, type ReactNode } from 'react'
import { PanelLeft, PanelRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  /** Left panel: the corpus. */
  leftSidebar: ReactNode
  /** Center column: the chat. */
  children: ReactNode
  /** Right panel: model, hardware, local/delegated. */
  rightSidebar: ReactNode
}

/**
 * The chassis of the entire screen: header + three columns.
 * Left = what it knows (corpus). Center = the conversation.
 * Right = how it does it (model, hardware, local/delegated).
 */
/**
 * With the two fixed panels (208px + 256px = 464px), a narrow window leaves
 * the chat with an illegible remainder. Instead of a fixed width "open by
 * default", the startup depends on how much space there is: each panel opens
 * only if, even open, the chat has a reasonable width to read.
 */
const MIN_CHAT_WIDTH = 420
const LEFT_PANEL_WIDTH = 208
const RIGHT_PANEL_WIDTH = 256

function bothFit(windowWidth: number) {
  return windowWidth - LEFT_PANEL_WIDTH - RIGHT_PANEL_WIDTH >= MIN_CHAT_WIDTH
}
function oneFits(windowWidth: number, panelWidth: number) {
  return windowWidth - panelWidth >= MIN_CHAT_WIDTH
}

export function AppShell({ leftSidebar, children, rightSidebar }: Props) {
  const [leftOpen, setLeftOpen] = useState(
    () => bothFit(window.innerWidth) || oneFits(window.innerWidth, LEFT_PANEL_WIDTH),
  )
  const [rightOpen, setRightOpen] = useState(() => bothFit(window.innerWidth))

  return (
    // overflow-hidden: whatever doesn't fit in the window gets clipped right
    // here, instead of pushing the document. This is what stops the whole
    // page from scrolling.
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* shrink-0: the header never gets squeezed, even if the center asks for space. */}
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <Button variant="ghost" size="icon" onClick={() => setLeftOpen((v) => !v)} aria-label="Corpus">
          <PanelLeft className="size-4" />
        </Button>
        <strong className="text-sm font-medium">Meridian Assistant</strong>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={() => setRightOpen((v) => !v)}
          aria-label="Model status"
        >
          <PanelRight className="size-4" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {leftOpen && <aside className="w-52 shrink-0 overflow-y-auto border-r p-3">{leftSidebar}</aside>}
        {/* min-h-0: without this, main refuses to measure smaller than its
            content and the whole height chain breaks. See the plan's diagnosis. */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
        {rightOpen && <aside className="w-64 shrink-0 overflow-y-auto border-l p-3">{rightSidebar}</aside>}
      </div>
    </div>
  )
}
