import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Named in the fallback copy, e.g. "the editor". */
  label: string;
}

interface State {
  error: Error | null;
}

/**
 * ErrorBoundary — keeps one broken subtree from blanking the whole app.
 *
 * The block editor builds a lot of its DOM by hand (contenteditable, portals,
 * streamed AI widgets), so a render throw is a real possibility. There was no
 * boundary anywhere, which meant any such throw unmounted the entire tree and
 * left a white page with no route back — including no way to reach the
 * document the author was in the middle of writing.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No logging service is wired up; keep the detail attached to the error so
    // it is visible in the browser's own report rather than silently dropped.
    error.cause ??= info.componentStack;
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <EmptyState
          size="page"
          icon={AlertTriangle}
          title={`Something went wrong in ${this.props.label}`}
          description={error.message || 'An unexpected error interrupted rendering.'}
          action={
            <Button size="sm" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }
}
