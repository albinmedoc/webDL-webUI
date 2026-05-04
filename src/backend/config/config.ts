import path from 'path';

import { ServerConfig } from '../types/index.js';
import { REGISTRY, parseValue } from './registry.js';

export const config: ServerConfig = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
  downloadOutputDir: path.resolve(
    parseValue(REGISTRY.downloadOutputDir, process.env[REGISTRY.downloadOutputDir.envVar]) as string,
  ),
  uploadWatchDir: path.resolve(
    parseValue(REGISTRY.uploadWatchDir, process.env[REGISTRY.uploadWatchDir.envVar]) as string,
  ),
  svtplaydlFilenameTemplate: parseValue(
    REGISTRY.svtplaydlFilenameTemplate,
    process.env[REGISTRY.svtplaydlFilenameTemplate.envVar],
  ) as string,
  svtplaydlProxy: parseValue(
    REGISTRY.svtplaydlProxy,
    process.env[REGISTRY.svtplaydlProxy.envVar],
  ) as string,
  seasonPackSkipLatest: parseValue(
    REGISTRY.seasonPackSkipLatest,
    process.env[REGISTRY.seasonPackSkipLatest.envVar],
  ) as boolean,
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
};
