export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function fromJson<T = unknown>(value: string): T {
  return JSON.parse(value) as T;
}
