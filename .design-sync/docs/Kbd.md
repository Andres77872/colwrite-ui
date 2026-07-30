---
category: Actions
keywords: [kbd, keycap, keyboard shortcut, key hint, shortcut, hotkey]
---

# Kbd

One keyboard key, rendered as a keycap: `<kbd>` with `inline-flex
min-w-[1.25em] items-center justify-center rounded-sm bg-secondary px-1 py-0.5
font-sans text-2xs text-secondary-foreground`.

Use it anywhere the UI names a key — the slash-menu footer, the assistant
composer hint, the shortcuts dialog. It exists because the same hint row was
written inline in two places with different surfaces and sizes and looked like
two different components. **Do not restyle it per site**; that is the bug this
replaced.

`min-w-[1.25em]` puts a floor under the cap so a narrow glyph (`/`, `↵`, `\`)
still reads as a key instead of a sliver, while `Shift` and `Enter` grow to their
label. `font-sans` is deliberate — a monospace keycap next to 10px body copy
looked like inline code, not a key.

## Usage

```jsx
// composer hint — one key per <Kbd>, the separators are plain text
<p className="text-2xs text-muted-foreground">
  <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a new line ·{' '}
  <Kbd>#</Kbd> to reference
</p>

// shortcut reference row
<span className="flex shrink-0 items-center gap-1">
  {['Ctrl', 'Shift', '\\'].map((part) => <Kbd key={part}>{part}</Kbd>)}
</span>
```

## Props

- `className` merges in. Rarely needed — the point of the component is that the
  keycap looks the same everywhere. `bg-muted` is the one legitimate swap, on a
  `bg-secondary` surface where the default cap would disappear.
- Standard attributes (`id`, `style`, `title`, `aria-*`, `data-*`) pass through —
  filtered from the emitted `.d.ts`, but supported.
- Forwards a ref to the `<kbd>` element.

## Composition

- **One key per `Kbd`.** A chord is several caps in a row: `<Kbd>Ctrl</Kbd>` +
  `<Kbd>S</Kbd>`, joined by `gap-1` on the parent or by a literal `+`. Never
  `<Kbd>Ctrl+S</Kbd>`.
- `<kbd>` is inline, so it is valid inside `<p>` and `<span>` — unlike `Badge`,
  which is a `<div>`. That is why hint lines use `Kbd` and not a small badge.
- Platform modifier: the app prints `⌘` on Apple platforms and `Ctrl` elsewhere
  (`modifierLabel()` in the shortcuts module). Never hardcode `⌘`.
- Arrow and return keys use glyphs — `↑↓`, `↵`, and the word `Esc` — matching the
  slash menu's footer.
- Hint rows sit at `text-2xs text-muted-foreground` on a `border-t` strip
  (`bg-card/30`) at the bottom of a menu, or directly under a composer.
- For a full list of bindings, use `ShortcutsDialog`, which already renders these
  rows.
