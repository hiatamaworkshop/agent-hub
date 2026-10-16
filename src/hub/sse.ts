import type { SSEMessage, SSEStreamingApi } from 'hono/streaming'

// 購読元からの送信を 1 本の直列キューで書き、切断 (または close) まで待つ。heartbeat は一定間隔で送る
export async function pump(
  stream: SSEStreamingApi,
  opts: {
    // close を呼ぶと、それまでに積んだ送信を書き終えてから閉じる
    subscribe: (send: (m: SSEMessage) => void, close: () => void) => () => void
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
  let closed!: () => void
  const done = new Promise<void>((resolve) => {
    closed = resolve
    stream.onAbort(resolve)
  })
  const unsubscribe = opts.subscribe(write, () => void chain.then(closed))
  const timer = setInterval(() => write(opts.heartbeat()), opts.heartbeatMs)
  try {
    await done
  } finally {
    clearInterval(timer)
    unsubscribe()
  }
}
