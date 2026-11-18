import type { ReactNode } from 'react';
import type { DocSlug } from '../catalog';
import { Facts, Note } from '../kit';

// Rendered inside the Vite config process (vite.docs.ts): relative imports
// only, never `@/`. Labels are the app's own, word for word.

export const reviewDocs = {
  reviews: (
    <>
      <p>
        A review reads the saved page and leaves comments on exact passages: shared notes for the workspace, not changes
        to the page. Reviews give no score. A comment stays tied to the text it quotes.
      </p>
      <Facts
        rows={[
          [
            'Where',
            <>
              The <strong>Review</strong> tab of the right sidebar
            </>,
          ],
          ['Who', 'Every member can run a review and read comments. Editors and above resolve or dismiss them.'],
          ['Reads', 'The saved page as readers see it, without blocks hidden from the assistant'],
        ]}
      />

      <h2 id="run-a-review">Run a review</h2>
      <ol>
        <li>
          Open <strong>Review</strong>. The page must be saved.
        </li>
        <li>Pick the review type, then choose <strong>Run a review</strong>.</li>
        <li>
          The progress shows while it reads. <strong>Stop review</strong> ends it. Closing the panel does not: reopen it
          to follow the same review.
        </li>
      </ol>
      <table>
        <thead>
          <tr>
            <th>Review type</th>
            <th>Looks at</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Proofread</td>
            <td>Language, clarity and consistent terms, with small optional replacements</td>
          </tr>
          <tr>
            <td>Claims and evidence</td>
            <td>
              The claims that matter and their support: a missing citation, evidence from abstracts only, evidence that
              does not settle it, or a contradiction
            </td>
          </tr>
          <tr>
            <td>Sources</td>
            <td>Each reference: whether it exists, is the work cited, was retracted or has a published version; uncited entries</td>
          </tr>
          <tr>
            <td>Structure and guideline</td>
            <td>The order of the argument and what is missing, against the reporting guideline for the page’s type</td>
          </tr>
          <tr>
            <td>Peer review</td>
            <td>A constructive referee report, without language nitpicks, a score or a recommendation</td>
          </tr>
        </tbody>
      </table>
      <p>
        <strong>Settings → AI &amp; tools → My defaults → Starting review type</strong> chooses which type the panel
        offers first. The reviewer reads only the manuscript: not your chats, your profile or the assistant instructions.
        Before it reads, automatic checks run on reference status, citations with no entry, numbers in the abstract,
        abbreviations and mentions of figures and tables.
      </p>

      <h2 id="read-comments">Read the comments</h2>
      <ul>
        <li>
          Comments are grouped by kind: Claims, Sources, Structure, Clarity, Consistency, Language and Reporting
          guideline. Each has a severity: <strong>Must fix</strong>, <strong>Should fix</strong> or{' '}
          <strong>Consider</strong>.
        </li>
        <li>
          Click a comment’s quote to go to the passage, which is highlighted. Markers in the margin of the page lead to
          the comments as well.
        </li>
        <li>
          <kbd>Alt</kbd> <kbd>↑</kbd> / <kbd>↓</kbd> steps through them while the panel is open.
        </li>
        <li>
          The status menu shows <strong>Open</strong>, <strong>Resolved</strong> or <strong>Dismissed</strong> comments.
          Choose a past review to see only its comments; <strong>Show all reviews’ comments</strong> goes back.
        </li>
        <li>
          When the quoted text is edited away, the comment says <strong>Outdated · quote no longer present</strong>. It
          is never moved to a similar sentence.
        </li>
        <li>
          “Recorded sources” lists the works a comment names. A source is not proof of support.
        </li>
      </ul>

      <h2 id="resolve-comments">Resolve, dismiss, reopen</h2>
      <p>
        <strong>Resolve</strong> and <strong>Dismiss</strong> close a comment; <strong>Reopen</strong> brings it back.
        None of them changes the page.
      </p>
      <p>
        A language or clarity comment can come with a short replacement for its quote: <strong>Show suggested edit</strong>{' '}
        opens it as a suggestion on the page, which you accept or reject like any other (see{' '}
        <a href="suggestions.html">Suggestions and Auto</a>). It is never applied by itself, and viewers get the comment
        without it.
      </p>
      <Note>
        <p>
          Reviews and comments are kept apart from the page: they are not in its history, not copied with it, and a
          workspace export lists them separately.
        </p>
      </Note>
    </>
  ),

  history: (
    <>
      <p>
        Every save of a page is a version. History shows what each version changed and can switch the page back to an
        earlier one, without losing anything: the versions after it stay, as a branch.
      </p>
      <Facts
        rows={[
          [
            'Where',
            <>
              <strong>History</strong> in the top bar, or <strong>Page options → Version history</strong>
            </>,
          ],
          ['Who', 'Everyone reads history. Editors and above restore.'],
          ['Kept', 'Every saved version, including the ones you restored away from'],
        ]}
      />

      <h2 id="read-history">Read the history</h2>
      <p>Each row is a version, newest first, with what made it:</p>
      <table>
        <thead>
          <tr>
            <th>Label</th>
            <th>Made by</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Created</td>
            <td>The page’s first save</td>
          </tr>
          <tr>
            <td>Saved</td>
            <td>An autosave or a manual save</td>
          </tr>
          <tr>
            <td>Accepted suggestions</td>
            <td>Accepting the assistant’s suggestions</td>
          </tr>
          <tr>
            <td>Restored</td>
            <td>Switching back to an earlier version</td>
          </tr>
          <tr>
            <td>Renamed, Moved to trash, Imported, Migrated</td>
            <td>What the name says</td>
          </tr>
        </tbody>
      </table>
      <p>
        An <strong>AI</strong> tag marks a version the assistant made. <strong>Current</strong> marks the one the page is
        on. “N branches” means later versions branch away from this one.
      </p>

      <h2 id="compare-and-restore">Compare and restore</h2>
      <ol>
        <li>Select a version.</li>
        <li>
          <strong>This change</strong> shows what that version changed: blocks added, removed, changed or moved, and
          citations, equations, tables, charts and AI passages by name. <strong>Vs. current</strong> compares it with the
          page as it is.
        </li>
        <li>
          <strong>Restore</strong> switches the page to that version, after you confirm. A toast offers{' '}
          <strong>Undo</strong>.
        </li>
      </ol>
      <Note tone="warning">
        <p>
          Restoring discards the suggestions still waiting for review on the page; the confirmation says how many. Saving
          after a restore starts a new branch: the versions you left stay in the history.
        </p>
      </Note>

      <h2 id="save-conflicts">Save conflicts and edits kept on this device</h2>
      <p>
        When the page was changed somewhere else (another tab, another member) before your edits were saved, autosave
        stops and a bar asks which version to keep:
      </p>
      <ul>
        <li>
          <strong>Open the newer version</strong>: shows the saved page. Your edits stay on this device.
        </li>
        <li>
          <strong>Keep my version</strong>: saves your edits over it. The other version stays in History.
        </li>
      </ul>
      <p>
        Edits that never reached the server (the tab closed, the connection dropped) are kept on this device. When you
        open the page again, a bar offers <strong>Bring them back</strong> (Undo reverses it) or{' '}
        <strong>Discard</strong>.
      </p>

      <h2 id="document-json">Document JSON</h2>
      <p>
        <strong>Page options</strong> → <strong>Document JSON</strong> opens the page’s raw structure in the right sidebar: its title,
        blocks and inline content, as the server stores them. <strong>Copy</strong> copies it; <strong>Format</strong>{' '}
        tidies it. After editing, <strong>Apply to document</strong> replaces the page’s structure in the editor and{' '}
        <strong>Revert</strong> discards your edit. It is a developer tool: try it on a copy of the page.
      </p>
    </>
  ),
} satisfies Partial<Record<DocSlug, ReactNode>>;
