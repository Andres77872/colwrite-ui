import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from 'colwrite-ui';
import { FileText } from 'lucide-react';

// `open` is forced on: the closed state renders nothing. The overlay is the
// scrim — `bg-black/60` with `backdrop-blur-sm`, `grid place-items-center` and
// `overflow-y-auto` so it both centres the panel and scrolls a tall one. Every
// cell therefore renders a page BEHIND it: the blurred document is the subject.

// The page the dialog was opened from — never part of the component, only the
// thing the scrim has to sit over convincingly.
function DocumentBehind() {
  return (
    <div className="max-w-2xl">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">Draft · Section 3</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        Sparse Retrieval for Long-Context Summarisation
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        We compare three retrieval budgets against the 2024 arXiv abstract set and report ROUGE-L
        alongside a citation-faithfulness score. The sparse variant recovers 96% of the dense
        baseline at a fifth of the index size.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Section 3.2 describes the ablation over chunk overlap; the extracted PDFs listed in the
        library were the only sources given to the assistant.
      </p>
    </div>
  );
}

export function BehindTheDialog() {
  return (
    <div>
      <DocumentBehind />
      <Dialog open>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save before exporting?</DialogTitle>
            <DialogDescription>
              The export runs against the saved version, and this draft has 3 unsaved blocks.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <Button variant="outline">Export anyway</Button>
            <Button>Save and export</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CustomScrim() {
  return (
    <div>
      <DocumentBehind />
      <Dialog open>
        <DialogPortal>
          <DialogOverlay className="bg-background/95 backdrop-blur-md">
            <div className="relative w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-xl">
              <div className="flex items-center gap-2">
                <FileText aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                <p className="text-lg font-semibold leading-none tracking-tight">
                  vaswani-2017-attention.pdf
                </p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Page 3 of 15 · extracted text shown while the PDF renders.
              </p>
              <p className="mt-4 rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed">
                3.2 Attention. An attention function can be described as mapping a query and a set
                of key-value pairs to an output, where the query, keys, values, and output are all
                vectors.
              </p>
            </div>
          </DialogOverlay>
        </DialogPortal>
      </Dialog>
    </div>
  );
}

export function TopAligned() {
  return (
    <div>
      <DocumentBehind />
      <Dialog open>
        <DialogPortal>
          <DialogOverlay className="place-items-start pt-16">
            {/* place-items-start pins both axes, so the panel is re-centred
                horizontally by a full-width flex row. */}
            <div className="flex w-full justify-center">
              <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
                <p className="text-lg font-semibold leading-none tracking-tight">Jump to section</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Anchored near the top so the command row stays under the cursor.
                </p>
                <ul className="mt-4 divide-y divide-border/50">
                  {['1 Introduction', '2 Related work', '3 Method', '4 Experiments'].map(
                    (section) => (
                      <li key={section} className="py-2 text-sm">
                        {section}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </div>
          </DialogOverlay>
        </DialogPortal>
      </Dialog>
    </div>
  );
}
