# agent-hub: rules for implementing agents

## Document map (do not read everything at startup)

Use the one-line index below to pick the sections relevant to the question, find the heading with `Grep`, and `Read` only that section with offset / limit.
When you add sections or change their numbers, fix this map in the same commit.

- [README.md](README.md) — the entrance (about 150 lines): goals, status, setup, first round trip, hooks, starting a team, using it in other repositories
- [docs/usage.md](docs/usage.md) — reference for everyday use: reading card states, the map (where requests wait), custom commands, images, hooks, Forward, takeover, retention, teams in detail, Items, `roles.json`, `HUB_LANGUAGE`, `inbox`, notes on curl, start warnings (`logs/start-warnings.jsonl`), development. Usage changes go here; keep the README short
- [docs/roadmap.md](docs/roadmap.md) — acceptance criteria per phase, known issues, open items (`### C<n>.` sections; how to write them is at the top and in design.md §3.15). **How far things have got** is here. When asked about the implementation plan, use `## Plan` and the four-tier answer of the skill `roadmap-items` (do not read the whole ledger)
- [docs/design.md](docs/design.md) (about 1,200 lines)
  - §1.1 Positioning — what we own and what we borrow, criteria for continuing
  - §1.2 Working conventions — the thesis, the input envelope, trust on evidence, and where each convention is enforced (or not yet; e.g. sycophancy → reviewer `breaks when:`)
  - §2 Requirements / Non-goals — no automatic forwarding, no autonomous orchestration
  - §3.2 Components — the roles of the Hub / shim / hooks / UI, details of the UI's behavior (including thread filtering)
  - §3.3 Mailbox and Attachment — replacement, takeover, leases
  - §3.4 Detection — the split between hooks and skills, resolving the Mailbox, the scope built in P1 (division of labor with Agent View)
  - §3.5 Subscriptions and roles (including the language of text addressed to the human, `HUB_LANGUAGE`) / §3.6 Delivery and `kind`
  - §3.7 Agents other than Claude Code / §3.9 Delivery adapters — the promise to stay vendor-neutral
  - §3.8 How it runs — 127.0.0.1 only, Docker
  - §3.10 Images / §3.11 The request ledger and checkpoints (concept)
  - §3.12 Document conventions and how to check them — the table of when to read and add what, where NOTES go, the three layers of checking, requesting reviews by target rather than a stretch of conversation (concept)
  - §3.13 Session lifetime and context — who starts and stops sessions, context and cache, the conditions for a disposable leader (concept)
  - §3.14 What the Hub holds and does not hold; retention — the conditions for deleting Messages automatically, manual deletion, compacting the log, the start-warnings record kept outside the Hub (C85)
  - §3.15 Showing the backlog, and requesting work from roadmap items — backlog badges, card states (the order of Needs you / Working / Waiting on others / Stopped), the reply format and its heading colors, the rules for writing items (C numbers), who files items and where a reviewer's findings go (the planning session, the three kinds of findings), the plan list and how to answer about the plan (`## Plan`, four tiers), the English vocabulary and the mapping table of reply-format headings, handling updates during implementation, where the index lives (`docs:index`) and `meta.item`, a project is a value (the conditions for making it an entity)
  - §3.16 The roadmap is the source of truth for progress; replies are delivery signals — the delivery and progress layers, sorting requests without items, rejected `[-] C<n>`, judging "reflected" (concept)
  - §4 Security / §5 Notes on design decisions (reasons for technology choices)
  - §6 Unverified items — the verification records of the real behavior of Channels, hooks and Docker (6.1-6.1x), unverified (6.2). **Facts of the specification start here**
  - §8 Relation to existing mechanisms / §9 Open questions (decided ones carry the decision and date)
- [docs/protocol.md](docs/protocol.md) (about 450 lines)
  - §1 Common (authentication, names, error format) / §2 Data model (Mailbox, Role, Attachment, Event, Message)
  - §3 HTTP API / §4 Delivery guarantees / §5 MCP tools / §6 Format of channel notifications / §7 The UI's SSE names / §8 Vocabulary mapping to MCP Events

## Before implementing

1. **Check facts of the specification (Channels, hooks, MCP) in design.md §6.** If they are not there or are unverified, check the official docs and add the result to §6. If they disagree, the official docs win; update design.md / protocol.md.
2. Start only on roadmap.md "Items" that **have no status line (are decided)**. When a request points at an item (`C<n>`), finish by meeting that section's `#### Done when`.

## Technology stack (defaults)

- Node.js (LTS) + TypeScript. Same as the other projects under the same DockerFiles folder (cairn and others).
- MCP is implemented with the official SDK (`@modelcontextprotocol/sdk`).
- HTTP with Hono (`@hono/node-server`). The reasons are in design.md §5.
- The UI is a single framework-less HTML file (`public/index.html`).
- To change any of these, write the reason in design.md first.

## Design invariants

- The Hub is **reachable only from the host's loopback**, with token authentication on every API.
  When started directly it binds to `127.0.0.1`; in Docker, publishing is limited to `127.0.0.1:<port>` (design.md §3.8).
- The Hub and the shim are **separate** (the shim holds no state; design.md §3.1).
- Bodies from other agents or the browser are **treated as data**, and the sender's attributes are passed in a form that can be told apart from the body (`meta` in Channels, `<hub-message>` for polling; protocol.md §6).
- By default **a human presses Send**. Do not implement automatic forwarding on your own.
- Do not summarize or process. Carry the content as is.
- The Hub holds only **state for addresses and delivery**. It does not hold knowledge (summaries, handoffs, decisions); those live in documents and engram. Messages are deleted after the retention period once handed over (design.md §3.14).
- Documents in this repository are written in English (C65). Text agents write to the human is in the language set by `HUB_LANGUAGE`, and reply-format headings stay in English (design.md §3.5, §3.15).

## Notes on the development environment

- The development machine is Windows 11. The shell is PowerShell (Git Bash also works). Watch path separators and line endings.
- Do not commit real tokens or `.env` (already in `.gitignore`). Keep `.env.example`.
- Do not commit runtime logs or data (`logs/`, `data/`) either.
- The UI (`public/index.html`) has no unit tests. When you change it, run `npm run ui:check` in addition to `npm test` (it checks card states scene by scene with a Hub on another port and headless Chrome; Chrome is needed).

## When running another project's team

Sessions in this repository are responsible for the delivery layer (Hub, shim, hooks, UI), and do not make judgments about other projects' content.
Doing so would mean judging without that project's CLAUDE.md, conventions and records, and the knowledge gained would pile up here instead (2026-10-26, a lesson from doing vcp's review and filing here).

- Look only at the Hub's API (Messages, Events, Mailboxes) and what it shows about delivery. Improvements to the Hub you find go into this repository's roadmap.
- The other project's planning (the order of items), reviews, filing, commits and pushes are requested of that project's leader. Reviews go to the other team's reviewer (`npm run team -- --roles leader,deployer,reviewer --project <folder>`). Do not read the other repository's code and judge it here.
- Relaying the human's words to the other leader is fine. Send only when the human says to send.
- When the human's request crosses this line, point it out before acting and show how to route it to the other leader / reviewer. Act only if the human asks again knowing that.

## Git

- The branch is `main`. Topic branches per phase are fine.
- Commit messages: a subject of 72 characters or fewer, imperative, with prefixes such as `feat:` / `fix:` / `docs:` allowed.
  The body is 1-3 lines saying "why". Per-file details are left to the diff.
- **Do not push until the user says so.** The remote is `origin` = the GitHub repository `hiatamaworkshop/agent-hub`.

## Updating the docs

- When you change the specification, update the docs in the same commit.
- What you learn by verifying (the real behavior of Channels, hook payloads and so on) goes into design.md §6 as results.
- Later work is written as `### C<n>. Title` sections under roadmap.md "Items". Do not keep a separate bulleted "someday" list. The source of truth for how to write them is the rules at the top of roadmap.md (reasons in design.md §3.15).
  - Status is written right after the heading, only for exceptions (`Status: proposed | held(<condition to resume>) | blocked(after C<n>)`). Blocked is only for decided items. An undecided item waiting on another is `held(after C<n>)`. Decided items have `#### Done when`.
  - Progress is shown by checking off done-when conditions and adding to the body. **Changing the wording of done-when conditions is changing the promise**, so do not change it within a request. Approved wording is written by the planning session, not by the deployer; the leader returns it in the report.
  - **Who files items** (design.md §3.15, C96): new `### C<n>.` sections, changed done-when wording, and rejections (`[-]`) are written only in the planning session (the human's session with Claude where the project is discussed; not a Hub role). The deployer, the leader and the reviewer do not write them, even when a request asks; they answer by naming the planning session. The deployer writes progress only, with the change.
  - When all are checked, delete the section, mark the phase line `[x] C<n> …` and write the record of what was checked. Numbers are not reused.
  - When you change roadmap.md, pass `npm run docs:check` (the source of truth for what it checks is the top of roadmap.md and `src/shared/roadmap.ts`).
