import { cn } from 'cn'

/** Meridian's logo: an arc over a meridian line, on the brand mint. Decorative - the name next to it is what screen readers read. Size it with a `size-*` class. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground', className)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className="size-[60%]">
        <path d="M4 18c3-9 13-9 16 0" />
        <path d="M12 4v14" />
      </svg>
    </span>
  )
}
