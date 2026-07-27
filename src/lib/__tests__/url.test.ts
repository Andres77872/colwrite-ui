import { describe, expect, it } from 'vitest';
import { safeExternalHttpUrl } from '../url';

describe('safeExternalHttpUrl', () => {
  it('accepts absolute HTTP(S) resource links', () => {
    expect(safeExternalHttpUrl('https://www.semanticscholar.org/paper/abc')).toBe(
      'https://www.semanticscholar.org/paper/abc',
    );
    expect(safeExternalHttpUrl('http://example.test/paper.pdf')).toBe(
      'http://example.test/paper.pdf',
    );
  });

  it('rejects active-content, relative, malformed, and provider API URLs', () => {
    expect(safeExternalHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalHttpUrl('data:text/html,hello')).toBeNull();
    expect(safeExternalHttpUrl('/relative')).toBeNull();
    expect(safeExternalHttpUrl('not a url')).toBeNull();
    expect(
      safeExternalHttpUrl(`https://${['api', 'semanticscholar', 'org'].join('.')}/graph/v1/paper/x`),
    ).toBeNull();
    expect(
      safeExternalHttpUrl(`https://${['api', 'semanticscholar', 'org'].join('.')}./graph/v1/paper/x`),
    ).toBeNull();
  });
});
