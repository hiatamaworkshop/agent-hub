# Using agent-hub in a project

A short guide for a project that is about to run its first team. It lists what the project should have, how to write items, and who writes what. It points to the source of truth for details instead of repeating it.

## 1. Once per machine

1. Set up and start the Hub: README steps 1-2 (Docker: `docker compose up -d --build`). `HUB_TOKEN` in agent-hub's `.env` is at least 16 characters.
   - Copy `roles.example.json` to `roles.json` **before the first start** (README step 1). The Hub reads it only at startup and, without it, gives the roles no description and no default subscriptions; after adding it, restart the Hub.
   - If the human reads another language, set `HUB_LANGUAGE` in `.env` (for example `ja`; [usage.md](usage.md#the-language-agents-write-to-the-human-in-hub_language)). Agents then write to the human in it; the reply-format headings stay in English.
2. Put [tools/bin/](../tools/bin/) on PATH, so `hub-team` runs from any project folder. On Windows, PowerShell: `$env:Path = '<agent-hub>\tools\bin;' + $env:Path` (this terminal only; add it to your profile to keep it). Git Bash: `export PATH="<agent-hub>/tools/bin:$PATH"`. Checked on Windows 11 with `hub-team status` run from another project's folder (2026-11-03).
3. Open the UI with the URL a start prints (its last line).

## 2. Preparing a project (checklist)

| What | Why | How |
|---|---|---|
| `CLAUDE.md` with a **document map** | Leader and reviewer start reading from it; without it their search is ad hoc. In practice it is required | One line per document (and per section for long ones): what it holds, and where the non-goals, decisions and verified facts are. Examples: agent-hub's own [CLAUDE.md](../CLAUDE.md); for another project, cairn's `CLAUDE.md` (its document map section). Skeleton below the table |
| Working rules in `CLAUDE.md` | Rules for every request are not repeated in items | The test command, "do not commit/push until told", what not to touch |
| A **ledger** of `### C<n>.` items | Items are what you request from the UI, and what the reviewer reads | Section 3. Name it in the map |
| `.agent-hub.json` if the ledger is not `docs/roadmap.md` | Team start, `docs:index` and the post-commit hook read it. Without it they look for `docs/roadmap.md`; if that file has no items nothing is sent and the summary names `.agent-hub.json` | `{ "ledger": "docs/items.md" }` at the project root ([usage.md, Items](usage.md#request-work-from-roadmap-items-items)) |
| A place for **decisions** and **verified facts** | The reviewer gets no conversation, only a target; documents are its only source of what was decided | E.g. a design doc with a decisions section (question, then "Decision (date)" and the reason) and a facts section. Name both in the map |
| Hub hooks | So cards show question / permission waits | Written on the first team start (C111); or `npm run team -- hooks --project <dir> --write` |
| Post-commit hook (optional) | Sends the index when a commit changed the ledger | `npm run team -- git-hook --project <dir> --write`: a thin hook that calls agent-hub's script, so it follows its updates ([usage.md, Items](usage.md#request-work-from-roadmap-items-items)) |

A document map, in the shape both roles read:

```markdown
## Document map (do not read everything at startup; Grep the heading, then Read that section)
- [README.md](README.md) — what it is, setup
- [docs/design.md](docs/design.md) — §1 goals, §2 non-goals, §5 decisions (with dates), §6 verified facts
- [docs/items.md](docs/items.md) — the ledger (`### C<n>.` items, `## Plan`)
```

Check the ledger from the project's root with `npm --prefix <agent-hub> run docs:check -- docs/items.md` (a relative path is read from the folder you are in, as `docs:index` reads `--file`).

A project whose ledger has its own format (states in headings, no done-when lists) is read as all "decided". There are two ways to deal with it, and the index needs the first:

- **Convert it** to the format of section 3. The walk-through on ad_masker (2026-11-03) needed these changes, and `docs:check` reports each one as an error: a `## 予定` (or `## Plan`) heading listing the decided items; a status line only in the allowed words (`状態: 提案 | 保留(再開の条件) | ブロック(C<n> の後)`, or the English `Status:` form). `進行中` (in progress) is not one of them: progress is the checked boxes in the done-when list. Each closed line `- [x] C<n> … (YYYY-MM-DD, …)` needs its date, so undated history was moved to a separate file that is not the ledger. Name the ledger in `.agent-hub.json`.
- **Keep it** and do not index it; send plain requests with the item number in the body (roadmap C27).

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
2. Start a team in the project: `hub-team --roles leader,deployer`. Two roles are enough for the first item; add `reviewer` (`--roles leader,deployer,reviewer`) when you want a review. The reviewer reads only the documents (the map, the decisions, the facts, the item), so it is worth adding once those exist.
3. In the UI: Items → the card → **Draft request** → Send.
4. The leader sends the work to the deployer, checks the diff and the tests, and asks for a review if a reviewer is connected. Without a reviewer it reports first and sends the closing request when you say so (C133).
5. After the review and its fixes, the leader sends a separate closing request (C102), then reports to you.
6. You commit (and push) when you say so.

The Mailboxes are named `<folder name>.<role>` (a project in `~/work/ad_masker` gets `ad_masker.leader`). Where no terminal can open tabs, `hub-team --tabs print` prints each role's command so you can run it yourself, in order. Follow from a terminal with `npm run team -- status --project <dir>` (the Mailboxes and the latest report).

## 6. Where things go

| What | Where |
|---|---|
| A fact checked on a real machine or in official docs | The project's facts section |
| Something decided | The decisions section, or the item's body, with the date and the reason |
| Later work | A new `### C<n>.` (planning session only) |
| A rejected idea | `[-] C<n>` with a one-line reason |
| Knowledge across projects | engram / memory, not the Hub (the Hub holds only delivery state) |

## 7. Checking whether a project is ready (read-only)

When the human asks in chat whether a project is ready for the Hub, agent-hub's own session checks it in this order and changes nothing. Run the commands from the agent-hub folder.

1. `npm run docs:check -- <the ledger's absolute path>`, **without `--index`**. Note the exit code and the error count. With `--index` it prints only the JSON, no errors, and exits 0, so it cannot show that the ledger is broken.
2. `npm run team -- hooks --project <dir>`: lists the Hub hooks the project lacks (writes nothing without `--write`).
3. `npm run team -- git-hook --project <dir>`: says whether the post-commit hook is there (writes nothing without `--write`).
4. What no command checks, by reading:
   - The document map in `CLAUDE.md` names where the decisions and the verified facts are.
   - The working rules in `CLAUDE.md` give the test command, "do not commit/push until told", and what not to touch.
   - `.agent-hub.json` names the ledger when it is not `docs/roadmap.md`.
   - Closed lines have the form `- [x] C<n> … (YYYY-MM-DD, …)` (rejected: `- [-] C<n> … (rejected YYYY-MM-DD, …)`).

Answer with one table:

| What | Result | Evidence |
|---|---|---|
| Ledger (`docs:check`) | OK / NG / missing | exit code, error count, one line per kind of error |
| … | | |

- The check covers the delivery layer only: whether the Hub can read the ledger, start the team and see the hooks. The result names what fails; fixing the project's ledger content (statuses, done-when lines, closed lines) is requested of that project's leader, not done or judged here (agent-hub's `CLAUDE.md`, "When running another project's team").
- On Windows, paths are case-insensitive: with no `.agent-hub.json`, the default `docs/roadmap.md` opens a `docs/ROADMAP.md` if there is one. The summary then says `docs/roadmap.md has no ### C<n>. items` although another file was read (seen in vcp, 2026-11-05). If the project's ledger is a different file, it needs `.agent-hub.json` either way.
