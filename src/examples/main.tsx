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
import { initTheme } from '@/lib/theme';
import { examples, isExampleId } from './catalog';
import { ExamplePage } from './ExamplePage';

initTheme();
const view = new URLSearchParams(window.location.search).get('view') ?? 'overview';
const id = view === 'paper' || isExampleId(view) ? view : 'overview';
document.title = `${id === 'paper' ? 'Sparse Routing for Long-Context Pretraining' : examples[id].title} · ColWrite`;
createRoot(document.getElementById('root')!).render(
  <TooltipProvider>
    <ToastProvider>
      <ExamplePage id={id} />
    </ToastProvider>
  </TooltipProvider>,
);
