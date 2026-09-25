import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Globe, Hash, Mail, Phone } from 'lucide-react';
import { useEditor } from '@/editor';
import { serializeEditableHtml } from '@/components/common/Editable/editableHtml';
import { EDIT_LINK_EVENT, describeHref, normalizeHref, openLinkInNewTab } from './linkHref';

const SHOW_DELAY = 350;
const HIDE_DELAY = 200;
const GAP = 6;
const MARGIN = 8;

type Card = { anchor: HTMLAnchorElement; rect: DOMRect };

function linkFrom(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest<HTMLAnchorElement>('.editable a[href]') : null;
}

/** Where a stored href really points — older links were saved without a scheme. */
function resolvedHref(anchor: HTMLAnchorElement): string | null {
  const raw = anchor.getAttribute('href') ?? '';
  const result = normalizeHref(raw);
  return result.ok ? result.href : null;
}

/** The line box of the link nearest the pointer: a wrapped link has several. */
function rectNear(anchor: HTMLAnchorElement, y?: number): DOMRect {
  const rects = Array.from(anchor.getClientRects());
  if (y !== undefined) {
    const hit = rects.find((rect) => y >= rect.top - 2 && y <= rect.bottom + 2);
    if (hit) return hit;
  }
  return rects[0] ?? anchor.getBoundingClientRect();
}

/**
 * The card a link in the page shows on hover (or on a tap): where it goes,
 * and Open, Edit and Remove — the same surface and type as the citation
 * hover card, so the two read as one family.
 *
 * Links in the text used to be dead ends: a contenteditable swallows the
 * click, and nothing showed the target, so a link could be added but never
 * followed or checked. Ctrl/⌘+click opens the link in a new tab directly.
 */
export function LinkHoverCard() {
  const { refs, updateHtml } = useEditor();
  const [card, setCard] = useState<Card | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const current = useRef<HTMLAnchorElement | null>(null);

  const hide = useCallback(() => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
    current.current = null;
    setCard(null);
  }, []);

  const show = useCallback((anchor: HTMLAnchorElement, y?: number) => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
    current.current = anchor;
    setCard({ anchor, rect: rectNear(anchor, y) });
  }, []);

  useEffect(() => {
    const scheduleHide = () => {
      window.clearTimeout(showTimer.current);
      if (!current.current) return;
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(hide, HIDE_DELAY);
    };

    const onOver = (event: MouseEvent) => {
      if (cardRef.current?.contains(event.target as Node)) {
        window.clearTimeout(hideTimer.current);
        return;
      }
      const anchor = linkFrom(event.target);
      if (!anchor) {
        scheduleHide();
        return;
      }
      window.clearTimeout(hideTimer.current);
      if (current.current === anchor) return;
      window.clearTimeout(showTimer.current);
      const y = event.clientY;
      showTimer.current = window.setTimeout(() => show(anchor, y), SHOW_DELAY);
    };

    const onClick = (event: MouseEvent) => {
      const anchor = linkFrom(event.target);
      if (!anchor) return;
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        const href = resolvedHref(anchor);
        if (href) openLinkInNewTab(href);
        return;
      }
      // A tap has no hover: clicking a link shows its card at once.
      if (!window.getSelection()?.isCollapsed) return;
      show(anchor, event.clientY);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (cardRef.current?.contains(event.target as Node)) return;
      if (linkFrom(event.target) === current.current && current.current) return;
      hide();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Holding Ctrl/⌘ is how a link is opened; it must not close the card.
      if (!current.current || ['Control', 'Meta', 'Shift', 'Alt'].includes(event.key)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
      if (!cardRef.current?.contains(document.activeElement)) hide();
      else if (event.key === 'Escape') hide();
    };

    document.addEventListener('mouseover', onOver);
    document.addEventListener('click', onClick, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.clearTimeout(showTimer.current);
      window.clearTimeout(hideTimer.current);
    };
  }, [hide, show]);

  // Below the link, as the citation card sits; above it near the bottom.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!card || !el) {
      setPos(null);
      return;
    }
    const { rect } = card;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - width - MARGIN));
    const below = rect.bottom + GAP;
    const top =
      below + height + MARGIN > window.innerHeight && rect.top - GAP - height > MARGIN
        ? rect.top - GAP - height
        : below;
    setPos({ top, left });
  }, [card]);

  if (!card || !card.anchor.isConnected) return null;

  const { anchor } = card;
  const href = resolvedHref(anchor);
  const raw = anchor.getAttribute('href') ?? '';
  const described = href ? describeHref(href) : null;
  const editable = anchor.closest<HTMLElement>('.editable');
  // A locked or read-only block offers Open only. (`isContentEditable` is
  // undefined where it is not implemented; the attribute decides there.)
  const editableAllowed =
    Boolean(editable) &&
    editable?.getAttribute('contenteditable') !== 'false' &&
    (editable?.isContentEditable ?? true);
  const Icon =
    described?.kind === 'mail'
      ? Mail
      : described?.kind === 'phone'
        ? Phone
        : described?.kind === 'anchor'
          ? Hash
          : Globe;

  const blockIdOf = (el: HTMLElement | null) =>
    el ? (Object.entries(refs.current ?? {}).find(([, dom]) => dom === el)?.[0] ?? null) : null;

  const edit = () => {
    if (!editable) return;
    hide();
    window.dispatchEvent(new CustomEvent(EDIT_LINK_EVENT));
    editable.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(anchor);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const remove = () => {
    const id = blockIdOf(editable);
    const parent = anchor.parentNode;
    hide();
    if (!parent || !editable || !id) return;
    while (anchor.firstChild) parent.insertBefore(anchor.firstChild, anchor);
    parent.removeChild(anchor);
    updateHtml(id, serializeEditableHtml(editable as HTMLDivElement));
  };

  return createPortal(
    <div
      ref={cardRef}
      role="group"
      aria-label="Link"
      className="link-hover-card fixed z-[var(--z-floating)] w-[20rem] max-w-[calc(100vw-16px)] rounded-lg border border-border bg-popover text-sm text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
      onMouseLeave={() => {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(hide, HIDE_DELAY);
      }}
      // Clicking the card must not move the caret or collapse a selection.
      onMouseDown={(event) => {
        if (!(event.target as Element).closest('a')) event.preventDefault();
      }}
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium leading-snug">
            {described ? described.title : 'Unsupported link'}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={described?.url ?? raw}>
            {described?.url ?? raw}
          </p>
          <div className="mt-1.5 flex items-center gap-3 text-xs">
            {href && (
              <a
                href={href}
                target={described?.kind === 'anchor' ? undefined : '_blank'}
                rel="noopener noreferrer"
                title={`Open in a new tab (${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}+click)`}
                onClick={(event) => {
                  event.preventDefault();
                  openLinkInNewTab(href);
                  hide();
                }}
                className="-my-1 inline-flex items-center gap-1 py-1 text-link hover:underline"
              >
                Open
                <ExternalLink aria-hidden="true" className="h-3 w-3" />
              </a>
            )}
            {editableAllowed && (
              <>
                <button
                  type="button"
                  onClick={edit}
                  className="-my-1 py-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={remove}
                  className="-my-1 py-1 text-muted-foreground transition-colors hover:text-destructive"
                >
                  Remove
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
