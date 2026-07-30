import { Alert, Button } from 'colwrite-ui';
import { RefreshCw, Sparkles, Upload, X } from 'lucide-react';

// Ported from the app's own uses: ProfileView (bare destructive), LibraryPanel
// (the unsaved-document note and the retryable failure row), LibraryResources
// (the "not searched" warning) and ResourceDetail (extraction failure detail).

export function Variants() {
  return (
    <div className="w-full max-w-lg space-y-2">
      <Alert variant="destructive">Could not load your library — the server returned 503.</Alert>
      <Alert variant="warning" role="status">
        Two files were not searched: their text is still being converted.
      </Alert>
      <Alert variant="info" role="status">
        Save this document to attach files or folders. Until then, uploads go to Unfiled.
      </Alert>
      <Alert variant="success" role="status">
        Extraction finished for all 12 uploads — the assistant can quote them now.
      </Alert>
    </div>
  );
}

export function IconOverrides() {
  return (
    <div className="w-full max-w-lg space-y-2">
      <Alert variant="info" role="status" icon={Upload}>
        Uploading 3 PDFs to Unfiled. Each is queued for text extraction as it lands.
      </Alert>
      <Alert variant="success" role="status" icon={Sparkles}>
        The assistant rewrote the abstract. Review the change before you save.
      </Alert>
      <Alert variant="warning" role="status" icon={null}>
        Autosave is paused while this document is offline.
      </Alert>
    </div>
  );
}

export function LongMessage() {
  return (
    <div className="w-full max-w-sm">
      <Alert variant="destructive">
        <p className="font-medium">Could not convert workshop-scan-2019.pdf</p>
        <p className="mt-1 break-words text-xs opacity-90">
          The provider returned HTTP 422: “no extractable text layer on pages 1–14; the file
          appears to be a photographic scan”. Re-running extraction returns the same answer —
          upload a text PDF, or paste the passage you want to cite into the document.
        </p>
      </Alert>
    </div>
  );
}

export function WithRetryAction() {
  return (
    <div className="w-full max-w-sm space-y-2 rounded-lg border border-border bg-card p-3">
      <Alert variant="destructive">
        <div className="flex min-w-0 items-start gap-2">
          <span className="min-w-0 flex-1 break-words">Could not list collections.</span>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="outline" size="xs">
              <RefreshCw />
              Retry
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="Dismiss">
              <X />
            </Button>
          </div>
        </div>
      </Alert>
    </div>
  );
}

export function AmbientNote() {
  return (
    <div className="w-80 rounded-lg border border-border bg-card p-3">
      <p className="mb-2 text-2xs font-medium uppercase text-muted-foreground">Library</p>
      <Alert variant="info" role="status" className="text-xs">
        Save this document to attach files or folders. Until then, Available and Attached are
        unavailable and uploads go to Unfiled.
      </Alert>
    </div>
  );
}
