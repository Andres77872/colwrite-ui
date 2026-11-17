import { useId, useState } from 'react';
import type { QuestionAnswers } from '@/api/schema';
import type { AgentQuestion } from '@/api/assistant/streamParser';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type AnswerQuestion = (answers: QuestionAnswers) => void;

/** A question ends its turn, not the conversation. No waiting run or modal. */
export function QuestionCard({ question, onAnswer }: { question: AgentQuestion; onAnswer?: AnswerQuestion }) {
  return <QuestionForm key={question.question_id} question={question} onAnswer={onAnswer} />;
}

function QuestionForm({ question, onAnswer }: { question: AgentQuestion; onAnswer?: AnswerQuestion }) {
  const titleId = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const active = Boolean(onAnswer);
  const items = question.questions.flatMap((item) => {
    const answer = values[item.id]?.trim();
    return answer ? [{ id: item.id, answer }] : [];
  });
  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-border bg-popover p-3 text-sm">
      <h3 id={titleId} className="font-medium">A few questions</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {active ? 'Answer what matters, skip, or continue in the composer.' : 'You can continue in the composer.'}
      </p>
      <div className="mt-3 space-y-4">
        {question.questions.map((item) => (
          <fieldset key={item.id} disabled={!active} className="min-w-0 space-y-2">
            <legend className="mb-2 font-medium">{item.text}</legend>
            {!!item.options.length && (
              <div className="flex flex-wrap gap-1.5">
                {item.options.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant="outline"
                    size="xs"
                    aria-pressed={values[item.id] === option}
                    onClick={() => setValues((current) => ({
                      ...current, [item.id]: current[item.id] === option ? '' : option,
                    }))}
                    className={cn('h-auto whitespace-normal text-left', values[item.id] === option && 'border-primary bg-primary/10')}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            )}
            {item.allow_free_text && (
              <Textarea
                aria-label={`Your answer: ${item.text}`}
                value={values[item.id] ?? ''}
                maxLength={2_000}
                onChange={(event) => setValues((current) => ({ ...current, [item.id]: event.target.value }))}
                className="min-h-16"
                placeholder="Your answer"
              />
            )}
          </fieldset>
        ))}
      </div>
      {onAnswer && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="xs" onClick={() => onAnswer({ question_id: question.question_id, items: [] })}>
            Go with your best guess
          </Button>
          <Button type="button" size="xs" disabled={!items.length} onClick={() => onAnswer({ question_id: question.question_id, items })}>
            Send answers
          </Button>
        </div>
      )}
    </section>
  );
}
