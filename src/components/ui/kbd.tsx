import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Kbd — a keyboard key in help text.
 *
 * Written inline in two places with different surfaces (`bg-secondary` in the
 * slash menu, `bg-muted` in the chat composer) and different sizes, so the same
 * hint row looked like two different components depending on where it appeared.
 */
const Kbd = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <kbd
      ref={ref}
      className={cn(
        "inline-flex min-w-[1.5em] items-center justify-center rounded-xs bg-secondary px-1 py-px font-sans text-2xs font-medium text-secondary-foreground",
        className
      )}
      {...props}
    />
  )
)
Kbd.displayName = "Kbd"

export { Kbd }
