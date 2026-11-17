import { useState } from 'react';
import { AssetImage } from '@/components/common/AssetImage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AssetGenerationDetails } from '../../ImageGeneration/AssetGenerationDetails';
import { useEditorActions, usePageReadOnly, type ImageBlock as ImageBlockModel } from '@/editor';

export function ImageBlock({ block, number, preview = false }: {
  block: ImageBlockModel; number?: number; preview?: boolean;
}) {
  const readOnly = usePageReadOnly();
  const { updateImageDetails } = useEditorActions();
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(false);
  const locked = preview || readOnly || block.locked;
  return <figure className="my-3">
    <div className="mx-auto text-center" style={{ width: `${(block.width ?? 1) * 100}%` }}>
      <AssetImage assetId={block.assetId} alt={block.alt} className="h-auto max-w-full" fitColumn />
    </div>
    {block.caption && <figcaption className="mt-2 text-center text-sm text-muted-foreground">
      {number !== undefined && <strong>Figure {number}. </strong>}{block.caption}
    </figcaption>}
    {block.origin.kind === 'generated' && <>
      <Button variant="ghost" size="sm" onClick={() => setDetails(true)}>AI-generated image · Details</Button>
      {details && <Dialog open onOpenChange={setDetails}><DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Image generation details</DialogTitle></DialogHeader>
        <AssetGenerationDetails assetId={block.assetId} />
      </DialogContent></Dialog>}
    </>}
    {!locked && !editing && <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit image details</Button>}
    {!locked && editing && <form className="mt-2 grid gap-2 rounded-md border border-border p-3" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const alt = String(form.get('alt') ?? '').trim();
      if (!alt) return;
      updateImageDetails(block.id, {
        alt, caption: String(form.get('caption') ?? '') || undefined,
        width: Number(form.get('width')) / 100,
        label: String(form.get('label') ?? '') || undefined,
      });
      setEditing(false);
    }}>
      <label className="grid gap-1 text-sm">Alt text<Input name="alt" required maxLength={4000} defaultValue={block.alt} /></label>
      <label className="grid gap-1 text-sm">Caption<Input name="caption" maxLength={10000} defaultValue={block.caption} /></label>
      <label className="grid gap-1 text-sm">Width (%)<Input name="width" type="number" min={20} max={100} step={1} defaultValue={Math.round((block.width ?? 1) * 100)} /></label>
      <label className="grid gap-1 text-sm">Figure label<Input name="label" maxLength={128} pattern="[A-Za-z0-9][A-Za-z0-9:_.\-]{0,127}" defaultValue={block.label} placeholder="fig:pipeline" /></label>
      <div className="flex gap-2"><Button type="submit" size="sm">Save details</Button><Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button></div>
    </form>}
  </figure>;
}
