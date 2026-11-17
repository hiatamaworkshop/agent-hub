// For tests that start a TypeScript entry point of this repository as a child process (the shim, docs:index).
// The Node arguments that make the child able to run a .ts file: tsx by default, as `npm run hub` and the shim's
// registration do. `npm run test:coverage` sets AGENT_HUB_TS_IMPORT to its own loader (tools/dev/ts-resolve.mjs), so the
// child can run the sources the same way as the test process (C173, design.md §5).
export function tsNodeArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  return ['--import', env.AGENT_HUB_TS_IMPORT || 'tsx']
}

// The environment for such a child: this process's, with coverage turned off. Under `npm run test:coverage` a child would
// otherwise write its own coverage, and Node's merge of a child's figures with the test process's for the same file was
// not stable: the same command gave roadmap.ts 54% of its lines once and 99.77% the next (2026-11-17, Node 26.13.1). So the
// figures count what the test processes run; what only a child runs (the shim's main.ts, docs:index) is not counted.
// Without coverage (`npm test`) the environment is passed unchanged
export function childEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v
  // An empty value, not a missing key: Node's child_process puts its own NODE_V8_COVERAGE back into a child's environment
  // when the key is missing, and an empty value turns the coverage off
  if (out.NODE_V8_COVERAGE !== undefined) out.NODE_V8_COVERAGE = ''
  return out
}
