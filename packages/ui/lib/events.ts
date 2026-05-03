type Listener<T = unknown> = (payload?: T) => void

const listeners = new Map<string, Set<Listener>>()

export function on<T = unknown>(event: string, fn: Listener<T>): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event)!.add(fn as Listener)
  return () => listeners.get(event)?.delete(fn as Listener)
}

export function emit<T = unknown>(event: string, payload?: T): void {
  listeners.get(event)?.forEach((fn) => fn(payload))
}
