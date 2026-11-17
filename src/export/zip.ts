/** Small, deterministic ZIP writer (stored entries, UTF-8 names, no ZIP64). */
const CRC = Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ (CRC[(crc ^ byte) & 255] ?? 0);
  return (crc ^ 0xffffffff) >>> 0;
}

export function storedZip(files: readonly { name: string; bytes: Uint8Array<ArrayBuffer> }[]): Blob {
  if (files.length > 65535) throw new Error('Too many export files.');
  const parts: Uint8Array<ArrayBuffer>[] = [], directory: Uint8Array<ArrayBuffer>[] = [];
  const names = new Set<string>();
  let offset = 0, directorySize = 0;
  for (const file of files) {
    if (!file.name || file.name.startsWith('/') || file.name.includes('\\') || Array.from(file.name).some((char) => char.charCodeAt(0) < 32)
      || file.name.split('/').some((part) => part === '..' || part === '.' || !part) || names.has(file.name)) {
      throw new Error('Invalid or duplicate export filename.');
    }
    names.add(file.name);
    const name = new TextEncoder().encode(file.name);
    if (name.length > 65535 || offset + file.bytes.length > 250 * 1024 * 1024) throw new Error('The export bundle exceeds 250 MiB.');
    const crc = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x800, true); // UTF-8.
    view.setUint16(12, 33, true); // 1980-01-01.
    view.setUint32(14, crc, true);
    view.setUint32(18, file.bytes.length, true);
    view.setUint32(22, file.bytes.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, file.bytes);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(14, 33, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.bytes.length, true);
    cv.setUint32(24, file.bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    directory.push(central);
    directorySize += central.length;
    offset += local.length + file.bytes.length;
  }
  if (offset + directorySize + 22 > 250 * 1024 * 1024) throw new Error('The export bundle exceeds 250 MiB.');
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
