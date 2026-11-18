import type { ReactNode } from 'react';
import type { DocSlug } from '../catalog';
import { Facts, Note } from '../kit';

// Rendered inside the Vite config process (vite.docs.ts): relative imports
// only, never `@/`. Labels are the app's own, word for word.

export const manageDocs = {
  workspaces: (
    <>
      <p>
        A workspace keeps its own pages, collections, PDFs and chats; nothing in it is shared with your other
        workspaces. Your personal workspace comes with your account. A shared workspace has members with roles.
      </p>
      <Facts
        rows={[
          [
            'Switch',
            <>
              The workspace menu at the top of the left sidebar, or <strong>Switch workspace</strong> in the palette
            </>,
          ],
          ['Limit', 'You can own 20 workspaces, your personal one included'],
          ['Trash', 'Items stay 30 days, then they are deleted for good'],
        ]}
      />

      <h2 id="create-a-workspace">Create a workspace</h2>
      <ol>
        <li>
          Open the workspace menu and choose <strong>New workspace…</strong>.
        </li>
        <li>
          Give it a <strong>Name</strong> (up to 100 characters) and an <strong>Icon</strong>: a colour tile or an emoji.
        </li>
        <li>
          Choose <strong>Create workspace</strong>. ColWrite switches to it.
        </li>
      </ol>
      <p>
        To bring people in, see <a href="members.html">Members, roles and policy</a>.
      </p>

      <h2 id="collections">Organise pages in collections</h2>
      <p>
        <strong>Pages</strong> in the left sidebar shows the workspace as a tree of collections and pages. Collections
        nest, and a collection can hold PDFs as well as pages.
      </p>
      <ul>
        <li>
          The <strong>+</strong> beside Pages adds a <strong>New page</strong> or a <strong>New collection</strong>.
        </li>
        <li>
          A collection’s menu: <strong>New page here</strong>, <strong>New collection inside</strong>,{' '}
          <strong>Rename</strong> (<kbd>F2</kbd>), <strong>Sort contents</strong>, <strong>Move to…</strong>,{' '}
          <strong>Open in Library</strong>, <strong>Pages here can use these PDFs</strong> and{' '}
          <strong>Move to Trash…</strong>.
        </li>
        <li>
          A page’s menu: <strong>Open</strong>, <strong>Open in new tab</strong>, <strong>Copy link</strong>,{' '}
          <strong>Rename</strong>, <strong>Move to…</strong>, <strong>Copy to workspace…</strong> and{' '}
          <strong>Move to Trash</strong>.
        </li>
        <li>Drag a row onto a collection to move it (not on touch screens).</li>
      </ul>
      <p>
        A collection sorts its contents by <strong>Name</strong>, <strong>Custom</strong> order or{' '}
        <strong>Last edited</strong>. In custom order, <strong>Move up</strong> and <strong>Move down</strong> (
        <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>↑</kbd> / <kbd>↓</kbd>) reorder rows. The top level’s order is the
        workspace’s <strong>Default order</strong>, set by an admin.
      </p>
      <p>
        <strong>Pages here can use these PDFs</strong> lets every page in the collection read the PDFs filed in it: see{' '}
        <a href="library.html#which-pdfs-a-page-reads">PDF library</a>.
      </p>
      <Note>
        <p>
          When someone else moves a page, your tree catches up when the window regains focus, or within a minute. A move
          you start from the old place is refused, and the tree reloads.
        </p>
      </Note>

      <h2 id="copy-to-another-workspace">Copy a page to another workspace</h2>
      <ol>
        <li>
          Choose <strong>Copy to workspace…</strong> in the page’s menu or in <strong>Page options</strong>.
        </li>
        <li>
          Pick the <strong>Workspace</strong> (one where you are an editor or above) and where in it.
        </li>
        <li>
          Under <strong>PDFs</strong>, choose <strong>No PDFs</strong>, <strong>PDFs on this page</strong>, or{' '}
          <strong>PDFs on this page and from the collections it uses</strong>.
        </li>
        <li>
          Optionally tick <strong>Move the original to Trash once it is copied</strong>, then choose{' '}
          <strong>Copy</strong>.
        </li>
      </ol>
      <p>The copy starts a history of its own. History, chats, suggestions and review notes are not copied.</p>

      <h2 id="trash">The Trash</h2>
      <p>
        Moving a page, a collection or a PDF to the Trash hides it, and everything inside it, at once. Nothing is
        deleted for 30 days.
      </p>
      <ul>
        <li>
          A toast says what moved, with <strong>Undo</strong>. Moving a collection first shows what goes with it.
        </li>
        <li>
          Open <strong>Trash</strong> at the bottom of the sidebar to see each item, where it was, who moved it and when
          it will be deleted forever.
        </li>
        <li>
          <strong>Restore</strong> puts it back where it was, or at the top level when that place is gone.
        </li>
        <li>
          <strong>Delete forever…</strong> and <strong>Empty Trash…</strong> ask you to type the name to confirm.
        </li>
        <li>
          A page that is in the Trash opens read-only, with <strong>Restore</strong>. Edits are not saved until it is
          restored.
        </li>
      </ul>
      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>In the Trash</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Viewer</td>
            <td>Sees what is there, restores nothing</td>
          </tr>
          <tr>
            <td>Editor</td>
            <td>Moves things to the Trash; restores what they moved</td>
          </tr>
          <tr>
            <td>Admin, Owner</td>
            <td>Restores anything; deletes forever; empties the Trash</td>
          </tr>
        </tbody>
      </table>

      <h2 id="workspace-settings">Workspace settings</h2>
      <p>
        <strong>Workspace settings</strong> in the workspace menu opens <strong>Settings → Workspace</strong>. Only
        admins and owners can change it.
      </p>
      <ul>
        <li>
          <strong>General</strong>: <strong>Name</strong>, <strong>Icon</strong> and <strong>Default order</strong> (Name,
          Custom order or Last edited).
        </li>
        <li>
          <strong>Assistant in this workspace</strong>: the policy switches, see{' '}
          <a href="members.html#workspace-policy">Members, roles and policy</a>.
        </li>
        <li>
          <strong>Export</strong>: <strong>Export workspace</strong> makes a zip with every page as JSON and as Markdown;
          tick <strong>Include the PDFs</strong> to add them. Items in the Trash are left out. The zip can be downloaded
          for 7 days.
        </li>
        <li>
          <strong>Delete workspace</strong> (the owner, shared workspaces only): everyone loses access at once. Type the
          name to confirm. It can be restored under <strong>Deleted workspaces</strong> for 30 days, then it is deleted
          for good with its pages, collections, PDFs and chats.
        </li>
      </ul>
      <p>
        Your personal workspace cannot be deleted on its own. Deleting your account deletes it: see{' '}
        <a href="account.html#delete-your-account">Settings, usage and account</a>.
      </p>
    </>
  ),

  members: (
    <>
      <p>
        Everyone in a shared workspace has a role: owner, admin, editor or viewer. Each role can do everything the roles
        below it can. An admin can also switch parts of the assistant off for the whole workspace.
      </p>
      <Facts
        rows={[
          [
            'Where',
            <>
              <strong>Settings → Members</strong>, or <strong>Members</strong> in the workspace menu
            </>,
          ],
          ['Invitations', 'A link for one email address, valid for 7 days, used once'],
          ['Policy', 'Settings → Workspace → Assistant in this workspace (admins)'],
        ]}
      />

      <h2 id="roles">Roles</h2>
      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Can</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Viewer</td>
            <td>
              Read every page, collection, PDF, history and review note, and the Trash. Ask the assistant and run reviews.
              Search papers and check claims. Cannot change anything.
            </td>
          </tr>
          <tr>
            <td>Editor</td>
            <td>
              Edit pages and accept or reject the assistant’s suggestions. Use Auto. Create, rename, move and order pages
              and collections. Upload and file PDFs. Move things to the Trash and restore their own. Check references.
              Copy a page to another workspace.
            </td>
          </tr>
          <tr>
            <td>Admin</td>
            <td>
              Change the workspace’s settings and policy. Invite people, change roles and remove members (never an
              owner). Export the workspace. Restore anything from the Trash, delete forever, empty it.
            </td>
          </tr>
          <tr>
            <td>Owner</td>
            <td>Everything an admin can do; delete the workspace; make someone else the owner.</td>
          </tr>
        </tbody>
      </table>
      <p>
        A viewer sees <strong>View only</strong> in the top bar. Suggestions show to viewers, but Accept and Reject are
        off (“Viewers can’t accept or reject changes”), as are Auto and uploads.
      </p>

      <h2 id="invite-people">Invite people</h2>
      <ol>
        <li>
          Choose <strong>Invite people…</strong> in the workspace menu or in <strong>Settings → Members</strong>.
        </li>
        <li>
          Enter the <strong>Email address</strong> and pick the <strong>Role</strong>, then choose{' '}
          <strong>Create invite link</strong>.
        </li>
        <li>
          <strong>Copy</strong> the link and send it yourself. It is shown only once.
        </li>
      </ol>
      <p>
        The person opens the link and signs in with that address. The link works once, for 7 days, and only for that
        address; inviting the address again replaces it. <strong>Pending invitations</strong> lists the links not yet
        used, with <strong>Revoke</strong>.
      </p>

      <h2 id="manage-members">Change roles, remove, leave</h2>
      <ul>
        <li>An admin picks another role beside a member. Nobody changes an owner’s role or their own.</li>
        <li>
          <strong>Remove</strong> takes a member out of the workspace.
        </li>
        <li>
          <strong>Leave</strong> takes you out. Your chats there stay private to you; to come back, someone has to invite
          you again. The only owner cannot leave: make someone else the owner first, or delete the workspace.
        </li>
      </ul>

      <h2 id="ownership">Transfer ownership</h2>
      <ol>
        <li>
          The owner chooses <strong>Make owner…</strong> beside a member and confirms with{' '}
          <strong>Ask to become owner</strong>.
        </li>
        <li>
          The member sees the request in <strong>Settings → Members</strong> with <strong>Accept</strong> and{' '}
          <strong>Decline</strong>. The owner can <strong>Withdraw</strong> it. It expires in 7 days.
        </li>
        <li>Once accepted, the previous owner becomes an admin.</li>
      </ol>

      <h2 id="workspace-policy">Workspace policy</h2>
      <p>
        Under <strong>Settings → Workspace → Assistant in this workspace</strong>, an admin can switch these off for
        everyone in the workspace:
      </p>
      <table>
        <thead>
          <tr>
            <th>Switch</th>
            <th>When on</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Web search</td>
            <td>The assistant can search the public web and read the pages it finds.</td>
          </tr>
          <tr>
            <td>Outside research</td>
            <td>
              The assistant and Research can use the paper sources and claim checks, and citing can look up DOIs and arXiv
              ids. The workspace’s own PDFs stay available either way.
            </td>
          </tr>
          <tr>
            <td>Auto</td>
            <td>The assistant can apply its edits without asking first.</td>
          </tr>
          <tr>
            <td>Images</td>
            <td>The assistant can propose generated illustrations. Each still needs your confirmation.</td>
          </tr>
        </tbody>
      </table>
      <p>
        The policy only narrows: it never turns on what a person switched off in their own{' '}
        <a href="assistant-settings.html">AI and tools settings</a>. Where it blocks something, the app says so in place,
        for example “Outside research is switched off in this workspace.”
      </p>
    </>
  ),

  export: (
    <>
      <p>
        Export a page as PDF, Standalone HTML, Markdown or LaTeX, with its figures, citations and reference list. The AI
        use dialog lists what the assistant did on the page and drafts a disclosure statement for a venue.
      </p>
      <Facts
        rows={[
          [
            'Where',
            <>
              <strong>Page options → Export…</strong> and <strong>Page options → AI use…</strong>
            </>,
          ],
          ['What is exported', 'The page as it is in the editor, edits still waiting to save included'],
          ['Who', 'Everyone, viewers included'],
        ]}
      />

      <h2 id="formats">Formats</h2>
      <table>
        <thead>
          <tr>
            <th>Format</th>
            <th>What you get</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>PDF</td>
            <td>
              The browser’s print dialog with the page laid out for print. Choose <strong>Save as PDF</strong> there.
            </td>
          </tr>
          <tr>
            <td>Standalone HTML</td>
            <td>
              One file that opens in any browser, figures drawn and maths typeset. See the{' '}
              <a href="/examples/?view=paper">sample paper</a>.
            </td>
          </tr>
          <tr>
            <td>Markdown (.md)</td>
            <td>
              Text with citations as Pandoc keys (<code>[@doi:…]</code>), maths in <code>$…$</code>, and diagrams and
              figures as <code>mermaid</code> and <code>figure</code> code fences.
            </td>
          </tr>
          <tr>
            <td>LaTeX (.tex)</td>
            <td>
              TeX made by the server from the saved page, with the title and the reference list. Structured figures are
              printed as their JSON source and diagrams as Mermaid code; use a figure’s{' '}
              <strong>Copy TikZ (LaTeX)</strong> for the drawing.
            </td>
          </tr>
        </tbody>
      </table>
      <p>Original image files are included. Markdown and LaTeX exports with images download as a ZIP.</p>

      <h2 id="options">Options</h2>
      <table>
        <thead>
          <tr>
            <th>Option</th>
            <th>Choices</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Profile (PDF, HTML)</td>
            <td>
              <strong>Paper — light and reflowed</strong>, the PDF default, or <strong>Editor faithful — fixed measure</strong>,
              the HTML default
            </td>
          </tr>
          <tr>
            <td>Page size, Orientation (PDF)</td>
            <td>A4 or Letter; Portrait or Landscape</td>
          </tr>
          <tr>
            <td>AI Beat drafts</td>
            <td>Leave out of the export (default), or include them</td>
          </tr>
          <tr>
            <td>Title</td>
            <td>Include the page name as a title in the body (off by default)</td>
          </tr>
          <tr>
            <td>References</td>
            <td>
              Append the reference list (on by default). Each citation links to its entry, and each entry links back.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        When the page has citations, the dialog lists the retracted works, those not verified, and citations with no entry
        in the sources, from the last <a href="reference-check.html">reference check</a>. It never stops the export.
      </p>

      <h2 id="bibtex">BibTeX</h2>
      <p>
        The <strong>Sources</strong> panel exports the page’s references as BibTeX and imports a <code>.bib</code> file.
        See <a href="citations.html#bibtex">Citations and references</a>.
      </p>

      <h2 id="ai-use">AI use and the disclosure statement</h2>
      <ol>
        <li>
          Choose <strong>Page options → AI use…</strong> (once the page is saved).
        </li>
        <li>
          <strong>On this page</strong> lists each thing the assistant did: what for (drafted text, rewrote passages,
          added citations, refreshed references…), in which sections, with which models, and how it was checked
          (accepted one change at a time, applied by Auto, rejected…).
        </li>
        <li>
          Under <strong>Statement for</strong>, choose the venue: Elsevier journals, Taylor &amp; Francis, IEEE, PLOS,
          Science journals, ACM, NeurIPS or ICLR.
        </li>
        <li>
          Read the draft, where the venue wants it, and the venue’s policy (with the date it was read), then{' '}
          <strong>Copy</strong> it.
        </li>
      </ol>
      <Note tone="warning">
        <p>
          The log knows only what the assistant did in ColWrite. Text pasted from other tools is not in it: add that to the
          statement yourself.
        </p>
      </Note>
    </>
  ),

  account: (
    <>
      <p>
        <strong>Settings</strong>, at the bottom of the left sidebar, opens over the page. Its panes are{' '}
        <strong>Account</strong>, <strong>Preferences</strong>, <strong>AI &amp; tools</strong>,{' '}
        <strong>Workspace</strong>, <strong>Members</strong> and <strong>Usage</strong>.
      </p>
      <Facts
        rows={[
          ['Account', 'Your profile, sign-in details, signing out, deleting the account'],
          ['Preferences', 'Appearance, page width and text size, kept on this device'],
          ['Usage', 'Assistant runs, tokens and cost, for one workspace or all of them'],
        ]}
      />

      <h2 id="profile">Profile</h2>
      <p>
        Under <strong>Account → Profile</strong>: <strong>Preferred name</strong>, <strong>Headline</strong>,{' '}
        <strong>Affiliation</strong>, <strong>Photo</strong> (a link to an image), <strong>Time zone</strong> (used for
        the dates in your usage) and <strong>About</strong>. Choose <strong>Save changes</strong>.
      </p>
      <p>
        <strong>Sign-in</strong> shows your email and username, which your ColWrite account manages, and{' '}
        <strong>Sign out</strong>.
      </p>

      <h2 id="preferences">Preferences</h2>
      <ul>
        <li>
          <strong>Appearance</strong>: Use system setting, Light or Dark. Also in the workspace menu.
        </li>
        <li>
          <strong>Full width</strong>: the page uses the window’s width.
        </li>
        <li>
          <strong>Small text</strong>: the page body at 14 px instead of 16 px.
        </li>
      </ul>
      <p>
        The assistant’s settings are in <strong>AI &amp; tools</strong>: see{' '}
        <a href="assistant-settings.html">AI and tools settings</a>.
      </p>

      <h2 id="usage">Usage</h2>
      <p>
        <strong>Usage</strong> counts <strong>This workspace</strong> or <strong>All workspaces</strong>:
      </p>
      <ul>
        <li>
          Tiles: <strong>Pages</strong>, <strong>Saves</strong>, <strong>Chats</strong>,{' '}
          <strong>Assistant runs</strong>, <strong>Tokens</strong> (in, out and cached) and <strong>Cost</strong> (in US
          dollars, as the model providers report it; local engines report none).
        </li>
        <li>
          <strong>Activity</strong>: page edits, assistant runs and PDFs over the last 30 days, as a chart or a table.
        </li>
        <li>
          <strong>Activity by page</strong> (one workspace) or <strong>By workspace</strong> (all of them),{' '}
          <strong>Assistant tools</strong> (most used first) and <strong>Storage</strong>.
        </li>
      </ul>

      <h2 id="delete-your-account">Delete your account</h2>
      <ol>
        <li>
          Open <strong>Account → Delete account</strong> and choose <strong>Delete your account</strong>.
        </li>
        <li>Type your username exactly to confirm.</li>
      </ol>
      <Note tone="warning">
        <p>
          This deletes your personal workspace with everything in it and takes you out of every other workspace. It
          cannot be undone. A shared workspace you alone own must be deleted, or handed to another owner, first; the
          dialog names them.
        </p>
      </Note>
    </>
  ),
} satisfies Partial<Record<DocSlug, ReactNode>>;
