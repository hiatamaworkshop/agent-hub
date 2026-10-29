// Opening a tab (or window) per role. The only OS-specific part of starting a team (design.md §3.8).
// When no way to open one is available, print the command for the human to run in a terminal of their own.
import { spawnSync } from 'node:child_process'
import { quoteForPlatform } from './quote.js'

export const OPENERS = ['wt', 'window', 'terminal', 'tmux', 'print'] as const
export type Opener = (typeof OPENERS)[number]
export const TMUX_SESSION = 'agent-hub'
const WT_WINDOW = 'agent-hub'

export function hasCommand(name: string, platform = process.platform): boolean {
  const r = platform === 'win32'
    ? spawnSync('where.exe', [name], { stdio: 'ignore', windowsHide: true })
    : spawnSync('sh', ['-c', `command -v ${quoteForPlatform(name, 'posix')}`], { stdio: 'ignore' })
  return r.status === 0
}

// Pick the opener: inside tmux use tmux; Windows Terminal, else a console window on Windows;
// Terminal.app on macOS; a detached tmux session on Linux if tmux is installed; otherwise print
export function detectOpener(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, has: (name: string) => boolean): Opener {
  if (env.TMUX && has('tmux')) return 'tmux'
  if (platform === 'win32') return has('wt.exe') ? 'wt' : 'window'
  if (platform === 'darwin') return 'terminal'
  if (has('tmux')) return 'tmux'
  return 'print'
}

export interface Launch {
  file: string
  args: string[]
  // cmd.exe reads the line as is (Node must not quote it again)
  verbatim?: boolean
}

// The process that opens a tab running argv in cwd. tmuxSessionExists says whether the detached session is already there
export function launchFor(opener: Exclude<Opener, 'print'>, title: string, cwd: string, argv: string[], opts: { insideTmux?: boolean; tmuxSessionExists?: boolean } = {}): Launch {
  const posixLine = argv.map((a) => quoteForPlatform(a, 'posix')).join(' ')
  switch (opener) {
    case 'wt':
      // wt reads ; in its arguments as a separator between its own commands, so the arguments must not contain ;
      return { file: 'wt.exe', args: ['-w', WT_WINDOW, 'new-tab', '--title', title, '-d', cwd, ...argv] }
    case 'window': {
      // start "title" /D dir command: a new console window. /s makes cmd strip only the outer quotes
      const q = (a: string) => quoteForPlatform(a, 'win32')
      const inner = `start "${title}" /D ${q(cwd)} ${argv.map(q).join(' ')}`
      return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${inner}"`], verbatim: true }
    }
    case 'terminal': {
      const line = `printf '\\033]0;%s\\007' ${quoteForPlatform(title, 'posix')}; cd ${quoteForPlatform(cwd, 'posix')} && ${posixLine}`
      const script = line.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      return { file: 'osascript', args: ['-e', `tell application "Terminal" to do script "${script}"`, '-e', 'tell application "Terminal" to activate'] }
    }
    case 'tmux':
      if (opts.insideTmux) return { file: 'tmux', args: ['new-window', '-n', title, '-c', cwd, posixLine] }
      if (opts.tmuxSessionExists) return { file: 'tmux', args: ['new-window', '-d', '-t', `${TMUX_SESSION}:`, '-n', title, '-c', cwd, posixLine] }
      return { file: 'tmux', args: ['new-session', '-d', '-s', TMUX_SESSION, '-n', title, '-c', cwd, posixLine] }
  }
}

// Open the tab. Returns an error message, or null when the opener ran
export function openTab(opener: Exclude<Opener, 'print'>, title: string, cwd: string, argv: string[], env: NodeJS.ProcessEnv = process.env): string | null {
  const insideTmux = Boolean(env.TMUX)
  const tmuxSessionExists = opener === 'tmux' && !insideTmux
    && spawnSync('tmux', ['has-session', '-t', TMUX_SESSION], { stdio: 'ignore' }).status === 0
  const l = launchFor(opener, title, cwd, argv, { insideTmux, tmuxSessionExists })
  // Not windowsHide: wt.exe and start pass the hidden flag on, and the tab would run in an invisible console
  const r = spawnSync(l.file, l.args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', windowsHide: false, windowsVerbatimArguments: l.verbatim })
  if (r.error) return `${l.file}: ${r.error.message}`
  if (r.status !== 0) return `${l.file} ended with exit code ${r.status}${r.stderr?.trim() ? `: ${r.stderr.trim()}` : ''}`
  return null
}
