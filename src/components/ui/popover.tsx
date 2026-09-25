import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { cn } from "@/lib/utils"
import { floatingMotion } from "./menuStyles"
import { quietCloseAutoFocus, useTriggerCapture } from "./quietFocus"

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, onCloseAutoFocus, ...props }, ref) => {
  const [getTrigger, setRefs] = useTriggerCapture(ref)
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={setRefs}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-[var(--z-popover)] w-72 rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-lg outline-none forced-colors:border",
          floatingMotion,
          className
        )}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          quietCloseAutoFocus(event, getTrigger())
        }}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
