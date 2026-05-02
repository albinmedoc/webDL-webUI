/**
 * Config registry — single source of truth for every runtime-tunable key.
 *
 * Each entry knows: which env var pins the value, how to parse a string into
 * the typed value, the default, the group label (UI grouping), and whether
 * to mask the value in API responses.
 *
 * Resolution order on startup: ENV (if set) → DB override (if any) → default.
 * Once an env var is set, the key is "locked" — UI edits are rejected.
 */

export type ConfigGroup =
  | 'connection'
  | 'archive'
  | 'subject'
  | 'release'
  | 'workdir'
  | 'indexer'
  | 'download';

export type ConfigKind = 'string' | 'boolean' | 'integer' | 'float' | 'list' | 'shellArgs';

export interface RegistryEntry<T = unknown> {
  key: string;
  envVar: string;
  group: ConfigGroup;
  kind: ConfigKind;
  default: T;
  sensitive?: boolean;
  /**
   * Some live keys still require manual restart to take effect (e.g. retention
   * scheduler interval). Default is "live" for everything UI-editable.
   */
  restartRequired?: boolean;
  description?: string;
}

function defineRegistry<T extends Record<string, RegistryEntry>>(
  r: T,
): { [K in keyof T]: RegistryEntry } {
  return r;
}

export const REGISTRY = defineRegistry({
  // Usenet — connection
  enabled:               { key: 'enabled',               envVar: 'USENET_ENABLED',                  group: 'connection', kind: 'boolean', default: false                                  },
  host:                  { key: 'host',                  envVar: 'USENET_HOST',                     group: 'connection', kind: 'string',  default: ''                                     },
  port:                  { key: 'port',                  envVar: 'USENET_PORT',                     group: 'connection', kind: 'integer', default: 563                                    },
  ssl:                   { key: 'ssl',                   envVar: 'USENET_SSL',                      group: 'connection', kind: 'boolean', default: true                                   },
  user:                  { key: 'user',                  envVar: 'USENET_USER',                     group: 'connection', kind: 'string',  default: ''                                     },
  pass:                  { key: 'pass',                  envVar: 'USENET_PASS',                     group: 'connection', kind: 'string',  default: '', sensitive: true                    },
  connections:           { key: 'connections',           envVar: 'USENET_CONNECTIONS',              group: 'connection', kind: 'integer', default: 20                                     },
  groups:                { key: 'groups',                envVar: 'USENET_GROUPS',                   group: 'connection', kind: 'list',    default: ['alt.binaries.boneless']              },

  // Usenet — archive & PAR2
  par2Percent:           { key: 'par2Percent',           envVar: 'USENET_PAR2_PERCENT',             group: 'archive',    kind: 'integer', default: 10                                     },
  rarSizeMb:             { key: 'rarSizeMb',             envVar: 'USENET_RAR_SIZE_MB',              group: 'archive',    kind: 'integer', default: 50                                     },
  maxConcurrent:         { key: 'maxConcurrent',         envVar: 'USENET_MAX_CONCURRENT',           group: 'archive',    kind: 'integer', default: 2                                      },
  minFreeDiskMultiplier: { key: 'minFreeDiskMultiplier', envVar: 'USENET_MIN_FREE_DISK_MULTIPLIER', group: 'archive',    kind: 'float',   default: 3                                      },

  // Usenet — subject & nyuu
  subjectTemplate:       { key: 'subjectTemplate',       envVar: 'USENET_SUBJECT_TEMPLATE',         group: 'subject',    kind: 'string',  default: '[{filename}] - "{rarname}" yEnc ({part}/{total})' },
  posterFrom:            { key: 'posterFrom',            envVar: 'USENET_POSTER_FROM',              group: 'subject',    kind: 'string',  default: '',
    description: 'Value for the article From: header. Supports {random} for a per-post hex token. Empty = let nyuu pick its default.' },
  nfoPath:               { key: 'nfoPath',               envVar: 'USENET_NFO_PATH',                 group: 'subject',    kind: 'string',  default: ''                                     },
  nyuuExtraArgs:         { key: 'nyuuExtraArgs',         envVar: 'USENET_NYUU_EXTRA_ARGS',          group: 'subject',    kind: 'shellArgs', default: [] as string[]                       },

  // Usenet — release naming
  releaseGroup:          { key: 'releaseGroup',          envVar: 'USENET_RELEASE_GROUP',            group: 'release',    kind: 'string',  default: 'SVTDL'                                },
  releaseNameTemplate:   { key: 'releaseNameTemplate',   envVar: 'USENET_RELEASE_NAME_TEMPLATE',    group: 'release',    kind: 'string',  default: '{show}.S{season}E{episode}.{quality}.WEB-DL.{codec}-{group}' },

  // Usenet — work directory
  workDir:               { key: 'workDir',               envVar: 'USENET_WORK_DIR',                 group: 'workdir',    kind: 'string',  default: '/data/work'                           },

  // Indexer
  hookScript:            { key: 'hookScript',            envVar: 'INDEXER_HOOK_SCRIPT',             group: 'indexer',    kind: 'string',  default: ''                                     },
  nzbOutputDir:          { key: 'nzbOutputDir',          envVar: 'NZB_OUTPUT_DIR',                  group: 'indexer',    kind: 'string',  default: '/data/nzb'                            },
  nzbRetentionDays:      { key: 'nzbRetentionDays',      envVar: 'NZB_RETENTION_DAYS',              group: 'indexer',    kind: 'integer', default: 0                                      },

  // svtplay-dl download output dir
  downloadOutputDir:     { key: 'downloadOutputDir',     envVar: 'DOWNLOAD_OUTPUT_DIR',             group: 'download',   kind: 'string',  default: '/data/downloads'                      },

  // Watch folder for usenet uploads. Anything dropped here gets posted.
  uploadWatchDir:        { key: 'uploadWatchDir',        envVar: 'UPLOAD_WATCH_DIR',                group: 'download',   kind: 'string',  default: '/data/upload'                         },
});

export type RegistryKey = keyof typeof REGISTRY;

export function isRegistryKey(key: string): key is RegistryKey {
  return Object.prototype.hasOwnProperty.call(REGISTRY, key);
}

// ---------- parsing helpers ----------

export function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

export function parseInt10(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseFloatSafe(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseList(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value === '') return fallback;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function parseShellArgs(value: string | undefined): string[] {
  if (!value) return [];
  return value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((s) =>
    s.replace(/^['"]|['"]$/g, '')
  ) ?? [];
}

/**
 * Parse a raw string (env value or DB-stored value) into the typed value for a
 * given registry entry. The fallback is the registry default.
 */
export function parseValue(entry: RegistryEntry, raw: string | undefined): unknown {
  switch (entry.kind) {
    case 'string': return raw === undefined ? entry.default : raw;
    case 'boolean': return parseBool(raw, entry.default as boolean);
    case 'integer': return parseInt10(raw, entry.default as number);
    case 'float': return parseFloatSafe(raw, entry.default as number);
    case 'list': return parseList(raw, entry.default as string[]);
    case 'shellArgs': return raw === undefined ? entry.default : parseShellArgs(raw);
  }
}

/**
 * Serialize a typed value back to a string for storage in the app_settings
 * table. Mirrors `parseValue`.
 */
export function serializeValue(entry: RegistryEntry, value: unknown): string {
  switch (entry.kind) {
    case 'string': return String(value ?? '');
    case 'boolean': return value ? 'true' : 'false';
    case 'integer':
    case 'float': return String(value);
    case 'list': return Array.isArray(value) ? value.join(',') : String(value ?? '');
    case 'shellArgs': return Array.isArray(value)
      ? (value as string[]).map((s) => /\s/.test(s) ? `"${s}"` : s).join(' ')
      : String(value ?? '');
  }
}

/**
 * Coerce a JSON-parsed value (from a PUT request body) into the canonical
 * typed value for storage. Throws on type errors.
 */
export function coerceValue(entry: RegistryEntry, raw: unknown): unknown {
  switch (entry.kind) {
    case 'string': {
      if (raw === null || raw === undefined) return '';
      if (typeof raw !== 'string') throw new Error(`${entry.key} must be a string`);
      return raw;
    }
    case 'boolean': {
      if (typeof raw !== 'boolean') throw new Error(`${entry.key} must be a boolean`);
      return raw;
    }
    case 'integer': {
      if (typeof raw !== 'number' || !Number.isInteger(raw)) throw new Error(`${entry.key} must be an integer`);
      return raw;
    }
    case 'float': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`${entry.key} must be a number`);
      return raw;
    }
    case 'list':
    case 'shellArgs': {
      if (!Array.isArray(raw) || !raw.every((s) => typeof s === 'string')) {
        throw new Error(`${entry.key} must be an array of strings`);
      }
      return raw;
    }
  }
}
