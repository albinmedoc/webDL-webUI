import type { Config } from 'drizzle-kit';

export default {
  schema: './src/backend/db/schema.ts',
  out: './src/backend/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_PATH ?? './data/svtplay-dl-webui.db',
  },
} satisfies Config;
