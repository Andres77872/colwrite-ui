/**
 * Reading a widget placeholder's id out of a paragraph's html.
 *
 * The html is serialized markup, so an id with `&`, `<`, `>` or `"` in it is
 * escaped there (`data-child-id="cite&amp;one"`), while `children` names the
 * widget by the id itself (`cite&one`). Compared as written, the two never
 * matched: the widget counted as an orphan and was dropped on the next save.
 * The sanitizer writes every placeholder with double quotes, so that is the
 * form read here.
 */

const CHILD_ID_RE = /data-child-id="([^"]+)"/g;

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** An attribute value as the text it stands for. */
export function attributeText(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(?:#x([0-9a-f]{1,6})|#(\d{1,7})|(amp|lt|gt|quot|apos));/gi, (match, hex?: string, dec?: string, name?: string) => {
    if (name) return NAMED[name.toLowerCase()] ?? match;
    const code = hex ? Number.parseInt(hex, 16) : Number(dec);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Ids of a paragraph's widget placeholders, in the order they appear in its text. */
export function placeholderIdList(html: string): string[] {
  const ids: string[] = [];
  for (const [, id] of html.matchAll(CHILD_ID_RE)) if (id) ids.push(attributeText(id));
  return ids;
}
