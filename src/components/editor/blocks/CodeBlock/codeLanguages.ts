export type CodeLanguage = {
  /** What is stored in `language`; empty for plain text, which stores none. */
  id: string;
  label: string;
  /** Other names the same language arrives under: markdown fences, the assistant. */
  aliases?: readonly string[];
};

/**
 * Languages offered in the picker, in the order a paper reaches for them:
 * algorithms and analysis code first. Any identifier the API accepts can
 * still be stored; the picker then shows it as it is.
 */
export const CODE_LANGUAGES: ReadonlyArray<CodeLanguage> = [
  { id: '', label: 'Plain text', aliases: ['text', 'txt', 'plain', 'plaintext'] },
  { id: 'pseudocode', label: 'Pseudocode', aliases: ['pseudo', 'algorithm'] },
  { id: 'python', label: 'Python', aliases: ['py', 'python3'] },
  { id: 'r', label: 'R' },
  { id: 'julia', label: 'Julia', aliases: ['jl'] },
  { id: 'matlab', label: 'MATLAB' },
  { id: 'latex', label: 'LaTeX', aliases: ['tex'] },
  { id: 'bibtex', label: 'BibTeX', aliases: ['bib'] },
  { id: 'bash', label: 'Bash', aliases: ['sh', 'shell', 'zsh'] },
  { id: 'sql', label: 'SQL' },
  { id: 'c', label: 'C' },
  { id: 'c++', label: 'C++', aliases: ['cpp', 'cxx', 'cc'] },
  { id: 'cuda', label: 'CUDA', aliases: ['cu'] },
  { id: 'fortran', label: 'Fortran', aliases: ['f90', 'f95'] },
  { id: 'rust', label: 'Rust', aliases: ['rs'] },
  { id: 'go', label: 'Go', aliases: ['golang'] },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript', aliases: ['js'] },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts'] },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML', aliases: ['yml'] },
];

/**
 * The picker entry a stored identifier means, ignoring case and aliases —
 * a ```` ```py ```` fence is Python. Undefined for one the picker does not
 * list; the stored value is never rewritten either way.
 */
export function findCodeLanguage(id: string | undefined): CodeLanguage | undefined {
  const key = (id ?? '').trim().toLowerCase();
  return CODE_LANGUAGES.find((language) => language.id === key || language.aliases?.includes(key));
}

/** How a stored identifier reads in the block's chrome. */
export function codeLanguageLabel(id: string | undefined): string {
  return findCodeLanguage(id)?.label ?? id ?? 'Plain text';
}
