import { REGISTRY, parseValue, type RegistryKey } from './registry.js';

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
  allowedExtensions: string[];
  subjectTemplate: string;
  posterFrom: string;
  nfoPath: string;
  nyuuExtraArgs: string[];
  releaseGroup: string;
  releaseNameTemplate: string;
  workDir: string;
}

export interface IndexerConfig {
  hookScript: string;
  nzbOutputDir: string;
  nzbRetentionDays: number;
}

function fromEnv<K extends RegistryKey>(key: K): unknown {
  return parseValue(REGISTRY[key], process.env[REGISTRY[key].envVar]);
}

export const usenetConfig: UsenetConfig = {
  enabled: fromEnv('enabled') as boolean,
  host: fromEnv('host') as string,
  port: fromEnv('port') as number,
  ssl: fromEnv('ssl') as boolean,
  user: fromEnv('user') as string,
  pass: fromEnv('pass') as string,
  connections: fromEnv('connections') as number,
  groups: fromEnv('groups') as string[],
  par2Percent: fromEnv('par2Percent') as number,
  rarSizeMb: fromEnv('rarSizeMb') as number,
  maxConcurrent: fromEnv('maxConcurrent') as number,
  minFreeDiskMultiplier: fromEnv('minFreeDiskMultiplier') as number,
  allowedExtensions: fromEnv('allowedExtensions') as string[],
  subjectTemplate: fromEnv('subjectTemplate') as string,
  posterFrom: fromEnv('posterFrom') as string,
  nfoPath: fromEnv('nfoPath') as string,
  nyuuExtraArgs: fromEnv('nyuuExtraArgs') as string[],
  releaseGroup: fromEnv('releaseGroup') as string,
  releaseNameTemplate: fromEnv('releaseNameTemplate') as string,
  workDir: fromEnv('workDir') as string,
};

export const indexerConfig: IndexerConfig = {
  hookScript: fromEnv('hookScript') as string,
  nzbOutputDir: fromEnv('nzbOutputDir') as string,
  nzbRetentionDays: Math.max(0, fromEnv('nzbRetentionDays') as number),
};

/**
 * Map a registry key to the singleton object + property it lives on. Used by
 * the settings service to mutate the live config in place.
 */
export type ConfigTarget =
  | { obj: UsenetConfig; prop: keyof UsenetConfig }
  | { obj: IndexerConfig; prop: keyof IndexerConfig };

export function targetFor(key: RegistryKey): ConfigTarget {
  switch (key) {
    case 'hookScript':
    case 'nzbOutputDir':
    case 'nzbRetentionDays':
      return { obj: indexerConfig, prop: key };
    case 'downloadOutputDir':
      throw new Error('downloadOutputDir lives on serverConfig, not usenetConfig');
    case 'uploadWatchDir':
      throw new Error('uploadWatchDir lives on serverConfig, not usenetConfig');
    default:
      return { obj: usenetConfig, prop: key as keyof UsenetConfig };
  }
}

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
  allowedExtensions: string[];
  subjectTemplate: string;
  posterFrom: string;
  nfoPath: string;
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
    allowedExtensions: usenetConfig.allowedExtensions,
    subjectTemplate: usenetConfig.subjectTemplate,
    posterFrom: usenetConfig.posterFrom,
    nfoPath: usenetConfig.nfoPath,
    nyuuExtraArgs: usenetConfig.nyuuExtraArgs,
    indexer: {
      hookScriptSet: indexerConfig.hookScript.length > 0,
      nzbOutputDir: indexerConfig.nzbOutputDir,
    },
  };
}
