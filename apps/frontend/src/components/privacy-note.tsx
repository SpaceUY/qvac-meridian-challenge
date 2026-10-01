import { Lock } from 'lucide-react'

/** Bottom of the sidebar: the product's core promise, made visible. Only true while inference runs locally - App hides it when a peer is delegated. */
export function PrivacyNote() {
  return (
    <p className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2.5 text-xs text-muted-foreground">
      <Lock className="size-3.5 shrink-0 text-primary" aria-hidden />
      Private — runs on this device
    </p>
  )
}
