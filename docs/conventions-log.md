# Conventions log

The conventions change, and documents written earlier are not rewritten (design.md §3.12, "When the conventions change"). This file says how to read the older forms. Read it when an item, a closed record or a ledger looks wrong under the current rules: it may follow an earlier one.

- One line per change, oldest first. `Layer` is `format` (read by the checker, the Hub or the UI) or `practice` (read by agents and humans).
- A change to the conventions adds its line here in the same commit, written by whoever makes the change (design.md §3.12, the table of conventions).
- Changes before 2026-11-08 were written back only where an old form could be misread (C140); the rest are in git.

| Date | Layer | What changed | How to read the old form | Item |
|---|---|---|---|---|
| 2026-10-27 | format | A ledger with items has one `## 予定` / `## Plan`; without it `docs:check` reports an error. `ブロック` / `blocked` is only for a decided item waiting on another item; waiting on an outside event is `保留` / `held` | A ledger without the heading has no recorded order (its index has `plan: null`): take the decided items in number order. In records before this date, `ブロック` may mean waiting on an outside event | C51 |
| 2026-10-29 | format | The ledger and the reply format are also read in English (`Status: proposed`, `#### Done when`, `## Plan`, `RESULT`, `NEEDS DECISION` …) | Japanese words are still read the same; the mapping table is in design.md §3.15 | C64 |
| 2026-10-29 | practice | Documents in this repository are written in English | Closed records before this date are in Japanese. Translating the items open that day changed their done-when wording, so a request sent before it with `meta.item` shows a promise diff that is not a change of the promise | C65 |
| 2026-11-01 | practice | An item is closed by a closing request after its review, not in the deployer's first run | A closed record before this date does not mean the item was reviewed unless it says so: the deployer closed it when the last condition was checked | C102 |
| 2026-11-06 | practice | With no reviewer connected, the leader stops before the closing request and the close waits for the user's word | Before this date, a close marked "no review" was sent by the leader after its own check, without the user's word | C133 |
| 2026-11-06 | format | A title after `C<n>` on a plan line is a warning, and the line is read as `C<n>` | Before this date such a line was an error and was not read as part of the plan. Where a plan line carries a title, the item's section has the current one | C134 |
