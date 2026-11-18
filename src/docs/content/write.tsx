import type { ReactNode } from 'react';
import type { DocSlug } from '../catalog';
import { Example, Facts, Note } from '../kit';

// Rendered inside the Vite config process (vite.docs.ts): relative imports
// only, never `@/`. Labels are the app's own, word for word.

export const writeDocs = {
  editor: (
    <>
      <p>
        A page is a title and a sequence of blocks. A block is a paragraph, a heading, a list item, a quote, a callout,
        code, a diagram, a figure, an image or a divider. Equations, citations, tables, charts and AI passages sit inside
        a paragraph, in the run of the text.
      </p>
      <Facts
        rows={[
          [
            'Insert',
            <>
              Type <code>/</code> on any line, or use the <strong>+</strong> beside a block (<kbd>Alt</kbd>-click adds
              above).
            </>,
          ],
          ['Who can edit', 'Editors, admins and owners. Viewers read the page as View only.'],
          [
            'Undo',
            <>
              <kbd>Mod</kbd> <kbd>Z</kbd>. One action is one undo step, even when it changed several blocks.
            </>,
          ],
        ]}
      />

      <h2 id="block-types">Block types</h2>
      <p>
        Every type is in the <code>/</code> menu. Typing the shortcut at the start of an empty line converts it as well.
      </p>
      <table>
        <thead>
          <tr>
            <th>Block</th>
            <th>Use it for</th>
            <th>Shortcut</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Text</td>
            <td>Body paragraphs</td>
            <td>—</td>
          </tr>
          <tr>
            <td>Heading 1, 2, 3</td>
            <td>Sections and subsections</td>
            <td>
              <code>#</code> <code>##</code> <code>###</code>
            </td>
          </tr>
          <tr>
            <td>Bulleted list</td>
            <td>Unordered items</td>
            <td>
              <code>-</code> <code>*</code> <code>+</code>
            </td>
          </tr>
          <tr>
            <td>Numbered list</td>
            <td>Steps in order</td>
            <td>
              <code>1.</code> <code>1)</code>
            </td>
          </tr>
          <tr>
            <td>To-do list</td>
            <td>Tasks with a checkbox</td>
            <td>
              <code>[]</code> <code>[x]</code>
            </td>
          </tr>
          <tr>
            <td>Quote</td>
            <td>A quotation</td>
            <td>
              <code>&gt;</code>
            </td>
          </tr>
          <tr>
            <td>Callout</td>
            <td>A note that stands out</td>
            <td>
              <code>!&gt;</code>
            </td>
          </tr>
          <tr>
            <td>Code</td>
            <td>Code or preformatted text, with a language</td>
            <td>
              <code>```</code>
            </td>
          </tr>
          <tr>
            <td>Diagram</td>
            <td>
              A Mermaid flowchart, sequence or other diagram. See <a href="diagrams-figures.html">Diagrams and figures</a>
              .
            </td>
            <td>—</td>
          </tr>
          <tr>
            <td>Figure</td>
            <td>
              An architecture, mechanism or pipeline figure. See <a href="diagrams-figures.html">Diagrams and figures</a>
              .
            </td>
            <td>—</td>
          </tr>
          <tr>
            <td>Image</td>
            <td>
              An uploaded image with alt text. See <a href="images.html">Images</a>.
            </td>
            <td>—</td>
          </tr>
          <tr>
            <td>Divider</td>
            <td>A rule between sections</td>
            <td>
              <code>---</code> <code>***</code>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        <kbd>Mod</kbd> <kbd>Alt</kbd> and a digit turns the selected blocks into another type: <kbd>0</kbd> Text,{' '}
        <kbd>1</kbd>–<kbd>3</kbd> Heading 1–3, <kbd>4</kbd> To-do list, <kbd>5</kbd> Bulleted list, <kbd>6</kbd> Numbered
        list, <kbd>7</kbd> Quote, <kbd>8</kbd> Code, <kbd>9</kbd> Callout.
      </p>

      <h2 id="inline-content">Content inside a paragraph</h2>
      <p>
        The <strong>Insert</strong> group of the <code>/</code> menu places these at the cursor, in the run of the text:
      </p>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>What it adds</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Equation</td>
            <td>
              LaTeX maths in the run of text. See <a href="equations.html">Equations</a>.
            </td>
          </tr>
          <tr>
            <td>Display equation</td>
            <td>Numbered maths on its own centred line.</td>
          </tr>
          <tr>
            <td>Citation</td>
            <td>
              A citation, searchable by title. See <a href="citations.html">Citations and references</a>.
            </td>
          </tr>
          <tr>
            <td>Table</td>
            <td>
              Rows and columns with a caption. See <a href="tables-charts.html">Tables and charts</a>.
            </td>
          </tr>
          <tr>
            <td>Chart</td>
            <td>A bar, line, area or pie chart.</td>
          </tr>
          <tr>
            <td>AI passage</td>
            <td>
              A passage you draft with the assistant, then place yourself. See <a href="#ai-passages">below</a>.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Each opens a small editor when selected, which ends with <strong>Remove</strong> and <strong>Done</strong>. An
        equation or a citation closed while still empty is removed.
      </p>

      <h2 id="format-text">Format text</h2>
      <p>Select text to show the formatting toolbar. Its controls, in order:</p>
      <ol>
        <li>
          <strong>Ask AI</strong> (<kbd>Mod</kbd> <kbd>J</kbd>): see <a href="ask-ai.html">Ask AI and AI beats</a>.
        </li>
        <li>
          <strong>Turn into</strong>: the block’s type, for paragraphs and headings.
        </li>
        <li>
          <strong>Bold</strong> (<kbd>Mod</kbd> <kbd>B</kbd>), <strong>Italic</strong> (<kbd>Mod</kbd> <kbd>I</kbd>),{' '}
          <strong>Underline</strong> (<kbd>Mod</kbd> <kbd>U</kbd>), <strong>Strikethrough</strong>,{' '}
          <strong>Inline code</strong>.
        </li>
        <li>
          <strong>Add link</strong> (<kbd>Mod</kbd> <kbd>K</kbd>): paste a link and choose <strong>Apply</strong>.
        </li>
        <li>
          <strong>Cite</strong>: a citation at the selection.
        </li>
        <li>
          <strong>…</strong> (More AI actions): the rewrites and research actions of Ask AI.
        </li>
      </ol>
      <p>
        With text selected, <kbd>Alt</kbd> <kbd>F10</kbd> moves the keyboard focus to the toolbar.{' '}
        <kbd>Mod</kbd> <kbd>Shift</kbd> <kbd>V</kbd> pastes as plain text.
      </p>

      <h2 id="block-menu">The block menu</h2>
      <p>
        Hover a block and click its handle (⋮⋮) to open its menu, or drag the handle to move the block. The menu has a
        search field, then:
      </p>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Turn into</td>
            <td>Changes the block’s type.</td>
          </tr>
          <tr>
            <td>Duplicate</td>
            <td>
              Copies the block below itself (<kbd>Mod</kbd> <kbd>D</kbd>).
            </td>
          </tr>
          <tr>
            <td>Copy link to block</td>
            <td>A link that opens the page at this block.</td>
          </tr>
          <tr>
            <td>Move up, Move down</td>
            <td>
              <kbd>Mod</kbd> <kbd>Shift</kbd> <kbd>↑</kbd> / <kbd>↓</kbd>.
            </td>
          </tr>
          <tr>
            <td>Insert below</td>
            <td>A new block of any type under this one.</td>
          </tr>
          <tr>
            <td>Ask AI</td>
            <td>Ask AI on this block.</td>
          </tr>
          <tr>
            <td>Hide from assistant</td>
            <td>
              Keeps the block out of what the assistant reads. See <a href="#hide-and-lock">below</a>.
            </td>
          </tr>
          <tr>
            <td>Lock block</td>
            <td>Makes the block read-only, for you and for the assistant.</td>
          </tr>
          <tr>
            <td>More</td>
            <td>
              <strong>Insert above</strong>, <strong>Copy as Markdown</strong>, <strong>Collapse</strong>; for a Text
              paragraph, <strong>Columns</strong> (1 to 4); for a heading, <strong>Level</strong> and{' '}
              <strong>Assistant instructions…</strong>.
            </td>
          </tr>
          <tr>
            <td>Delete</td>
            <td>Removes the block.</td>
          </tr>
        </tbody>
      </table>
      <p>With several blocks selected, the menu applies to all of them. Viewers get Copy link to block, Ask AI and Copy as Markdown only.</p>

      <h2 id="hide-and-lock">Hide and lock blocks</h2>
      <p>Two settings in the block menu set what the assistant may do with a block. A mark in the margin shows each.</p>
      <ul>
        <li>
          <strong>Hide from assistant</strong>: the assistant leaves the block out whenever it reads the page, and Ask
          AI will not run on it. <strong>Show to assistant</strong> reverses it.
        </li>
        <li>
          <strong>Lock block</strong>: nobody can edit the block, and the assistant cannot change it. Locked blocks
          cannot be moved, turned into another type or deleted. <strong>Unlock block</strong> reverses it.
        </li>
      </ul>

      <h2 id="ai-passages">AI passages</h2>
      <p>
        An AI passage (<code>/</code> → <strong>AI passage</strong>) is a panel in the paragraph where you draft text with
        the assistant before placing it.
      </p>
      <ol>
        <li>
          Write what you want in <strong>Message</strong>. <strong>Style prompt</strong> sets how it should read. Each
          field takes up to 2,000 characters.
        </li>
        <li>
          Choose <strong>Generate</strong> (<kbd>Mod</kbd> <kbd>Enter</kbd>). <strong>Stop</strong> ends it;{' '}
          <strong>Regenerate</strong> tries again.
        </li>
        <li>
          <strong>Insert into text</strong> replaces the panel with the generated text. <strong>Clear</strong> empties
          the output.
        </li>
      </ol>
      <p>
        Exports leave AI passages out unless you choose otherwise under <strong>AI Beat drafts</strong>. Viewers see the
        panel read-only.
      </p>

      <h2 id="saving">Saving</h2>
      <p>
        Pages save automatically a few seconds after you stop typing. If the page changed somewhere else in the
        meantime, or a save failed, the editor keeps your edits on this device and asks what to do: see{' '}
        <a href="history.html#save-conflicts">Version history</a>.
      </p>
    </>
  ),

  equations: (
    <>
      <p>
        Equations are LaTeX, typeset as you type. An equation sits in the run of a sentence, or on its own centred line
        as a display equation, which can be numbered and labelled.
      </p>
      <Facts
        rows={[
          [
            'Insert',
            <>
              <code>/</code> → <strong>Equation</strong> (in the text) or <strong>Display equation</strong> (own line)
            </>,
          ],
          ['Language', 'LaTeX maths, typeset with KaTeX'],
          ['Numbering', 'Display equations only, counted through the page'],
        ]}
      />

      <h2 id="write-an-equation">Write an equation</h2>
      <ol>
        <li>
          Type <code>/</code> where the maths belongs and choose <strong>Equation</strong>. The editor opens at once.
        </li>
        <li>
          Type LaTeX in the <strong>LaTeX</strong> field, or pick a symbol from the palette under it (powers, indices,
          fractions, roots, sums, integrals, Greek letters, relations, vectors).
        </li>
        <li>
          <kbd>Enter</kbd> finishes; <kbd>Shift</kbd> <kbd>Enter</kbd> adds a line. Select the equation later to edit it.
        </li>
      </ol>
      <Example id="equation" />

      <h2 id="display-and-numbering">Display equations and numbering</h2>
      <ul>
        <li>
          <strong>Display on its own line</strong> moves the equation to a centred line of its own.
        </li>
        <li>
          <strong>Numbered</strong> (display equations only) numbers it: the number, (1), (2)…, counts the numbered
          display equations from the top of the page and stays right-aligned.
        </li>
        <li>
          <strong>Label</strong> (numbered equations only) names it for cross-references, for example{' '}
          <code>eq:mass-energy</code>.
        </li>
      </ul>

      <h2 id="equations-elsewhere">Equations elsewhere</h2>
      <ul>
        <li>PDF and HTML exports typeset them; Markdown writes them as <code>$…$</code>; LaTeX writes them as LaTeX.</li>
        <li>
          The assistant’s replies typeset <code>$…$</code>, <code>$$…$$</code>, <code>\(…\)</code> and{' '}
          <code>\[…\]</code>.
        </li>
        <li>An equation with nothing in it shows “Empty equation”. Typesetting is unavailable offline.</li>
      </ul>
    </>
  ),

  'tables-charts': (
    <>
      <p>
        Tables and charts sit inside a paragraph. A table has a header row, cells you edit in place and a caption. A
        chart draws a bar, line, area or pie chart from a list of labelled values.
      </p>
      <Facts
        rows={[
          [
            'Insert',
            <>
              <code>/</code> → <strong>Table</strong> or <strong>Chart</strong>
            </>,
          ],
          ['New table', '3 × 3, with a header row'],
          ['New chart', 'A bar chart with three values to replace'],
        ]}
      />

      <h2 id="tables">Tables</h2>
      <ol>
        <li>
          Type <code>/</code> → <strong>Table</strong>, then click a cell and type.
        </li>
        <li>
          <strong>Add a row</strong> and <strong>Add a column</strong> are at the table’s edges. A cell’s{' '}
          <strong>…</strong> menu inserts rows above or below and columns left or right, aligns the column left, centre
          or right, and deletes the row or the column.
        </li>
        <li>
          <strong>Table settings</strong> holds <strong>Header row</strong> (treat the first row as column headings)
          and <strong>Caption</strong>.
        </li>
      </ol>
      <p>
        Paste spreadsheet or CSV data into the table to fill it. <kbd>Tab</kbd> and <kbd>Shift</kbd> <kbd>Tab</kbd> move
        between cells, and <kbd>Tab</kbd> in the last cell adds a row. <kbd>Enter</kbd> moves down;{' '}
        <kbd>Shift</kbd> <kbd>Enter</kbd> starts a new line inside a cell.
      </p>
      <Example id="table" />

      <h2 id="charts">Charts</h2>
      <p>
        Select a chart to change it. The type buttons pick the chart; <strong>Figure data</strong> holds the rest.
      </p>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Use it for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Bar</td>
            <td>Comparing values across categories</td>
          </tr>
          <tr>
            <td>Line</td>
            <td>Change over an ordered axis</td>
          </tr>
          <tr>
            <td>Area</td>
            <td>Change over time, with volume</td>
          </tr>
          <tr>
            <td>Pie</td>
            <td>Parts of one whole, at a glance</td>
          </tr>
        </tbody>
      </table>
      <ul>
        <li>
          <strong>Title</strong>: what the chart shows.
        </li>
        <li>
          <strong>Data</strong>: one row per point, a label and a value. <strong>Add point</strong> adds a row.
        </li>
        <li>
          <strong>X axis</strong> and <strong>Y axis</strong>: the axis titles (not for pie charts).
        </li>
        <li>
          <strong>Caption</strong>: the line under the chart.
        </li>
      </ul>
      <p>A pie with more than six slices suggests a bar chart instead.</p>
      <Example id="chart" />
    </>
  ),

  'diagrams-figures': (
    <>
      <p>
        ColWrite draws two kinds of figure from text. A <strong>Diagram</strong> is Mermaid source: flowcharts, sequence
        diagrams, timelines. A <strong>Figure</strong> is a structured figure for papers: architectures, mechanisms,
        pipelines and multi-panel figures with maths in their labels, laid out and routed for you.
      </p>
      <Facts
        rows={[
          [
            'Insert',
            <>
              <code>/</code> → <strong>Diagram</strong> or <strong>Figure</strong>
            </>,
          ],
          ['Export', 'SVG for both; TikZ for structured figures'],
          ['Stored as', 'Its source in the page. The drawing is made again wherever it is shown.'],
        ]}
      />

      <h2 id="mermaid-diagrams">Mermaid diagrams</h2>
      <ol>
        <li>
          Type <code>/</code> → <strong>Diagram</strong>. Choose <strong>Templates</strong> to start from a flowchart,
          sequence, class, state, entity relationship, Gantt, pie, mind map or timeline diagram.
        </li>
        <li>
          Edit the source; the drawing follows. <strong>Syntax</strong> opens the Mermaid reference.{' '}
          <strong>Done</strong> closes the source.
        </li>
        <li>
          Choose <strong>Edit</strong> on the drawing to open the source again.
        </li>
      </ol>
      <p>
        Hover the drawing for <strong>Open larger</strong>, <strong>Copy source</strong> and{' '}
        <strong>Download SVG</strong>.
      </p>
      <Example id="diagram" />

      <h2 id="structured-figures">Structured figures</h2>
      <p>
        A structured figure is a short JSON spec of nodes, groups and edges with roles (input, router, expert, output…).
        ColWrite lays it out, routes the arrows and typesets the labels.
      </p>
      <ol>
        <li>
          Type <code>/</code> → <strong>Figure</strong>. Describe it to the assistant, or start from a template.
        </li>
        <li>
          Click any part of the figure to edit it: <strong>Label</strong>, <strong>Role</strong>,{' '}
          <strong>Shape</strong>, <strong>Layout</strong>, <strong>Direction</strong>, <strong>Border</strong> and{' '}
          <strong>Tone</strong>. <strong>Show in source</strong> finds it in the spec.
        </li>
        <li>
          Choose <strong>Edit</strong> (or double-click) for the source. <strong>Reference</strong> lists the roles,
          edges, nodes, groups, shapes and tones; <strong>Format</strong> tidies the JSON;{' '}
          <strong>Done</strong> closes it.
        </li>
        <li>
          Problems are listed as errors, warnings and notes. With an error, the figure keeps showing the last version
          that drew.
        </li>
      </ol>
      <Example id="figure" />
      <table>
        <thead>
          <tr>
            <th>Templates</th>
            <th>Figures</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Architectures</td>
            <td>Transformer, Decoder-only block, Residual block, Autoencoder, Vision Transformer</td>
          </tr>
          <tr>
            <td>Mechanisms</td>
            <td>Scaled dot-product attention, Multi-head attention, Multi-head latent attention, Mixture of experts</td>
          </tr>
          <tr>
            <td>Pipelines</td>
            <td>Retrieval-augmented generation, LLM agent loop, Research method</td>
          </tr>
          <tr>
            <td>Panels and tensors</td>
            <td>Attention masks</td>
          </tr>
        </tbody>
      </table>
      <p>
        Hover the figure for <strong>Open larger</strong>, <strong>Copy source</strong>,{' '}
        <strong>Copy TikZ (LaTeX)</strong> and <strong>Download SVG</strong>.
      </p>

      <h2 id="ask-ai-on-a-figure">Ask AI on a figure</h2>
      <p>
        <strong>Ask AI</strong> in the figure’s source view offers <strong>Draw from the caption</strong>,{' '}
        <strong>Improve the figure</strong>, <strong>Fix problems</strong>, <strong>Make print-safe</strong>,{' '}
        <strong>Simplify the figure</strong> and <strong>Explain the figure</strong>. On selected text,{' '}
        <strong>Draw as a figure</strong> turns a description into a figure.
      </p>

      <h2 id="numbering-and-export">Numbering and export</h2>
      <ul>
        <li>A captioned figure is numbered “Figure N.”, in one sequence with captioned images.</li>
        <li>PDF and HTML exports draw diagrams and figures.</li>
        <li>
          The LaTeX export prints a structured figure as its JSON source and a diagram as Mermaid code. For a figure in
          TeX, use <strong>Copy TikZ (LaTeX)</strong>.
        </li>
      </ul>
    </>
  ),

  images: (
    <>
      <p>
        An image block holds an uploaded image with alt text, a caption and a width. The assistant can also propose a
        generated illustration, which you confirm before anything is generated.
      </p>
      <Facts
        rows={[
          [
            'Insert',
            <>
              <code>/</code> → <strong>Image</strong>
            </>,
          ],
          ['Files', 'PNG, JPEG, GIF or WebP, up to 25 MiB'],
          [
            'Generated images',
            <>
              Off by default: needs the <strong>Images</strong> switch, the workspace’s permission and a server that
              offers it
            </>,
          ],
        ]}
      />

      <h2 id="upload-an-image">Upload an image</h2>
      <ol>
        <li>
          Type <code>/</code> → <strong>Image</strong>.
        </li>
        <li>
          Choose the <strong>Image file</strong>, write the <strong>Alt text</strong> (required) and, if you want, a{' '}
          <strong>Caption</strong>.
        </li>
        <li>
          Choose <strong>Insert image</strong>.
        </li>
      </ol>
      <p>
        <strong>Edit image details</strong> on the image changes the <strong>Alt text</strong>,{' '}
        <strong>Caption</strong>, <strong>Width (%)</strong> (20 to 100) and <strong>Figure label</strong> (for
        cross-references, for example <code>fig:pipeline</code>). A captioned image is numbered “Figure N.”, in one
        sequence with captioned structured figures.
      </p>

      <h2 id="generate-an-image">Generate an image</h2>
      <ol>
        <li>
          Type <code>/</code> → <strong>Generate image…</strong>, or ask in the assistant chat. The chat opens with the
          request started for that block.
        </li>
        <li>
          The assistant proposes an <strong>Image request</strong>: the exact prompt, the model, the quality, the aspect
          ratio and the estimated cost. Nothing is generated yet.
        </li>
        <li>
          <strong>Edit request</strong> changes the <strong>Exact prompt</strong> and the <strong>Aspect ratio</strong>{' '}
          (1:1, 3:2, 2:3, 4:3, 3:4, 16:9, 9:16 or 21:9). <strong>Discard</strong> drops it.
        </li>
        <li>
          <strong>Generate</strong> starts it. Generation can take two minutes; <strong>Stop</strong> ends it.
        </li>
        <li>
          Check the alt text and caption, then choose <strong>Insert image</strong>. <strong>Generate again…</strong>{' '}
          reuses the exact prompt.
        </li>
      </ol>
      <Note tone="warning">
        <p>
          Auto never confirms a generation: each image needs your <strong>Generate</strong>. Limits: two proposals per
          assistant reply, 20 generations per person per day and 200 per workspace per month (UTC). A generated image is
          marked “AI-generated image”, and once it is placed on the page it is listed in the page’s AI use. Check your
          venue’s policy on generated figures.
        </p>
      </Note>

      <h2 id="images-in-exports">Images in exports</h2>
      <p>
        Exports include the original image files. Markdown and LaTeX exports with images download as a ZIP. The export
        dialog warns when an image would print below 300 dpi at its placed width.
      </p>
    </>
  ),
} satisfies Partial<Record<DocSlug, ReactNode>>;
