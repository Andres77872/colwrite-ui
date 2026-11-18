import { useEffect, useRef, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { downloadBlob, exportFilename } from '@/export/download';
import { useForcedTheme } from '@/lib/theme';
import { SiteFooter, SiteHeader } from '@/site/SiteChrome';
import { signInClass, SIGN_IN_HASH } from '@/site/links';
import { docHref } from '@/docs/catalog';
import { sampleManuscript } from './manuscript';
import { framedPaperHtml, manuscriptHtml } from './renderPaper';

const TITLE = 'Sparse Routing for Long-Context Pretraining';

/**
 * The sample paper inside the public site: the manuscript exported as
 * standalone HTML with the Paper profile, shown as the sheet it prints as.
 */
export function SamplePaperPage() {
  useForcedTheme('dark');
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    manuscriptHtml(sampleManuscript(), true, 'paper').then(
      (rendered) => live && setHtml(rendered),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  const download = () => {
    if (!html) return;
    downloadBlob(new Blob([html], { type: 'text/html' }), exportFilename(TITLE, 'html'));
  };

  return (
    <div data-theme="dark" className="flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[var(--z-floating)] focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <SiteHeader
        section="sample"
        signIn={
          <a href={`/${SIGN_IN_HASH}`} className={signInClass()}>
            Sign in
          </a>
        }
      />
      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-hidden">
        <div className="mx-auto max-w-4xl px-4 pb-6 pt-10 sm:px-6 sm:pt-14">
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Sample paper</h1>
          <p className="mt-3 max-w-2xl text-pretty leading-relaxed text-muted-foreground">
            <cite className="not-italic text-foreground">{TITLE}</cite> is a practice manuscript written in ColWrite and
            exported as standalone HTML with the Paper profile: its sections, equations, tables, figures, citations and
            reference list exactly as the export writes them. The results and the flagged references are invented for
            practice.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button size="sm" onClick={download} disabled={!html}>
              <Download aria-hidden="true" />
              Download HTML
            </Button>
            <a href={docHref('export')} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
              <FileText aria-hidden="true" />
              How export works
            </a>
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-2 pb-16 sm:px-6">
          {html ? (
            <SamplePaper html={html} />
          ) : (
            <p role="status" className="rounded-lg border border-border px-4 py-16 text-center text-sm text-muted-foreground">
              {failed ? 'The sample paper could not be rendered. Reload to try again.' : 'Rendering the sample paper…'}
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

/** The exported sheet, as tall as its content, so the page scrolls once. */
function SamplePaper({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1200);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    let observer: ResizeObserver | undefined;
    const fit = () => {
      const page = element.contentDocument?.documentElement;
      if (page) setHeight(Math.ceil(page.scrollHeight));
    };
    const attach = () => {
      fit();
      const body = element.contentDocument?.body;
      if (!body) return;
      observer?.disconnect();
      observer = new ResizeObserver(fit);
      observer.observe(body);
    };
    element.addEventListener('load', attach);
    if (element.contentDocument?.readyState === 'complete') attach();
    return () => {
      element.removeEventListener('load', attach);
      observer?.disconnect();
    };
  }, [html]);
  return (
    <iframe
      ref={frame}
      className="block w-full overflow-hidden rounded-lg bg-white shadow-2xl ring-1 ring-black/10"
      style={{ height }}
      srcDoc={framedPaperHtml(html)}
      title={TITLE}
    />
  );
}
