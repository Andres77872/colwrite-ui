/**
 * What a model needs to know to write a structured figure.
 *
 * Research on LLM-drawn diagrams is consistent: models describe structure
 * well and place things badly, so the spec is a coordinate-free semantic
 * graph and the client does all the placing. The rules below also steer
 * away from the failure modes that matter most in practice — LaTeX escaping
 * inside JSON strings, invented coordinates, and styling node by node
 * instead of by role. `docs/figures.md` is the full reference; the **figure**
 * bullet of the agent's system prompt in ColWrite-api
 * (`src/prompts/agent_system.md`) carries the same rules — keep them in step.
 */
const FENCE = '```';

export const FIGURE_SPEC_PROMPT = String.raw`STRUCTURED FIGURES — for architectures, mechanisms, pipelines, multi-panel figures and anything with maths labels, stacked heads, tensors or token rows. The task asks for a figure, so draw one even for a simple flow.
A figure is a fenced block ${FENCE}figure containing ONE JSON object. Never give coordinates or sizes: the editor lays the figure out and routes every arrow.
Top level: "caption" (sentence-case, may use $…$ maths; the editor prints "Figure N." before it, so never start it with "Figure 1:"), "label" ("fig:…"), "direction" (down|up|right|left; up for stacks like the Transformer, right only for short chains), "layout": "row" for side-by-side panels, "nodes", "edges", optional "legend" ([{"label", "tone"|"pattern"} or {"label", "line": "dashed"}]), "palette": "mono" for grayscale print, "font": "serif".
Nodes: {"id", "label", "role"} — pick the role, not colours: input, output, embedding, attention, ffn, norm, linear, activation, conv, pool, op, latent, cache, data, model, agent, tool, retriever, document, loss, router, expert, decision, process, start, end, param, note ("data" and "cache" draw as cylinders — a dataset, a store, a whole KV cache; a vector or activation, even a cached one, is "latent" or a tensor, hatched if cached). Optional: "sublabel" (e.g. a shape "$B\\times d$"), "shape" (box, round, circle, op, diamond, funnel = narrows along the flow, expand = widens, cylinder, document, parallelogram, hexagon, text, tensor, image — needs "src" as a data:image URL (remote URLs are not loaded), else use a labelled box), "tone" (gray blue orange yellow green red purple pink teal), "border": "dashed" for optional steps, "pattern": "hatch" for cached/frozen, "stack": 3 for multiple heads/experts with "repeat": "h", "badge": "cached", "bold".
Operator circles: {"id": "add1", "role": "op", "label": "+"} draws ⊕; "×" ⊗, "·" ⊙, "concat" ‖.
Tensors: {"shape": "tensor", "cells": [8, 8], "mask": "causal"}; "mask" is only full|causal|upper|diagonal, so any other pattern (sliding window, block-sparse) is a 0/1 "values" matrix, one list per row. "cells": ["[CLS]", "The", "cat"] is a token row; fractional "values" [[0.1, 0.9, …]] a heat map.
Groups: a node with "children" draws a titled box and arranges them: "layout": flow (default: layers follow the edges) | row | column | grid (+ "columns"); "direction"; "uniform": true for equal-width stacks; "repeat": "N×"; "panel": true for sub-figures (a), (b) — set panels side by side with a "row" parent, not "direction" (it orders flows only). Put the canonical block (e.g. a Transformer layer) in a group.
Layer hints inside a flow: "beside": "<sibling id>" for side inputs (positional encoding next to ⊕); "sameRank": "<sibling id>" puts a node on that sibling's layer (only the node carrying it moves); "rank": "first"|"last" pins its layer. A U shape (U-Net): give each decoder level "sameRank" naming its encoder level and make the decoder's upward edges "kind": "feedback".
Edges: strings "a -> b", "a, b -> c" (fan-in), "a -> b -> c" (chain), "a -> b: label", "a --> b" dashed, "a => b" thick, "a <-> b", "a -- b" no arrow, "a.right -> b.left" pinned sides; or objects {"from", "to", "label", "kind": "residual" (skip connection: routed around, enters from the side) | "feedback" (runs back against the flow; sets no layer), "line", "route": "curved"}.
JSON rules: valid JSON with double quotes. In LaTeX, double every backslash ("$\\mathbf{c}_t^{KV}$", "$W^{UK}$", "$\\sqrt{d_k}$"). Use \n for a line break inside a label. Ids: short, no spaces.
Good figures: one idea per figure; 5–25 nodes; labels ≤ 4 words (put detail in "sublabel" or the caption); consistent roles so the same kind of module looks the same across the paper; direction up for layer stacks; "right" fits ~6 boxes across a printed column, so a longer pipeline goes "down"/"up" or wraps into rows (groups with "direction": "right", "border": "none" in a "down" root), else it prints too small (print-size warning); a legend when a pattern or line style carries meaning; the caption says what to notice.
Example: {"caption": "Scaled dot-product attention.", "direction": "up", "nodes": [{"id": "q", "label": "Q", "role": "input"}, {"id": "k", "label": "K", "role": "input"}, {"id": "v", "label": "V", "role": "input"}, {"id": "mm1", "label": "MatMul", "role": "linear"}, {"id": "scale", "label": "Scale", "role": "norm"}, {"id": "mask", "label": "Mask (opt.)", "role": "attention", "border": "dashed"}, {"id": "sm", "label": "SoftMax", "role": "activation"}, {"id": "mm2", "label": "MatMul", "role": "linear"}], "edges": ["q, k -> mm1 -> scale -> mask -> sm -> mm2", "v -> mm2"]}`;

/**
 * The instruction for repairing a figure that does not compile: the
 * validator's own messages, which point at the offending path and suggest
 * the fix, are what makes a repair round converge.
 */
export function figureRepairInstruction(problems: readonly string[]): string {
  const list = problems.slice(0, 12).map((problem) => `- ${problem}`).join('\n');
  return `Fix these problems in the figure spec, changing nothing else:\n${list}`;
}
