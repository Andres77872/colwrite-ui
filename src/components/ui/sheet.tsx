import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cn } from "@/lib/utils"
import { quietCloseAutoFocus, quietOpenAutoFocus, useTriggerCapture } from "./quietFocus"

/**
 * Sheet — a dialog anchored to an edge rather than centred.
 *
 * `AppShell` used to hand-roll this: `role="dialog" aria-modal="true"` with a
 * manual Escape listener and a body-scroll lock, but no initial focus, no focus
 * trap and no focus restore — so on a phone, opening the navigation drawer left
 * keyboard focus behind it on the canvas. Radix supplies all three, and the
 * scrim stops being a full-screen `<button>` that readers announce.
 *
 * It cannot reuse `ui/dialog.tsx`: that centres its content with a grid on the
 * overlay, which fights an edge-anchored panel.
 */
const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: "left" | "right"
  /** Names the sheet for assistive tech; rendered visually hidden. */
  title: string
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ className, children, side = "left", title, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
  const [getTrigger, setRefs] = useTriggerCapture(ref)
  return (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 bg-scrim z-[var(--z-modal-backdrop)]",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      )}
    />
    <DialogPrimitive.Content
      ref={setRefs}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event)
        quietOpenAutoFocus(event)
      }}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event)
        quietCloseAutoFocus(event, getTrigger())
      }}
      className={cn(
        "fixed inset-y-0 flex w-[min(20rem,85vw)] flex-col bg-card text-card-foreground shadow-xl outline-none forced-colors:border",
        "z-[var(--z-modal)]",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        side === "left"
          ? "left-0 data-[state=open]:slide-in-from-left-2"
          : "right-0 data-[state=open]:slide-in-from-right-2",
        className
      )}
      {...props}
    >
      <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
  )
})
SheetContent.displayName = "SheetContent"

export { Sheet, SheetTrigger, SheetClose, SheetContent }
