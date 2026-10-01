import type { ReactNode } from 'react'

/** A titled group in the left sidebar ("KNOWLEDGE", "INFERENCE", "PEERS"). Same caps treatment as the corpus modal's group headers in document-grid.tsx, so the sidebar and the modal read as one design system. */
export function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-0.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}
