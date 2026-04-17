import {
  createChatSession,
  deleteChatSession,
  getChatHistory,
  openChatEventStream,
  sendChatMessage,
} from '../../packages/middleware/src/index.ts'

const prompt = 'Use the read tool to read /etc/hostname. Then reply with exactly HOSTNAME_CAPTURED and nothing else.'

async function waitFor(predicate, timeoutMs = 90000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = predicate()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timeout waiting for expected middleware event')
}

async function runCase(verboseLevel) {
  const { sessionKey } = await createChatSession({
    label: `Jarvis middleware package ${verboseLevel} ${new Date().toISOString()}`,
    verboseLevel,
  })

  const events = []
  const stream = await openChatEventStream({
    sessionKey,
    onEvent(event) {
      events.push(event)
    },
  })

  try {
    await waitFor(() => events.find((event) => event.type === 'chat.ready'))
    const send = await sendChatMessage({ sessionKey, text: prompt })
    await waitFor(() => events.find((event) => event.type === 'chat.message' && event.text === 'HOSTNAME_CAPTURED'))
    const history = await getChatHistory(sessionKey)
    return {
      verboseLevel,
      sessionKey,
      send,
      history,
      toolEvents: events.filter((event) => event.type === 'chat.tool'),
      finalMessage: events.find((event) => event.type === 'chat.message' && event.text === 'HOSTNAME_CAPTURED') ?? null,
      events,
    }
  } finally {
    stream.close()
    await deleteChatSession(sessionKey)
  }
}

const onCase = await runCase('on')
const fullCase = await runCase('full')

console.log(JSON.stringify({
  ok: true,
  on: {
    toolEvents: onCase.toolEvents.map((event) => ({
      phase: event.phase,
      name: event.name,
      toolOutputVisibility: event.toolOutputVisibility,
      hasResult: event.result != null,
      hasPartialResult: event.partialResult != null,
    })),
  },
  full: {
    toolEvents: fullCase.toolEvents.map((event) => ({
      phase: event.phase,
      name: event.name,
      toolOutputVisibility: event.toolOutputVisibility,
      hasResult: event.result != null,
      hasPartialResult: event.partialResult != null,
      text: event.result?.content?.[0]?.text ?? null,
    })),
  },
}, null, 2))
