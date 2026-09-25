import type { MutableRefObject } from 'react';
import type { Block, ParagraphChild } from '@/editor';
import { serializeEditableHtml } from '@/components/common/Editable/editableHtml';

type Options = {
  blockId: string;
  childId: string;
  isEmpty: (child: ParagraphChild) => boolean;
  refs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  getBlock: (id: string) => Block | undefined;
  removeParagraphChild: (blockId: string, childId: string) => void;
  updateHtml: (blockId: string, html: string) => void;
};

/** Frames to wait for React to render the widget, and for its panel to go. */
const MAX_FRAMES = 60;

/**
 * Open the editor of a widget the slash menu has just put in a paragraph.
 *
 * An empty equation or citation is inert until its panel is opened, and the
 * caret used to be left after it — so the LaTeX or search text typed next
 * went into the paragraph. This opens the widget's own popover as soon as it
 * renders (its trigger is the one control with `aria-haspopup="dialog"`) and
 * lets the popover move focus into its first field.
 *
 * When that first panel closes, the widget either kept something — the caret
 * goes just after it, so writing carries on — or it is still empty, and it is
 * taken back out, the way Notion drops an equation closed without maths.
 * Focus is only placed when the panel's own close left it nowhere in
 * particular: a click elsewhere, or a jump to the reference list, wins.
 */
export function openInlineEditor({
  blockId,
  childId,
  isEmpty,
  refs,
  getBlock,
  removeParagraphChild,
  updateHtml,
}: Options): void {
  const selector = `[data-child-id="${CSS.escape(childId)}"]`;
  let frames = 0;

  const start = () => {
    const host = refs.current[blockId]?.querySelector<HTMLElement>(selector);
    const trigger = host?.querySelector<HTMLElement>('[aria-haspopup="dialog"]');
    if (!host || !trigger) {
      if (++frames < MAX_FRAMES) requestAnimationFrame(start);
      return;
    }
    trigger.click();
    watch(host, trigger);
  };

  const watch = (host: HTMLElement, trigger: HTMLElement) => {
    let panelId = trigger.getAttribute('aria-controls');
    const observer = new MutationObserver(() => {
      if (trigger.getAttribute('aria-expanded') === 'true') {
        panelId = trigger.getAttribute('aria-controls') ?? panelId;
        return;
      }
      observer.disconnect();
      settle(host, trigger, panelId);
    });
    observer.observe(trigger, {
      attributes: true,
      attributeFilter: ['aria-expanded', 'aria-controls'],
    });
  };

  const settle = (host: HTMLElement, trigger: HTMLElement, panelId: string | null) => {
    const editable = refs.current[blockId];
    if (!editable || !host.isConnected) return;
    const child =
      getBlock(blockId)?.type === 'paragraph'
        ? (getBlock(blockId) as Extract<Block, { type: 'paragraph' }>).children?.find(
            (candidate) => candidate.id === childId,
          )
        : undefined;

    const spacer =
      host.nextSibling?.nodeType === Node.TEXT_NODE &&
      (host.nextSibling as Text).data.startsWith(' ')
        ? (host.nextSibling as Text)
        : null;
    const caret = document.createRange();

    if (child && isEmpty(child)) {
      caret.setStartBefore(host);
      caret.collapse(true);
      // The space insertInlineChild added so the caret had somewhere to land.
      if (spacer?.data === ' ') spacer.remove();
      else if (spacer) spacer.deleteData(0, 1);
      host.remove();
      removeParagraphChild(blockId, childId);
      updateHtml(blockId, serializeEditableHtml(editable));
    } else if (spacer) {
      caret.setStart(spacer, 1);
      caret.collapse(true);
    } else {
      caret.setStartAfter(host);
      caret.collapse(true);
    }

    // The popover hands focus back to its trigger once its exit animation
    // ends; wait for the panel to leave, then put the caret in the text.
    let waited = 0;
    const place = () => {
      const panelGone = !panelId || !document.getElementById(panelId);
      if (!panelGone && ++waited < MAX_FRAMES) {
        requestAnimationFrame(place);
        return;
      }
      const active = document.activeElement;
      const adrift =
        !active || active === document.body || active === trigger || host.contains(active);
      if (!adrift || !caret.startContainer.isConnected) return;
      editable.focus({ preventScroll: true });
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(caret);
    };
    requestAnimationFrame(place);
  };

  requestAnimationFrame(start);
}
