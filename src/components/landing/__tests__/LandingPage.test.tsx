import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AuthProvider } from '@/components/auth/AuthContext';
import { LandingPage } from '../LandingPage';
import { samplePaper, topics } from '../tour';
import { examples, exampleUrl } from '@/examples/catalog';

function renderLanding(url = '/') {
  window.history.replaceState(null, '', url);
  return render(
    <AuthProvider>
      <LandingPage />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('LandingPage', () => {
  it('offers every task from the overview and links to the actual paper and public wiki', () => {
    renderLanding();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('sources in view');
    const directory = within(screen.getByRole('navigation', { name: 'Explore the workspace' }));
    for (const topic of topics) {
      expect(directory.getByRole('link', { name: new RegExp(topic.label) }).getAttribute('href')).toBe(
        `#${topic.id}`,
      );
    }
    expect(screen.getByRole('link', { name: 'Read the sample paper' }).getAttribute('href')).toBe(
      samplePaper,
    );
    expect(
      within(screen.getByRole('navigation', { name: 'Site navigation' }))
        .getByRole('link', { name: 'User wiki' })
        .getAttribute('href'),
    ).toBe('/wiki/');
    expect(screen.getByText('Invite-only alpha')).toBeDefined();
  });

  it.each(topics)('opens the $label view directly with its live component example and guide', (topic) => {
    renderLanding(`/#${topic.id}`);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(topic.title);
    expect(screen.getByTitle(examples[topic.id].title).getAttribute('src')).toBe(exampleUrl(topic.id));
    expect(screen.getByRole('link', { name: /Read the wiki guide/ }).getAttribute('href')).toBe(
      `/wiki/${topic.id}.html`,
    );
    const current = within(screen.getByRole('navigation', { name: 'Tour views' })).getByRole('link', {
      name: topic.label,
    });
    expect(current.getAttribute('aria-current')).toBe('page');
  });

  it('switches views and handles browser Back while preserving the app link in the query', async () => {
    renderLanding('/?doc=linked-page#editor');
    fireEvent.click(screen.getByRole('link', { name: 'Papers and citations' }));
    await screen.findByRole('heading', { name: 'Trace a claim to its source.' });
    expect(document.activeElement).toBe(screen.getByRole('main'));
    expect(location.search).toBe('?doc=linked-page');
    window.history.back();
    await screen.findByRole('heading', { name: 'Put the results in the manuscript.' });
  });

  it('keeps previously shared Control links useful', () => {
    renderLanding('/#control');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('See what changed between saves.');
  });

  it('keeps sign-in available on deep links', async () => {
    renderLanding('/?ws=linked-workspace#research');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('dialog')).textContent).toContain('Welcome to ColWrite');
    expect(location.search).toBe('?ws=linked-workspace');
  });
});
