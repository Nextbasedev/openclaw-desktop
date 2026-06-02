# Voice Command System — Architecture Plan

## Problem Statement

The current "voice command" system is a patchwork:
- **No real voice command processing** — the system only has speech-to-text (STT) for chat messages via browser's Web Speech API
- **No wake word detection** — there's no "Hey Anushka" or similar wake word system
- **No command parsing/execution** — even if speech is captured, there's no pipeline to parse commands like "open Telegram" or "start Chrome"
- **No Sarvam TTS integration** — Anushka's voice (Sarvam TTS) is not wired into the desktop app
- **Static command list** — Agi's recent fix only added hardcoded command word filtering (open/close/start/quit/stop), not a dynamic command system

Dixit wants a **perfect system** that can:
1. Listen for a wake word ("Hey Anushka")
2. Capture voice commands after wake word
3. Parse natural language commands dynamically (not just static keywords)
4. Execute actions (open apps, search, control desktop)
5. Respond with Anushka's voice (Sarvam TTS) for confirmations/clarifications

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VOICE COMMAND PIPELINE                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │  WAKE WORD   │───▶│   COMMAND    │───▶│   ACTION     │              │
│  │   DETECTOR   │    │   PARSER     │    │   EXECUTOR   │              │
│  │  (Whisper/   │    │  (LLM/NLP)   │    │  (Desktop    │              │
│  │   Porcupine) │    │              │    │   APIs)      │              │
│  └──────────────┘    └──────────────┘    └──────────────┘              │
│         │                   │                   │                        │
│         ▼                   ▼                   ▼                        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │  Always-on   │    │  Natural     │    │  App Launch  │              │
│  │  Mic Stream  │    │  Language    │    │  Web Search  │              │
│  │  (VAD)       │    │  Understanding│    │  System Cmd  │              │
│  └──────────────┘    └──────────────┘    └──────────────┘              │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                     SARVAM TTS (Anushka Voice)                     │ │
│  │  - Confirmation: "Opening Telegram now"                            │ │
│  │  - Clarification: "Did you mean Google Chrome or Chrome Canary?"   │ │
│  │  - Error: "I couldn't find that application"                         │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. Wake Word Detector

**Options:**

| Solution | Pros | Cons | Effort |
|----------|------|------|--------|
| **Porcupine (Picovoice)** | Free tier, offline, low latency, cross-platform | Requires wake word training file | 2-3 days |
| **Whisper.cpp + VAD** | Uses existing STT infra, no extra deps | Higher latency, always-on processing | 1-2 days |
| **Browser Web Speech API** | Already in codebase | No wake word support, browser-only | Not suitable |
| **Custom Rust + VAD** | Full control, native performance | Complex, time-consuming | 1-2 weeks |

**Recommendation:** Porcupine (Picovoice) — free tier allows custom wake words, runs offline, has Rust bindings via FFI or we can use their Node.js SDK in the middleware.

**Implementation:**
- Add `@picovoice/porcupine-node` or `pvporcupine` to middleware dependencies
- Create wake word model file for "Hey Anushka" (or use built-in "Hey Computer")
- Run in a background thread/process in the middleware
- When wake word detected, emit event to frontend via SSE/WebSocket

### 2. Voice Activity Detection (VAD) + Command Capture

**After wake word detected:**
1. Start recording audio stream
2. Use VAD to detect when user stops speaking
3. Send captured audio to STT (Sarvam or configured provider)
4. Get transcript of the command

**VAD Options:**
- **Silero VAD** — lightweight, ONNX-based, good accuracy
- **WebRTC VAD** — simple, but less accurate
- **Energy-based threshold** — simplest, but noisy

**Recommendation:** Silero VAD via ONNX runtime.

### 3. Command Parser (Natural Language Understanding)

**Problem:** Static keywords (open/close/start) are too limited. Need dynamic parsing.

**Options:**

| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| **LLM-based (Gateway)** | Handles any natural language, extensible | Requires API call, latency | 1-2 days |
| **Rule-based + fuzzy matching** | Fast, offline, deterministic | Limited flexibility | 2-3 days |
| **Hybrid: LLM for intent + rules for execution** | Best of both | More complex | 3-4 days |

**Recommendation:** Hybrid approach
- Use LLM (via Gateway) to parse intent from transcript
- Extract: `action`, `target`, `parameters`
- Example: "open Telegram" → `{action: "open_app", target: "Telegram"}`
- Example: "search for Python tutorials on Google" → `{action: "web_search", target: "Python tutorials", engine: "google"}`
- Fallback to rule-based for common commands to reduce latency

**Command Intent Schema:**
```typescript
interface VoiceCommand {
  intent: "open_app" | "close_app" | "search_web" | "system_command" | "chat_query" | "unknown";
  target?: string;        // app name, search query, etc.
  parameters?: Record<string, string>; // additional context
  confidence: number;     // 0-1
  rawTranscript: string;  // original STT output
}
```

### 4. Action Executor

**Command → Action Mapping:**

| Intent | Action | Implementation |
|--------|--------|----------------|
| `open_app` | Launch application | Platform-specific: `open` (macOS), `start` (Windows), `xdg-open` (Linux) |
| `close_app` | Kill application | Process termination via OS APIs |
| `search_web` | Open browser with search | Construct URL: `https://google.com/search?q={query}` |
| `system_command` | Execute shell command | Via existing PTY/terminal service |
| `chat_query` | Send to chat | Forward to current chat session |
| `unknown` | Ask for clarification | TTS: "I didn't understand, can you repeat?" |

**Desktop Integration:**
- **Windows:** Use `ShellExecute` or `CreateProcess` via Rust Tauri command
- **macOS:** Use `open` command or `NSWorkspace`
- **Linux:** Use `xdg-open` or `gtk-launch`

**App Name Resolution:**
- Maintain a mapping of common app names to executable paths
- Fuzzy match user speech to known apps
- Platform-specific app discovery (scan `/Applications`, `Program Files`, etc.)

### 5. Sarvam TTS Integration (Anushka Voice)

**Current State:** No TTS integration exists in the desktop app.

**Implementation:**
1. Add Sarvam TTS API client to middleware
2. When command is executed, generate confirmation message
3. Call Sarvam TTS with Anushka voice settings
4. Stream audio back to frontend
5. Frontend plays audio via Web Audio API or Tauri audio

**Sarvam TTS API:**
- Endpoint: `https://api.sarvam.ai/v1/text-to-speech`
- Voice: `anushka` (or configured voice)
- Language: `en-IN` (or auto-detect)
- Streaming: Support for chunked audio delivery

**Frontend Audio Playback:**
- Use Web Audio API for browser-based playback
- Or use Tauri's native audio capabilities for better performance

### 6. Event Flow

```
User: "Hey Anushka, open Telegram"

1. [Wake Word Detector] Detects "Hey Anushka"
   → Emits: `voice:wake-word-detected`

2. [VAD] Starts listening for command
   → UI shows: "Listening..." indicator

3. [VAD] Detects end of speech
   → Captured audio buffer sent to STT

4. [STT - Sarvam] Transcribes: "open Telegram"
   → Emits: `voice:command-transcribed` with text

5. [Command Parser - LLM] Parses intent:
   → `{intent: "open_app", target: "Telegram", confidence: 0.95}`

6. [Action Executor] Resolves "Telegram" → "telegram.exe" (Windows)
   → Executes: `start telegram.exe`
   → Emits: `voice:action-executed`

7. [TTS - Sarvam] Generates: "Opening Telegram now"
   → Streams audio to frontend

8. [Frontend] Plays audio confirmation
   → UI shows: "Opened Telegram" briefly
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1)

**Day 1-2: Wake Word Detection**
- [ ] Research Porcupine integration options for Node.js/Rust
- [ ] Create wake word model for "Hey Anushka"
- [ ] Implement wake word detector in middleware
- [ ] Add event emission for wake word detection

**Day 3-4: Audio Capture + VAD**
- [ ] Implement audio stream capture from microphone
- [ ] Integrate Silero VAD for speech detection
- [ ] Create audio buffer management
- [ ] Test end-to-end: wake word → audio capture → stop detection

**Day 5: STT Integration**
- [ ] Wire up existing STT providers (Sarvam, OpenAI, etc.) for command transcription
- [ ] Add command-specific STT settings (shorter timeout, single utterance)
- [ ] Test transcription accuracy for command-style speech

### Phase 2: Command Processing (Week 2)

**Day 1-2: Command Parser**
- [ ] Design command intent schema
- [ ] Implement LLM-based intent parsing via Gateway
- [ ] Create fallback rule-based parser for common commands
- [ ] Add confidence scoring and clarification flow

**Day 3-4: Action Executor**
- [ ] Implement app launcher for Windows (primary target)
- [ ] Create app name → executable mapping system
- [ ] Implement web search action
- [ ] Add system command execution via existing PTY

**Day 5: Integration + Testing**
- [ ] Wire all components together
- [ ] Add comprehensive logging/debugging
- [ ] Test basic commands: open, close, search
- [ ] Handle error cases and edge cases

### Phase 3: TTS + Polish (Week 3)

**Day 1-2: Sarvam TTS Integration**
- [ ] Add Sarvam TTS API client to middleware
- [ ] Implement voice settings (Anushka voice, language)
- [ ] Create audio streaming to frontend
- [ ] Add frontend audio playback

**Day 3-4: Clarification + Error Handling**
- [ ] Implement clarification flow for low-confidence commands
- [ ] Add "Did you mean X or Y?" prompts
- [ ] Handle unknown commands gracefully
- [ ] Add cancel/timeout handling

**Day 5: UI + Settings**
- [ ] Add voice command indicator UI (listening, processing, speaking)
- [ ] Create voice command settings panel
- [ ] Add wake word sensitivity control
- [ ] Add command history/debug view

### Phase 4: Advanced Features (Week 4+)

- [ ] Multi-turn commands ("open Chrome and search for...")
- [ ] Context awareness ("close the app I just opened")
- [ ] Custom command definitions via settings
- [ ] Voice shortcuts/macros
- [ ] Offline mode (local LLM for parsing)

---

## Technical Stack

| Component | Technology | Location |
|-----------|-----------|----------|
| Wake Word | Porcupine (Picovoice) | Middleware (Node.js) or Rust Tauri |
| VAD | Silero VAD (ONNX) | Middleware |
| STT | Sarvam / OpenAI / Groq | Gateway (existing) |
| Command Parser | LLM via Gateway + local rules | Middleware |
| Action Executor | Node.js child_process / Tauri commands | Middleware + Rust |
| TTS | Sarvam TTS API | Middleware |
| Audio Playback | Web Audio API / Tauri | Frontend |
| Events | SSE / WebSocket | Existing infrastructure |

---

## File Structure

```
packages/server/src/services/
├── voice-command.service.ts      # Main orchestrator
├── wake-word.service.ts          # Wake word detection
├── vad.service.ts                # Voice activity detection
├── command-parser.service.ts     # NLU / intent parsing
├── action-executor.service.ts    # Desktop action execution
├── tts.service.ts                # Sarvam TTS integration
└── voice-settings.service.ts     # Settings (existing)

packages/desktop/src-tauri/src/
├── voice_command.rs              # Rust-side audio capture (if needed)
└── lib.rs                        # Add voice command commands

packages/ui/
├── hooks/
│   └── useVoiceCommand.ts         # Frontend voice command hook
├── components/
│   └── VoiceCommandIndicator.tsx  # UI indicator
└── components/settings/tabs/
    └── VoiceTab.tsx               # Extended settings
```

---

## API Endpoints / Commands

```typescript
// New middleware commands to add to registry
middleware_voice_command_start: () => void           // Start listening for wake word
middleware_voice_command_stop: () => void            // Stop listening
middleware_voice_command_status: () => VoiceStatus    // Get current status
middleware_voice_command_debug: () => DebugInfo       // Get recent phrases/events
middleware_tts_speak: (text: string) => void          // Speak text via TTS
middleware_tts_stop: () => void                       // Stop speaking

// Events emitted via SSE
voice:wake-word-detected     // Wake word heard
voice:command-transcribed    // Command text from STT
voice:command-parsed         // Parsed intent
voice:action-executed        // Action completed
voice:tts-started            // TTS started speaking
voice:tts-ended              // TTS finished
voice:error                  // Error in pipeline
```

---

## Settings Schema

```json
{
  "voiceCommand": {
    "enabled": true,
    "wakeWord": "Hey Anushka",
    "wakeWordSensitivity": 0.7,
    "ttsEnabled": true,
    "ttsVoice": "anushka",
    "ttsLanguage": "en-IN",
    "confirmationMode": "always", // "always", "actions-only", "never"
    "commandTimeoutMs": 10000,
    "sttProvider": "sarvam",
    "vadSensitivity": "medium" // "low", "medium", "high"
  }
}
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Porcupine free tier limits | Medium | Have fallback to Whisper-based wake word |
| Microphone permission issues | High | Clear UX for permission grant, fallback to manual activation |
| STT latency for commands | Medium | Use faster STT models (Groq Whisper), local caching |
| App name resolution fails | Medium | Fuzzy matching, user-defined aliases, manual browse |
| TTS adds latency | Low | Stream audio, use shorter confirmations |
| Background noise false triggers | Medium | Good VAD + wake word sensitivity tuning |

---

## Success Criteria

1. **Wake word detection** works 90%+ of the time in quiet environment
2. **Command execution** succeeds for top 20 common commands
3. **TTS confirmation** plays within 2 seconds of action completion
4. **End-to-end latency** (wake word → action) under 5 seconds
5. **No false triggers** during normal computer use (typing, video playback)

---

## Next Steps

1. **Approve architecture** — Dixit reviews and approves plan
2. **Set up Porcupine** — Get API key, test wake word detection
3. **Create proof of concept** — Basic wake word → STT → action flow
4. **Iterate** — Test with real usage, refine based on feedback

---

*Plan created by Cozy based on analysis of current codebase and Dixit's requirements for a perfect voice command system with Anushka voice.*
