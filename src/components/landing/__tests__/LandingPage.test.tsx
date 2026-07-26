import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AuthProvider } from '@/components/auth/AuthContext';
import { AI_ACTION_REGISTRY } from '@/config/aiActions';
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

  it('lists every AI action from the registry', () => {
    renderLanding();
    for (const action of Object.values(AI_ACTION_REGISTRY)) {
      expect(screen.getAllByText(action.label).length).toBeGreaterThan(0);
    }
  });

  it('surfaces the real tool panels', () => {
    renderLanding();
    for (const label of ['arXiv Search', 'ColPali Search', 'Library', 'Document JSON']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
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
