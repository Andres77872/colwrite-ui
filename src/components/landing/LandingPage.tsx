import { useEffect } from 'react';
import { useAuth } from '@/components/auth/authContextState';
import { useForcedTheme } from '@/lib/theme';
import { Button } from '@/components/ui/button';
import { SIGN_IN_HASH } from '@/site/links';
import { SiteFooter, SiteHeader } from '@/site/SiteChrome';
import {
  AiActionsSection,
  AlphaCtaSection,
  ControlSection,
  EditorSection,
  FeatureOverview,
  DocsSection,
  HeroSection,
  ResearchSection,
  ReviewSection,
} from './sections';

export function LandingPage() {
  const { openAuth } = useAuth();
  // The landing, the sample paper and the docs share one dark art direction whatever the
  // visitor's theme. Pinned on <html> as well as on the wrapper: the sign-in
  // dialog and the tooltips portal into <body>, outside this subtree.
  useForcedTheme('dark');

  // The docs' "Sign in" links here with #sign-in: open the dialog at once.
  useEffect(() => {
    if (window.location.hash !== SIGN_IN_HASH) return;
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    openAuth();
  }, [openAuth]);

  return (
    <div id="top" data-theme="dark" className="min-h-dvh bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[var(--z-floating)] focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <SiteHeader
        section="home"
        signIn={
          <Button size="sm" onClick={openAuth}>
            Sign in
          </Button>
        }
      />
      <main id="main-content" tabIndex={-1} className="focus:outline-hidden">
        <HeroSection onSignIn={openAuth} />
        <FeatureOverview />
        <EditorSection />
        <AiActionsSection />
        <ReviewSection />
        <ResearchSection />
        <ControlSection />
        <DocsSection />
        <AlphaCtaSection onSignIn={openAuth} />
      </main>
      <SiteFooter />
    </div>
  );
}
