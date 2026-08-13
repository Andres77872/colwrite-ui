import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { usePersistentState } from '@/hooks/usePersistentState';

/**
 * Geometry for the floating assistant, in pixels, measured from the
 * bottom-right corner of the viewport.
 *
 * Anchoring to the bottom-right rather than the top-left is what keeps the
 * panel where the author put it relative to their working corner — the corner
 * it returns to after a window resize — rather than drifting across the page
 * from the top-left every time the browser window changes size.
 */
export type ChatRect = { right: number; bottom: number; width: number; height: number };

/** Which edges a pointer drag is moving. 'move' drags the whole window. */
export type DragMode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Below this the transcript stops being readable and the header wraps. */
export const CHAT_MIN_WIDTH = 300;
export const CHAT_MIN_HEIGHT = 260;

/** Clearance kept from the viewport edges, so the window never fouls its corners. */
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
 * Honour a docked surface on the right only while doing so leaves a readable
 * assistant. On exceptionally cramped layouts it is better for the floating
 * window to overlap chrome than to collapse below its minimum width.
 */
function practicalRightInset(rightInset: number, viewportWidth: number): number {
  const inset = clamp(rightInset, 0, viewportWidth);
  return viewportWidth - inset >= CHAT_MIN_WIDTH + CHAT_MARGIN * 2 ? inset : 0;
}

/**
 * Apply a pointer or keyboard delta to the window.
 *
 * Works in viewport coordinates (the four edges) rather than in the stored
 * right/bottom insets, because that is the frame the constraints are actually
 * expressed in: an edge may not cross the opposite edge's minimum, and none of
 * them may leave the viewport.
 */
export function applyDrag(
  rect: ChatRect,
  mode: DragMode,
  dx: number,
  dy: number,
  viewportWidth: number,
  viewportHeight: number,
  rightInset = 0,
): ChatRect {
  // No measured viewport (first paint, or jsdom) — moving blind would throw the
  // window somewhere the author did not ask for.
  if (viewportWidth <= 0 || viewportHeight <= 0) return rect;

  const avoidedRight = practicalRightInset(rightInset, viewportWidth);
  const usableRight = viewportWidth - avoidedRight;
  let left = viewportWidth - rect.right - rect.width;
  let top = viewportHeight - rect.bottom - rect.height;
  let right = viewportWidth - rect.right;
  let bottom = viewportHeight - rect.bottom;

  if (mode === 'move') {
    left = clamp(left + dx, CHAT_MARGIN, usableRight - rect.width - CHAT_MARGIN);
    top = clamp(top + dy, CHAT_MARGIN, viewportHeight - rect.height - CHAT_MARGIN);
    right = left + rect.width;
    bottom = top + rect.height;
  } else {
    if (mode.includes('w')) left = clamp(left + dx, CHAT_MARGIN, right - CHAT_MIN_WIDTH);
    if (mode.includes('e')) right = clamp(right + dx, left + CHAT_MIN_WIDTH, usableRight - CHAT_MARGIN);
    if (mode.includes('n')) top = clamp(top + dy, CHAT_MARGIN, bottom - CHAT_MIN_HEIGHT);
    if (mode.includes('s')) bottom = clamp(bottom + dy, top + CHAT_MIN_HEIGHT, viewportHeight - CHAT_MARGIN);
  }

  return {
    right: viewportWidth - right,
    bottom: viewportHeight - bottom,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * Pull a stored window back inside a viewport that has since changed size.
 *
 * Making the browser smaller can leave a remembered window half outside the
 * viewport — or, on a narrow laptop, larger than the viewport itself.
 */
export function clampRect(
  rect: ChatRect,
  viewportWidth: number,
  viewportHeight: number,
  rightInset = 0,
): ChatRect {
  if (viewportWidth <= 0 || viewportHeight <= 0) return rect;

  const avoidedRight = practicalRightInset(rightInset, viewportWidth);
  const usableRight = viewportWidth - avoidedRight;
  const maxWidth = Math.max(usableRight - CHAT_MARGIN * 2, 0);
  const maxHeight = Math.max(viewportHeight - CHAT_MARGIN * 2, 0);
  const width = clamp(rect.width, Math.min(CHAT_MIN_WIDTH, maxWidth), maxWidth);
  const height = clamp(rect.height, Math.min(CHAT_MIN_HEIGHT, maxHeight), maxHeight);

  return {
    width,
    height,
    right: clamp(
      rect.right,
      avoidedRight + CHAT_MARGIN,
      viewportWidth - width - CHAT_MARGIN,
    ),
    bottom: clamp(rect.bottom, CHAT_MARGIN, viewportHeight - height - CHAT_MARGIN),
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
export function useChatWindow({ enabled }: { enabled: boolean }): ChatWindow {
  const [rect, setRect] = usePersistentState<ChatRect>('chat.rect', DEFAULT_CHAT_RECT, isChatRect);
  const [dragging, setDragging] = useState(false);

  // Pointer moves arrive faster than React re-renders, so the drag reads the
  // live rect from a ref rather than from a captured render's closure.
  const rectRef = useRef(rect);
  useEffect(() => {
    rectRef.current = rect;
  }, [rect]);

  /**
   * The bounds the window travels in: the whole viewport, not the canvas.
   * The panel is fixed-positioned (portaled out of `main`, whose
   * `overflow-hidden` would otherwise clip it), so it can be dragged over the
   * sidebar and topbar. The canvas's right edge is retained as a practical
   * boundary so the window does not default onto docked tools.
   */
  const bounds = useCallback((): { width: number; height: number; rightInset: number } => {
    const width = window.innerWidth;
    const workspace = document.querySelector('main');
    const workspaceRight = workspace?.getBoundingClientRect().right ?? width;

    return {
      width,
      height: window.innerHeight,
      // The assistant is portaled to <body>, but its default corner is still
      // the author's canvas corner. Reserving the space to the right of main
      // keeps both remembered and default positions off a docked tools panel.
      rightInset: Math.max(0, width - workspaceRight),
    };
  }, []);

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
      const { width, height, rightInset } = bounds();

      const onMove = (move: PointerEvent) => {
        setRect(
          applyDrag(
            startRect,
            mode,
            move.clientX - startX,
            move.clientY - startY,
            width,
            height,
            rightInset,
          ),
        );
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
    [bounds, enabled, setRect],
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

      const { width, height, rightInset } = bounds();
      setRect((prev) => applyDrag(prev, mode, move[0], move[1], width, height, rightInset));
      return true;
    },
    [bounds, enabled, setRect],
  );

  const reset = useCallback(() => {
    const { width, height, rightInset } = bounds();
    setRect(clampRect(DEFAULT_CHAT_RECT, width, height, rightInset));
  }, [bounds, setRect]);

  // Keep the window inside a viewport that changed size under it.
  useEffect(() => {
    if (!enabled) return;

    const fit = () => {
      const { width, height, rightInset } = bounds();
      const next = clampRect(rectRef.current, width, height, rightInset);
      if (!sameRect(next, rectRef.current)) setRect(next);
    };

    fit();
    window.addEventListener('resize', fit);
    const workspace = document.querySelector('main');
    const observer = workspace && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(fit)
      : null;
    if (workspace) observer?.observe(workspace);

    return () => {
      window.removeEventListener('resize', fit);
      observer?.disconnect();
    };
  }, [bounds, enabled, setRect]);

  return { rect, dragging, beginDrag, nudge, reset };
}
