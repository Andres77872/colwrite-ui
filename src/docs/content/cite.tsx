import type { ReactNode } from 'react';
import type { DocSlug } from '../catalog';
import { Example, Facts, Note } from '../kit';

// Rendered inside the Vite config process (vite.docs.ts): relative imports
// only, never `@/`. Labels are the app's own, word for word.

export const citeDocs = {
  citations: (
    <>
      <p>
        A citation sits in the text and names one or more works. The page’s <strong>Sources</strong> keep a full record
        of each work, and the reference list at the end of the page is set from those records in the page’s citation
        style.
      </p>
      <Facts
        rows={[
          [
            'Cite',
            <>
              <strong>Cite</strong> in the formatting toolbar, <code>/</code> → <strong>Citation</strong>, or{' '}
              <strong>Cite</strong> on any paper or source
            </>,
          ],
          ['Styles', 'Eight CSL styles; Vancouver (brackets) by default'],
          ['Sources', 'The Sources tab of the right sidebar: add, check, edit, BibTeX'],
        ]}
      />

      <h2 id="cite-a-work">Cite a work</h2>
      <ol>
        <li>
          Put the caret where the citation belongs and choose <strong>Cite</strong> (or <code>/</code> →{' '}
          <strong>Citation</strong>).
        </li>
        <li>
          Under <strong>Find a source</strong>, search papers by title, or paste a DOI or an arXiv id, and choose{' '}
          <strong>Add</strong>. A key you type yourself can be added as it is.
        </li>
        <li>
          Add more works to the same citation the same way. <strong>More options</strong> sets a{' '}
          <strong>Prefix</strong> (see), a <strong>Locator</strong> (p. 12) and a <strong>Suffix</strong>.
        </li>
      </ol>
      <p>
        <strong>Cite</strong> on a paper in Research, a source in the Sources panel or a source under an assistant reply
        inserts it at the caret. A citation the assistant made records the passage it rests on (“Rests on passage S3.2”).
      </p>
      <Example id="citations" />

      <h2 id="citation-styles">Citation styles</h2>
      <table>
        <thead>
          <tr>
            <th>Style</th>
            <th>In the text</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Vancouver (brackets)</td>
            <td>[1–3]</td>
          </tr>
          <tr>
            <td>Vancouver</td>
            <td>(1–3)</td>
          </tr>
          <tr>
            <td>IEEE</td>
            <td>[1], [2]</td>
          </tr>
          <tr>
            <td>APA 7th edition</td>
            <td>(Smith, 2020)</td>
          </tr>
          <tr>
            <td>Chicago author-date</td>
            <td>(Smith 2020)</td>
          </tr>
          <tr>
            <td>AMA 11th edition</td>
            <td>¹⁻³</td>
          </tr>
          <tr>
            <td>Nature</td>
            <td>¹⁻³</td>
          </tr>
          <tr>
            <td>ACM</td>
            <td>[1, 2]</td>
          </tr>
        </tbody>
      </table>
      <p>
        Choose the style in <strong>Sources → Citation style</strong> or <strong>Page options → Citation style</strong>.{' '}
        <strong>Auto</strong> follows the style most of the citations name. The whole page, its exports and a copied
        answer’s source list use the same style, formatted by citeproc-js from the Citation Style Language styles.
      </p>

      <h2 id="sources-panel">The Sources panel</h2>
      <ul>
        <li>
          <strong>Add a source</strong>: type a DOI, an arXiv id or a PMID and choose <strong>Add</strong>. The record is
          looked up and checked against the registries.
        </li>
        <li>
          The list has two parts: <strong>Cited</strong> and <strong>Saved for later</strong> (kept, not cited yet).
        </li>
        <li>
          Each entry’s menu: <strong>Cite at cursor</strong>, <strong>Show where it is cited</strong>,{' '}
          <strong>Open source</strong>, <strong>Copy BibTeX</strong>, <strong>Check against the registries</strong>,{' '}
          <strong>Edit details</strong> and <strong>Remove from sources</strong> (only once nothing cites it).
        </li>
        <li>
          An entry typed, imported or edited by hand says <strong>Entered by hand</strong>: it has not been checked
          against a registry.
        </li>
      </ul>

      <h2 id="reference-marks">Reference marks</h2>
      <p>
        A record carries what the registries say about the work. The marks show on the entry, in the reference list and in
        the exports:
      </p>
      <table>
        <thead>
          <tr>
            <th>Mark</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Retracted, Withdrawn</td>
            <td>The work was retracted or withdrawn; the notice is linked</td>
          </tr>
          <tr>
            <td>Expression of concern</td>
            <td>The publisher has published a concern about it</td>
          </tr>
          <tr>
            <td>Corrected</td>
            <td>A correction was published</td>
          </tr>
          <tr>
            <td>Needs review</td>
            <td>The registries disagree on its details, or only one knows the work</td>
          </tr>
          <tr>
            <td>Not found</td>
            <td>No registry knows its identifier</td>
          </tr>
          <tr>
            <td>Preprint</td>
            <td>Not peer reviewed</td>
          </tr>
          <tr>
            <td>Published version</td>
            <td>A preprint whose published version is known, with its DOI</td>
          </tr>
        </tbody>
      </table>

      <h2 id="bibtex">BibTeX</h2>
      <p>
        The <strong>BibTeX import and export</strong> menu in Sources has <strong>Export .bib</strong> and{' '}
        <strong>Import BibTeX…</strong>: paste entries from Zotero, Mendeley, Google Scholar or a .bib file, or choose
        the file. Imported entries are marked Entered by hand; check them against the registries from each entry’s menu.
        Viewers can export only.
      </p>
    </>
  ),

  'reference-check': (
    <>
      <p>
        <strong>Check references</strong> audits every reference on the page against the scholarly registries. It reports
        retracted, out-of-date, duplicate and missing references, and proposes a refresh for out-of-date records. It never
        deletes a reference or changes a citation.
      </p>
      <Facts
        rows={[
          [
            'Where',
            <>
              <strong>Check references</strong> at the top of the Sources panel, or in the export dialog
            </>,
          ],
          ['Who', 'Editors and above run it; everyone sees the results'],
          ['Needs', 'Outside research allowed in the workspace, for the lookups'],
        ]}
      />

      <h2 id="run-the-check">Run the check</h2>
      <ol>
        <li>
          Open <strong>Sources</strong> and choose <strong>Check references</strong>. The page is saved first.
        </li>
        <li>
          The summary reads, for example, “Checked 16 Nov: 1 retracted · 2 out of date · 1 duplicate”, or “nothing to
          fix”.
        </li>
        <li>
          Each affected entry shows its findings. Out-of-date records come back as a suggestion on the page (“Suggested
          sources”), which you accept or reject: see <a href="suggestions.html">Suggestions and Auto</a>.
        </li>
      </ol>

      <h2 id="findings">Findings</h2>
      <table>
        <thead>
          <tr>
            <th>Finding</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Out of date</td>
            <td>The registries now give its title, authors, year, state or notices otherwise. A refresh is proposed.</td>
          </tr>
          <tr>
            <td>Duplicate</td>
            <td>The same work as another entry, under another key</td>
          </tr>
          <tr>
            <td>Not in sources</td>
            <td>Cited, but the page’s sources hold no entry for it</td>
          </tr>
          <tr>
            <td>Identifier mismatch</td>
            <td>The identifier leads to another work</td>
          </tr>
          <tr>
            <td>Not found</td>
            <td>No registry knows its identifier</td>
          </tr>
        </tbody>
      </table>
      <p>
        Retractions and other marks show from the record itself, before any check: see{' '}
        <a href="citations.html#reference-marks">Citations and references</a>.
      </p>

      <h2 id="before-export">Before you export</h2>
      <p>
        The export dialog lists the retracted works, those not verified and the citations with no entry in the sources,
        from the last check (or from the page’s own records if it was never checked), with{' '}
        <strong>Check references</strong>. It does not stop the export.
      </p>
      <Note>
        <p>
          Where the workspace switched outside research off, nothing is looked up: the panel says so, and you can still
          add and edit sources by hand. The check is logged in the page’s <a href="export.html#ai-use">AI use</a>.
        </p>
      </Note>
    </>
  ),

  'paper-search': (
    <>
      <p>
        Paper search asks OpenAlex, the arXiv index and Semantic Scholar together and merges what they find, so each work
        is one result with one record. Follow who cites a paper, read its abstract, and cite it into the page.
      </p>
      <Facts
        rows={[
          [
            'Where',
            <>
              <strong>Research</strong> in the top bar → <strong>Papers</strong>
            </>,
          ],
          ['Who', 'Every member, viewers included'],
          [
            'Needs',
            <>
              The <strong>Papers</strong> switch, at least one paper source, and outside research allowed in the workspace
            </>,
          ],
        ]}
      />

      <h2 id="search">Search</h2>
      <ol>
        <li>
          Open <strong>Research</strong>, choose <strong>Papers</strong> under Search in, type a topic and press{' '}
          <kbd>Enter</kbd>.
        </li>
        <li>
          <strong>Filters</strong>: <strong>From year</strong>, <strong>To year</strong>, <strong>Kind</strong> (Any,
          Articles, Reviews, Preprints), <strong>Order</strong> (Most relevant, Most recent, Most cited),{' '}
          <strong>Open-access papers only</strong> and <strong>Results per search</strong> (20 by default).
        </li>
        <li>
          <strong>Load more papers</strong> continues the list.
        </li>
      </ol>

      <h2 id="results">Results</h2>
      <ul>
        <li>
          Each result shows its title, authors, year, venue, citation count, its marks (retracted, preprint…) and which
          source found it. <strong>Show more</strong> reads the abstract.
        </li>
        <li>
          <strong>Cite</strong> inserts it at the caret; <strong>Add to sources</strong> keeps it for later.
        </li>
        <li>
          Its <strong>…</strong> menu opens the DOI or an open-access copy, and follows the citation graph:{' '}
          <strong>Papers citing this</strong>, <strong>Its references</strong> and <strong>Related papers</strong>.
        </li>
        <li>When a source cannot be reached, the results say which one is missing.</li>
      </ul>

      <h2 id="search-inside-pdfs">Search inside your PDFs</h2>
      <p>
        <strong>Inside my PDFs</strong>, the third option under Search in, searches every PDF you uploaded word for word.
        The matches open in the Library: see <a href="library.html#search">PDF library</a>.
      </p>

      <h2 id="when-unavailable">When paper search is unavailable</h2>
      <p>The Research panel names the reason:</p>
      <ul>
        <li>
          your <strong>Papers</strong> switch is off, or every paper source is (
          <a href="assistant-settings.html#capability-switches">AI and tools settings</a>);
        </li>
        <li>
          the workspace switched <strong>Outside research</strong> off (
          <a href="members.html#workspace-policy">Members, roles and policy</a>);
        </li>
        <li>the server has no paper source configured.</li>
      </ul>
      <Note>
        <p>
          The assistant’s own paper searches use the same sources and records, so a work reads the same in a reply, in
          Research and in the citation editor.
        </p>
      </Note>
    </>
  ),

  'claim-check': (
    <>
      <p>
        Claim check judges one sentence against passages from papers and says how far they support it. Find citations
        looks for works to cite for each sentence of a selection, with the passage each would rest on. Neither changes
        the page until you say so.
      </p>
      <Facts
        rows={[
          [
            'Where',
            <>
              Research → <strong>Check a claim</strong>; the toolbar’s <strong>Check this claim</strong> and{' '}
              <strong>Find citations</strong>
            </>,
          ],
          ['Who', 'Every member for claim checks; editors insert citations'],
          ['Needs', 'Paper search available: see Paper search'],
        ]}
      />

      <h2 id="check-a-claim">Check a claim</h2>
      <ol>
        <li>
          Open <strong>Research</strong>, choose <strong>Check a claim</strong>, and write one claim. Or select the
          sentence and choose <strong>…</strong> → <strong>Check this claim</strong> in the formatting toolbar.
        </li>
        <li>
          Tick <strong>Against the works this page cites</strong> to judge it only against your references (up to ten);
          otherwise the paper sources are searched.
        </li>
        <li>Read the verdict and each passage.</li>
      </ol>
      <table>
        <thead>
          <tr>
            <th>Verdict</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Supported</td>
            <td>A passage bears the claim out.</td>
          </tr>
          <tr>
            <td>Partly supported</td>
            <td>The source’s scope is narrower than the claim.</td>
          </tr>
          <tr>
            <td>Contradicted</td>
            <td>A passage says otherwise.</td>
          </tr>
          <tr>
            <td>Not settled</td>
            <td>The passages do not settle it either way.</td>
          </tr>
          <tr>
            <td>Cannot assess without the full text</td>
            <td>Only abstracts were available. Attach the paper’s PDF, or find an open-access copy, and check again.</td>
          </tr>
        </tbody>
      </table>
      <p>
        The card says what it was judged on (Full text, Abstract only, A snippet or Metadata only), and gives each passage
        its stance (Supports, Narrows the claim, Contradicts, Unrelated), its place in the paper and the work’s marks, with{' '}
        <strong>Cite</strong> and <strong>Add to sources</strong>. The assistant shows the same card when it checks a
        claim in a reply.
      </p>

      <h2 id="find-citations">Find citations</h2>
      <ol>
        <li>
          Select one or more sentences of a paragraph, then choose <strong>…</strong> → <strong>Find citations</strong> in
          the formatting toolbar.
        </li>
        <li>
          For each sentence (up to eight), the dialog offers up to three works, each with the passage it would rest on and
          its marks. Sentences under five words, or already cited, are skipped.
        </li>
        <li>
          Tick the works to cite. Nothing is ticked for you. Choose <strong>Insert</strong>.
        </li>
      </ol>
      <p>
        Each sentence gets one citation before its closing punctuation, and new works join the page’s sources, all in one
        undo step. A sentence edited while the search ran is left as it is, and the toast says so.
      </p>
    </>
  ),

  library: (
    <>
      <p>
        The Library holds the workspace’s PDFs. Each PDF lives in one place: on a page, in a collection, or Unfiled. That
        place, and the collections a page uses, decide which PDFs each page’s assistant can read.
      </p>
      <Facts
        rows={[
          [
            'Open',
            <>
              <strong>Library</strong> at the bottom of the sidebar (<kbd>Mod</kbd> <kbd>Shift</kbd> <kbd>L</kbd>), or the
              Library tab
            </>,
          ],
          ['Who', 'Everyone reads; editors and above upload, move and rename'],
          ['Ready to read', 'Once a PDF is converted to text'],
        ]}
      />

      <h2 id="upload">Upload PDFs</h2>
      <ol>
        <li>
          Open the Library. The upload control says where new files go (“Upload to: this page”, a collection, or
          Unfiled).
        </li>
        <li>Choose the files or drop them on it.</li>
        <li>Wait for the conversion: the assistant reads a PDF once it is Ready.</li>
      </ol>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Queued, Converting</td>
            <td>Being converted to text. A long paper takes longer.</td>
          </tr>
          <tr>
            <td>Ready</td>
            <td>The assistant can read and quote it.</td>
          </tr>
          <tr>
            <td>Failed</td>
            <td>
              Conversion did not finish. <strong>Convert now</strong> usually works.
            </td>
          </tr>
          <tr>
            <td>No text</td>
            <td>No text layer, usually a scan. Retrying will not help.</td>
          </tr>
        </tbody>
      </table>
      <p>A PDF attached to a chat message and uploaded there is filed on the open page.</p>

      <h2 id="which-pdfs-a-page-reads">Which PDFs a page reads</h2>
      <p>
        <strong>Used by this page</strong> lists them, grouped by why:
      </p>
      <ul>
        <li>
          <strong>On this page</strong>: PDFs filed on the page.
        </li>
        <li>
          <strong>In</strong> a collection the page uses, and the collections inside it.
        </li>
        <li>
          <strong>Used via</strong> a collection whose <strong>Pages here can use these PDFs</strong> is on, while the
          page is in it.
        </li>
        <li>
          <strong>Unfiled</strong>: every page’s assistant can read these.
        </li>
      </ul>
      <p>
        <strong>Use PDFs from a collection…</strong> (or <strong>Use on this page</strong> on a collection) lets the page
        read a collection’s PDFs; <strong>Stop using</strong> undoes it. When a page sits in a collection with PDFs, the
        assistant may offer “Use this collection’s PDFs on this page?”: it reads them only if you say so.
      </p>

      <h2 id="organise">Organise</h2>
      <ul>
        <li>
          <strong>Browse</strong> shows every collection, <strong>Unfiled</strong> and <strong>All PDFs</strong>.
        </li>
        <li>
          Open a PDF for <strong>Open PDF</strong>, rename, <strong>Move to…</strong> a collection, Unfiled or this page,
          and the conversion status.
        </li>
        <li>A collection’s menu adds sub-collections, renames, moves or trashes it.</li>
      </ul>

      <h2 id="search">Search</h2>
      <p>
        <strong>Names</strong> filters by file name. <strong>Inside PDFs</strong> searches the converted text word for
        word (press <kbd>Enter</kbd>) and shows each match in context; try a shorter phrase if nothing matches.
      </p>
      <Note>
        <p>
          A PDF in the Trash is out of every page’s reach until restored. Copying a page to another workspace can take its
          PDFs along: see <a href="workspaces.html#copy-to-another-workspace">Workspaces, collections and Trash</a>.
        </p>
      </Note>
    </>
  ),
} satisfies Partial<Record<DocSlug, ReactNode>>;
