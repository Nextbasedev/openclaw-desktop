export type PendingSpawn = {
  parentSessionKey: string;
  toolCallId: string;
  label?: string;
  task?: string;
  createdAtMs: number;
  linkedChildSessionKey?: string;
};

export type SpawnLink = PendingSpawn & {
  childSessionKey: string;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class SubagentCorrelation {
  private readonly pendingSpawns = new Map<string, PendingSpawn>();
  private readonly subagentToSpawn = new Map<string, string>();
  private readonly pendingSubagentKeys = new Map<string, number>();

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  registerSpawn(params: {
    parentSessionKey: string;
    toolCallId: string;
    label?: string;
    task?: string;
    nowMs?: number;
  }): { spawn: PendingSpawn; link: SpawnLink | null } {
    const nowMs = params.nowMs ?? Date.now();
    this.sweep(nowMs);
    const existing = this.pendingSpawns.get(params.toolCallId);
    const spawn: PendingSpawn = {
      ...(existing ?? {}),
      parentSessionKey: params.parentSessionKey,
      toolCallId: params.toolCallId,
      label: params.label ?? existing?.label,
      task: params.task ?? existing?.task,
      createdAtMs: existing?.createdAtMs ?? nowMs,
      linkedChildSessionKey: existing?.linkedChildSessionKey,
    };
    this.pendingSpawns.set(params.toolCallId, spawn);

    if (spawn.linkedChildSessionKey) {
      return { spawn, link: { ...spawn, childSessionKey: spawn.linkedChildSessionKey } };
    }

    const candidates = [...this.pendingSubagentKeys.keys()];
    if (candidates.length === 1) {
      return { spawn, link: this.linkSpecific(params.toolCallId, candidates[0], nowMs) };
    }
    return { spawn, link: null };
  }

  linkSpecific(toolCallId: string, childSessionKey: string, nowMs = Date.now()): SpawnLink | null {
    this.sweep(nowMs);
    const existingTool = this.subagentToSpawn.get(childSessionKey);
    if (existingTool && existingTool !== toolCallId) return null;
    const spawn = this.pendingSpawns.get(toolCallId);
    if (!spawn) {
      this.pendingSubagentKeys.set(childSessionKey, nowMs);
      return null;
    }
    const linked: PendingSpawn = { ...spawn, linkedChildSessionKey: childSessionKey };
    this.pendingSpawns.set(toolCallId, linked);
    this.subagentToSpawn.set(childSessionKey, toolCallId);
    this.pendingSubagentKeys.delete(childSessionKey);
    return { ...linked, childSessionKey };
  }

  discoverChild(childSessionKey: string, nowMs = Date.now()): SpawnLink | null {
    this.sweep(nowMs);
    const existingToolCallId = this.subagentToSpawn.get(childSessionKey);
    if (existingToolCallId) return null;

    const candidates = [...this.pendingSpawns.values()].filter((spawn) => !spawn.linkedChildSessionKey);
    if (candidates.length === 1) return this.linkSpecific(candidates[0].toolCallId, childSessionKey, nowMs);

    this.pendingSubagentKeys.set(childSessionKey, nowMs);
    return null;
  }

  linkedSpawnForChild(childSessionKey: string): SpawnLink | null {
    const toolCallId = this.subagentToSpawn.get(childSessionKey);
    if (!toolCallId) return null;
    const spawn = this.pendingSpawns.get(toolCallId);
    return spawn ? { ...spawn, childSessionKey } : null;
  }

  private sweep(nowMs: number) {
    for (const [toolCallId, spawn] of this.pendingSpawns) {
      if (!spawn.linkedChildSessionKey && nowMs - spawn.createdAtMs > this.ttlMs) this.pendingSpawns.delete(toolCallId);
    }
    for (const [childSessionKey, discoveredAtMs] of this.pendingSubagentKeys) {
      if (nowMs - discoveredAtMs > this.ttlMs) this.pendingSubagentKeys.delete(childSessionKey);
    }
  }
}
