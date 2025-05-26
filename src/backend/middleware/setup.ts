import cors from 'cors';
import express, { Application, Request, Response } from 'express';
import path from 'path';

export function setupMiddleware(app: Application, rootDir: string): void {
  // CORS middleware
  app.use(cors());
  
  // JSON parsing middleware
  app.use(express.json());
  
  // Static file serving middleware
  app.use(express.static(path.join(rootDir, 'dist')));
}

export function setupRoutes(app: Application, rootDir: string): void {
  // Serve the frontend for all routes (SPA fallback)
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(rootDir, 'dist', 'index.html'));
  });
}
