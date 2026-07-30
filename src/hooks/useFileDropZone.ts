import { useState, type DragEvent } from 'react';
import { isFileDrag, pointerLeftElement } from '@/lib/fileDrop';

/**
 * The drag state and handlers for a file drop zone.
 *
 * Both drop zones in the app mount this rather than wiring their own handlers,
 * because the interesting part is not the four events — it is the two guards
 * (does this drag carry files, and did the pointer really leave) that one of
 * the two zones was missing. Sharing the hook is what keeps them from drifting
 * apart again.
 *
 * `accepts` lets a zone narrow what counts: the library panel also drags its
 * own rows around, and those must not light up the upload target.
 */
export function useFileDropZone({
  onFiles,
  accepts = isFileDrag,
  dropEffect = 'copy',
  disabled = false,
}: {
  onFiles: (files: FileList) => void;
  accepts?: (dataTransfer: DataTransfer) => boolean;
  dropEffect?: 'copy' | 'move' | 'link' | 'none';
  disabled?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);

  const wanted = (event: DragEvent) =>
    !disabled && event.dataTransfer !== null && accepts(event.dataTransfer);

  return {
    dragOver,
    dropHandlers: {
      onDragEnter: (event: DragEvent) => {
        if (!wanted(event)) return;
        event.preventDefault();
        setDragOver(true);
      },
      onDragOver: (event: DragEvent) => {
        if (!wanted(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = dropEffect;
        setDragOver(true);
      },
      onDragLeave: (event: DragEvent) => {
        if (!pointerLeftElement(event.currentTarget, event.relatedTarget)) return;
        setDragOver(false);
      },
      onDrop: (event: DragEvent) => {
        if (!wanted(event)) return;
        event.preventDefault();
        // Stop here: a zone nested inside another droppable region must not
        // hand the same files to both.
        event.stopPropagation();
        setDragOver(false);
        onFiles(event.dataTransfer.files);
      },
    },
  };
}
