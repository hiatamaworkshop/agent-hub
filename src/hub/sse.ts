import type { SSEMessage, SSEStreamingApi } from 'hono/streaming'

// 購読元からの送信を 1 本の直列キューで書き、切断まで待つ。heartbeat は無通信が続いた間隔ごとに送る
export async function pump(
  stream: SSEStreamingApi,
  opts: {
    subscribe: (send: (m: SSEMessage) => void) => () => void
    heartbeatMs: number
    heartbeat: () => SSEMessage | string
  },
): Promise<void> {
  let chain = Promise.resolve()
  const write = (m: SSEMessage | string) => {
    chain = chain
      .then(async () => {
        if (typeof m === 'string') await stream.write(m)
        else await stream.writeSSE(m)
      })
      .catch(() => undefined)
  }
  const unsubscribe = opts.subscribe(write)
  const timer = setInterval(() => write(opts.heartbeat()), opts.heartbeatMs)
  try {
    await new Promise<void>((resolve) => stream.onAbort(resolve))
  } finally {
    clearInterval(timer)
    unsubscribe()
  }
}
