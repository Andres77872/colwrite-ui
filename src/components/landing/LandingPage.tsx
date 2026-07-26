import { useAuth } from '@/components/auth/authContextState';
import { Button } from '@/components/ui/button';
import { BrandLockup } from '@/components/common/Brand';
import {
  AiActionsSection,
  AlphaCtaSection,
  ControlSection,
  HeroSection,
  InlineWidgetsSection,
  ResearchSection,
  ReviewSection,
} from './sections';

const NAV_LINKS = [
  { href: '#editor', label: 'Editor' },
  { href: '#ai-actions', label: 'AI actions' },
  { href: '#review', label: 'Review' },
  { href: '#research', label: 'Research' },
  { href: '#control', label: 'Control' },
] as const;

function LandingNav({ onSignIn }: { onSignIn: () => void }) {
  return (
    <header className="sticky top-0 z-[var(--z-chrome)] border-b border-border/50 bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-6">
        <a href="#top" className="rounded-md">
          <BrandLockup size="sm" />
        </a>
        <nav aria-label="Landing" className="ml-2 hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <Button size="sm" className="ml-auto" onClick={onSignIn}>
          Sign in
        </Button>
      </div>
    </header>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-border/50">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6">
        <BrandLockup size="sm" showTagline />
        <p className="text-2xs text-muted-foreground/60">
          In alpha — features and data formats may change.
        </p>
      </div>
    </footer>
  );
}

/**
 * Full landing page for signed-out visitors. Every visual is a static replica
 * of the real editor UI (see ./mocks), and copy only claims features that
 * exist — the page should read as a tour of the product, not a brochure.
 */
export function LandingPage() {
  const { openAuth } = useAuth();

  return (
    <div id="top" className="min-h-dvh bg-background text-foreground">
      <LandingNav onSignIn={openAuth} />
      <main>
        <HeroSection onSignIn={openAuth} />
        <InlineWidgetsSection />
        <AiActionsSection />
        <ReviewSection />
        <ResearchSection />
        <ControlSection />
        <AlphaCtaSection onSignIn={openAuth} />
      </main>
      <LandingFooter />
    </div>
  );
}
