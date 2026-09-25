import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AuthProvider } from '@/components/auth/AuthContext';
import { ASK_AI_PRESETS } from '@/components/editor/AskAi/presets';
import { LandingPage } from '../LandingPage';

function renderLanding() {
  return render(
    <AuthProvider>
      <LandingPage />
    </AuthProvider>,
  );
}

afterEach(cleanup);

describe('LandingPage', () => {
  it('renders the hero, sections and calls to action', () => {
    renderLanding();

    const hero = screen.getByRole('heading', { level: 1 });
    expect(hero.textContent).toContain('AI edits wait for your approval');

    // Nav anchors into every content section.
    for (const id of ['editor', 'ai-actions', 'review', 'research', 'control']) {
      expect(document.getElementById(id)).not.toBeNull();
    }

    // More than one path to sign in (nav, hero, closing CTA).
    expect(screen.getAllByRole('button', { name: /sign in/i }).length).toBeGreaterThan(1);
  });

  it('lists every Ask AI action a selection offers', () => {
    renderLanding();
    const presets = ASK_AI_PRESETS.filter((preset) => preset.applies.includes('selection'));
    expect(presets.length).toBeGreaterThan(5);
    for (const preset of presets) {
      expect(screen.getAllByText(preset.label).length).toBeGreaterThan(0);
    }
  });

  it('surfaces the real tool panels', () => {
    renderLanding();
    for (const label of ['Search arXiv', 'Search pages', 'My PDFs', 'Document JSON']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('uses the landing artwork to explain the evidence workflow', () => {
    renderLanding();

    expect(
      screen
        .getByRole('img', { name: /manuscript connected to abstract charts/i })
        .getAttribute('src'),
    ).toBe('/images/colwrite-hero-manuscript.webp');
    expect(
      screen
        .getByRole('img', { name: /research papers and data streams/i })
        .getAttribute('src'),
    ).toBe('/images/colwrite-research-flow.webp');
    expect(screen.getByText('Find relevant papers')).not.toBeNull();
    expect(screen.getByText('Write with the evidence in view')).not.toBeNull();
  });

  it('states the alpha terms honestly', () => {
    renderLanding();
    expect(screen.getAllByText(/invite-only/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/data formats may change/i).length).toBeGreaterThan(0);
  });

  it('opens the auth dialog from the call to action', async () => {
    renderLanding();
    const [cta] = screen.getAllByRole('button', { name: 'Sign in to continue' });
    fireEvent.click(cta);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Welcome to ColWrite');
  });
});
