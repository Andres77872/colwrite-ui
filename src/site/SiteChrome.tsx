import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { BrandLockup } from '../components/common/Brand/Brand';
import { cn } from '../lib/utils';
import { DOCS_HOME, docHref } from '../docs/catalog';
import { SAMPLE_PAPER_HREF, SIGN_IN_HASH } from './links';

/**
 * The public site's header and footer: one definition for the landing page
 * (rendered by the app), the sample paper and the docs (rendered to static
 * HTML by vite.docs.ts), so they read as one site.
 *
 * Imported by the Vite config process: relative imports only, never `@/`.
 */

type Section = 'home' | 'docs' | 'sample';

const NAV = [
  { id: 'features', label: 'Features', href: '/#features' },
  { id: 'docs', label: 'Docs', href: DOCS_HOME },
  { id: 'sample', label: 'Sample paper', href: SAMPLE_PAPER_HREF },
] as const;

const navLink =
  'inline-flex h-8 items-center rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground aria-[current=page]:text-foreground';

export function SiteHeader({ section, signIn }: { section: Section; signIn: ReactNode }) {
  return (
    <header className="sticky top-0 z-[var(--z-chrome)] border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <a href="/" aria-label="ColWrite home" className="-ml-1 rounded-md p-1">
          <BrandLockup size="sm" />
        </a>
        <nav aria-label="Site" className="ml-auto flex items-center gap-0.5 sm:ml-4">
          {NAV.map((link) => (
            <a
              key={link.id}
              href={link.href}
              aria-current={section === link.id ? 'page' : undefined}
              className={cn(navLink, link.id !== 'docs' && 'hidden sm:inline-flex')}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center sm:ml-auto">{signIn}</div>
      </div>
    </header>
  );
}

const FOOTER_COLUMNS = [
  {
    heading: 'Product',
    links: [
      { label: 'Editor', href: '/#editor' },
      { label: 'Ask AI', href: '/#ai-actions' },
      { label: 'Review', href: '/#review' },
      { label: 'Research', href: '/#research' },
    ],
  },
  {
    heading: 'Docs',
    links: [
      { label: 'Quick start', href: docHref('quick-start') },
      { label: 'Citations and references', href: docHref('citations') },
      { label: 'Assistant chat', href: docHref('assistant') },
      { label: 'All docs', href: DOCS_HOME },
    ],
  },
  {
    heading: 'Try it',
    links: [
      { label: 'Read the sample paper', href: SAMPLE_PAPER_HREF },
      { label: 'Sign in', href: `/${SIGN_IN_HASH}` },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-sidebar/40">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div className="max-w-xs">
          <BrandLockup size="sm" />
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            A research writing workspace: draft, cite and review a paper with its evidence beside it.
          </p>
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
            Invite-only alpha
          </p>
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <nav key={column.heading} aria-label={`${column.heading} links`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{column.heading}</p>
            <ul className="mt-3 space-y-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className="text-sm text-foreground/85 transition-colors hover:text-foreground">
                    {link.label}
                    {link.href === SAMPLE_PAPER_HREF && (
                      <ArrowUpRight aria-hidden="true" className="ml-0.5 inline size-3.5 text-muted-foreground" />
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground sm:px-6">
          ColWrite is in alpha: features and data formats may change.
        </p>
      </div>
    </footer>
  );
}
