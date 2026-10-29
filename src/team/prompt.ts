// Reading a line from the terminal
import { createInterface } from 'node:readline/promises'

export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try { return await rl.question(question) } finally { rl.close() }
}

// Keep a tab open until the human has read why it failed (tabs close when their command ends)
export async function waitForEnter(): Promise<void> {
  if (!process.stdin.isTTY) return
  await ask('Press Enter to close this tab.')
}
