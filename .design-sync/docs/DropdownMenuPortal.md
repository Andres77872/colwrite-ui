---
category: Overlays
keywords: [dropdown, portal, container, document.body, stacking, forceMount]
---

# DropdownMenuPortal

Radix's portal for menu content. It moves whatever it wraps out of the React tree
it is written in and into `document.body` — or into a `container` you name.

**You almost never need it for `DropdownMenuContent`**: that component already
renders inside its own `DropdownMenuPortal`. What this export is for is
`DropdownMenuSubContent`, which this DS ships *without* a portal.

## Usage

```jsx
{/* Submenu panel out of the parent menu's DOM and onto document.body. */}
<DropdownMenuSub>
  <DropdownMenuSubTrigger>
    <Folder /> Move to collection
    <ChevronRight className="ml-auto" />
  </DropdownMenuSubTrigger>
  <DropdownMenuPortal>
    <DropdownMenuSubContent className="min-w-[12rem]">…</DropdownMenuSubContent>
  </DropdownMenuPortal>
</DropdownMenuSub>
```

```jsx
{/* Into a container you own — e.g. a fullscreen element, where document.body
    is not in the rendered subtree. */}
<DropdownMenuPortal container={fullscreenRef.current}>
  <DropdownMenuSubContent>…</DropdownMenuSubContent>
</DropdownMenuPortal>
```

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `container` | `Element \| DocumentFragment` | Portal target. Defaults to `document.body`. |
| `forceMount` | `true` | Keep the subtree mounted while the menu is closed, for an external animation library. `DropdownMenuContent`/`SubContent` need their own `forceMount` too. |

## When it changes anything

- **Stacking / clipping.** The panel escapes any `overflow: hidden` or
  `transform`-created containing block between it and the body.
- **A `container` of your own.** A fullscreen element, a shadow host, or a print
  root will not show body-portalled content — name the container instead.
- **Nesting.** Each level of a nested submenu needs its own portal if you want all
  of them on the body; wrapping the outer one does not carry the inner one.

Positioning does not need it: floating-ui measures through a transformed
ancestor, so an unportalled `DropdownMenuSubContent` lands in the same place as a
portalled one. Choose on stacking, not on placement.

## Notes

- Wrapping `DropdownMenuContent` in a second portal is harmless but pointless —
  the inner one still ends up on the body. Only pass a `container` if you need to
  redirect it, and note that you cannot do that through this export for the root
  panel; the root's portal is internal.
- Portalled content leaves the DOM tree but **not** the React tree: context,
  event bubbling through React, and the menu's keyboard scope all still work.
- Anything portalled to the body sits outside your app's CSS scoping. The panel
  brings its own token classes, so it stays styled — but a style you inherited
  from an ancestor (a font size on a panel, say) will not follow it.
- `forceMount` renders the panel while `data-state="closed"`, which the exit
  animation styles as invisible. Only reach for it with an animation library that
  drives presence itself.

## See also

`DropdownMenuSubContent` · `DropdownMenuSub` · `DropdownMenuContent` ·
`DropdownMenu`
