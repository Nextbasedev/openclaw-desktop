/**
 * Core types shared across all Jarvis packages.
 * Parse at boundary — all external data validated with Zod before use.
 */

// === Connection ===

export interface GatewayConnection {
  id: string;
  name: string;
  url: string;
  token: string;
  isLocal: boolean;
  status: "connected" | "disconnected" | "connecting" | "error";
}

// === Session ===

export interface Session {
  sessionId: string;
  sessionKey: string;
  agentId: string;
  status: "active" | "idle" | "busy" | "completed";
  createdAt: number;
  lastActivity: number;
  metadata?: Record<string, unknown>;
}

// === Message ===

export type MessageRole = "user" | "assistant" | "tool" | "system";

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string | ContentBlock[];
  timestamp: number;
  cost?: number;
  model?: string;
  parentId?: string; // for branching
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "image" | "thinking";
  text?: string;
  name?: string; // tool name
  input?: Record<string, unknown>; // tool input
  content?: string; // tool result
  data?: string; // image base64
  mimeType?: string;
}

// === Sub-Agent ===

export interface SubAgent {
  id: string;
  parentId: string | null;
  sessionId: string;
  status: "running" | "done" | "failed" | "killed";
  task?: string;
  startedAt: number;
  completedAt?: number;
  children: SubAgent[];
}

// === Tool Call ===

export interface ToolCall {
  id: string;
  sessionId: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: "running" | "success" | "error";
  startedAt: number;
  duration?: number;
}

// === File ===

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: number;
  children?: FileEntry[];
}

// === Cron ===

export interface CronJob {
  id: string;
  schedule: string;
  task: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  status: "idle" | "running" | "failed";
}

// === Settings ===

export type UIMode = "simple" | "mission-control";
export type Theme = "dark" | "light" | "system";
export type AutonomyLevel = "full-auto" | "supervised" | "manual-approval";

export interface UserSettings {
  uiMode: UIMode;
  theme: Theme;
  autonomyLevel: AutonomyLevel;
  defaultModel?: string;
  sidebarWidth: number;
  fontSize: number;
}
