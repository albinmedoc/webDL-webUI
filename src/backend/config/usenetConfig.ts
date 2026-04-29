export interface UsenetConfig {
  enabled: boolean;
  host: string;
  port: number;
  ssl: boolean;
  user: string;
  pass: string;
  connections: number;
  groups: string[];
  par2Percent: number;
  rarSizeMb: number;
  maxConcurrent: number;
  minFreeDiskMultiplier: number;
  subjectTemplate: string;
  nfoPath: string | null;
  nyuuExtraArgs: string[];
  releaseGroup: string;
  releaseNameTemplate: string;
}

export interface IndexerConfig {
  hookScript: string | null;
  nzbOutputDir: string;
  // Days to keep NZB files on disk before the retention sweeper deletes them.
  // 0 (the default) keeps them forever.
  nzbRetentionDays: number;
}

const DEFAULT_SUBJECT_TEMPLATE = '[{filename}] - "{rarname}" yEnc ({part}/{total})';
const DEFAULT_RELEASE_NAME_TEMPLATE = '{show}.S{season}E{episode}.{quality}.WEB-DL.h264-{group}';
const DEFAULT_RELEASE_GROUP = 'SVTDL';

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

function parseInt10(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatSafe(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value === '') return fallback;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseShellArgs(value: string | undefined): string[] {
  if (!value) return [];
  return value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((s) =>
    s.replace(/^['"]|['"]$/g, '')
  ) ?? [];
}

export const usenetConfig: UsenetConfig = {
  enabled: parseBool(process.env.USENET_ENABLED, false),
  host: process.env.USENET_HOST ?? '',
  port: parseInt10(process.env.USENET_PORT, 563),
  ssl: parseBool(process.env.USENET_SSL, true),
  user: process.env.USENET_USER ?? '',
  pass: process.env.USENET_PASS ?? '',
  connections: parseInt10(process.env.USENET_CONNECTIONS, 20),
  groups: parseList(process.env.USENET_GROUPS, ['alt.binaries.boneless']),
  par2Percent: parseInt10(process.env.USENET_PAR2_PERCENT, 10),
  rarSizeMb: parseInt10(process.env.USENET_RAR_SIZE_MB, 50),
  maxConcurrent: parseInt10(process.env.USENET_MAX_CONCURRENT, 2),
  minFreeDiskMultiplier: parseFloatSafe(process.env.USENET_MIN_FREE_DISK_MULTIPLIER, 3),
  subjectTemplate: process.env.USENET_SUBJECT_TEMPLATE ?? DEFAULT_SUBJECT_TEMPLATE,
  nfoPath: process.env.USENET_NFO_PATH || null,
  nyuuExtraArgs: parseShellArgs(process.env.USENET_NYUU_EXTRA_ARGS),
  releaseGroup: process.env.USENET_RELEASE_GROUP || DEFAULT_RELEASE_GROUP,
  releaseNameTemplate: process.env.USENET_RELEASE_NAME_TEMPLATE || DEFAULT_RELEASE_NAME_TEMPLATE,
};

export const indexerConfig: IndexerConfig = {
  hookScript: process.env.INDEXER_HOOK_SCRIPT || null,
  nzbOutputDir: process.env.NZB_OUTPUT_DIR ?? './data/nzb',
  nzbRetentionDays: Math.max(0, parseInt10(process.env.NZB_RETENTION_DAYS, 0)),
};

export interface UsenetConfigPublic {
  enabled: boolean;
  host: string;
  port: number;
  ssl: boolean;
  user: string;
  passSet: boolean;
  connections: number;
  groups: string[];
  par2Percent: number;
  rarSizeMb: number;
  maxConcurrent: number;
  minFreeDiskMultiplier: number;
  subjectTemplate: string;
  nfoPath: string | null;
  nyuuExtraArgs: string[];
  indexer: {
    hookScriptSet: boolean;
    nzbOutputDir: string;
  };
}

export function getPublicConfig(): UsenetConfigPublic {
  return {
    enabled: usenetConfig.enabled,
    host: usenetConfig.host,
    port: usenetConfig.port,
    ssl: usenetConfig.ssl,
    user: usenetConfig.user,
    passSet: usenetConfig.pass.length > 0,
    connections: usenetConfig.connections,
    groups: usenetConfig.groups,
    par2Percent: usenetConfig.par2Percent,
    rarSizeMb: usenetConfig.rarSizeMb,
    maxConcurrent: usenetConfig.maxConcurrent,
    minFreeDiskMultiplier: usenetConfig.minFreeDiskMultiplier,
    subjectTemplate: usenetConfig.subjectTemplate,
    nfoPath: usenetConfig.nfoPath,
    nyuuExtraArgs: usenetConfig.nyuuExtraArgs,
    indexer: {
      hookScriptSet: indexerConfig.hookScript !== null,
      nzbOutputDir: indexerConfig.nzbOutputDir,
    },
  };
}
