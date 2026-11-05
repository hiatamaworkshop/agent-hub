// The lines of a team start's summary that point the starting session at how requests and closes work (C132).
// Pure: the caller decides whether a reviewer is connected; this only builds the lines.
import { join } from 'node:path'
import { ROOT } from './env.js'

// The absolute path to docs/usage.md in this repository, so it opens from any project the team is started in
export function usageDocPath(): string {
  return join(ROOT, 'docs', 'usage.md')
}

export function startSummaryLines(usageDoc: string, reviewerConnected: boolean): string[] {
  const lines = [
    `planning session: requests are drafted from the item card (Draft request in the UI); review and close order: ${usageDoc} ("Try a round trip between roles")`,
  ]
  // With no reviewer the leader stops before the close and waits for the user's word (C133)
  if (!reviewerConnected) lines.push('no reviewer: the leader reports and waits for the user\'s "close C<n>" before the close (C133)')
  return lines
}
