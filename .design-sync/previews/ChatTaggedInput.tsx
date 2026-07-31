import { ChatTaggedInput } from 'colwrite-ui';

// ChatTaggedInput is the assistant's message composer. It is a contenteditable
// rather than a textarea for one reason: a `#doc/…` reference renders as a chip
// the caret steps over in a single press, which no plain text field can do.
// Everything else about it behaves like a text field — Enter sends,
// Shift+Enter opens a line, and `value` is a plain string.
//
// It reads no context, so these cards render it directly. `value` is pinned per
// cell and `onChange` is a no-op: a static card has nowhere to write back to,
// and the point of each cell is the rendered state, not the typing.

const noop = () => {};

function Composer({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-[34rem] rounded-lg border border-border bg-card p-2">{children}</div>
  );
}

export function WithAReference() {
  return (
    <Composer>
      <ChatTaggedInput
        value="Tighten the abstract of #doc/attention-revisited so it names the matched-budget caveat."
        onChange={noop}
      />
    </Composer>
  );
}

export function Empty() {
  return (
    <Composer>
      <ChatTaggedInput
        value=""
        onChange={noop}
        placeholder="Ask for an edit, or #mention a document…"
      />
    </Composer>
  );
}

export function PlainMessage() {
  return (
    <Composer>
      <ChatTaggedInput
        value="Which of these two scaling claims is better supported by the data in section 4?"
        onChange={noop}
      />
    </Composer>
  );
}

export function SeveralReferences() {
  return (
    <Composer>
      <ChatTaggedInput
        value="Compare the results table in #doc/attention-revisited with the one in #doc/scaling-notes and tell me where they disagree."
        onChange={noop}
      />
    </Composer>
  );
}

export function Disabled() {
  return (
    <Composer>
      <ChatTaggedInput
        value="Waiting for the current turn to finish…"
        onChange={noop}
        disabled
      />
    </Composer>
  );
}
