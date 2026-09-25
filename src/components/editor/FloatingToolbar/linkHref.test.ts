import { describe, expect, it } from 'vitest';
import { describeHref, normalizeHref } from './linkHref';

describe('normalizeHref', () => {
  it.each([
    ['arxiv.org/abs/2101.03961', 'https://arxiv.org/abs/2101.03961'],
    ['  www.example.com  ', 'https://www.example.com'],
    ['example.com:8080/x?y=1#z', 'https://example.com:8080/x?y=1#z'],
    ['localhost:5173', 'https://localhost:5173'],
    ['192.168.0.1/admin', 'https://192.168.0.1/admin'],
    ['//cdn.example.com/a.js', 'https://cdn.example.com/a.js'],
    ['ada@example.com', 'mailto:ada@example.com'],
    ['https://example.com/a', 'https://example.com/a'],
    ['HTTP://Example.com', 'HTTP://Example.com'],
    ['mailto:ada@example.com', 'mailto:ada@example.com'],
    ['tel:+441234', 'tel:+441234'],
    ['#method', '#method'],
  ])('%s → %s', (raw, href) => {
    expect(normalizeHref(raw)).toEqual({ ok: true, href });
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<b>x</b>',
    'vbscript:msgbox',
    'file:///etc/passwd',
    'https://',
    'just words',
    'notalink',
    '',
  ])('refuses %j', (raw) => {
    expect(normalizeHref(raw).ok).toBe(false);
  });
});

describe('describeHref', () => {
  it('names the site without www', () => {
    expect(describeHref('https://www.arxiv.org/abs/1')).toMatchObject({ kind: 'web', title: 'arxiv.org' });
  });
  it('names mail and in-page links', () => {
    expect(describeHref('mailto:ada@example.com')).toMatchObject({ kind: 'mail', title: 'ada@example.com' });
    expect(describeHref('#method')).toMatchObject({ kind: 'anchor' });
  });
});
