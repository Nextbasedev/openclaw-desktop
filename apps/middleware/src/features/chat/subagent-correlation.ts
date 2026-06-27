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
// Linked spawns must also be reclaimed eventually so a long-lived process does
// not retain one entry per distinct subagent forever. Generous by design: it is
// a backstop, not the primary reclaim path (explicit release() is), and it must
// never expire a still-active long-running subagent's link.
const DEFAULT_LINKED_TTL_MS = 24 * 60 * 60 * 1000;

export type RehydrateEntry = {
  parentSessionKey: string;
  toolCallId: string;
  childSessionKey?: string | null;
  label?: string;
  task?: string;
  createdAtMs?: number;
};

export class SubagentCorrelation {
  private readonly pendingSpawns = new Map<string, PendingSpawn>();
  private readonly subagentToSpawn = new Map<string, string>();
  private readonly pendingSubagentKeys = new Map<string, number>();

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly linkedTtlMs = DEFAULT_LINKED_TTL_MS,
  ) {}

  /**
   * Restore correlation state from persisted create_task tool-call rows after a
   * restart (in-memory state is otherwise lost). Idempotent: existing in-memory
   * entries are never downgraded. Linked entries (childSessionKey present) are
   * restored as links; the rest become unlinked pending spawns. Returns counts.
   */
  rehydrate(entries: RehydrateEntry[], nowMs = Date.now()): { linked: number; pending: number } {
    let linked = 0;
    let pending = 0;
    for (const entry of entries) {
      if (!entry.toolCallId || !entry.parentSessionKey) continue;
      const createdAtMs = entry.createdAtMs ?? nowMs;
      const existing = this.pendingSpawns.get(entry.toolCallId);
      const childSessionKey = entry.childSessionKey ?? existing?.linkedChildSessionKey ?? null;
      const spawn: PendingSpawn = {
        parentSessionKey: entry.parentSessionKey,
        toolCallId: entry.toolCallId,
        label: existing?.label ?? entry.label,
        task: existing?.task ?? entry.task,
        createdAtMs: existing?.createdAtMs ?? createdAtMs,
        linkedChildSessionKey: childSessionKey ?? undefined,
      };
      this.pendingSpawns.set(entry.toolCallId, spawn);
      if (childSessionKey) {
        if (!this.subagentToSpawn.has(childSessionKey)) this.subagentToSpawn.set(childSessionKey, entry.toolCallId);
        this.pendingSubagentKeys.delete(childSessionKey);
        linked += 1;
      } else {
        pending += 1;
      }
    }
    return { linked, pending };
  }

  /**
   * Explicitly drop the correlation entry for a child once the subagent run is
   * terminal, so linked state is not retained for the process lifetime.
   */
  release(childSessionKey: string): void {
    const toolCallId = this.subagentToSpawn.get(childSessionKey);
    this.subagentToSpawn.delete(childSessionKey);
    this.pendingSubagentKeys.delete(childSessionKey);
    if (toolCallId) this.pendingSpawns.delete(toolCallId);
  }

  stats(): { pendingSpawns: number; linkedChildren: number; pendingChildKeys: number } {
    return {
      pendingSpawns: this.pendingSpawns.size,
      linkedChildren: this.subagentToSpawn.size,
      pendingChildKeys: this.pendingSubagentKeys.size,
    };
  }

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
      const ttl = spawn.linkedChildSessionKey ? this.linkedTtlMs : this.ttlMs;
      if (nowMs - spawn.createdAtMs > ttl) {
        this.pendingSpawns.delete(toolCallId);
        // Drop the reverse index for any linked child reclaimed by this sweep.
        if (spawn.linkedChildSessionKey) this.subagentToSpawn.delete(spawn.linkedChildSessionKey);
      }
    }
    // Reclaim any linked child whose spawn is already gone (defensive).
    for (const [childSessionKey, toolCallId] of this.subagentToSpawn) {
      if (!this.pendingSpawns.has(toolCallId)) this.subagentToSpawn.delete(childSessionKey);
    }
    for (const [childSessionKey, discoveredAtMs] of this.pendingSubagentKeys) {
      if (nowMs - discoveredAtMs > this.ttlMs) this.pendingSubagentKeys.delete(childSessionKey);
    }
  }
}
