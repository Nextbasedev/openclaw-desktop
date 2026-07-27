import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { MiddlewareV2Config } from "../config/env.js";
import { migrateDatabase } from "./migrate.js";

export type MiddlewareDatabase = Database.Database;

export function openDatabase(config: Pick<MiddlewareV2Config, "databasePath">): MiddlewareDatabase {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  const db = new Database(config.databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrateDatabase(db);
  return db;
}
