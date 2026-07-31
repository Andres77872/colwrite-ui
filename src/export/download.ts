export function exportFilename(name: string | undefined, extension: 'html' | 'pdf'): string {
  const raw = (name?.trim() || 'Untitled document').replaceAll('\\', '/');
  const basename = Array.from(raw.split('/').at(-1) ?? '')
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32
        || codePoint === 127
        || '"<>:|?*'.includes(character)
        ? '_'
        : character;
    })
    .join('')
    .trim();
  const safe = (basename || 'Untitled document').slice(0, 120).replace(/\.+$/, '');
  return safe.toLocaleLowerCase().endsWith(`.${extension}`) ? safe : `${safe}.${extension}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
