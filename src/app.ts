import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import * as middleware from './middleware';
import routes from './routes';
import Logger from './logger';

const app = express();

// Trust proxy
app.set('trust proxy', 1);

// CORS
app.use(cors());

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https://api.qrserver.com'],
      connectSrc: ["'self'", 'wss:', 'ws:'],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: false,
}));

// Compression
app.use(compression());

// Request logging
app.use(middleware.requestLogger());

// Caching headers
app.use(middleware.cacheControl({ maxAge: 3600 }));

// JSON body parser (before routes)
app.use(express.json());

// Routes
app.use(routes);

// Static files
const publicDir = path.join(process.cwd(), 'public');
app.use(express.static(publicDir));

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  Logger.error('Express error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;

