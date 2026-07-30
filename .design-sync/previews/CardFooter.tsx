import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from 'colwrite-ui';
import { Check, Plus, Upload, X } from 'lucide-react';

// CardFooter cannot mount alone — every cell is the real Card composition with
// the footer carrying the variation.

export function Canonical() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-md">Proposed edits</CardTitle>
        <CardDescription>4 blocks changed in Experiments</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Nothing is written to the document until you accept.
        </p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="ghost" size="sm">
          <X />
          Reject all
        </Button>
        <Button size="sm">
          <Check />
          Accept all
        </Button>
      </CardFooter>
    </Card>
  );
}

export function SpaceBetween() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-md">vaswani-2017-attention.pdf</CardTitle>
        <CardDescription>15 pages · 2.4 MB</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The assistant can read and quote this file.
        </p>
      </CardContent>
      <CardFooter className="justify-between">
        <span className="text-xs text-muted-foreground">Uploaded 12 Mar</span>
        <Button variant="outline" size="sm">
          Attach
        </Button>
      </CardFooter>
    </Card>
  );
}

export function Bordered() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-md">Attention Is All You Need, Revisited</CardTitle>
        <CardDescription>Draft · 5 sections · saved 4 minutes ago</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Introduction, Related Work, Method, Experiments, Conclusion.
        </p>
      </CardContent>
      <CardFooter className="mt-2 justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" size="sm">
          Duplicate
        </Button>
        <Button variant="destructive" size="sm">
          Delete document
        </Button>
      </CardFooter>
    </Card>
  );
}

export function Stacked() {
  return (
    <Card className="w-full max-w-xs">
      <CardHeader className="p-3">
        <CardTitle className="text-sm">No files yet</CardTitle>
        <CardDescription className="text-xs">
          PDFs you upload are kept with your account.
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex-col items-stretch gap-2 p-3 pt-0">
        <Button size="sm" className="w-full">
          <Upload />
          Upload a PDF
        </Button>
        <Button variant="outline" size="sm" className="w-full">
          <Plus />
          Add from arXiv
        </Button>
      </CardFooter>
    </Card>
  );
}
