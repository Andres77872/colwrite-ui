import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { Check, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  floatingMotion,
  menuItem,
  menuItemDestructive,
  menuLabel,
  menuSeparator,
  menuShortcut,
  menuSurface,
} from "./menuStyles"
import { quietCloseAutoFocus, useTriggerCapture } from "./quietFocus"

const DropdownMenu = DropdownMenuPrimitive.Root
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
const DropdownMenuGroup = DropdownMenuPrimitive.Group
const DropdownMenuPortal = DropdownMenuPrimitive.Portal
const DropdownMenuSub = DropdownMenuPrimitive.Sub
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

/** A row that opens a submenu; the chevron is added here, not by callers. */
const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(menuItem, "data-[state=open]:bg-hover", inset && "pl-8", className)}
    {...props}
  >
    {children}
    <ChevronRight aria-hidden="true" className="ml-auto text-muted-foreground" />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      className={cn(
        "z-[var(--z-popover)] min-w-[12rem] overflow-hidden",
        menuSurface,
        floatingMotion,
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, onCloseAutoFocus, ...props }, ref) => {
  const [getTrigger, setRefs] = useTriggerCapture(ref)
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={setRefs}
        sideOffset={sideOffset}
        className={cn(
          // Above the modal layer: a menu opened inside a Sheet or Dialog
          // must sit over its scrim, like any other popover.
          "z-[var(--z-popover)] min-w-[12rem] overflow-hidden",
          menuSurface,
          floatingMotion,
          className
        )}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          quietCloseAutoFocus(event, getTrigger())
        }}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
})
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
    /** Red label and icon for delete-style actions. */
    destructive?: boolean
  }
>(({ className, inset, destructive, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      menuItem,
      destructive && menuItemDestructive,
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

/**
 * A menu checkbox. Pass `toggle` for a setting that applies at once (Full
 * width, Small text): it then ends in a small switch that shows the off
 * state too, where a check alone would leave an unset row looking like a
 * plain action.
 */
const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem> & {
    toggle?: boolean
  }
>(({ className, children, toggle, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem ref={ref} className={cn(menuItem, "group/toggle", className)} {...props}>
    {children}
    {toggle ? (
      <span
        aria-hidden="true"
        className="ml-auto inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-muted-foreground/60 bg-muted-foreground/45 p-px transition-colors duration-120 group-data-[state=checked]/toggle:border-transparent group-data-[state=checked]/toggle:bg-primary-strong group-data-[state=checked]/toggle:forced-colors:border-[Highlight]"
      >
        <span className="h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-120 group-data-[state=checked]/toggle:translate-x-3 forced-colors:forced-color-adjust-none forced-colors:bg-[ButtonText] group-data-[state=checked]/toggle:forced-colors:bg-[Highlight]" />
      </span>
    ) : (
      <DropdownMenuPrimitive.ItemIndicator className="ml-auto flex items-center text-foreground">
        <Check aria-hidden="true" />
      </DropdownMenuPrimitive.ItemIndicator>
    )}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName

/**
 * A menu radio item styled like the plain item. By default state is carried
 * by `aria-checked` plus `data-[state=checked]` styling at the call site, so
 * segmented choices keep their own look; pass `indicator` for a plain list of
 * options (Appearance ▸ System / Light / Dark) with a trailing check.
 */
const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem> & {
    indicator?: boolean
  }
>(({ className, indicator, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem ref={ref} className={cn(menuItem, className)} {...props}>
    {children}
    {indicator && (
      <DropdownMenuPrimitive.ItemIndicator className="ml-auto flex items-center text-foreground">
        <Check aria-hidden="true" />
      </DropdownMenuPrimitive.ItemIndicator>
    )}
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(menuLabel, inset && "pl-8", className)}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn(menuSeparator, className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

/** Keyboard hint at the end of a row; decorative, the item's name is enough. */
const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span aria-hidden="true" className={cn(menuShortcut, className)} {...props} />
)
DropdownMenuShortcut.displayName = "DropdownMenuShortcut"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
}
