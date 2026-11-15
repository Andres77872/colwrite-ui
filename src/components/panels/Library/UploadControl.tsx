import { useRef } from 'react';
import { ChevronDown, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { PDF_ACCEPT } from '@/lib/fileDrop';
import { uploadPlace, type PdfUploads, type PdfUploadTarget } from '@/actions/useUploadPdfs';

const targetKey = (target: PdfUploadTarget) =>
  target.kind === 'collection' ? `collection:${target.collectionId}` : target.kind;

/**
 * "Upload to: Chapter 2 ▾". The destination is on the button itself, so it is
 * read before anything is uploaded, not learned from a toast afterwards. The
 * menu offers the other places that make sense from here.
 */
export function UploadControl({
  uploads,
  choices,
  onChoose,
  onFiles,
}: {
  uploads: PdfUploads;
  /** Upload the chosen files, through `uploads.upload`. */
  onFiles: (files: FileList | null) => void;
  /** Every destination offered, the current one included. */
  choices: readonly PdfUploadTarget[];
  onChoose: (target: PdfUploadTarget) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const current = targetKey(uploads.target);

  return (
    <div className="-mx-1 flex min-w-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        className="min-w-0 text-muted-foreground hover:text-foreground"
        disabled={uploads.uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploads.uploading ? <Spinner /> : <Upload aria-hidden="true" />}
        <span className="truncate">{uploads.uploading ? `Uploading to ${uploads.place}…` : uploads.label}</span>
      </Button>
      {choices.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="icon"
              size="icon-xs"
              className="shrink-0"
              disabled={uploads.uploading}
              aria-label="Change where PDFs upload"
            >
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Upload to</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={current}
              onValueChange={(value) => {
                const next = choices.find((choice) => targetKey(choice) === value);
                if (next) onChoose(next);
              }}
            >
              {choices.map((choice) => (
                <DropdownMenuRadioItem key={targetKey(choice)} value={targetKey(choice)}>
                  {uploadPlace(choice) === 'this page' ? 'This page' : uploadPlace(choice)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={PDF_ACCEPT}
        multiple
        className="sr-only"
        aria-label={`Choose PDFs to upload to ${uploads.place}`}
        tabIndex={-1}
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
