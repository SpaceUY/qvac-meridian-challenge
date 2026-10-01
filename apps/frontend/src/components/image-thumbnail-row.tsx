import { X } from 'lucide-react'
import type { ImageAttachment } from '@/lib/image-attachments'

type Props = {
  images: ImageAttachment[]
  onRemove: (id: string) => void
  onPreview: (previewUrl: string) => void
}

/** Compact horizontal row of pending attachments, rendered above the Textarea inside the same composer surface - never grows the composer vertically beyond this one extra row. */
export function ImageThumbnailRow({ images, onRemove, onPreview }: Props) {
  if (images.length === 0) return null

  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto overflow-y-hidden px-1 pt-1">
      {images.map((image) => (
        <div key={image.id} className="group/thumb relative size-16 shrink-0">
          <button
            type="button"
            className="size-full overflow-hidden rounded-xl border border-border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => onPreview(image.previewUrl)}
            aria-label="View image"
          >
            <img src={image.previewUrl} alt="" className="size-full object-cover" />
          </button>
          {/* Inside the corner (not hanging off the edge), always visible enough to
              tap on touch, reinforced on hover/focus for desktop. */}
          <button
            type="button"
            className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-foreground text-background opacity-80 shadow-sm outline-none transition-opacity group-hover/thumb:opacity-100 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => onRemove(image.id)}
            aria-label="Remove image"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
