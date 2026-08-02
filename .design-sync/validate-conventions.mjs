// Validates every name enumerated in .design-sync/conventions.md against the
// freshly built artifacts. Run on every sync (NOTES.md "Conventions header").
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const cssFiles = ['ds-pkg/ds.css', 'ds-pkg/tokens/tokens.css'].filter(existsSync);
const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
const bundleJs = existsSync('ds-bundle/_ds_bundle.js') ? readFileSync('ds-bundle/_ds_bundle.js', 'utf8') : '';

// Tailwind escapes these in emitted selectors.
const esc = (c) => '.' + c.replace(/([[\]().%/:#!])/g, '\\$1');
const hasClass = (c) => css.includes(esc(c) + ',') || css.includes(esc(c) + ' ') ||
  css.includes(esc(c) + '{') || css.includes(esc(c) + ':') || css.includes(esc(c) + '\n');
const hasToken = (t) => css.includes(t + ':');

const CLASSES = {
  Surfaces: ['bg-background', 'bg-card', 'bg-popover', 'bg-muted', 'bg-accent', 'bg-secondary'],
  Text: ['text-foreground', 'text-muted-foreground', 'text-primary', 'text-destructive'],
  'Strong fills': ['bg-primary-strong', 'bg-destructive-strong'],
  Status: ['bg-success', 'bg-warning', 'bg-info', 'bg-destructive',
    'text-success-foreground', 'text-warning-foreground', 'text-info-foreground', 'text-destructive-foreground'],
  'Borders/focus': ['border-border', 'border-input', 'ring-ring', 'outline-ring'],
  'Type scale': ['text-2xs', 'text-xs', 'text-sm', 'text-base', 'text-md', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl', 'text-4xl'],
  Fonts: ['font-sans', 'font-mono'],
  Radius: ['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl', 'rounded-full'],
  Shadow: ['shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl'],
  Motion: ['animate-spin', 'animate-shimmer', 'animate-slide-in-up', 'animate-in', 'animate-out',
    'fade-in-0', 'zoom-in-95', 'slide-in-from-top-2', 'slide-in-from-bottom-2', 'slide-in-from-left-2', 'slide-in-from-right-2'],
  Charts: [...Array.from({ length: 8 }, (_, i) => `bg-series-${i + 1}`), 'border-chart-grid', 'text-chart-axis'],
  Diffs: ['bg-diff-add', 'text-diff-add-fg', 'bg-diff-remove', 'text-diff-remove-fg'],
  Duration: ['duration-120', 'duration-150', 'duration-200'],
  'Z (arbitrary)': ['z-[var(--z-base)]', 'z-[var(--z-sticky)]', 'z-[var(--z-chrome)]', 'z-[var(--z-dropdown)]',
    'z-[var(--z-floating)]', 'z-[var(--z-modal-backdrop)]', 'z-[var(--z-modal)]', 'z-[var(--z-popover)]',
    'z-[var(--z-toast)]', 'z-[var(--z-tooltip)]'],
  'Duration (arbitrary, documented)': ['duration-[var(--transition-base)]'],
  'Example snippet': ['max-w-md', 'flex', 'items-start', 'justify-between', 'gap-3', 'min-w-0',
    'leading-relaxed', 'mt-4', 'justify-end', 'gap-2'],
};

const TOKENS = ['--z-base', '--z-sticky', '--z-chrome', '--z-dropdown', '--z-floating',
  '--z-modal-backdrop', '--z-modal', '--z-popover', '--z-toast', '--z-tooltip',
  '--transition-fast', '--transition-base', '--transition-slow'];

// Components: the sync-time name index is the emitted components/<group>/<Name>/ tree;
// the bundle text is authoritative for exports without a component folder (providers).
const compDirs = new Set();
const root = 'ds-bundle/components';
if (existsSync(root)) for (const g of readdirSync(root)) {
  for (const n of readdirSync(join(root, g))) compDirs.add(n);
}
const COMPONENTS = ['TooltipProvider', 'ToastProvider', 'ConfirmProvider', 'AppShell', 'Sidebar', 'Topbar',
  'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'Badge', 'Button', 'Input'];
const BUNDLE_ONLY = ['PanelsProvider', 'AuthProvider', 'ViewProvider', 'useToast', 'useConfirm'];

let fails = 0;
const report = (label, items, test) => {
  const missing = items.filter((i) => !test(i));
  if (missing.length) { fails += missing.length; console.log(`  ✗ ${label}: ${missing.join(' ')}`); }
  else console.log(`  ✓ ${label} (${items.length})`);
};

console.log(`CSS sources: ${cssFiles.join(', ')}\n\n== classes ==`);
for (const [k, v] of Object.entries(CLASSES)) report(k, v, hasClass);
console.log('\n== tokens ==');
report('custom properties', TOKENS, hasToken);
console.log('\n== components ==');
report('component folders', COMPONENTS, (c) => compDirs.has(c));
report('bundle exports', BUNDLE_ONLY, (c) => new RegExp(`\\b${c}\\b`).test(bundleJs));
console.log(`\n${fails === 0 ? 'PASS — every name in conventions.md verifies' : `FAIL — ${fails} name(s) do not verify`}`);
process.exit(fails === 0 ? 0 : 1);
