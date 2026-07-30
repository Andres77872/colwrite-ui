import { BrandMark, Button } from 'colwrite-ui';
import { PanelLeft } from 'lucide-react';

// The "CW" tile on its own. Ported from Topbar (md), Canvas and the auth dialog
// (lg). The mark is aria-hidden — whatever sits next to it carries the name.

const SIZES = ['sm', 'md', 'lg', 'xl'] as const;

export function Sizes() {
  return (
    <div className="flex flex-wrap items-end gap-6">
      {SIZES.map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <BrandMark size={size} />
          <span className="font-mono text-2xs text-muted-foreground">{size}</span>
        </div>
      ))}
    </div>
  );
}

export function InTheTopbar() {
  return (
    <div className="flex h-11 w-full max-w-xl items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Toggle sidebar">
          <PanelLeft />
        </Button>
        <BrandMark size="md" />
        <span className="truncate text-base font-semibold">ColWrite</span>
      </div>
      <Button variant="ghost" size="sm">
        Account
      </Button>
    </div>
  );
}

export function OnTheSignInCard() {
  return (
    <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-xl">
      <div className="flex justify-center">
        <BrandMark size="lg" />
      </div>
      <p className="mt-3 text-lg font-semibold">Sign in to ColWrite</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Your documents, uploads and assistant chats stay with your account.
      </p>
      <Button className="mt-5 w-full">Continue</Button>
    </div>
  );
}

export function OnTheEmptyCanvas() {
  return (
    <div className="w-full max-w-xl rounded-xl border border-border/60 bg-card p-8">
      <div className="flex items-center gap-4">
        <BrandMark size="xl" />
        <div className="min-w-0">
          <p className="text-xl font-semibold">ColWrite</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Assistant writer for arXiv papers
          </p>
        </div>
      </div>
      <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
        Start a draft and the assistant can read your uploads, suggest citations, and rewrite a
        section without leaving the page.
      </p>
    </div>
  );
}
