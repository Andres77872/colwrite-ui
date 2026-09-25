import { describe, expect, it } from 'vitest';
import { findItemNode, formatFigureSource, setItemProperty } from '../edit';
import { normalizeFigure } from '../normalize';
import { parseFigureSource } from '../parse';
import type { JsonNode, JsonValue } from '../types';

const FENCE = '```';
/** A JSON `\u` escape, spelled out so no tool decodes it first. */
const U = '\\u';

function ast(source: string): JsonNode {
  const result = parseFigureSource(source);
  expect(result.ast).not.toBeNull();
  return result.ast!;
}

/** The new source parses cleanly (nothing worse than info) and is returned for further checks. */
function clean(source: string | null): string {
  expect(source).not.toBeNull();
  const result = parseFigureSource(source!);
  expect(result.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  return source!;
}

function valueOf(source: string): JsonValue {
  return parseFigureSource(source).value;
}

const FIGURE = `{
  // Scaled dot-product attention
  "direction": "up",
  "nodes": [
    "Q",
    { "id": "enc", "label": "Encoder", "children": ["K", { "id": "attn", "role": "attention" }, { "id": 7 }] },
    {
      "id": "softmax", // the normaliser
      "label": "SoftMax",
      "role": "activation"
    },
    { "id": "q2", "label": "Q copy" }
  ],
  "groups": [{ "id": "side", "children": ["Q", "V"] }],
  "edges": ["Q -> softmax", "a -> b"]
}`;

describe('findItemNode', () => {
  const tree = ast(FIGURE);

  it.each([
    ['Q', 'nodes[0]', '"Q"'],
    ['enc', 'nodes[1]', null],
    ['K', 'nodes[1].children[0]', '"K"'],
    ['attn', 'nodes[1].children[1]', '{ "id": "attn", "role": "attention" }'],
    ['7', 'nodes[1].children[2]', '{ "id": 7 }'],
    ['softmax', 'nodes[2]', null],
    ['side', 'groups[0]', null],
    ['V', 'groups[0].children[1]', '"V"'],
  ])('finds %s at %s', (id, path, text) => {
    const found = findItemNode(tree, id);
    expect(found?.path).toBe(path);
    if (text !== null) expect(FIGURE.slice(found!.node.start, found!.node.end)).toBe(text);
  });

  it('returns the whole object that defines the item', () => {
    const found = findItemNode(tree, 'softmax')!;
    expect(found.node.kind).toBe('object');
    expect(FIGURE.slice(found.node.start, found.node.end)).toMatch(/^\{\n\s+"id": "softmax".*"activation"\n\s+\}$/s);
  });

  it('does not find edges, labels or unknown ids', () => {
    expect(findItemNode(tree, 'Q -> softmax')).toBeNull();
    expect(findItemNode(tree, 'Q copy')).toBeNull();
    expect(findItemNode(tree, 'nope')).toBeNull();
    expect(findItemNode(tree, 'q')).toBeNull();
  });

  it('prefers an object definition over an earlier string reference', () => {
    const source = '{"groups": [{"id": "g", "children": ["x"]}], "nodes": [{"id": "x", "tone": "red"}]}';
    const found = findItemNode(ast(source), 'x');
    expect(found?.path).toBe('nodes[0]');
    expect(found?.node.kind).toBe('object');
  });

  it('takes the first object when two declare the same id, and the first string otherwise', () => {
    const tree2 = ast('{"nodes": ["s", {"id": "a", "n": 1}, {"id": "a", "n": 2}, {"children": ["s"]}]}');
    expect(findItemNode(tree2, 'a')?.path).toBe('nodes[1]');
    expect(findItemNode(tree2, 's')?.path).toBe('nodes[0]');
  });

  it('searches the top-level lists in source order and uses the winning duplicate list', () => {
    const source = '{"groups": [{"id": "a"}], "nodes": [{"id": "a"}], "nodes": [{"id": "b"}]}';
    expect(findItemNode(ast(source), 'a')?.path).toBe('groups[0]');
    expect(findItemNode(ast(source), 'b')?.path).toBe('nodes[0]');
  });

  it('uses the last `id` of an object that repeats it', () => {
    const tree2 = ast('{"nodes": [{"id": "old", "id": "new"}]}');
    expect(findItemNode(tree2, 'new')?.path).toBe('nodes[0]');
    expect(findItemNode(tree2, 'old')).toBeNull();
  });

  it('reads a bare top-level array as the node list', () => {
    const tree2 = ast('["a", {"id": "b", "children": ["c"]}]');
    expect(findItemNode(tree2, 'a')?.path).toBe('[0]');
    expect(findItemNode(tree2, 'c')?.path).toBe('[1].children[0]');
  });

  it('finds nothing in a scalar root', () => {
    expect(findItemNode(ast('"a"'), 'a')).toBeNull();
  });

  it('finds items the way normalisation defines them', () => {
    const cases: Array<[source: string, id: string, path: string, text: string]> = [
      // Ids derived from the label.
      ['{"nodes":[{"label":"Encoder"},{"label":"Decoder"}],"edges":["Encoder -> Decoder"]}', 'decoder', 'nodes[1]', '{"label":"Decoder"}'],
      // A group's children under `nodes`.
      ['{"nodes":[{"id":"g","nodes":[{"id":"x"},{"id":"y"}]}]}', 'y', 'nodes[0].nodes[1]', '{"id":"y"}'],
      // Map-form lists, object and shorthand values.
      ['{"nodes":{"a":{"label":"A"},"b":"B"}}', 'a', 'nodes.a', '{"label":"A"}'],
      ['{"nodes":{"a":{"label":"A"},"b":"B"}}', 'b', 'nodes.b', '"B"'],
      // Other spellings of the keys.
      ['{"Nodes":[{"ID":"a"},"b"]}', 'a', 'Nodes[0]', '{"ID":"a"}'],
      // A trimmed shorthand.
      ['{"nodes":[" a ","b"]}', 'a', 'nodes[0]', '" a "'],
      // A list written as its one item.
      ['{"nodes": {"id": "a"}}', 'a', 'nodes', '{"id": "a"}'],
      ['{"nodes": [{"id": "g", "children": "a"}]}', 'a', 'nodes[0].children', '"a"'],
      // The renamed duplicate.
      ['{"nodes":[{"id":"a","n":1},{"id":"a","n":2}]}', 'a-2', 'nodes[1]', '{"id":"a","n":2}'],
    ];
    for (const [source, id, path, text] of cases) {
      const found = findItemNode(ast(source), id);
      expect(found?.path, `${id} in ${source}`).toBe(path);
      expect(source.slice(found!.node.start, found!.node.end)).toBe(text);
    }
  });
});

describe('setItemProperty — items as normalisation defines them', () => {
  const tones = (source: string) => {
    const items = normalizeFigure(parseFigureSource(source), source).model!.items;
    return Object.fromEntries([...items].map(([id, item]) => [id, item.tone]));
  };

  it('edits an item whose id is derived from its label', () => {
    const source = '{"nodes":[{"label":"Encoder"},{"label":"Decoder"}],"edges":["Encoder -> Decoder"]}';
    const next = clean(setItemProperty(source, 'encoder', 'tone', 'red'));
    expect(next).toBe('{"nodes":[{"label":"Encoder", "tone":"red"},{"label":"Decoder"}],"edges":["Encoder -> Decoder"]}');
    expect(tones(next)).toEqual({ encoder: 'red', decoder: 'neutral' });
  });

  it('keeps a label-derived id when the label changes, so edges and the selection still find the item', () => {
    const source = '{"nodes":[{"label":"Encoder"},{"label":"Decoder"}],"edges":["Encoder -> Decoder"]}';
    const next = clean(setItemProperty(source, 'encoder', 'label', 'Encoder stack'));
    expect(next).toBe('{"nodes":[{"label":"Encoder stack", "id":"encoder"},{"label":"Decoder"}],"edges":["Encoder -> Decoder"]}');
    const { model, diagnostics } = normalizeFigure(parseFigureSource(next), next);
    expect([...model!.items.keys()]).toEqual(['encoder', 'decoder']);
    expect(model!.edges.map((edge) => [edge.from, edge.to])).toEqual([['encoder', 'decoder']]);
    expect(diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('keeps the id of the item edited when a namesake would take it over', () => {
    const source = '{"nodes":[{"label":"Encoder"},{"label":"Encoder"}]}';
    const next = clean(setItemProperty(source, 'encoder', 'label', 'X'));
    expect(next).toBe('{"nodes":[{"label":"X", "id":"encoder"},{"label":"Encoder"}]}');
    expect([...normalizeFigure(parseFigureSource(next), next).model!.items.keys()]).toEqual(['encoder', 'encoder-2']);
  });

  it('edits a group child written under `nodes`', () => {
    const source = '{"nodes":[{"id":"g","nodes":[{"id":"x"},{"id":"y"}]}]}';
    expect(clean(setItemProperty(source, 'x', 'tone', 'red'))).toBe('{"nodes":[{"id":"g","nodes":[{"id":"x", "tone":"red"},{"id":"y"}]}]}');
  });

  it('edits map-form lists, expanding a shorthand value under its key’s id', () => {
    const source = '{"nodes":{"a":{"label":"A"},"b":"B"}}';
    const a = clean(setItemProperty(source, 'a', 'tone', 'red'));
    expect(a).toBe('{"nodes":{"a":{"label":"A", "tone":"red"},"b":"B"}}');
    const b = clean(setItemProperty(source, 'b', 'tone', 'blue'));
    expect(b).toBe('{"nodes":{"a":{"label":"A"},"b":{ "id": "b", "label": "B", "tone": "blue" }}}');
    const item = normalizeFigure(parseFigureSource(b), b).model!.items.get('b');
    expect(item).toMatchObject({ id: 'b', tone: 'blue', label: { source: 'B' } });
  });

  it('expands a padded shorthand to the id normalisation trimmed it to', () => {
    expect(clean(setItemProperty('{"nodes":[" a ","b"]}', 'a', 'tone', 'red'))).toBe(
      '{"nodes":[{ "id": "a", "label": "a", "tone": "red" },"b"]}',
    );
    expect(clean(setItemProperty('{"nodes":[1,2]}', '1', 'tone', 'red'))).toBe('{"nodes":[{ "id": "1", "label": "1", "tone": "red" },2]}');
  });

  it('sets and deletes a key in whatever spelling the item writes it', () => {
    const source = '{"Nodes":[{"ID":"a","Tone":"red"},"b"]}';
    expect(clean(setItemProperty(source, 'a', 'tone', 'blue'))).toBe('{"Nodes":[{"ID":"a","Tone":"blue"},"b"]}');
    expect(clean(setItemProperty(source, 'a', 'tone', undefined))).toBe('{"Nodes":[{"ID":"a"},"b"]}');
    const spelled = '{"nodes":[{"id":"a","font-size":1,"font_size":2}]}';
    expect(setItemProperty(spelled, 'a', 'fontSize', 3)).toBe('{"nodes":[{"id":"a","font-size":1,"font_size":3}]}');
    expect(setItemProperty(spelled, 'a', 'font size', undefined)).toBe('{"nodes":[{"id":"a"}]}');
  });
});

describe('setItemProperty — setting', () => {
  it('replaces a value in place, keeping comments and formatting', () => {
    const next = clean(setItemProperty(FIGURE, 'softmax', 'label', 'Softmax'));
    expect(next).toBe(FIGURE.replace('"label": "SoftMax"', '"label": "Softmax"'));
  });

  it('appends to a multi-line object at its indentation, adding the comma', () => {
    const source = '{\n  "nodes": [\n    {\n      "id": "a",\n      "label": "A"\n    }\n  ]\n}';
    expect(setItemProperty(source, 'a', 'tone', 'blue')).toBe(
      '{\n  "nodes": [\n    {\n      "id": "a",\n      "label": "A",\n      "tone": "blue"\n    }\n  ]\n}',
    );
  });

  it('keeps a same-line comment with the member it annotates', () => {
    const next = clean(setItemProperty(FIGURE, 'softmax', 'tone', 'green'));
    expect(next).toContain('      "role": "activation",\n      "tone": "green"\n    },');
    const source = '{"nodes": [{\n  "id": "a" // the input\n}]}';
    expect(setItemProperty(source, 'a', 'tone', 'red')).toBe('{"nodes": [{\n  "id": "a", // the input\n  "tone": "red"\n}]}');
  });

  it('keeps an object’s trailing-comma style', () => {
    const source = '{"nodes": [\n  {\n    "id": "a",\n    "label": "A", // note\n  },\n]}';
    expect(clean(setItemProperty(source, 'a', 'tone', 'red'))).toBe(
      '{"nodes": [\n  {\n    "id": "a",\n    "label": "A", // note\n    "tone": "red",\n  },\n]}',
    );
  });

  it('keeps single-line objects on one line', () => {
    const source = '{"nodes": [{ "id": "a", "label": "A" }, {"id":"b"}]}';
    const next = clean(setItemProperty(source, 'a', 'tone', 'blue'));
    expect(next).toBe('{"nodes": [{ "id": "a", "label": "A", "tone": "blue" }, {"id":"b"}]}');
    expect(setItemProperty(next, 'b', 'cells', [8, 8])).toBe(
      '{"nodes": [{ "id": "a", "label": "A", "tone": "blue" }, {"id":"b", "cells":[8, 8]}]}',
    );
    expect(setItemProperty(source, 'a', 'label', { text: 'x', list: [1, 2] })).toBe(
      '{"nodes": [{ "id": "a", "label": { "text": "x", "list": [1, 2] } }, {"id":"b"}]}',
    );
  });

  it('adds after a trailing comma on a single-line object', () => {
    expect(clean(setItemProperty('{"nodes": [{ "id": "a", }]}', 'a', 'bold', true))).toBe(
      '{"nodes": [{ "id": "a", "bold": true, }]}',
    );
  });

  it('follows bare keys and the colon spacing the object already uses', () => {
    const source = "{nodes: [{ id: 'a', label : 'A' }]}";
    expect(clean(setItemProperty(source, 'a', 'tone', 'red'))).toBe(
      "{nodes: [{ id: 'a', label : 'A', tone: \"red\" }]}",
    );
    expect(clean(setItemProperty(source, 'a', 'font size', 1))).toBe(
      "{nodes: [{ id: 'a', label : 'A', \"font size\": 1 }]}",
    );
  });

  it('follows tab indentation', () => {
    const source = '{\n\t"nodes": [\n\t\t{\n\t\t\t"id": "a"\n\t\t}\n\t]\n}';
    expect(setItemProperty(source, 'a', 'tone', 'red')).toBe(
      '{\n\t"nodes": [\n\t\t{\n\t\t\t"id": "a",\n\t\t\t"tone": "red"\n\t\t}\n\t]\n}',
    );
  });

  it('breaks a long value over lines at the member’s indentation', () => {
    const source = '{\n  "nodes": [\n    {\n      "id": "t"\n    }\n  ]\n}';
    const rows = Array.from({ length: 3 }, (_, r) => Array.from({ length: 8 }, (_, c) => (r * 8 + c) / 32));
    const next = clean(setItemProperty(source, 't', 'values', rows));
    expect(next).toBe(
      [
        '{',
        '  "nodes": [',
        '    {',
        '      "id": "t",',
        '      "values": [',
        '        [0, 0.03125, 0.0625, 0.09375, 0.125, 0.15625, 0.1875, 0.21875],',
        '        [0.25, 0.28125, 0.3125, 0.34375, 0.375, 0.40625, 0.4375, 0.46875],',
        '        [0.5, 0.53125, 0.5625, 0.59375, 0.625, 0.65625, 0.6875, 0.71875]',
        '      ]',
        '    }',
        '  ]',
        '}',
      ].join('\n'),
    );
    expect((valueOf(next) as { nodes: [{ values: number[][] }] }).nodes[0].values).toEqual(rows);
  });

  it('fills an empty object', () => {
    expect(setItemProperty('{"nodes": [{}]}', '', 'id', 'x')).toBeNull();
    expect(clean(setItemProperty('{"nodes": [{"id": "a", "style": {}}]}', 'a', 'style', {}))).toBe(
      '{"nodes": [{"id": "a", "style": {}}]}',
    );
    const source = '{"groups": [{"id": "g", "children": [{"id": "a"}]}]}';
    const deleted = setItemProperty(source, 'a', 'id', undefined);
    expect(deleted).toBe('{"groups": [{"id": "g", "children": [{}]}]}');
  });

  it('replaces the effective duplicate, leaving the overridden one alone', () => {
    const source = '{"nodes": [{"id": "a", "tone": "red", "tone": "blue"}]}';
    const next = setItemProperty(source, 'a', 'tone', 'green')!;
    expect(next).toBe('{"nodes": [{"id": "a", "tone": "red", "tone": "green"}]}');
    expect(valueOf(next)).toEqual({ nodes: [{ id: 'a', tone: 'green' }] });
  });

  it('writes every JSON value type', () => {
    const source = '{"nodes": [{"id": "a"}]}';
    const values: JsonValue[] = [0, -1.5, 1e-7, true, false, null, '', 'x', [], ['a', 'b'], { k: [1, { z: null }] }];
    for (const value of values) {
      const next = clean(setItemProperty(source, 'a', 'v', value));
      expect((valueOf(next) as { nodes: [{ v: JsonValue }] }).nodes[0].v).toEqual(value);
    }
  });

  it('can rename an item by setting its id', () => {
    const next = clean(setItemProperty(FIGURE, 'attn', 'id', 'mha'));
    expect(findItemNode(ast(next), 'mha')?.path).toBe('nodes[1].children[1]');
    expect(findItemNode(ast(next), 'attn')).toBeNull();
  });

  it('replaces an object value whole, comments inside it included, and nothing else', () => {
    const source = '{"nodes": [{"id": "a", "s": {\n  // old\n}}], "legend": [{ /* keep */ }]}';
    expect(clean(setItemProperty(source, 'a', 's', { k: 1 }))).toBe(
      '{"nodes": [{"id": "a", "s": { "k": 1 }}], "legend": [{ /* keep */ }]}',
    );
  });

  it('uses the source’s CRLF line breaks for new lines and removes CRLF lines whole', () => {
    const source = '{\r\n  "nodes": [\r\n    {\r\n      "id": "a",\r\n      "tone": "red"\r\n    }\r\n  ]\r\n}';
    const added = clean(setItemProperty(source, 'a', 'bold', true));
    expect(added).toBe(source.replace('"tone": "red"', '"tone": "red",\r\n      "bold": true'));
    expect(added.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(clean(setItemProperty(source, 'a', 'tone', undefined))).toBe(
      '{\r\n  "nodes": [\r\n    {\r\n      "id": "a"\r\n    }\r\n  ]\r\n}',
    );
  });

  it('prints undefined members as JSON.stringify does', () => {
    const next = clean(
      setItemProperty('{"nodes": [{"id": "a"}]}', 'a', 'v', { gone: undefined, kept: [undefined, 1] } as unknown as JsonValue),
    );
    expect(next).toBe('{"nodes": [{"id": "a", "v": { "kept": [null, 1] }}]}');
  });

  it('edits inside a Markdown fence and keeps the fence', () => {
    const source = `${FENCE}json\n{"nodes": [{"id": "a"}]}\n${FENCE}`;
    expect(setItemProperty(source, 'a', 'tone', 'red')).toBe(`${FENCE}json\n{"nodes": [{"id": "a", "tone": "red"}]}\n${FENCE}`);
  });
});

describe('setItemProperty — LaTeX round trips', () => {
  const source = '{"nodes": [{"id": "q"}]}';
  it.each([
    ['backslash commands', '$\\beta \\times \\frac{a}{b} \\nabla \\rho \\theta \\text{x} \\top$'],
    ['escaped dollar', '\\$5 and $\\alpha$'],
    ['quotes and slashes', 'say "hi" / \\ '],
    ['line break', 'Multi-Head\nAttention'],
    ['unicode', 'x ⊕ y — é 😀'],
    ['tab before a letter inside maths', '$a\tb$ and \tc'],
    ['every short control inside maths', '$\b1\bx\f2\fx\n3\nx\r4\rx\t5\tx$'],
  ])('writes %s so the reader gets it back exactly', (_name, label) => {
    const next = clean(setItemProperty(source, 'q', 'label', label));
    expect((valueOf(next) as { nodes: [{ label: string }] }).nodes[0].label).toBe(label);
  });

  it('writes LaTeX with doubled backslashes, as strict JSON', () => {
    const next = setItemProperty(source, 'q', 'label', '$\\mathbf{h}_t$')!;
    expect(next).toBe('{"nodes": [{"id": "q", "label": "$\\\\mathbf{h}_t$"}]}');
    expect(JSON.parse(next)).toEqual({ nodes: [{ id: 'q', label: '$\\mathbf{h}_t$' }] });
  });

  it('round-trips control characters inside display maths', () => {
    const next = clean(setItemProperty(source, 'q', 'label', '$$a\tb$$ c\td'));
    expect(next).toBe(`{"nodes": [{"id": "q", "label": "$$a${U}0009b$$ c\\td"}]}`);
    expect((valueOf(next) as { nodes: [{ label: string }] }).nodes[0].label).toBe('$$a\tb$$ c\td');
  });

  it('matches JSON.stringify except where the reader would read LaTeX', () => {
    const next = setItemProperty(source, 'q', 'label', 'a\tb $c\td$')!;
    expect(next).toBe(`{"nodes": [{"id": "q", "label": "a\\tb $c${U}0009d$"}]}`);
  });
});

describe('setItemProperty — shorthand items', () => {
  it('expands a top-level shorthand string before setting', () => {
    const next = clean(setItemProperty(FIGURE, 'Q', 'tone', 'blue'));
    expect(next).toContain('    { "id": "Q", "label": "Q", "tone": "blue" },\n    { "id": "enc"');
    // The group's reference to Q is a reference, not a definition: untouched.
    expect(next).toContain('"children": ["Q", "V"]');
  });

  it('expands a shorthand child inside a group', () => {
    const next = clean(setItemProperty(FIGURE, 'V', 'role', 'input'));
    expect(next).toContain('"children": ["Q", { "id": "V", "label": "V", "role": "input" }]');
    const nested = clean(setItemProperty(FIGURE, 'K', 'shape', 'circle'));
    expect(nested).toContain('"children": [{ "id": "K", "label": "K", "shape": "circle" }, { "id": "attn"');
  });

  it('sets the label or id of a shorthand in place of the defaults', () => {
    const source = '{"nodes": ["Q"]}';
    expect(setItemProperty(source, 'Q', 'label', '$Q$')).toBe('{"nodes": [{ "id": "Q", "label": "$Q$" }]}');
    expect(setItemProperty(source, 'Q', 'id', 'query')).toBe('{"nodes": [{ "id": "query", "label": "Q" }]}');
  });

  it('deletes from a shorthand only what it implies', () => {
    const source = '{"nodes": ["Q"]}';
    expect(setItemProperty(source, 'Q', 'tone', undefined)).toBe(source);
    expect(setItemProperty(source, 'Q', 'label', undefined)).toBe('{"nodes": [{ "id": "Q" }]}');
  });

  it('encodes a shorthand whose text needs escaping', () => {
    const source = '{"nodes": ["$\\\\alpha$ \\"x\\""]}';
    const next = clean(setItemProperty(source, '$\\alpha$ "x"', 'tone', 'red'));
    expect(next).toBe('{"nodes": [{ "id": "$\\\\alpha$ \\"x\\"", "label": "$\\\\alpha$ \\"x\\"", "tone": "red" }]}');
  });
});

describe('setItemProperty — deleting', () => {
  const multi = '{\n  "nodes": [\n    {\n      "id": "a",\n      "label": "A", // the label\n      "tone": "red"\n    }\n  ]\n}';

  it('removes a middle member with its line and comment', () => {
    expect(clean(setItemProperty(multi, 'a', 'label', undefined))).toBe(
      '{\n  "nodes": [\n    {\n      "id": "a",\n      "tone": "red"\n    }\n  ]\n}',
    );
  });

  it('removes the first member with its line', () => {
    expect(clean(setItemProperty(multi.replace('"id": "a"', '"tone": "blue",\n      "id": "a"'), 'a', 'tone', undefined))).toBe(
      '{\n  "nodes": [\n    {\n      "id": "a",\n      "label": "A" // the label\n    }\n  ]\n}',
    );
  });

  it('removes the last member and the comma before it', () => {
    expect(clean(setItemProperty(multi, 'a', 'tone', undefined))).toBe(
      '{\n  "nodes": [\n    {\n      "id": "a",\n      "label": "A" // the label\n    }\n  ]\n}',
    );
  });

  it('removes a multi-line value entirely', () => {
    const source = '{\n  "nodes": [\n    {\n      "id": "t",\n      "cells": [\n        8,\n        8\n      ],\n      "tone": "red"\n    }\n  ]\n}';
    expect(clean(setItemProperty(source, 't', 'cells', undefined))).toBe(
      '{\n  "nodes": [\n    {\n      "id": "t",\n      "tone": "red"\n    }\n  ]\n}',
    );
  });

  it.each([
    ['middle', '{"nodes": [{ "id": "a", "tone": "red", "bold": true }]}', 'tone', '{"nodes": [{ "id": "a", "bold": true }]}'],
    ['first', '{"nodes": [{ "tone": "red", "id": "a" }]}', 'tone', '{"nodes": [{ "id": "a" }]}'],
    ['last', '{"nodes": [{ "id": "a", "tone": "red" }]}', 'tone', '{"nodes": [{ "id": "a" }]}'],
    ['last, trailing comma', '{"nodes": [{ "id": "a", "tone": "red", }]}', 'tone', '{"nodes": [{ "id": "a", }]}'],
    ['compact', '{"nodes":[{"id":"a","tone":"red"}]}', 'tone', '{"nodes":[{"id":"a"}]}'],
  ])('removes the %s member of a single-line object', (_name, source, key, expected) => {
    expect(clean(setItemProperty(source, 'a', key, undefined))).toBe(expected);
  });

  it('collapses an object whose only member goes', () => {
    expect(setItemProperty('{"nodes": [{ "id": "a" }]}', 'a', 'id', undefined)).toBe('{"nodes": [{}]}');
    expect(setItemProperty('{"nodes": [{\n  "id": "a"\n}]}', 'a', 'id', undefined)).toBe('{"nodes": [{}]}');
  });

  it('keeps comments when the only member goes', () => {
    const next = clean(setItemProperty('{"nodes": [{\n  // keep me\n  "id": "a"\n}]}', 'a', 'id', undefined));
    expect(next).toBe('{"nodes": [{\n  // keep me\n}]}');
  });

  it('removes every duplicate so no overridden value resurfaces', () => {
    const source = '{\n  "nodes": [\n    {\n      "tone": "red",\n      "id": "a",\n      "tone": "blue"\n    }\n  ]\n}';
    const next = clean(setItemProperty(source, 'a', 'tone', undefined));
    expect(next).toBe('{\n  "nodes": [\n    {\n      "id": "a"\n    }\n  ]\n}');
  });

  it('returns the source unchanged when the key is absent', () => {
    expect(setItemProperty(FIGURE, 'softmax', 'shape', undefined)).toBe(FIGURE);
  });

  it('deletes after a recovered missing comma without breaking the object', () => {
    const source = '{"nodes": [{\n  "id": "a"\n  "tone": "red"\n}]}';
    expect(clean(setItemProperty(source, 'a', 'id', undefined))).toBe('{"nodes": [{\n  "tone": "red"\n}]}');
  });

  it('applies the inspector’s sequence of edits', () => {
    let next = FIGURE;
    for (const [key, value] of [
      ['role', 'norm'],
      ['shape', undefined],
      ['tone', undefined],
      ['label', 'Layer Norm'],
    ] as const) {
      next = setItemProperty(next, 'softmax', key, value) ?? next;
    }
    clean(next);
    expect((valueOf(next) as { nodes: JsonValue[] }).nodes[2]).toEqual({ id: 'softmax', label: 'Layer Norm', role: 'norm' });
    expect(next).toContain('"id": "softmax", // the normaliser');
    expect(next).toContain('// Scaled dot-product attention');
  });
});

describe('setItemProperty — failure', () => {
  it('returns null for an unknown item or an unreadable source', () => {
    expect(setItemProperty(FIGURE, 'missing', 'tone', 'red')).toBeNull();
    expect(setItemProperty('{"nodes": [', 'a', 'tone', 'red')).toBeNull();
    expect(setItemProperty('', 'a', 'tone', 'red')).toBeNull();
  });
});

describe('setItemProperty — round trip over every item', () => {
  it('changes exactly the one property and nothing else in the value', () => {
    const before = valueOf(FIGURE) as { nodes: JsonValue[] };
    for (const id of ['Q', 'enc', 'softmax', 'q2', 'side', 'attn', 'K', 'V', '7']) {
      for (const [key, value] of [
        ['tone', 'teal'],
        ['label', '$\\hat{y}$'],
        ['stack', 3],
      ] as const) {
        const next = clean(setItemProperty(FIGURE, id, key, value));
        const found = findItemNode(ast(next), id);
        expect(found).not.toBeNull();
        const item = parseFigureSource(next.slice(found!.node.start, found!.node.end)).value as Record<string, JsonValue>;
        expect(item[key]).toEqual(value);
        // Everything outside the item's text is byte-identical.
        const original = findItemNode(ast(FIGURE), id)!;
        expect(next.slice(0, found!.node.start)).toBe(FIGURE.slice(0, original.node.start));
        expect(next.slice(found!.node.end)).toBe(FIGURE.slice(original.node.end));
      }
    }
    expect(valueOf(FIGURE)).toEqual(before);
  });
});

describe('formatFigureSource', () => {
  it('returns null when the source does not parse', () => {
    expect(formatFigureSource('{"a": }')).toBeNull();
    expect(formatFigureSource('')).toBeNull();
  });

  it('prints strict, compact 2-space JSON in written key order', () => {
    const source = `{nodes: [{id: 'q', label: '$\\beta$', cells: [8,8]}, 'k', {id: 'g', children: ['a', {id: 'b'}]}],
      caption: 'A figure', edges: ['q -> k',], size: .5, }`;
    expect(formatFigureSource(source)).toBe(
      [
        '{',
        '  "nodes": [',
        '    { "id": "q", "label": "$\\\\beta$", "cells": [8, 8] },',
        '    "k",',
        '    {',
        '      "id": "g",',
        '      "children": [',
        '        "a",',
        '        { "id": "b" }',
        '      ]',
        '    }',
        '  ],',
        '  "caption": "A figure",',
        '  "edges": ["q -> k"],',
        '  "size": 0.5',
        '}',
      ].join('\n'),
    );
  });

  it('produces JSON that JSON.parse reads to the same value', () => {
    const sources = [
      FIGURE.replace(/\/\/.*$/gm, ''),
      String.raw`{'label': "$\times \frac{1}{2} \alpha$", "n": +1, "t": "a\tb", "u": "${U}0041"}`,
      `${FENCE}json\n{"nodes": ["a", "b"], "edges": ["a -> b"]}\n${FENCE}`,
      '[1, [2, [3, [4]]], {"a": {"b": {"c": []}}}]',
      '"just a string"',
    ];
    for (const source of sources) {
      const formatted = formatFigureSource(source)!;
      expect(JSON.parse(formatted)).toEqual(valueOf(source));
    }
  });

  it('keeps comments beside what they annotate', () => {
    const source = `// Figure 1
/* the spec */ {
  // direction first
  "direction": "up", // bottom to top
  "nodes": [
    "a", // first
    /* second */ "b"
    // nothing after
  ],
  "legend": [ /* empty */ ]
} // end`;
    const expected = `// Figure 1
/* the spec */
{
  // direction first
  "direction": "up", // bottom to top
  "nodes": [
    "a", // first
    /* second */
    "b"
    // nothing after
  ],
  "legend": [
    /* empty */
  ]
} // end`;
    expect(formatFigureSource(source)).toBe(expected);
    expect(formatFigureSource(expected)).toBe(expected);
  });

  it('moves a comment between a key and its value in front of the member', () => {
    expect(formatFigureSource('{"a" /* why */ : 1}')).toBe('{\n  /* why */\n  "a": 1\n}');
  });

  it('keeps only the winning duplicate, where it stands, with the loser’s comments', () => {
    expect(formatFigureSource('{\n  "a": 1, // one\n  "b": 2,\n  "a": 3\n}')).toBe('{\n  "b": 2,\n  // one\n  "a": 3\n}');
  });

  it('breaks long arrays and keeps matrix rows on one line each', () => {
    const labels = Array.from({ length: 12 }, (_, i) => `token-${i}`);
    const formatted = formatFigureSource(JSON.stringify({ nodes: [{ id: 't', cells: labels, values: [[0.1, 0.2], [0.3, 0.4]] }] }))!;
    expect(formatted).toBe(
      [
        '{',
        '  "nodes": [',
        '    {',
        '      "id": "t",',
        '      "cells": [',
        ...labels.map((l, i) => `        "${l}"${i < labels.length - 1 ? ',' : ''}`),
        '      ],',
        '      "values": [[0.1, 0.2], [0.3, 0.4]]',
        '    }',
        '  ]',
        '}',
      ].join('\n'),
    );
  });

  it('keeps number spellings that are already strict', () => {
    expect(formatFigureSource('{"a": 1.50, "b": 1E3, "c": -0, "d": 5., "e": 01}')).toBe(
      '{\n  "a": 1.50,\n  "b": 1E3,\n  "c": -0,\n  "d": 5,\n  "e": 1\n}',
    );
  });

  it('prints empty containers and scalars as themselves', () => {
    expect(formatFigureSource('{}')).toBe('{}');
    expect(formatFigureSource(' [ ] ')).toBe('[]');
    expect(formatFigureSource('{"a": {}, "b": []}')).toBe('{\n  "a": {},\n  "b": []\n}');
    expect(formatFigureSource('true')).toBe('true');
  });

  it('drops the fence and the BOM', () => {
    expect(formatFigureSource(`\u{FEFF}${FENCE}figure\n{"a":1}\n${FENCE}\n`)).toBe('{\n  "a": 1\n}');
  });

  it('writes maths control characters so they survive the reader', () => {
    const source = `{"label": "$a${U}0009b$"}`;
    expect((valueOf(source) as { label: string }).label).toBe('$a\tb$');
    const formatted = formatFigureSource(source)!;
    expect(formatted).toBe(`{\n  "label": "$a${U}0009b$"\n}`);
    expect(valueOf(formatted)).toEqual(valueOf(source));
  });

  it('is idempotent and never changes the value', () => {
    const sources = [
      FIGURE,
      `{nodes: ['a' // x\n , 'b'], /* tail */ edges: ["a -> b"],}`,
      '{"legend": [{"label": "Cached during inference", "tone": "teal", "pattern": "hatch"}, {"label": "Applied only at training time", "line": "dashed"}]}',
      '{"nodes": [{"id": "x", "children": [{"id": "y", "children": [{"id": "z", "children": ["w"]}]}]}]}',
    ];
    for (const source of sources) {
      const once = formatFigureSource(source)!;
      expect(formatFigureSource(once)).toBe(once);
      expect(valueOf(once)).toEqual(valueOf(source));
      expect(parseFigureSource(once).diagnostics).toEqual([]);
    }
  });
});
