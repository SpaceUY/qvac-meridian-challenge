import type { CSSProperties } from 'react'
import { CircleCheck, OctagonX, TriangleAlert } from 'lucide-react'
import { Toaster as SonnerToaster } from 'sonner'

// Tuned for the dark theme only: index.html pins class="dark" on <html>, and the
// 400 text tones would be unreadable on a light tint.
// Literals copied from tailwindcss/theme.css - Tailwind only emits a color variable
// when some class uses it, so var(--color-emerald-400) may not exist.
const EMERALD_500 = 'oklch(69.6% 0.17 162.48)'
const EMERALD_400 = 'oklch(76.5% 0.177 163.223)'
const AMBER_500 = 'oklch(76.9% 0.188 70.08)'
const AMBER_400 = 'oklch(82.8% 0.189 84.429)'
const DESTRUCTIVE = 'var(--destructive)'

const TINT_PERCENT = 15

/** The color diluted into the page background. oklab, not oklch: the background is a gray whose hue is 0, and an oklch mix would average that hue in and turn every tint red. */
function tint(color: string, percent: number): string {
  return `color-mix(in oklab, ${color} ${percent}%, var(--background))`
}

// Inline on the toaster element on purpose: Sonner declares these same variables
// there with a two-attribute selector, and an inline style beats any stylesheet rule.
const THEME = {
  '--success-bg': tint(EMERALD_500, TINT_PERCENT),
  '--success-border': tint(EMERALD_500, TINT_PERCENT * 2),
  '--success-text': EMERALD_400,
  '--warning-bg': tint(AMBER_500, TINT_PERCENT),
  '--warning-border': tint(AMBER_500, TINT_PERCENT * 2),
  '--warning-text': AMBER_400,
  '--error-bg': tint(DESTRUCTIVE, TINT_PERCENT),
  '--error-border': tint(DESTRUCTIVE, TINT_PERCENT * 2),
  '--error-text': DESTRUCTIVE,
  '--border-radius': 'var(--radius)',
  fontFamily: 'var(--font-sans)',
} as CSSProperties

/** Sonner's Toaster dressed in the app's theme. Mount once, like Sonner's own. Icons take the text color (currentColor). */
export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="top-center"
      richColors
      style={THEME}
      toastOptions={{ style: { fontSize: '14px' } }}
      icons={{
        success: <CircleCheck className="size-4" />,
        warning: <TriangleAlert className="size-4" />,
        error: <OctagonX className="size-4" />,
      }}
    />
  )
}
