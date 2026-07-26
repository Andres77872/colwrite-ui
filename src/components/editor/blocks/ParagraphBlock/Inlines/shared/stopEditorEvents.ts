/**
 * Stops a pointer or key event from reaching the surrounding contenteditable.
 *
 * Every widget lives inside a paragraph the browser considers editable.
 * Without this, clicking a button inside one moves the caret, and typing in a
 * field is intercepted by the paragraph's own key handling — which is what
 * made table cells eat arrow keys and let "/" open the command menu from
 * inside a caption.
 */
export const stopEditorEvents = {
  onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onKeyDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onPointerDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
} as const;
