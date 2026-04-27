import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

import * as schema from './schema.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type DbClient = BetterSQLite3Database<typeof schema>;

let dbInstance: DbClient | null = null;
let sqliteInstance: Database.Database | null = null;

export function getDbPath(): string {
  return process.env.DB_PATH ?? path.resolve(process.cwd(), 'data', 'svtplay-dl-webui.db');
}

export function getDb(): DbClient {
  if (dbInstance) return dbInstance;

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  sqliteInstance = new Database(dbPath);
  sqliteInstance.pragma('journal_mode = WAL');
  sqliteInstance.pragma('foreign_keys = ON');

  dbInstance = drizzle(sqliteInstance, { schema });
  return dbInstance;
}

export function runMigrations(): void {
  const db = getDb();
  const migrationsFolder = path.join(__dirname, 'migrations');
  logger.info('Running database migrations', { migrationsFolder, dbPath: getDbPath() });
  migrate(db, { migrationsFolder });
  logger.info('Database migrations complete');
}

export function closeDb(): void {
  if (sqliteInstance) {
    sqliteInstance.close();
    sqliteInstance = null;
    dbInstance = null;
  }
}
