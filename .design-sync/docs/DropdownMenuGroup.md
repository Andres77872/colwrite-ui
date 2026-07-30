---
category: Overlays
keywords: [dropdown, menu group, section, role group, grouping, semantics]
---

# DropdownMenuGroup

A semantic wrapper for a set of related items: `role="group"` and nothing else —
no padding, no border, no spacing. It exists so a section of a menu is announced
as a section, and so the items that belong together stay together when the menu
is edited later.

Grouping is not visual. The *look* of a section comes from
`DropdownMenuLabel` + `DropdownMenuSeparator`; the group is the semantics under
them.

## Usage

```jsx
<DropdownMenuContent side="right" align="start" className="w-56">
  <DropdownMenuLabel>Paragraph</DropdownMenuLabel>
  <DropdownMenuSeparator />

  {/* The three block toggles are one unit. */}
  <DropdownMenuGroup>
    <DropdownMenuItem onSelect={toggleAiHidden}>
      <EyeOff /> Hide from assistant
    </DropdownMenuItem>
    <DropdownMenuItem onSelect={toggleLocked}>
      <Lock /> Lock block
    </DropdownMenuItem>
    <DropdownMenuItem onSelect={toggleCollapsed}>
      <ChevronRight /> Collapse
    </DropdownMenuItem>
  </DropdownMenuGroup>

  {/* Delete is deliberately outside the group, behind a rule. */}
  <DropdownMenuSeparator />
  <DropdownMenuItem
    className="text-destructive focus:bg-destructive/10 focus:text-destructive"
    onSelect={removeBlock}
  >
    <Trash2 /> Delete block
  </DropdownMenuItem>
</DropdownMenuContent>
```

## Props

| Prop | Type | Notes |
| --- | --- | --- |
| `asChild` | `boolean` | Render your own element with the group semantics. |
| `className` | `string` | Nothing to override by default; use it only if a section genuinely needs its own box. |

Standard div attributes pass through, including `aria-label` — worth setting when
a group has no visible label. They are filtered from the emitted `.d.ts`.

## Notes

- Put the label **inside** the group so it is read as the group's heading, then
  the section's own separator inside the group as well. The AI actions menu maps
  each action group to one `DropdownMenuGroup` holding
  `[separator?, label, ...items]`, which keeps a whole section addable or
  removable in one place.
- A group does not create a focus scope: arrow keys move across group boundaries
  as if the groups were not there, which is correct — grouping is about meaning,
  not navigation.
- For a set of items where exactly one is selected, use `DropdownMenuRadioGroup`
  instead; it is a group that also carries the current `value`.
- Do not add spacing classes to a group to fake a section break — the separator
  already owns that 8px rhythm, and a group with its own margin puts the rule in
  the wrong place.

## See also

`DropdownMenu` · `DropdownMenuContent` · `DropdownMenuLabel` ·
`DropdownMenuSeparator` · `DropdownMenuRadioGroup` · `DropdownMenuItem`
