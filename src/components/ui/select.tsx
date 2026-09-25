import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Classes for the `<select>` itself; `className` sizes the whole control. */
  selectClassName?: string
}

/**
 * NativeSelect — a styled `<select>`, dressed like `Input`.
 *
 * Native on purpose: the options popup, type-to-select and the mobile picker
 * come for free. The popup follows `color-scheme`, which `lib/theme.ts` keeps
 * in step with the app theme. The closed control is drawn by us
 * (`appearance: none` plus our own chevron), so it looks the same on every
 * platform instead of carrying the OS arrow flush against the right edge.
 *
 * `className` goes on the wrapper, which is what a caller sizes (`w-40`);
 * the select fills it.
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, selectClassName, ...props }, ref) => (
    <span className={cn("relative flex w-full", className)}>
      <select
        ref={ref}
        className={cn(
          "peer h-8 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md bg-subtle pl-2 pr-8 text-sm text-foreground ring-1 ring-inset ring-border-strong forced-colors:border transition-shadow duration-120 hover:bg-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
          selectClassName
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-50"
      />
    </span>
  )
)
NativeSelect.displayName = "NativeSelect"

export { NativeSelect }
