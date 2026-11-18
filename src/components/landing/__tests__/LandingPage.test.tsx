import { takeItems } from '@/lib/itemAt';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AuthProvider } from '@/components/auth/AuthContext';
import { LandingPage } from '../LandingPage';

function renderLanding() {
  return render(
    <AuthProvider>
      <LandingPage />
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('LandingPage', () => {
  it('renders the hero, sections and calls to action', () => {
    renderLanding();

    const hero = screen.getByRole('heading', { level: 1 });
    expect(hero.textContent).toContain('Write your research paper');
    expect(document.querySelector('iframe')).toBeNull();

    // The header's "Features" and every section the footer links to.
    for (const id of ['features', 'editor', 'ai-actions', 'review', 'research', 'control', 'docs']) {
      expect(document.getElementById(id)).not.toBeNull();
    }

    // More than one path to sign in (header, hero, closing CTA).
    expect(screen.getAllByRole('button', { name: /sign in/i }).length).toBeGreaterThan(2);
  });

  it('wears the same header and footer as the docs', () => {
    renderLanding();

    const site = screen.getByRole('navigation', { name: 'Site' });
    expect(within(site).getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe('/docs/');
    expect(within(site).getByRole('link', { name: 'Features' }).getAttribute('href')).toBe('/#features');
    expect(within(site).getByRole('link', { name: 'Sample paper' }).getAttribute('href')).toBe('/examples/?view=paper');
    expect(screen.getByRole('navigation', { name: 'Docs links' })).not.toBeNull();
  });

  it('leads each feature on to the docs page that covers it', () => {
    renderLanding();
    const link = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    expect(link('Read the editor docs')).toBe('/docs/editor.html');
    expect(link('Read the Ask AI docs')).toBe('/docs/ask-ai.html');
    expect(link('Read the suggestions docs')).toBe('/docs/suggestions.html');
    expect(link('Read the paper search docs')).toBe('/docs/paper-search.html');
    expect(link('Read the roles and policy docs')).toBe('/docs/members.html#workspace-policy');

    const docs = document.getElementById('docs')!;
    for (const title of ['Quick start', 'Editor and blocks', 'Citations and references', 'Export and AI use']) {
      expect(within(docs).getByRole('link', { name: new RegExp(title) })).not.toBeNull();
    }
  });

  it('pictures Ask AI on a selection, in its groups', () => {
    renderLanding();
    for (const label of ['Edit or review', 'Improve writing', 'Change tone', 'Check the claims']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('surfaces the real tool panels, each with its contents', () => {
    renderLanding();
    for (const label of ['Paper search', 'Library', 'Sources', 'Document JSON']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Retracted')).not.toBeNull();
  });

  it('uses the landing artwork behind the product', () => {
    renderLanding();
    const images = Array.from(document.querySelectorAll('img'), (image) => image.getAttribute('src'));
    expect(images).toContain('/images/colwrite-hero-manuscript.webp');
    expect(
      screen.getByRole('img', { name: /research papers and data streams/i }).getAttribute('src'),
    ).toBe('/images/colwrite-research-flow.webp');
    expect(screen.getByText('Write with the evidence in view')).not.toBeNull();
  });

  it('states the alpha terms honestly', () => {
    renderLanding();
    expect(screen.getAllByText(/invite-only/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/data formats may change/i).length).toBeGreaterThan(0);
  });

  it('opens the auth dialog from the call to action', async () => {
    renderLanding();
    const [cta] = takeItems(screen.getAllByRole('button', { name: 'Sign in to continue' }), 1);
    fireEvent.click(cta);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Welcome to ColWrite');
  });

  it('opens the auth dialog when the docs link here to sign in', async () => {
    window.history.replaceState(null, '', '/#sign-in');
    renderLanding();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Welcome to ColWrite');
    expect(window.location.hash).toBe('');
  });
});
