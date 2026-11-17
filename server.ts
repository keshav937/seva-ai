import 'dotenv/config';
import cookieParser from 'cookie-parser';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { initializeDatabase } from './server/db.ts';
import { setupWebSocketServer } from './server/realtime.ts';
import { authRouter } from './server/routes/auth.ts';
import { governanceRouter } from './server/routes/governance.ts';
import { medicalRouter } from './server/routes/medical.ts';
import { placesRouter } from './server/routes/places.ts';
import { reportsRouter } from './server/routes/reports.ts';
import { sevaShieldRouter } from './server/routes/sevaShield.ts';

initializeDatabase();

const app = express();
app.set('trust proxy', 1);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(cookieParser());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'SEVA AI', timestamp: new Date().toISOString() });
});

// Mount API routes
app.use('/api/auth', authRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/seva-shield', sevaShieldRouter);
app.use('/api/medical', medicalRouter);
app.use('/api/places', placesRouter);
app.use('/api', governanceRouter);

// Global API error handler (ensures Multer & validation errors return clean JSON)
app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err?.status || (err?.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  const message =
    err?.code === 'LIMIT_FILE_SIZE'
      ? 'Uploaded file exceeds maximum allowed size (10 MB for photos, 50 MB for video).'
      : err?.message || 'Internal server error.';
  res.status(status).json({ error: message });
});

const server = http.createServer(app);
setupWebSocketServer(server);

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SEVA AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start SEVA AI server:', err);
  process.exit(1);
});
