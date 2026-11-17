import { describe, expect, it } from 'vitest';
import { withoutRemoteLoads } from '../remoteLoads';

const EVIL = 'evil.example';

describe('withoutRemoteLoads', () => {
  it('returns markup that loads nothing from elsewhere unchanged', () => {
    const svg = '<svg id="d"><defs><marker id="m"></marker></defs><path marker-end="url(#m)"></path>'
      + '<image href="data:image/png;base64,AAAA"></image><use href="#m"></use><a href="https://example.org">link</a></svg>';
    expect(withoutRemoteLoads(svg)).toBe(svg);
  });

  it.each([
    ['an image shape', `<svg><image href="https://${EVIL}/a.png" width="10"></image></svg>`],
    ['an xlink image', `<svg><image xlink:href="https://${EVIL}/a.png"></image></svg>`],
    ['an html label image', `<svg><foreignObject><div><img src="https://${EVIL}/a.png"></div></foreignObject></svg>`],
    ['a srcset', `<svg><foreignObject><img src="data:image/png;base64,AAAA" srcset="https://${EVIL}/a.png 2x"></foreignObject></svg>`],
    ['a style url', `<svg><g style="fill: url(https://${EVIL}/p)"></g></svg>`],
    ['a stylesheet import', `<svg><style>@import url("https://${EVIL}/x.css"); .a{fill:red}</style></svg>`],
    ['a stylesheet url', `<svg><style>.a{background:url('//${EVIL}/x.png')}</style></svg>`],
    ['a feImage', `<svg><filter><feImage href="https://${EVIL}/a.png"></feImage></filter></svg>`],
    ['an external use', `<svg><use href="https://${EVIL}/sprite.svg#a"></use></svg>`],
    ['a link element', `<svg><foreignObject><link rel="stylesheet" href="https://${EVIL}/x.css"></foreignObject></svg>`],
    ['an animation that sets an href', `<svg><image><set attributeName="href" to="https://${EVIL}/a.png"></set></image></svg>`],
    ['a video poster', `<svg><foreignObject><video poster="https://${EVIL}/p.png"></video></foreignObject></svg>`],
  ])('takes out %s', (_name, svg) => {
    const out = withoutRemoteLoads(svg);
    expect(out).not.toContain(EVIL);
    expect(out.startsWith('<svg')).toBe(true);
  });

  it('keeps the rest of the drawing around what it takes out', () => {
    const out = withoutRemoteLoads(`<svg><text>Label</text><image href="https://${EVIL}/a.png"></image><style>.a{fill:red}</style></svg>`);
    expect(out).toContain('<text>Label</text>');
    expect(out).toContain('.a{fill:red}');
  });
});
