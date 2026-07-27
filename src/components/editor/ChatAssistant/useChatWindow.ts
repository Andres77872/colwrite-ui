import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';

/**
 * Geometry for the floating assistant, in pixels, measured from the
 * bottom-right corner of the canvas it lives in.
 *
 * Anchoring to the bottom-right rather than the top-left is what keeps the
 * panel where the author put it when the sidebar or tools panel is resized:
 * the canvas loses width on the left, and a top-left anchored window would
 * drift across the page every time.
 */
export type ChatRect = { right: number; bottom: number; width: number; height: number };

/** Which edges a pointer drag is moving. 'move' drags the whole window. */
export type DragMode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Below this the transcript stops being readable and the header wraps. */
export const CHAT_MIN_WIDTH = 300;
export const CHAT_MIN_HEIGHT = 260;

/** Clearance kept from the canvas edges, so the window never fouls its corners. */
export const CHAT_MARGIN = 12;

/** Pixels per arrow-key press when moving or resizing from the keyboard. */
const KEYBOARD_STEP = 16;

export const DEFAULT_CHAT_RECT: ChatRect = { right: 16, bottom: 16, width: 384, height: 540 };

export const isChatRect = (value: unknown): value is ChatRect => {
  if (typeof value !== 'object' || value === null) return false;
  const rect = value as Record<string, unknown>;
  return (['right', 'bottom', 'width', 'height'] as const).every(
    (key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]),
  );
};

/** `Math.min`/`max` in the wrong order silently inverts; this never does. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Apply a pointer or keyboard delta to the window.
 *
 * Works in canvas coordinates (the four edges) rather than in the stored
 * right/bottom insets, because that is the frame the constraints are actually
 * expressed in: an edge may not cross the opposite edge's minimum, and none of
 * them may leave the canvas.
 */
export function applyDrag(
  rect: ChatRect,
  mode: DragMode,
  dx: number,
  dy: number,
  canvasWidth: number,
  canvasHeight: number,
): ChatRect {
  // No measured canvas (first paint, or jsdom) — moving blind would throw the
  // window somewhere the author did not ask for.
  if (canvasWidth <= 0 || canvasHeight <= 0) return rect;

  let left = canvasWidth - rect.right - rect.width;
  let top = canvasHeight - rect.bottom - rect.height;
  let right = canvasWidth - rect.right;
  let bottom = canvasHeight - rect.bottom;

  if (mode === 'move') {
    left = clamp(left + dx, CHAT_MARGIN, canvasWidth - rect.width - CHAT_MARGIN);
    top = clamp(top + dy, CHAT_MARGIN, canvasHeight - rect.height - CHAT_MARGIN);
    right = left + rect.width;
    bottom = top + rect.height;
  } else {
    if (mode.includes('w')) left = clamp(left + dx, CHAT_MARGIN, right - CHAT_MIN_WIDTH);
    if (mode.includes('e')) right = clamp(right + dx, left + CHAT_MIN_WIDTH, canvasWidth - CHAT_MARGIN);
    if (mode.includes('n')) top = clamp(top + dy, CHAT_MARGIN, bottom - CHAT_MIN_HEIGHT);
    if (mode.includes('s')) bottom = clamp(bottom + dy, top + CHAT_MIN_HEIGHT, canvasHeight - CHAT_MARGIN);
  }

  return {
    right: canvasWidth - right,
    bottom: canvasHeight - bottom,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * Pull a stored window back inside a canvas that has since changed size.
 *
 * Collapsing the sidebar, opening the tools panel or simply making the browser
 * smaller can all leave a remembered window half outside the canvas — or, on a
 * narrow laptop, larger than the canvas itself.
 */
export function clampRect(rect: ChatRect, canvasWidth: number, canvasHeight: number): ChatRect {
  if (canvasWidth <= 0 || canvasHeight <= 0) return rect;

  const maxWidth = Math.max(canvasWidth - CHAT_MARGIN * 2, 0);
  const maxHeight = Math.max(canvasHeight - CHAT_MARGIN * 2, 0);
  const width = clamp(rect.width, Math.min(CHAT_MIN_WIDTH, maxWidth), maxWidth);
  const height = clamp(rect.height, Math.min(CHAT_MIN_HEIGHT, maxHeight), maxHeight);

  return {
    width,
    height,
    right: clamp(rect.right, CHAT_MARGIN, canvasWidth - width - CHAT_MARGIN),
    bottom: clamp(rect.bottom, CHAT_MARGIN, canvasHeight - height - CHAT_MARGIN),
  };
}

const sameRect = (a: ChatRect, b: ChatRect) =>
  a.right === b.right && a.bottom === b.bottom && a.width === b.width && a.height === b.height;

type ChatWindow = {
  rect: ChatRect;
  /** True while a pointer drag is in flight, for suppressing transitions. */
  dragging: boolean;
  /** Starts a pointer drag; attach to the header or to a resize handle. */
  beginDrag: (event: ReactPointerEvent, mode: DragMode) => void;
  /** Arrow-key equivalent of a drag, for the keyboard-operable handles. */
  nudge: (mode: DragMode, event: ReactKeyboardEvent) => boolean;
  /** Back to the default corner and size. */
  reset: () => void;
};

/**
 * useChatWindow — position and size for the floating assistant.
 *
 * The panel was previously pinned to the bottom-right corner with a single
 * "enlarge" toggle between two hard-coded sizes, so it always covered the same
 * part of the document — exactly the part an author wants to see while asking
 * about it.
 */
export function useChatWindow(
  panelRef: RefObject<HTMLElement | null>,
  { enabled }: { enabled: boolean },
): ChatWindow {
  const [rect, setRect] = usePersistentState<ChatRect>('chat.rect', DEFAULT_CHAT_RECT, isChatRect);
  const [dragging, setDragging] = useState(false);

  // Pointer moves arrive faster than React re-renders, so the drag reads the
  // live rect from a ref rather than from a captured render's closure.
  const rectRef = useRef(rect);
  useEffect(() => {
    rectRef.current = rect;
  }, [rect]);

  /** The canvas the window is positioned against — `main`, via `offsetParent`. */
  const canvas = useCallback((): { width: number; height: number } => {
    const parent = panelRef.current?.offsetParent as HTMLElement | null;
    if (!parent) return { width: 0, height: 0 };
    return { width: parent.clientWidth, height: parent.clientHeight };
  }, [panelRef]);

  const beginDrag = useCallback(
    (event: ReactPointerEvent, mode: DragMode) => {
      if (!enabled || event.button !== 0) return;
      // The whole header drags, but a drag started on one of its buttons would
      // swallow that button's click. The grip is itself a button, hence the
      // comparison against the element the handler is attached to.
      const button = (event.target as HTMLElement).closest('button');
      if (mode === 'move' && button && button !== event.currentTarget) return;

      event.preventDefault();
      const handle = event.currentTarget as HTMLElement;
      handle.setPointerCapture(event.pointerId);
      setDragging(true);

      const startX = event.clientX;
      const startY = event.clientY;
      const startRect = rectRef.current;
      const { width, height } = canvas();

      const onMove = (move: PointerEvent) => {
        setRect(applyDrag(startRect, mode, move.clientX - startX, move.clientY - startY, width, height));
      };

      const onEnd = () => {
        setDragging(false);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onEnd);
        handle.removeEventListener('pointercancel', onEnd);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onEnd);
      handle.addEventListener('pointercancel', onEnd);
    },
    [canvas, enabled, setRect],
  );

  const nudge = useCallback(
    (mode: DragMode, event: ReactKeyboardEvent): boolean => {
      if (!enabled) return false;
      const step = KEYBOARD_STEP * (event.shiftKey ? 4 : 1);
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const move = delta[event.key];
      if (!move) return false;

      const { width, height } = canvas();
      setRect((prev) => applyDrag(prev, mode, move[0], move[1], width, height));
      return true;
    },
    [canvas, enabled, setRect],
  );

  const reset = useCallback(() => setRect(DEFAULT_CHAT_RECT), [setRect]);

  // Keep the window inside a canvas that changed size under it.
  useEffect(() => {
    if (!enabled) return;
    const parent = panelRef.current?.offsetParent as HTMLElement | null;
    if (!parent) return;

    const fit = () => {
      const next = clampRect(rectRef.current, parent.clientWidth, parent.clientHeight);
      if (!sameRect(next, rectRef.current)) setRect(next);
    };

    fit();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [enabled, panelRef, setRect]);

  return { rect, dragging, beginDrag, nudge, reset };
}
