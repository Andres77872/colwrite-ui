import * as React from "react"
import { cn } from "@/lib/utils"

interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/**
 * Switch — an on/off setting that applies at once (Full width, Small text).
 *
 * A `button` with `role="switch"`, so it is announced as a toggle with its
 * state and flips on Space/Enter; name it with `aria-label` or a `<label>`.
 */
const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, checked, onCheckedChange, onClick, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onCheckedChange(!checked)
      }}
      className={cn(
        "group/switch inline-flex h-4 w-7 shrink-0 items-center rounded-full border p-px transition-colors duration-120",
        // Off: a track plus a 1px edge, so the control clears 3:1 against the
        // surface (WCAG 1.4.11) instead of reading as disabled. The edge is a
        // border, not a ring, so it survives forced-colors mode.
        "border-muted-foreground/60 bg-muted-foreground/45 data-[state=checked]:border-transparent data-[state=checked]:bg-primary-strong",
        "data-[state=checked]:forced-colors:border-[Highlight]",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-120 group-data-[state=checked]/switch:translate-x-3 forced-colors:forced-color-adjust-none forced-colors:bg-[ButtonText] group-data-[state=checked]/switch:forced-colors:bg-[Highlight]"
      />
    </button>
  )
)
Switch.displayName = "Switch"

export { Switch }
