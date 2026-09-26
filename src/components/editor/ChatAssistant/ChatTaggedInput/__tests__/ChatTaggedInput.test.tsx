import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ChatTaggedInput } from '../ChatTaggedInput';

/**
 * The composer's keyboard contract. Enter sends — that is the whole reason a
 * chat box is not a form — and Shift+Enter has to produce a line the model
 * actually keeps.
 */

function Harness({
  onSubmit,
  onPasteImages,
  disabled,
  initial = '',
  maxLength,
  isPickerOpen,
  onTriggerPicker,
}: {
  onSubmit?: () => void;
  onPasteImages?: (files: File[]) => void;
  disabled?: boolean;
  initial?: string;
  maxLength?: number;
  isPickerOpen?: () => boolean;
  onTriggerPicker?: (anchor: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ChatTaggedInput
        value={value}
        onChange={setValue}
        onSubmit={onSubmit}
        onPasteImages={onPasteImages}
        disabled={disabled}
        placeholder="Ask about this document…"
        maxLength={maxLength}
        isPickerOpen={isPickerOpen}
        onTriggerPicker={onTriggerPicker}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

const composer = () => screen.getByRole('textbox');
const model = () => screen.getByTestId('value').textContent;

/** Type into the contenteditable the way a browser would. */
async function type(text: string) {
  const host = composer();
  await act(async () => {
    host.textContent = text;
    host.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(cleanup);

describe('Enter', () => {
  it('sends the message', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await type('ready');

    await act(async () => {
      fireEvent.keyDown(composer(), { key: 'Enter' });
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(model()).toBe('ready');
  });

  it('opens a line instead of sending when Shift is held', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await type('first');

    await act(async () => {
      fireEvent.keyDown(composer(), { key: 'Enter', shiftKey: true });
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(model()).toBe('first\n');
  });

  it('leaves an IME composition alone', async () => {
    // Enter is how a candidate is accepted; sending there would ship half a
    // word every time someone types Japanese.
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await type('にほん');

    await act(async () => {
      fireEvent.keyDown(composer(), { key: 'Enter', isComposing: true });
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('belongs to the reference picker while it is open', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} isPickerOpen={() => true} />);
    await type('cite #');

    await act(async () => {
      fireEvent.keyDown(composer(), { key: 'Enter' });
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('the reference picker', () => {
  it('opens once, on the edit that typed the #', async () => {
    const onTriggerPicker = vi.fn();
    render(<Harness onTriggerPicker={onTriggerPicker} />);
    await type('cite');
    await type('cite ');
    const host = composer();
    await act(async () => {
      host.textContent = 'cite #';
      const text = host.firstChild!;
      const range = document.createRange();
      range.setStart(text, 6);
      range.collapse(true);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      host.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onTriggerPicker).toHaveBeenCalledWith(5);

    // The keys meant for the open picker must not reopen it at its root —
    // that is what left ArrowDown and Enter doing nothing.
    await act(async () => {
      fireEvent.keyUp(host, { key: 'ArrowDown' });
      fireEvent.keyUp(host, { key: 'Enter' });
    });
    expect(onTriggerPicker).toHaveBeenCalledTimes(1);
  });
});

describe('the model the DOM produces', () => {
  it('keeps text written after a browser-inserted line break', async () => {
    const host = composer.bind(null);
    render(<Harness />);
    await act(async () => {
      host().innerHTML = 'first<br>second';
      host().dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(model()).toBe('first\nsecond');
  });

  it('refuses more than the limit', async () => {
    render(<Harness maxLength={5} />);
    await type('far too long');
    expect(model()).toBe('far t');
  });
});

describe('reference chips', () => {
  it('renders a reference as one chip', async () => {
    render(<Harness initial="see #doc/abc123 now" />);
    const chip = composer().querySelector('[data-ref-text]');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('data-ref-text')).toBe('#doc/abc123');
    expect(chip?.getAttribute('contenteditable')).toBe('false');
  });

  it('gives a screen reader the reference it is about to remove', async () => {
    render(<Harness initial="#doc/abc123" />);
    expect(
      screen.getByRole('button', { name: 'Remove reference #doc/abc123' }),
    ).toBeTruthy();
  });
});


describe('clipboard images', () => {
  const image = new File(['png'], 'clipboard.png', { type: 'image/png' });
  const imageItem = { kind: 'file', type: image.type, getAsFile: () => image };

  it('attaches an image only once without deleting selected draft text', () => {
    const onPasteImages = vi.fn();
    render(<Harness initial="Keep this draft" onPasteImages={onPasteImages} />);
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(composer());
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.paste(composer(), { clipboardData: {
      items: [imageItem], files: [image], getData: () => '',
    } });
    expect(onPasteImages).toHaveBeenCalledExactlyOnceWith([image]);
    expect(model()).toBe('Keep this draft');
    expect(composer().querySelector('img')).toBeNull();
  });

  it('supports file-list clipboards and preserves accompanying plain text within the text limit', () => {
    const onPasteImages = vi.fn();
    render(<Harness onPasteImages={onPasteImages} maxLength={5} />);
    fireEvent.paste(composer(), { clipboardData: {
      files: [image], getData: (format: string) => format === 'text/plain' ? 'caption' : '<img src="untrusted">',
    } });
    expect(onPasteImages).toHaveBeenCalledExactlyOnceWith([image]);
    expect(model()).toBe('capti');
    expect(composer().querySelector('img')).toBeNull();
  });

  it('keeps ordinary text paste working without attaching unrelated files', () => {
    const onPasteImages = vi.fn();
    render(<Harness onPasteImages={onPasteImages} />);
    fireEvent.paste(composer(), { clipboardData: {
      files: [new File(['pdf'], 'paper.pdf', { type: 'application/pdf' })],
      getData: () => 'Pasted text',
    } });
    expect(onPasteImages).not.toHaveBeenCalled();
    expect(model()).toBe('Pasted text');
  });

  it('does not upload or change text when the input is disabled', () => {
    const onPasteImages = vi.fn();
    render(<Harness initial="Keep" disabled onPasteImages={onPasteImages} />);
    fireEvent.paste(composer(), { clipboardData: {
      items: [imageItem], getData: () => 'Replace',
    } });
    expect(onPasteImages).not.toHaveBeenCalled();
    expect(model()).toBe('Keep');
  });
});
