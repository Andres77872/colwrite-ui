import { scrollBehavior } from './motion';

const FLASH_CLASS = 'reveal-flash';
const FLASH_MS = 1400;

const pending = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * Bring something into view, mark it, and put focus on it.
 *
 * Scrolling on its own is a sighted-only affordance: follow a citation to its
 * reference with the keyboard and focus is still back in the paragraph, so the
 * next Tab walks away from the thing that was just revealed. The flash is what
 * says "this one" when the target lands among nine near-identical rows.
 *
 * Returns whether there was anything to reveal, so callers can fall back.
 */
export function revealElement(target: Element | null | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false;

  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  }

  const running = pending.get(target);
  if (running !== undefined) clearTimeout(running);
  target.classList.remove(FLASH_CLASS);
  // Flush the removal so re-adding restarts the animation rather than being
  // coalesced away — following the same link twice has to flash twice.
  target.getBoundingClientRect();
  target.classList.add(FLASH_CLASS);
  pending.set(
    target,
    setTimeout(() => {
      target.classList.remove(FLASH_CLASS);
      pending.delete(target);
    }, FLASH_MS),
  );

  if (typeof target.focus === 'function') target.focus({ preventScroll: true });
  return true;
}

/** Reveal the first match for `selector`, if the document has one. */
export function revealSelector(selector: string): boolean {
  if (typeof document === 'undefined') return false;
  try {
    return revealElement(document.querySelector(selector));
  } catch {
    return false;
  }
}
