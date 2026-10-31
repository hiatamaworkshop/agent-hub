# Design

## 1. Background and motivation

- When several agents are used side by side (Claude Code sessions, and later Codex and others), a human ends up in between, passing things along by copy and paste.
- However, **the human reading in between has value in itself** (noticing misunderstandings, adding context, deciding not to send at all). What should be automated is only the "hauling".
- So the direction is to **remove the hauling while keeping the human in the loop**. Autonomous orchestration of agents is not the goal.

### 1.1 Positioning (2026-10-16, after the survey in §8)

agent-hub is **a thin layer on top of the big vendors' parts**. Delivery, detection and execution are borrowed from the big vendors; what it owns is only three things: **records, conventions, and the human's decision points**.
What is made general is the shape of the data and the conventions (the same shape for any company's agents). What is made specific to a use is only my own operation (leader / deployer, evaluation).

| Layer | Owner | Reason |
|---|---|---|
| Execution, orchestration, cloud | Big vendors | Needs money and infrastructure. The big vendors will ship good ones |
| Delivery to sessions (Channels, cross-session messaging) | Borrowed from the big vendors | The official side keeps moving. Building our own would lose value over time |
| Detecting state (waiting on a question, done) | Borrowed from the big vendors | There are Agent View and the Notification hook (§8.1) |
| Records (ledger, Mailbox, `kind`, `from`) | Our own | Kept in the same shape across companies, and stays our data when we switch. The big vendors have little motive to build it |
| Conventions (roles, message shapes, SCOPE, reserving before work) | Our own | They are how I do my work (§3.11, §8.4) |
| The human's decision points (pressing Send, the browser console) | Our own | The trend leans autonomous, so we have to protect them ourselves |
| The joints (delivery adapters) | Our own, but thin | When the vendors' parts change, only this is swapped (§3.9) |

Criteria for deciding whether to continue:

1. When an equivalent feature ships officially, remove ours. Our parts are built as sockets that can be swapped.
2. Do not build features I do not use every week. Generality is met by the neutrality of the data's shape, not by the number of features.
3. Being usable as a place to evaluate and compare the behavior of agents also counts as value.

Direction of the structure (2026-10-16, user):

- **Gather the philosophy in the Hub, and make the branches swappable.** Keep the Hub simple while holding the conventions (§3.11) precisely. Delivery adapters (§3.9), the UI and the clients are parts that may change, arranged so the impact on the Hub stays small.
- **Build the GUI ourselves.** The UI is the human's decision point itself, and there is little reason to depend on an outside app. Other tools serve only as references for features.
- **Assume the CLI as the LLM's workplace.** There is a view that the main battlefield will move to the official GUIs (the author of Relay, 2026-10), but rather than dropping the CLI, we take care of it as the place where LLMs work best. The LLM writes text; the Hub and UI take care of presenting it in HTML (§3.11).

If practicality were the only goal, adding a UI to something existing (mcp_agent_mail and the like) would be cheaper. We continue with our own because three things are missing from the existing ones: "a human presses", "a role can be an address", and "the sender's attributes are kept apart from the body with `meta`". If these stop being needed, we will consider switching.

### 1.2 Working conventions (2026-10-31, C80)

The working conventions that agent-hub stands for, and where each one is enforced. Where a convention has no check yet, the table says so.

**Thesis** (agreed with the user, 2026-10-30). The question is not whether a human or an AI decides, but how the system keeps moving forward. The history of development is kept in the repository (git, the ledger's closed lines, §6, §9), not in the Hub. Approvals and warnings that would become formalities, or be ignored, do not stop the flow. They are recorded outside it, with the time and a pointer back, and only for what git does not keep. A later problem is first matched against that record by its timing. C85 is the first planned case; it is not built yet.
The measure is not "less human attention per accepted change": that would count removing the human's decision points (§1.1) as progress.

**Input envelope.** A guarantee means something only together with the input it covers ("this behaviour for inputs in this range"). Widen the envelope when a case is verified, state its boundary, and do not let input outside it pass unrecorded. Already in use: §6 entries name the version, OS and model they were observed with (§6.1c, §6.1v); §3.11 asks for coverage to be stated honestly ("0 waiting for confirmation" covers only work that went through the Hub); C58 warns when a checkout is stale before a start.

**Trust on evidence, not on people.** An OSS maintainer trusts a contributor partly because they know the person. Agents are replaced and carry no reputation, so trust rests on evidence (§3.11). The tools derive facts from the repository (changed files, HEAD). The agent writes only its judgment. An agent does not accept a request it issued itself. The reviewer checks against named sources (`tools/dev/roles/reviewer.md`).

**Sort conventions by what they do, not where they came from.** Some conventions look social but carry assurance: a second reviewer is a check, not courtesy. Each convention is judged by the failure it prevents, and the ones against agent failure modes get the strongest checks.

**What is not written in the repository did not happen.** The top principle. §3.16 applies it to progress: a promise counts as kept when the roadmap shows it, and an agent's self-report is not a fact until the repository does.

**Conventions and their enforcement**

| Convention | Enforced by | Status |
|---|---|---|
| Decisions split by reversibility: a local commit proceeds; push, publishing, deleting data and changing a promise wait for the human | Push: CLAUDE.md "Git", `deployer.md` and `leader.md` "Commitments". Changing a promise: §3.15 table; the roadmap header's rule on done-when wording | Partly. Publishing and deleting data have no rule in this repository yet |
| Affected tests while working; the full set before reporting done | CLAUDE.md "Notes on the development environment" (`npm test`, and `npm run ui:check` for the UI); `leader.md` step 2 runs the tests once itself; `deployer.md` VERIFIED asks for the command and its result | Partly. Running the affected tests while working is not enforced yet |
| Incidents in §6 become new verification angles | CLAUDE.md "Before implementing" 1 (check §6 first) and "Updating the docs" (what is learned goes to §6) | Partly. Nothing turns an incident into a new angle; the incident entries (§6.1n, §6.1p, §6.1q) are the records |
| A "direction first" reply at the start of work | Not written as a rule. §6.1n records a correction that arrived during work and how it was passed on | Not enforced yet |
| Drift between report and change | `deployer.md` `CHANGED` lines; `leader.md` step 2 compares `git status` and `git diff` with SCOPE | Partly. The Hub-side check (§3.11) is concept, not implemented |
| Sycophancy: an objection given without a reason | §3.11's two checkpoint levels send a judgment about waiting to a human | Not enforced yet. Findings that name a failure scenario are C82 (proposed) |
| Scope overreach | `deployer.md` "Do not change files outside the request's scope"; `leader.md` step 2 checks SCOPE | Enforced by instruction. The mechanical check is §3.11 (concept) |
| Forgetting | §3.16: progress lives in the roadmap, not in the Hub's delivery state. `tools/hooks/post-commit-index.sh` (C52) sends the index after a commit that changes the ledger | Partly. An agent's memory across compaction (§3.13) is not enforced |

## 2. Requirements

| ID | Requirement |
|---|---|
| R1 | An agent's **session breaks** and **waits on questions** can be detected from outside the agent |
| R2 | The user can see R1 in the browser |
| R3 | The user can write a message in the browser and push it to the Hub. Forwarding without editing (message passing to other agents) is also possible |
| R4 | Agents **declare their subscriptions explicitly**. When something is pushed to the Hub, only the subscribed agents are notified |
| R5 | Nothing is missed even if a session is temporarily closed (unread queue) |
| R6 | The address, subscriptions and unread messages carry over across **agent replacement** (`/clear`, restart, model change, switching to another tool) |
| R7 | Agents have a **role** (`reviewer`, `deployer` and so on), and the role decides which messages they should read |
| R8 | Messages have a **machine-distinguishable kind** (`kind`), so the receiver and the UI can decide how to handle them |

### Non-goals

- Running agents automatically, or distributing tasks autonomously
- Summarizing conversations or extracting key points (the content is carried as is, unprocessed)
- Forwarding to other agents automatically without human confirmation (by default a human's Send always comes in between)
- Exposure to remote hosts, or multiple users (127.0.0.1 only)

## 3. Architecture

```
┌──────────────┐   SSE / HTTP    ┌──────────────────────────────────────┐
│ Browser UI   │ ◀────────────▶ │ Hub (resident daemon, 1 process)       │
└──────────────┘                 │  - Mailbox table (subs, cursor, unread)│
                                 │  - Attachment table (live sessions)    │
 hooks ── POST /events ────────▶ │  - message / event log (JSONL)         │
                                 └──────▲──────▲──────▲─────────────────┘
                                        │ SSE  │      │   the shim attaches to a Mailbox
                              ┌─────────┴┐ ┌───┴─────┐ ┌┴────────┐
                              │ shim     │ │ shim    │ │ shim    │  channel MCP (stdio)
                              └────┬─────┘ └────┬────┘ └────┬────┘
                                   ▼            ▼           ▼
                              Claude         Claude      (Codex etc.: inbox() polling)
                          mailbox=main   mailbox=rev-a
                                         role=reviewer
```

### 3.1 Why the Hub and the shim are separate

A channel MCP server is **started as a subprocess for each Claude session**.
If the MCP server itself were the HTTP endpoint, several sessions would collide on the port and could not share state.
So state and HTTP are gathered in **the Hub (one)**, and **the shims (one per session)** stay thin bridges.

In the terms of MCP Events (§7), the Hub sits in the position of a "**Forward Proxy** that receives and holds events and hands them to clients by poll / push".
The SEP puts the source of truth for subscription state on the client side, but agent-hub keeps the client (the shim) stateless, so the Hub holds that source of truth as its proxy.

### 3.2 Components

**Hub**
- An HTTP server reachable only from the host's loopback. Started as a resident daemon (direct start / Docker in §3.8).
- Holds: the Mailbox table, the Attachment table, messages, the event log, and role definitions (read from a configuration file).
- Also serves the browser UI's static file.
- Persistence is a JSONL append log + memory (the Mailbox table is restored from the log at startup). We decided not to use SQLite (2026-10-18; reasons and measurements in §5).

**shim (channel MCP server)**
- A thin MCP server that Claude Code starts over stdio. **It holds no state.**
- At startup it decides the Mailbox name and role, **attaches** to the Hub, and subscribes to the Hub's SSE (§3.3, §3.5).
- Pushes messages delivered by the Hub to Claude as `notifications/claude/channel`.
- Puts the role's description into MCP `instructions`, telling the agent "what I read and what I return".
- Publishes tools for the agent to call: `whoami` / `subscribe` / `unsubscribe` / `post_message` / `inbox`. `attach` / `list_topics` / `report_event` (deferred; §3.4) are not implemented (details in protocol.md §5).

**hooks (detection side)**
- Claude Code's **HTTP hook** (`type: "http"`) sends the hook's input JSON directly to the Hub's `POST /events/claude-code`. No script is written (§6.1). An example configuration is `tools/hooks/settings.json`.
  Passing it with `--settings` misbehaves (§6.1f), so copy it into `.claude/settings.local.json` or the like. `Authorization` is expanded from the environment variable `HUB_TOKEN`, so Claude Code's environment needs it (`npm run team` passes it from `.env`).
- Responsible for mechanical detection (3.4 below).

**Browser UI**
- A single HTML page served by the Hub (no framework, to begin with).
- The Hub re-reads `public/index.html` on every `GET /`, so UI changes take effect on a browser reload, while Hub and shim changes do not take effect until a restart (a new session for the shim). A new UI paired with an old Hub is normal, so the UI reads fields added to the Hub's responses as optional (2026-10-16: with an old Hub's response lacking `recipients`, the UI threw, showed a successful send as failed, and the message was sent twice).
- Features: live display of events/messages (SSE), composing and sending messages, a button to forward received messages unedited, and the Mailbox list (connection state, subscriptions, unread count; the time and reason if disconnected).
  The card shows, small, the last model and effort seen (`opus-5 · medium`, from the Events at hand (the recent window, within the retention period). The model appears only in start and switch Events, so it may disappear as it ages. If there is no value nothing is shown, and the tooltip says "the last value seen, not a guarantee of the current setting". C61).
  Card states (Needs you / Working and so on), backlog badges, roadmap item cards (Items) and the color-coding of reply headings are in §3.15.
- The screen is fixed; only the thread (`#list`) and the Mailbox list (sidebar) scroll. At the top is the thread toolbar (how things are shown: Filter ▾, Compact, Keep latest, Reset, a future search and so on); at the bottom is the composer (what is sent: kind, address, body, Send, future attachments and so on).
- Messages are color-coded by the sender's role (the label chip and the border; the mailbox name if there is no role). kind is shown by an outlined badge and is not used for color. The send form's kind is a toggle of the same badges; only the chosen one is filled.
- Detection events (§3.4): interleaved with Messages in the thread by time, and set apart from Messages by a dashed frame (the border is the Mailbox's color). The content is shown per kind: a question shows its text and options, permission waits and notifications show their wording, a turn end shows the final answer (only the beginning if long, opened to read).
  `question` and `permission` stand out as waiting for a human's hand. The Mailbox card shows the kind and time of the last Event that arrived. P1 did not estimate state, but counts alone did not show who was moving, so the card's state is now derived from Events and delivery material (§3.15 "Card states", 2026-10-22). An Event's Reply starts writing a `request` to that Mailbox (an Event is not a Message, so no `replyTo` is set).
- Unedited forward: choose Messages with Forward (several allowed), and Send becomes `Forward N`. The body field becomes the human's covering note, and only if written it is sent as a separate message before the forward (not mixed into the forwarded body; protocol.md §2). A reply and a forward are not done at the same time (starting one clears the other).
  The thread toolbar's Relay shows the number not yet sent for each directed pair (A → B). Pairs are made from the forwarding history (A → B if a message A wrote was ever forwarded to Mailbox B), and "not yet sent" means A's outputs newer than the original last forwarded to B (excluding those addressed to B). Pressing it only selects those N and sets the address to B; a human sends.
  With an old Hub (no forwarding API), to keep only the covering note from arriving, the UI checks for the API before sending by forwarding to an id that does not exist (a new Hub returns 404 `message_not_found`).
  Compact counts Messages and Events together. With an old Hub without `/events` (404), Events are not shown.
- Unread in the tab: while hidden, the number of messages from others addressed to the human (`to.type === 'user'`) that arrived over SSE, plus the number of `question` / `permission` Events, are shown in the title `(n) agent-hub` and as a badge on the favicon. Messages between agents (addressed to `mailbox:*` / `role:*` / `topic:*`) are not counted. Cleared on returning to the front or on focus. Your own sends and history loading are not counted. What is fetched again after reconnecting is counted by the same rule.
  The title also shows the human's moves across all projects as `N waiting · agent-hub`, and the favicon shows the same two signals as the cards: an amber count badge (waiting on the human plus new arrivals while hidden) takes priority, otherwise a hub in the working color, otherwise the plain hub (§3.15, C6, C70).
- Recovering the connection: every time the SSE reopens, the UI fetches `GET /messages?after=<the highest seq drawn when it opened>` and draws it (the first connection is covered by the history load). If fetching fails, the display does not stop; it fetches again the next time it opens. If the Mailbox list fails, it goes to #err and is retried a few times after a short wait (also when the SSE reopens). History and new arrivals work independently of whether the list succeeded.
- Sending: body text typed during sending and images added after sending are kept. Only what was sent (the body and images at the moment of sending) is cleared. On failure nothing is cleared. `/settings` is read once at startup and used for the initial address and Commands (the Commands dialog re-reads it every time it opens).
- Filtering by project (2026-10-18): above the sidebar, choose `All projects` or one project (the union of the Mailboxes' `project` and the roadmap indexes' `project`; "A project is a value" in §3.15, 2026-10-20). It is not split into tabs. The value of the human's console is seeing everything on one screen (§8.2), and with tabs a question waiting in another project would be missed.
  - Only the cards of the chosen project's Mailboxes, and the Messages and Events that involve it, are shown. Involving means one of: the sender's or addressee's Mailbox belongs to that project, `to.project` is that project, or a `role:` / `topic:` message without `project` that a Mailbox of that project receives. Messages to `user:` are decided by the sender.
  - While a project is chosen, the number of the human's waits in other projects (the total of `tabWaitingOf`, the same as the tab: unanswered `question`s and `permission`s, requests to the human, and one for each card waiting on an unconnected party) is shown in the thread toolbar. Pressing it goes back to `All projects`.
  - The address candidates are narrowed to that project's Mailboxes too, and choosing `role:` and sending adds `to.project`. The address shows as `role:deployer @ vcp`. Even for a project with no Mailbox yet, the roles in roles.json (`GET /roles`) are candidates, and the message arrives as unread at the Mailbox that attaches.
  - In `All projects`, cards are grouped by project (Mailboxes without a project come last). The choice is remembered in localStorage, and goes back to `All projects` when that project has neither Mailboxes nor indexes any more.
  - An old Hub that does not know `to.project` drops the project and delivers to everyone. If the response's `to` has no `project`, a warning is shown.
- Filtering the thread (C59, 2026-10-29): one mechanism that decides project, Mailbox, kind, notifications and the latest N (Compact) by a predicate per axis (`FILTER`, `AXES`, `hiddenBy` in `public/index.html`). `Filter ▾` (a popover that opens the axes' fields), `Compact`, `Reset`, chips for the active axes (× removes one), and the hidden and collapsed counts (and Expand) appear in one place in the thread toolbar. The conventions are as follows.
  - **It only hides, never deletes.** It does not affect the Hub, unread state or delivery. Collapsing only sets a mark (`data-compacted`) and does not remove anything from the DOM (as with project filtering). fold() includes old items hidden by the current filter within the range it marks as collapsed, so even if a hiding axis (Noise, Kind, Mailbox) is removed later, those do not come back; they come back with Expand or Reset (behavior unchanged).
  - **Waits are not hidden.** Questions, permission waits, requests to the human, and notifications that are the human's move (usage limits under `QUOTA_NEEDS_YOU`) are neither hidden nor collapsed by any combination of axes. Only project works as before: waits in other projects are counted in `N waiting in other projects`. Whether the done-when condition's "any combination of axes" also extends to project awaits a human's confirmation after C59's implementation (§9 open questions).
  - **Axes.** Mailbox (multiple choice: Messages whose sender or addressee Mailbox is chosen, Events of the Mailbox, the chosen Mailboxes' cards and cards with waits), Kind (a set of Message `kind`s and Event kinds to hide; questions and permission waits are not listed), Noise (notification-type Events; what it includes is the default `notification` of `NOISE_KINDS`, with configuration in C60; on by default), Recent (the latest N; the collapse mark). `show(item)` is the product of the axes: if any one excludes it, it is hidden. To add an axis, add one predicate and one field in the popover.
  - **Badges.** Backlog badges count only visible cards. If a badge's target is hidden by a filter, the badge shows the name of the hiding axis and does not open it (the same as C48). Something that is only collapsed is opened.
  - **Default state.** Noise is on (hiding notification Events) and the other axes are off (Project is All projects, Mailbox and Kind are empty, Compact is open). Without saved settings it starts in this state.
  - **Reset returns to the default** (not to everything off). It turns Noise back on, clears the other axes and opens the collapse, so the page is the same as when first opened. The × on the Noise chip turns only Noise off (to see notifications).
  - **How Reset and the chips appear.** The Noise chip appears when Noise is on (including the default). Reset appears only when different from the default (another axis is active, Noise is off, or something is collapsed), and not in the default. The hidden count (`N hidden`) is counted as the default Noise dictates.
  - **Saved per axis.** `agent-hub.filter.mailboxes`, `agent-hub.filter.kinds`, `agent-hub.filter.noise` (localStorage; noise is `1` / `0`, on by default if not saved). A saved off stays off after a reload. Compact's count is `agent-hub.keep`, the project `agent-hub.project`. On reading, undefined kinds are silently dropped, and Mailboxes that no longer exist are dropped once the list arrives.
  - **Address candidates do not follow the filter.** Address candidates are decided by project alone (the display filter does not change where things are sent, so you do not pick and send to a Mailbox you cannot see).
- Deleting a Mailbox: Delete appears only on the cards of unconnected Mailboxes (`DELETE /mailboxes/:name` after confirmation). It does not select the card. 409 (it was attached in the meantime) and 404 from an old Hub that does not support deletion go to #err, and the list is fetched again without removing the card. Other tabs that receive `mailbox.deleted` fetch the list again too.
- The unread count on Mailbox cards: the list is fetched again on new arrivals (`message`) and acks (`mailbox.acked`); there is no polling. With an old Hub's response lacking `effectiveSubscriptions` or `unread`, subscriptions are empty and the unread field is not shown (the card itself is still drawn).
- The UI's display text is in English (message bodies are not included and are shown as they are). This document is in English too (C65, 2026-10-29).
- Custom commands: a `/name` (or `/name argument`) in the body is replaced by the defined text at the moment of Send. The UI does the replacement; the Hub does not know about commands (it receives the replaced body as an ordinary message). What stays in the thread is the replaced body too, so what was sent is visible as is. It works only when a human presses Send; nothing is sent automatically. The settings are on the Hub in `HUB_DATA_DIR/settings.json` and can be edited by hand (read from the file every time). With an old Hub that has no `/settings`, Commands is disabled and sending works as before.
- The initial address (To): automatic choice goes (1) the address last sent to (localStorage `agent-hub.lastTo`) → (2) `defaultTo` in settings.json (e.g. `mailbox:leader`), and **only connected (attached) targets** are candidates in either. A mailbox must be attached; a role or topic must be held by an attached Mailbox. user:browser is always a candidate. If neither is a candidate, **nothing is selected** (the first option reads "Select a destination…"). It does not fall back to the first Mailbox or topic:user.message. `defaultTo` is read before the first decision.
  - The automatically chosen value (autoTo) is decided again on every Mailbox list update (buildTo). So when something attaches, the default moves to the right candidate by itself.
  - It stops once a human chooses: opening the dropdown, pressing a key, changing the value, pressing a Mailbox in the sidebar, Reply or Send clears the automatic flag, and later list updates no longer move it. Choosing the same value again also stops it (the flag is cleared on opening; also when you open and cancel).
  - Send with nothing selected is refused with `Choose a destination first.` (nothing is posted).
  - Sending by hand to an address whose receiving Mailboxes are all unconnected (`mailbox:`, `role:` or `topic:`) is recorded but warns (`Accepted, but nobody is reading … now; it will stay unread until it attaches`). It is decided from `recipients` of `POST /messages` and the connection state in the Mailbox list; a name not in the list is not treated as unconnected. When the zero-recipient warning (`No Mailbox will receive`) applies, it takes precedence.
  - Reply chooses the original sender (treated as a manual choice).

### 3.3 Mailbox and Attachment (R5, R6)

The identity of an address is decided not by "which process is receiving" but by "**who it is logically for**".
The same idea as MCP Events (SEP-3415), which derives the subscription ID deterministically from the subscription's content instead of having the client generate it (§7).

| Layer | Lifetime | Key | Holds |
|---|---|---|---|
| **Mailbox** | Long-lived. Remains until deleted explicitly | A logical name (e.g. `main`, `rev-a`) | role, project (the working folder of the last attach), subscribed topics, cursor (the acked watermark), the unread queue |
| **Attachment** | Temporary. The lifetime of a session | The `attachmentId` the Hub issues | `sessionId`, `client` (claude-code / codex and so on), `cwd`, lease expiry |
- **How the Mailbox name is decided** (in order of precedence): the environment variable `HUB_MAILBOX` → an explicit call of the MCP tool `attach(mailbox)` (not implemented) → `<folder name>.<role>` if `HUB_ROLE` is set → otherwise the current folder name.
  It was confirmed that the starting shell's `HUB_MAILBOX` is inherited by the shim (§6.1c).
- **Agents start at the project's root (2026-10-18).** The scope of permissions, the `CLAUDE.md` and hooks they read, memory, and `git diff` are all decided by the folder they start in; started from elsewhere, they get lost without reading what they should.
  The Hub belongs to no project; sessions from every project connect to one Hub. So the Mailbox namespace is one across the Hub, and if the Mailbox name were only the role name, the same role in another project would attach to the same Mailbox and cause a takeover.
  The default when only `HUB_ROLE` is given was changed from the role name to `<folder name>.<role>` (e.g. `cairn.deployer`; the folder name side is cut so it fits in 64 characters). The startup scripts move into the `-Project <path>` folder before starting, and pass the name built by the same rule in `HUB_MAILBOX` (so it also goes into the hook's header).
  `role:` messages can be narrowed to a project's scope. When an agent sends one, it is narrowed to the sender's project; when sent from the UI with a project chosen, to that project (§9-7, 2026-10-18).
- **project**: the `cwd` declared at attach is recorded on the Mailbox (it stays in the log and survives a Hub restart). It is shown on the UI's card, so you can tell which repository a Mailbox belongs to.
  An attach from a different folder than last time updates the record to the new one and warns in the UI with the previous folder as `projectChanged` until the next attach (in the Hub's memory only). A mistake in starting is likely, but new checks start as warnings (§3.11), so it is not refused.
  The comparison normalizes separators (`\` and `/`), trailing separators and the case of the drive letter.
- **attach is idempotent.** Attaching again to the same Mailbox makes the Hub resend everything after that Mailbox's cursor. The shim does not need to remember anything.
- **Replacement (R6)** works just by "a new session attaching to the same Mailbox". Subscriptions, unread messages and the cursor remain on the Mailbox.
- **takeover (exclusive, the newer wins; decided in §9-1)**: when another session attaches to a Mailbox that already has an Attachment, the old Attachment is sent `terminated(reason: superseded)` and cut off.
  The cut-off shim does not attach again (to avoid a back-and-forth of taking it back), and `post_message` / `subscribe` / `unsubscribe` return an error saying it was taken over (subscriptions are stored on the Mailbox, so letting them through would change the successor's subscriptions).
  The UI's card shows that the current Attachment started by a takeover, as `took over <time>` (`takeover` of `GET /mailboxes`; in the Hub's memory only). Attaching again from the same session (for example when the old Attachment was still in its grace period after an `/mcp` reconnect) is not a replacement, so it is not shown.
  **A successor while disconnected (2026-10-18)**: if a successor attaches while the stream was cut and the grace period passed so it became detached, the old shim never receives `terminated`. So that the returning old shim does not cut off the successor, the shim adds the previous Attachment ID (`previous`) when attaching again after losing its Attachment (404), and the Hub refuses with 409 `successor_attached` if that Mailbox has another Attachment. The shim stops, the same as for superseded. An attach that gives no previous ID (a new session) takes over as before.
  After a Hub restart the Hub does not remember Attachments, so it cannot tell, and whichever attaches again first stays (a problem only when the successor and the old shim come back at the same time; rare, so accepted).
  A cut-off session may keep running, and its hook Events resolve to the same Mailbox. The Hub sets `superseded: true` on those Events, and the UI shows them with `superseded session`. They are not used as the card's `Last event`, and no Reply is shown (a reply to the Mailbox would reach the successor).
- **Lease**: the lease is kept while the stream is open. Clients that do not open the stream (the `inbox()` polling path) extend the lease with heartbeats. An Attachment whose lease expires becomes detached, and messages in the meantime accumulate in the Mailbox's unread queue. The Mailbox itself does not disappear when a lease expires.
  **Decision (2026-10-17)**: the shim does not send heartbeats. The shim always keeps the stream open, and whether it is alive is known from the stream being cut (a 15-second grace period). Requiring heartbeats from the shim would make Claude Code still running a shim from before the update lose its lease on a new Hub.
  The reason a Mailbox became detached (`closed` / `disconnected` / `lease_expired`) is shown in the UI with the Mailbox until the next attach. It is held only in the Hub's memory and disappears on restart.
- **Controlling how much flows in to a successor**: at attach time, unread messages older than `maxAgeMs` and those before the newest `maxUnread` are not handed over; they are marked abandoned and the cursor advances. If anything was cut, `truncated: true` and the count are returned, and the shim tells the agent in one notice.
  Channels hand notifications that arrived during work to the next turn all together, so the aim is to prevent a large inflow after a long absence.
  The defaults are 7 days / 50 messages (§9-4). It is only a guard; the Message log is not erased (it can be seen in the UI's history). Important documents are assumed to be in the repository, so a common-sense limit was preferred over strictness.

### 3.4 Detection (R1)

| What is detected | Means | Nature |
|---|---|---|
| Turn end (a candidate break) | `Stop` hook | Definite, mechanical |
| Waiting for permission, waiting for input | `Notification` hook | Definite |
| A question from the agent | `PreToolUse` hook (matcher: `AskUserQuestion`) | Definite |
| An answer to the question | `PostToolUse` hook (no matcher; the converter picks `tool_name: AskUserQuestion`) | Definite. Used to show in the UI that the question wait ended, and to recognize a `permission_prompt` caused by showing the question |
| A turn ended on an API error (usage limit and the like) | `StopFailure` hook | Definite. `turn.failed`. `error` holds the kind (`rate_limit` and so on). The UI shows Paused (C38) |
| Allowed (after a permission wait, the tool ran) | `PostToolUse` / `PostToolUseFailure` hook (no matcher; only when the previous Event is `permission`) | Definite. `permission.resolved`. The UI clears Needs you (C30). A denial is invisible because no hook arrives (§6.1s) |
| Judging the meaning of "should the session break here" | A skill such as the clear-timing skill | Semantic (the agent's own judgment) |

Roles are split: hooks do mechanical detection, skills do semantic judgment.
When a skill judges that "a break has come", the agent declares it to the Hub with `report_event` (deferred; below).

**Scope built in P1 (division of labor with the official Agent View, 2026-10-16)**: detecting state is borrowed from the big vendors (§1.1). agent-hub builds only the part "see it in the browser, answer from the browser".
- Borrowed (not built): a state list of every session (estimating Working / Idle / Completed / Failed), replying from the terminal, idle notifications between agents (`notify_when_idle` / `TeammateIdle`).
  The UI does not estimate state from Events. It shows the Events that arrived as they are.
- Built: hook → `POST /events` → resolving the Mailbox → showing "waiting on a question", "waiting for permission" and "turn end" distinctly in the UI. The content is shown too (the question text, `last_assistant_message`, the notification's wording).
  From there a reply is written and delivered to that session through the current sending path (Channels).
- The Notifications Agent View uses (`agent_needs_input` / `agent_completed`) are taken in through the same path as other Notifications. They are distinguished in the converter for Claude Code.
- Questions cannot be answered from the browser. A channel notification is not treated as the answer and arrives after the answer (§6.1c). The UI says so and asks you to answer in the terminal.
- In P1 permission prompts are only displayed. Granting permission from the UI (Channels' permission relay) is roadmap C14 (§6.1). Agent View cannot answer on the spot either, so this is a part that cannot be borrowed.
- Deferred: `report_event` and de-duplicating it against `Stop`. For now, judging the meaning of a break is enough if the agent says it in its reply to the human. Add it once showing `Stop` turns out not to be enough (criterion 2 of §1.1).

**Mapping hook events to Mailboxes**: on a real machine, the stdio server's environment had `CLAUDE_CODE_SESSION_ID`, matching the hook's `session_id` (§6.1c).
This behavior is not in the official docs, though, so means that rely on the shim and the hook sharing the same starting environment are layered on, so it keeps working if it goes away.
- First means: the shim declares `CLAUDE_CODE_SESSION_ID` as attach's `sessionId`. The Hub resolves hook input's `session_id` → Attachment → Mailbox.
  This mapping follows correctly even if the Mailbox is switched at run time with the `attach` tool.
- Second means: the HTTP hook's `headers` send `X-Hub-Mailbox: $HUB_MAILBOX` (with `HUB_MAILBOX` in `allowedEnvVars`). The shim attaches with the same `HUB_MAILBOX`, so the two are tied directly by name (the expansion was confirmed on a real machine).
- Third means: if the header is empty too, the Mailbox name is derived from the hook input's `cwd` by the same rule as the shim (the folder name). Hook input has no role, so a `<folder name>.<role>` Mailbox cannot be found this way (it is found by the first and second means; the startup scripts pass `HUB_MAILBOX`).
- When the second or third means resolves it, that event's `session_id` is recorded on the Attachment, and it is treated like the first means from then on.
Matching by parent PID is not used, because on Windows parent-child relations through shells can break.

**Event IDs**: so that the same break arriving from both the `Stop` hook and `report_event` can be de-duplicated, event IDs are made deterministically from upstream values (`session_id` + a value specific to the hook) where possible (the idea of the SEP's `eventId`).

engram (the user's memory MCP) is used as **the place to persist what was learned at breaks**. The live queue and the subscription table are not put in engram; they are kept in the Hub (for responsiveness).

### 3.5 Subscriptions and roles (R4, R7)

**Mailbox and role are separate axes.** A Mailbox says "who" (continuity, the owner of unread messages); a role says "what job" (what to read).

- Subscriptions are **tied to the Mailbox**. An agent receives deliveries only when it has **explicitly** declared a subscription in one of these ways.
  - **Declaring a role**: specifying a role at attach adds the role definition's default subscriptions. The role stays as an attribute of the Mailbox and carries over after replacement.
  - **`subscribe(topic)`**: subscribes individually in addition to the role's defaults.
- Effective subscriptions = the role's default subscriptions ∪ individual subscriptions. The Hub computes them from the role definition every time, and the Mailbox stores only individual subscriptions (changing a role definition takes effect immediately).
  `unsubscribe` can remove only individual subscriptions. To remove a role default, change the role definition.
- **Role definitions** live in the Hub's configuration file (`roles.json`). Each role has default subscriptions and a description (`description`), and the description is put into the shim's `instructions`.
  Attaching with a role that is not defined is refused (to prevent the accident of a typo silently receiving nothing).
- **Kinds of address**: `to` is `mailbox` (that Mailbox only) / `role` (every Mailbox with that role) / `topic` (every subscriber).
  `mailbox` and `role` messages are received without subscribing.
- While there is only one reviewer, giving just `HUB_ROLE=reviewer` makes the Mailbox name `<folder name>.reviewer` too (§3.3). When a second one is needed, just add `HUB_MAILBOX=rev-b`.
- A role only separates "what to read"; it is **not given the meaning "act automatically on receipt"** (that would fall into the non-goal of autonomous orchestration).
- Topic examples: `user.message`, `agent.<mailbox>`. Events are not sent to topics (§9-2)
- The SEP's `arguments` (filter arguments at subscription time) are not introduced. Only matching topic names. Add them if they become necessary.

**The language of text addressed to the human (C66, decided 2026-10-29, user)**. Even with role descriptions and reply-format headings in English (C64, C65), text addressed to the human is written in the user's language. Twice the leader's reply drifted into English, pulled by English exchanges, and "in the user's language" alone was too weak, so the name of the language is passed explicitly. We do not rewrite role descriptions per language or keep localization instructions.
- **The setting is the Hub's environment variable `HUB_LANGUAGE`** (`.env`). The value is a BCP 47 language tag (`ja`, `en`, `pt-BR` and so on). The Hub normalizes it at startup and stops if it is malformed or names a language whose name cannot be found (`japanese`, `zz` and the like) (if silently ignored, you could not notice that it is not in effect).
- The Hub passes it to the shim as `language` in the attach response, and the shim inserts one line after the role description in its instructions: write text addressed to the human (replies, questions, reports) in that language (its English name and tag, e.g. `Japanese (ja)`), and do not translate the reply-format headings. It goes after the role's description so as not to be pulled by the description's language. Without the setting nothing is inserted.
- It was not put in `roles.json` because `roles.json` is keyed by role name and has no place for one setting for the whole (writing it per role would break the promise of deciding it with one setting). It was not made the shim's environment variable because passing it per session is work, and the place would differ between a Docker Hub and a directly started Hub. In the Hub's `.env` it is one place that affects every session, and it arrives by the same path as the role description (the attach response). The shim stays stateless (§3.1).
- The language line is built from the operator's configuration, not from a body that arrived (outside "the body is data" in §4). If attach times out, the line is not added, the same as the role description.

### 3.6 Delivery and message kinds (R8)

- **Routing (`to` / topic) and kind (`kind`) are kept separate.** A topic says "who receives it"; `kind` says "how the receiver handles it".
  Mixing kinds into topics (`review.request` / `review.result` …) would multiply topics by every combination.
- `kind` is a **closed enumeration** the Hub validates. For now there are the following three. Anything outside it is refused with 400. Add more when needed (a candidate: `handoff` for replacement).

| kind | Meaning |
|---|---|
| `request` | Expects work or a response |
| `reply` | A response to some Message. `replyTo` required |
| `notice` | Information only. No response needed |

- Events from hooks also have a `kind` (`turn.end` and so on), but an Event is a different type from a Message, and the namespaces are not mixed.
- Claude Code is pushed to with Channels' `notifications/claude/channel`. **Claude Code does not ack notifications**, so the shim's ack means only "it could be written to the transport" (the verification result in §6).
- The sender's attributes (`id` / `kind` / `from` / `to` / `seq`) go into `meta` in Channels and are passed as attributes of the outer `<channel>` tag. The body is not wrapped (protocol.md §6). That `</channel>` cannot close the outer tag was confirmed on a real machine (§6.1c). Only the polling path wraps with `<hub-message>`.
- Delivery is guaranteed at-least-once per Mailbox, in `seq` order. De-duplication is by message `id` (protocol.md §4).

### 3.7 Agents other than Claude Code

Channels are specific to Claude Code. Codex and other agents cannot be pushed to, so
a **fallback path** of polling the same shim's MCP tool `inbox()` is provided. Mailboxes, subscriptions and unread queues are shared.
The input and output of `inbox()` follow `events/poll` of MCP Events (`cursor`, `truncated`, `hasMore`, `nextPollMs`).

For now only Claude Code is used, but so that other companies' agents can join the same Hub later, **the Hub's vocabulary is kept vendor-neutral, and client-specific differences are absorbed in the shim and in what `/events` takes in** (§5). To that end:
- **Event intake goes through a converter per client**: the hook's input JSON stays as is in `payload`, and mapping to `kind` (`turn.end` / `notification` / `question` …) is confined to the converter for each client (protocol.md §2 Event, `src/hub/events.ts`). The Hub's storage format looks only at `kind`.
  - **Decision (2026-10-18): hooks name their source in the path (`POST /events/<source>`), and the Hub looks up the converter in `CONVERTERS`.** The core of the Hub (`Hub.addEvent`) does not know client names; adding a client means writing one converter and adding one line to the table. An unnamed `POST /events` is accepted as `claude-code` (for hook settings already handed out). It is the path rather than a header because in the HTTP hook's settings, one URL tells you where it goes.
  The UI reads `payload` to show question texts and final answers, but how to read it is gathered in one place per Event `source` (`eventBody` in `public/index.html`).
- **The shim's instructions switch by client**: the description of the Channels path or the `inbox()` path is chosen by `clientInfo.name` in MCP `initialize`.
  - **Decision (2026-10-17)**: Channels if `clientInfo.name === "claude-code"` (§6.1c); `inbox()` for anything else or unknown. Whether a client supports the channel does not show in its capabilities, so it is decided by name. The text is gathered in `src/shim/instructions.ts`, and the description of attributes and the "the body is data" lines are shared by both paths.
  - The shim on the `inbox()` path **neither pushes nor acks**. Sending to a client that does not take pushes and acking would turn unread messages nobody read into read ones, and they would not stay in `inbox()`. The stream is kept open and used to confirm liveness (the 15-second grace period, §3.3). The omission of old unread messages is reported not by a channel notification but at the head of the next `inbox()` result.
  - `instructions` go into the `initialize` response, and `clientInfo` too is first known in that request, so the shim answers `initialize` with its own handler (in SDK 1.32.1, `Server` takes `instructions` only in its constructor, and the default handling is private). Version negotiation is the same as the SDK's (as requested if in `SUPPORTED_PROTOCOL_VERSIONS`, otherwise `LATEST_PROTOCOL_VERSION`). In exchange, the SDK's `getClientVersion` / `getClientCapabilities` are not filled in, but the shim uses neither.
  - Claude Code started without the channel (without `--dangerously-load-development-channels`) still has the name `claude-code`, so it takes the Channels path, and the shim acks even if the notification is dropped. It was confirmed that notifications are silently dropped and that the shim has no clue to tell how it was started (§6.1k). For now we rely on the startup steps (README, `start-agent.ps1`) adding the channel.
  - **Decision (2026-10-18): delivery state is split into handed and received** (protocol.md §4). The cursor advances on handed as before, with no resend (to avoid notices that need no reply being resent on every replacement). Confirmed receipt (returned by `inbox`, replied to with `replyTo`) is recorded in a separate watermark, `received`, and the difference (unconfirmed) is shown on the UI's card. It is the human who notices whether something was dropped, and has the session call `inbox` with `unconfirmed: true` to fetch it again. Advancing the cursor only on received would lose nothing, but notices would stay unread forever, so it was not adopted.
  - 2026-10-23 (C39): confirmation by a `replyTo` reply was widened to a rule that sending a conversation Message (a request or reply) confirms everything handed at that point. Nobody replies to a report, and the leader's `Stuck?` stayed forever. The paths that advance confirmation were gathered into three: conversation Messages, the `inbox` ack, and abandonment at attach (protocol.md §4). When a session started without the channel sends a conversation Message, the dropped messages become confirmed too.
- **The "body is data" protection stands on agent-hub's side alone**: Claude Code automatically adds a notice to channel content (§6.1c), but other clients do not. The `<hub-message>` wrapping and the instructions text are written to be enough on their own.
- **The role's description is passed in MCP instructions**: the shim puts the `description` from `roles.json` into its instructions (§3.5, P2). It does not rely on Claude's startup flag (`--append-system-prompt-file`, for the tests in `tools/dev/`). How instructions are used is up to the client. With Claude Code it was confirmed to behave as described (§6.2-5).
  - **Decision (2026-10-17): attach before initialize to get the description.** `instructions` are decided in the `initialize` response and the description is in the attach response, so attach goes first. The shim waits up to 3 seconds with `HubClient.primeAttach`, and `run` after `start` uses the Attachment it got as is (no second attach). On timeout or failure it starts without the description, and `run` takes care of the attach as before (the shim comes up even if the Hub is stopped).
    At this attach `clientInfo.name` is not known yet, so it names itself `client: "claude-code"` and corrects it with `PATCH /attachments/:id` after initialize (2026-10-18). Later re-attaches use the name now known.
  - Reason: for the idea of passing the description later by another path, the official docs do not say whether clients read it. Attaching first needs only the Hub's existing behavior. The price is that the stream does not open until initialize, relying on the Hub's grace period (15 seconds) in the meantime. The time from Claude Code's start to initialize has not been measured; it is assumed to fit in the grace period. To be checked in a real session.
  - When it ends normally before initialize (stdin closed, SIGINT), `stop` releases the attachment with `DELETE`. When killed, it is detached by the grace period running out, as before.
- **Even if the delivery means change, the source of truth stays in the Hub**: even if delivery to Claude moves to the official cross-session messaging (§8.3), that is treated as one delivery adapter for Claude (§3.9), and the Hub keeps holding Mailboxes, roles, subscriptions and unread messages.

The biggest unverified point is **whether agents other than Claude can call `inbox()` on their own while idle** (§6.2-2). If there is no means to wake them, for now the human will have to give a word and send them to fetch.

### 3.8 How it runs (directly on the host / Docker)

| | Use | How reachability is limited |
|---|---|---|
| Started directly on the host | Development (P0 on). Fast iteration with `tsx watch` and the like | Bind with `HUB_HOST=127.0.0.1` |
| Docker (compose) | Resident operation (P2). Starts automatically with `restart: unless-stopped`; data lives in a volume | Listen on `0.0.0.0` inside the container, and limit publishing to `ports: "127.0.0.1:7777:7777"` |

- **Only the Hub** goes into Docker. The shim is a child process Claude Code starts over stdio, and hooks are commands on the host, so both run on the host.
- Writing Docker's `ports` as `7777:7777` publishes on every interface, so the `127.0.0.1:` prefix is mandatory.
- The token is not generated automatically at startup but fixed by `HUB_TOKEN` (`.env`), and shared with the shims/hooks on the host.
- The Hub does not read files on the host (such as `transcript_path` in hook payloads). `Stop`'s input includes `last_assistant_message`, which is enough to show the final answer. Both ways of running behave the same.
- The Hub's code only receives the bind address, port, token and data location through environment variables, so it works either way.
- compose (`compose.yaml`, 2026-10-18):
  - Reads `.env` with `env_file`, and overrides only `HUB_HOST` / `HUB_DATA_DIR` / `HUB_ROLES_FILE` / `HUB_CONFIG_FILE` with values for inside the container. `HUB_PORT` uses the same value on the host and in the container (so the UI URL printed in the log opens as is).
  - `roles.json` and `hub.config.json` are read by mounting the repository root at `/host` read-only. With a bind mount of a single file (`configs` too), if the file does not exist Docker Desktop creates an empty directory on the host, which breaks even the direct start (§6.1l). Without the file it runs without roles, the same as the direct start.
  - Data is a named volume. It is not shared with the repository's `data/` (state does not carry over when switching with the direct start).
  - `init: true` delivers SIGTERM to Node so stopping does not hang. The healthcheck calls `GET /mailboxes` with the token.
- Where configuration lives (C74, 2026-10-30): deployment values (token, host, port, directories, retention, unread limits) in `.env`; role definitions in `roles.json`; thresholds the Hub and the page share in `hub.config.json` at the repository root (override `HUB_CONFIG_FILE`, git-ignored, sample `hub.config.example.json`); state the UI rewrites (custom commands) in `HUB_DATA_DIR/settings.json`; per-browser preferences in `localStorage`. `hub.config.json` is read once at startup like `roles.json` and never written, and there is no write API, so holding the browser token does not let anyone change it. Unlike `roles.json` a broken file does not stop the Hub: each bad value falls back to its default and is named in the startup log and in a UI warning, because a typo in a threshold should not take delivery down. It is not in `data/settings.json` because in Docker that sits in a named volume out of reach for hand editing, and one broken entry there makes the whole file `settings_invalid`. Only values with no other source go in it (no value has two sources). The Hub's own facts (upload limits, the effective retention) are served next to it by `GET /config` as `limits`, read-only and not from the file, so the page keeps no copy (C75).
- Starting a team (C62, 2026-10-29): `npm run team` (`src/team/`, run with tsx) starts the Hub if it is stopped and then each role in a tab of its own, one at a time, waiting for each to attach. `npm run team -- agent --role <r>` starts one role in the current terminal; it is also what each role's tab runs. `tools/dev/start-team.ps1` / `start-agent.ps1` are thin wrappers that keep the earlier PowerShell parameters.
  - **Why Node**: the checks (claude runs, hook settings, stale checkout), the Mailbox name, waiting for attach and the summary are the same on every OS, and Node is already required. Written once in TypeScript they can reuse `src/shared/types.ts` (the Mailbox name rule the shim uses) and be unit tested; a PowerShell copy and a sh copy would drift apart. tsx instead of `dist/` so the starter works before the first build (it builds `dist/` for the shim itself).
  - **Only opening a tab differs per OS** (`src/team/tabs.ts`): inside tmux, a new tmux window (any OS); Windows Terminal tabs (`wt.exe`), else a console window via `cmd /c start`; macOS Terminal.app via `osascript`; on Linux outside tmux, a detached tmux session `agent-hub`. GNOME Terminal, Konsole and the like are not opened: each has its own flags, and none is present everywhere.
  - **When no tab can be opened** (`print`, also `--tabs print`): each role's command (`npm run team -- agent …`) is printed in order and the script waits for each attach as usual. The human opens the terminals; nothing else changes, so a missing terminal never blocks starting.
  - A tab runs `node` directly, not through a shell, so it would close as soon as `claude` ends. When `claude` (or the Hub) ends with an error, the tab waits for Enter so the reason can be read.
  - On Windows `claude.exe` is preferred to `claude.cmd`; a `.cmd` can only be started through `cmd.exe`, with the line quoted by the starter.

### 3.9 Delivery adapters (wake / hand over the content)

Delivery to agents is split into two jobs, and differences between clients and delivery means are confined to the shim's **delivery adapters**.

| Job | Content | Means |
|---|---|---|
| **Wake (ping)** | Say only "there is something unread" and get the agent to start a turn | Channels, the official cross-session messaging (§8), `events/stream` of MCP Events (§7), MCP's standard `notifications/resources/updated` and so on. Differs per adapter |
| **Hand over the content** | Hand over the unread body together with the sender's attributes | The `inbox()` tool (wrapped in `<hub-message>`). Common to all clients |

- **The minimum promise is only "the content can always be fetched with `inbox()`".** How to wake is an add-on in the adapter; however delivery means are added or changed, the Hub and `inbox()` do not change.
- Adapters come in three levels:
  1. **Deliver with the content**: hand over the body at the same time as waking. Today's Channels (`meta` + body). One notification is enough.
  2. **Only wake**: wake with a notification that carries no body, and have the agent call `inbox()`.
  3. **Cannot wake**: the agent calls `inbox()` itself, or a human gives a word.
- **The wake-only method also helps the "body is data" protection**: text from outside never enters the agent directly as a notification; it always goes through `inbox()`'s `<hub-message>`. There is one path to protect (§3.7). In exchange each notification costs one more tool call, so Claude Code keeps 1 (Channels) and others use 2 or 3.
- Today the Channels code is confined to [src/shim/channel.ts](../src/shim/channel.ts), which is the first adapter. The socket (interface) for swapping is **built when a second delivery means is added**. No abstraction is built while there is only one.
- With MCP's standard `resources/subscribe` + `notifications/resources/updated`, Claude Code 2.1.303 does not start a turn (it does not even subscribe; §6.1m). Other clients are unverified.

### 3.10 Attaching images

Deliver screenshots pasted in the browser to agents. Images are stored separately, and the message carries only the id.

- **A Message has an open `meta`.** The only thing the Hub interprets is `meta.files`; other keys pass through. Future features need only add keys. `files` is a value the sender sets, so the Hub rewrites it from its records and does not use the sender's mime or size.
- **Delivery puts it in one attribute** (`meta` = a JSON string). Its name does not overlap the attributes the Hub sets (`id` / `from` and so on), so the sender cannot forge them.
- **Normalize before storing**: shrink so the long edge fits 1568px (`HUB_FILE_MAX_EDGE`), apply the EXIF orientation and drop location and the like, and re-encode. Data that cannot be decoded and SVG are dropped here (Content-Type is not trusted). What the agent receives is the stored image, so it matches the image seen in the browser. Having it read an image larger than the limit as is would waste tokens and time.
- **The id is the first 32 digits of the content's sha256.** The same image gets the same id, and resending does not duplicate it (idempotent). If it exists, it is returned without storing.
- **Keep a separate record**: dimensions, mime, size, original dimensions and persistence go in `<id>.json`. The image itself is written first and the record last (it is complete if the record exists).
- **Assume it is volatile**: non-persistent images are deleted after `HUB_FILE_TTL_DAYS` (default 1 day; shortened from 7 days on 2026-10-18; §3.14). Persistent ones are not deleted. Images are part of the Hub's state, so how a deleted one is shown ("expired") is part of the design too.
- **Conventions referred to**: we followed methods common in blog and media management: (a) keep dimensions, mime and size per media item in a record separate from the body, (b) drop EXIF and normalize orientation at upload, (c) de-duplicate by content hash, (d) clean up temporary media no longer referenced after a period, (e) separate derivatives for display from originals. This time the original is not kept; only the derivative remains (leaving room to add derivatives later).
- **The dependency is sharp** (§5). Shrinking with a canvas in the browser would protect only sends through the UI, so it was not adopted.
- **The shim fetches the image and passes a path**: right before delivery, each image in `meta.files` is fetched with `GET /files/:id` and saved to `<HUB_FILES_DIR>/<mailbox>/<id>.<ext>` (default `agent-hub/` under the OS's temporary folder). The file name is built only from the validated id and ext; no string from the Hub goes into the path. The same id is not fetched again. It is written through a temporary file and renamed. The agent opens that path with `Read` to see the image.
  - Delivery becomes the `meta` attribute's JSON with `path` added. If fetching fails, `error` is added instead of `path` (`expired` for 404, `fetch_failed` otherwise). The message is not dropped.
  - Fetching times out after 15 seconds, and over 25MB is a failure. The Hub's values are not rewritten; the fields are added to the copy for delivery.
  - When the shim starts, images older than 24 hours are deleted from the location (only at startup; not at exit).
  - The location is outside the working folder, so `Read` needs permission. `npm run team` (`src/team/agent.ts`) allows the location with `--add-dir`.
  - The shim does not import the Hub's `files.ts`, to keep `sharp` out of the shim.

### 3.11 The request ledger and checkpoints (concept, not implemented)

The core of project management is placed in **a ledger whose unit is one request** and **checkpoints** that are always passed at each boundary.
Only these conventions live in the Hub; delivery adapters, the UI and clients are swappable branches (§1.1).

The idea was borrowed from two places.
- vcp's C96 (rereading OWL for the thesis). OWL is an open world; agent-hub is a closed world. **What we bring in is only "declare relations and shapes, and check them against a closed set"**; RDF / Turtle and open-world inference are not brought in (too heavy).
- The thesis's citation bridge (cite-bridge; SKILL.md and concept memo §2, §10.7, §16.6). It stops drift between what an AI wrote and its grounds with fields that are written and fields that are derived, fingerprints, and human approval. The structure is the same, so we copy its conventions.

| Citation bridge | agent-hub |
|---|---|
| One citation (a sentence of the manuscript → an excerpt → where it is in the source) | One request (request → reply → changes in the working tree) |
| (b) Making a real source say what it does not say | The report drifts from the actual change (changes outside scope, `CHANGED` missing entries, edits after the report) |
| Written fields (verbatim, summary, interpretation) and `@` fields the tool writes | Headings the agent writes (`GOAL` / `SCOPE` / `CHANGED` …) and fields the tool derives (the files actually changed, out of scope, links, state) |
| Approval is tied to the fingerprint of the text and its grounds; if they change, it needs re-confirming | Acceptance is tied to the fingerprint of the reply and the change; if they change, it needs re-confirming |
| The approval HTML (shows the verbatim text first, the AI's candidates after) | The request card in the browser UI (shows the derived facts first, the agent's report after) |
| The classifier only raises flags. Only humans raise the level | The Hub's rules only warn or downgrade to needs-re-confirming. Only humans accept and forward |

- **The unit is one request.** Linked from request to reply with `replyTo`, it holds the assigned role, `SCOPE` and state. Even when the agent is replaced, "the requests open now" are decided on the Hub.
- **Written fields and derived fields are separate.** The agent writes only fields of judgment (the body with headings). Derived fields are written by deterministic processing, and the agent cannot write them. An extension of the same principle as the Hub setting `from`.
  - The Hub does not read files on the host (§3.8), so deriving the facts of a change (`git diff --name-only`, HEAD) is deterministic processing on the host. Whether it is the shim or a hook is open (below).
- **Checkpoints have two levels**, split the same way as the citation bridge's ERROR / NOTE.
  - Structural breakage (a missing required heading, a reply to a request that does not exist, a party and `kind` not in the declaration) is decided mechanically, so it returns 400. The error goes back to the agent that sent it, and rewriting is enough (it need not be made to read the declaration).
  - Waiting for confirmation (changes outside scope, mismatched fingerprints) is accepted and warned about in the UI. The judgment goes to a human.
- **State and fingerprints.** A request's state is one of five: not done / reported / accepted / sent back / fixed after being sent back. Acceptance keeps the fingerprint of the reply's body and of the change; if either changes, it goes back to needs-re-confirming.
  Agents really did keep editing after reporting (2026-10-16, the leader / deployer test). Fingerprints catch this mechanically.
- **Roles and owners.** The tools (Hub, shim) derive and check, the deployer writes, the leader (model) checks, a human accepts. Who checked and who accepted (human / model) is recorded. An agent does not accept a request it issued itself.
- **The decision screen is our own HTML.** On the request card, the derived facts (changed files, out of scope, the state of fingerprints) come first and the agent's report after, so the judgment is not pulled by the report.
  The UI attaches the fingerprint at display time to the acceptance request, and the Hub refuses if it does not match the current fingerprint (preventing acceptance of what was not seen).
- **Rules only go downward.** The Hub's deterministic rules can choose only "do nothing / warn / downgrade to needs-re-confirming". Only humans raise. New checks start as warnings only, and are raised to 400 after seeing how well they agree with human judgment.
- **State the coverage honestly.** "0 waiting for confirmation" is a state about requests that went through the Hub; it does not include work done outside the Hub.
- **The body is not rewritten.** A check decides whether to accept and only adds derived fields. It does not violate "do not summarize or process".
- **Declarations are managed by humans.** The place is P2's `roles.json`, extended (per role, the parties it may send to and the `kind`s, required headings). Made viewable and editable in the browser, and agents get only the parts that concern them through instructions (§3.7).
- **The content of the implementation is not declared.** The code, tests and docs already define the implementation, and closed-world checking is done by tests and type checks. Keeping declarations separately would make two sources of truth that soon go stale. Declarations cover only "the shape of the exchanges" and "the `SCOPE` per request".
- **Do not have the LLM write HTML.** The agent writes text of a fixed shape in the CLI; the Hub knows the shape, so the UI can draw it. How it is drawn can be changed later.

Open questions:
1. **Decision (2026-10-17, user): derive in a hook, only the `Stop` command hook** (`PostToolUse(Edit|Write)` is not built). `tools/hooks/post-event.mjs` adds one field `agent_hub_git: { head, changed, untracked }` to the input JSON and sends it to `POST /events/claude-code`. The Hub does not run git; it only checks the shape and puts it in the Event's `changes` (Event in protocol.md).
   - `head` is the full sha of HEAD. `changed` is `git diff --name-only HEAD`, `untracked` is `git ls-files --others --exclude-standard` (both relative to the root, separated with `-z`).
   - Cut off after 5 seconds; exit 0 on any failure. If nothing can be collected, the input is sent as is. Alongside the HTTP hook's `Stop` it would make two `turn.end`s, so it is used as a replacement (`tools/hooks/settings.command.json`).
   - The idea of taking the diff in the shim at the time of `post_message` is not adopted (it would read the working folder on every send, and stateless computation is not needed here either).
2. What the fingerprint covers: the diff within `SCOPE`, the diff of the whole working tree, or HEAD. While several agents use the same working tree, others' changes make the fingerprint shift (decide together with the worktree in §9-6).
3. When to build it. Following criterion 2 of §1.1, the declaration vocabulary starts from the headings used every time in leader / deployer operation; the vocabulary is not designed up front.

### 3.12 Document conventions and how to check them (concept, 2026-10-17)

What turned out to work in co-developing with AI was, in the end, document conventions (when to read what and add what). This is the center of the "conventions" in §1.1, and the Hub can become the board that checks them.
But written rules eventually fall apart without something that checks whether they were followed. So the conventions are put in a table, and checking is split into three layers.

**The table of conventions** (the map is the "document map" in CLAUDE.md; do not read everything at startup; Grep the section, then Read)

| Moment | Read | Add | Carried by today |
|---|---|---|---|
| Session start | The document map | — | CLAUDE.md (loaded automatically) |
| The leader writes a request | The related sections (the decisions in §9, the non-goals in §2) | If it touches the spec, docs in SCOPE and the docs update in DONE WHEN | leader.md |
| Before the deployer implements | The verification record in §6 | If unverified, check the official docs and add to §6 | CLAUDE.md |
| The deployer's report | — | NOTES lines (sorted to the destinations below) | The deployer standard format |
| The leader checks | The sections related to the change | — (see whether docs are in `git diff --name-only` and whether the content matches the implementation) | leader.md |
| The reviewer returns findings | The request's target (a commit range or an item); for an item, its done-when conditions and body; the sections related to the change; the non-goals in §2; the decisions in §9; rejected `[-] C<n>`. If all of an item's done-when conditions are `[ ]`, look only at the item's wording, not a change (if even one is `[x]`, check the change) | — (each finding carries the location of the source of truth it was checked against (file and section). Proposed corrections to done-when conditions are made only after a human approves. The leader relays them as NEEDS DECISION, with no change as the default) | reviewer.md, leader.md |
| Something was decided | — | "Decision (date)" and the reason under the matching item of §9 | Custom |
| A break (commit, item done) | — | Checking off the roadmap's done-when conditions (when all are checked, delete the section and mark the phase line `[x] C<n>`), engram, MEMORY | The rules at the top of roadmap.md, the clear-timing skill, the global CLAUDE.md |

- **Where NOTES go**: facts checked (the real behavior of Channels and hooks and so on) to §6; what was decided to the decisions in §9; what could not be decided to the open questions in §9; later work to roadmap items (`### C<n>.`; how to write them is at the top of roadmap.md, §3.15).
- **How to write §9**: keep the item's question, and add "Decision (YYYY-MM-DD)" and the reason below it. Do not delete it.
- Today the carriers of this table are scattered across CLAUDE.md, leader.md, deployer.md, the global CLAUDE.md and skills. Each file will move toward just pointing at this table.

**Three layers of checking**

1. **Deterministic checks (no AI).** Most breakage is caught here. As scripts on the host (e.g. `npm run docs:check`). The Hub does not read the working tree (§3.8), so they are run in the leader's checking steps or a Stop hook, and the results are sent to the Hub as a notice or Event and lined up in the UI.
   - Map drift: does each § in CLAUDE.md's map exist as a heading? Have headings not on the map appeared?
   - Drift between declarations and tables: are all of `app.ts`'s routes in protocol.md §3's tables? Do `EVENT_KINDS` / `MESSAGE_KINDS` match protocol.md?
   - Missing additions: the deployer's `CHANGED` (in DCP form, so the Hub can read it too) has `src/` but no `docs/`.
   - Breaks in how things are written: a "Decision" in §9 without a date.
   What corresponds to the citation bridge's "if the text changes, go back to needs-re-confirming" is matching the code's declarations against the docs' tables.
2. **A lightweight judge** (something like the thesis's Jev). Given only what layer 1 cannot decide, for example sorting "is this NOTES line a fact, a decision, or neither?".
3. **The leader and humans.** Whether what the docs say matches the meaning of the implementation. Subtle drift remains here.

**What a lightweight judge needs** (from evaluating the citation bridge, 2026-10-15: blatant alterations were caught 20/20, subtle ones 1/12, real misreadings 2/7):
- Narrow it to one question and have it answer with closed, ordered labels (e.g. match < stale < contradicts). Raise a flag only when it judges the case heavier than the record.
- Cut out the input deterministically and hand it over (build the pairs to compare from the map and the changed files). Do not make the judge search.
- Collect evaluation material during operation first (drift layer 1 missed and the leader or a human found). Measuring with examples made after finding the errors inflates the score.
- Warnings only. Its place is "a watchdog for blatant drift".

**How to proceed**: build layer 1 first. For layer 2, measure whether it is worth building once drift missed by layer 1 has accumulated. While there is no material, what to prepare for it to work properly is undecided, so it is not built (criterion 2 of §1.1).

**Send review requests by target, not by a stretch of conversation** (concept, 2026-10-26; C45, C46, C47)

kanary's /relay (§8.1) sends the conversation since the previous relay as a stretch, to have another vendor's agent evaluate it. The idea is to grow the receiver's thread as a copy of the sender's conversation, adding only what is new; while the receiver's context continues, it is cheap and correct.
In agent-hub it does not fit, for two reasons.
- Context is deliberately short-lived (the disposable leader in §3.13, `/clear` at breaks, replacement). If only a stretch arrives after the context was cut, the receiver evaluates without knowing the premises.
- A stretch of conversation carries the sender's line of reasoning, so receiving it continuously pulls the receiver toward that frame too, and the independence of a second opinion thins. A stretch is cut by time, and it overlaps the unit you want evaluated (a proposal, a diff) only by chance.

So an evaluation request sends only the **target** (a commit range or `C<n>`) and the **question**, and what to check against is held by rules on the receiver's side (the reviewer row in the table of conventions and the role's description). The receiver reads the sources of truth in a fresh context for each request, so there is no need to accumulate and chase updates.

| Layer | What goes there | Source of truth | What the receiver does |
|---|---|---|---|
| Knowledge | The conclusions of discussions (facts in §6, decisions in §9, `[-] C<n>`, items) | Documents and engram | Reads it when a request comes |
| Signals | "§9-4 was decided", "C12's done-when conditions grew" | The Hub (topic subscriptions, §3.5) | Only sessions that hold context long (the leader) receive them and learn their understanding is stale. Whether this is needed is checked in C46 |
| Reading points | Where the sources of truth to check in a review are | The reviewer row in this table and reviewer.md | Reads only those for each request |

- The Hub carries signals (pointers to places) and no further; it holds no knowledge (§3.14).
- What we take on instead is **the convention of gathering the conclusions of discussions into documents**; if not gathered, discussions disappear with the Messages' retention period and never reach the reviewer. Where NOTES go (above) and sorting requests without items (§3.16) carry half of it. Keeping the documents in order directly becomes the quality of reviews.
- The UI's Relay (`A → B · N new`, §3.2) stays stretch-based (it suits discussing together).
- For something like the ease of starting a consultation (kanary's single word), there is an idea of a "consult" button on the leader's report, built as a Forward with a fixed question as the covering note (C47). A report is a unit of meaning, not a stretch cut by time, so it does not contradict the policy above.

### 3.13 Session lifetime and context (concept, 2026-10-17)

**Who takes care of starting and stopping**

| From where | Possible | Reason |
|---|---|---|
| Hub | No | It is assumed to run in Docker and cannot start processes on the host (§3.8) |
| shim | Not recommended | MCP has no means to end the client. Killing the parent process is outside the conventions, and on Windows even identifying the parent is doubtful (§3.4) |
| A supervisor on the host | Yes | Stops it if nothing moves for a while after `turn.end` (§3.4), and starts it and has it attach when something unread arrives. The Mailbox holds the unread messages and subscriptions, so no request is lost by stopping it (R5 / R6) |

- **The wall**: Channels require an interactive session, and a warning dialog appears at every start (§6.1). Starting unattended would mean the `claude -p` and `inbox()` (P2) path.
- **The boundary with the direction**: starting on a request a human pressed Send for is within automating the hauling. Another agent starting automatically on a request between agents falls into autonomous orchestration (a non-goal in §2). If it is ever added, it is treated the same as the opt-in for delivery rules.
- **A channel body does not become a command**: sending `/clear` and the like only arrives as a body (§6.1h). To discard the context, end the session and start again with the same Mailbox (replacement, §3.3).

**Context and cache**

- An idle session uses no tokens. The prompt cache expires in a few minutes (an hour depending on settings), and resuming after it expired costs about the same to reread the whole history whether it was kept alive or `--resume`d. Compaction also changes the prefix and breaks the cache. Whether to drop a session is decided not by cost but by **whether to carry the context over**.
- Patterns among orchestrators out there (survey of 2026-10): keep the lead thin by delegating (subagents run in a fresh context and return only a summary), write state to files and reread it after compaction or restart, automatic compaction, a loop that starts a new session for each round. The common core is **context is disposable, state lives outside**.
  State that exists only in the head disappears with compaction (there is a report of the agent teams' lead forgetting the team existed after compaction; 2.1.34).
- Guidelines per role: the deployer can be fresh for each request (the request text is self-contained with `GOAL` / `SCOPE` / `SPEC` / `DONE WHEN`). The leader is kept alive long or resumed, with `/clear` at breaks. Knowledge to carry over moves to engram, or a future `handoff` (§3.6).
- **What is missing: the leader's in-progress state.** What has been requested of whom and which replies it is waiting for exists today only in the leader's context. If the §3.11 ledger can list "the requests this Mailbox issued that have no reply yet" (with SCOPE), a new leader can read the ledger and resume. **The ledger is a part of checking conventions, and at the same time a part that makes the leader disposable.**

Open questions:
1. Whether to build the minimum version of the ledger (a list of unanswered requests) before the checks of §3.11.
2. Whether the trigger to discard the leader is placed with humans (Send, `/clear`, exit) or with a supervisor.

### 3.14 What the Hub holds and does not hold; retention (2026-10-18)

**Principle**: the Hub is infrastructure for connecting, and holds only **state for addresses and delivery**.
- Holds: Mailboxes (name, role, project, subscriptions, cursor, received), Messages in the middle of delivery, requests awaiting a reply.
- Does not hold: knowledge (summaries, handoff notes, decisions). The repository's documents (§3.12) and engram hold those. Nor does it compress or summarize Messages to keep them.
- Agents' volatility is a source of lightness, and the Hub matches it by discarding content early. Nor does the Hub hold an index for when documents grow (in order: make CLAUDE.md's map hierarchical, generate it from headings and check it; if search is needed, that is the domain of engram and the like). What the Hub carries is at most a pointer to a place inside a body ("see design.md §3.3").

**Configuration is not state**: `hub.config.json` (§3.8) is read once at startup, is never written by the Hub, and is not kept in `data/`. The Hub serves its validated values with `GET /config` (protocol.md §3).

**Messages deleted automatically** (at startup and every hour). Those that meet all three:
1. **Handed over**: `cursor ≥ seq` in every existing receiver Mailbox. Those without a receiver Mailbox (messages to `user`, to a topic without subscribers) count as handed over when sent.
2. **Old**: older than `HUB_READ_RETENTION_HOURS` (default 24 hours) from `ts`.
3. **Not a request awaiting a reply**: a `kind: request` for which there is not yet a Message with it as `replyTo`, and which has not been closed by a later Message from the other side (protocol.md §2, C28), is kept (the basis of the ledger in §3.13; decision a of §9-8).

- Unread messages are not deleted automatically. Old unread messages become abandoned by the attach limit (§3.3), and meet 1 there. Unread messages of a Mailbox with no attach remain (cleaning up Mailboxes is §9-3).
- Messages handed over without confirmed receipt (unconfirmed, protocol.md §4) also meet 1. They can be fetched again with `inbox`'s `unconfirmed: true` only during the retention period.
- Events (only shown in the UI; §9-2) are deleted by 2 alone.
- Sending with a deleted Message as `replyTo` is 400 `reply_to_not_found` (send again with `to`). Requests awaiting a reply are not deleted automatically, so this does not happen with ordinary replies.

**Images**: the default TTL of non-persistent images was changed from 7 days to 1 day (`HUB_FILE_TTL_DAYS`). Deleting a Message keeps its images until their TTL (several Messages can point at the same image through forwards, so references are not counted).

**Deleting by hand**: a human's judgment, not bound by the automatic conditions.
- The UI's **Delete** on a Message (one; deletes it even if unread or awaiting a reply). `DELETE /messages/:id`.
- The UI's **Purge read** (deletes now, without waiting for the retention period, the Messages that meet 1 and 3, and all Events). `POST /messages/purge`.
- Deleting a Mailbox (§9-3) is as before.
**Compacting the log**: deleting appends a deletion line to the JSONL. When the automatic cleanup deleted one or more, the file is replaced by one containing only the current state (written to a temporary file and renamed). Manual deletions are compacted at the next cleanup (within an hour, or at the next start).
The compacted file's head records the last `seq`, so seq never rolls back (rolling back would misalign the shim's `after` and cursors; the known issue "the shim's seq rollback" in the roadmap). The same line carries `answered`, and closing requests is not re-derived from Messages up to that seq (the closed ones are written on `replied` lines; C28, protocol.md §2). The seq at the deletion of deleted Mailboxes, the seq at subscription, and the seq at which a role was taken are kept too.

### 3.15 Showing the backlog, and requesting work from roadmap items (concept 2026-10-18; implemented in C6, C8, C26, C37, C42)

Think about what lies beyond the Hub and Mailboxes while keeping to what the Hub does not hold (the non-goals in §2, §3.14). No rush; decide from rules.

**Metaphor: the menu and the order slip.** The roadmap is the menu (the repository's source of truth; the Hub does not hold it), a request is an order slip (the Hub holds it, and it disappears once handed over; those awaiting a reply are kept; §9-8), and the agents are the kitchen.
What the Hub holds is only the order slips and a pointer to "which item the order is for", which fits within "carry up to a pointer to a place" in §3.14.

**Backlog badges** (direction agreed, 2026-10-18). The material is already on the Hub (unread, handed without confirmed receipt, requests awaiting a reply, waits on questions and permission). They are split by **whose court the ball is in** rather than by count.

| Layer | Meaning | Examples |
|---|---|---|
| The human's move | Stops if left alone | Waits on questions and permission, requests issued to the human on the Hub, requests that got a reply but have not been accepted |
| The agent's move | Just wait | Requests handed over with no reply yet, unread messages |
| Suspect | Delivery is stuck | Handed but without confirmed receipt, unread messages piling up in a Mailbox with no attach |

Pressing a badge jumps the thread to the oldest thing it counted (for Messages, the line of `oldestSeq`; for questions and permission waits, the Event's line) and highlights it. If it is hidden by a filter, the badge says so (C44).

- Next to the count, the age of the oldest is shown by color. The tab's favicon / title shows only the count of "the human's move".
- All of these are delivery states, so they can be built while keeping the principle of holding no knowledge (§3.14).

**Implementation (C6, 2026-10-19).** The Hub returns the material (unread, requests awaiting a reply, awaiting confirmation; counts and the oldest ts) without overlap in `backlog` of `GET /mailboxes`, and the UI assigns them to layers (protocol.md §3).
- The human's move: a last Event that is an unanswered question / permission (the same decision as the card's `Last event`), and requests awaiting a reply that were issued to the human on the Hub (addressed to the human in `outgoing.to`; C40, 2026-10-23). Counted by one UI function (`humanTurnOf`), used by the card state (Needs you) and this badge (You). The tab title, favicon and the count of waits in other projects use `tabWaitingOf` (which adds one for each card waiting on an unconnected party; the C49 paragraph below). Awaiting acceptance is not included yet (open question 4 below).
- The agent's move: unread messages of connected Mailboxes, and requests handed over with no reply.
- Suspect: handed-but-unconfirmed messages excluding requests awaiting a reply, and unread messages of unconnected Mailboxes. With Channels there is no confirmed receipt until the receiver sends a request or reply (protocol.md §4), so unless requests awaiting a reply are excluded, a request being worked on would show both as the agent's move and as suspect. When the receiver next sends a conversation Message (a request or reply), everything handed at that point becomes confirmed (C39). Until then, or until the retention period, it stays suspect.
- The color thresholds (minutes, notice / late) are: the human's move 0 / 10, the agent's move 30 / 120, suspect 10 / 60. Fix them if they do not fit in operation.
- The sidebar shows totals for the selected project; the tab title (`N waiting`) and favicon show the human's moves of "Needs you" across all projects (`tabWaitingOf`, including one for each card waiting on an unconnected party; C49). The count of waits in other projects (`N waiting in other projects`) is also the total of `tabWaitingOf`, counted the same way as the tab. The favicon shows an amber badge with the sum of that count, Stopped cards and new arrivals while hidden (white outline); with none of those it is a hub in the working color while someone works, else the plain hub (C70).

**Card states (2026-10-22, user).** The count layers alone did not show who was moving now (§6.1p). The card shows one state, emphasized by its frame. The Hub holds no state; the UI derives it from `lastHanded`, `outgoing` and `awaitingReply` of `backlog` and from the hook Events (protocol.md §3).
- Decided top-down: Offline (no connection; faded) → Needs you (there is a human's move: an unanswered question or permission, a request awaiting a reply issued to the human on the Hub, or a notification that automatic resume after a usage limit is not continuing (`quota_auto_resume_stale` / `_disabled`). Amber frame, with `question`, `permission`, `request`, `usage limit, press Enter` or `usage limit, auto-resume off` added. If every party being waited on is unconnected, `<Mailbox> not connected` is added (C49)) → Paused (the last Event is `turn.failed` with `error: rate_limit`; while stopped by a usage limit. Teal frame with a ⏸ mark. Checked before Working, because the Hub has no Event at the moment it stopped and only the handed Message remains, which would read as Working. Cleared by the next Event: after the `quota_auto_resume_fired` notification it goes back to the checks below, and `turn.end` clears it too. C38) → Working (unread while connected, or the last handed Message is newer than the last `turn.end`, since Channels start a turn when handed. Blue frame, with the first line of the request added) → Waiting on others (the turn ended and requests it issued have no reply. Purple dotted frame, a ◔ mark and the addressee. The color was separated on 2026-10-23 to tell it from blue, working) → Stopped, no reply (the turn ended and a request handed to it has no reply. Red frame. C34's idea. However, if the last `turn.end` still has a background task running and it is within 60 minutes of that end, it shows Working with `background: <the task's description>`. C43) → Idle.
- Within Waiting on others, if none of the parties being waited on (the `recipients` of `outgoing.to`, excluding messages to the human) is connected, it becomes Needs you with `(<Mailbox> not connected)` added. When that party attaches it goes back to Waiting on others. A leader that sent a request to a reviewer that had not been started ended its turn waiting for the reply, and the human could not tell why it stopped (C49, 2026-10-27, user). The decision sits at Waiting on others, after Working. It is not part of `humanTurnOf`, so it is not counted in the You badge (the unread shows as Stuck? on the other party's card, so the same Message is not counted twice). It is counted as one in the tab title and favicon. What was decided on 2026-10-27 as "only on the card" was changed to count in the tab and favicon (user's decision, 2026-10-27). The same day, the count of waits in other projects was made to count the same way as the tab (user's decision, 2026-10-27).
- A turn that ended waiting on a background task (C43, 2026-10-28). A deployer that ended its turn with tests running in the background returns when the completion notice starts its next turn (§6.1t), so that interval is not shown in red. The material is `background_tasks` in `turn.end`'s payload, and the Hub passes it as `backlog.lastTurnEnd.running` (a count and the first task's `description`; so as not to rely on the UI's local window; C41). The limit is 60 minutes (`BACKGROUND_MAX_MINUTES`); after it, it goes back to Stopped. This keeps a turn that ended leaving a never-ending task (a development server and the like) running in the background from staying Working. The UI redraws cards past the limit in a review every 30 seconds. Used only in place of Stopped, not for Idle (no request awaiting a reply). A session holding no request has nothing to tell the human even if it leaves a task running.
- Waiting on others is checked before Stopped. While waiting for the reply to a request it issued, it is not stopped even if a request handed to it has no reply (it replies after the reply comes). On 2026-10-23 it was confirmed with headless Chrome that after the leader handed to the deployer the card became Waiting on others (deployer) (the record of C40).
- For the latest Event and the latest turn end, the newer of the Events at hand (the latest 200 and new SSE arrivals) and the Hub's `backlog.lastEvent` / `lastTurnEnd` is used. Relying only on what is at hand, on a day with many Events from other Mailboxes a quiet Mailbox's turn end fell out of the window and showed `Working?` by mistake (review of 2026-10-23, C41).
- Questions and permission waits issued by another session before the current connection are not counted as the human's move. After restarting the terminal or after a takeover, they cannot be answered in that terminal. Those issued after the current connection are counted even if the `session_id` differs (it can change with `/clear`; §6.2-7). When there is no connection they are counted, since the terminal may still be there.
- A session with no Events at all probably has no hooks and does not know about turn ends. Working gets a `?` to show it is a guess. An old handover (12 hours) whose hook Events were deleted by the retention period is not considered work in progress.
- Above the sidebar, the count per state (not Idle and Offline) is shown above the count-layer badges. The count layers stay (age and stuck delivery do not show in the state).
- Awaiting reply and outgoing are closed by a `replyTo` reply, and also by a later request or reply from the other side (C28, protocol.md §2). This keeps Stopped and Waiting on others from lingering when the human answered a question with a new request, or only the later of two consecutive requests got a reply. The addressee of Waiting on others uses the Hub's `outgoing.to`. Messages to the human appear under Needs you, so they are not included (C40).
- Several requests issued in parallel to one party are all closed by a reply to one of them. During that time, Stopped and Waiting on others do not appear even if the remaining requests have no reply.

**Reply format and how headings are shown (C42, 2026-10-23, user).** The leader's reply section `要対応` mixed confirmation of work (may I commit?) with judgment (interpretation of the design), and a reply of just `commit and push` let even the judgment fall to the default (cite-bridge's C4, C6).
- The leader → user format was split into `結果` / `確認` / `未確認` / `要判断` / `要操作` (now `RESULT` / `VERIFIED` / `NOT VERIFIED` / `NEEDS DECISION` / `NEEDS ACTION`; the English vocabulary below) (`tools/dev/roles/leader.md`). NEEDS DECISION carries numbers and "the default if there is no answer", and if the next instruction comes without an answer, the leader writes in the item's record that it took the default.
- The UI bolds headings at the start of a line in the body (the words of the leader's and deployer's formats), gives the NEEDS DECISION section an amber background and left border, colors the NEEDS ACTION heading amber, and the NOT VERIFIED heading red. A section whose content is "none" or "-" is not highlighted. The body is not changed; only the display (§2's "carry the content as is"). The earlier format's `要対応` is shown the same as NEEDS DECISION.
- NEEDS DECISION is not counted as the human's move (a means to clear it once answered would be needed).

**Choosing a roadmap item and requesting it**
- Choosing an item's card in the UI and pressing Send makes a **draft** request (e.g. `GOAL: C95`, with the item's done-when conditions in `DONE WHEN`). A human reads and fixes it, then presses Send. It is not sent automatically (§2).
- The request carries the item's ID. Per item it can show "requested / reported / awaiting acceptance", which is the same thing as the minimum version of the ledger in §3.11 and the part that makes the leader disposable in §3.13.
- What goes in the body is not a copy of the item but **a pointer**. The agent reads the latest from the repository.

**The roadmap is updated during implementation.** Since it is a pointer there is no drift in content, but after sending, **the request's promise can move**. Changes are split in two.

| Change | Examples | Handling |
|---|---|---|
| Adding progress | Implemented, checked, the status changed | Allowed automatically and shown on the card (updates during implementation are the normal flow) |
| Changing the promise | Scope, done-when conditions, a change of direction | Waits for human approval. The diff since the time of sending is shown on the card |

The request carries the fingerprint of the promise part at the time of sending, and if it changes, it needs re-confirming (the same convention as the fingerprint in §3.11). Whether a machine can tell them apart depends on whether the way items are written fixes where the promise part goes.

**Rules for writing items** (the groundwork for the two above; refining the roadmap is expected to become the focus of development)
- The model is vcp's `docs/TODO.md`. Its headings are `### C95. Title (history)`, and `scripts/doc_index.py` builds the table of contents at its head (`L1979 — C95. …`) from the headings. Agents often write with C numbers even without being told.
- As it is, history and current state are mixed in free text inside the parentheses (e.g. `(2026-08-05 design discussion → 2026-08-09 change of direction, … blocked)`), and it cannot be sorted by state.
- The "C" happened to come from a chapter mark (vcp's `C. 設計済・未実装の機能` ("designed, not implemented"), traders' `§C`), and the letter has no meaning. In vcp only chapter C has numbered sections, and other chapters (A's checklist and so on) cite C numbers like `(C99)`. Finished items are moved from `C-完了` ("C-done") to DESIGN_LOG.md, so only open items remain in the TODO.
- Inside sections the shape `#### Facts` / `#### Why look` / `#### Implementation` / `#### Remaining` (checkboxes) is already common. "Remaining" is effectively the done-when conditions.

**Decision (2026-10-18, user)**: prefer the best form as a TODO / roadmap convention, and avoid redundancy in the data (special symbols, long IDs). Write less, and do not write what can be derived.
- **The ID is `C<n>`** (one letter + a sequence number). The letter is there so `C95` can be found uniquely with Grep in bodies and commits (numbers alone cannot be told apart from § numbers or numbered lists). It is C because agents already write it that way and nothing needs rewriting. The mark does not change per chapter. Numbers are not reused within a project. Telling projects apart is held by the Hub's `project`, so it is not part of the ID.
- **The heading is `### C<n>. Title`.** Nothing about state or dates goes after the title (dated history goes in the body).
- **The status is one line right after the heading**, `Status: proposed | held(<condition to resume>) | blocked(after C<n>)` (the condition to resume a held item is not omitted; the Japanese words `状態: 提案 | 保留(…) | ブロック(C<n> の後)` are equivalent, see "English vocabulary" below). These three are the only words, and without the line the item is decided (may be started). Only exceptions are written, so the cards without the line are themselves the menu "you may choose and request".
- **The promise part is `#### Done when` inside the section** (a list of checkboxes). It is copied to the request's `DONE WHEN`, and the fingerprint of the promise is taken only within this heading. Other headings (facts, history, records of implementation) can be added to freely as progress.
- **What is derived**: progress (the count of done-when checkboxes), requested / reported (the Hub's requests), done (gone from the ledger, or all done-when conditions checked; git), age (git blame), related § (links in the body). The written and derived fields of §3.11. Breaks in format can be checked by layer 1 of §3.12.
- Weight (S / M / L), importance, and who does it (`human | agent`) are added once we know they are used.
- **A card is one line** (e.g. `C95 · final cut at the break's length limit · held · 2/5 · requested`). Opening it lets you read the section. A card is a drawing of the mechanical index, so it is not built as a separate feature.
- Which file it goes in, and whether finished items are deleted or kept, is left to the project's map.
- The rules make only the unit of an item common across projects; how the map is written (vcp separates TODO and ROADMAP, agent-hub has phases and items in one) is left to the project. The common rules themselves become the "conventions" of §1.1, and the UI can show the same cards for any project. Only the plan list and the dates on closed lines were made common, by the decision below.

**The plan list, and how to answer about the plan (decision 2026-10-27, user; C51, C52)**. An agent asked to "show the implementation plan from the roadmap" read the whole ledger and classified states itself. Because only how items are written was common, and the order and the record of finished items were left to each project, the order was written nowhere, `proposed` served both as "awaiting a human's decision" and as "an idea parked until a condition comes", and the record of finished items buried the plan. The Hub's Items also showed states mixed in number order. So that the answer of an agent talking with a human and the Hub's display point at the same thing, the following are made common across projects as the ledger's base points.
- **The plan list**: the ledger has one `## Plan` (`## 予定` in Japanese), listing the items without a status line and the `blocked` items in the order they will be taken up, as `- [ ] C<n>` (no title; it is taken from the index). These two kinds are always listed, and nothing else. Blocked items are listed after the item they wait for. Reordering is a human's decision, and the order is treated as progress (not part of the promise's fingerprint). Having phases or not is up to the project.
- **Separate the meanings of states**: each of the four tiers corresponds to one state. `proposed` is only "awaiting a human's decision". `blocked(after C<n>)` is only for waiting on another item, with `C<n>` written in the reason. Things that wait on an outside event (an update to the official docs, the next time a usage limit is hit, material accumulating in operation and so on) are `held(<condition to resume>)` even if decided, and the reason is not omitted. In C51's implementation on 2026-10-27, making C19, C20 and C38 (which wait on outside events) blocked mixed them into the plan and showed them in both tier 1 and tier 3 of the four tiers, so it was changed to this form (user). Blocked is used only for decided items (with done-when conditions). An undecided item that waits on another item is written `held(after C<n>)` (2026-10-27, decided by the user after C51's review). Something accepted but not to be worked on (e.g. C5) is not held but rejected, `[-]`.
- **Dates on closed lines**: a `[x] C<n>` / `[-] C<n>` line has the date it was closed (`YYYY-MM-DD`) **at the head of the parentheses at the end of the line** (e.g. `- [x] C44 Title (2026-10-27, requested by the user)`; for a rejection `(rejected 2026-10-27, reason)`). This avoids confusion with a date inside the title (2026-10-27: a review read C25 as one day older). Where the lines go (under phases, a list at the end, another file) is left to the project.
- **How to answer**: an agent asked about the plan first runs `docs:check` to see whether anything is broken, then answers in four tiers from the JSON of `npm run -s docs:check -- --index`, without reading the whole ledger. 1 Plan (in order, with progress of done-when conditions; for blocked items, what they wait for), 2 Awaiting a decision (proposed), 3 Parked (held, with the condition to resume; with progress if any), 4 Recently closed (the five newest by date; on the same day, in the ledger's line order). For a ledger without a plan heading, decided and blocked items go into tier 1 in number order, and tiers 2-4 are answered as they are.
- **The content of an item is seen in a modal (decision 2026-10-27, user; C54)**. A one-line card cannot show all the done-when conditions. The modal opened from a card shows what the index holds (ID, title, status and reason, each done-when line with `[x]` / `[ ]`, requested / reported and the diff of the promise), plus a request draft and a link that opens that section of the ledger in the editor (`vscode://file/<project>/<source>:<line>`). The body (history, facts, records) is not put in the index and is not copied into the modal. If the Hub held a copy of documents it would stay stale (§3.14, the index decision above), and the source of truth can be read in the editor. The sidebar's width can be changed by hand, and the browser remembers it.
- **The Hub's Items show the same four tiers**, with the parked tier collapsed by default. The index is sent automatically after a commit that changed the roadmap (a git post-commit hook). Because of forgetting to send, the copy of 10-21 stayed for six days (it hit "once it becomes noticeable" of open question 2).

**English vocabulary (C64, 2026-10-29, user)**. Making the documents English for publication (C65) makes the ledger's words and the leader's reply-format headings English too. Other projects' ledgers and earlier replies left in the logs stay Japanese, so the readers (`src/shared/roadmap.ts` and the UI's `bodyOf`) accept both sets of words. A ledger mixing them is read line by line, and the index (the JSON of `--index`) has the same shape regardless of the words (states are `decided` / `proposed` / `held` / `blocked`). The checker's messages stay in Japanese (outside C65's scope).

| Ledger word | Japanese | English |
|---|---|---|
| Status line | `状態: 提案 \| 保留(再開の条件) \| ブロック(C<n> の後)` | `Status: proposed \| held(<condition to resume>) \| blocked(after C<n>)` |
| Done-when heading | `#### 完了条件` | `#### Done when` |
| Plan heading | `## 予定` | `## Plan` |
| Parentheses of a rejected line | `(却下 YYYY-MM-DD、理由)` | `(rejected YYYY-MM-DD, reason)` |

English status words are accepted only in lowercase; `Status: Proposed` or an unknown word is an error, the same as a broken Japanese line (it is read as a status line, so it is not mistaken for decided).

| Reply-format heading (leader → user) | Earlier Japanese | How the UI highlights it |
|---|---|---|
| `RESULT` | `結果` | Bold only |
| `VERIFIED` | `確認` | Bold only |
| `NOT VERIFIED` | `未確認` | Heading in red |
| `NEEDS DECISION` | `要判断` (and the earlier format's `要対応`) | Background and left border |
| `NEEDS ACTION` | `要操作` | Heading in amber |
| `SKIPPED` | `見送り` | Bold only |

- The words were made uppercase to match the deployer's format (`CHANGED` / `VERIFIED` / `NOT VERIFIED` / `NOTES`) and the reviewer's (`FINDINGS` and so on). `VERIFIED` and `NOT VERIFIED` mean the same in all three roles.
- **Reply-format headings are fixed in English.** The same words are used whatever the user's language, and they are not translated. Headings are markers the UI and the leader read (machine words), and changing them per language would make readers hold as many words as there are languages. Text addressed to the human is written in the user's language (how the language is decided is C66). The Japanese headings remain so earlier replies and other projects' role descriptions can be read.
- Rewriting the role descriptions (`tools/dev/roles/*.md`) with English headings is C65 (done 2026-10-29).

**Where to build the index** (the Hub does not read the working tree; §3.8)
- a. The browser reads the repository directly with the File System Access API. Adds nothing to the Hub, but needs folder permission per project.
- b. A script on the host (a sibling of `docs:check`) sends the index (ID, title, state, location; no body) to the Hub, and the Hub holds it as a cache that can be rebuilt.
- c. Send it with the Stop hook (the same shape as `agent_hub_git` in §3.11).

Open questions:
1. How to write items: the shape of the heading, the status vocabulary, where to write the promise part (done-when conditions and so on). Decide first, using vcp's real one as a model.
   **Decision (2026-10-18, user)**: the decision in "Rules for writing items" above. **It is tried on agent-hub's own development** (2026-10-18, user). The work of building this mechanism itself proceeds by requesting roadmap items written by the rules.
2. Where the index lives (a / b / c above).
   **Decision (2026-10-19, user)**: b. `npm run docs:index` sends the result of `parseRoadmap` (ID, title, state, the wording and fingerprint of the done-when conditions, the line; no other part of the body) with `PUT /indexes`, and the Hub holds it in `indexes.json` as a copy that can be rebuilt (protocol.md §3). No browser folder permission is needed, and the Hub still does not read the working tree (§3.8). A human or an agent resends it, calling it after changing the roadmap (making it automatic with c's Stop hook waits until forgetting to send becomes noticeable).
   **Decision (2026-10-27, user; C52)**: forgetting to send became noticeable, so it is made automatic. The method is a git post-commit hook (`tools/hooks/post-commit-index.sh`). It runs `npm run docs:index` only on commits that changed `docs/roadmap.md`. c's Stop hook is not chosen: Stop happens after an uncommitted working tree, and does not have the HEAD fact of whether that commit changed the ledger. Whether it cannot send, has no token, or fails in any way, it exits 0 and does not stop the commit (a failure is one short line of warning). The index also sends the plan order (`plan`) and closed lines (`closed`), and the Hub holds them (protocol.md §3).
3. Whether to hold the item's ID in a heading of the request's body or in the Message's `meta`.
   **Decision (2026-10-19, user)**: `meta.item` (protocol.md §2). The ID is also written in the body's `GOAL`, but the UI decides by meta (the Hub does not interpret bodies). `meta.item` holds the fingerprint of the promise and the wording of the done-when conditions at the time of sending, and the diff is shown by comparing them with the current index. The fingerprint is taken only from the wording of the done-when conditions (`promiseFingerprint`) and does not change when boxes are checked (adding progress is free; changing wording is changing the promise).
   **Decision (2026-10-30, user; C77)**: agents can set `meta.item` too, but only through a dedicated `item` argument of `post_message` (`C<n>`), not an open `meta` argument; the shim builds `{ id, project, source: null, promise: null }` with `project` from its Mailbox. A reply without `item` inherits the original's `id` and `project`: the shim reads the original with `GET /messages/:id` at send time (it keeps no record of what it delivered, §3.1), and the Hub still interprets only `meta.files`. `parent` (the Message being handled when this one was sent) is not adopted: nothing reads it, and it is ambiguous when an agent handles several Messages at once. Item cards keep meaning the human's request: only requests from the human (not from a Mailbox, not an unedited forward) count as an item's latest request.
   Requested / reported is shown by whether the latest request pointing at that item has a reply. Requests that have been handed over disappear with the retention period (§3.14), so "reported" disappears from the display in about a day. That is fine until acceptance (open question 4) is added.
4. Whether to include awaiting acceptance in the badge's "the human's move" (the states of §3.11 are needed first).

**A project is a value (decision 2026-10-20, user)**
- A project is not made an entity; it stays a value, the path of a working folder. The same value appears as the Mailbox's `project` (attach's cwd), the role address's `Address.project` (§9-7), the index's `project`, and the Event's `cwd`. When compared, the same normalization as attach's `projectChanged` is used (protocol.md §3).
- The roadmap index is not put in the Mailbox. One project has several Mailboxes (leader, deployer and so on), there may be no Mailbox yet at registration, and their lifetimes differ (a Mailbox is born by attach and deleted by hand; an index is a copy that can be resent). A Mailbox holds only address and delivery state (§3.14).
- The UI's list of projects is the union of the values appearing in Mailboxes and indexes. Registering a roadmap with `docs:index` lets you choose it as a project before any agent connects, and leave requests from items to `role:<r> @ <project>` (they arrive as unread at the Mailbox that later attaches in that project).
- **Condition for making it an entity**: when per-project settings (a display name, a startup command, a default role, whether hook settings are present and so on) become needed, make Project the parent, put the index's key under it, and make `Mailbox.project` a reference. The direction is gathering scattered values under one parent, not adding parallel concepts.

### 3.16 The roadmap is the source of truth for progress; replies are delivery signals (concept, 2026-10-19)

The review of C6 / C7 / C8 (2026-10-19) raised details of how awaiting-reply is counted (with topic and role messages, one person's reply clears it for everyone; awaiting-reply in an unconnected Mailbox counts as the agent's move). Stepping back before fixing them, both turned out to be **symptoms of trying to measure progress in the message layer**.

**What progress tracking wants to know** is not "was there a reply" but "was the request or suggestion **reflected (gathered)** in the implementation or the roadmap".

**Decision (2026-10-19, user)**:
1. **Split into two layers.**

   | Layer | Question | Source of truth | Lifetime |
   |---|---|---|---|
   | Delivery | Where is the ball now (unread, awaiting reply, stuck) | Hub | Short. Disappears once handed over |
   | Progress | Was the promise (item) kept, was the suggestion gathered | The roadmap (repository) | Until the item closes |

   The Hub's awaiting-reply is downgraded to **a delivery signal**. The role of progress that "the basis of the ledger" in §3.13 and decision a of §9-8 put on it moves to the item side. C6's badges are used as they are, as the display of the delivery layer, and the counting details raised in the review are treated lightly as delivery details.
2. **Split requests in two.**
   - **Requests for an item** (with `meta.item`): never float. Progress is seen on the item's card (requested → reported → **reflected**).
   - **Requests without an item** (an on-the-spot question, research, consultation): may float. But they are not silently piled up. After the reply, a human chooses "gather into an item (open a new `C<n>`, add to an existing item) / discard". The UI prompts for that sorting.
3. **Rejected ideas stay as one line, `[-] C<n>`.** Agents tend to propose the same idea again, so "considered, and rejected for this reason" can be found by Grepping the C number. The roadmap holds only open items, so the body is not kept.
   - Delete the section and write `[-] C<n> Title (rejected YYYY-MM-DD, one-line reason)` on a line under a phase or "Known issues". If the reason is long, write it in §9 and point to it from the line.
   - It is not added to the status vocabulary (it is not a state of an open item). The Hub does not hold it (it is knowledge; §3.14).

**Judging "reflected"** (concept). As with the "derived fields" of §3.11, **facts in the repository** come before the agent's self-report (the reply). After a request with `meta.item: C<n>` was sent, if in an index that arrived through `docs:index` that item's done-when checks increased, or its section disappeared and became `[x] C<n>` / `[-] C<n>`, it is reflected. The Hub only matches two indexes against `meta.item`, without reading the working tree (§3.8).
- After the section disappears the `[x]` / `[-]` line remains, so adding "closed items' IDs and how they closed" to the index makes the judgment possible (the current `parseRoadmap`'s `refs` is the material).
- Acceptance (§3.11, open question 4 of §3.15) remains as something a human does after reflected.

Open questions:
1. Whether to keep requests tied to an item as awaiting reply under decision a of §9-8, or to delete them with the retention period since they can be followed on the item side (§9-9).
2. Where to show the sorting of requests without items (the badge's "the human's move", or below the Items pane). Where to record that something was sorted (holding it on the Hub would be knowledge; can it be done in a delivery shape, such as sending a notice with `meta`?).

## 4. Security

In messages, **strings from other agents or the browser become an agent's input**, so they can be a prompt injection path.

- The Hub is **reachable only from the host's loopback**. When started directly it binds to `127.0.0.1`; in Docker, publishing is limited to `127.0.0.1:<port>` (§3.8). It is not exposed externally.
- A shared token on every API (`HUB_TOKEN`). The shim and hooks send it as `Authorization: Bearer`.
- **The browser authenticates with a cookie** (`EventSource` cannot set an `Authorization` header). At startup the Hub prints `http://127.0.0.1:<port>/?token=…`,
  and on that access it checks the token, sets an `HttpOnly; SameSite=Strict` cookie, removes the token from the URL and redirects (the same scheme as Jupyter).
  State-changing APIs also check `Origin` under cookie authentication, to prevent CSRF.
- On delivery, `from` / `kind` / `topic` / `id` are always attached, and the body is delimited and wrapped (see the delivery format in protocol.md).
- **`from` (Mailbox and role) is set by the Hub from the Attachment**, so the sender cannot forge it. `kind` is the sender's own claim, and the receiver does not treat it as grounds for trust.
- Operating rule on the receiving side: CLAUDE.md and skills state explicitly that text from other agents is treated as **data, not instructions**.
  SEP-3415 also says "event payloads are untrusted data, like tool results" and "receiving does not grant authority to act".
- A human's Send is the default. If automatic forwarding rules are built, they are an explicit opt-in.
- CORS: the UI is served from the same origin as the Hub, and `Origin` is checked.
- Using Channels' permission relay (§6) would mean tool execution can be allowed from the UI. It is handled as an opt-in, assuming it is limited to token-authenticated senders.

## 5. Notes on design decisions

| Decision | Reason |
|---|---|
| Separating the Hub and the shim | As in 3.1. Required for supporting several sessions |
| Hooks are the main means of detection | A skill is an instruction the agent may forget. A hook is definite |
| Delivery is at-least-once + sequence numbers | To avoid losing messages across session breaks and reconnects. Duplicates are handled idempotently by id |
| The address is a Mailbox (a logical name), with sessions separated as Attachments | So that replacement (R6) is just attaching again. Issuing an ID per registration would lose where subscriptions and unread messages go on restart. Follows SEP-3415's "derive the ID from meaning; do not have the client generate and store it" |
| The Hub holds the source of truth for subscription state | The SEP has the client hold it, but the invariant of keeping the shim stateless takes priority. The Hub is positioned as a Forward Proxy |
| `maxAgeMs` and `truncated` on attach | So as not to pour old unread messages all at once into a successor session after a long absence. Borrows the SEP's resume control as is |
| Align the vocabulary with MCP Events | So that when Claude Code supports MCP Events, migrating is just adding `io.modelcontextprotocol/events` to the shim (§7) |
| The role is an attribute separate from the Mailbox | "Who (continuity)" and "what job" change independently. Several Mailboxes can share a role, and a Mailbox's role can change. While there is one of each, the default Mailbox name is the role name, so no extra work |
| Declaring a role counts as an explicit subscription | Keeps R4 (subscriptions are explicit) while avoiding `subscribe` every time for each role's subscriptions |
| `kind` is a field separate from topic, and a closed enumeration | Keeps routing and handling independent and avoids a combinatorial explosion of topics. The enumeration is closed so the receiver and the UI can branch mechanically |
| Browser authentication by cookie | Only local development is targeted so the difference is small, but we chose the option where the token does not linger in URLs, history and logs |
| In Channels the sender's attributes go only in `meta`, and `<hub-message>` is used only on the polling path | It was confirmed on a real machine that Claude Code escapes `</channel>`, and a body cannot close the outer tag (§6.1c). Reduces double wrapping and custom escaping. It is undocumented behavior, so the shim escapes `</channel>` too |
| HTTP with Hono (`@hono/node-server`) | Same as cairn in the same DockerFiles folder. Can be tested without the network through `app.request()`, and has an SSE helper (`streamSSE`) |
| The shim is pinned to MCP TypeScript SDK 1.x | SDK 2.x negotiates protocol `2026-07-28`, and such a channel server is not registered by the v2 runtime (§6.1). The latest supported by the 1.32 line is `2025-11-25` |
| Hooks send directly to the Hub with HTTP hooks | No script is needed, avoiding shell differences on Windows (Git Bash / PowerShell). The token and Mailbox name can be passed through environment variable expansion in headers |
| Only the Hub goes into Docker; P0 starts directly on the host | The shims/hooks run on the host by structure. Running resident (daemonizing on Windows) can be solved by compose's restart, but during development iteration speed comes first |
| A framework-less UI in P0 | To verify as fast as possible. Introduce one when needed |
| Persistence starts with JSONL | The implementation is minimal, and a human can follow it with `tail` |
| **Not SQLite (reviewed 2026-10-18).** Keep the JSONL append log + everything in memory | Measured with synthetic data (1KB per message, 4 Mailboxes): even at 40,000 messages (48MB), loading took 170ms, the heap grew by 55MB, and computing unread took 4ms. What has been handed over disappears after 24 hours and is compacted, so for the volume a human reads and carries (a few hundred a day) there is orders of magnitude of room. The only bottleneck was deletion: it scanned everything one message at a time and appended synchronously, so cleaning up 20,000 took 29 seconds, during which the Hub stopped. Changed to delete in a batch, it takes 0.4 seconds. There is no reason now to justify SQLite (a native dependency, Docker builds, migration). Revisit if full-text search, or looking up history beyond the retention period, becomes necessary (the Hub's policy is to hold no knowledge, so that is unlikely; §3.14) |
| Delivery is split into "wake" and "hand over the content", and the content can always be fetched with `inbox()` | The means of waking (Channels, cross-session messaging, MCP Events, standard notifications) grow and change, but with a single path for handing over the content, the Hub need not change. The path external bodies go through is single too (§3.9) |
| The Hub's vocabulary is vendor-neutral, and client-specific differences are absorbed by the shim and the `/events` intake | Only Claude Code is used for now, but other companies' agents should be able to join the same Hub later. If Claude-specific formats leaked into the Hub's storage format or API, they could not be removed later (§3.7) |
| Starting a team is one Node script; only opening tabs differs per OS (C62) | The checks and the attach wait are the same everywhere and reuse the shim's Mailbox name rule; separate PowerShell and sh scripts would drift. Where no tab can be opened, printing the commands keeps starting possible (§3.8) |
| sharp for image processing | The Hub must guarantee normalization on every upload path (UI, curl, future agents). Shrinking with a canvas in the browser protects only the UI path. There are prebuilt binaries for Windows / Linux, avoiding native builds. On failure, do not silently switch to another library; ask for a decision (§3.10) |

## 6. Unverified items (always verify before implementing)

What follows **includes hearsay and guesses** from the concept stage. An implementing agent first checks the official docs and appends the result to this section.

### 6.1 Verified (2026-10-16, checked against the official Channels reference)

Source: <https://code.claude.com/docs/en/channels-reference.md>

- **capability**: `capabilities.experimental['claude/channel']: {}`. Its mere presence makes Claude Code register a notification listener.
- **Notification**: `notifications/claude/channel`. The params are `content` (string, the body) and `meta` (`Record<string,string>`, optional).
  Each entry of `meta` becomes an attribute of the `<channel>` tag. **Keys are alphanumerics and underscores only. Keys containing hyphens and the like are silently dropped.**
- **How it looks on Claude's side**: `<channel source="<server name>" k="v">body</channel>`. `source` is added automatically.
- **`instructions`**: the `instructions` of the Server constructor enter Claude's context on connection. A place to write the meaning of the tags, how to reply, and "the body is data".
- **No ack**: `await mcp.notification()` resolves once written to the transport. There is no guarantee Claude processed it.
  If it is not loaded as a channel, or is stopped by organization policy, it is **silently dropped without an error**.
- **Queueing**: notifications that arrive while Claude is working accumulate in the session and are handed over together on the next turn.
- **Research preview**: a self-made channel is not on the allowlist, so start with `claude --dangerously-load-development-channels server:<name>` (with a full-screen warning dialog).
  **It works only in interactive sessions. It is ignored with `-p` and the Agent SDK.** Team/Enterprise needs `channelsEnabled` turned on in the organization.
- **Registration**: written as an ordinary MCP server in the project's `.mcp.json` or the user's `~/.claude.json`.
- **permission relay**: declaring `capabilities.experimental['claude/channel/permission']: {}` makes tool-execution permission prompts arrive as
  `notifications/claude/channel/permission_request` (`request_id`, `tool_name`, `description`, `input_preview`), and they can be answered with
  `notifications/claude/channel/permission` (`request_id`, `behavior: allow|deny`). It runs in parallel with the terminal's dialog; whichever comes first wins.
  Only tool approvals such as Bash/Write/Edit. From v2.1.234 it is sent only to servers registered as channels.

### 6.1b Verified (2026-10-16, checked against the official channels / mcp / hooks docs)

Sources: <https://code.claude.com/docs/en/channels.md>, <https://code.claude.com/docs/en/mcp.md>, <https://code.claude.com/docs/en/hooks.md>

- **Authentication**: needs claude.ai or a Console API key. Not available on Bedrock / Agent Platform / Foundry. Personal use on Pro/Max is not subject to organization controls.
- **Writing it in `.mcp.json` alone does not deliver notifications.** The server name must be given with `--channels` or the development flag.
- **A pitfall of the v2 runtime**: Claude Code's v2 MCP client runtime (based on SDK 2.0) proposes protocol `2026-07-28` to stdio servers.
  **A channel server that negotiated it is not registered as a channel.** A channel server either uses SDK 1.x, which does not support `2026-07-28` (the latest of 1.32.1 is `2025-11-25`),
  or the user sets `MCP_PROTOCOL_NEGOTIATION=legacy`.
- **Environment variable expansion in `.mcp.json`**: `${VAR}` and `${VAR:-default}` work in `command` / `args` / `env` / `url` / `headers`. Undefined without a default stays as a literal string, with a warning.
  `CLAUDE_PROJECT_DIR` is set in a stdio server's environment but not in Claude Code's own, so in `args` write `${CLAUDE_PROJECT_DIR:-.}`.
- **Passing `session_id`**: hooks get it as `session_id` in the JSON input. There is no environment variable like `CLAUDE_SESSION_ID`, and no documented way to pass it to MCP servers (the mapping approach of §3.4 assumes this).
- **Common hook input**: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode`, `effort`, `hook_event_name`. Inside subagents, `agent_id` / `agent_type` are added.
  - `Stop`: `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`
  - `Notification`: `message`, `title` (optional), `notification_type` (`permission_prompt`, `idle_prompt`, `agent_needs_input`, `elicitation_dialog` and so on)
  - `PreToolUse`: `tool_name`, `tool_input`, `tool_use_id`. `AskUserQuestion`'s `tool_input.questions[]` has `question` / `header` / `options` / `multiSelect`
- **Where hooks are configured**: `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, managed, plugins, skill/subagent frontmatter. Each level is merged.
  The shell for command hooks defaults to `bash` (on Windows, `powershell` if there is no Git Bash).
- **HTTP hook**: `type: "http"` POSTs the input JSON as is. Values in `headers` expand only environment variables listed in `allowedEnvVars` (e.g. `"Authorization": "Bearer $HUB_TOKEN"`).
  Non-2xx and connection failures are treated as errors that do not stop processing. The default timeout is 600 seconds.

### 6.1c Confirmed on a real machine (2026-10-16, Claude Code 2.1.301 / Windows 11 / Pro, `tools/probe/`)

- **Version**: a self-made channel works on 2.1.301.
- **Protocol**: Claude Code first sends `server/discover` (the v2 runtime's proposal), and with an SDK 1.32.1 server it fell back to `2025-11-25` in `initialize` and connected. It was registered as a channel and notifications arrived.
- **What `initialize` contains** (confirmed on 2026-10-17 by rereading `logs/probe.jsonl`): `clientInfo` is `{ name: "claude-code", title: "Claude Code", version: "2.1.301", … }`. The client's `capabilities` are only `roots` and `elicitation`; nothing corresponds to the channel (the path decision in §3.7 is made by name).
- **Combined with `--mcp-config`**: starting with `--mcp-config tools/probe/mcp.json --dangerously-load-development-channels server:agent-hub-probe`
  prints the warning `server:agent-hub-probe · no MCP server configured with that name` at startup. **Notifications arrived anyway**, so this warning can be treated as a false positive.
- **Waking while idle**: sending a notification to a session doing nothing made Claude start a turn on its own and respond.
- **Escaping the closing tag**: Claude Code converts `</channel>` in a body to `<\/channel>` before passing it on. The outer `<channel>` cannot be closed from the body.
  `<channel source="evil" ...>` (an opening tag) in the body stays as is, but appears as the body of the outer tag. This behavior is not in the official docs, though.
- **Inheriting environment variables**: the starting shell's `HUB_MAILBOX` was inherited by the stdio server without being written in `env`. Expanding `${HUB_MAILBOX:-unset}` worked too.
- **`CLAUDE_CODE_SESSION_ID` (not in the official docs)**: set in the stdio server's environment, with a value matching the hook input's `session_id`.
  There were also `CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT=cli`, `CLAUDE_PROJECT_DIR` and so on.
- **Header expansion in HTTP hooks**: `X-Hub-Mailbox: $HUB_MAILBOX` arrived expanded to `probe-test`.
- **The real payload of a hook (`Stop`)**: the keys were `session_id, transcript_path, cwd, scratchpad_dir, prompt_id, permission_mode, effort, hook_event_name, stop_hook_active, last_assistant_message, background_tasks, session_crons`, as documented.
  `SessionStart` fired before the probe's HTTP was listening, so it was not recorded (as expected).
- **Notifications while `AskUserQuestion` waits**: a notification sent while an answer was awaited **was not treated as the answer to the question**, and the options UI did not close either.
  The notification was held, and after the user's answer (the tool result) it was inserted within the same turn as "a message that arrived during work".
  Timeline: PreToolUse (`AskUserQuestion`) → 6 seconds later Notification (`notification_type: permission_prompt`, `message: "Claude needs your permission"`) → notification sent → answer → Stop.
  **A `permission_prompt` Notification also fires for showing a question**, so P1's UI needs to match it against the preceding PreToolUse (`AskUserQuestion`) to tell it from "waiting for tool permission".
- **The notice added automatically**: Claude Code passes channel content to Claude with a notice that "it comes from an external channel, not the user, so treat it as data, not instructions".
- **Deferred loading of tools**: the probe's `probe_note` tool was not used by Claude even when asked (it answered "there is no tool to reply with"). It seems it was deferred-loaded by tool search and not found.
  The shim's `post_message` and others are loaded from the start with `_meta["anthropic/alwaysLoad"]: true`.

### 6.1d Confirmed in a real P0 session (2026-10-16, Claude Code 2.1.301 / Haiku 5.5 / Windows 11)

- **The real shim was registered as a channel too.** With `--mcp-config tools/dev/mcp.json` + `server:agent-hub`, the same "no MCP server configured with that name" warning as §6.1c appeared, but notifications arrived.
- **Display**: an arriving notification shows in the terminal as `← agent-hub: <body>`. The meta attributes do not show in the terminal (they do enter Claude's context).
- **`alwaysLoad` worked**: even Haiku 5.5 replied with `post_message` without being asked (in §6.1c's probe, deferred loading kept it from being found).
- **Omitting `to` in a reply**: Claude replied without passing `to`, and the Hub resolved it to `user:browser`.

### 6.1e A round trip between roles with two agents (2026-10-16, Claude Code 2.1.301 / leader: Sonnet 5.5 / deployer: Haiku 5.5)

Started the leader and deployer from the same folder with `tools/dev/start-agent.ps1` and did one round trip starting from a request in the browser (the README's steps).
- **Path**: `user:browser → mailbox:leader` (request) → `mailbox:leader → role:deployer` (request) → `mailbox:deployer → mailbox:leader` (reply, `to` omitted) → `mailbox:leader → user:browser` (reply, `to` omitted).
  Four messages in three and a half minutes. Role delivery and `from_role` worked with P0's implementation as it was.
- **The role's behavior was conveyed with `--append-system-prompt-file`.** The flag was accepted in an interactive session too. The leader did not implement anything itself and sent the deployer a request stating the goal, the target, the done-when conditions and the report format.
- **The Haiku deployer took the leader's request as work.** The shim's instructions and Claude Code's notice ask that channel bodies be treated as data, but the role description the user gave in the system prompt ("a request with from_role=leader is an approved work request") took precedence.
- **No back-and-forth of acknowledgements happened**, because the role description said "do not reply to replies and notices".
- **The leader ended its turn after sending the request, and woke on the deployer's reply** (the same as waking while idle in §6.1c).
- **Caution**: the leader's request included the example "actually start the Hub and send messages to check". The deployer did not; it checked by swapping out fetch / EventSource,
  but sending test messages through the running Hub could wake ourselves. A line was added to the deployer's role description to start a test Hub with a different `HUB_PORT` / `HUB_DATA_DIR`.

### 6.1f `--settings <file>` makes the model name misread (2026-10-16, Claude Code 2.1.301 / Windows 11)

- Passing `--settings tools/dev/settings/leader.json` (containing only `{"outputStyle":"Concise"}`) for the output style in `start-agent.ps1 -Role leader`
  made the startup display read `--settings with high effort`, with the warning `Model "--settings" isn't recognized · context assumed to be 200k tokens`.
- The arguments the script passed were correct (checked by swapping `claude` for a function that prints its arguments; for the leader, `--model` itself is not passed).
  The relays `claude.ps1` / `claude.cmd` also just pass `$args` / `%*` as they are, so it appears to be how Claude Code handles its arguments. The cause was not identified.
- What we did: stopped passing `--settings`, and wrote the instruction to keep the leader's terminal answers short in the role description (`--append-system-prompt-file`).
  Switching the output style with `/output-style` saves it in `.claude/settings.local.json`, which affects every session in the same folder (the deployer too), so it is not used.

### 6.1g The receiving end of the official cross-session messaging (verifications 1 and 2 of §8.3, 2026-10-16, Claude Code 2.1.301 / Windows 11)

- **Verification 1: the receiving end's information reaches the shim (not in the official docs).** The environment of a probe that Claude Code started as a stdio MCP server (the 07:50 startup in `logs/probe.jsonl`) had
  `CLAUDE_CODE_MESSAGING_SOCKET` (a named pipe `\\.\pipe\LOCAL\cc-msg…`) and `CLAUDE_CODE_MESSAGING_TOKEN`. The official docs only say they are passed to hooks and Bash.
- **Verification 2: the posting format is not public, so it cannot be tried.** The official docs have only the first line `{"type":"auth","token":"…"}`; the format of the message body sent after it is in none of the cross-session messaging, env-vars or hooks docs.
  Sending the auth line and a guessed format (`{"type":"message","text":"…"}`) to my own session's receiving end gave no response and no error, and no message arrived (silently dropped). Guessing further would mean analyzing a private specification, so we stopped.
  **Addendum (re-investigation)**: open-agent-bridge's README says to send `{"type":"user","message":{"role":"user","content":"…"}}` after the auth line (not in the official docs; nothing is said about behavior on Windows). Unverified.
- **Implication**: moving delivery would depend on two things, an undocumented environment variable (verification 1) and a private format (verification 2). It cannot be called more stable than Channels (a research preview, a development flag). Staying on Channels until the format is published is reasonable (§9-5).

### 6.1h Slash commands in a channel body (2026-10-17, observed in the user's real use; version not recorded)

- Sending `/clear` and the like as a body from the browser did not run it as a command; it reached the model as a body.
- Reason: slash commands are interpreted by the CLI in its input field. Channel notifications do not go through the input field; they enter the model's context directly with `<channel>`. That external bodies do not run commands also agrees with the "body is data" protection (protocol.md §6).
- Self-made commands and skills could be called by the model with the Skill tool (at the model's discretion; not reliable). Built-ins such as `/clear` and `/compact` cannot be called. The alternative is in §3.13.

### 6.1i Command hooks and git facts (2026-10-17, checked against the official hooks docs)

Source: <https://code.claude.com/docs/en/hooks.md>
- **Command hook input**: JSON arrives on stdin (for HTTP hooks, as the POST body). The common input is the fields in §6.1b.
- **`timeout`**: in seconds. The default for command hooks is 600 seconds. `tools/hooks/settings.command.json` uses 6 seconds, and the script's own 5-second limit takes effect first.
- **`${CLAUDE_PROJECT_DIR}`**: the root of the project the session was started in. It points at the original root even inside a worktree.
- **exec form**: writing `"command": "node", "args": [...]` starts it directly without a shell, avoiding differences between Windows' default shells (Git Bash / PowerShell).
- **Stop's input**: `last_assistant_message` is confirmed officially. However, fetching Stop's full list of fields was cut off midway, so that is unverified. The script reads only `session_id` / `cwd`, confirmed on a real machine in §6.1b.
- **Scope of the live verification**: checked by feeding Stop's input into `node tools/hooks/post-event.mjs` against a separate Hub instance (a different port and data location from the running Hub).
- **On a real machine (2026-10-17, Claude Code leader / deployer sessions)**: replacing `Stop` in `.claude/settings.local.json` with the shape of `settings.command.json`, the exec form, the expansion of `${CLAUDE_PROJECT_DIR}` and passing stdin all worked, and all six `turn.end`s had `changes`. The HTTP `Stop` was removed, so there was one `turn.end` per turn.
- **Permission waits and modes**: in a session whose `permission_mode` is `auto`, no `permission_prompt` Notification appears (it does not ask for permission). For a deployer in the default mode, `permission` appeared on a permission wait for creating a file.

### 6.1j takeover in a real session (2026-10-17, P2 acceptance criterion 3; version not recorded)

Started session A with `./tools/dev/start-agent.ps1 -Role reviewer`, and with A still running started session B with the same command.
- The reviewer's card in the UI showed `Connected (claude-code) · took over <time>`.
- Asked to send something, A read `post_message`'s error (`superseded`) and answered "another session took over, so I was cut off".
- A request then sent from the UI to `role:reviewer` was received only by B, which returned a reply. The turn end at that time was one, B's; nothing reached A.
- **Found**: A's Stop hook Event (`turn.end`) resolved to the reviewer's Mailbox, and the card's `Last event` became A's. It read as if B, connected now, had stopped, so Events from a cut-off session get `superseded` and are not used on the card (§3.3).

### 6.1k Claude Code started without the channel (2026-10-18, Claude Code 2.1.302 / Windows 11, `tools/probe/`)

Started three times with `claude --mcp-config tools/probe/mcp.json --settings tools/probe/settings.json` (without `--dangerously-load-development-channels`) and sent `/case/hello`.
- **The notification was silently dropped**: the probe got as far as `initialize` → `tools/list`, and writing the notification was recorded too (`pushed`). Nothing showed in the terminal, and Claude did not start a turn. No error either. As the official description in §6.1 says.
- **The shim has no clue to tell**: compared with a start with the channel (the record of 2026-10-16 in §6.1c, 2.1.301), the params of `server/discover` and `initialize` (`capabilities`, `clientInfo`), the order of later requests (`notifications/initialized` → `tools/list`), and the names of the environment variables passed to the stdio server (`CLAUDE*` and so on) were all the same. The only difference was `clientInfo.version`.
- The probe did not appear in the `/mcp` list (the user's observation). It was connected (`tools/list` arrived).
- **Consequence**: on the channel path, "written" is no evidence of "arrived", and how it was started cannot be detected either. With the shim acking right after writing, as it does now, unread messages are lost on a start without the channel (§3.7). Handled by treating delivery states separately (roadmap P2).

### 6.1l The Hub in Docker Desktop (2026-10-18, Docker 29.8.2 / Windows 11, `node:24-bookworm-slim`)

Checked by starting compose with a different project name (`-p agenthub-test`) and port 7796.
- **Published only on loopback**: `127.0.0.1:7796` gave 200; the host's LAN (192.168.0.x) and WSL's vEthernet (172.31.x) addresses could not connect.
- The host's shim (`dist/shim/main.js`) attached, and Events from the hook (`tools/hooks/post-event.mjs`) were recorded. Image attachments (sharp) worked too. Over `down` → `up` the messages in the volume remained and `lastSeq` continued.
- **Mounting a single file creates an empty directory on the host**: without `./roles.json`, whether with the long syntax `bind.create_host_path: false` or top-level `configs` (`file:`), Docker Desktop created an empty directory named `roles.json` on the host and started. The Hub stops with EISDIR and repeats on restart. So the parent directory is mounted instead (§3.8).

### 6.1m MCP's standard resources notifications do not wake it (2026-10-19, Claude Code 2.1.303 / Windows 11, `tools/probe/resources-probe.mjs`, C1)

Connected only a probe with the resource `hub://inbox` (`resources: { subscribe: true, listChanged: true }`) and a tool `read_inbox` that reads it, with `--strict-mcp-config --mcp-config`, and wrote in its instructions "call `read_inbox` when it changes". Sent `notifications/resources/updated` and `notifications/resources/list_changed` to a session with no input.
- **It does not subscribe**: Claude Code went as far as `initialize` → `tools/list` → `resources/list` and did not send `resources/subscribe`. The client capabilities were only `elicitation` and `roots`.
- **No turn starts**: to `list_changed` it responded by fetching `resources/list` again (8ms later). To `resources/updated` it did nothing: no `resources/read`, no call of `read_inbox`, and nothing in the terminal (the user's observation).
- **Consequence**: in Claude Code, resources notifications are not a means to "wake" (they cannot be used for level 2 of §3.9). Claude Code stays on Channels (level 1). Other clients are unverified (look with the same probe when a real client is added in C3).

### 6.1n A correction that arrived during work, and confirmed receipt (2026-10-20, the compose Hub / vcp's leader and deployer; version not recorded)

Requested vcp's C147 from `user:cli` to vcp.leader (seq 39). The leader rebuilt it into detailed English instructions (#40) for the deployer, which reported 15 minutes later (#41). While the leader was checking it, the human sent a correction request (#42).
- **The correction cut straight in**: the leader received #42 and immediately told the deployer to fix it (#43). After the fix was reported (#44), it reported both results in one reply to #39 (#45). There is no reply to #42.
- **Confirmed receipt did not advance**: at the end, vcp.leader had `cursor` 44, `received` 39 and 3 unconfirmed (#41, #42, #44). A reply confirms only up to the `replyTo` Message (§8.4, protocol.md §4), so #45 advances only to 39. The leader read all three and acted on them.
- **Consequence**: in a Mailbox that receives through Channels, replies that never get a reply themselves (a subordinate's report) and requests answered together stay as awaiting confirmation and awaiting reply. The fix is roadmap C28.

### 6.1o Events for question and permission waits, and turns that started outside the Hub (2026-10-21, the compose Hub / vcp's leader and deployer; version not recorded)

Requested vcp's C142 from the UI to vcp.leader (seq 69). leader → deployer (#71) → leader (#73) → user (#74), about 34 minutes to commit b7f6818.
- **The default permission mode was auto**: `permission_mode` in both sides' Events was `auto`. The startup script does not pass a mode, and `~/.claude.json` has a record of making auto the default (`hasResetAutoModeOptInForDefaultOffer`). The previous deployer's `auto` (§6.1n) is probably the same reason. Permission waits in the default mode were seen after restarting and setting `manual` by hand (the end of this section).
- **Question waits**: the leader asked three questions with `AskUserQuestion`; `PreToolUse` → `question`, and on the answer `PostToolUse` → `question.answered` (about 4 minutes later) arrived. The UI showed the questions and options on the Event card. They are not counted in the backlog badges (badges are only Message material).
- **Permission waits**: once with the auto deployer, `Notification` (`permission_prompt`) → `permission`. The payload had only `message: "Claude needs your permission"`, with neither the tool name nor `permission_mode`. There is no matching Event after allowing it, and the card's `Last event` stays `permission` even when work resumes (roadmap C30; resolved with `permission.resolved` on 2026-10-26; §6.1s).
- **No date on the card's time**: the deployer card's `Last event: turn end · 22:17:10` was an Event from the previous day, but showing only the time made it look like today (roadmap C31).
- **A reply was missed in a turn that started outside the Hub**: the deployer (Haiku) ran the full suite in the background and ended its turn; in the turn started by the completion notice it only wrote the result in the terminal and did not `post_message`. When the human nudged it from the UI (#72), it sent the reply to #71 (#73). It did not happen in the previous two runs (roadmap C32).
- **What remained**: at the end, vcp.leader had 2 awaiting reply (the previous day's correction, #70's "continue as is") and 1 awaiting confirmation (#73; there is no reply to a report), and vcp.deployer had 1 awaiting reply (the nudge #72). All of them were read and acted on; C28's pattern grew by three in one run.
- **Permission waits in the default mode (same day, restarted on 2.1.306)**: the Shift+Tab switcher has no `default`, and the human set the deployer to `manual`. From the UI to the leader, "commit and push via the deployer" (#75) → leader → deployer (#76) → leader (#77) → user (#78), about 3 minutes to the push. In one deployer turn `permission` appeared twice (the same `prompt_id`; the payload only `message`, as with auto), and that turn's `turn.end` had `permission_mode` `default`. So the UI's `manual` is `default` in the payload. The turn started from the Hub, so the reply was not missed. Even with deployer.md's "do not commit or push", it pushed when the leader's request said "the user said so explicitly".

### 6.1p Old requests from another project flowed to a new project's deployer (2026-10-22, the `npm run hub` Hub / cite-bridge's leader and deployer, Claude Code 2.1.308)

- **What happened**: on its first attach, cite-bridge's deployer received as unread a request to `role:deployer` (#122, no `project`) that the leader issued in P1's acceptance test on 10-17; it created and deleted `tmp/p1-a.txt` in cite-bridge and reported to the old addressee `leader` (#171). The working tree was back to how it was.
- **Cause**: the `cursor` at creation was 0, under the rule that role messages from before creation also become unread (protocol.md §2). Role messages without `project` reach the same role in every project, so old unanswered requests flowed even into a Mailbox created later in another project. On the card it showed as the deployer's `Agent 2 · 5d` (red).
- **The fix**: role messages without `project` reach only Mailboxes that had the role when they were sent (`m.seq > roleSince`; the same counting as default topic subscriptions). Role messages with `project` can be left even for a project with no Mailbox yet (§3.15 "A project is a value"), so they stay as they are.
- **Revisiting the badges**: on the same screen, the leader's `Stuck? 1` was only the deployer's report lacking confirmed receipt (C28), and the missing `Last event` was because cite-bridge had no hooks (as the startup warning said; they were placed in `.claude/settings.local.json`). The count layers do not show "who is moving now", so card states were added (§3.15).

### 6.1q A team stopped by a usage limit, and automatic resume (2026-10-22 to 23, the `npm run hub` Hub / cite-bridge's leader and deployer, Claude Code 2.1.308)

- **What happened**: at 21:38:48 (JST), right after the leader requested C3 from the deployer and ended its turn, the deployer's first API call came back with `usage_limit_reached` (`apiError` in the transcript). The screen showed `Usage limit reached · continuing automatically at 12am · esc to cancel`, and Claude Code waited for automatic resume. The human's session (the conversation of this work) stopped on the same quota too.
- **The Hub in the meantime**: for 2 hours 20 minutes neither Messages nor Events arrived. There is no Event for the moment it stopped. None of the registered hooks (Stop, Notification, Pre/PostToolUse of AskUserQuestion) fired, and there is no `Stop` (the turn had not ended). The Attachment's lease kept being extended; it stayed connected.
- **Resume**: at 0:00:49 a `Notification` arrived with `notification_type: "quota_auto_resume_fired"`, `message: "Usage limit reset — Claude is continuing your task"` (the Hub's Event is `notification`), and at the same time Claude Code inserted a meta user message into the transcript, "Your claude.ai usage limit has reset. Continue the task you were working on…", and continued C3. The channel notification from before it stopped (the C3 request) was in the same API call too.
- **Effect on card states (§3.15)**: by the decision rules, the deployer would show `Working · 2h` in the meantime (the handed request is newer than the last `turn.end`). It had actually stopped, so that was wrong. The official hooks include `StopFailure` (when a turn ended on an API error; `error` is `rate_limit` and so on, `last_assistant_message` the error text), and Notification's `quota_auto_resume_fired` / `_stale` (lifted during sleep, waiting for Enter) / `_disabled` (will not continue automatically) (official hooks reference, checked 2026-10-23). Whether `StopFailure` also fires when waiting for automatic resume is not stated (§6.2-6). Roadmap C38.
- **Hooks took effect without restarting**: placing cite-bridge's `.claude/settings.local.json` at 21:36:49, `turn.end`s arrived from the two running sessions from 21:37:05 on. Claude Code rereads hooks in settings files while running.
- **The leader's behavior**: it read the human's "continue as makes sense" (#186) as an instruction to go on, after two corrections, to the next item (C3), and requested it. The report said "requested", so the human could notice.

### 6.1r A request the leader implemented itself, and fixing the role description (2026-10-26, the compose Hub / vcp's leader and deployer, Claude Code 2.1.309 or 2.1.310; looking afterwards, it had auto-updated to 2.1.310)

- **What happened**: sent the C157 (vcp) request from curl to `vcp.leader`. It was sent with Bearer only, so the sender is `user:cli` (protocol.md §3). The leader did not hand it to the deployer; it implemented, tested and cleaned up the TODO itself, and returned a five-section reply to `user:cli` (about four and a half minutes from the request, 0 Messages from the leader to the deployer). The description in roles.json said "does not implement anything itself".
- **The presumed cause**: the flow in `tools/dev/roles/leader.md` said "when a request arrives from `user:browser`, hand it to the deployer", and `user:cli` could be read as outside the flow. We did not watch the leader's terminal, so this is not certain. We think the request being concrete and small also contributed.
- **The fix**: added to `leader.md` "do not edit files yourself (hand it to the deployer even if the request is small or you can see where to fix; the only exception is when the user says so explicitly in the body)", and changed `user:browser` in the flow and commitments to `user:browser` or `user:cli` (both are the user). The same exception in `deployer.md` now includes `user:cli` too.
- **After the fix**: restarted the leader and deployer (the role description is the system prompt at startup, so it does not take effect in running sessions) and sent C158 from `user:cli` the same way. In about a minute the leader sent a request with the fixed English headings to `role:deployer` and ended its turn; the deployer returned a `CHANGED` / `VERIFIED` / `NOT VERIFIED` report in about five and a half minutes; and the leader checked the diff and the full tests itself before replying (about 9 minutes from the request).
- **C32's scene did not happen**: the deployer waited for the full tests (4342) within its turn, and the report (10:15:22) came before that turn ended (10:15:26). Ending a turn waiting on a background task depends on how the deployer chooses to run things, and cannot be triggered on purpose. C32's second done-when condition stays open (it happened in the next run the same day; §6.1t).
- **The Hub's version**: the running compose Hub was a build from before C40, and `GET /mailboxes` did not return `backlog.outgoing` (card states show coarsely). Rebuilding with `docker compose up -d --build`, the running shims attached again as they were.

### 6.1s Clearing permission waits, and after a denial (2026-10-26, the compose Hub / agent-hub's reviewer started with `-PermissionMode default -Model haiku`, Claude Code 2.1.310)

- **Official docs (hooks reference, checked the same day)**: `PermissionRequest` arrives right before the dialog is shown, with `tool_name` and `tool_input` (no `tool_use_id`). When an allowed tool runs, `PostToolUse` (success) or `PostToolUseFailure` (failure; `error`, `is_interrupt`) arrives. When you deny by hand in the terminal, no hook arrives (`PermissionDenied` is only for denials in auto mode; `PostToolUseFailure` does not fire on a permission denial either). `Notification`'s `permission_prompt` appears after the wait has lasted about 6 seconds.
- **The form adopted (roadmap C30)**: register `PostToolUse` / `PostToolUseFailure` for every tool, and record it as `permission.resolved` only when the previous Event of the same session is `permission`. Nothing else is recorded (`ignored`). `tool_response` and `tool_input` are dropped from the payload (so contents of Read and the like do not pile up). `PermissionRequest` is not used (it would show even permissions granted in under 6 seconds as permission waits).
- **On a real machine**: asked from the Hub to "run `node -e` twice with Bash, separately", and the human allowed the first after waiting more than 6 seconds and denied the second. 11:00:16 `permission` → 11:01:00 `permission.resolved` (`tool_name: Bash`) → 11:01:08 `permission`. After the denial, for more than 3 minutes neither Events nor a reply arrived (no `turn.end`, no `idle_prompt` notification), and the card's last Event stayed `permission` (Needs you). After a denial Claude Code waits for the human's input, so Needs you is right. The stored payload of `permission.resolved` had `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `tool_name`, `tool_use_id`, `duration_ms` and so on (no large fields).
- **Load**: every tool's `PostToolUse` reaches the Hub. The Hub's response time when not recording, 100 times with a 20 KB payload: median 3.6 ms, p95 5.3 ms, max 56.8 ms (from the host to the compose Hub). A long vcp session (10-21 to 23) had 204 tool calls, which together come to less than a second. A `tool_response` over 1 MB (Read of a large file) gets 413 from the Hub and is just treated as a hook error; work does not stop (hooks step 3 in docs/usage.md).
- **A remaining hole**: if, during a permission wait, another tool in the same session (a parallel call or a subagent) finishes first, it is read as `permission.resolved` before permission was granted. The tool name is not in `Notification`, so they cannot be matched.
- **A hole where 413 keeps it from being recorded (unverified; inferred from the code)**: if the input of an allowed tool's `PostToolUse` exceeds 1 MB, `/events` refuses it with 413 (`payload_too_large`) before converting (`eventLimit` in `src/hub/app.ts`, 1 MB). So `permission.resolved` is not recorded and the card may stay Needs you. Dropping `tool_response` happens after conversion, so it does not help with this limit. Not checked by actually sending one.

### 6.1t Replying after a turn that ended waiting on a background task (2026-10-26, the compose Hub / vcp's leader and deployer (haiku, auto), Claude Code 2.1.310)

- **What happened**: requested vcp's C150 to C154 in order in one request (#88, `user:cli` → `vcp.leader`). For C150, leader → deployer (#89, 11:19:39 UTC). The deployer ran the full tests in the background and ended its turn with "The full suite is running in the background. I'll report to the leader once it finishes." (`turn.end` 11:23:36). In the turn started by the completion notice, it sent the reply to #89 (#90, 11:27:28) without a nudge and ended that turn (11:27:32). No Message to the deployer in between. This is the scene missed in §6.1o, and after the sentence added to `deployer.md` (roadmap C32) it was not missed. It is one observation, so it cannot be said it will never be missed.
- **`background_tasks` of `Stop`**: in the payload of the `turn.end` at 11:23:36, `background_tasks` listed the running task as `[{ id, type: "shell", status: "running", description, command }]`. The one at 11:27:32 was `[]`. The Hub keeps the payload as is, so it can tell that "a task is still running" at the end of a turn.
- **Effect on card states (derived from the decision rules; not seen in a browser)**: for about 4 minutes from 11:23:36 to 11:27:28, the deployer would show Stopped, no reply (red), because "the turn ended and a request handed to it has no reply". It was actually waiting on tests. Counting a `turn.end` with non-empty `background_tasks` as Working tells them apart. C43 (2026-10-28) made the decision so (§3.15).
- **Several reports for one request**: the leader returned C150's result as a reply to #88 (#91), and 14 seconds later, without waiting for an answer, handed C156 to the deployer (#92). As the request asked.

### 6.1u A real team with a reviewer (2026-10-27, done-when conditions 4 and 5 of C45, Claude Code / leader, deployer, reviewer; version not recorded)

- **A request with only a target and a question**: the leader sent the reviewer only `TARGET: eceb110~1..f52e297` and `QUESTION:`. The reviewer read on its own the sources of truth the request did not mention: "Updating the docs" in CLAUDE.md, the writing rules at the top of the roadmap, C44's section before the change (`git show`), design.md §3.15, §2 and §9, and protocol.md §3. It returned three findings, each with the location of the source of truth it was checked against (file and section). It did not run the tests, and wrote under `NOT VERIFIED` that it had not. No stretch of conversation reached it, yet it could read the sources of truth and check against them. One observation, so it cannot be said it will happen every time.
- **A round looking only at an item's wording**: showed the freshly filed C48 (all done-when conditions `[ ]`) as `TARGET: C48`. The reviewer looked at the wording only, not at a change, and returned two findings on the body and four proposed corrections to the done-when conditions (three replacements, one added line) under `PROPOSED CONDITIONS:`. The leader did not pass the proposals to the deployer; it relayed them to the human, numbered, as NEEDS DECISION (default "no change"). The user approved all of them on 2026-10-27, and the deployer changed only the approved lines. The history of the approval was written in the item's body too.
- **Lesson**: a reinterpretation of "filtering by kind" in C44's done-when conditions had been recorded as a default with no answer from the human. A NEEDS DECISION that changes the meaning of a done-when condition does not take the default without an answer; it asks again (leader.md).

### 6.1v How model and effort are obtained (2026-10-29, C61)

**Observed on a real machine (2026-10-29)**: after restarting the team, looked at kinds `session.start` and `model.switch` with the Hub's `GET /events`.
- **SessionStart** arrived through a command hook (`tools/hooks/post-event.mjs --no-git`). The `model` for the leader and reviewer was `claude-sonnet-5-5`, for the deployer `claude-haiku-5-5`. `source` was `startup` for all. The keys were `session_id` / `cwd` / `scratchpad_dir` / `hook_event_name` / `source` / `model`. The deployer's conversation could not state its own model ID, but the hook's `model` carried it (Hub seq 266).
- **When SessionStart was placed as `type: "http"`**, not a single Event reached the Hub (same day, while checking C61). Isolating the cause is not finished.
- **PostModelSwitch arrived through an http hook** (same day). The leader switched with the `/model` picker. The keys were `session_id` / `cwd` / `prompt_id` / `hook_event_name` (`"PostModelSwitch"`) / `from_model` (`"claude-sonnet-5-5"`) / `to_model` (`"claude-haiku-4-5-20251001"`) / `requested_model` (same as `to_model`) / `source` (`"picker"`) / `context_tokens` (56455) / `prompt_cache_warm` (true) / `cache_ttl` (`"1h"`) / `estimated_cache_write_usd` (0.1129) / `pricing` (`"catalog"`).
- **to_model is a dated name**, in a different form from SessionStart's `model` (`claude-haiku-5-5`).
- **effort**: `payload.effort.level` of `turn.end` arrived as `"medium"` and showed on the card.

**Official docs (code.claude.com/docs/en/hooks, read in full on 2026-10-29)**
- **Hook types for SessionStart**: "Only `type: "command"` and `type: "mcp_tool"` hooks are supported". `http` is excluded, which matches the observation above. `tools/hooks/settings.json` was changed to call `post-event.mjs --no-git` as a `command` (`--no-git` sends the input as is without calling git).
- **Hook types for PostModelSwitch**: the official list accepts `command` / `http` / `mcp_tool`, not `prompt` / `agent`. Matches receiving it over http on the real machine.
- **effort**: the common input has `effort: { level }` (`low` / `medium` / `high` / `xhigh` / `max`). It is on Events in a tool-use context (`PreToolUse` / `PostToolUse` / `Stop` / `SubagentStop`), and only when the model supports effort. It is also visible as `$CLAUDE_EFFORT`.
- **There is no mechanism that reports a change of effort** (the official description of `effort` is only this common input; neither `ConfigChange` nor `PostModelSwitch` has effort in its input). A change is known by comparing `effort.level` of the next Event in a tool-use context with the previous one, so it is delayed until the end of the turn.
- **ConfigChange**: arrives on changes to settings files; the input is `source` (`user_settings` / `project_settings` / `local_settings` / `policy_settings` / `skills`) and an optional `file_path`.
- **model**: `SessionStart`'s `model` is optional (it may be missing after `/clear` or when restoring a conversation). `PostModelSwitch` has `from_model` / `to_model` / `requested_model` / `source` (`command` / `picker` / `sdk` / `auto` / `resume`). It is not on `Stop` and the like. There is no `$CLAUDE_MODEL`.

**The form adopted**: `SessionStart` is stored as `session.start` and `PostModelSwitch` as `model.switch`, with the payload as input (the converter only decides the kind). The card shows, from the Events at hand, effort from `payload.effort.level` and model from the newer of `session.start`'s `payload.model` and `model.switch`'s `payload.to_model`.
- **Showing model names** (checked with synthetic hook POSTs, not a real session): a dated name drops the date, `haiku-4-5`; an undated name stays as is, `haiku-5-5` (`ui:check`).
- **Known limit (not fixed)**: the "last seen" value is limited to the Events at hand on the client (`/events?limit=200` at startup and SSE) and the Hub's retention period (`HUB_READ_RETENTION_HOURS`, Purge read). model comes only from `session.start` and `model.switch`, which arrive only at startup and on switching. So in a long session, or on a Hub with many Events, model may drop out and only effort show. The tooltip says so.

**NOT VERIFIED (not confirmed on a real machine)**:
- That after effort is changed, the card shows the old value until the next Stop (inferred from the official description; not checked on a real machine).
- Real payloads of `PostModelSwitch` with `source` `command` / `sdk` / `auto` / `resume` (only `picker` was observed).
- Why no Event arrived when SessionStart was placed as http: the official docs say SessionStart does not accept http (the official description above), and the observation matches it. Not isolated on a real machine.

### 6.1w English role descriptions with `HUB_LANGUAGE=ja` (2026-10-29, C65 / C66, the compose Hub rebuilt with `HUB_LANGUAGE=ja`, leader and deployer started with `start-team.ps1`)

- **Setup**: the role descriptions (`tools/dev/roles/*.md`, `roles.json`) were English, with the English reply-format headings of §3.15. The Hub logged `[hub] language: ja`, so the shims inserted the language line of §3.5.
- **The request was written in English on purpose** (#277, `user:cli` → `role:leader`: have the deployer create `tmp/c65-check.txt`, confirm it, delete it), so that nothing in the conversation pulled toward Japanese except the language line.
- **leader → deployer** (#278): `GOAL` / `SCOPE` / `SPEC` / `DONE WHEN` / `REPORT FORMAT: deployer standard`, in English.
- **deployer → leader** (#279): `CHANGED` (the DCP schema line only, since nothing remained changed) / `VERIFIED` / `NOT VERIFIED` / `NOTES`, in English.
- **leader → user** (#280): the headings `RESULT` / `VERIFIED` / `NOT VERIFIED` / `NEEDS DECISION` / `NEEDS ACTION` in English, at the start of lines as written, with every body in Japanese. "None" was written as `なし` (Japanese). The deployer's checks were prefixed with `deployer:` as leader.md asks.
- About 3 minutes from the request to the reply to the human. One observation, so it cannot be said the body never drifts into English; it held in the case most likely to drift (an English request, English roles, English exchanges between agents).

### 6.1x Starting a team with `npm run team` (2026-10-29, C62)

- **Linux** (Docker `node:24-bookworm-slim`, Node 24, Debian's tmux, the repository copied in and `npm ci`; `claude` replaced by a stub that answers `--version` and otherwise runs the shim from `--mcp-config`, so the Mailbox really attaches to a Hub in the same container):
  1. Outside tmux, `--roles leader,deployer` chose `tmux`: it built `dist/`, started the Hub in window `hub` of the detached session `agent-hub`, then `app.leader` and `app.deployer` in their own windows, each reported `attached`, and the UI URL was printed. The stub saw the expected arguments (`--append-system-prompt-file …/leader.md`, `--model haiku` only for the deployer, `--add-dir /tmp/agent-hub` last) and `HUB_ROLE` / `HUB_MAILBOX` / `HUB_TOKEN`, with the project as its folder.
  2. Run again: the connected `app.leader` was skipped.
  3. With tmux hidden from PATH it fell back to `print`, printed `cd /app && npm run team -- agent --role reviewer --project /app --from-team`, and running that by hand attached within the wait.
  4. A `claude` that exits 3 at once: reported `ended before attaching (exit code 3, 0 seconds)` without waiting for the limit, exit code 1.
  5. No `claude` on PATH: stopped before starting any role (`spawnSync claude ENOENT`).
  - `git fetch` failed in the container (no credentials) and was reported as a note without stopping, as in C58.
  - **Not checked on Linux**: a real `claude` session (the container has no logged-in Claude Code), the development channel's dialog inside a tmux window.
- **Windows** (Windows 11, PowerShell 7, Windows Terminal, Node 26, Claude Code 2.1.312, the compose Hub; a real `claude` reached through nvm's `claude.exe` → `claude.cmd`): `./tools/dev/start-team.ps1 -Roles reviewer` built `dist/`, opened a tab `agent-hub.reviewer`, and after the development channel's dialog was answered it reported `attached`, then the UI URL, exit code 0.
  - The first try opened no visible tab: the opener was started with Node's `windowsHide: true`, `wt.exe` passed the hidden flag on, and the role ran in an invisible console under `wt.exe` (no attach, since nobody could answer the dialog). Fixed by not hiding the opener; noted here because it fails silently.
  - The console-window opener (`window`, used when there is no `wt.exe`) ran a command with spaces in its paths (`…\Author Software\…
ode.exe`, an output file `window out.txt`) in a new window, in the given folder.
  - `npm run team -- --tabs bogus` from PowerShell 7 reached the script (npm's `--` is passed through).

### 6.2 Unverified

1. **Windows-specific**: path notation, line endings. That publishing in Docker Desktop is loopback only was confirmed (§6.1l).
2. **Codex's MCP support**: whether `inbox()` polling can be used.
3. **An alternative delivery path: plugin monitors**. Hookdeck's mcp-events-bridge does not use Channels; it runs a poll client in a plugin's monitor and delivers one-line output to Claude as a notification (Claude Code 2.1.275 and later). It may remove the need for the development flag and the warning dialog. Compare, including whether it can wake an idle session.
4. **Escaping of Channels' `meta` attribute values (unverified)**: `toChannelParams` passes the JSON string of `meta` without converting `"` `<` `>` `&` (`escapeAttr` is only on the polling path). Neither the official docs (§6.1) nor §6.1c's live confirmation say anything about escaping attribute values. Only `</channel>` in the body is confirmed (§6.1c).
   **Provisional restriction**: until confirmed, the `meta` put on Channels is only the known keys of `files` (`id` `mime` `size` `width` `height` `path` `error`) (`channelMeta` in `src/shared/format.ts`). Other keys and the sender's `meta` can be read only from `inbox()` (`<hub-message>`). Values are not converted. The restriction will be lifted once confirmed.
   If Claude Code escapes attribute values itself, converting on our side too would double it. So conversion is on hold. How to check: start the probe and send a notification with `probe_quote: 'a"b<c>&d'` through `GET /case/attr`. Ask the session to "copy the tag of the last channel notification verbatim into probe_note", and record whether `note`'s `probe_quote` appears as `a"b<c>&d`, was converted to `&quot;` and the like, or the attribute was cut off midway. Depending on the result, decide whether to use `escapeAttr` for meta too or leave it, and write the result here.

5. **Whether the role description works as Claude Code's instructions (confirmed, 2026-10-17)**: that the description goes into the instructions of a shim started with `HUB_ROLE=<a defined role>` was confirmed by a test (`src/shim/role-instructions.test.ts`).
   In a real session (`roles.example.json` copied to `roles.json`, with leader / deployer / reviewer connected at once): the reviewer stated the description in its instructions verbatim, and without calling `subscribe` received notices addressed to `topic:review.request` and to `role:reviewer`. In neither case did the deployer's or leader's cursor move; they did not receive them.
   The reviewer did not reply to the notices, and said "send a request stating the target for a review". This follows the description (reads review requests and returns findings as a reply).

6. **Whether `StopFailure` fires while waiting for automatic resume after a usage limit**: it was not registered in §6.1q. It was registered in `tools/hooks/settings.json` in C38 (2026-10-26). The next time the limit is hit, record whether an Event (`error: "rate_limit"` and the like) arrives, and the interval until `quota_auto_resume_fired`.
7. **Whether `/clear` changes the hook's `session_id`**: the shim keeps declaring the `CLAUDE_CODE_SESSION_ID` from its start at attach (§6.1c). If `/clear` changes only the hook's `session_id`, the Event's session and the Attachment's session drift apart. The UI excludes from the human's move only "questions and permission waits issued by another session before the current connection" (C41), so questions after `/clear` are counted. Check with the hook input before and after `/clear` whether it changes, and whether it affects resolving the Event's Mailbox (the first means of §3.4).

8. **Starting a team on macOS (C62)**: the Terminal.app opener (`osascript … do script`) is covered only by a unit test of the command it builds; it has not been run on a Mac. Nor has a real `claude` session on Linux been started by `npm run team` (§6.1x used a stub). Check: on a Mac, `npm run team -- --roles leader,deployer`, and see that a window per role opens in the project folder and attaches.

## 7. Relation to MCP Events (SEP-3415)

### Current state (as of 2026-10-16)

- MCP's Triggers & Events WG is proposing **SEP-3415 "Events Extension"** (Draft, created 2026-10-05). The extension ID is `io.modelcontextprotocol/events`, and it assumes protocol `2026-07-28` or later.
- There is no reference implementation in the official SDKs yet. ChatGPT supports only webhook mode. **Claude Code does not support it** (no official mention; there are third-party reports).
- The SEP standardizes up to "MCP server → client SDK", and **how events are delivered to the model is out of scope**. The means of inserting external events into a Claude Code session are, for now, limited to Channels (and plugin monitors).

### Direction

- **For now deliver with Channels, and align the vocabulary and data model with the SEP.** When Claude Code supports it, add `io.modelcontextprotocol/events` push (`events/stream`) to the shim as one delivery adapter (§3.9), and offer both.
- What is adopted:

| SEP concept | How agent-hub handles it |
|---|---|
| Derive the subscription ID from meaning; do not have the client generate it (Subscription identity) | Mailboxes are identified by logical name (§3.3) |
| The client always passes the last cursor, and the server handles it idempotently | `after` of attach / stream. The shim does not remember; the Hub holds the Mailbox's cursor |
| cursor = the acked watermark, advanced by heartbeats even in quiet periods | The Mailbox's cursor and the SSE heartbeat |
| `maxAgeMs` and `truncated` | Controlling the inflow at attach (§3.3) |
| De-duplicate by `eventId`, preferring upstream IDs | Message `id`, deterministic generation of event IDs (§3.4) |
| TTL / lease, with a successful refresh as the signal of liveness | The Attachment's lease |
| Distinguish reasons for ending with `terminated` | `superseded` and so on (protocol.md) |
| The input and output of `events/poll` | The input and output of `inbox()` |
| Payloads are untrusted data | Separating body and attributes with `meta` / `<hub-message>`, operating rules (§4) |

- Not adopted: the whole webhook delivery set (HMAC signatures, SSRF protection, endpoint verification), all three delivery modes, `principal`, and subscription `arguments`. None are needed for agent-hub, which is 127.0.0.1 and single-user.

### An experiment report worth referring to

The WG's field report (experimental-ext-triggers-events #6) reports that persisting "dormant goals, subscription settings and processed eventIds" on the client side lets the same logical goal resume after a runtime restart, with redelivery de-duplicated too.
It also concludes that "which session/goal to tie an event to, and whether to continue, start new, or batch" is the runtime's responsibility, not the protocol's. agent-hub's Hub takes on this runtime role.

## 8. Relation to existing mechanisms (survey of 2026-10-16)

After P0, we surveyed official features and OSS in the same area. **Delivery between sessions is officially part of Claude Code itself**, so agent-hub's own value narrows to "the human's console", "logical Mailboxes" and "fan-out to roles/topics".

### 8.1 Comparison

| Mechanism | Summary | Overlap with agent-hub |
|---|---|---|
| **Official cross-session messaging** | Sessions on the same machine send plain text to each other with `ListAgents` / `SendMessage`, addressed by session name (`--name` / `/rename`). Native Windows from v2.1.234, with no setup or flag. During a turn it is read between tool calls; if idle, a new turn starts. `notify_when_idle` asks to be notified once when the other side returns to idle | **Most of delivery.** Even not propagating consent, loop suppression, burst limits, and the receiver's `crossSessionInbound` (accept / hold / refuse) are official |
| **Official agent teams** (experimental) | A lead and teammates, a per-teammate inbox (`~/.claude/teams/<team>/inboxes/<name>.json`), a shared task list. Roles reuse subagent definitions, and the model can be chosen per teammate. `TeammateIdle` / `TaskCompleted` hooks | The leader / worker structure, and part of detecting breaks (P1) |
| **claude-relay** | A resident Hub (Unix socket) + a channel MCP per session. Started with the development flag | **Almost the same structure.** No persistence, UI or authentication |
| **mcp_agent_mail** | Inboxes/outboxes and threads, persistence in Git + SQLite, a web UI, an ID for the human overseer, file reservations (leases) | Mailboxes, persistence, a UI for humans. **The closest in philosophy.** The receiver fetches, and it does not depend on an app |
| **Kanban-style** (Vibe Kanban, Kandev, kanbots and others) | One card = one agent running in parallel in its own worktree; the human handles cards and reviews | Not message passing but task management and parallel execution |
| **Official Agent View** (`claude agents`, research preview, 2026-05; added in the re-survey) | Lists every session by state (Needs input / Working / Idle / Completed / Failed) and lets you reply on the spot. Emits `agent_needs_input` / `agent_completed` to the Notification hook | **Most of P1.** But the screen is only the terminal, and permission prompts cannot be answered on the spot |
| **walkie-talkie** (added in the re-survey) | Hub + MCP, `@name` / `@all` and channels, a human can send from the browser, pasting images. Delivery is long poll | **Almost the same structure as P0.** No persistence or role descriptions |
| **open-agent-bridge** (added in the re-survey, 0.1) | A registry + ACKs stored in SQLite. Changes the last step of delivery per client (the official receiving end for Claude, `turn/start` for Codex, a plugin for OpenCode) | **Has implemented §3.9's delivery adapters.** No authentication, no role / topic |
| **kanary /relay** (added on 2026-10-26 after reading kanary.to/agents; the author in the README's "Inspiration") | A Mac app. Typing `/relay` in the input field of the Claude, Codex or Cursor desktop apps writes the conversation since the previous relay, unprocessed and with speakers, into the other app's thread. Reads and writes the screen with macOS accessibility permissions. Text after it is the human's covering note; if empty nothing is sent; it is sent only when a human typed it. On failure it falls back to Copy | The model for the Relay screen (§3.2). It carries by operating the screen, and holds its own per-app handling and failure handling (integrating by screen operation is out of scope; the top of the roadmap's "Items"). How it differs from sending by stretch is in §3.12 |

### 8.2 Overlap per feature

| agent-hub feature | Overlap | Grounds |
|---|---|---|
| Immediate delivery to sessions (Channels + shim) | Large | The official cross-session messaging does the same, without a research preview or the development flag |
| Addressing by name | Large | Officially a session name can be the address |
| leader / worker and roles | Medium | There are agent teams and subagent definitions. But the official role is a way of starting, not an address |
| Detecting breaks (P1) | Medium | `notify_when_idle` / `TeammateIdle` are close. But they notify a session, not a human's UI |
| A logical Mailbox that survives replacement, and carrying over unread messages | Small | The official address is a live session, and at most 100 are held. Agent teams cannot be resumed. mcp_agent_mail has it |
| Fan-out to roles / topics | Small | The official docs state "to send to everyone, send to each one" |
| A human's console that shows every message on one screen and can write from the browser | Medium | Official messages are scattered across terminals as one-line previews. But walkie-talkie and mcp_agent_mail (the HumanOverseer compose screen) can send from the browser (corrected in the re-survey) |
| The policy of a human pressing Send | Unique | The trend leans autonomous (self-claiming tasks, auto-approving plans, humans reviewing in PRs). The official docs also recommend "monitor and steer" |

### 8.3 Implications

A structure that leaves delivery to the official receiving end, with the Hub devoted to logs, the UI, logical Mailboxes and fan-out, is conceivable. It would remove the dependence on Channels and the development flag.
Whether to adopt it was decided in §9-5 (stay on Channels until the posting format is published). What was verified:

1. **Whether the receiving end's information reaches the shim**: the official docs say `CLAUDE_CODE_MESSAGING_SOCKET` / `CLAUDE_CODE_MESSAGING_TOKEN` are passed to hooks and Bash, and do not say whether they enter a stdio MCP server's environment.
2. **Whether posting from the shim is accepted**: posting from your own child process is accepted without settings on the receiving side (own-child). On native Windows the child process can be confirmed only by the token, so 1 is a prerequisite.
3. **How to pass the sender's attributes**: cross-session messages are plain text, with nothing corresponding to Channels' `meta`. The invariant of passing the sender's attributes separately from the body (protocol.md §6) would have to be kept by the body's format.

### 8.4 Points of technical reference (re-survey, as far as the READMEs go; the code was not read)

The structure (Hub + an MCP per session + a browser) is standard; what is unique to agent-hub is only the combination of "a logical Mailbox that survives replacement", "fan-out to roles / topics and `kind`", "the policy of a human pressing Send", and "putting the sender's attributes outside the body with `meta`".

- **mcp_agent_mail (the Rust version)** is the best overall.
  - Keeps `read_ts` and `ack_ts` separately per receiver, and can request confirmed receipt with `ack_required`.
  - Storage in two layers: SQLite for live state and search (FTS5), Git as the source of truth for auditing (commits are batched).
  - **File reservations before work**: reservations by glob + TTL, with a pre-commit hook stopping commits into ranges others hold.
  - Weakness: delivery is pull only.
- **open-agent-bridge** has the most careful delivery design.
  - ACK states `queued → delivered_to_bridge → displayed_to_client → answered | failed`. It never claims "the model read it".
  - Claims before sending, preventing double delivery on reconnect.
  - Wraps the body in `BEGIN/END MESSAGE`, adds a notice, and fixes that structure with tests.
  - Weakness: no authentication.
- **Candidates to take in**: reservations before work (extending §3.11's SCOPE to a declaration made in advance), the distinction between "read" and "received", honest names for ACK states.

### 8.5 Re-survey of 2026-10-30 (from search listings only; READMEs and code not read)

Found by web search; what is written comes from the listing pages' summaries and is unverified. None changes §8.3 / §8.4: the structure is common, and none of them has the policy of a human pressing Send.

| Mechanism | Summary (as listed) | Overlap with agent-hub |
|---|---|---|
| **Switchboard** (rodcoppi/switchboard-mcp) | A local MCP hub for Claude Code agents to talk to each other. Starts each agent in a tmux session, nudges the terminal, and has a web dashboard | Hub + MCP + browser, and starting agents (like `npm run team`) |
| **Agent Hub MCP** (gilbarbara/agent-hub-mcp) | Communication, context sharing and task coordination between Claude Code agents across projects. Web dashboard, REST API with SSE | Almost the same structure, including across projects. Holds shared context, which the Hub does not (§3.14) |
| **chat-mcp** (thiagovictorino) | Channels for Claude Code instances, runs in Docker, a web UI for watching conversations | Topics and resident in Docker |
| **claude-ipc-broker** | Sessions message each other; both a Claude orchestrator and a human can give orders from the dashboard | The human's console. The closest of the new ones to §2's human-in-the-loop |
| **claude-code-relay** / **cross-agent_mcp** | Relays between Claude Code sessions over MCP (the former without stealing window focus; the latter also Codex) | Delivery only |
| **Agent Mail Rooms** | A paid, remote MCP endpoint for coordinating Codex agents with shared state | Hosted relative of mcp_agent_mail |
| **Executive**, **c9s**, **CCDash**, **RCFlow** | Dashboards / orchestrators for many Claude Code (and Codex, OpenCode) sessions: c9s in the terminal, the others on the web | State display (P1), like Agent View. Not message passing |
| **A2A protocol** (Agent2Agent) | A standard for agents to talk across vendors. Tasks pause in `input-required` (more input needed) or `auth-required` (authentication needed) | The vocabulary for "waiting on the human": a question ≈ `input-required`; a permission wait is near `auth-required` but not the same. Not used for local coding sessions as far as found. A candidate to map to, like MCP Events (§7) |

Observation: delivery, addresses and dashboards are converging, so the difference stays in §1.1's own layers (records, conventions, the human's decision points), not in features.

## 9. Open questions (design)

1. **The takeover policy**: exclusive (the newer wins; provisional), or allow several attaches at once (deliver to all / deliver to one of them).
   **Decision (2026-10-17, user): exclusive, the newer wins.** A Mailbox is "who it is logically for" (§3.3), so the receiver is kept to one.
   To have the same work done in parallel, make another Mailbox with the same role (a `to: role` message reaches both).
2. **Whether to deliver Events by subscription**: are hook Events only shown in the UI, or also delivered to other Mailboxes as topics such as `session.boundary`?
   **Decision (2026-10-16)**: **only show them in the UI.** There are official means for an agent to learn that another returned to idle (`notify_when_idle`, `TeammateIdle`; §8.1).
   Also, sending Events to other agents moves toward "act automatically on receipt" (§3.5). To tell an agent, a human sends with Send from the UI.
3. **Deleting and leaving Mailboxes**: clean up Mailboxes with no attach for a long time automatically, or only delete explicitly from the UI?
   **Explicit deletion is implemented**: `DELETE /mailboxes/:name` and the UI's Delete (only on unconnected cards). Connected ones are refused with 409. **Whether to clean up automatically is open** (the Messages' retention was decided in §9-8; Mailboxes are small, so piling up only burdens the display). Unread messages are abandoned by the attach-time limit (§9-4), and those of a Mailbox with no attach just accumulate. Deletion keeps the Message log, and recreating with the same name starts from the seq of the deletion (protocol.md §2).
4. **The default of `maxAgeMs`**: how many hours' worth to flow for an attach without it.
   **Decision (2026-10-17, user)**: a common-sense value is fine for a guard. Narrow by count in addition to age. The defaults are **7 days / 50 messages** (`HUB_UNREAD_MAX_AGE_DAYS` / `HUB_UNREAD_MAX`; 0 means no limit; can be overridden per attach).
   Sessions do get left, and important documents are kept in the repository, so not pouring into a successor all at once takes priority over strictly keeping old unread messages. What is discarded remains in the Message log.
5. **Whether to move delivery to the official cross-session messaging**: continue with Channels, or move to posting from the shim to its own session's receiving end (§8.3)?
   Either way, the source of truth for Mailboxes, roles and unread messages stays on the Hub (§3.7). If moving, build the socket for swapping delivery adapters here (§3.9).
   Verification result (§6.1g): the receiving end's information reaches the shim, but the posting format is not public.
   **Decision (2026-10-16)**: **continue with Channels.** Moving would depend on two things, an undocumented environment variable and a private format, and cannot be called more stable than Channels.
   The third-party format (the addendum in §6.1g) was not tried (Claude Code's auto mode refused posting to its own session as a permission bypass).
   Revisit once the posting format is in the official docs. Then the sender's attributes are separated not by `meta` but by how the body is wrapped (§8.3-3).
6. **Whether to declare and check message shapes** (§3.11): refuse violations with 400, or accept and only warn in the UI? Does the Hub check SCOPE (the Hub does not read the working tree; §3.8), or does the leader with `git diff`?
   **Direction (2026-10-16)**: following the citation bridge's ERROR / NOTE, structural breakage decided by machine is 400, and things awaiting confirmation such as changes outside scope are accepted with a warning. The facts of a change are derived by deterministic processing on the host, and the Hub only checks against them (open question 1 of §3.11).
   **Direction on assigned areas and conflicts (2026-10-16)**: split in three.
   - Isolation is borrowed: separate git worktrees per deployer (the same as the official Agent View / agent teams).
   - Declaration is the Hub's: record the `SCOPE` (a list of globs) of a request to `role:deployer` as the assigned area, and release it with the matching reply. Agents are not made to call a reservation tool. Conflicts are not refused but warned about in the UI (advisory; the same as mcp_agent_mail in §8.4). Resources other than files (e.g. port 7777 of the production Hub) can go in the same ledger.
   - Enforcement is at the place of editing: only where it must be stopped, add a `PreToolUse(Edit/Write)` hook or a git pre-commit hook.
   - **Not built now.** There is one writer, the deployer, so conflicts do not happen (criterion 2 of §1.1). When there are two or more writers, first try worktrees, and add declarations only for what is missing.
7. **Whether to narrow `role:` messages to a project's scope** (§3.3): today they reach every Mailbox with that role across the Hub. One idea is to deliver only to the role in the same project, using the Mailbox's `project`.
   **Decision (2026-10-18, user): narrow them, to the same unit as the UI's filter.** A `role:` message can have a `project` (the path of a working folder), and when it does, it reaches only Mailboxes whose `project` is the same (compared with `normalizeProjectPath`).
   - An agent's `role:` message is narrowed by the Hub to the sender Mailbox's `project` (the sender need not say so). In a trial started in vcp, `role:deployer` piled up even in other projects and in Mailboxes from before the naming rule changed. Requests across projects are addressed with `mailbox:`. If the sender has no `project`, it is not narrowed.
   - From the browser, the `project` is added only when a project is chosen in the UI (with All projects it reaches everything, as before).
   - The `project` stays in the Message's `to`, so a narrowed address is visible in the UI's history. `topic:` is not narrowed (subscriptions are used for cross-cutting concerns, such as `review.request`).
8. **When to delete the Message log**: keep everything, or delete by retention period? If deleting, how to treat requests awaiting a reply (a: never delete them automatically / b: the Hub does not remember, and the leader writes them in documents)?
   **Decision (2026-10-18)**: Messages that have been handed over are deleted after 24 hours. Requests awaiting a reply are **a** (not deleted automatically). Awaiting reply is a delivery state, "was the delivery's promise kept", not knowledge, so it fits the principle of connection only. With b, nothing would catch it when the leader forgets to write it down. A manual deletion operation is added too. The images' TTL is 1 day. Details in §3.14.
   The condition for closing awaiting reply was later extended with a request or reply from the other side (C28, 2026-10-23; protocol.md §2).
9. **Whether to keep requests awaiting a reply that are tied to an item** (open question 1 of §3.16): the source of truth for progress was put in the roadmap (§3.16, 2026-10-19), so requests with `meta.item` can be followed on the item's card. Whether to narrow §9-8's decision a to requests without an item. Decide after building the "reflected" judgment (§3.16), by seeing whether a reason to keep them remains.

(Decided: the token is passed to the browser by cookie; §4)

10. **Whether project filtering also leaves waits unhidden** (thread filtering in §3.2; came up in C59's implementation): the done-when condition is "questions, permission waits and requests to the human are not hidden by any combination of axes". C59 applied it to the Mailbox, kind, notification and collapse axes, and left project as before (waits in other projects are hidden and counted in `N waiting in other projects`). Extending it to project would show other projects' questions on the chosen project's screen. A human decides which.

## 10. References

- Channels reference: <https://code.claude.com/docs/en/channels-reference.md>
- SEP-3415 Events Extension: <https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415>
- Triggers & Events WG charter: <https://modelcontextprotocol.io/community/working-groups/triggers-events>
- WG field report (stdio restart recovery): <https://github.com/modelcontextprotocol/experimental-ext-triggers-events/issues/6>
- Hookdeck mcp-events-bridge (integrating Claude Code through a monitor): <https://github.com/hookdeck/mcp-events-bridge/issues/26>
- Cross-session messaging (official): <https://code.claude.com/docs/en/cross-session-messaging>
- Agent teams (official): <https://code.claude.com/docs/en/agent-teams>
- claude-relay: <https://github.com/vildanbina/claude-relay>
- mcp_agent_mail: <https://github.com/Dicklesworthstone/mcp_agent_mail> (Rust version: <https://github.com/Dicklesworthstone/mcp_agent_mail_rust>)
- open-agent-bridge: <https://github.com/kevinArgueta96/open-agent-bridge>
- walkie-talkie: <https://github.com/suruseas/walkie-talkie>
- Agent View: <https://code.claude.com/docs/en/agent-view>
- A comparison of Kanban-style tools (third party): <https://nimbalyst.com/blog/best-multi-agent-coding-tools-2026/>
