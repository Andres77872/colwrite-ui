import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CITATION_STYLES } from '../styles';

/**
 * The vendored CSL files are the ones `scripts/vendor-csl.mjs fetch` copied,
 * unmodified (its `check`, without the network): each matches the sha256
 * `SOURCES.json` recorded, comes from the CSL project's repositories at one
 * pinned commit each, and keeps its licence; and the files are exactly the
 * API's eight styles and the two locales the renderer loads.
 */

type Entry = { path: string; title: string | null; license: string; repository: string; commit: string; source: string; url: string; sha256: string };

const root = resolve(__dirname, '../../../vendor/csl');
const manifest = JSON.parse(readFileSync(join(root, 'SOURCES.json'), 'utf8')) as { note: string; files: Entry[] };
const bytes = (path: string) => readFileSync(join(root, path));

describe('the vendored CSL styles and locales', () => {
  it('are exactly the API’s styles and the locales the renderer loads', () => {
    expect(manifest.files.map((entry) => entry.path).sort()).toEqual([
      ...CITATION_STYLES.map((style) => `styles/${style.id}.csl`),
      'locales/locales-en-GB.xml',
      'locales/locales-en-US.xml',
    ].sort());
  });

  it.each(manifest.files.map((entry) => [entry.path, entry] as const))('%s is the file its source served, unmodified', (path, entry) => {
    expect(createHash('sha256').update(bytes(path)).digest('hex')).toBe(entry.sha256);
    expect(entry.url).toBe(`https://raw.githubusercontent.com/${entry.repository.replace('https://github.com/', '')}/${entry.commit}/${entry.source}`);
    // Its licence is the file's own, which the file still carries.
    expect(bytes(path).toString('utf8')).toContain(`license="${entry.license}"`);
    expect(entry.license).toBe('http://creativecommons.org/licenses/by-sa/3.0/');
  });

  it('come from the CSL project, each repository at one pinned commit', () => {
    const commits = new Map<string, Set<string>>();
    for (const entry of manifest.files) {
      commits.set(entry.repository, (commits.get(entry.repository) ?? new Set()).add(entry.commit));
    }
    expect([...commits.keys()].sort()).toEqual([
      'https://github.com/citation-style-language/locales',
      'https://github.com/citation-style-language/styles',
    ]);
    for (const pinned of commits.values()) {
      expect(pinned.size).toBe(1);
      expect([...pinned][0]).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});
