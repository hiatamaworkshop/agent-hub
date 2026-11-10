// The Hub's own log outside Docker (roadmap C143). Everything the Hub prints to the console is also appended to logs/hub.log,
// one line per printed line with an ISO time (UTC) in front, and the token is masked in the file. The console output is unchanged.
// An uncaught error, an unhandled rejection and SIGINT / SIGTERM / SIGHUP are written to the file before the process exits.
// Docker is left alone: its output already goes to `docker logs`. The file keeps one rotation: logs/hub.log.1 holds the previous part.
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { format } from 'node:util'

export const HUB_LOG_MAX_BYTES = 1024 * 1024
const MASK = '***'

// The path of the log file. HUB_LOG_FILE (unset or blank: the default) names it; a relative path is resolved from the agent-hub
// folder `root`, as the default logs/hub.log is. The rotation goes to the same path with `.1` added
export function resolveHubLogFile(root: string, value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? join(root, 'logs', 'hub.log') : resolve(root, trimmed)
}

// Replaces every occurrence of each secret, the value after `token=` in a URL, and the value after `HUB_TOKEN=` with `***`.
// Secrets are matched as plain text, not as patterns.
export function maskSecrets(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) if (secret.length > 0) out = out.split(secret).join(MASK)
  return out
    .replace(/([?&]token=)[^\s&#'"<>]*/gi, `$1${MASK}`)
    .replace(/(HUB_TOKEN\s*[=:]\s*)[^\s'"]+/g, `$1${MASK}`)
}

// One line per line of `text`, each starting with the ISO time. A trailing newline does not add an empty line; CR before LF is dropped
export function formatLogLines(now: Date, text: string): string {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''))
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  const stamp = now.toISOString()
  return lines.map((line) => `${stamp} ${line}\n`).join('')
}

// Rotate before a write when the file already has something and this write would pass the cap
export function needsRotation(size: number, incoming: number, maxBytes: number): boolean {
  return size > 0 && size + incoming > maxBytes
}

// The log file. Writes are synchronous, so a line written just before process.exit is in the file
export class HubLogFile {
  private size = 0
  private warned = false
  private rotateWarned = false

  constructor(
    readonly file: string,
    private readonly secrets: readonly string[],
    private readonly maxBytes = HUB_LOG_MAX_BYTES,
    private readonly report: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
  ) {
    this.size = this.fileSize()
  }

  // Appends the text as timestamped lines. A failure is reported once on stderr and does not stop the Hub
  write(text: string, now: Date = new Date()): void {
    const line = maskSecrets(formatLogLines(now, text), this.secrets)
    const bytes = Buffer.byteLength(line)
    if (needsRotation(this.size, bytes, this.maxBytes)) this.rotate()
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      appendFileSync(this.file, line)
      this.size += bytes
    } catch (e) {
      if (!this.warned) {
        this.warned = true
        this.report(`[hub] cannot write the log ${this.file}: ${(e as Error).message}`)
      }
    }
  }

  // Moves the file to .1 and starts a new one. When the move fails (Windows refuses it while a reader holds the file open), the
  // file stays where it is and the caller still appends to it, so no line is lost; the file goes over the cap until a later write
  // can move it. The next write tries again, and the size is read from the file again so the count stays right
  private rotate(): void {
    try {
      renameSync(this.file, `${this.file}.1`)
      this.size = 0
    } catch (e) {
      this.size = this.fileSize()
      if (!this.rotateWarned) {
        this.rotateWarned = true
        this.report(`[hub] cannot move the log ${this.file} to ${this.file}.1, so it keeps growing until it can: ${(e as Error).message}`)
      }
    }
  }

  private fileSize(): number {
    try {
      return existsSync(this.file) ? statSync(this.file).size : 0
    } catch {
      return 0
    }
  }
}

// Every console method also goes to the file. The console itself prints what it printed before
export function teeConsole(log: HubLogFile): void {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[method].bind(console)
    console[method] = (...args: unknown[]) => {
      original(...args)
      log.write(format(...args))
    }
  }
}

// Writes an uncaught error, an unhandled rejection or a signal to the file, then exits. An error exits 1 as Node does by default;
// a signal exits 128 + its number, the code a process killed by that signal shows. The error's stack is also printed on the console,
// where Node would have printed it
export function installExitHandlers(log: HubLogFile, exit: (code: number) => never = (code) => process.exit(code)): void {
  process.on('uncaughtException', (err) => {
    console.error('[hub] uncaught exception, exiting:', err)
    exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[hub] unhandled rejection, exiting:', reason)
    exit(1)
  })
  const signals: [NodeJS.Signals, number][] = [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]]
  for (const [name, number] of signals) {
    process.on(name, () => {
      log.write(`[hub] ${name} received, exiting`)
      exit(128 + number)
    })
  }
}
