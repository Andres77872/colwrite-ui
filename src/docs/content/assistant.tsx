import type { ReactNode } from 'react';
import type { DocSlug } from '../catalog';
import { Facts, Note } from '../kit';

// Rendered inside the Vite config process (vite.docs.ts): relative imports
// only, never `@/`. Labels are the app's own, word for word.

export const assistantDocs = {
  assistant: (
    <>
      <p>
        The assistant works on the open page. It reads the page, searches papers, the web and your PDFs, and cites what
        it finds. It drafts edits that arrive as suggestions for you to accept. Each page keeps its own chats.
      </p>
      <Facts
        rows={[
          [
            'Open',
            <>
              <strong>Ask AI</strong> in the top bar, or the <strong>AI</strong> tab (<kbd>Mod</kbd> <kbd>Shift</kbd>{' '}
              <kbd>J</kbd>)
            </>,
          ],
          ['Who', 'Every member. Viewers can ask; the assistant changes nothing for them.'],
          ['Saves first', 'Asking saves the page, so the assistant reads what you see'],
        ]}
      />

      <h2 id="ask">Ask</h2>
      <ol>
        <li>
          Open the assistant. The home screen offers <strong>Review this page</strong> and{' '}
          <strong>Tighten this page</strong>, and suggestions such as <strong>Find related work</strong> or{' '}
          <strong>Check my citations</strong>.
        </li>
        <li>
          Type your message (up to 2,000 characters). Type <code>#</code>, or use the <strong>#</strong> button, to
          point at a block of this page or another page. Text you selected on the page goes with the message; its chip
          lets you leave it out.
        </li>
        <li>
          Press <kbd>Enter</kbd> to send. <strong>Stop generating</strong> (<kbd>Esc</kbd>) ends the reply.
        </li>
      </ol>

      <h2 id="attachments">Attach PDFs and images</h2>
      <p>
        <strong>Attach images or PDFs</strong> adds up to 8 files to a message: upload them, drop or paste them, or{' '}
        <strong>Choose a PDF from the Library</strong>. A PDF uploaded here is filed on the open page and kept in the
        Library. Images can be PNG, JPEG, WebP or GIF, up to 25 MB each.
      </p>
      <p>
        An attached PDF can be read by this conversation wherever it is filed; attaching it does not move it or let the
        page’s other conversations read it. Viewers cannot upload, but can attach a PDF from the Library.
      </p>

      <h2 id="effort">Effort</h2>
      <p>
        The effort menu in the composer sets how much a reply may do in this conversation. Each level has limits on model
        calls, tool calls, time and cost; the menu shows its cost ceiling and time limit.
      </p>
      <table>
        <thead>
          <tr>
            <th>Effort</th>
            <th>For</th>
            <th>Up to</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Quick</td>
            <td>A lookup, a small edit</td>
            <td>$1.00 · 5 min · no research workers</td>
          </tr>
          <tr>
            <td>Standard</td>
            <td>A focused question, a section, a claim check (the default)</td>
            <td>$5.00 · 20 min · 3 workers</td>
          </tr>
          <tr>
            <td>Deep</td>
            <td>A literature review, a report, a full review. Starts from a plan you approve.</td>
            <td>$20.00 · 60 min · 6 workers</td>
          </tr>
        </tbody>
      </table>
      <p>
        A reply that reaches a limit answers with what it has and says so (“Stopped at its limit”). While it runs, a
        quiet line warns when two thirds of a limit is used.
      </p>

      <h2 id="web-search">Web search</h2>
      <p>
        The <strong>Web search</strong> switch in the composer lets the assistant search and read public web pages in this
        conversation. It starts off in every conversation, and appears only where Web is allowed: your{' '}
        <a href="assistant-settings.html#capability-switches">Web switch</a> and the workspace’s policy. Paper search has
        its own setting.
      </p>

      <h2 id="replies">Read a reply</h2>
      <ul>
        <li>
          While it works, the reply shows its thinking, each tool it runs (“Searching papers…”), its task list and its
          research workers.
        </li>
        <li>
          <code>[1]</code> markers cite its sources. Hover one for the work, click it to jump to the source list under the
          reply. Each source names where it came from (OpenAlex, Semantic Scholar, the arXiv index, Web, Your PDF…) and
          has <strong>Cite</strong> and <strong>Add to sources</strong>.
        </li>
        <li>
          A claim it checked shows as a claim card: see <a href="claim-check.html">Claim check</a>.
        </li>
        <li>
          Actions: <strong>Copy</strong> (with the sources as a list), <strong>Insert into page</strong> (below where you
          were writing, or at the end), <strong>Retry</strong> (the latest reply) and <strong>Review N changes</strong>{' '}
          when it proposed edits.
        </li>
        <li>
          The details line shows when it answered, how long it took and its tokens. Its popover adds the model, any
          fallback model, tokens in, out and cached, and the cost against the reply’s ceiling.
        </li>
      </ul>

      <h2 id="plans">Deep: plans</h2>
      <ol>
        <li>
          Choose <strong>Deep</strong> and ask. The first reply proposes a <strong>Plan</strong>: a brief, up to 20
          sections with their goals and sources, and open questions.
        </li>
        <li>
          Edit the plan in place: the brief, each section (move, remove, <strong>Add a section</strong>), the questions.{' '}
          <strong>Save plan changes</strong> keeps them; <strong>Discard plan</strong> drops it.
        </li>
        <li>
          <strong>Start writing</strong> writes the plan section by section. Each section arrives as its own suggestions;
          the plan shows “N/M sections proposed for review”.
        </li>
        <li>
          If it stops, <strong>Continue writing</strong> skips the sections already proposed.
        </li>
      </ol>
      <p>
        The assistant can also ask you <strong>A few questions</strong> before it goes on: answer what matters,{' '}
        <strong>Go with your best guess</strong>, or keep writing in the composer.
      </p>

      <h2 id="chats-and-runs">Chats and runs</h2>
      <ul>
        <li>
          The chat title in the panel’s header lists this page’s chats: search, rename, delete, <strong>New chat</strong>
          . Chats are private to their author.
        </li>
        <li>
          <strong>Runs</strong> lists your assistant runs in this workspace. <strong>Resume</strong> continues an
          interrupted Deep run from its saved checkpoint.
        </li>
        <li>Closing the panel does not stop a reply: reopen it to follow the reply.</li>
      </ul>

      <h2 id="research-workers">Research workers</h2>
      <p>
        With the <strong>Research workers</strong> switch on, a Standard or Deep reply can split reading across helpers:
        a Web researcher (which never sees the page), a Library reader (nothing leaves ColWrite) and a Reviewer (checks a
        drafted section against passages). They use more of the reply’s budget. Quick never starts them.
      </p>
    </>
  ),

  'ask-ai': (
    <>
      <p>
        Ask AI is a one-shot request on a selection, a block or an empty line: rewrite, shorten, translate, explain,
        draft. The result appears in place, and you decide what to do with it. It keeps no chat.
      </p>
      <Facts
        rows={[
          [
            'Open',
            <>
              Select text and choose <strong>Ask AI</strong>, or <kbd>Mod</kbd> <kbd>J</kbd> in a block, or{' '}
              <kbd>Space</kbd> on an empty line
            </>,
          ],
          ['Works on', 'A selection (up to 4,000 characters), a block, up to 20 blocks, or an empty line'],
          ['Viewers', 'Can ask and copy the result, not insert it'],
        ]}
      />

      <h2 id="use-ask-ai">Use it</h2>
      <ol>
        <li>Select the text, or put the caret in the block.</li>
        <li>
          Open Ask AI. Pick an action, type to filter them (“Translate: Spanish”), or type your own request and press{' '}
          <kbd>Enter</kbd>.
        </li>
        <li>
          Read the result, then choose <strong>Replace selection</strong> (<kbd>Mod</kbd> <kbd>Enter</kbd>),{' '}
          <strong>Insert below</strong>, <strong>Insert as note</strong> (a callout), <strong>Try again</strong> or{' '}
          <strong>Discard</strong> (<kbd>Esc</kbd>). Type a follow-up to refine it.
        </li>
      </ol>
      <p>Locked blocks are never replaced: the result goes below them. A block hidden from the assistant cannot be asked about.</p>

      <h2 id="actions">Actions</h2>
      <table>
        <thead>
          <tr>
            <th>Group</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Edit or review</td>
            <td>
              Improve writing, Fix spelling &amp; grammar, Make shorter, Make longer, Simplify language, Change tone
              (Academic, Professional, Confident, Neutral, Friendly), Translate (English, Spanish, French, German,
              Portuguese, Italian, Chinese (Simplified), Japanese), Turn into bullet points, Turn into a table
            </td>
          </tr>
          <tr>
            <td>Generate</td>
            <td>Continue writing, Summarize, Explain this, Summarize the page</td>
          </tr>
          <tr>
            <td>Research</td>
            <td>Check the claims, Find counterarguments</td>
          </tr>
          <tr>
            <td>Write (empty line)</td>
            <td>Draft an outline, Write an introduction, Write an abstract, Brainstorm ideas</td>
          </tr>
        </tbody>
      </table>
      <p>
        Explain, Check the claims and Find counterarguments answer as a note; Continue writing and Summarize insert;
        the rest replace the text. An action the server cannot run here is shown disabled with the reason. On a figure,
        Ask AI offers the figure actions: see <a href="diagrams-figures.html#ask-ai-on-a-figure">Diagrams and figures</a>.
      </p>

      <h2 id="toolbar-actions">From the formatting toolbar</h2>
      <p>
        The toolbar’s <strong>…</strong> (More AI actions) lists the same rewrites, and research actions:{' '}
        <strong>Search papers for this</strong>, and, where paper search is on, <strong>Find citations</strong> and{' '}
        <strong>Check this claim</strong> (see <a href="claim-check.html">Claim check and Find citations</a>).
      </p>

      <h2 id="ai-beats">AI beats</h2>
      <p>
        An AI passage (<code>/</code> → <strong>AI passage</strong>, called an AI beat in settings and exports) keeps a
        request and its draft in the paragraph until you place it. When you choose <strong>Insert into text</strong>, the
        draft replaces the panel and its sources join the page, in one undo step. See{' '}
        <a href="editor.html#ai-passages">Editor and blocks</a>.
      </p>
      <Note>
        <p>
          Ask AI and AI beats run at Quick effort, read only their target and the page around it, and never use Auto.
          Their engine is set apart from the chat’s, in <strong>Settings → AI &amp; tools</strong>.
        </p>
      </Note>
    </>
  ),

  suggestions: (
    <>
      <p>
        The assistant never edits the page by itself. Each edit it proposes is a suggestion shown in the page: you accept
        or reject each change, and accepting one is an ordinary edit you can undo. Auto, when you turn it on, applies them
        for you.
      </p>
      <Facts
        rows={[
          ['Where', 'In the page, with the suggestions count in the top bar'],
          ['Who decides', 'Editors, admins and owners. Viewers see suggestions but cannot decide them.'],
          [
            'Keys',
            <>
              <kbd>Mod</kbd> <kbd>Enter</kbd> accepts, <kbd>Mod</kbd> <kbd>Backspace</kbd> rejects the focused change
            </>,
          ],
        ]}
      />

      <h2 id="review-changes">Review changes</h2>
      <ol>
        <li>
          Choose the <strong>N suggestions</strong> count in the top bar, or <strong>Review N changes</strong> under the
          reply. <strong>Previous change</strong> and <strong>Next change</strong> step through them.
        </li>
        <li>
          Each change is a card in place: a suggested addition, rewrite, deletion, move, title, sources or citation style,
          with the old and the new text.
        </li>
        <li>
          Choose <strong>Accept</strong> or <strong>Reject</strong> on each. Decisions are saved as you make them, so
          another device or a reload offers only what is left.
        </li>
      </ol>
      <p>
        The count’s menu groups changes as Wording, Structure, Citations and New content, with{' '}
        <strong>Accept wording changes</strong>, <strong>Accept without new information</strong>,{' '}
        <strong>Accept all</strong> and <strong>Reject all</strong>. Changes that bring new information are decided one at
        a time.
      </p>

      <h2 id="why-accept-is-unavailable">When Accept is unavailable</h2>
      <p>Reject is always offered. Accept waits, and the card says why, when:</p>
      <ul>
        <li>it builds on a block another suggestion adds: accept that first (the card links to it);</li>
        <li>another suggestion touches the same block and the order matters: decide that first;</li>
        <li>it builds on a suggestion that was rejected;</li>
        <li>its block, or the block it would go next to, is no longer on the page;</li>
        <li>the text changed after it was suggested;</li>
        <li>it would edit a locked block or one hidden from the assistant;</li>
        <li>the sources or citations no longer match it.</li>
      </ul>
      <p>Rejecting a change that others build on asks first, and takes those along.</p>

      <h2 id="auto">Auto</h2>
      <p>
        <strong>Auto</strong>, beside the chat composer, applies the assistant’s edits without asking: new sections,
        citations and sources included, and what it writes after reading the web, papers or PDFs. You can undo each
        change, and each stays in the chat’s review record.
      </p>
      <ol>
        <li>
          Turn on <strong>Auto</strong> and confirm with <strong>Turn on Auto</strong>.
        </li>
        <li>
          Ask. After the reply, a note says “Applied N changes” with <strong>Undo</strong> and <strong>Review</strong>.
        </li>
        <li>
          <strong>Turn off</strong> on the strip ends it. Auto also turns off when you leave the page, the chat or the
          workspace; it is never remembered.
        </li>
      </ol>
      <p>Even with Auto on, these wait for your review:</p>
      <ul>
        <li>changes to text that changed since they were drafted;</li>
        <li>a change to the block the caret is in, applied once the caret leaves it;</li>
        <li>changes to locked blocks or blocks hidden from the assistant, and anything that depends on them.</li>
      </ul>
      <Note>
        <p>
          Auto is for editors and above, in chat replies only, where the workspace’s policy allows it (“Auto isn’t
          available in this workspace” otherwise). Ask AI, AI beats and reviews never use it, and it never confirms an
          image generation.
        </p>
      </Note>
    </>
  ),

  'assistant-settings': (
    <>
      <p>
        <strong>Settings → AI &amp; tools</strong> sets what the assistant may use for you, its models and defaults. Page
        and section instructions tell it how to write a given page.
      </p>
      <Facts
        rows={[
          ['Where', 'Settings → AI & tools; Page options → Assistant instructions…'],
          ['Saved', 'To your account, as you make each change'],
          ['Narrowed by', 'The workspace’s policy, and what the server offers'],
        ]}
      />

      <h2 id="capability-switches">What the assistant can use</h2>
      <table>
        <thead>
          <tr>
            <th>Switch</th>
            <th>Lets the assistant</th>
            <th>Default</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Papers</td>
            <td>Search the scholarly literature and check references</td>
            <td>On</td>
          </tr>
          <tr>
            <td>Web</td>
            <td>Search the public web and read pages</td>
            <td>Off</td>
          </tr>
          <tr>
            <td>Research workers</td>
            <td>Split reading across helpers, using more of the budget</td>
            <td>Off</td>
          </tr>
          <tr>
            <td>Images</td>
            <td>Generate images in chat, within your image allowance</td>
            <td>Off</td>
          </tr>
        </tbody>
      </table>
      <p>
        Under Papers, each source has its own switch, all on by default: <strong>OpenAlex</strong>,{' '}
        <strong>arXiv index</strong> and <strong>Semantic Scholar</strong>.
      </p>
      <p>
        A row the workspace blocks says <strong>Off here</strong> (“Switched off in this workspace.”) and stays yours to
        switch; an <strong>Unavailable</strong> one is not configured on this server. <strong>Reset capability
        switches</strong> restores the defaults, with Undo. The <strong>Tooling catalog</strong> below lists every tool,
        skill and worker with its state.
      </p>

      <h2 id="defaults-and-models">Defaults and models</h2>
      <ul>
        <li>
          <strong>My defaults</strong>: <strong>Starting chat effort</strong> (Quick or Standard) and{' '}
          <strong>Starting review type</strong>. A conversation or a review can still choose another.
        </li>
        <li>
          <strong>Gateway models</strong>: the <strong>General model</strong> (chat, inline AI and claim assessment) and
          the <strong>Lite model</strong> (helper calls and research workers), or the server default.
        </li>
      </ul>

      <h2 id="agent-engines">Agent engines (local server)</h2>
      <p>
        On a ColWrite server running on your own machine, <strong>Agent engine</strong> can run the assistant on the
        ColWrite model gateway, or on your own <strong>Claude Code</strong> or <strong>Codex</strong> command-line tool
        under its own sign-in. Choose the engine for the assistant, for <strong>Inline AI</strong> and for the{' '}
        <strong>Review engine</strong>. A tool that needs signing in says so, with the command to run in a terminal;{' '}
        <strong>Check again</strong> reads its status. A deployed server offers the gateway only.
      </p>

      <h2 id="assistant-instructions">Assistant instructions</h2>
      <ol>
        <li>
          Choose <strong>Page options → Assistant instructions…</strong>, or <strong>Assistant instructions…</strong> in
          a heading’s block menu for that section.
        </li>
        <li>
          Pick a <strong>Page type</strong> (Research paper, Literature review, Systematic review, Technical report or
          White paper): the assistant loads that type’s writing guidance before it starts.
        </li>
        <li>
          Write <strong>Page instructions</strong> (up to 4,000 characters) or <strong>Section instructions</strong> (up
          to 2,000), for example the venue, the audience or terms to avoid, and choose{' '}
          <strong>Save instructions</strong>.
        </li>
      </ol>
      <p>
        Instructions are saved with the page and copied with it. Reply details show which ones a reply followed. Reviews
        do not read them: a reviewer reads only the manuscript. Viewers cannot change them.
      </p>
    </>
  ),
} satisfies Partial<Record<DocSlug, ReactNode>>;
