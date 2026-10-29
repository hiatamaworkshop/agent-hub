// Quoting one argument for the shell that will read it.
// win32: a CreateProcess / cmd.exe command line. Paths on Windows cannot contain ", so no escaping inside the quotes is needed
export type QuoteStyle = 'posix' | 'powershell' | 'win32'

export function quoteForPlatform(s: string, style: QuoteStyle): string {
  if (style === 'posix') return /^[A-Za-z0-9_\/.:,=@+%-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
  if (style === 'powershell') return /^[A-Za-z0-9_\\\/.:,=+-]+$/.test(s) ? s : `'${s.replace(/'/g, `''`)}'`
  if (/^[A-Za-z0-9_\\\/.:,=+-]+$/.test(s)) return s
  // A backslash right before the closing quote would escape it for CreateProcess, so double trailing backslashes
  return `"${s.replace(/"/g, '\\"').replace(/(\\+)$/, '$1$1')}"`
}

// A command line to show a human: move to the folder, then run the command
export function commandLine(cwd: string, argv: string[], platform = process.platform): string {
  if (platform === 'win32') {
    const q = (a: string) => quoteForPlatform(a, 'powershell')
    const [head, ...rest] = argv
    // PowerShell runs a quoted first word only with the call operator
    return `Set-Location ${q(cwd)}; & ${q(head ?? '')} ${rest.map(q).join(' ')}`.trimEnd()
  }
  const q = (a: string) => quoteForPlatform(a, 'posix')
  return `cd ${q(cwd)} && ${argv.map(q).join(' ')}`
}
