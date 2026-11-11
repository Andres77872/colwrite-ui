import { describe, expect, it } from 'vitest';
import { unplaceableFileMessage } from '../fileDrop';

describe('unplaceableFileMessage', () => {
  it('points pictures at the assistant', () => {
    const message = unplaceableFileMessage([new File(['x'], 'a.png', { type: 'image/png' })]);
    expect(message.title).toMatch(/pictures/i);
    expect(message.description).toMatch(/assistant/i);
  });

  it('points other files at the library or the assistant', () => {
    const message = unplaceableFileMessage([
      new File(['x'], 'a.png', { type: 'image/png' }),
      new File(['x'], 'b.pdf', { type: 'application/pdf' }),
    ]);
    expect(message.title).toBe('Files cannot go in the page');
    expect(message.description).toMatch(/library/i);
  });

  it('has an answer when the browser hides the files', () => {
    expect(unplaceableFileMessage(null).title).toBe('Files cannot go in the page');
  });
});
