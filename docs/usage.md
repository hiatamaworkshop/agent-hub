# Usage guide

Reference for running agent-hub day to day. The first start (setup, Hub, one session, a round trip) is in the [README](../README.md).

Sections: [Reading the cards](#reading-the-cards-in-the-browser-state-and-backlog) · [Custom commands](#custom-commands) · [Pasting images](#pasting-images) · [Hooks](#show-question-waits-permission-waits-and-turn-ends-in-the-browser-hooks) · [Forward](#carry-an-agents-output-to-another-agent-forward) · [Subscriptions](#subscribing-once-per-mailbox-is-enough) · [Takeover](#replacing-an-agent-takeover) · [Deleting Mailboxes](#deleting-mailboxes-you-no-longer-use) · [Retention](#message-retention-and-deletion) · [Teams](#try-a-round-trip-between-roles-with-two-agents-leader--deployer) · [Items](#request-work-from-roadmap-items-items) · [roles.json](#role-definitions-rolesjson) · [hub.config.json](#hub-settings-hubconfigjson) · [HUB_LANGUAGE](#the-language-agents-write-to-the-human-in-hub_language) · [inbox](#using-it-with-agents-other-than-claude-code-inbox) · [curl](#using-curl-notes-for-windows) · [Start warnings](#start-warnings-logsstart-warningsjsonl) · [Development](#development)

## Reading the cards in the browser (state and backlog)

Each Mailbox card on the left shows, as one state and by the color of its frame, whose move it is in that session now. The Hub holds no state; the UI derives it from the delivery material (`backlog` of `GET /mailboxes`) and the hook Events (design.md §3.15).

| State | Meaning |
|---|---|
| `Needs you` (amber, steady frame) | The human's move. A question or permission wait in the terminal, or a request the agent sent to the human on the Hub that has no reply. Also when automatic resume after a usage limit is not continuing or is off. Also when every party it is waiting for is unconnected, with `(<Mailbox> not connected)` added (start that party's session) |
| `Paused` (⏸, no frame, muted) | Stopped by a usage limit (`error: rate_limit` of `StopFailure`). If automatic resume works, it continues by itself. Checked before `Working` |
| `Working` (blue, pulsing frame) | A Message handed over is newer than the last turn end. `Working?` (a guess) for sessions without hook Events. Also, for up to 60 minutes, when a turn ended with a request still unanswered while a background task such as tests is running; `background: <task>` is added (when the task ends, the next turn starts) |
| `Waiting on others` (blue, pulsing frame) | The turn ended and it is waiting for replies to requests it sent. The addressee is added |
| `Stopped, no reply` (amber, steady frame) | The turn ended without replying to a request it was handed. Look at the terminal or nudge it |
| `Idle` / `Offline` | Nothing left / the session is not connected (no frame, no emphasis) |

- Two signals (roadmap C71). The frame and the state line of a card use only two colors: the human's move (`Needs you`, `Stopped, no reply`) is amber and does not pulse; someone's move (`Working`, `Waiting on others`) is blue and its frame pulses slowly, about every 2 seconds, so several working cards are not loud. With reduced motion (the OS or browser setting `prefers-reduced-motion`) the pulse stops and a steady blue ring remains. `Idle`, `Paused` and `Offline` have no frame.
- An agent's unread messages are not a signal (the human's move is the only amber). A connected card with only unread messages, not yet handed over, says `Working` in plain text with no frame, pulse or flash, and the sidebar's `Working` count leaves it out. Once the message is handed over, the card becomes a signal `Working`.
- A card flashes for about 1.5 seconds when its signal changes: amber when it goes to the human's move, blue when it starts working, and a brief green when it goes to `Idle` (finished; no frame stays). The first render after loading the page and renders with no change do not flash. The previous signal is kept per Mailbox name in the page, so a re-render does not repeat the flash. With reduced motion there is no flash.
- Where to recolor: the block of CSS variables at the top of `public/index.html` (`--st-you` for the human's move, `--st-working` for working, and `--st-ring` for the frame width). Dark mode redefines the two colors in its own block. Frames and state lines read only these three, so the block is the whole recoloring surface; the flash's green uses the existing `--reply`.
- Health check (roadmap C76): the button at the top right of the page header shows `Health check (N)`, N = Mailboxes in `Stopped, no reply` across all projects (disabled at 0). Pressing it sends one `notice` from `user:browser` to each of them, and to no Mailbox in another state (`Working`, `Waiting on others`, `Idle` and so on). The text is fixed: `Health check: #<seq> has no reply in the Hub. If you have its result, send it now with post_message (kind=reply, reply_to=<id>). If you cannot finish it, reply with one line saying why. Do not re-check or re-run anything for this.`, naming that Mailbox's oldest request with no reply. It is sent only when a human presses it (no timer), adds no open request, and the agent's reply to the original request closes the card as usual. The template is `HEALTH_CHECK_TEMPLATE` at the top of the script in `public/index.html`.
- The browser tab shows the same two signals (roadmap C70). Its icon is an amber count badge with a white outline while the human is awaited (`Needs you`, `Stopped`, and new messages that arrived while the tab was hidden, summed), a hub icon in the working color while someone is working and nobody waits on the human, and a plain hub otherwise. It does not blink. The colors are read from `--st-you` and `--st-working`; the plain hub is `TAB_ICON_IDLE` at the top of the script in `public/index.html`, which holds SVG text (empty gives the browser default). The page's CSP only allows `blob:` images, so the icons are built as Blob URLs, not `data:` URIs. The title counts `Needs you` (`N waiting`).

- Awaiting reply is closed by a reply with `reply_to`, and also by a later request or reply from the other side (for example when the human answers a question with a new request; protocol.md §2).
- The badges on cards and in the sidebar split counts into `You` (the human's move) / `Agent` (the agent's move) / `Stuck?` (delivery may be stuck), and change color by the age of the oldest. `N waiting` in the tab title and the favicon count `Needs you` across all projects (the human's move; a card waiting on an unconnected party counts as one). The `You` badge does not count cards waiting on an unconnected party (their unread shows as `Stuck?` on the other party's card).
- The state is built from hook Events, so it is coarser for sessions without hooks (see "Show question waits, permission waits and turn ends in the browser" below). While stopped by a usage limit it shows `Paused` (needs the `StopFailure` hook). When automatic resume is not continuing or is off, `Needs you` shows `usage limit, press Enter` / `usage limit, auto-resume off` (roadmap C38).
- A permission wait (`Needs you (permission)`) clears when you allow it and the tool runs (`Last event: approved`). When you deny it in the terminal nothing arrives, so it stays `Needs you` (after a denial Claude Code waits for the human's input; roadmap C30).

## Seeing where requests wait (the map)

- **Map** at the top right of the header switches the thread for a map of the same sessions (roadmap C78). The composer and the sidebar stay as they are, and the map follows the project filter at the top of the sidebar. No second connection is opened.
- Columns are fixed by role: `You`, then `leader`, then the other roles, then Mailboxes without a role. Each node shows its card state in the cards' colors.
- Each open request is one chip at the Mailbox that has to answer it (requests that are still waiting for a reply, the same ones that count as Waiting on others). Several to one Mailbox stack. A chip with an item shows the item (`C78 #374`). A request that goes against the column order (a deployer asking the leader) is drawn with a dashed back arrow.
- Questions and permission waits show as chips at `You`, dashed. They cannot be dragged or forwarded; answer them in the terminal.
- Click a chip to open its Message in place, with the same Reply, Forward and Delete as in the thread.
- To forward a request to another Mailbox, drag its chip onto that node, or choose the Mailbox in the chip's **Forward to…** menu. This only fills the Forward draft (the composer shows the address and `Forwarding #…`); nothing is sent until you press Send. Only Mailboxes are offered. A choice replaces the current forward selection.
- While a **Forward to…** menu is open or a chip is being dragged, the map does not redraw for new data (the menu stays open and the drag is not interrupted). The map redraws once when the menu closes or the drag ends, with the latest data.
- A chip whose Message is not in the page is loaded by itself when the map opens. If the Hub no longer has it, the chip says so.

## Custom commands

Under **Commands** in the browser you can name strings you use often. Example: name `cp`, text `commit and push`.

- Write `/cp` in the body and press Send, and it is sent as `commit and push`. If you write `/cp today's work`, the argument goes where `$ARGS` is in the text, or at the end if there is no `$ARGS`.
- `//cp` sends `/cp` without replacing it (escape). An undefined `/xyz` is sent as is.
- The settings are saved in `settings.json` under `HUB_DATA_DIR` (default `data/`). You may edit it by hand; it takes effect from the next read. A hand-edited `defaultTo` (e.g. `"mailbox:leader"`) becomes the UI's initial address while that Mailbox is attached (the address you last sent to takes precedence; if neither is attached, no address is selected).

```json
{ "version": 1, "commands": [ { "name": "cp", "text": "commit and push" } ] }
```

This feature uses the Hub's API, so **a Hub that is already running keeps Commands disabled until it is restarted** (on an old Hub, Commands is grayed out).

## Pasting images

Paste an image into the body (Ctrl+V), drag one onto the composer, or choose one with **Attach**. PNG, JPEG, GIF and WebP, up to 4 per message and 20MB each.

- On sending, the Hub shrinks it to a long edge of 1568px, saves it in `HUB_DATA_DIR/files/` and shows it in the thread. Agents get the same image, with metadata such as location dropped. For GIF / WebP only the first frame is kept. If the body is empty, `[image]` is sent.
- Non-persistent images are deleted after `HUB_FILE_TTL_DAYS` (default 1 day). A deleted image shows as "Image expired or unavailable".
- The environment variables are `HUB_FILE_MAX_EDGE` (default 1568) and `HUB_FILE_TTL_DAYS` (default 1; 0 means never clean up). See `.env.example`.
- This feature also uses the Hub's API, so **a Hub that is already running must be restarted** (on an old Hub, Attach does not send and asks you to restart).

### Agents seeing images

The shim saves arriving images in `agent-hub/<Mailbox name>/` under the OS's temporary folder and puts the path in `files[].path` of the notification's `meta` attribute. The agent opens that path with `Read` to see the image. Images that could not be saved carry `error` (`expired` for expired, `fetch_failed` for a failed fetch).

- The location can be changed with `HUB_FILES_DIR` (a folder per Mailbox name is made under it).
- At startup, images older than 24 hours are deleted.
- The location is outside the working folder, so `Read` may ask for permission. `npm run team` (and `npm run team -- agent`) allows it at startup with `--add-dir` (the `HUB_FILES_DIR` folder if set). If you start `claude` by hand, add `claude --add-dir "<location>"`.

## Show question waits, permission waits and turn ends in the browser (hooks)

Claude Code's HTTP hooks send `AskUserQuestion`, permission waits and turn ends to the Hub. They appear in the browser's thread in a dashed frame, and the latest one shows on the Mailbox card on the left. They are also the material for the card's state ("Reading the cards in the browser" above).

1. Run `npm run team -- hooks --project <folder> --write` (`--project` omitted: this repository). It adds the missing events from [tools/hooks/settings.json](../tools/hooks/settings.json) to `<folder>/.claude/settings.local.json` (not committed), with this repository's script by absolute path and the port from `HUB_PORT`. Events already set in that file, the project's `settings.json` or `~/.claude/settings.json` are left alone, and the previous file is kept as `settings.local.json.bak`. Without `--write` it lists what is missing and prints the hooks it would add, for copying by hand (for example into `~/.claude/settings.json`).
   After the hooks change (a new event in `tools/hooks/settings.json`), run it again: starting a team warns about each missing event.
   Passing them with `--settings` misbehaved in 2.1.301 (design.md §6.1f), so do not.
2. The hook's `Authorization` is built from the environment variable `HUB_TOKEN`. `npm run team` passes the value from `.env`, so nothing is needed. If you start `claude` by hand, set `HUB_TOKEN` in its environment first (PowerShell: `$env:HUB_TOKEN = …`; sh: `export HUB_TOKEN=…`).
   In that case the token is visible from the session's Bash and so on too. Treat it like `.env`.
   `PostToolUse` / `PostToolUseFailure` are sent for every tool, to learn that a permission wait was cleared (the Hub records only the one right after a permission wait and discards the rest; a few ms each; design.md §6.1s). If you copied the older settings (`matcher: AskUserQuestion`), remove the `matcher` and add `PostToolUseFailure`. Also add `PostModelSwitch` (to show the last model and effort seen on the card; C61).
   `SessionStart` works **only as a command hook** (per the official hooks docs; with an HTTP hook no Event arrived; design.md §6.1v). `hooks --write` writes it as `"command": "node", "args": ["<agent-hub>/tools/hooks/post-event.mjs", "--no-git"]`. Keep `--no-git` (a fast path that does not call git and sends the input as is; C61). The template itself says `${CLAUDE_PROJECT_DIR}/tools/hooks/post-event.mjs`, which is right only inside this repository; a copy in another project points at a script that is not there, and starting a team warns about it (the same constraint as Stop in `settings.command.json`; design.md §3.11).
3. If the Hub is stopped, the hook only shows an error and work does not stop (timeout 5 seconds). Input over 1 MB (the result of `Read` on a large file and the like) also just becomes a hook error, with the Hub returning 413.
   Hooks in settings files are re-read by running sessions too and take effect (no restart needed; design.md §6.1q).
4. (Optional) To send the facts of a change (HEAD, changed files, untracked files) to the Hub on `Stop`, use the `Stop` of [tools/hooks/settings.command.json](../tools/hooks/settings.command.json). **Having it together with the HTTP `Stop` hook (the `Stop` in step 1) makes two `turn.end`s**, so remove the HTTP `Stop` and replace it.
   The script is `tools/hooks/post-event.mjs`. git runs in the working folder; the Hub does not run git. The Hub's port is `HUB_PORT` (default 7777). On failure work does not stop, and whatever could be collected is sent. In the browser, `turn.end` shows the number of changed files.

- Which Mailbox an occurrence belongs to is decided in this order: the session declared by the shim → `X-Hub-Mailbox` (`HUB_MAILBOX`) → the folder name.
- **Questions cannot be answered from the browser.** Answer in the terminal. Messages sent from the browser reach the session after the answer.
- An Event's **Reply** starts writing a `request` to that Mailbox.
- This feature also uses the Hub's API, so **a Hub that is already running must be restarted** (an old Hub just shows no Events).

## Carry an agent's output to another agent (Forward)

- Choose messages with **Forward** (several allowed), choose an address and press **Forward N**. The body, kind and attached images are carried **as they are**. The receiver gets the person who forwarded (`from`) and the author of the body (`forwarded_sender`) separately.
- What you write in the body is sent as a **covering note**, as a separate message before the forward (e.g. "review these two"). If it is empty, only the forward is sent. It is not mixed into the forwarded body.
- Once you have forwarded A's output to B, **Relay** above the thread shows `A → B · N new` (how many of A's outputs have not been sent to B yet). Pressing it selects those N and sets the address to B. Nothing is sent until you press Forward.
- Forwarding also uses the Hub's API, so **a Hub that is already running must be restarted** (an old Hub stops before sending and does not send the covering note either).

## Subscribing once per Mailbox is enough

- Subscriptions are **stored on the Mailbox**, not the session (`data/hub.jsonl`). They survive Hub restarts and new sessions attaching to the same Mailbox, so you do not have to ask again at every start.
  Starting in the same folder gives the same Mailbox (see how Mailbox names are decided in the [README](../README.md#3-start-claude-code-with-the-channel-enabled-terminal-b-repository-root)).
- **Messages to `mailbox:<name>` need no subscription.** A subscription is needed only to send to all subscribers, like `topic:<name>`.
- Subscriptions disappear when you delete the Mailbox in the browser and when you erase `data/` (in Docker, when you recreate the volume). The way to declare them as configuration is a role's default subscriptions (`roles.json` + `HUB_ROLE`; "Role definitions (roles.json)" below).
- The address dropdown shows only subscribed topics. A topic without subscribers can be sent to with "type a topic…", but if it reaches nobody a warning appears next to Send.
- Attaching to a Mailbox after a long time away does not flow in every unread message. Those older than 7 days and those before the newest 50 are omitted, and the number omitted is reported in one notice (on the `inbox` path, at the head of the next `inbox` result; the records remain and can be seen in the browser's history). The limits are `HUB_UNREAD_MAX_AGE_DAYS` / `HUB_UNREAD_MAX` (0 means no limit).

## Replacing an agent (takeover)

Starting a new session with the same Mailbox name makes the new one take over (after `/clear`, or when restarting with a different model, and so on). Subscriptions and unread messages stay on the Mailbox, so they reach the new session as they are.

- If the old session is still running it is cut off, and `post_message` / `subscribe` / `unsubscribe` return errors (`whoami` still answers). A cut-off shim does not attach again (closing the new one does not bring it back; the error text says so too). To continue in the old one, restart that session.
- The Mailbox card in the browser shows `took over <time>`. Hook Events from the cut-off session carry `superseded session` and are not used as the card's last Event.
- The card of an unconnected Mailbox shows when and why it was cut (`session ended` / `disconnected` / `lease expired`).

## Deleting Mailboxes you no longer use

On the left of the browser, press **Delete** on the card of an unconnected Mailbox (it asks for confirmation). Its subscriptions, cursor and unread messages are erased; the message records remain.

- A connected Mailbox cannot be deleted (no Delete appears). End that session first.
- Attaching again with the same name makes a new Mailbox, and what had arrived before the deletion does not arrive.
- This feature also uses the Hub's API, so **a Hub that is already running must be restarted** (an old Hub shows an error and the card remains).

## Message retention and deletion

The Hub is infrastructure for connecting, and does not keep messages for long. Write knowledge you want to keep in the repository's documents or in engram (design.md §3.14).

- Messages handed to every receiver are deleted after 24 hours (`HUB_READ_RETENTION_HOURS`; 0 means never delete automatically). Detection events are deleted after the same period. Cleanup runs at startup and every hour.
- Not deleted: unread messages and `request`s with no reply yet. Awaiting reply is closed by a reply with `reply_to`, or by a later request / reply from the receiver to the sender (not by notices or forwards; protocol.md §2). Whatever does not close stays until deleted by hand.
- Deleting by hand: **Delete** on a message (one; deletes it even if unread or awaiting a reply). **Purge read** above the thread deletes now, without waiting for the retention period, the messages that have been handed over and all events.
- Replying with `reply_to` to a deleted message is 400. Send it with `to`.
- `data/hub.jsonl` is compacted to the current state when something is deleted.
- This feature also uses the Hub's API, so **a Hub that is already running must be restarted** (on an old Hub, Delete and Purge read ask you to restart).

## Try a round trip between roles with two agents (leader / deployer)

A test that passes a request and report around by role address in the order user → leader → deployer → leader → user.
For the role's description, the `description` in `roles.json` goes into the shim's instructions ("Role definitions (roles.json)" below). For leader / deployer / reviewer, detailed operating instructions (message headings and so on) live in [tools/dev/roles/](../tools/dev/roles/), and `npm run team` adds them to the system prompt too. A role that is in `roles.json` but not in roles/ works from its description alone.

Start a team with `npm run team` (the same on Windows, macOS and Linux). It starts the Hub if it is stopped, then starts the chosen roles one by one, each in a tab of its own.

```sh
npm run team                                      # choose roles from roles.json by number (e.g. 1,2; all for every role)
npm run team -- --roles leader,deployer           # name them instead of choosing
npm run team -- agent --role deployer             # one role in this terminal (Mailbox = agent-hub.deployer, haiku)
```

How tabs are opened depends on the OS (`--tabs` overrides it):

| Where | Tabs open in | Notes |
|---|---|---|
| Inside tmux (any OS) | new windows of the current tmux session (`tmux`) | |
| Windows | Windows Terminal tabs (`wt`); separate console windows if there is no `wt.exe` (`window`) | |
| macOS | Terminal.app windows (`terminal`) | Not yet checked on a real Mac (design.md §6.2) |
| Linux, outside tmux | a detached tmux session `agent-hub` (`tmux`) | Watch it with `tmux attach -t agent-hub` from another terminal |
| None of the above | nothing is opened (`print`) | Each role's command is printed in order; run each in a terminal of your own while the script waits |

On Windows, the PowerShell scripts keep working with the same parameters as before; they are wrappers around `npm run team`:

```powershell
./tools/dev/start-team.ps1 -Roles leader,deployer   # = npm run team -- --roles leader,deployer
./tools/dev/start-agent.ps1 -Role leader            # = npm run team -- agent --role leader
```

- Both take `--project <folder>` (`-Project`) to choose the project to work in (agent-hub if omitted; a relative path is from the folder you typed the command in). See "Using it in other repositories" in the [README](../README.md#using-it-in-other-repositories).
- After starting each one, it waits until that role's Mailbox attaches to the Hub before going on (limit `--attach-timeout`, default 60 seconds). Answer the development channel's warning dialog in each tab as it opens (with a detached tmux session, attach to it first).
- Connected roles are skipped (restarting would cut off the current session by takeover). To restart, use `--force`.
  It remembers the `attachmentId` of the Attachment before starting, and says "attached" only once an Attachment with a different id appears. Even if the previous session's Attachment lingers until its lease expires, that is not read as success. If none appears within the limit, it warns of a failure and finally exits with code 1 (roadmap C33).
- Roles not in `roles.json` are stopped before starting. If `dist/` is older than `src/`, it builds first (skip with `--no-build`).
- Before starting, it checks the following (roadmap C56-C58; the contents are in `src/team/checks.ts`).
  - If `claude --version` does not pass (NVM blocking it with NVM4306, an exe being replaced by a self-update and so on), it prints the head of the output and ends without starting any role (it prefers `claude.exe` to `claude.cmd` on Windows).
  - If `claude --version` is newer than the highest Claude Code version named in the headings of design.md §6.1 (the verified envelope, design.md §1.2), it warns and goes on (C85).
  - It reads the Hub's hooks per event from the project's `.claude/settings.local.json`, `.claude/settings.json` and `~/.claude/settings.json`, and warns about missing events, files that are not JSON, and a `post-event.mjs` path that does not exist. When events are missing it adds the command that fills them in (`npm run team -- hooks --project <folder> --write`; C69).
  - In the `-Project` folder it runs `git fetch` (without prompting for credentials, up to 15 seconds), then warns if the HEAD is detached, behind its upstream, or has no upstream. It does not stop. This keeps the team from running on an old version of a submodule.
- If a tab's `claude` ends before attaching, it fails without waiting for the limit and prints the exit code and the reason (the output of `claude --version`). The role's `agent` writes the ending to `agent-hub-start/<Mailbox>.json` under the OS's temporary folder, and `team` reads it. A tab whose `claude` failed stays open until you press Enter, so the reason can be read.
- At the end, the warnings and failures above are gathered under `--- summary ---` and `UI: http://127.0.0.1:<port>/?token=…#project=<folder>` is printed. The page opens on that project (it wins over the last saved selection and becomes the new one); a `project` that is not in the Hub's project list is ignored, and the page removes it from the address bar after reading it. It is a #fragment because the Hub drops other query parameters when it redirects `?token=`. If the token does not match the Hub, it says so instead of the URL.
- When there were warnings, the same start also appends one line to `logs/start-warnings.jsonl`, so a later breakage can be matched against that start's time and HEAD ("Start warnings" below).
- The attach check uses `HUB_TOKEN` from `.env` (an environment variable wins).

1. Confirm that `agent-hub.leader` and `agent-hub.deployer` show as connected, with their roles, on the left of the browser.
2. From the browser, send a `request` to `role:leader`. The body is a work request (e.g. "create `tmp/hello.txt`").
3. The leader sends implementation instructions to `role:deployer` as a `request`, and the deployer does the work and returns a `reply`.
4. The leader checks the change and sends a `reply` to the request from step 2. The browser lists the four messages in the order `request` → `request` → `reply` → `reply`.

- The message formats are set by the role descriptions. leader → deployer uses fixed English headings (`GOAL` / `SCOPE` / `SPEC` / `DONE WHEN`);
  deployer → leader is in English, with only the list of changed files (`CHANGED`) in DCP form. leader → user uses five English headings, `RESULT` / `VERIFIED` / `NOT VERIFIED` / `NEEDS DECISION` / `NEEDS ACTION`, with the body in the user's language (`HUB_LANGUAGE` below). The browser bolds headings at the start of a line in the body, gives `NEEDS DECISION` a background color, and colors the headings of `NEEDS ACTION` and `NOT VERIFIED` (a section whose content is "none" is not highlighted). Replies with the earlier Japanese headings (`要判断` and so on) are colored the same way (design.md §3.15).
- reviewer → leader is in English: each line under `FINDINGS:` names `checked against:` and `breaks when: <input or state> → <wrong result>` (and `instead:` when there is an alternative). A disagreement without a breaks-when goes under `NOTES:` instead of being dropped. The leader sends only checked `FINDINGS:` to the deployer as fixes; `NOTES:` reach you in the report as `reviewer note:` lines under `NOT VERIFIED` (or `NEEDS DECISION`) (C82, design.md §1.2).
- The instruction to keep the leader's terminal answers short is in the role description too. The output style (`/output-style concise`) is saved in `.claude/settings.local.json` and affects every session in the same folder, so it is not used. Passing it with `--settings` at startup misbehaved in 2.1.301 (design.md §6.1f).
- The two sessions work in the same folder, so the deployer's changes are visible to the leader with `git diff`.
- Approve the deployer's file edits in terminal C.
- The permission mode is passed as `claude --permission-mode <value>` only when you add `--permission-mode <value>` (`-PermissionMode`). If omitted nothing is passed and Claude Code starts with its default. If your account makes auto the default, permission waits hardly appear.
  To try permission waits, add `--permission-mode default` (e.g. `npm run team -- agent --role deployer --permission-mode default`; adding it to a team start passes it to every role). To change it by hand after starting, switch that tab to `manual` with Shift+Tab (the 2.1.306 switcher has no `default`; `manual` corresponds to it; the hook's `permission_mode` says `default`; design.md §6.1o, roadmap C29).

## Request work from roadmap items (Items)

Send the roadmap's `### C<n>. Title` items (how to write them is at the top of [docs/roadmap.md](roadmap.md)) to the Hub and cards line up under **Items** in the sidebar. Pressing a card opens a modal with its content (ID, title, status and reason, the check of each done-when line, the state of the request, the diff of the promise). The modal's **Draft request** turns it into a draft of `GOAL` / `DONE WHEN`, and the request you send carries the item (`meta.item`). **Open in editor** opens that line of the ledger (a `vscode://` link; your editor must support it). The body is not put in the index and is not shown in the modal (design.md §3.15). The sidebar's width can be changed with its handle and is remembered by this Hub's browser.

```powershell
npm run docs:index                                                       # agent-hub's docs/roadmap.md
npm --prefix <agent-hub> run docs:index -- --file docs/TODO.md            # another project, from its root (no --file needed if the ledger is docs/roadmap.md)
```

- A project you sent can be chosen as a project in the UI even before any agent connects, and you can leave a request to `role:deployer @ <project>` (it arrives as unread at the Mailbox that attaches).
- The Hub holds only a copy of the index; the source of truth is the repository's roadmap. Send it again after changing it. Remove it with **Remove** in Items.
- Items shows four tiers: **Plan** (the order under the ledger's `## Plan` / `## 予定`; blocked items show what they wait for), **Awaiting a decision** (proposed), **Parked** (held; collapsed by default), **Recently closed** (the five newest closed lines by date). For a ledger without a plan heading, decided and blocked items go into Plan in number order.
- Cards show requested / reported, and the diff when the wording of the done-when conditions changed after sending.
- For projects whose ledger has its own format, sending it may read every item as "decided". In that case do not index it; send a plain request (roadmap C27).

**Send automatically after a commit that changed it** (optional): you can install a git post-commit hook that sends the index only on commits that changed the ledger (`docs/roadmap.md`). The commit is not stopped if sending fails (if the Hub is stopped, it prints one line of warning and goes on).

1. Copy the hook into the target repository's `.git/hooks/` (agent-hub's `tools/hooks/post-commit-index.sh`).
   ```powershell
   Copy-Item <agent-hub>\tools\hooks\post-commit-index.sh <repository>\.git\hooks\post-commit
   ```
2. Rewrite the `AGENT_HUB_DIR=` line of the copied `post-commit` to agent-hub's folder (`AGENT_HUB_DIR="<agent-hub>"`, with `<agent-hub>` being the absolute path of agent-hub's folder written with `/` separators).
3. To send, the Hub must be running and the token in agent-hub's `.env` must be readable (the same as `npm run docs:index`).
4. To check: change the ledger and commit; it should appear in Items. If it does not, read the one line of warning printed after the commit.

The hook runs `npm --prefix <agent-hub> run docs:index` at the root of the repository you committed in. To remove the hook, delete `.git/hooks/post-commit`.

## Role definitions (roles.json)

Write each role's default subscriptions and description in the Hub's configuration file. The sample is [roles.example.json](../roles.example.json).

```powershell
Copy-Item roles.example.json roles.json   # for your environment; roles.json is not committed
npm run hub                               # read only at startup; restart after changing it
```

- Each role has `description` (a string) and `subscribe` (an array of topic names). Other fields are kept rather than dropped, but are not used today.
- A Mailbox started with `HUB_ROLE=reviewer` receives `reviewer`'s default subscriptions without calling `subscribe`. Messages to `to: role:reviewer` also reach this Mailbox.
- `description` goes into the shim's instructions. The shim attaches before initialize to fetch it (up to 3 seconds; after that it starts without the description).
  That Claude Code behaves as described was checked with three sessions, leader / deployer / reviewer (design.md §6.2-5).
- Attaching with a role that is not defined is 400 `unknown_role`, and no Mailbox is created.
- Without the file, role names are not checked and there are no default subscriptions (as before).
- If the file's shape is wrong, the Hub does not start; it prints the file name and where the problem is and stops (it does not silently fall back to defaults).
- Topics of the default subscriptions cannot be removed with `unsubscribe`. To remove one, delete it from `roles.json` and restart the Hub.
- To use a file elsewhere, set `HUB_ROLES_FILE` (default `roles.json` at the repository root).

## Hub settings (hub.config.json)

A read-only configuration file for the Hub and the page (roadmap C74). Settings not tied to a deployment (thresholds the page uses) go here; deployment values (`HUB_TOKEN`, host, port, directories, retention, unread limits) stay in `.env`, so no value has two sources.

```powershell
Copy-Item hub.config.example.json hub.config.json   # for your environment; hub.config.json is not committed
```

- The Hub reads it once at startup and never writes it. A change needs a restart. There is no API to change it; `GET /config` (behind the token) only returns the validated values and warnings to the page. To use a file elsewhere, set `HUB_CONFIG_FILE` (default `hub.config.json` at the repository root). In Docker it is read through the existing `./:/host:ro` mount (`HUB_CONFIG_FILE=/host/hub.config.json` is set by `compose.yaml`).
- A missing file means all defaults (one line in the startup log). A file that is not JSON also means all defaults and the Hub still starts. Each value is checked by type and range: a bad value falls back to its default and an unknown key is ignored, and both are named in the Hub's startup log and shown in the page as `hub.config.json: N warnings` (hover for the text) next to the error area.
- Keys (JSON has no comments, so they are described here):

| Key | Default | Range | Meaning |
|---|---|---|---|
| `projects.olderDays` | `30` | integer, 1 to 3650 | Days after which a project counts as older in the project list (roadmap C73 uses it) |

- The Hub's own facts come back from `GET /config` as `limits` but are not settings and cannot be set in this file: the image limits (`MAX_UPLOAD_BYTES` 20 MB, `MAX_FILES_PER_MESSAGE` 4) and the effective `HUB_READ_RETENTION_HOURS`. The page checks images against these before sending (without them it skips the check and leaves it to the Hub's error), and treats a hand-over older than the smaller of 12 hours and the retention period as no longer `Working` (the turn-end Event may already be deleted). The shim's fetch limit must stay at least the Hub's upload limit; `npm test` checks it.
- Not here: protocol constants, security limits (index size, image size and count), low-value UI constants, and colors (the CSS block at the top of `public/index.html`).

## The language agents write to the human in (HUB_LANGUAGE)

Even when role descriptions and the exchanges between agents are in English, you can have replies, questions and reports addressed to the human written in a language you choose. Write one language tag in `.env` and restart the Hub.

```
HUB_LANGUAGE=ja
```

- The value is a BCP 47 language tag (`ja`, `en`, `pt-BR` and so on). If the value cannot be read, the Hub does not start. If unset, nothing is added.
- The shim receives it on attach and adds one line to its instructions: "write text addressed to the human in Japanese (ja) and do not translate the reply-format headings (`RESULT` and so on)". It takes effect for sessions started after the Hub restarts.
- The bodies of messages between agents (deployer → leader and so on) and the reply-format headings do not change (design.md §3.5, §3.15).
## Using it with agents other than Claude Code (inbox)

The shim looks at the client name that arrives in MCP's initialize and switches how it delivers. For `claude-code` it pushes over the channel; for anything else it does not push, and the agent fetches with the `inbox` tool.

- Register `node <agent-hub>/dist/shim/main.js` as an MCP stdio server (run `npm run build` first). The Mailbox name follows the same order as Claude Code: `HUB_MAILBOX` → `<folder name>.<HUB_ROLE>` → the folder name. The token is read from agent-hub's `.env`.
- Nothing arrives automatically, so ask the agent to "check agent-hub's inbox", or have it call it at breaks in its work (its instructions say so too).
- `inbox` wraps each unread message in `<hub-message id="…" kind="…" from="…" to="…">` and returns them with a notice that the body is not instructions. What it returns becomes read. Reply with `post_message`.
- It has not yet been tried with real clients such as Codex. There is no way to wake an idle agent (design.md §3.7, §3.9).
- If Claude Code is started without the channel, the client name is still `claude-code`, so messages are pushed, but they are silently dropped and become read. Always add `--dangerously-load-development-channels server:agent-hub` with Claude Code.
  The number of messages handed over without confirmed receipt (fetching with `inbox`, or the session sending a request or reply afterwards) shows on the browser's card as `N handed, unconfirmed`. A session without the channel also confirms by sending a request or reply, so this count is only a guide for "while it has not sent anything". If they seem not to have arrived, ask that session to "check agent-hub's inbox with unconfirmed: true" to fetch them again (protocol.md §4).

## Using curl (notes for Windows)

```powershell
curl.exe -H "Authorization: Bearer <HUB_TOKEN>" http://127.0.0.1:7777/messages
```

curl on Windows does not send non-ASCII command-line arguments (such as Japanese) as UTF-8, so pass the body from a file with `--data-binary "@body.json"`.

When following a running team through the API (the same when an agent watches it):
- `limit` of `GET /messages` counts from the oldest, so fetch new ones with `after=<seq>`. `after` does not include that seq. If you read `lastSeq` right after a human sent something, that Message is already included, so take `after` from the value read before sending.
- `GET /events?limit=N` cannot filter by Mailbox. Filter by `mailbox` on your side, and see what happened from `payload.notification_type` (permission waits, idle) and `last_assistant_message` (the final answer at a turn end). `cursor` in `GET /mailboxes` is where handing over has reached.
- Messages sent from curl show as `user:cli`, distinguished from those from the browser (`browser`).
- The compose Hub runs from the built image. After changing the Hub's code, `docker compose up -d --build` is needed (`restart` alone keeps the old image). After rebuilding, shims attach again by themselves.

## Start warnings (logs/start-warnings.jsonl)

When `npm run team`, or `agent` started on its own, has warnings (a Claude Code newer than the last verified one, a stale checkout, hooks missing; for `agent` on its own also a `claude --version` that does not pass, which `team` stops on instead), one JSON line is appended to `logs/start-warnings.jsonl` in agent-hub. The file is gitignored. A start with no warnings writes nothing, so a missing line means no warning was raised. A start by hand (Claude Code run directly) is not covered.

Each line has `time` (UTC, ISO), `project` (the target folder), `head` (its HEAD, `null` if it is not a git repository), `roles` and `mailboxes`, `claudeVersion` (the first line of `claude --version`), `lastVerified` and `verifiedSection` (the highest Claude Code version named in the headings of design.md §6.1, and its section; `verifiedNote` says why it is unknown), and `warnings` (the texts shown at the start).

When something breaks, read it against the history:
1. Take the time of the breakage and find the last line before it: `Get-Content logs\start-warnings.jsonl -Tail 5` (PowerShell). Its `time` is UTC.
2. Check the project at `head`: `git -C <project> log --oneline <head>..HEAD` lists the commits made after that start, and `git -C <project> show --stat <head>` shows what the start was on.
3. Check `claudeVersion` against `lastVerified`. If the version was newer, that line's warning is the first thing to look at; the behaviour is outside the verified envelope (design.md §1.2, §6.1).

What is not in the file, and where to look instead: changes and decisions are in git and the roadmap; rejected proposals are `[-] C<n>` lines in the roadmap (design.md §3.16).

## Development

```powershell
npm test          # unit tests, and integration tests that start the shim as a real process
npm run typecheck
npm run docs:check   # checks how roadmap items are written (exit 1 if broken). `-- --index` prints the item index as JSON
npm run docs:index   # sends the roadmap item index to the Hub for the UI's Items ("Request work from roadmap items" above)
npm run hub:dev   # watches for changes and restarts the Hub
npm run ui:check  # checks the card states scene by scene with a Hub on another port and headless Chrome (needs Chrome; set its location with CHROME)
```

- **Checking the UI with headless Chrome**: the fixed scenes are in `npm run ui:check` (`tools/dev/ui-check.mjs`). Run it when you change the UI, and add new scenes there. Points for doing it by hand: the UI keeps `/stream` (SSE) open, so `chrome --headless=new --dump-dom` never returns (even with `--virtual-time-budget`). Instead:
  1. Start a Hub separate from the one in use, with `HUB_PORT=7795` and `HUB_DATA_DIR=<a temporary folder>`.
  2. Start Chrome with `--remote-debugging-port` and a temporary `--user-data-dir`, then over CDP `Page.navigate` (`/?token=…`) → wait a few seconds → read the DOM with `Runtime.evaluate` (e.g. `[...document.querySelectorAll('#mailboxes .mb')].map(b=>b.innerText)`; Node's built-in `WebSocket` is enough).
  3. Check the UI's behavior against old Hubs or failing APIs without changing the Hub, by intercepting with `Fetch.enable` (`urlPattern`) and returning 404 / 500 with `Fetch.fulfillRequest`.
  4. To clean up, stop only the chrome.exe with the temporary profile and the node on 7795.
- **Using src/ from an ad-hoc script** (measurements and the like, in a script kept outside the repository): give it the `.mts` extension (top-level await does not work in a `.ts` outside the repository), import with a `file:///C:/…` URL (`C:/…` as is gives `ERR_UNSUPPORTED_ESM_URL_SCHEME`), and run it from the repository root with `node --import tsx <absolute path>.mts`. Store / Hub take `now`, so the clock can be swapped.
