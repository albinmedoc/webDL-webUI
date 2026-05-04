import path from 'path';

import { config as serverConfig } from '../config/config.js';
import {
  REGISTRY,
  coerceValue,
  isRegistryKey,
  parseValue,
  serializeValue,
  type RegistryKey,
} from '../config/registry.js';
import { indexerConfig, usenetConfig } from '../config/usenetConfig.js';
import { getDb } from '../db/client.js';
import { appSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { writeSvtplayDlConfig } from './svtplayDlConfig.js';
import { logger } from '../utils/logger.js';

// Keys whose values flow into ~/.config/svtplay-dl/svtplay-dl.yaml. Mutating
// any of these requires regenerating the file so the next `svtplay-dl` spawn
// picks up the change.
const SVTPLAYDL_CONFIG_KEYS: readonly RegistryKey[] = [
  'downloadOutputDir',
  'svtplaydlFilenameTemplate',
  'svtplaydlProxy',
];

/**
 * Whether each registry key is currently pinned by an environment variable.
 * Computed once at module load; env vars are immutable for the process life.
 */
const envLocked: Record<RegistryKey, boolean> = (() => {
  const out = {} as Record<RegistryKey, boolean>;
  for (const key of Object.keys(REGISTRY) as RegistryKey[]) {
    out[key] = process.env[REGISTRY[key].envVar] !== undefined;
  }
  return out;
})();

export function isEnvLocked(key: RegistryKey): boolean {
  return envLocked[key];
}

/**
 * Apply a typed value to the appropriate in-memory singleton. The singleton
 * objects are imported by reference all over the codebase, so mutating in
 * place is what makes UI edits take effect live.
 */
function applyToSingleton(key: RegistryKey, value: unknown): void {
  if (key === 'downloadOutputDir') {
    serverConfig.downloadOutputDir = path.resolve(value as string);
    return;
  }
  if (key === 'uploadWatchDir') {
    serverConfig.uploadWatchDir = path.resolve(value as string);
    return;
  }
  if (key === 'svtplaydlFilenameTemplate') {
    serverConfig.svtplaydlFilenameTemplate = value as string;
    return;
  }
  if (key === 'svtplaydlProxy') {
    serverConfig.svtplaydlProxy = value as string;
    return;
  }
  if (key === 'seasonPackSkipLatest') {
    serverConfig.seasonPackSkipLatest = value as boolean;
    return;
  }

  switch (key) {
    case 'hookScript':
    case 'nzbOutputDir':
    case 'nzbRetentionDays':
      (indexerConfig as unknown as Record<string, unknown>)[key] = key === 'nzbRetentionDays'
        ? Math.max(0, value as number)
        : value;
      return;
    default:
      (usenetConfig as unknown as Record<string, unknown>)[key] = value;
      return;
  }
}

/**
 * Read the current effective value from the in-memory singleton.
 */
function readEffective(key: RegistryKey): unknown {
  if (key === 'downloadOutputDir') return serverConfig.downloadOutputDir;
  if (key === 'uploadWatchDir') return serverConfig.uploadWatchDir;
  if (key === 'svtplaydlFilenameTemplate') return serverConfig.svtplaydlFilenameTemplate;
  if (key === 'svtplaydlProxy') return serverConfig.svtplaydlProxy;
  if (key === 'seasonPackSkipLatest') return serverConfig.seasonPackSkipLatest;
  switch (key) {
    case 'hookScript':
    case 'nzbOutputDir':
    case 'nzbRetentionDays':
      return (indexerConfig as unknown as Record<string, unknown>)[key];
    default:
      return (usenetConfig as unknown as Record<string, unknown>)[key];
  }
}

/**
 * Load all DB overrides at startup and apply them to the singletons (skipping
 * keys that are env-locked). Idempotent — safe to call multiple times.
 */
export function loadOverridesFromDb(): void {
  const db = getDb();
  const rows = db.select().from(appSettings).all();
  let applied = 0;
  for (const row of rows) {
    if (!isRegistryKey(row.key)) continue;
    if (envLocked[row.key]) continue;
    const entry = REGISTRY[row.key];
    const value = parseValue(entry, row.value);
    applyToSingleton(row.key, value);
    applied += 1;
  }
  if (applied > 0) {
    logger.info('Applied DB config overrides', { count: applied });
  }
}

export interface SettingDescriptor {
  key: RegistryKey;
  envVar: string;
  group: string;
  kind: string;
  value: unknown;
  default: unknown;
  lockedByEnv: boolean;
  sensitive: boolean;
}

/**
 * Build the descriptor list returned by GET /api/settings. Sensitive values
 * are masked: the literal value is replaced with a boolean `valueSet` and the
 * `value` field becomes an empty string so the UI can still render an input.
 */
export function listSettings(): {
  settings: SettingDescriptor[];
  passSet: boolean;
} {
  const settings: SettingDescriptor[] = [];
  for (const key of Object.keys(REGISTRY) as RegistryKey[]) {
    const entry = REGISTRY[key];
    const value = readEffective(key);
    const sensitive = entry.sensitive === true;
    settings.push({
      key,
      envVar: entry.envVar,
      group: entry.group,
      kind: entry.kind,
      value: sensitive
        ? (typeof value === 'string' && value.length > 0 ? '__SET__' : '')
        : value,
      default: entry.default,
      lockedByEnv: envLocked[key],
      sensitive,
    });
  }
  return {
    settings,
    passSet: usenetConfig.pass.length > 0,
  };
}

export interface UpdateResult {
  applied: RegistryKey[];
  rejected: { key: string; reason: string }[];
}

/**
 * Apply a partial set of UI updates. Env-locked keys are rejected. Sensitive
 * keys with the sentinel `__SET__` (meaning "unchanged") are skipped. Each
 * accepted key is persisted to `app_settings` and applied to the singleton.
 */
export function updateSettings(
  updates: Record<string, unknown>,
): UpdateResult {
  const db = getDb();
  const now = Date.now();
  const applied: RegistryKey[] = [];
  const rejected: { key: string; reason: string }[] = [];

  for (const [rawKey, rawValue] of Object.entries(updates)) {
    if (!isRegistryKey(rawKey)) {
      rejected.push({ key: rawKey, reason: 'unknown setting' });
      continue;
    }
    if (envLocked[rawKey]) {
      rejected.push({ key: rawKey, reason: 'pinned by environment variable' });
      continue;
    }
    const entry = REGISTRY[rawKey];

    // Sensitive sentinel "__SET__" → keep current value, no-op.
    if (entry.sensitive && rawValue === '__SET__') {
      continue;
    }

    let typed: unknown;
    try {
      typed = coerceValue(entry, rawValue);
    } catch (err) {
      rejected.push({ key: rawKey, reason: (err as Error).message });
      continue;
    }

    const serialised = serializeValue(entry, typed);
    db.insert(appSettings)
      .values({ key: rawKey, value: serialised, updatedAt: now })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: serialised, updatedAt: now },
      })
      .run();

    applyToSingleton(rawKey, typed);
    applied.push(rawKey);
  }

  if (applied.length > 0) {
    logger.info('Applied settings update', { keys: applied });
  }

  if (applied.some((k) => SVTPLAYDL_CONFIG_KEYS.includes(k))) {
    writeSvtplayDlConfig();
  }

  return { applied, rejected };
}

/**
 * Delete a stored override (revert to env/default).
 */
export function clearOverride(key: RegistryKey): void {
  if (envLocked[key]) return;
  const db = getDb();
  db.delete(appSettings).where(eq(appSettings.key, key)).run();
  // Re-apply env/default value
  const entry = REGISTRY[key];
  const value = parseValue(entry, process.env[entry.envVar]);
  applyToSingleton(key, value);
  if (SVTPLAYDL_CONFIG_KEYS.includes(key)) {
    writeSvtplayDlConfig();
  }
}
