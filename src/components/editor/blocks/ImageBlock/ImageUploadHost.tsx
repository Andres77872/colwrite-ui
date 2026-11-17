import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InlineError } from '@/components/ui/inline-error';
import { describeApiError } from '@/api/errors';
import { MAX_IMAGE_UPLOAD_BYTES, uploadAsset } from '@/data/assets';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useEditorActions, usePageReadOnly } from '@/editor';
import { uid } from '@/lib/uid';
import { IMAGE_UPLOAD_EVENT, type ImageUploadTarget } from './imageUpload';

export function ImageUploadHost() {
  const readOnly = usePageReadOnly();
  const [target, setTarget] = useState<ImageUploadTarget | null>(null);
  useEffect(() => {
    if (readOnly) return;
    const open = (event: Event) => {
      if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail !== 'object') return;
      const detail = event.detail as Partial<ImageUploadTarget>;
      if (typeof detail.blockId === 'string' && (detail.where === 'before' || detail.where === 'after') && typeof detail.replaceBlank === 'boolean') {
        setTarget(detail as ImageUploadTarget);
      }
    };
    window.addEventListener(IMAGE_UPLOAD_EVENT, open);
    return () => window.removeEventListener(IMAGE_UPLOAD_EVENT, open);
  }, [readOnly]);
  if (target === null || readOnly) return null;
  return <ImageUploadDialog key={`${target.blockId}:${target.where}`} target={target} close={() => setTarget(null)} />;
}

function ImageUploadDialog({ target, close }: { target: ImageUploadTarget; close: () => void }) {
  const workspaceId = useWorkspaceId();
  const { getBlock, insertBlocksAfter, insertBlockBeforeExact } = useEditorActions();
  const readOnly = usePageReadOnly();
  const permitted = useRef(!readOnly);
  useEffect(() => { permitted.current = !readOnly; return () => { permitted.current = false; }; }, [readOnly]);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>Insert an image</DialogTitle><DialogDescription>Upload a PNG, JPEG, GIF or WebP (up to 25 MiB). Alt text describes the image to readers who cannot see it.</DialogDescription></DialogHeader>
      <form className="grid gap-3" onSubmit={async (event) => {
        event.preventDefault();
        if (sending.current || !permitted.current) return;
        const data = new FormData(event.currentTarget);
        const alt = String(data.get('alt') ?? '').trim();
        const caption = String(data.get('caption') ?? '').trim();
        if (!(file instanceof File) || !file.size || !alt) return;
        if (file.size > MAX_IMAGE_UPLOAD_BYTES) { setError('Choose an image no larger than 25 MiB.'); return; }
        sending.current = true;
        setBusy(true);
        setError(null);
        try {
          const asset = await uploadAsset(workspaceId, file);
          if (!permitted.current) return;
          const anchor = getBlock(target.blockId);
          if (!anchor || (anchor.locked && target.replaceBlank)) { setError('The insertion point changed. Choose a place on the page and try again.'); return; }
          const block = {
            id: uid(), type: 'image', assetId: asset.asset_id, alt, caption: caption || undefined, width: 1,
            origin: { kind: 'upload' },
          } as const;
          if (target.where === 'before') insertBlockBeforeExact(target.blockId, block);
          else insertBlocksAfter(target.blockId, [block], { replaceAnchor: target.replaceBlank && anchor.type === 'paragraph' && !anchor.html.trim() && !anchor.children?.length });
          close();
        } catch (failure) {
          if (permitted.current) setError(describeApiError(failure, 'The image could not be uploaded.'));
        } finally {
          sending.current = false;
          if (permitted.current) setBusy(false);
        }
      }}>
        <label className="grid gap-1 text-sm">Image file<Input name="image" type="file" accept="image/png,image/jpeg,image/gif,image/webp" required disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <label className="grid gap-1 text-sm">Alt text<Input name="alt" required maxLength={4000} disabled={busy} /></label>
        <label className="grid gap-1 text-sm">Caption (optional)<Input name="caption" maxLength={10000} disabled={busy} /></label>
        {error && <InlineError title={error} />}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button type="submit" disabled={busy || readOnly}>{busy ? 'Uploading…' : 'Insert image'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
