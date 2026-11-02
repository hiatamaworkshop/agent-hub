# Using agent-hub in a project

A short guide for a project that is about to run its first team. It lists what the project should have, how to write items, and who writes what. It points to the source of truth for details instead of repeating it.

## 1. Once per machine

1. Set up and start the Hub: README steps 1-2 (Docker: `docker compose up -d --build`). `HUB_TOKEN` in agent-hub's `.env` is at least 16 characters.
2. Put [tools/bin/](../tools/bin/) on PATH, so `hub-team` runs from any project folder.
3. Open the UI with the URL a start prints (its last line).

## 2. Preparing a project (checklist)

| What | Why | How |
|---|---|---|
| `CLAUDE.md` with a **document map** | Leader and reviewer start reading from it; without it their search is ad hoc. In practice it is required | One line per document (and per section for long ones): what it holds. Example: agent-hub's own [CLAUDE.md](../CLAUDE.md) |
| Working rules in `CLAUDE.md` | Rules for every request are not repeated in items | The test command, "do not commit/push until told", what not to touch |
| A **ledger** of `### C<n>.` items | Items are what you request from the UI, and what the reviewer reads | Section 3. Name it in the map |
| `.agent-hub.json` if the ledger is not `docs/roadmap.md` | Team start, `docs:index` and the post-commit hook read it; without it they send `docs/roadmap.md`, and Items shows empty | `{ "ledger": "docs/items.md" }` at the project root ([usage.md, Items](usage.md#request-work-from-roadmap-items-items)) |
| A place for **decisions** and **verified facts** | The reviewer gets no conversation, only a target; documents are its only source of what was decided | E.g. a design doc with a decisions section (question, then "Decision (date)" and the reason) and a facts section. Name both in the map |
| Hub hooks | So cards show question / permission waits | Written on the first team start (C111); or `npm run team -- hooks --project <dir> --write` |
| Post-commit hook (optional) | Sends the index when a commit changed the ledger | Copy `tools/hooks/post-commit-index.sh` to `.git/hooks/post-commit` and set `AGENT_HUB_DIR` ([usage.md, Items](usage.md#request-work-from-roadmap-items-items)) |

Check the ledger with `npm --prefix <agent-hub> run docs:check -- <absolute path of the ledger>`.

A project whose ledger has its own format (states in headings, no done-when lists) is read as all "decided". Do not index it; send plain requests with the item number in the body (roadmap C27).

## 3. Writing items

```markdown
## Plan

- [ ] C11
- [ ] C12

## Items

### C12. Add a header to the extract
Status: blocked(after C11)

Design: docs/design.md §4. Facts and decisions about this item go here.

#### Done when
- [ ] `extract` writes the header (shape in design §4.1)
- [ ] Tests: reading and writing the header pass
- [ ] The full test suite passes
```

- Heading `### C<n>. Title`. Numbers are never reused.
- No status line means **decided**. Exceptions, one line right after the heading: `Status: proposed` (waits for a human), `held(<condition to resume>)`, `blocked(after C<n>)` (decided items only).
- `#### Done when` is the promise. Each line can be checked on its own; common conditions (tests, docs) are repeated per item. Write only the current decision; rejected ideas and history go in the body.
- **Decisions go in the item's body** (or the decisions section it points to), with the date. The reviewer learns about the discussion only from there.
- `## Plan` lists decided and blocked items in the order they will be taken up, IDs only. Reordering is the human's call.
- One item is about one request's worth of work.
- Done: delete the section, leave `- [x] C<n> Title (YYYY-MM-DD, …)` with what was checked. Rejected: `- [-] C<n> Title (rejected YYYY-MM-DD, reason)`.
- Japanese vocabulary (`状態: 提案`, `#### 完了条件`, `## 予定`) is read the same way.

Source of truth: the top of [roadmap.md](roadmap.md) and `src/shared/roadmap.ts`; reasons in [design.md](design.md) §3.15-3.16. The global skill `roadmap-items` (`~/.claude/skills/`) is the same rules in Japanese, for sessions in other projects.

## 4. Who writes what

| Who | Writes | Does not write |
|---|---|---|
| **Planning session** (the human with Claude, outside the Hub) | New items, done-when wording, rejections, the plan order | — |
| Leader | Requests to the deployer, reports to the human | Files (hands every change to the deployer); items |
| Deployer | The change, checked boxes and facts in the item's body, the close when asked | New items, done-when wording |
| Reviewer | Findings, proposed wording (old → new) | Code, docs, items |

A finding or an `OUT OF SCOPE:` line is a candidate. It becomes an item only when the planning session files it. Proposed done-when wording comes back to the human in the leader's report.

## 5. One item, end to end

1. The planning session files and decides the item and commits the ledger (the index is sent by the hook, or by the next team start).
2. Start a team in the project: `hub-team --roles leader,deployer` (add `reviewer` for reviews).
3. In the UI: Items → the card → **Draft request** → Send.
4. The leader sends the work to the deployer, checks the diff and the tests, and asks for a review if a reviewer is connected.
5. After the review and its fixes, the leader sends a separate closing request (C102), then reports to you.
6. You commit (and push) when you say so.

Follow from a terminal with `npm run team -- status --project <dir>` (the Mailboxes and the latest report).

## 6. Where things go

| What | Where |
|---|---|
| A fact checked on a real machine or in official docs | The project's facts section |
| Something decided | The decisions section, or the item's body, with the date and the reason |
| Later work | A new `### C<n>.` (planning session only) |
| A rejected idea | `[-] C<n>` with a one-line reason |
| Knowledge across projects | engram / memory, not the Hub (the Hub holds only delivery state) |
