/**
 * Starter figures for the editor's Templates menu.
 *
 * Each template redraws a figure readers already know, from the paper that
 * made it canonical, so an author starts from something that looks right and
 * only has to rename things. They double as worked examples of the spec: the
 * assistant and authors learn the idioms here — roles instead of colours,
 * `uniform` stacks, `beside` for side inputs, `kind: "residual"` for skip
 * connections, hatching plus a legend for what is cached.
 *
 * Sources are strict JSON (pretty, 2-space) written as raw strings, so what
 * is typed here is exactly what lands in the code block: LaTeX backslashes
 * are doubled as JSON requires, and `\n` in a label is JSON's line break.
 * Every template must compile without a single warning; the tests hold them
 * to that.
 */

export type FigureTemplate = {
  /** Stable key, kebab-case. */
  id: string;
  /** Menu entry. */
  label: string;
  /** One line under the menu entry: what the figure shows. */
  description: string;
  category: 'architecture' | 'mechanism' | 'pipeline' | 'layout';
  /** The spec, ready to become a `figure` code block's text. */
  source: string;
};

// Vaswani et al. (2017), Figure 2 (left).
const SDPA = String.raw`{
  "caption": "Scaled dot-product attention: $\\mathrm{Attention}(Q, K, V) = \\mathrm{softmax}\\left(\\frac{QK^{\\top}}{\\sqrt{d_k}}\\right)V$. The mask (dashed) is optional; a decoder uses it to hide later positions.",
  "label": "fig:sdpa",
  "direction": "up",
  "uniform": true,
  "nodes": [
    { "id": "q", "label": "Q", "role": "input" },
    { "id": "k", "label": "K", "role": "input" },
    { "id": "v", "label": "V", "role": "input" },
    { "id": "matmul1", "label": "MatMul", "tone": "purple" },
    { "id": "scale", "label": "Scale", "tone": "yellow" },
    { "id": "mask", "label": "Mask (opt.)", "tone": "pink", "border": "dashed" },
    { "id": "softmax", "label": "SoftMax", "role": "activation" },
    { "id": "matmul2", "label": "MatMul", "tone": "purple" }
  ],
  "edges": [
    "q, k -> matmul1 -> scale -> mask -> softmax -> matmul2",
    "v -> matmul2"
  ]
}`;

// Vaswani et al. (2017), Figure 2 (right).
const MHA = String.raw`{
  "caption": "Multi-head attention: $h$ attention layers run in parallel on learned projections of $Q$, $K$ and $V$, and their outputs are concatenated and projected: $\\mathrm{MultiHead}(Q, K, V) = \\mathrm{Concat}(\\mathrm{head}_1, \\dots, \\mathrm{head}_h)W^{O}$ with $\\mathrm{head}_i = \\mathrm{Attention}(QW_i^{Q}, KW_i^{K}, VW_i^{V})$.",
  "label": "fig:mha",
  "direction": "up",
  "nodes": [
    { "id": "v", "label": "V", "role": "input" },
    { "id": "k", "label": "K", "role": "input" },
    { "id": "q", "label": "Q", "role": "input" },
    { "id": "linv", "label": "Linear", "role": "linear", "stack": 3 },
    { "id": "link", "label": "Linear", "role": "linear", "stack": 3 },
    { "id": "linq", "label": "Linear", "role": "linear", "stack": 3 },
    { "id": "sdpa", "label": "Scaled Dot-Product\nAttention", "role": "attention", "stack": 3, "repeat": "h" },
    { "id": "concat", "label": "Concat", "tone": "yellow" },
    { "id": "out", "label": "Linear", "role": "linear" }
  ],
  "edges": [
    "v -> linv",
    "k -> link",
    "q -> linq",
    "linv, link, linq -> sdpa -> concat -> out"
  ]
}`;

// Vaswani et al. (2017), Figure 1. The two stacks are laid side by side and
// bottom-aligned; the decoder's residuals run on its right, as in the paper,
// which leaves its left free for the encoder's output.
const TRANSFORMER = String.raw`{
  "caption": "The Transformer. The encoder (left) and the decoder (right) each stack $N$ identical layers; every sub-layer is wrapped in a residual connection followed by layer normalisation, and the decoder's second attention layer attends to the encoder's output.",
  "label": "fig:transformer",
  "direction": "up",
  "layout": "row",
  "align": "end",
  "gap": 40,
  "nodes": [
    {
      "id": "encoderSide",
      "border": "none",
      "children": [
        { "id": "inputs", "label": "Inputs", "role": "input" },
        { "id": "inEmbed", "label": "Input\nEmbedding", "role": "embedding" },
        { "id": "inPos", "label": "Positional\nEncoding", "role": "input", "beside": "inAdd", "side": "left" },
        { "id": "inAdd", "label": "+", "role": "op" },
        {
          "id": "encoder",
          "tone": "gray",
          "repeat": "N×",
          "uniform": true,
          "children": [
            { "id": "encAttn", "label": "Multi-Head\nAttention", "role": "attention" },
            { "id": "encNorm1", "label": "Add & Norm", "role": "norm" },
            { "id": "encFfn", "label": "Feed\nForward", "role": "ffn" },
            { "id": "encNorm2", "label": "Add & Norm", "role": "norm" }
          ]
        }
      ]
    },
    {
      "id": "decoderSide",
      "border": "none",
      "uniform": true,
      "children": [
        { "id": "outputs", "label": "Outputs (shifted right)", "role": "input" },
        { "id": "outEmbed", "label": "Output\nEmbedding", "role": "embedding" },
        { "id": "outAdd", "label": "+", "role": "op" },
        { "id": "outPos", "label": "Positional\nEncoding", "role": "input", "beside": "outAdd" },
        {
          "id": "decoder",
          "tone": "gray",
          "repeat": "N×",
          "uniform": true,
          "children": [
            { "id": "decSelf", "label": "Masked\nMulti-Head\nAttention", "role": "attention" },
            { "id": "decNorm1", "label": "Add & Norm", "role": "norm" },
            { "id": "decCross", "label": "Multi-Head\nAttention", "role": "attention" },
            { "id": "decNorm2", "label": "Add & Norm", "role": "norm" },
            { "id": "decFfn", "label": "Feed\nForward", "role": "ffn" },
            { "id": "decNorm3", "label": "Add & Norm", "role": "norm" }
          ]
        },
        { "id": "linear", "label": "Linear", "role": "linear" },
        { "id": "softmax", "label": "Softmax", "role": "activation" },
        { "id": "probs", "label": "Output\nProbabilities", "role": "output" }
      ]
    }
  ],
  "edges": [
    "inputs -> inEmbed -> inAdd -> encAttn -> encNorm1 -> encFfn -> encNorm2",
    "inPos -> inAdd",
    { "from": "inAdd", "to": "encNorm1", "kind": "residual" },
    { "from": "encNorm1", "to": "encNorm2", "kind": "residual" },
    "outputs -> outEmbed -> outAdd -> decSelf -> decNorm1 -> decCross -> decNorm2 -> decFfn -> decNorm3 -> linear -> softmax -> probs",
    "outPos -> outAdd",
    { "from": "outAdd", "to": "decNorm1", "kind": "residual", "toSide": "right" },
    { "from": "decNorm1", "to": "decNorm2", "kind": "residual", "toSide": "right" },
    { "from": "decNorm2", "to": "decNorm3", "kind": "residual", "toSide": "right" },
    "encNorm2 -> decCross"
  ]
}`;

// The LLaMA-style block that most decoder-only language models share.
const DECODER_BLOCK = String.raw`{
  "caption": "A pre-norm decoder-only Transformer. Each of the $N$ blocks normalises its input with RMSNorm before causal self-attention and before the SwiGLU feed-forward network, and adds each result back through a residual connection: $\\mathbf{h} = \\mathbf{x} + \\mathrm{Attn}(\\mathrm{RMSNorm}(\\mathbf{x}))$, $\\mathbf{y} = \\mathbf{h} + \\mathrm{FFN}(\\mathrm{RMSNorm}(\\mathbf{h}))$.",
  "label": "fig:decoder-block",
  "direction": "up",
  "uniform": true,
  "nodes": [
    { "id": "tokens", "label": "Input tokens", "role": "input" },
    { "id": "embed", "label": "Token embedding", "role": "embedding" },
    {
      "id": "block",
      "label": "Decoder block",
      "tone": "gray",
      "repeat": "N×",
      "uniform": true,
      "children": [
        { "id": "norm1", "label": "RMSNorm", "role": "norm" },
        { "id": "attn", "label": "Causal self-attention", "sublabel": "masked, with RoPE", "role": "attention" },
        { "id": "add1", "label": "+", "role": "op" },
        { "id": "norm2", "label": "RMSNorm", "role": "norm" },
        { "id": "ffn", "label": "SwiGLU FFN", "sublabel": "$(\\mathrm{SiLU}(\\mathbf{x}W_1) \\odot \\mathbf{x}W_3)\\,W_2$", "role": "ffn" },
        { "id": "add2", "label": "+", "role": "op" }
      ]
    },
    { "id": "finalNorm", "label": "RMSNorm", "role": "norm" },
    { "id": "head", "label": "Linear (LM head)", "role": "linear" },
    { "id": "softmax", "label": "Softmax", "role": "activation" },
    { "id": "probs", "label": "Next-token probabilities", "role": "output" }
  ],
  "edges": [
    "tokens -> embed -> norm1 -> attn -> add1 -> norm2 -> ffn -> add2 -> finalNorm -> head -> softmax -> probs",
    { "from": "embed", "to": "add1", "kind": "residual" },
    { "from": "add1", "to": "add2", "kind": "residual" }
  ]
}`;

// DeepSeek-AI (2024), DeepSeek-V2, Figure 2 (MLA). The decoupled key k^R sits
// between the query and key paths so that no two edges cross.
const MLA = String.raw`{
  "caption": "Multi-head latent attention (MLA) in DeepSeek-V2. Keys and values are compressed jointly into the latent $\\mathbf{c}_t^{KV}$, and a decoupled key $\\mathbf{k}_t^{R}$ carries the rotary position embedding (RoPE); only these two vectors are cached during inference.",
  "label": "fig:mla",
  "direction": "up",
  "gap": 36,
  "nodes": [
    { "id": "h", "label": "Input hidden $\\mathbf{h}_t$", "shape": "tensor", "cells": 8, "mask": "full", "tone": "gray" },
    { "id": "cq", "label": "Latent $\\mathbf{c}_t^{Q}$", "role": "latent" },
    { "id": "ckv", "label": "Latent $\\mathbf{c}_t^{KV}$", "role": "latent", "pattern": "hatch" },
    { "id": "qc", "label": "$\\{\\mathbf{q}_{t,i}^{C}\\}$", "tone": "blue" },
    { "id": "qr", "label": "$\\{\\mathbf{q}_{t,i}^{R}\\}$", "tone": "blue" },
    { "id": "kr", "label": "$\\mathbf{k}_t^{R}$", "tone": "purple", "pattern": "hatch", "rank": 2 },
    { "id": "kc", "label": "$\\{\\mathbf{k}_{t,i}^{C}\\}$", "tone": "purple" },
    { "id": "vc", "label": "$\\{\\mathbf{v}_{t,i}^{C}\\}$", "tone": "green" },
    { "id": "q", "label": "$\\{[\\mathbf{q}_{t,i}^{C}; \\mathbf{q}_{t,i}^{R}]\\}$", "sublabel": "concatenate", "tone": "blue" },
    { "id": "k", "label": "$\\{[\\mathbf{k}_{t,i}^{C}; \\mathbf{k}_t^{R}]\\}$", "sublabel": "concatenate", "tone": "purple" },
    { "id": "attn", "label": "Multi-head attention", "sublabel": "$\\mathrm{softmax}(\\mathbf{q}_{t,i}^{\\top}\\mathbf{k}_{j,i} / \\sqrt{d_h + d_h^{R}})$", "role": "attention" },
    { "id": "u", "label": "Output hidden $\\mathbf{u}_t$", "shape": "tensor", "cells": 8, "mask": "full", "tone": "gray" }
  ],
  "edges": [
    { "from": "h", "to": "cq", "label": "$W^{DQ}$" },
    { "from": "h", "to": "ckv", "label": "$W^{DKV}$" },
    { "from": "h", "to": "kr", "label": "$W^{KR}$, RoPE" },
    { "from": "cq", "to": "qc", "label": "$W^{UQ}$" },
    { "from": "cq", "to": "qr", "label": "$W^{QR}$, RoPE" },
    { "from": "ckv", "to": "kc", "label": "$W^{UK}$" },
    { "from": "ckv", "to": "vc", "label": "$W^{UV}$" },
    "qc, qr -> q",
    "kr, kc -> k",
    "q, k, vc -> attn",
    { "from": "attn", "to": "u", "label": "$W^{O}$" }
  ],
  "legend": [
    { "label": "Cached during inference", "tone": "neutral", "pattern": "hatch" }
  ]
}`;

// DeepSeek-AI (2024), DeepSeek-V2, Figure 2 (DeepSeekMoE). The residual runs
// up between the two expert branches and joins the sum from below with them.
const MOE = String.raw`{
  "caption": "A DeepSeekMoE layer. Every token goes through the $N_s$ shared experts; the router sends it to the top-$K_r$ of the $N_r$ fine-grained routed experts, whose outputs are weighted by the gates $g_{i,t}$ and added to the residual: $\\mathbf{h}'_t = \\mathbf{u}_t + \\sum_{i=1}^{N_s} \\mathrm{FFN}^{(s)}_i(\\mathbf{u}_t) + \\sum_{i=1}^{N_r} g_{i,t}\\,\\mathrm{FFN}^{(r)}_i(\\mathbf{u}_t)$.",
  "label": "fig:moe",
  "direction": "up",
  "nodes": [
    { "id": "u", "label": "Input hidden $\\mathbf{u}_t$", "shape": "tensor", "cells": 8, "mask": "full", "tone": "gray" },
    { "id": "router", "label": "Router", "sublabel": "$s_{i,t} = \\mathrm{softmax}_i(\\mathbf{u}_t^{\\top}\\mathbf{e}_i)$", "role": "router", "tone": "gray" },
    { "id": "shared", "label": "Shared experts", "sublabel": "$i = 1, \\dots, N_s$", "role": "expert", "tone": "green", "stack": 2, "rank": 2 },
    { "id": "routed", "label": "Routed experts", "sublabel": "$i = 1, \\dots, N_r$", "role": "expert", "stack": 4 },
    { "id": "sum", "label": "+", "role": "op" },
    { "id": "out", "label": "Output hidden $\\mathbf{h}'_t$", "shape": "tensor", "cells": 8, "mask": "full", "tone": "gray" }
  ],
  "edges": [
    "u -> shared",
    "u -> router",
    { "from": "router", "to": "routed", "label": "top-$K_r$" },
    "shared -> sum",
    { "from": "routed", "to": "sum", "label": "$g_{i,t}$" },
    { "from": "u", "to": "sum", "kind": "residual", "toSide": "bottom" },
    "sum -> out"
  ],
  "legend": [
    { "label": "Shared expert (always active)", "tone": "green" },
    { "label": "Routed expert (top-$K_r$ of $N_r$)", "tone": "blue" }
  ]
}`;

// Lewis et al. (2020), Figure 1, as a left-to-right pipeline.
const RAG = String.raw`{
  "caption": "Retrieval-augmented generation. A query encoder and maximum inner product search (MIPS) over a dense document index retrieve the top-$K$ passages $z$; the generator conditions on the query and each passage, and its predictions are marginalised over the passages: $p(y \\mid x) \\approx \\sum_{z} p_\\eta(z \\mid x)\\, p_\\theta(y \\mid x, z)$.",
  "label": "fig:rag",
  "direction": "right",
  "nodes": [
    { "id": "query", "label": "Query $x$", "role": "input" },
    {
      "id": "retriever",
      "label": "Retriever $p_\\eta$ (non-parametric)",
      "children": [
        { "id": "encoder", "label": "Query\nencoder", "sublabel": "$\\mathbf{q}(x)$", "role": "model" },
        { "id": "mips", "label": "MIPS", "sublabel": "top-$K$", "role": "retriever" },
        { "id": "index", "label": "Document\nindex", "sublabel": "$\\mathbf{d}(z)$", "role": "data", "beside": "mips" }
      ]
    },
    { "id": "generator", "label": "Generator $p_\\theta$", "sublabel": "seq2seq", "role": "model" },
    { "id": "answer", "label": "Answer $y$", "role": "output" }
  ],
  "edges": [
    "query -> encoder -> mips",
    "index -> mips",
    { "from": "mips", "to": "generator", "label": "$z$" },
    { "from": "query", "to": "generator", "kind": "skip" },
    "generator -> answer"
  ]
}`;

// The loop behind ReAct-style agents: act through a tool, read the result.
// The observation is pinned bottom-to-top so that it and the action read as
// one out-and-back pair between the agent and its tools.
const AGENT_LOOP = String.raw`{
  "caption": "An LLM agent loop. The model reasons over the task and its memory, calls a tool, and reads the observation back, repeating until it can give a final answer.",
  "label": "fig:agent-loop",
  "direction": "down",
  "nodes": [
    { "id": "task", "label": "User task", "role": "input" },
    { "id": "agent", "label": "LLM agent", "sublabel": "reason, plan, act", "role": "agent" },
    { "id": "memory", "label": "Memory", "sublabel": "context, vector store", "role": "cache" },
    {
      "id": "tools",
      "label": "Tools",
      "layout": "column",
      "children": [
        { "id": "search", "label": "Web search", "role": "tool" },
        { "id": "code", "label": "Code interpreter", "role": "tool" },
        { "id": "apis", "label": "External APIs", "role": "tool" }
      ]
    },
    { "id": "answer", "label": "Final answer", "role": "output" }
  ],
  "edges": [
    "task -> agent",
    { "from": "agent", "to": "memory", "arrow": "both", "label": "read / write" },
    { "from": "agent", "to": "tools", "label": "action" },
    { "from": "tools", "to": "agent", "kind": "feedback", "fromSide": "top", "toSide": "bottom", "label": "observation" },
    "agent -> answer"
  ]
}`;

// He et al. (2016), Figure 2. The identity shortcut runs on the right, as drawn there.
const RESNET_BLOCK = String.raw`{
  "caption": "Residual learning: a building block. The stacked layers fit the residual $\\mathcal{F}(\\mathbf{x})$, and an identity shortcut adds $\\mathbf{x}$ back before the final ReLU: $\\mathbf{y} = \\mathrm{ReLU}(\\mathcal{F}(\\mathbf{x}) + \\mathbf{x})$.",
  "label": "fig:resnet-block",
  "direction": "down",
  "uniform": true,
  "nodes": [
    { "id": "x", "label": "$\\mathbf{x}$", "role": "input" },
    { "id": "layer1", "label": "weight layer", "role": "conv" },
    { "id": "layer2", "label": "weight layer", "role": "conv" },
    { "id": "add", "label": "+", "role": "op" },
    { "id": "y", "label": "$\\mathbf{y}$", "role": "output" }
  ],
  "edges": [
    "x -> layer1",
    "layer1 -> layer2: relu",
    { "from": "layer2", "to": "add", "label": "$\\mathcal{F}(\\mathbf{x})$" },
    { "from": "x", "to": "add", "kind": "residual", "toSide": "right", "label": "$\\mathbf{x}$ identity" },
    { "from": "add", "to": "y", "label": "relu" }
  ]
}`;

// The loss comes after the reconstruction; the input reaches it by a skip
// edge over the top. Dashed = training only, as the legend says.
const AUTOENCODER = String.raw`{
  "caption": "An autoencoder. The encoder $f_\\phi$ compresses the input into a low-dimensional code $\\mathbf{z}$, the decoder $g_\\theta$ reconstructs it, and training minimises the reconstruction error $\\lVert \\mathbf{x} - \\hat{\\mathbf{x}} \\rVert_2^2$.",
  "label": "fig:autoencoder",
  "direction": "right",
  "nodes": [
    { "id": "x", "label": "$\\mathbf{x}$", "shape": "tensor", "cells": [6, 1], "mask": "full", "tone": "blue" },
    { "id": "encoder", "label": "Encoder $f_\\phi$", "shape": "funnel", "tone": "blue" },
    { "id": "z", "label": "$\\mathbf{z}$", "shape": "tensor", "cells": [2, 1], "mask": "full", "tone": "teal" },
    { "id": "decoder", "label": "Decoder $g_\\theta$", "shape": "expand", "tone": "orange" },
    { "id": "xhat", "label": "$\\hat{\\mathbf{x}}$", "shape": "tensor", "cells": [6, 1], "mask": "full", "tone": "blue" },
    { "id": "loss", "label": "Reconstruction loss", "sublabel": "$\\lVert \\mathbf{x} - \\hat{\\mathbf{x}} \\rVert_2^2$", "role": "loss" }
  ],
  "edges": [
    "x -> encoder -> z -> decoder -> xhat",
    "xhat --> loss",
    { "from": "x", "to": "loss", "kind": "skip", "line": "dashed" }
  ],
  "legend": [
    { "label": "Training only", "line": "dashed" }
  ]
}`;

// Row i is a query, column j a key. The sliding window has no mask keyword,
// so its band is spelled out as 0/1 values: j in (i - 3, i].
const ATTENTION_MASKS = String.raw`{
  "caption": "Attention masks over $n = 8$ tokens. Row $i$ is a query and column $j$ a key; a filled cell means that query $i$ may attend to key $j$. (a) Full bidirectional attention, as in an encoder. (b) Causal attention, as in a decoder. (c) Causal sliding-window attention with window $w = 3$.",
  "label": "fig:attention-masks",
  "layout": "row",
  "nodes": [
    {
      "id": "fullPanel",
      "label": "Full",
      "panel": true,
      "children": [
        { "id": "full", "label": "$M_{ij} = 1$", "shape": "tensor", "cells": [8, 8], "mask": "full", "tone": "blue" }
      ]
    },
    {
      "id": "causalPanel",
      "label": "Causal",
      "panel": true,
      "children": [
        { "id": "causal", "label": "$M_{ij} = [\\,j \\le i\\,]$", "shape": "tensor", "cells": [8, 8], "mask": "causal", "tone": "blue" }
      ]
    },
    {
      "id": "windowPanel",
      "label": "Sliding window",
      "panel": true,
      "children": [
        {
          "id": "window",
          "label": "$M_{ij} = [\\,i - w < j \\le i\\,]$",
          "shape": "tensor",
          "cells": [8, 8],
          "tone": "blue",
          "values": [
            [1, 0, 0, 0, 0, 0, 0, 0],
            [1, 1, 0, 0, 0, 0, 0, 0],
            [1, 1, 1, 0, 0, 0, 0, 0],
            [0, 1, 1, 1, 0, 0, 0, 0],
            [0, 0, 1, 1, 1, 0, 0, 0],
            [0, 0, 0, 1, 1, 1, 0, 0],
            [0, 0, 0, 0, 1, 1, 1, 0],
            [0, 0, 0, 0, 0, 1, 1, 1]
          ]
        }
      ]
    }
  ]
}`;

// Dosovitskiy et al. (2021), Figure 1, with the encoder's layer drawn inline.
const VIT = String.raw`{
  "caption": "Vision Transformer (ViT). The image is split into fixed-size patches; each patch is flattened and linearly projected, a learnable [class] embedding (0*) is prepended, position embeddings are added, and the sequence goes through a standard Transformer encoder. An MLP head classifies the final [class] token $\\mathbf{z}_L^{0}$.",
  "label": "fig:vit",
  "direction": "up",
  "nodes": [
    { "id": "image", "label": "Image, split into patches", "shape": "tensor", "cells": [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]], "tone": "gray" },
    { "id": "patches", "label": "Flattened patches $\\mathbf{x}_p^{i}$", "shape": "tensor", "cells": ["1", "2", "3", "4", "5", "6", "7", "8", "9"], "tone": "gray" },
    { "id": "projection", "label": "Linear projection", "sublabel": "$\\mathbf{E} \\in \\mathbb{R}^{(P^2 C) \\times D}$", "role": "linear" },
    { "id": "cls", "label": "Extra learnable\n[class] embedding", "role": "embedding", "beside": "tokens", "side": "left" },
    { "id": "tokens", "label": "Patch + position embeddings", "shape": "tensor", "cells": ["0*", "1", "2", "3", "4", "5", "6", "7", "8", "9"], "tone": "pink" },
    {
      "id": "encoder",
      "label": "Transformer\nencoder",
      "tone": "gray",
      "repeat": "L×",
      "uniform": true,
      "children": [
        { "id": "norm1", "label": "Norm", "role": "norm" },
        { "id": "attn", "label": "Multi-head attention", "role": "attention" },
        { "id": "add1", "label": "+", "role": "op" },
        { "id": "norm2", "label": "Norm", "role": "norm" },
        { "id": "mlp", "label": "MLP", "role": "ffn" },
        { "id": "add2", "label": "+", "role": "op" }
      ]
    },
    { "id": "head", "label": "MLP head", "role": "ffn" },
    { "id": "class", "label": "Class\n(bird, ball, car, …)", "role": "output" }
  ],
  "edges": [
    "image -> patches -> projection -> tokens -> norm1 -> attn -> add1 -> norm2 -> mlp -> add2",
    "cls -> tokens",
    { "from": "tokens", "to": "add1", "kind": "residual" },
    { "from": "add1", "to": "add2", "kind": "residual" },
    "add2 -> head",
    "head -> class"
  ]
}`;

// The methods figure of an empirical paper: shared data, compared systems, one evaluation.
const METHOD_PIPELINE = String.raw`{
  "caption": "Research methodology. The data are collected and preprocessed once; the proposed model, the baselines and the ablated variants are trained on the same splits and evaluated with the same metrics.",
  "label": "fig:method",
  "direction": "right",
  "nodes": [
    { "id": "collect", "label": "Data\ncollection", "role": "data" },
    { "id": "preprocess", "label": "Preprocessing", "sublabel": "cleaning, splits", "role": "process" },
    {
      "id": "experiments",
      "label": "Experiments",
      "children": [
        { "id": "model", "label": "Proposed model", "role": "model" },
        { "id": "baselines", "label": "Baselines", "role": "model", "tone": "gray" },
        { "id": "ablations", "label": "Ablations", "sublabel": "components removed", "role": "model", "border": "dashed" }
      ]
    },
    { "id": "evaluation", "label": "Evaluation", "sublabel": "metrics, tests", "role": "process" },
    { "id": "findings", "label": "Findings", "role": "output" }
  ],
  "edges": [
    "collect -> preprocess -> model, baselines",
    "preprocess --> ablations --> evaluation",
    "model, baselines -> evaluation -> findings"
  ],
  "legend": [
    { "label": "Ablation branch", "line": "dashed" }
  ]
}`;

const TEMPLATES: FigureTemplate[] = [
  {
    id: 'sdpa',
    label: 'Scaled dot-product attention',
    description: 'Vaswani et al. (2017): MatMul, scale, optional mask, softmax, MatMul with V.',
    category: 'mechanism',
    source: SDPA,
  },
  {
    id: 'mha',
    label: 'Multi-head attention',
    description: 'h attention heads over projected Q, K and V, concatenated and projected.',
    category: 'mechanism',
    source: MHA,
  },
  {
    id: 'transformer',
    label: 'Transformer',
    description: 'The encoder–decoder of Vaswani et al. (2017): N× stacks, Add & Norm, positional encoding.',
    category: 'architecture',
    source: TRANSFORMER,
  },
  {
    id: 'decoder-block',
    label: 'Decoder-only block',
    description: 'Pre-norm block: RMSNorm, causal self-attention, SwiGLU FFN and residual additions.',
    category: 'architecture',
    source: DECODER_BLOCK,
  },
  {
    id: 'mla',
    label: 'Multi-head latent attention',
    description: 'DeepSeek-V2: low-rank joint KV compression and decoupled RoPE keys; cached vectors hatched.',
    category: 'mechanism',
    source: MLA,
  },
  {
    id: 'moe',
    label: 'Mixture of experts',
    description: 'DeepSeekMoE: shared experts plus top-K routed experts, gated and added to the residual.',
    category: 'mechanism',
    source: MOE,
  },
  {
    id: 'rag',
    label: 'Retrieval-augmented generation',
    description: 'Query encoder and MIPS over a document index feeding a generator (Lewis et al., 2020).',
    category: 'pipeline',
    source: RAG,
  },
  {
    id: 'agent-loop',
    label: 'LLM agent loop',
    description: 'An agent that reads and writes memory, calls tools and loops on their observations.',
    category: 'pipeline',
    source: AGENT_LOOP,
  },
  {
    id: 'resnet-block',
    label: 'Residual block',
    description: 'He et al. (2016): two weight layers and an identity shortcut into ⊕.',
    category: 'architecture',
    source: RESNET_BLOCK,
  },
  {
    id: 'autoencoder',
    label: 'Autoencoder',
    description: 'Encoder funnel to a latent code, decoder back out, and the reconstruction loss.',
    category: 'architecture',
    source: AUTOENCODER,
  },
  {
    id: 'attention-masks',
    label: 'Attention masks',
    description: 'Three panels: full, causal and sliding-window masks as 8×8 grids.',
    category: 'layout',
    source: ATTENTION_MASKS,
  },
  {
    id: 'vit',
    label: 'Vision Transformer',
    description: 'ViT: patches, linear projection, [class] and position embeddings, encoder, MLP head.',
    category: 'architecture',
    source: VIT,
  },
  {
    id: 'method-pipeline',
    label: 'Research method',
    description: 'Data collection to evaluation, with baselines and a dashed ablation branch.',
    category: 'pipeline',
    source: METHOD_PIPELINE,
  },
];

/**
 * The Templates menu, in menu order: the attention family, then whole
 * architectures, pipelines and a multi-panel layout. Frozen, because every
 * editor shares the one list.
 */
export const FIGURE_TEMPLATES: readonly FigureTemplate[] = Object.freeze(
  TEMPLATES.map((template) => Object.freeze(template)),
);
