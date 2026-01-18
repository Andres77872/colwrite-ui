import { useAuth } from './AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export function LandingPage() {
  const { openAuth } = useAuth();

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-4">
            <div 
              className="w-12 h-12 rounded-lg grid place-items-center bg-gradient-to-br from-primary to-primary/70 text-primary-foreground font-bold text-xl shadow-glow-sm"
              aria-hidden="true"
            >
              CW
            </div>
            <div>
              <CardTitle className="text-2xl">ColWrite</CardTitle>
              <CardDescription className="text-base">
                Assistant writer for arXiv papers
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-foreground leading-relaxed">
            ColWrite is a focused writing environment with an integrated AI assistant to help you compose, revise, and structure scientific documents. It brings:
          </p>
          
          <ul className="space-y-2 text-muted-foreground ml-1">
            <li className="flex items-start gap-2">
              <span className="text-primary mt-1.5 text-xs">&#9679;</span>
              <span>Context-aware suggestions as you write</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-1.5 text-xs">&#9679;</span>
              <span>Reference-aware prompts and inline tags</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-1.5 text-xs">&#9679;</span>
              <span>Fast versioned saves and document management</span>
            </li>
          </ul>

          <div className="pt-2 border-t border-border">
            <p className="text-sm text-muted-foreground">
              This project is currently in alpha. Features and data formats may change.
            </p>
          </div>
        </CardContent>

        <CardFooter>
          <Button onClick={openAuth} size="lg" className="w-full sm:w-auto">
            Sign in to continue
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
