/**
 * Deterministic Large-Chat Transcript Generator
 * Phase 1: Seed a 10x45 (10 sessions, 45 messages each) message stream
 */

const SESSION_KEYS = [
  "agent:main:telegram:user:12345",
  "agent:main:discord:dm:67890",
  "agent:main:slack:channel:abc",
  "agent:main:web:session:def",
  "agent:main:group:-1003743034323:topic:14540",
  "agent:main:whatsapp:user:11111",
  "agent:main:email:thread:22222",
  "agent:main:subagent:child-a",
  "agent:main:subagent:child-b",
  "agent:main:subagent:child-c",
];

const ROLES = ["user", "assistant", "tool"];

function generateTranscriptStream(seed, sessionCount = 10, messagesPerSession = 45) {
  let s = seed;
  const rand = () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };

  const messages = [];
  for (let si = 0; si < sessionCount; si++) {
    const sessionKey = SESSION_KEYS[si % SESSION_KEYS.length];
    let seq = 1;
    let currentRunId = undefined;
    for (let mi = 0; mi < messagesPerSession; mi++) {
      const roleIdx = Math.floor(rand() * 3);
      const role = ROLES[roleIdx];
      const runId = role === "user" ? `run:${sessionKey}:${seq}` : currentRunId;
      if (role === "user") currentRunId = runId;

      const msg = {
        id: `msg-${sessionKey}-seq${seq}`,
        sessionKey,
        role,
        text: `${role} turn ${mi} in session ${si} (seq=${seq})`,
        seq,
        runId,
      };

      if (role === "tool") {
        msg.toolCallId = `tool-${sessionKey}-${seq}`;
        msg.phase = ["start", "result", "error"][Math.floor(rand() * 3)];
        msg.text = `tool ${msg.toolCallId} ${msg.phase}`;
      }

      messages.push(msg);
      seq++;
    }
  }
  return messages;
}

function generateDuplicateEchoes(originals, echoRate = 0.15) {
  const echoes = [];
  for (const msg of originals) {
    if (msg.role === "user" && Math.random() < echoRate) {
      echoes.push({
        ...msg,
        id: `echo-${msg.id}`,
        text: msg.text,
      });
    }
  }
  return echoes;
}

function generateOptimisticUsers(originals) {
  return originals
    .filter((m) => m.role === "user")
    .map((m) => ({
      sessionKey: m.sessionKey,
      id: `optimistic-${m.id}`,
      text: m.text,
      runId: m.runId,
      idempotencyKey: `idem-${m.runId}`,
    }));
}

export { generateTranscriptStream, generateDuplicateEchoes, generateOptimisticUsers, SESSION_KEYS };

// Quick sanity check
const stream = generateTranscriptStream(42, 10, 45);
console.log(`Generated ${stream.length} messages`);
const bySession = new Map();
for (const m of stream) {
  bySession.set(m.sessionKey, (bySession.get(m.sessionKey) || 0) + 1);
}
for (const [k, v] of bySession) {
  console.log(`  ${k}: ${v} messages`);
}
const echoes = generateDuplicateEchoes(stream, 0.2);
console.log(`Generated ${echoes.length} duplicate echoes`);
const optimistic = generateOptimisticUsers(stream);
console.log(`Generated ${optimistic.length} optimistic user entries`);
