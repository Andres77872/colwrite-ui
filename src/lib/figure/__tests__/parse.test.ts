import { describe, expect, it } from 'vitest';
import { MathTracker, lineColumn, parseFigureSource } from '../parse';
import type { FigureDiagnostic, JsonNode, ParseResult } from '../types';

const FENCE = '```';

/** Every node (and member key) in document order. */
function walk(node: JsonNode, visit: (node: JsonNode) => void, visitKey?: (key: string, start: number, end: number) => void) {
  visit(node);
  if (node.kind === 'object') {
    for (const member of node.members) {
      visitKey?.(member.key, member.keyStart, member.keyEnd);
      expect(member.start).toBe(member.keyStart);
      expect(member.end).toBe(member.value.end);
      walk(member.value, visit, visitKey);
    }
  } else if (node.kind === 'array') {
    for (const item of node.items) walk(item, visit, visitKey);
  }
}

function plain(node: JsonNode): unknown {
  switch (node.kind) {
    case 'object':
      return Object.fromEntries(node.members.map((member) => [member.key, plain(member.value)]));
    case 'array':
      return node.items.map(plain);
    case 'null':
      return null;
    default:
      return node.value;
  }
}

/** For strict JSON input, each node's range slices out exactly that value's JSON text. */
function expectExactRanges(source: string, result: ParseResult) {
  expect(result.ast).not.toBeNull();
  walk(
    result.ast!,
    (node) => expect(JSON.parse(source.slice(node.start, node.end))).toEqual(plain(node)),
    (key, start, end) => expect(JSON.parse(source.slice(start, end))).toBe(key),
  );
}

function ok(source: string): ParseResult {
  const result = parseFigureSource(source);
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return result;
}

function label(source: string): string {
  const value = ok(source).value as { label: string };
  return value.label;
}

function codes(result: ParseResult): string[] {
  return result.diagnostics.map((d) => d.code);
}

function syntaxError(source: string): FigureDiagnostic {
  const result = parseFigureSource(source);
  expect(result.ast).toBeNull();
  expect(result.value).toBeNull();
  expect(result.diagnostics).toHaveLength(1);
  const [error] = result.diagnostics;
  expect(error.severity).toBe('error');
  expect(error.code).toBe('json.syntax');
  expect(error.range).toBeDefined();
  expect({ line: error.line, column: error.column }).toEqual(lineColumn(source, error.range![0]));
  return error;
}

/** Deterministic pseudo-random JSON for the equivalence property. */
function corpus(seed: number, count: number): unknown[] {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const alphabet = ['a', 'Z', ' ', '$', '\\', '"', "'", '/', 'é', '⊕', '😀', 'b', 'n', 't', '{', ']', ':', ','];
  const string = () => Array.from({ length: Math.floor(next() * 12) }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
  const value = (depth: number): unknown => {
    const pick = next();
    if (depth > 3 || pick < 0.35) {
      const scalar = next();
      if (scalar < 0.3) return string();
      if (scalar < 0.6) return Math.round((next() - 0.5) * 1e6) / (next() < 0.5 ? 1 : 1000);
      if (scalar < 0.75) return next() < 0.5;
      if (scalar < 0.85) return null;
      return (next() - 0.5) * 1e-8;
    }
    if (pick < 0.65) return Array.from({ length: Math.floor(next() * 5) }, () => value(depth + 1));
    return Object.fromEntries(Array.from({ length: Math.floor(next() * 5) }, () => [string(), value(depth + 1)]));
  };
  return Array.from({ length: count }, () => value(0));
}

describe('parseFigureSource — strict JSON', () => {
  const figure = `{
  "caption": "Multi-head latent attention. Only $\\\\mathbf{c}_t^{KV}$ is cached.",
  "direction": "up",
  "nodes": [
    "Q",
    { "id": "h", "label": "$\\\\mathbf{h}_t$", "role": "input", "width": 120.5, "stack": 3 },
    { "id": "g", "children": ["a", { "id": "b", "tone": null, "bold": true, "italic": false }] }
  ],
  "edges": ["h -> g", { "from": ["h"], "to": ["b"], "label": "$W^{DKV}$" }],
  "legend": []
}`;

  it('reads a figure exactly as JSON.parse does, without diagnostics', () => {
    const result = ok(figure);
    expect(result.value).toEqual(JSON.parse(figure));
    expect(result.diagnostics).toEqual([]);
  });

  it('gives every node and key a range that slices exactly its own text', () => {
    expectExactRanges(figure, parseFigureSource(figure));
  });

  it('matches JSON.parse and keeps exact ranges over a generated corpus', () => {
    for (const [i, value] of corpus(20260924, 150).entries()) {
      const source = JSON.stringify(value, null, i % 3 === 0 ? undefined : i % 3);
      const result = parseFigureSource(source);
      expect(result.diagnostics).toEqual([]);
      expect(result.value).toEqual(JSON.parse(source));
      expectExactRanges(source, result);
    }
  });

  it('reads scalars at the top level', () => {
    expect(ok('true').value).toBe(true);
    expect(ok(' null ').value).toBeNull();
    expect(ok('-0.25e2').value).toBe(-25);
    expect(ok('"x"').ast).toEqual({ kind: 'string', start: 0, end: 3, value: 'x' });
  });

  it('decodes the standard escapes', () => {
    expect(label(String.raw`{"label": "a\"b\\c\/d\u00e9\u2295"}`)).toBe('a"b\\c/dé⊕');
    expect(label(String.raw`{"label": "\ud83d\ude00"}`)).toBe('😀');
    expect(label(String.raw`{"label": "tab\there"}`)).toBe('tab\there');
  });

  it('stores a __proto__ key as data, as JSON.parse does', () => {
    const result = ok('{"__proto__": {"polluted": true}, "a": 1}');
    const value = result.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.keys(value)).toEqual(['__proto__', 'a']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('is deterministic', () => {
    expect(parseFigureSource(figure)).toEqual(parseFigureSource(figure));
  });
});

describe('parseFigureSource — leniency', () => {
  it('skips a BOM and surrounding whitespace', () => {
    const source = '\uFEFF \n\t{"a": 1}\n\n ';
    const result = ok(source);
    expect(result.value).toEqual({ a: 1 });
    expect(result.ast!.start).toBe(source.indexOf('{'));
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ['json', `${FENCE}json\n{"a": 1}\n${FENCE}`],
    ['figure', `${FENCE}figure\n{"a": 1}\n${FENCE}\n`],
    ['bare', `\n  ${FENCE}\n{"a": 1}\n${FENCE}  \n\n`],
    ['long', `${FENCE}\`\`jsonc\n{"a": 1}\n${FENCE}\`\``],
    ['tilde', '~~~json\n{"a": 1}\n~~~'],
    ['crlf', `${FENCE}json\r\n{"a": 1}\r\n${FENCE}\r\n`],
    ['unclosed', `${FENCE}json\n{"a": 1}\n`],
  ])('reads inside a Markdown fence (%s) with offsets into the original text', (_name, source) => {
    const result = ok(source);
    expect(result.value).toEqual({ a: 1 });
    expect(result.diagnostics).toEqual([]);
    const ast = result.ast!;
    expect(source.slice(ast.start, ast.end)).toBe('{"a": 1}');
    const member = ast.kind === 'object' ? ast.members[0] : null;
    expect(source.slice(member!.keyStart, member!.keyEnd)).toBe('"a"');
  });

  it('does not let a closing fence end the JSON early when the fence is not closed', () => {
    expect(ok(`${FENCE}\n[1, 2]`).value).toEqual([1, 2]);
  });

  it('rejects text after the closing fence and an empty fence', () => {
    const after = syntaxError(`${FENCE}json\n{"a": 1}\n${FENCE}\nHope this helps!`);
    expect(after.message).toBe('Unexpected text after the closing Markdown fence.');
    expect(after.line).toBe(4);
    expect(syntaxError(`${FENCE}json\n${FENCE}`).message).toBe('The source is empty; expected a JSON object.');
  });

  it('skips line and block comments everywhere', () => {
    const source = `// leading
/* block */ {
  "a": /* before value */ 1, // after
  /* before key */ "b" /* before colon */ : [ // in array
    2, /* between */ 3 // last
  ] /* end */
} // trailing`;
    const result = ok(source);
    expect(result.value).toEqual({ a: 1, b: [2, 3] });
    expect(result.diagnostics).toEqual([]);
    const ast = result.ast!;
    expect(ast.kind === 'object' && source.slice(ast.members[1].start, ast.members[1].end)).toBe(
      '"b" /* before colon */ : [ // in array\n    2, /* between */ 3 // last\n  ]',
    );
  });

  it('does not take // inside a string for a comment', () => {
    expect(ok('{"src": "https://example.com/a.png"}').value).toEqual({ src: 'https://example.com/a.png' });
  });

  it('fails on an unterminated block comment at its start', () => {
    const error = syntaxError('{\n  "a": 1 /* open\n}');
    expect(error.message).toBe('Unterminated comment: add the closing */.');
    expect([error.line, error.column]).toEqual([2, 10]);
  });

  it('accepts trailing commas silently', () => {
    const result = ok('{"a": [1, 2, ], "b": {"c": 1,},}');
    expect(result.value).toEqual({ a: [1, 2], b: { c: 1 } });
    expect(result.diagnostics).toEqual([]);
  });

  it('reads single-quoted strings and keys', () => {
    const source = `{'label': 'say "hi" it\\'s', 'k': '$\\beta$'}`;
    const result = ok(source);
    expect(result.value).toEqual({ label: 'say "hi" it\'s', k: '$\\beta$' });
    const ast = result.ast!;
    expect(ast.kind === 'object' && source.slice(ast.members[0].value.start, ast.members[0].value.end)).toBe(
      `'say "hi" it\\'s'`,
    );
  });

  it('reads unquoted identifier keys with exact key ranges', () => {
    const source = '{ id: "a", font-size: 12, $ref: 1, _x2: true }';
    const result = ok(source);
    expect(result.value).toEqual({ id: 'a', 'font-size': 12, $ref: 1, _x2: true });
    expect(result.diagnostics).toEqual([]);
    const ast = result.ast!;
    if (ast.kind !== 'object') throw new Error('expected an object');
    expect(ast.members.map((m) => source.slice(m.keyStart, m.keyEnd))).toEqual(['id', 'font-size', '$ref', '_x2']);
    expect(source.slice(ast.members[1].start, ast.members[1].end)).toBe('font-size: 12');
  });

  it('recovers a missing comma at a line break between members, with a warning at the gap', () => {
    const source = '{\n  "a": "x"\n  "b": 2\n}';
    const result = ok(source);
    expect(result.value).toEqual({ a: 'x', b: 2 });
    expect(result.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'json.missing-comma',
        message: "Missing ',' between members; read as if it were there.",
        range: [12, 12],
        line: 2,
        column: 11,
      },
    ]);
    // Right after the closing quote of "x", where the comma belongs.
    expect(source.slice(9, 12)).toBe('"x"');
  });

  it('recovers a missing comma between items and across comments', () => {
    const result = ok('{"nodes": [\n  "a"\n  {"id": "b"} // note\n  /* c */ [1]\n]}');
    expect(result.value).toEqual({ nodes: ['a', { id: 'b' }, [1]] });
    expect(codes(result)).toEqual(['json.missing-comma', 'json.missing-comma']);
    expect(result.diagnostics.map((d) => d.path)).toEqual(['nodes', 'nodes']);
  });

  it('does not guess a missing comma on the same line', () => {
    const error = syntaxError('{"a": 1 "b": 2}');
    expect(error.message).toBe("Expected ',' or '}' after a member, found '\"'. Is a ',' missing?");
    expect(error.range).toEqual([8, 9]);
    expect(syntaxError('[1 2]').message).toBe("Expected ',' or ']' after an item, found `2`. Is a ',' missing?");
  });

  it('keeps both duplicate members in the AST, the last in the value, and warns at the second key', () => {
    const source = '{"nodes": [{"id": "a", "tone": "red", "tone": "blue"}]}';
    const result = ok(source);
    expect(result.value).toEqual({ nodes: [{ id: 'a', tone: 'blue' }] });
    const node = (result.ast as { members: { value: { items: JsonNode[] } }[] }).members[0].value.items[0];
    expect(node.kind === 'object' && node.members.map((m) => m.key)).toEqual(['id', 'tone', 'tone']);
    const second = source.lastIndexOf('"tone"');
    expect(result.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'json.duplicate-key',
        message: 'Duplicate key "tone"; the last one wins.',
        path: 'nodes[0].tone',
        range: [second, second + 6],
        line: 1,
        column: second + 1,
      },
    ]);
  });

  it('keeps the first position of a duplicate key in the value, like JSON.parse', () => {
    const source = '{"a": 1, "b": 2, "a": 3}';
    expect(Object.keys(ok(source).value as object)).toEqual(Object.keys(JSON.parse(source)));
  });

  it('names odd keys with bracket paths', () => {
    const result = ok('{"a b": {"x": 1, "x": 2}}');
    expect(result.diagnostics[0].path).toBe('["a b"].x');
  });
});

describe('parseFigureSource — LaTeX in strings', () => {
  it.each([
    ['\\beta', String.raw`$\beta$`],
    ['\\frac', String.raw`$\frac{a}{b}$`],
    ['\\nabla', String.raw`$\nabla f$`],
    ['\\rho', String.raw`$\rho$`],
    ['\\times', String.raw`$B\times T$`],
    ['\\theta', String.raw`$\theta$`],
    ['\\text', String.raw`$\text{softmax}$`],
    ['\\top', String.raw`$QK^\top$`],
    ['\\nu', String.raw`$\nu$`],
    ['\\to', String.raw`$x \to y$`],
  ])('keeps %s inside maths as LaTeX, silently', (_name, text) => {
    const result = ok(`{"label": "${text}"}`);
    expect((result.value as { label: string }).label).toBe(text);
    expect(result.diagnostics).toEqual([]);
  });

  it('reads the same escapes outside maths as JSON does', () => {
    expect(label(String.raw`{"label": "Multi-Head\nAttention"}`)).toBe('Multi-Head\nAttention');
    expect(label(String.raw`{"label": "a\tb"}`)).toBe('a\tb');
    expect(label(String.raw`{"label": "\beta"}`)).toBe('\beta');
    expect(label(String.raw`{"label": "x\r\ny"}`)).toBe('x\r\ny');
    expect(label(String.raw`{"label": "\frac"}`)).toBe('\frac');
  });

  it('reads the escapes as JSON inside maths when no letter follows', () => {
    expect(label(String.raw`{"label": "$a\n$"}`)).toBe('$a\n$');
    expect(label(String.raw`{"label": "$a\t1$"}`)).toBe('$a\t1$');
    expect(label(String.raw`{"label": "$a\n\beta$"}`)).toBe('$a\n\\beta$');
  });

  it('tracks maths through several spans and line breaks', () => {
    expect(label(String.raw`{"label": "$W^Q$\n$\beta$\nand\tmore $\times$"}`)).toBe(
      '$W^Q$\n$\\beta$\nand\tmore $\\times$',
    );
  });

  it('treats an escaped dollar as literal text that does not open maths', () => {
    // `\$` stays `\$` (not a JSON escape) and does not toggle: `\b` after it is a backspace.
    expect(label(String.raw`{"label": "\$5 \beta"}`)).toBe('\\$5 \beta');
    // Strict spelling of the same thing.
    expect(label(String.raw`{"label": "\\$5 \beta"}`)).toBe('\\$5 \beta');
    // An escaped backslash before `$` leaves the dollar unescaped, so maths opens.
    expect(label(String.raw`{"label": "\\\\$\beta$"}`)).toBe('\\\\$\\beta$');
    // A dollar written as $ is still a dollar.
    expect(label(String.raw`{"label": "\u0024\beta$"}`)).toBe('$\\beta$');
  });

  it('keeps any other backslash sequence and notes it once per string', () => {
    const source = String.raw`{"a": "$\alpha + \mathbf{x} \sum \left( \uparrow$", "b": "\mathrm{d}"}`;
    const result = ok(source);
    expect(result.value).toEqual({ a: '$\\alpha + \\mathbf{x} \\sum \\left( \\uparrow$', b: '\\mathrm{d}' });
    expect(result.diagnostics).toEqual([
      {
        severity: 'info',
        code: 'json.latex-escape',
        message: '`\\alpha` is not a JSON escape; kept as LaTeX (strict JSON writes `\\\\alpha`).',
        path: 'a',
        range: [8, 14],
        line: 1,
        column: 9,
      },
      expect.objectContaining({ code: 'json.latex-escape', path: 'b', range: [source.indexOf('\\mathrm'), source.indexOf('\\mathrm') + 7] }),
    ]);
  });

  it('notes a non-letter backslash sequence by its two characters', () => {
    const result = ok(String.raw`{"a": "x\,y"}`);
    expect((result.value as { a: string }).a).toBe('x\\,y');
    expect(result.diagnostics[0].message.startsWith('`\\,`')).toBe(true);
    expect(result.diagnostics[0].range).toEqual([8, 10]);
  });

  it.each([
    ['TAB', '\t', 'imes', '\\times'],
    ['LF', '\n', 'abla', '\\nabla'],
    ['CR', '\r', 'ho', '\\rho'],
    ['BS', '\b', 'eta', '\\beta'],
    ['FF', '\f', 'rac{1}{2}', '\\frac{1}{2}'],
  ])('restores a raw %s inside maths that an upstream decoder produced', (_name, control, rest, restored) => {
    const result = ok(`{"label": "$x ${control}${rest}$"}`);
    expect((result.value as { label: string }).label).toBe(`$x ${restored}$`);
    expect(result.diagnostics).toEqual([]);
  });

  it('restores a whole double-decoded label', () => {
    // What `JSON.parse` makes of a model's `"$\\mathbf{q}_t \times W^Q$"` written with single backslashes.
    const decoded = JSON.parse(String.raw`"{\"label\": \"$\\mathbf{q}_t \times \beta \frac{1}{\\sqrt{d}}$\"}"`);
    expect(label(decoded)).toBe('$\\mathbf{q}_t \\times \\beta \\frac{1}{\\sqrt{d}}$');
  });

  it('keeps raw line breaks and tabs outside maths with one warning per string', () => {
    const source = '{"a": "line\nbreak\tand\ttabs", "b": "x\ty"}';
    const result = ok(source);
    expect(result.value).toEqual({ a: 'line\nbreak\tand\ttabs', b: 'x\ty' });
    expect(result.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'json.raw-control',
        message: 'A raw line break inside a string was kept; strict JSON writes it as \\n.',
        path: 'a',
        range: [11, 12],
        line: 1,
        column: 12,
      },
      expect.objectContaining({
        code: 'json.raw-control',
        message: 'A raw tab inside a string was kept; strict JSON writes it as \\t.',
        path: 'b',
      }),
    ]);
  });

  it('keeps a raw control inside maths when no letter follows, with a warning', () => {
    const result = ok('{"a": "$x\ny$", "b": "$x\n1$", "c": "\u0001"}');
    expect(result.value).toEqual({ a: '$x\\ny$', b: '$x\n1$', c: '\u0001' });
    expect(result.diagnostics.map((d) => [d.path, d.message])).toEqual([
      ['b', 'A raw line break inside a string was kept; strict JSON writes it as \\n.'],
      ['c', 'A raw control character (U+0001) inside a string was kept; strict JSON escapes it.'],
    ]);
  });

  it('treats $$…$$ as one display-maths span', () => {
    expect(label(String.raw`{"label": "$$\frac{a}{b} \times \beta$$ then\nnext"}`)).toBe(
      '$$\\frac{a}{b} \\times \\beta$$ then\nnext',
    );
    // Adjacent inline spans are not mistaken for a display span.
    expect(label(String.raw`{"label": "$a$$\beta$ and\nmore"}`)).toBe('$a$$\\beta$ and\nmore');
    // An escaped dollar next to a real one: literal, then maths opens.
    expect(label(String.raw`{"label": "\\$$\beta$"}`)).toBe('\\$$\\beta$');
  });

  it('applies the same rules to single-quoted strings and keys', () => {
    expect(ok(String.raw`{'$\beta$': '$\times$'}`).value).toEqual({ '$\\beta$': '$\\times$' });
  });
});

describe('parseFigureSource — numbers', () => {
  it.each([
    ['+1', 1],
    ['.5', 0.5],
    ['-.5', -0.5],
    ['5.', 5],
    ['01', 1],
    ['+.5e1', 5],
  ])('reads %s with a number-format warning', (text, value) => {
    const source = `{"n": ${text}}`;
    const result = ok(source);
    expect(result.value).toEqual({ n: value });
    expect(result.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'json.number-format',
        message: `\`${text}\` is not a strict JSON number; read as ${value}.`,
        path: 'n',
        range: [6, 6 + text.length],
        line: 1,
        column: 7,
      },
    ]);
    const ast = result.ast!;
    expect(ast.kind === 'object' && source.slice(ast.members[0].value.start, ast.members[0].value.end)).toBe(text);
  });

  it('reads strict numbers silently', () => {
    const result = ok('[0, -0, 1.5, 1e3, 1E-3, -2.5e+2, 9007199254740992]');
    expect(result.value).toEqual([0, -0, 1.5, 1000, 0.001, -250, 9007199254740992]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ['NaN', 'NaN and Infinity are not valid JSON numbers; use a finite number.', [6, 9]],
    ['Infinity', 'NaN and Infinity are not valid JSON numbers; use a finite number.', [6, 14]],
    ['-Infinity', 'NaN and Infinity are not valid JSON numbers; use a finite number.', [6, 15]],
    ['+NaN', 'NaN and Infinity are not valid JSON numbers; use a finite number.', [6, 10]],
    ['1e999', 'The number `1e999` is too large.', [6, 11]],
    ['12px', 'Invalid number `12px`. Sizes are plain numbers in px, without a unit.', [6, 10]],
    ['0x1F', 'Invalid number `0x1F`.', [6, 10]],
    ['1.2.3', 'Invalid number `1.2.3`.', [6, 11]],
    ['1e', 'Invalid number `1e`.', [6, 8]],
    ['-', 'Invalid number `-`.', [6, 7]],
    ['.', 'Invalid number `.`.', [6, 7]],
    ['-abc', 'Invalid number `-abc`.', [6, 10]],
  ])('rejects %s', (text, message, range) => {
    const error = syntaxError(`{"n": ${text}}`);
    expect(error.message).toBe(message);
    expect(error.range).toEqual(range);
    expect(error.path).toBe('n');
  });
});

describe('parseFigureSource — syntax errors', () => {
  it('points an unescaped quote inside a label at the stray word, with the hint', () => {
    const source = '{\n  "nodes": [\n    {"id": "t", "label": "The "big" model"}\n  ]\n}';
    const error = syntaxError(source);
    expect(error.message).toBe(
      "Expected ',' or '}' after a member, found `big`. If a quote belongs to the text, escape quotes inside strings as \\\".",
    );
    expect(error.range).toEqual([source.indexOf('big'), source.indexOf('big') + 3]);
    expect([error.line, error.column]).toEqual([3, 32]);
    expect(error.path).toBe('nodes[0]');
  });

  it('gives the same hint inside arrays', () => {
    expect(syntaxError('["say "hi" now"]').message).toBe(
      "Expected ',' or ']' after an item, found `hi`. If a quote belongs to the text, escape quotes inside strings as \\\".",
    );
  });

  it('suspects a missing closing quote when a string ran over lines', () => {
    const source = '{\n  "label": "abc,\n  "shape": "box"\n}';
    const error = syntaxError(source);
    expect(error.message).toBe(
      "Expected ',' or '}' after a member, found `shape`. The string that starts on line 2 runs over several lines; is its closing quote missing?",
    );
    expect([error.line, error.column]).toEqual([3, 4]);
  });

  it('reports an unterminated string at its opening quote', () => {
    const source = '{\n  "label": "abc\n}';
    const error = syntaxError(source);
    expect(error.message).toBe('Unterminated string: the " opened here is never closed.');
    expect(error.range).toEqual([13, source.length]);
    expect([error.line, error.column]).toEqual([2, 12]);
    expect(syntaxError("['abc").message).toBe("Unterminated string: the ' opened here is never closed.");
    expect(syntaxError('["abc\\').message).toBe('Unterminated string: the " opened here is never closed.');
  });

  it('reports unclosed containers at the end of the input, naming where they open', () => {
    const source = '{\n  "nodes": [\n    "a",\n';
    const error = syntaxError(source);
    expect(error.message).toBe("Unexpected end of input; the array that starts on line 2 is not closed with ']'.");
    expect(error.range).toEqual([source.length, source.length]);
    expect(error.line).toBe(4);
    expect(syntaxError('{"a": 1').message).toBe(
      "Unexpected end of input; the object that starts on line 1 is not closed with '}'.",
    );
    expect(syntaxError('{"a": 1,').message).toBe(
      "Unexpected end of input; the object that starts on line 1 is not closed with '}'.",
    );
    expect(syntaxError('{"a":').message).toBe('Unexpected end of input; expected a value.');
  });

  it.each([
    ['{"a" 1}', "Expected ':' after the key \"a\", found `1`.", [5, 6]],
    ['{"a": }', "Expected a value, found '}'.", [6, 7]],
    ['[1,,2]', "Expected a value, found ','.", [3, 4]],
    ['{,}', "Expected a property name or '}', found ','.", [1, 2]],
    ['{1: 2}', "Expected a property name or '}', found `1`.", [1, 2]],
    ['{"a": 1]', "Expected ',' or '}' after a member, found ']'.", [7, 8]],
    ['{"shape": box}', 'Unexpected `box`; text values must be quoted, e.g. "box".', [10, 13]],
    ['{"a": True}', 'Unexpected `True`; JSON writes true, false and null in lowercase.', [6, 10]],
    ['{"a": NULL}', 'Unexpected `NULL`; JSON writes true, false and null in lowercase.', [6, 10]],
    ['{"a": undefined}', '`undefined` is not a JSON value; use null or leave the key out.', [6, 15]],
    ['{"a": @}', "Expected a value, found '@'.", [6, 7]],
    ['{"a": 1}}', "Unexpected '}' after the end of the JSON value; the brackets are unbalanced.", [8, 9]],
    ['{"a": 1} {"b": 2}', 'Unexpected text after the end of the JSON value.', [9, 17]],
    ['', 'The source is empty; expected a JSON object.', [0, 0]],
    ['  // only a comment\n', 'The source is empty; expected a JSON object.', [20, 20]],
  ])('%j → %s', (source, message, range) => {
    const error = syntaxError(source);
    expect(error.message).toBe(message);
    expect(error.range).toEqual(range);
  });

  it('drops warnings when the parse fails, so the one error stands alone', () => {
    const result = parseFigureSource('{"a": .5, "a": 1, "b": }');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('json.syntax');
  });

  it('stops runaway nesting without overflowing the stack', () => {
    const error = syntaxError('['.repeat(100_000));
    expect(error.message).toBe('Nesting is deeper than 200 levels.');
    expect(error.range).toEqual([200, 201]);
    expect(ok(`${'['.repeat(199)}${']'.repeat(199)}`).value).toBeDefined();
  });

  it('reads a long source in linear time', () => {
    const nodes = Array.from({ length: 4000 }, (_, i) => `{"id": "n${i}", "label": "$\\beta_{${i}}$ node"}`);
    const source = `{"nodes": [${nodes.join(',\n')}]}`;
    const started = performance.now();
    const result = ok(source);
    expect(performance.now() - started).toBeLessThan(1000);
    expect((result.value as { nodes: unknown[] }).nodes).toHaveLength(4000);
  });
});

describe('parseFigureSource — diagnostics', () => {
  it('orders warnings before info, each by position, with line and column from lineColumn', () => {
    const source = '{\n  "b": "$\\alpha$",\n  "a": .5,\n  "a": 1\n}';
    const result = ok(source);
    expect(result.diagnostics.map((d) => [d.severity, d.code, d.line, d.column])).toEqual([
      ['warning', 'json.number-format', 3, 8],
      ['warning', 'json.duplicate-key', 4, 3],
      ['info', 'json.latex-escape', 2, 10],
    ]);
    for (const d of result.diagnostics) expect({ line: d.line, column: d.column }).toEqual(lineColumn(source, d.range![0]));
  });
});

describe('MathTracker', () => {
  /** Maths state after each character of `text`. */
  function states(text: string): string {
    const math = new MathTracker();
    return Array.from(text, (ch) => {
      math.push(ch.charCodeAt(0));
      return math.inMath ? 'm' : '.';
    }).join('');
  }

  it('follows inline, display and escaped dollars', () => {
    expect(states('a$b$c')).toBe('.mm..');
    expect(states('$$x$$y')).toBe('mmm...');
    expect(states('$a$$b$c')).toBe('mm.mm..');
    expect(states('\\$x')).toBe('...');
    expect(states('\\\\$x$')).toBe('..mm.');
    expect(states('$$x$')).toBe('mmm.');
  });
});

describe('lineColumn', () => {
  it('counts 1-based lines and UTF-16 columns', () => {
    const source = 'ab\ncd\r\nef\rgh😀i';
    expect(lineColumn(source, 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumn(source, 2)).toEqual({ line: 1, column: 3 });
    expect(lineColumn(source, 3)).toEqual({ line: 2, column: 1 });
    expect(lineColumn(source, 5)).toEqual({ line: 2, column: 3 });
    expect(lineColumn(source, 6)).toEqual({ line: 2, column: 4 });
    expect(lineColumn(source, 7)).toEqual({ line: 3, column: 1 });
    expect(lineColumn(source, 10)).toEqual({ line: 4, column: 1 });
    expect(lineColumn(source, 14)).toEqual({ line: 4, column: 5 });
  });

  it('clamps offsets to the text', () => {
    expect(lineColumn('ab\nc', -5)).toEqual({ line: 1, column: 1 });
    expect(lineColumn('ab\nc', 99)).toEqual({ line: 2, column: 2 });
    expect(lineColumn('ab\nc', Number.NaN)).toEqual({ line: 1, column: 1 });
    expect(lineColumn('', 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumn('a\n', 2)).toEqual({ line: 2, column: 1 });
  });

  it('answers correctly when alternating between sources', () => {
    const a = 'x\ny\nz';
    const b = 'xyz';
    expect(lineColumn(a, 4)).toEqual({ line: 3, column: 1 });
    expect(lineColumn(b, 2)).toEqual({ line: 1, column: 3 });
    expect(lineColumn(a, 2)).toEqual({ line: 2, column: 1 });
  });
});
