import { lazy, Suspense } from 'react';
import { useAuth } from './components/auth/authContextState';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { LandingPage } from './components/landing';
import { Spinner } from './components/ui/spinner';

const SignedInWorkspace = lazy(() => import('./SignedInWorkspace'));

function LoadingWorkspace() {
  return <div className="flex min-h-screen items-center justify-center text-muted-foreground"><Spinner /></div>;
}

export default function App() {
  const { user, status } = useAuth();
  if (status === 'checking') return <LoadingWorkspace />;
  if (!user) return <ErrorBoundary label="this page"><LandingPage /></ErrorBoundary>;

  return (
    <ErrorBoundary label="the workspace">
      <Suspense fallback={<LoadingWorkspace />}>
        <SignedInWorkspace key={`${user.email}\u0000${user.name}`} />
      </Suspense>
    </ErrorBoundary>
  );
}
