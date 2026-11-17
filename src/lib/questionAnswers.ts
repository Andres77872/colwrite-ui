import type { QuestionAnswers, QuestionData } from '@/api/schema';

/** The author's readable message, matching the API's question-answer text.
 * The request carries the choices separately, not pasted instructions. */
export function questionAnswerText(question: QuestionData | undefined, answers: QuestionAnswers): string {
  if (!answers.items?.length) return 'I skip your questions: go with your best judgement, and say what you assumed.';
  return [
    'My answers to your questions:',
    ...answers.items.map((answer) => {
      const text = question?.question_id === answers.question_id
        ? question.questions.find((item) => item.id === answer.id)?.text
        : undefined;
      return `- ${text ?? `(${answer.id})`} ${answer.answer}`;
    }),
  ].join('\n');
}
