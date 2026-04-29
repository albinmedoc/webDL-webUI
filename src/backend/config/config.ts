import path from 'path';

import { ServerConfig } from '../types/index.js';

const DEFAULT_DOWNLOAD_OUTPUT_DIR = '/app/downloads';

export const config: ServerConfig = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
  downloadOutputDir: path.resolve(
    process.env.DOWNLOAD_OUTPUT_DIR || DEFAULT_DOWNLOAD_OUTPUT_DIR,
  ),
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
};
