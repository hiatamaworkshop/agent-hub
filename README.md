# agent-hub

A messaging layer that connects several AI agent sessions (Claude Code and others) and a human through a local **Hub**.
The aim is to keep the human in the loop and remove only the "copy-and-paste hauling".

```
[Browser UI] ⇄ SSE ⇄ [Hub (resident daemon)] ⇄ [shim = MCP server × sessions] ─ push over the channel → [Claude Code]
                           ▲                                                    └ fetched with the inbox tool ← [other agents]
         POST from hooks (Stop / StopFailure / Notification / PreToolUse / PostToolUse / PostToolUseFailure / SessionStart / PostModelSwitch)
```

## What it does (goals)

1. Detects an agent's **session breaks and waits on questions** with hooks and gathers them on the Hub.
2. The user sees them in the **browser**, and can write a message (or forward one unedited) and push it to the Hub.
3. Agents **declare their subscriptions explicitly** and get notified when something is pushed to a topic they subscribed to.
4. Message passing between agents uses the same path.
5. Addresses are logical names, **Mailboxes**; a session only attaches temporarily. When an agent is replaced, its subscriptions and unread messages carry over.
6. Agents have a **role** (`reviewer`, `deployer` and so on), and the role decides which messages they should read.
7. Messages carry a machine-readable kind, **`kind`** (`request` / `reply` / `notice`), so the receiver and the UI can decide how to handle them.
8. Agents other than Claude Code fetch unread messages with the same shim's **`inbox`** tool. The sender's attributes are kept apart from the body, as attributes of `<hub-message>`.

## Status

- P0 (one round trip), P1 (detecting waits and turn ends) and P2 (several sessions, replacement, message passing, resident in Docker) are done and were checked in real sessions. Real teams (vcp, cite-bridge) have been run since.
- Open items are the `C<n>` sections under "Items" in [docs/roadmap.md](docs/roadmap.md).
- The `inbox` path has only been checked with the test MCP client, not with a real client other than Claude Code (C3).
- **Platforms**: developed and checked on Windows 11. `npm run team` is covered by unit tests on every OS, but it has not been run on a real Mac, and a real `claude` session has not been started by it on Linux (C62, design.md §6.2). Reports from those platforms are welcome.

Start reading the design at [docs/design.md](docs/design.md). The Channels and hook specifications were checked against the official docs and on a real machine (design.md §6.1-6.1q). The relation to MCP Events (SEP-3415, Draft) is in design.md §7.

## Usage

Prerequisites: Node.js 24 or later, and the `claude` CLI working in a terminal (Channels work only in an interactive CLI session).

### 1. Setup

```sh
npm install
cp .env.example .env          # PowerShell: Copy-Item .env.example .env. Set HUB_TOKEN to a random value of 16+ characters (.env.example shows how to generate one)
npm run build                 # build the shim into dist/
```

### 2. Start the Hub (terminal A)

```powershell
npm run hub
```

It prints `[hub] UI: http://127.0.0.1:7777/?token=…`; open that URL in the browser.
The token is moved into a cookie and removed from the URL. Data is appended to `data/hub.jsonl` (messages that have been handed over are deleted after 24 hours; see "Message retention and deletion" in the [usage guide](docs/usage.md#message-retention-and-deletion)).

#### Run it resident in Docker (instead of starting it directly)

```powershell
docker compose up -d --build
docker compose logs hub      # prints the UI URL (with the token)
```

- Only the Hub runs in the container. The shim and hooks run on the host and use the same `HUB_TOKEN` and `HUB_PORT` from `.env`.
- It is published only on `127.0.0.1:<HUB_PORT>` (unreachable from anywhere but the host). With `restart: unless-stopped` it comes up together with Docker.
- Data lives in the volume `hub-data`, separate from the repository's `data/`. `docker compose down -v` erases it.
- It reads `roles.json` from the repository root (read-only). After changing it, `docker compose restart`.
- It cannot run at the same time as a directly started Hub on the same port. Use one or the other.
- The compose Hub runs from the built image. After changing the Hub's code, `docker compose up -d --build` is needed (`restart` alone keeps the old image).

### 3. Start Claude Code with the channel enabled (terminal B, repository root)

```powershell
claude --mcp-config tools/dev/mcp.json --dangerously-load-development-channels server:agent-hub
```

- In the warning dialog, choose **I am using this for local development**.
- Notifications arrive even if you see the warning `server:agent-hub · no MCP server configured with that name` (design.md §6.1c).
- The Mailbox name is decided in this order: `HUB_MAILBOX` → `<folder name>.<role>` if `HUB_ROLE` is set → the folder name (here `agent-hub`).
- The shim reads the token from agent-hub's `.env`, so the MCP configuration does not need it.

### 4. Check a round trip

1. Ask Claude to "subscribe to agent-hub's `user.message`" (`subscribe` is called).
2. In the browser's form, choose `request` and the address `topic:user.message`, write a body and press Send. It arrives in Claude's conversation as `<channel source="agent-hub" …>`.
3. Have Claude reply (`post_message`, `kind: reply`). It appears in the browser's list as a `reply`.
4. On the left of the browser, the Mailbox `agent-hub` shows as connected (`Connected`).

### 5. Hooks (so the cards can show waits)

Copy the `hooks` of [tools/hooks/settings.json](tools/hooks/settings.json) into this repository's `.claude/settings.local.json` (or `~/.claude/settings.json` to use them in every repository). Without them the Hub still delivers messages, but the cards cannot show question waits, permission waits and turn ends. Details and gotchas are in the [usage guide](docs/usage.md#show-question-waits-permission-waits-and-turn-ends-in-the-browser-hooks).

### 6. Start a team (leader / deployer)

`npm run team` starts the Hub if it is stopped, then one `claude` per role, each in a tab of its own (the same on Windows, macOS and Linux). Roles come from `roles.json` (copy `roles.example.json`).

```sh
npm run team                                      # choose roles from roles.json by number (e.g. 1,2; all for every role)
npm run team -- --roles leader,deployer           # name them instead of choosing
npm run team -- agent --role deployer             # one role in this terminal (Mailbox = agent-hub.deployer)
```

Send a `request` to `role:leader` from the browser; it goes user → leader → deployer → leader → user. Tab handling per OS, the checks it makes before starting, `--force`, `--permission-mode` and the reply format are in the [usage guide](docs/usage.md#try-a-round-trip-between-roles-with-two-agents-leader--deployer).

## Using it in other repositories

Start agents **at that project's root**. The `CLAUDE.md` they read, the hooks, the scope of permissions and `git diff` are all decided by the folder they start in (design.md §3.3).

```sh
npm run team -- agent --role deployer --project ~/work/cairn          # Mailbox = cairn.deployer
npm run team -- --roles leader,deployer --project ~/work/cairn       # cairn.leader and cairn.deployer
./tools/dev/start-team.ps1 -Roles leader,deployer -Project C:\work\cairn   # the same on Windows PowerShell
```

- `claude` is started in the `--project` folder. The shim points at agent-hub's `dist/` by absolute path (the MCP configuration is written to `agent-hub-mcp.json` under the OS's temporary folder).
- The default Mailbox name is `<folder name>.<role>`. A Mailbox name is unique across the Hub, so the same role in different projects gives different Mailboxes. Change it with `--mailbox` (only for one role started with `agent`).
- A `role:deployer` message sent by an agent reaches only the deployer of the sender's own project. To reach another project, address `mailbox:cairn.deployer`. From the browser, it reaches every project if the project selector says `All projects`, or only the selected project if one is selected (design.md §9-7).
- The target repository's `.claude/settings.local.json` has no hooks, so copy the `hooks` of `tools/hooks/settings.json` into `~/.claude/settings.json`. If they are nowhere, the script warns (it does not stop the start).
- The browser's card shows `Project: <folder name>` (the full path appears on hover). Attaching to the same Mailbox from a different folder than last time shows the warning `Attached from a different folder (was …)` (it is not refused).

Without the scripts, register the shim in the user scope with an absolute path and start at the project's root with the same flag.

```powershell
claude mcp add --scope user agent-hub -- node <agent-hub>/dist/shim/main.js
claude --dangerously-load-development-channels server:agent-hub
```

## More: the usage guide

[docs/usage.md](docs/usage.md) has the reference for everyday use:

- Browser: [reading the cards](docs/usage.md#reading-the-cards-in-the-browser-state-and-backlog), [custom commands](docs/usage.md#custom-commands), [pasting images](docs/usage.md#pasting-images), [Forward](docs/usage.md#carry-an-agents-output-to-another-agent-forward)
- Mailboxes: [subscriptions](docs/usage.md#subscribing-once-per-mailbox-is-enough), [takeover](docs/usage.md#replacing-an-agent-takeover), [deleting](docs/usage.md#deleting-mailboxes-you-no-longer-use), [retention](docs/usage.md#message-retention-and-deletion)
- Teams and work: [teams in detail](docs/usage.md#try-a-round-trip-between-roles-with-two-agents-leader--deployer), [requesting work from roadmap items](docs/usage.md#request-work-from-roadmap-items-items), [roles.json](docs/usage.md#role-definitions-rolesjson), [`HUB_LANGUAGE`](docs/usage.md#the-language-agents-write-to-the-human-in-hub_language)
- Other: [agents other than Claude Code (`inbox`)](docs/usage.md#using-it-with-agents-other-than-claude-code-inbox), [curl on Windows](docs/usage.md#using-curl-notes-for-windows), [development](docs/usage.md#development) (`npm test`, `npm run typecheck`, `npm run docs:check`, `npm run ui:check`)

## Documents

| File | Content |
|---|---|
| [docs/usage.md](docs/usage.md) | Reference for everyday use (the sections above) |
| [docs/design.md](docs/design.md) | Background, requirements, architecture, design decisions, unverified items |
| [docs/protocol.md](docs/protocol.md) | HTTP API, message schema, MCP tools, delivery guarantees |
| [docs/roadmap.md](docs/roadmap.md) | Phases and acceptance criteria (P0 → P2), open items (`C<n>`; the rules for writing them are at the top) |
| [docs/plan-p0.md](docs/plan-p0.md) | P0's technology choices, layout and commit-sized steps |
| [tools/probe/README.md](tools/probe/README.md) | Steps for checking unverified items (design.md §6.2) on a real machine |
| [tools/dev/roles/](tools/dev/roles/) | Operating instructions for leader / deployer / reviewer (message formats). `npm run team` adds them to the system prompt |
| [CLAUDE.md](CLAUDE.md) | Working rules for implementing agents |
| [LICENSE](LICENSE) | MIT |
