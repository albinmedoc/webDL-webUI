import { ServerConfig } from '../types/index.js';

export const config: ServerConfig = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
};
