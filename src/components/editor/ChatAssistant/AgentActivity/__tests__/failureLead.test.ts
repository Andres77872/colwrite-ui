import { describe, expect, it } from 'vitest';
import { failureLead } from '../toolMeta';

describe('a failed call’s lead', () => {
  it('names the claim judge, a focused read, and a deep run without its plan', () => {
    expect(failureLead('claim_check_failed')).toBe('The claim could not be judged just now');
    expect(failureLead('web_focus_failed')).toBe('The page could not be read for what was asked');
    expect(failureLead('plan_required')).toBe('Needs an approved plan before it writes to the page');
    expect(failureLead('plan_not_found')).toBe('That plan is no longer open');
    expect(failureLead('stale_plan')).toContain('The plan was edited since');
  });

  it('reads a code it has no words for as "Failed"', () => {
    expect(failureLead('something_new')).toBe('Failed');
  });
});
