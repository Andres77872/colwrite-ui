import type { ReactNode } from 'react';
import { ExternalLink, FileDown, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { truncateAtSentence } from '@/lib/text';
import { safeExternalHttpUrl } from '@/lib/url';

export interface PaperCardProps {
  index: number;
  title: string | null;
  url?: string | null;
  authors?: string | null;
  /** Pre-formatted metadata fragments shown after the authors, e.g. date, version. */
  meta?: Array<string | null | undefined>;
  abstract?: string | null;
  /** Right-aligned marker in the card header, e.g. a relevance score or page number. */
  badge?: ReactNode;
  thumbnailUrl?: string | null;
  pdfUrl?: string | null;
  doi?: string | null;
  /** Human-readable label for the primary `url`, e.g. arXiv or Semantic Scholar. */
  primaryLinkLabel?: string;
  /** Provider-specific actions such as citation/reference graph exploration. */
  actions?: ReactNode;
  /** Provider-specific terms or provenance shown below the resource links. */
  notice?: ReactNode;
  expanded: boolean;
  onToggleExpanded: () => void;
  abstractPreviewChars?: number;
}

function ResourceLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: typeof ExternalLink;
  children: string;
}) {
  return (
    <a
      className="inline-flex items-center gap-1 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * PaperCard — one search result.
 *
 * The arXiv and ColPali panels rendered near-identical markup with subtly
 * different truncation, link sets and emoji labels. This is the single
 * treatment; panel-specific bits arrive as `badge` / `thumbnailUrl` / `meta`.
 */
export function PaperCard({
  index,
  title,
  url,
  authors,
  meta = [],
  abstract,
  badge,
  thumbnailUrl,
  pdfUrl,
  doi,
  primaryLinkLabel = 'Source',
  actions,
  notice,
  expanded,
  onToggleExpanded,
  abstractPreviewChars = 280,
}: PaperCardProps) {
  const fullAbstract = abstract?.trim() ?? '';
  const needsTruncation = fullAbstract.length > abstractPreviewChars;
  const shownAbstract = expanded
    ? fullAbstract
    : truncateAtSentence(fullAbstract, abstractPreviewChars);
  const metaParts = meta.filter((part): part is string => Boolean(part && part.trim()));
  const displayTitle = title?.trim() || 'Untitled';
  const sourceUrl = safeExternalHttpUrl(url);
  const downloadUrl = safeExternalHttpUrl(pdfUrl);
  const previewUrl = safeExternalHttpUrl(thumbnailUrl);

  return (
    <Card asChild className="p-3 transition-colors hover:border-border/80">
      <article>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">#{index}</span>
          {badge}
        </div>

        <h3 className="text-sm font-medium leading-snug">
          {sourceUrl ? (
            <a
              className="rounded-sm text-primary hover:underline"
              href={sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {displayTitle}
            </a>
          ) : (
            displayTitle
          )}
        </h3>

        {(authors || metaParts.length > 0) && (
          <p className="mt-1 text-xs text-muted-foreground">
            {[authors?.trim(), ...metaParts].filter(Boolean).join(' · ')}
          </p>
        )}

        {(fullAbstract || previewUrl) && (
          <div className="mt-2 flex gap-3">
            {previewUrl && (
              <img
                src={previewUrl}
                alt={`First matching page of “${displayTitle}”`}
                loading="lazy"
                className="h-28 w-20 shrink-0 rounded-sm bg-muted object-cover"
              />
            )}
            {fullAbstract && (
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-relaxed text-foreground/80">{shownAbstract}</p>
                {needsTruncation && (
                  <button
                    type="button"
                    className="mt-1 rounded-sm text-xs text-primary hover:underline"
                    onClick={onToggleExpanded}
                    aria-expanded={expanded}
                  >
                    {expanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {(sourceUrl || downloadUrl || doi || actions) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs">
            {sourceUrl && <ResourceLink href={sourceUrl} icon={ExternalLink}>{primaryLinkLabel}</ResourceLink>}
            {downloadUrl && <ResourceLink href={downloadUrl} icon={FileDown}>PDF</ResourceLink>}
            {doi && <ResourceLink href={`https://doi.org/${doi}`} icon={Link2}>DOI</ResourceLink>}
            {actions}
          </div>
        )}

        {notice && (
          <div className="mt-2 text-2xs leading-relaxed text-muted-foreground">
            {notice}
          </div>
        )}
      </article>
    </Card>
  );
}

/** Relevance score rendered as a percentage badge. */
export function ScoreBadge({ score }: { score?: number }) {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  return (
    <Badge variant="secondary" className="tabular-nums">
      {Math.round(score * 100)}% match
    </Badge>
  );
}

/** Source page number for a ColPali hit. */
export function PageBadge({ page }: { page?: number }) {
  if (typeof page !== 'number' || Number.isNaN(page)) return null;
  return (
    <Badge variant="secondary" className="tabular-nums">
      Page {page}
    </Badge>
  );
}
