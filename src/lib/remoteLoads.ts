/**
 * Markup drawn from text the app does not control must load nothing from
 * another origin: a fetch the moment it renders tells that host who is
 * reading, and when, and carries whatever its URL was built to leak.
 *
 * Mermaid's strict mode keeps scripts and click handlers out, and DOMPurify
 * cleans what it returns, but both allow `http(s)` images: an image shape
 * (`A@{ img: "https://…" }`) or an HTML label's `<img>` is fetched as soon
 * as the SVG is in the page. This takes out every reference that would load
 * by itself — an image, a stylesheet, a frame, a CSS `url(…)` or `@import` —
 * unless it is inline (`data:`) or points inside the markup (`#id`). Links
 * stay: following one is the reader's choice.
 */

/**
 * Elements that only exist to load or run something, and the animation
 * elements, which can set an `href` after this has read it.
 */
const LOADING_ELEMENTS = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base',
  'audio', 'video', 'source', 'track', 'picture', 'portal',
  'animate', 'set', 'animatemotion', 'animatetransform', 'animatecolor', 'discard',
]);

/** Attributes whose value is fetched as the element renders. */
const LOADING_ATTRIBUTES = new Set([
  'src', 'srcset', 'poster', 'background', 'lowsrc', 'dynsrc', 'data', 'codebase', 'ping', 'action', 'formaction',
]);

/** Elements whose `href` is a resource to load, not a link to follow. */
const HREF_LOADS = new Set(['image', 'feimage', 'use', 'pattern', 'filter', 'textpath', 'tref', 'cursor', 'mpath']);

/** Inline, or inside the markup itself. */
function isLocal(value: string): boolean {
  const text = value.trim().replace(/^['"]|['"]$/g, '').trim();
  return text === '' || text.startsWith('#') || /^data:/i.test(text);
}

/** CSS with every `url(…)` that is not local, and every `@import`, taken out. */
function localCss(css: string): string {
  return css
    .replace(/@import\b[^;]*;?/gi, '')
    .replace(/url\(\s*([^)]*)\)/gi, (match, target: string) => (isLocal(target) ? match : 'none'));
}

/** `markup` with nothing left in it that loads from elsewhere; the same string when there was nothing. */
export function withoutRemoteLoads(markup: string): string {
  if (typeof document === 'undefined') return markup;
  const template = document.createElement('template');
  template.innerHTML = markup;
  let changed = false;

  for (const element of Array.from(template.content.querySelectorAll('*'))) {
    const name = element.localName.toLowerCase();
    if (LOADING_ELEMENTS.has(name)) {
      element.remove();
      changed = true;
      continue;
    }
    if (name === 'img' && !isLocal(element.getAttribute('src') ?? '')) {
      element.remove();
      changed = true;
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const key = attribute.name.toLowerCase();
      const local = key.split(':').pop() ?? key;
      const loads = LOADING_ATTRIBUTES.has(local) || (local === 'href' && HREF_LOADS.has(name));
      if (loads && !isLocal(attribute.value)) {
        element.removeAttributeNode(attribute);
        changed = true;
      } else if (key === 'style') {
        const css = localCss(attribute.value);
        if (css !== attribute.value) {
          element.setAttribute('style', css);
          changed = true;
        }
      }
    }
    if (name === 'style') {
      const css = localCss(element.textContent ?? '');
      if (css !== element.textContent) {
        element.textContent = css;
        changed = true;
      }
    }
  }
  return changed ? template.innerHTML : markup;
}
