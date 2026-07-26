import { Fragment, memo, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Minimal markdown renderer for assistant replies.
 *
 * The agent writes in markdown — headings, lists, `code`, **emphasis** — and
 * rendering that as literal asterisks made every structured answer harder to
 * read than the plain prose it replaced.
 *
 * Deliberately builds React elements instead of HTML: model output is
 * untrusted text, and there is no `dangerouslySetInnerHTML` anywhere in this
 * path for it to escape through. The supported subset is small on purpose —
 * anything unrecognised falls through as the literal characters the model
 * wrote, which is always safe and usually what was meant.
 */

type InlineToken = { type: 'text' | 'code' | 'bold' | 'italic' | 'link'; value: string; href?: string };

const INLINE_PATTERN =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/g;

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) tokens.push({ type: 'text', value: text.slice(lastIndex, index) });

    const raw = match[0];
    if (raw.startsWith('`')) {
      tokens.push({ type: 'code', value: raw.slice(1, -1) });
    } else if (raw.startsWith('**') || raw.startsWith('__')) {
      tokens.push({ type: 'bold', value: raw.slice(2, -2) });
    } else if (raw.startsWith('[')) {
      const split = raw.indexOf('](');
      tokens.push({
        type: 'link',
        value: raw.slice(1, split),
        href: raw.slice(split + 2, -1),
      });
    } else {
      tokens.push({ type: 'italic', value: raw.slice(1, -1) });
    }
    lastIndex = index + raw.length;
  }

  if (lastIndex < text.length) tokens.push({ type: 'text', value: text.slice(lastIndex) });
  return tokens;
}

function renderInline(text: string): ReactNode {
  return tokenizeInline(text).map((token, index) => {
    switch (token.type) {
      case 'code':
        return (
          <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
            {token.value}
          </code>
        );
      case 'bold':
        return (
          <strong key={index} className="font-semibold">
            {token.value}
          </strong>
        );
      case 'italic':
        return <em key={index}>{token.value}</em>;
      case 'link':
        // Only http(s) survives: a `javascript:` href in model output would
        // otherwise become a one-click script execution.
        return /^https?:\/\//i.test(token.href ?? '') ? (
          <a
            key={index}
            href={token.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline underline-offset-2"
          >
            {token.value}
          </a>
        ) : (
          <Fragment key={index}>{token.value}</Fragment>
        );
      default:
        return <Fragment key={index}>{token.value}</Fragment>;
    }
  });
}

type Block =
  | { type: 'p'; lines: string[] }
  | { type: 'h'; level: 1 | 2 | 3; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'quote'; lines: string[] }
  | { type: 'pre'; code: string; lang?: string };

function parseBlocks(source: string): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      index++;
      continue;
    }

    // Fenced code. An unterminated fence is normal mid-stream, so it renders
    // as far as it has arrived rather than waiting for a closing marker.
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
      index++;
      blocks.push({ type: 'pre', code: code.join('\n'), lang: fence[1] || undefined });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'h', level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      index++;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ''));
        index++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ''));
        index++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ''));
        index++;
      }
      blocks.push({ type: 'quote', lines: quoted });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^(#{1,3}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|\s*>)/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index++;
    }
    blocks.push({ type: 'p', lines: paragraph });
  }

  return blocks;
}

export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = parseBlocks(text);

  return (
    <div className={cn('space-y-2 text-sm leading-relaxed [&>*:first-child]:mt-0', className)}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'h': {
            const Tag = (['h3', 'h4', 'h5'] as const)[block.level - 1];
            return (
              <Tag key={index} className="mt-3 font-semibold text-foreground">
                {renderInline(block.text)}
              </Tag>
            );
          }
          case 'ul':
            return (
              <ul key={index} className="ml-4 list-disc space-y-1 marker:text-muted-foreground">
                {block.items.map((item, i) => (
                  <li key={i}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={index} className="ml-4 list-decimal space-y-1 marker:text-muted-foreground">
                {block.items.map((item, i) => (
                  <li key={i}>{renderInline(item)}</li>
                ))}
              </ol>
            );
          case 'quote':
            return (
              <blockquote
                key={index}
                className="border-l-2 border-border pl-3 text-muted-foreground italic"
              >
                {renderInline(block.lines.join('\n'))}
              </blockquote>
            );
          case 'pre':
            return (
              <pre
                key={index}
                className="overflow-x-auto rounded-md border border-border bg-muted/60 p-2 font-mono text-xs"
              >
                <code>{block.code}</code>
              </pre>
            );
          default:
            return (
              <p key={index} className="whitespace-pre-wrap">
                {renderInline(block.lines.join('\n'))}
              </p>
            );
        }
      })}
    </div>
  );
});
