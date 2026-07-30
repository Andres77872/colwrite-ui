# Building with Colwrite UI

## Setup

Link `styles.css` and load `_ds_bundle.js`; components are on
`window.ColwriteUI.*`. **No provider is needed for the styling to work** — the
theme is plain CSS custom properties, not a React theme object, so a component
mounted anywhere renders correctly styled.

Four components do need a wrapper, because they read React context and throw
without it:

```jsx
<TooltipProvider>   {/* any Tooltip */}
<ToastProvider>     {/* anything calling useToast() */}
<ConfirmProvider>   {/* anything calling useConfirm() */}
```

`AppShell`, `Sidebar` and `Topbar` additionally need the app's own
`PanelsProvider` / `AuthProvider` / `ViewProvider` (also on the global). Prefer
composing your own frame out of `bg-card` regions over reaching for those three.

## The theme is single-mode dark

There is no light palette and no `dark:` variant — `@custom-variant dark` is
deliberately absent, so a `dark:` utility silently does nothing. The surface is
`#0a0a0f` with near-white text; shadows, the scrim and the chart series are all
tuned against it. Never write light-mode styles, and never set a white/light
background on a container holding DS components.

## Styling idiom: Tailwind CSS v4, with these token names

Style your own layout and glue with utility classes. The classes below are the
system's vocabulary — use these names rather than raw hex, and rather than
Tailwind's stock palette (`bg-slate-800`, `text-gray-400`) which is **not** in the
shipped stylesheet and will render as nothing.

| Family | Class names |
| --- | --- |
| Surfaces | `bg-background` `bg-card` `bg-popover` `bg-muted` `bg-accent` `bg-secondary` |
| Text | `text-foreground` `text-muted-foreground` `text-primary` `text-destructive` — plus the `-foreground` pair of any filled surface |
| Fills that carry white text | `bg-primary-strong` `bg-destructive-strong` (the base `primary`/`destructive` hues do not reach 4.5:1 against white at button text sizes) |
| Status | `success` `warning` `info` `destructive`, each with a `-foreground` pair |
| Borders / focus | `border-border` `border-input` `ring-ring` `outline-ring` |
| Type scale | `text-2xs`(10) `text-xs`(11) `text-sm`(13) `text-base`(14) `text-md`(15) `text-lg`(16) `text-xl`(20) `text-2xl`(28) `text-3xl`(36) `text-4xl`(48) |
| Fonts | `font-sans` `font-mono` |
| Radius | `rounded-sm`(6) `rounded-md`(10) `rounded-lg`(12) `rounded-xl`(16) `rounded-full` |
| Shadow | `shadow-sm` `shadow-md` `shadow-lg` `shadow-xl` |
| Motion | `animate-spin` `animate-shimmer` `animate-slide-in-up`, and `animate-in`/`animate-out` with `fade-in-0` `zoom-in-95` `slide-in-from-{top,bottom,left,right}-2` |
| Charts | `bg-series-1` … `bg-series-8` (a fixed categorical order — a hue belongs to a category), `border-chart-grid` `text-chart-axis` |
| Diffs | `bg-diff-add` `text-diff-add-fg` `bg-diff-remove` `text-diff-remove-fg` |

Stacking is not a Tailwind namespace, so read it through `var()` and use the
ordered scale rather than picking a number: `z-[var(--z-base)]`
`z-[var(--z-sticky)]` `z-[var(--z-chrome)]` `z-[var(--z-dropdown)]`
`z-[var(--z-floating)]` `z-[var(--z-modal-backdrop)]` `z-[var(--z-modal)]`
`z-[var(--z-popover)]` `z-[var(--z-toast)]` `z-[var(--z-tooltip)]`.

For durations use the plain utilities `duration-120` (fast), `duration-150`
(base) and `duration-200` (slow) — they are the same three values as the
`--transition-*` tokens, which exist for `var()` use inside CSS.

Standard Tailwind spacing, sizing, flex/grid and the `hover:`/`focus:`/`sm:`–`xl:`
variants are all available.

**Use named scale steps, not arbitrary values.** There is no Tailwind compiler at
render time — this stylesheet is prebuilt — so an arbitrary utility like
`w-[380px]`, `text-[13px]` or `mt-[3px]` is only present if some existing source
file already happened to use that exact string, and otherwise applies **nothing at
all**, silently. Reach for `w-80` / `max-w-sm` / `text-sm` / `mt-1` instead. The
few arbitrary forms that are guaranteed are the documented `var()` ones above
(`z-[var(--z-modal)]`, `duration-[var(--transition-base)]`).

## Where the truth is

- `styles.css` — the one stylesheet entry; it `@import`s the two files below.
- `tokens/tokens.css` — every token with the comment explaining why it exists.
  **Read this before choosing a colour.**
- `_ds_bundle.css` — the compiled utilities and component styles.
- `components/<group>/<Name>/<Name>.prompt.md` — per-component usage, and
  `<Name>.d.ts` for the prop contract. Native DOM attributes are filtered out of
  those `.d.ts` files but do pass through, so `<Input placeholder=… disabled />`
  is valid even though the interface does not list it.

## Idiomatic example

Library components for the controls; utility classes for your own layout.

```jsx
const { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge, Button } = window.ColwriteUI;

<Card className="max-w-md">
  <CardHeader>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <CardTitle>Attention Is All You Need</CardTitle>
        <CardDescription>Vaswani et al. · 2017</CardDescription>
      </div>
      <Badge variant="success">Ready</Badge>
    </div>
  </CardHeader>
  <CardContent>
    <p className="text-sm leading-relaxed text-muted-foreground">
      Extracted 14 pages. The assistant can cite from this reference.
    </p>
    <div className="mt-4 flex justify-end gap-2">
      <Button variant="ghost" size="sm">Remove</Button>
      <Button size="sm">Cite</Button>
    </div>
  </CardContent>
</Card>
```
