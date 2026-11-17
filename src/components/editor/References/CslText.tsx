import type { ReactNode } from 'react';
import type { CslMarkup, CslNode } from '@/editor';

const MARK_CLASS: Record<string, string> = {
  smallcaps: '[font-variant:small-caps]',
  upright: 'not-italic',
  regular: 'font-normal',
};

function node(value: CslNode, key: number, links: boolean): ReactNode {
  if (typeof value === 'string') return value;
  const children = value.children.map((child, index) => node(child, index, links));
  if ('link' in value) {
    return links ? (
      <a key={key} href={value.link} target="_blank" rel="noreferrer noopener" className="break-all text-link hover:underline">
        {children}
      </a>
    ) : (
      <span key={key}>{children}</span>
    );
  }
  switch (value.mark) {
    case 'i':
      return <i key={key}>{children}</i>;
    case 'b':
      return <b key={key}>{children}</b>;
    case 'sup':
      return <sup key={key}>{children}</sup>;
    case 'sub':
      return <sub key={key}>{children}</sub>;
    case 'underline':
      return <u key={key}>{children}</u>;
    default:
      return <span key={key} className={MARK_CLASS[value.mark]}>{children}</span>;
  }
}

/** What the citation processor printed, as React: its marks, and links to http(s) only. */
export function CslText({ markup, links = true }: { markup: CslMarkup; links?: boolean }) {
  return <>{markup.map((value, index) => node(value, index, links))}</>;
}
