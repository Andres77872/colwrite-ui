import type { ReactNode } from 'react';
import type { DocSlug } from '../catalog';
import { Facts, Note } from '../kit';

// Rendered inside the Vite config process (vite.docs.ts): relative imports
// only, never `@/`. Labels are the app's own, word for word.

export const startDocs = {
  'quick-start': (
    <>
      <p>
        ColWrite is a writing workspace for research papers: a block editor with citations, equations, tables and
        figures, an assistant that works on the page and cites what it finds, and review tools for a team. This page
        takes you from signing in to a cited page you can export.
      </p>
      <Facts
        rows={[
          ['Accounts', 'Invite-only during the alpha. Sign in with the credentials you were given.'],
          ['Your work', 'Every page belongs to a workspace. Your personal workspace comes with your account.'],
          ['Saving', 'Automatic. The top bar shows whether the page is saved.'],
        ]}
      />

      <h2 id="write-a-page">Write a page</h2>
      <ol>
        <li>
          Choose <strong>New page</strong> in the left sidebar (<kbd>Mod</kbd> <kbd>Alt</kbd> <kbd>N</kbd>).
        </li>
        <li>Type a title, then press <kbd>Enter</kbd> and write the first paragraph.</li>
        <li>
          On an empty line, type <code>/</code> and choose <strong>Heading 1</strong>, or type <code>#</code> and a
          space. Every block type is in the <code>/</code> menu: see <a href="editor.html">Editor and blocks</a>.
        </li>
        <li>
          Watch the save status in the top bar: <strong>Unsaved</strong> becomes <strong>Saving…</strong>, then{' '}
          <strong>Saved</strong>. <kbd>Mod</kbd> <kbd>S</kbd> saves at once.
        </li>
      </ol>

      <h2 id="cite-a-source">Cite a source</h2>
      <ol>
        <li>
          Place the cursor where the citation belongs, or select the sentence, and choose <strong>Cite</strong> in the
          formatting toolbar. On an empty line, <code>/</code> → <strong>Citation</strong> does the same.
        </li>
        <li>
          Search by title, or paste a DOI or an arXiv id, and choose <strong>Add</strong> on the work.
        </li>
        <li>
          The citation appears in the page’s citation style, and the work joins the reference list at the end of the
          page. See <a href="citations.html">Citations and references</a>.
        </li>
      </ol>

      <h2 id="ask-the-assistant">Ask the assistant</h2>
      <ol>
        <li>
          Choose <strong>Ask AI</strong> in the top bar (<kbd>Mod</kbd> <kbd>Shift</kbd> <kbd>J</kbd>) to open the
          assistant beside the page.
        </li>
        <li>Ask about the page, or ask for an edit: “Tighten the abstract to 150 words.”</li>
        <li>
          Edits arrive as suggestions on the page. Accept or reject each one: see{' '}
          <a href="suggestions.html">Suggestions and Auto</a>.
        </li>
      </ol>
      <p>
        For a quick rewrite of a passage, select it and choose <strong>Ask AI</strong> in the toolbar (
        <kbd>Mod</kbd> <kbd>J</kbd>): see <a href="ask-ai.html">Ask AI and AI beats</a>.
      </p>

      <h2 id="export-the-page">Export the page</h2>
      <p>
        Open <strong>Page options</strong> (the <strong>…</strong> at the right of the top bar) and choose{' '}
        <strong>Export…</strong>. Pick PDF, Standalone HTML, Markdown or LaTeX. See{' '}
        <a href="export.html">Export and AI use</a>, or read the <a href="/examples/?view=paper">sample paper</a> as the
        HTML export writes it.
      </p>

      <h2 id="next">Next</h2>
      <ul>
        <li>
          <a href="interface.html">The interface</a>: every panel, menu and shortcut.
        </li>
        <li>
          <a href="workspaces.html">Workspaces, collections and Trash</a>: organise pages and share a workspace.
        </li>
        <li>
          <a href="paper-search.html">Paper search</a>: find the literature without leaving the page.
        </li>
      </ul>
    </>
  ),

  interface: (
    <>
      <p>
        The app has three parts: the left sidebar (your workspace and its pages), the page with its top bar, and the
        right sidebar (the assistant and the tools that work on the page).
      </p>
      <Facts
        rows={[
          [
            'Shortcuts',
            <>
              <kbd>Mod</kbd> is <kbd>⌘</kbd> on a Mac and <kbd>Ctrl</kbd> elsewhere. <kbd>Mod</kbd> <kbd>/</kbd> lists
              every shortcut.
            </>,
          ],
          [
            'Search',
            <>
              <kbd>Mod</kbd> <kbd>K</kbd> opens the palette: pages, headings on this page, commands and panels.
            </>,
          ],
          [
            'Sidebars',
            <>
              <kbd>Mod</kbd> <kbd>\</kbd> shows or hides the left sidebar, <kbd>Mod</kbd> <kbd>Shift</kbd>{' '}
              <kbd>\</kbd> the right one. The right sidebar sits beside the page from 768 px wide.
            </>,
          ],
        ]}
      />

      <h2 id="left-sidebar">The left sidebar</h2>
      <ul>
        <li>
          <strong>The workspace menu</strong> at the top: switch workspace, <strong>New workspace…</strong>,{' '}
          <strong>Workspace settings</strong>, <strong>Members</strong> and <strong>Invite people…</strong> in a shared
          workspace, <strong>Appearance</strong>, <strong>Docs</strong>, <strong>Keyboard shortcuts</strong> and{' '}
          <strong>Sign out</strong>.
        </li>
        <li>
          <strong>Search</strong>, <strong>Ask AI</strong> and <strong>New page</strong> (editors and above).
        </li>
        <li>
          <strong>Recent</strong>: the pages you opened last.
        </li>
        <li>
          <strong>Pages</strong>: the workspace’s collections and pages as a tree. The <strong>+</strong> menu adds a{' '}
          <strong>New page</strong> or a <strong>New collection</strong>; the <strong>…</strong> menu filters the
          pages, refreshes them and, for admins, sorts the top level. Each row has its own menu: see{' '}
          <a href="workspaces.html">Workspaces, collections and Trash</a>.
        </li>
        <li>
          At the bottom: <strong>Library</strong> (the workspace’s PDFs), <strong>Trash</strong> (with a count) and{' '}
          <strong>Settings</strong>.
        </li>
      </ul>

      <h2 id="top-bar">The top bar</h2>
      <p>
        From left to right: the breadcrumb (where the page lives), the save status, the suggestions count when the
        assistant has proposed edits, <strong>Ask AI</strong>, then <strong>Research</strong>,{' '}
        <strong>Sources</strong>, <strong>History</strong> and <strong>Page options</strong>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Save status</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Unsaved</td>
            <td>Edits not sent yet. They are saved automatically in a few seconds.</td>
          </tr>
          <tr>
            <td>Saving…</td>
            <td>Sending the edits.</td>
          </tr>
          <tr>
            <td>Saved</td>
            <td>The server has the page as you see it. Hover for the time.</td>
          </tr>
          <tr>
            <td>Saved locally</td>
            <td>A new page that is not on the server yet.</td>
          </tr>
          <tr>
            <td>Not saved</td>
            <td>
              The save failed. Hover for the reason and choose <strong>Retry</strong>.
            </td>
          </tr>
          <tr>
            <td>In the Trash</td>
            <td>The page is in the Trash and takes no edits until it is restored.</td>
          </tr>
          <tr>
            <td>View only</td>
            <td>You are a viewer in this workspace: you can read and ask the assistant, not edit.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="right-sidebar">The right sidebar</h2>
      <p>Its tabs, in order:</p>
      <table>
        <thead>
          <tr>
            <th>Tab</th>
            <th>What it is for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>AI</td>
            <td>
              Ask about this page, draft and revise it with AI. See <a href="assistant.html">Assistant chat</a>.
            </td>
          </tr>
          <tr>
            <td>Research</td>
            <td>
              Find papers, check a claim or search inside your PDFs. See <a href="paper-search.html">Paper search</a>.
            </td>
          </tr>
          <tr>
            <td>Review</td>
            <td>
              Run a review and step through shared comments. See <a href="reviews.html">Reviews and comments</a>.
            </td>
          </tr>
          <tr>
            <td>Library</td>
            <td>
              Your PDFs: what this page uses, every collection, and search inside them. See{' '}
              <a href="library.html">PDF library</a>.
            </td>
          </tr>
          <tr>
            <td>Sources</td>
            <td>
              What this page cites and keeps. See <a href="citations.html">Citations and references</a>.
            </td>
          </tr>
          <tr>
            <td>History</td>
            <td>
              Saved versions of this page. See <a href="history.html">Version history</a>.
            </td>
          </tr>
          <tr>
            <td>JSON</td>
            <td>
              Shown only when opened from <strong>Page options</strong> → <strong>Document JSON</strong>.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="page-options">Page options</h2>
      <p>
        The <strong>…</strong> at the right of the top bar. Items marked † are left out for viewers.
      </p>
      <ul>
        <li>
          <strong>Copy link</strong>, <strong>Move to…</strong>†, <strong>Copy to workspace…</strong>†
        </li>
        <li>
          <strong>Export…</strong>, <strong>Version history</strong>, <strong>AI use…</strong> (once the page is saved)
        </li>
        <li>
          <strong>Assistant instructions…</strong>†: see{' '}
          <a href="assistant-settings.html#assistant-instructions">AI and tools settings</a>
        </li>
        <li>
          <strong>Document JSON</strong>: the page’s raw structure, for developers
        </li>
        <li>
          <strong>Citation style</strong>†: Auto or one of eight styles
        </li>
        <li>
          <strong>Style</strong>: <strong>Full width</strong> and <strong>Small text</strong>
        </li>
        <li>
          <strong>Undo</strong> and <strong>Redo</strong>†, <strong>Move to Trash</strong>†
        </li>
      </ul>
      <p>On a phone, the menu also opens Research and Sources.</p>

      <h2 id="command-palette">The command palette</h2>
      <p>
        <kbd>Mod</kbd> <kbd>K</kbd> (or <kbd>Mod</kbd> <kbd>P</kbd>) opens it. Type to search pages, the headings of the
        open page and commands. Its groups: <strong>Recent</strong>, <strong>On this page</strong>,{' '}
        <strong>Pages</strong>, <strong>Switch workspace</strong>, <strong>Commands</strong> and{' '}
        <strong>Panels</strong>. Commands include <strong>New page</strong>, <strong>New collection</strong>,{' '}
        <strong>Move page to…</strong>, <strong>Library</strong>, <strong>Trash</strong>,{' '}
        <strong>Open assistant</strong>, <strong>Settings</strong>, <strong>Workspace settings</strong>,{' '}
        <strong>Members</strong>, <strong>Invite people…</strong> and <strong>New workspace…</strong>, each shown only
        where your role allows it.
      </p>

      <h2 id="keyboard-shortcuts">Keyboard shortcuts</h2>
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Keys</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Search pages and commands</td>
            <td>
              <kbd>Mod</kbd> <kbd>K</kbd> or <kbd>Mod</kbd> <kbd>P</kbd>
            </td>
          </tr>
          <tr>
            <td>New page</td>
            <td>
              <kbd>Mod</kbd> <kbd>Alt</kbd> <kbd>N</kbd>
            </td>
          </tr>
          <tr>
            <td>Save now</td>
            <td>
              <kbd>Mod</kbd> <kbd>S</kbd>
            </td>
          </tr>
          <tr>
            <td>Undo / redo</td>
            <td>
              <kbd>Mod</kbd> <kbd>Z</kbd> / <kbd>Mod</kbd> <kbd>Shift</kbd> <kbd>Z</kbd> or <kbd>Mod</kbd> <kbd>Y</kbd>
            </td>
          </tr>
          <tr>
            <td>Show keyboard shortcuts</td>
            <td>
              <kbd>Mod</kbd> <kbd>/</kbd>
            </td>
          </tr>
          <tr>
            <td>Show or hide the left / right sidebar</td>
            <td>
              <kbd>Mod</kbd> <kbd>\</kbd> / <kbd>Mod</kbd> <kbd>Shift</kbd> <kbd>\</kbd>
            </td>
          </tr>
          <tr>
            <td>Open the Library</td>
            <td>
              <kbd>Mod</kbd> <kbd>Shift</kbd> <kbd>L</kbd>
            </td>
          </tr>
          <tr>
            <td>Rename the focused tree row / open its menu</td>
            <td>
              <kbd>F2</kbd> / <kbd>Shift</kbd> <kbd>F10</kbd>
            </td>
          </tr>
          <tr>
            <td>Move the focused tree row (custom order)</td>
            <td>
              <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>↑</kbd> / <kbd>↓</kbd>
            </td>
          </tr>
          <tr>
            <td>Show or hide the assistant</td>
            <td>
              <kbd>Mod</kbd> <kbd>Shift</kbd> <kbd>J</kbd>
            </td>
          </tr>
          <tr>
            <td>Ask AI on the block or selection</td>
            <td>
              <kbd>Mod</kbd> <kbd>J</kbd>
            </td>
          </tr>
          <tr>
            <td>Ask AI on an empty line</td>
            <td>
              <kbd>Space</kbd>
            </td>
          </tr>
          <tr>
            <td>Accept / reject the focused suggestion</td>
            <td>
              <kbd>Mod</kbd> <kbd>Enter</kbd> / <kbd>Mod</kbd> <kbd>Backspace</kbd>
            </td>
          </tr>
          <tr>
            <td>Step through review comments (Review open)</td>
            <td>
              <kbd>Alt</kbd> <kbd>↑</kbd> / <kbd>↓</kbd>
            </td>
          </tr>
          <tr>
            <td>Insert a block</td>
            <td>
              <kbd>/</kbd>
            </td>
          </tr>
          <tr>
            <td>Bold, italic, underline</td>
            <td>
              <kbd>Mod</kbd> <kbd>B</kbd> · <kbd>Mod</kbd> <kbd>I</kbd> · <kbd>Mod</kbd> <kbd>U</kbd>
            </td>
          </tr>
          <tr>
            <td>Add a link to the selection</td>
            <td>
              <kbd>Mod</kbd> <kbd>K</kbd>
            </td>
          </tr>
          <tr>
            <td>Paste as plain text</td>
            <td>
              <kbd>Mod</kbd> <kbd>Shift</kbd> <kbd>V</kbd>
            </td>
          </tr>
          <tr>
            <td>Move to the formatting toolbar</td>
            <td>
              <kbd>Alt</kbd> <kbd>F10</kbd>
            </td>
          </tr>
          <tr>
            <td>Select the block / duplicate it</td>
            <td>
              <kbd>Esc</kbd> / <kbd>Mod</kbd> <kbd>D</kbd>
            </td>
          </tr>
          <tr>
            <td>Move the block up or down</td>
            <td>
              <kbd>Mod</kbd> <kbd>Shift</kbd> <kbd>↑</kbd> / <kbd>↓</kbd>
            </td>
          </tr>
          <tr>
            <td>Indent or outdent a list item or code</td>
            <td>
              <kbd>Tab</kbd> / <kbd>Shift</kbd> <kbd>Tab</kbd>
            </td>
          </tr>
          <tr>
            <td>Turn selected blocks into another type</td>
            <td>
              <kbd>Mod</kbd> <kbd>Alt</kbd> <kbd>0</kbd>–<kbd>9</kbd>
            </td>
          </tr>
        </tbody>
      </table>
      <Note>
        <p>
          <kbd>Mod</kbd> <kbd>K</kbd> adds a link when text is selected in the page, and opens the palette everywhere
          else. <kbd>Mod</kbd> <kbd>J</kbd> opens Ask AI inside a block, and shows or hides the assistant elsewhere.
        </p>
      </Note>
    </>
  ),
} satisfies Partial<Record<DocSlug, ReactNode>>;
