import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { makeResource } from '@/services/__tests__/resourceFixtures';

const getResource = vi.hoisted(() => vi.fn());

vi.mock('@/services/resources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/resources')>();
  return { ...actual, getResource };
});

import { UploadsSection } from '../UploadsSection';

function renderSection() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <UploadsSection
          uploads={[
            makeResource({
              id: 7,
              filename: 'settling.pdf',
              extraction_status: 'pending',
            }),
          ]}
          totalKnown={1}
          onChanged={() => undefined}
        />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  getResource.mockReset()
    .mockResolvedValueOnce(
      makeResource({ id: 7, filename: 'settling.pdf', extraction_status: 'running' }),
    )
    .mockResolvedValueOnce(
      makeResource({ id: 7, filename: 'settling.pdf', extraction_status: 'ready' }),
    );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('UploadsSection extraction polling', () => {
  it('polls the same resource id with backoff until it settles', async () => {
    renderSection();
    expect(screen.getByText('Queued')).toBeTruthy();

    // The first attempt is fast, so a conversion that finishes normally looks
    // like it resolved on its own.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(getResource).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Converting')).toBeTruthy();

    // Then it backs off. This used to be a flat 4s interval with no ceiling, so
    // a file that never settled kept asking for as long as the page was open.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(getResource).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(getResource).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Ready')).toBeTruthy();
  });

  it('stops polling once nothing is settling', async () => {
    renderSection();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const settled = getResource.mock.calls.length;

    // `ready` is terminal; there is nothing left to ask about.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getResource).toHaveBeenCalledTimes(settled);
  });
});
