# P0 implementation plan

The P0 phase of [roadmap.md](roadmap.md) (one round trip in one session), split into commit-sized steps.
Each step ends in a state where "the tests pass / it can be checked by hand".

## Technology choices

| Item | Choice | Reason |
|---|---|---|
| Runtime | Node.js 24 or later (the dev machine has v26) | The default in CLAUDE.md |
| Language and execution | TypeScript 5.9 + tsx (development) / tsc (building the shim) | Same as cairn |
| HTTP | Hono + `@hono/node-server` | design.md §5 |
| MCP | `@modelcontextprotocol/sdk` **~1.32.1 (pinned to 1.x)** | With 2.x the channel is not registered (design.md §6.1b) |
| IDs | `ulid` | Sortable by time (protocol.md §1) |
| Validation | `zod` (the same line as SDK 1.x's dependency) | Validating request bodies and `kind` |
| Tests | `node --test` + tsx | Same as cairn. The Hub is tested without the network through `app.request()` |

## Directory layout

```
src/
  shared/      types (Message, Mailbox, Event), the kind enumeration, name validation, building the channel meta and escaping the body
  hub/         main.ts (startup), app.ts (Hono routes), store.ts (JSONL append and restore), sse.ts, auth.ts
  shim/        main.ts (channel MCP server)
public/        index.html (the UI, served by the Hub)
tools/probe/   probes for the live verification in §6.2 (not the implementation)
```

The Hub and the shim live in one package. They will be split once there is a reason to (shipping them separately, conflicting dependencies).

## How the shim is started

Agents run in repositories other than agent-hub, so the shim is registered in the **user scope** (`~/.claude.json`) with an absolute path.
To start quickly and avoid depending on tsx, the shim is built into `dist/` with `npm run build` and run with `node`.

```jsonc
// mcpServers in ~/.claude.json (P0 is checked inside agent-hub itself, so the project's .mcp.json is fine at first)
"agent-hub": {
  "command": "node",
  "args": ["<absolute path of agent-hub>/dist/shim/main.js"]
}
```

## Steps

| # | Content | Done when |
|---|---|---|
| 0 | **Live verification** (done): checked how Channels and hooks behave with probes and recorded it in design.md §6.1c. Folded in the single meta and the session_id mapping | Done |
| 1 | Skeleton: package.json, tsconfig, dependencies (done) | `npm install` passes and tsx runs (there is no src yet, so typecheck starts at step 2) |
| 2 | `shared/`: types, `kind` validation, the name regex, building the channel `meta` and escaping `</channel>` (done) | Unit tests |
| 3 | `hub/store.ts`: JSONL append, restore at startup, numbering `seq` (done) | Unit tests (Mailboxes and cursors come back after a restart) |
| 4 | `hub/auth.ts` + `app.ts`: Bearer / cookie (`?token=` → Set-Cookie → redirect) / `Origin` check. `POST /messages`, `GET /messages`, `GET /stream` (SSE for the UI) (done) | Tests with `app.request()` (401, 403, issuing the cookie, receiving SSE) |
| 5 | Mailbox: attach (creation and idempotency), PUT/DELETE of subscriptions, `/attachments/:id/stream` (resending unread + new arrivals), advancing the cursor with ack. Leases and takeover are P2 (done; takeover only minimally) | Tests (attaching again before ack resends) |
| 6 | `shim/main.ts`: attach as `HUB_MAILBOX` → folder name (declaring `CLAUDE_CODE_SESSION_ID` as sessionId), receive SSE and push with `notifications/claude/channel`, ack. Tools `subscribe` / `post_message` / `whoami` (`_meta["anthropic/alwaysLoad"]: true`, design.md §6.1c) (implemented, with integration tests through an MCP Client; not yet checked on Claude Code) | By hand (acceptance criteria 2-5 on Claude Code) |
| 7 | `public/index.html`: message list (live, showing `kind`), send form (choosing `kind`, default `request`) (done) | By hand (a round trip in the browser) |
| 8 | Startup steps in the README (done). Check acceptance criteria 1-7 end to end (done; results in roadmap.md) | Mark P0 done in the roadmap |

## Testing approach

- **Automated**: shared, store and the Hub's HTTP are covered with `node --test`. The Hub uses Hono's `app.request()` and is verified without opening a port.
- **By hand**: Channels only work in an interactive session with the development flag, so the integration of the shim with Claude Code (acceptance criteria 1, 4, 5) is checked by hand.
  The steps are written in the README so they can be reproduced.

## Risks

- Channels are a research preview; the flags and the contract may change. The shim's dependence on Channels is kept to one file.
- The pin to SDK 1.x will have to go eventually. Revisit it when Claude Code supports channels on `2026-07-28` (expected around the same time as the move to MCP Events in design.md §7).
