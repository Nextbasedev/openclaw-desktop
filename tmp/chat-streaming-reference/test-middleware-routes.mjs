const sessionKey = process.argv[2]
if (!sessionKey) throw new Error('sessionKey arg required')

const baseUrl = 'http://127.0.0.1:3000'
const streamUrl = `${baseUrl}/api/chat/stream?sessionKey=${encodeURIComponent(sessionKey)}`
const sendUrl = `${baseUrl}/api/chat/send`

function parseSseChunk(buffer) {
  const parts = buffer.split('\n\n')
  return {
    complete: parts.slice(0, -1),
    rest: parts.at(-1) ?? '',
  }
}

function parseEvent(block) {
  const lines = block.split(/\r?\n/)
  const event = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? 'message'
  const data = lines.filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n')
  return { event, data: data ? JSON.parse(data) : null }
}

async function main() {
  const response = await fetch(streamUrl, { headers: { accept: 'text/event-stream' } })
  if (!response.ok || !response.body) {
    throw new Error(`stream failed: ${response.status} ${await response.text()}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events = []
  let ready = false
  let finalMessage = null
  let fullToolResult = null

  const readLoop = (async () => {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parsed = parseSseChunk(buffer)
      buffer = parsed.rest
      for (const block of parsed.complete) {
        if (!block.trim() || block.startsWith(':')) continue
        const event = parseEvent(block)
        events.push(event)
        if (event.event === 'chat.ready') ready = true
        if (event.event === 'chat.tool' && event.data?.result?.content?.[0]?.text) fullToolResult = event.data
        if (event.event === 'chat.message' && event.data?.text === 'HOSTNAME_CAPTURED') {
          finalMessage = event.data
          return
        }
      }
    }
  })()

  const startedAt = Date.now()
  while (!ready && Date.now() - startedAt < 15000) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error('did not receive chat.ready before send')

  const sendResponse = await fetch(sendUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionKey,
      text: 'Use the read tool to read /etc/hostname. Then reply with exactly HOSTNAME_CAPTURED and nothing else.',
    }),
  })
  const sendJson = await sendResponse.json()
  if (!sendResponse.ok) throw new Error(`send failed: ${JSON.stringify(sendJson)}`)

  await Promise.race([
    readLoop,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout waiting for middleware events')), 90000)),
  ])

  console.log(JSON.stringify({
    ok: true,
    send: sendJson,
    sawReady: ready,
    sawFinalMessage: Boolean(finalMessage),
    sawFullToolResult: Boolean(fullToolResult),
    fullToolResultText: fullToolResult?.result?.content?.[0]?.text ?? null,
    finalMessage,
    eventCount: events.length,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
