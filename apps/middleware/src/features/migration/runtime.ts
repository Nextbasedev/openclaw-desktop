import { IMPORT_PROVENANCE_VERSION, type ImportedPlatformKind } from "./provenance-repository.js";

type RecordLike = Record<string, unknown>;

function object(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : null;
}

export function isImportedPlatformKind(value: unknown): value is ImportedPlatformKind {
  return value === "telegram" || value === "discord";
}

export function gatewayMigrationMetadata(input: { platformKind: ImportedPlatformKind; sourceSessionKey: string; sourceSessionId?: string | null }) {
  return {
    openclawDesktop: {
      migration: {
        version: IMPORT_PROVENANCE_VERSION,
        platform: input.platformKind,
        sourceSessionKey: input.sourceSessionKey,
        ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}),
      },
    },
  };
}

export function gatewayMigrationProvenance(record: unknown): { platformKind: ImportedPlatformKind; sourceSessionKey: string; sourceSessionId: string | null } | null {
  const row = object(record);
  const entry = object(row?.entry) ?? object(object(row?.payload)?.entry);
  const containers = [row, object(row?.metadata), entry, object(entry?.metadata)];
  for (const container of containers) {
    const metadataMigration = object(object(object(container?.metadata)?.openclawDesktop)?.migration);
    const directMigration = object(object(container?.openclawDesktop)?.migration);
    const migration = metadataMigration ?? directMigration;
    const platformKind = migration?.platform;
    const sourceSessionKey = migration?.sourceSessionKey;
    if (isImportedPlatformKind(platformKind) && typeof sourceSessionKey === "string" && sourceSessionKey.trim()) {
      return {
        platformKind,
        sourceSessionKey: sourceSessionKey.trim(),
        sourceSessionId: typeof migration?.sourceSessionId === "string" && migration.sourceSessionId.trim() ? migration.sourceSessionId : null,
      };
    }
  }
  return null;
}
