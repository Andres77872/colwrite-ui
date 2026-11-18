import { createRoot } from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import 'katex/dist/katex.min.css';
import '@/styles/globals.css';
import './styles.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastProvider } from '@/components/ui/toast';
import { initTheme, type ResolvedTheme } from '@/lib/theme';
import { examples, isExampleId } from './catalog';
import { ExamplePage } from './ExamplePage';
import { SamplePaperPage } from './SamplePaperPage';

initTheme();
const params = new URLSearchParams(window.location.search);
const view = params.get('view') ?? 'paper';
// The guides embed examples with `&theme=dark`, the site's own
// appearance, whatever this device's theme is.
const themeParam = params.get('theme');
const pinnedTheme: ResolvedTheme | undefined = themeParam === 'dark' || themeParam === 'light' ? themeParam : undefined;

const id = isExampleId(view) ? view : 'paper';
document.title = id === 'paper' ? 'Sample paper · ColWrite' : `${examples[id].title} · ColWrite`;
createRoot(document.getElementById('root')!).render(
  <TooltipProvider>
    <ToastProvider>
      {id === 'paper' ? <SamplePaperPage /> : <ExamplePage id={id} theme={pinnedTheme} />}
    </ToastProvider>
  </TooltipProvider>,
);
