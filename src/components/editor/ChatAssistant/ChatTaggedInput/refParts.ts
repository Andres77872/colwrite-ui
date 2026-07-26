export type RefPart = {
  kind: 'document' | 'block';
  start: number;
  end: number;
  refText: string;
  docId?: string;
  blockId?: string;
  source?: 'this' | 'doc';
};

export function parseRefParts(text: string): Array<string | RefPart> {
  const parts: Array<string | RefPart> = [];
  if (!text) return [''];
  const pattern = /#doc\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)|#this\/([A-Za-z0-9_-]+)|#doc\/([A-Za-z0-9_-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const matchStart = match.index;
    const matchText = match[0];
    const matchEnd = matchStart + matchText.length;
    if (matchStart > lastIndex) parts.push(text.slice(lastIndex, matchStart));
    if (match[1] && match[2]) {
      parts.push({
        kind: 'block',
        start: matchStart,
        end: matchEnd,
        refText: matchText,
        docId: match[1],
        blockId: match[2],
        source: 'doc',
      });
    } else if (match[3]) {
      parts.push({
        kind: 'block',
        start: matchStart,
        end: matchEnd,
        refText: matchText,
        blockId: match[3],
        source: 'this',
      });
    } else if (match[4]) {
      parts.push({
        kind: 'document',
        start: matchStart,
        end: matchEnd,
        refText: matchText,
        docId: match[4],
      });
    }
    lastIndex = matchEnd;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
