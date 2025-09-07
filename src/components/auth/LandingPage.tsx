import { useAuth } from './AuthContext';

export function LandingPage() {
  const { openAuth } = useAuth();
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: 'calc(100dvh - 140px)', padding: 'var(--sp-6)' }}>
      <div className="card" style={{ maxWidth: 760, padding: 'var(--sp-5)' }}>
        <div className="row" style={{ alignItems: 'center', gap: 'var(--sp-3)' }}>
          <div className="brand-logo" aria-hidden>CW</div>
          <div>
            <div className="brand-title" style={{ fontSize: '20px' }}>ColWrite</div>
            <div className="muted">Assistant writer for arXiv papers</div>
          </div>
        </div>
        <div className="stack" style={{ marginTop: 'var(--sp-4)' }}>
          <p>
            ColWrite is a focused writing environment with an integrated AI assistant to help you compose, revise, and structure scientific documents. It brings:
          </p>
          <ul className="muted" style={{ marginLeft: '1.25rem' }}>
            <li>Context-aware suggestions as you write</li>
            <li>Reference-aware prompts and inline tags</li>
            <li>Fast versioned saves and document management</li>
          </ul>
          <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
            This project is currently in alpha. Features and data formats may change.
          </p>
        </div>
        <div className="row" style={{ marginTop: 'var(--sp-4)' }}>
          <button className="btn primary" onClick={openAuth}>Sign in to continue</button>
        </div>
      </div>
    </div>
  );
}
