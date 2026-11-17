import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentQuestion } from '@/api/assistant/streamParser';
import { QuestionCard } from '../QuestionCard';
import { questionAnswerText } from '@/lib/questionAnswers';

afterEach(cleanup);

const question: AgentQuestion = {
  question_id: 'q1',
  questions: [
    { id: 'venue', text: 'Which venue?', options: ['ICLR', 'NeurIPS'], allow_free_text: false },
    { id: 'scope', text: 'Which period?', options: ['Since 2020'], allow_free_text: true },
  ],
};

describe('the author’s question card', () => {
  it('sends the selected option and free answer as typed answers, not tool arguments', () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={question} onAnswer={onAnswer} />);
    expect((screen.getByRole('button', { name: 'Send answers' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'ICLR' }));
    expect(screen.getByRole('button', { name: 'ICLR' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByRole('textbox', { name: 'Your answer: Which period?' }), { target: { value: '  Since 2018  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
    const answers = { question_id: 'q1', items: [{ id: 'venue', answer: 'ICLR' }, { id: 'scope', answer: 'Since 2018' }] };
    expect(onAnswer).toHaveBeenCalledWith(answers);
    expect(questionAnswerText(question, answers)).toBe('My answers to your questions:\n- Which venue? ICLR\n- Which period? Since 2018');
    expect(screen.queryByRole('textbox', { name: 'Your answer: Which venue?' })).toBeNull();
  });

  it('allows partial answers and does not invent an answer to an untouched question', () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={question} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'NeurIPS' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
    expect(onAnswer).toHaveBeenCalledWith({ question_id: 'q1', items: [{ id: 'venue', answer: 'NeurIPS' }] });
  });

  it('skips with an explicit empty answers list even when a choice was filled', () => {
    const onAnswer = vi.fn();
    render(<QuestionCard question={question} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'ICLR' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go with your best guess' }));
    expect(onAnswer).toHaveBeenCalledWith({ question_id: 'q1', items: [] });
    expect(questionAnswerText(question, { question_id: 'q1', items: [] })).toContain('say what you assumed');
  });

  it('keeps historical questions readable without offering another submission', () => {
    render(<QuestionCard question={question} />);
    expect(screen.getByRole('group', { name: 'Which venue?' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'ICLR' }) as HTMLButtonElement).disabled).toBe(false);
    // Native fieldset disabled also disables its controls, without rewriting
    // each child’s contract or making the card disappear.
    expect(screen.getByRole('button', { name: 'ICLR' }).closest('fieldset')?.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Send answers' })).toBeNull();
  });

  it('starts a new draft when a different question card arrives', () => {
    const onAnswer = vi.fn();
    const view = render(<QuestionCard question={question} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'ICLR' }));
    view.rerender(<QuestionCard question={{ ...question, question_id: 'q2' }} onAnswer={onAnswer} />);
    expect(screen.getByRole('button', { name: 'ICLR' }).getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByRole('button', { name: 'Send answers' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
