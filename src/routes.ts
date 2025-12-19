import { Router, Request, Response } from 'express';
import path from 'path';
import os from 'os';
import config from './config';
import * as auth from './auth';
import * as persistence from './persistence';
import { gameState } from './game';
import Logger from './logger';

const router = Router();
const publicDir = path.join(process.cwd(), 'public');

function getLocalIP(): string | null {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    const netList = nets[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal && net.address.startsWith('192.168.')) {
        return net.address;
      }
    }
  }
  for (const name of Object.keys(nets)) {
    const netList = nets[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

// Health check
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    players: Object.keys(gameState.players).length,
    round: gameState.round,
  });
});

// API config
router.get('/api/config', (req: Request, res: Response) => {
  const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
  const isLocal = host.includes('localhost') || /^127\./.test(host) || /^\d+\.\d+\.\d+\.\d+:\d+$/.test(host);

  let baseUrl: string;
  if (isLocal) {
    const localIP = getLocalIP();
    const port = host.split(':')[1] || config.PORT;
    baseUrl = localIP ? `http://${localIP}:${port}` : `${protocol}://${host}`;
  } else {
    baseUrl = `${protocol}://${host}`;
  }

  res.json({ baseUrl, mode: isLocal ? 'local' : 'production' });
});

// Pages
router.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'display.html'));
});

router.get('/play', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'play.html'));
});

router.get('/host', (req: Request, res: Response): void => {
  if (!config.HOST_PIN) {
    res.sendFile(path.join(publicDir, 'host.html'));
    return;
  }

  const cookieHeader = req.headers.cookie || '';
  const authToken = (req.query.auth as string) || cookieHeader.match(/hostAuth=([^;]+)/)?.[1];

  Logger.debug(`Host access attempt - token: ${authToken ? 'found' : 'missing'}`);

  if (auth.isValidHostAuthToken(authToken)) {
    Logger.debug('Host token valid, serving host.html');
    res.sendFile(path.join(publicDir, 'host.html'));
    return;
  }

  Logger.debug('Host token invalid or missing, redirecting to login');
  res.redirect('/host-login');
});

router.get('/host-login', (_req: Request, res: Response): void => {
  if (!config.HOST_PIN) {
    res.redirect('/host');
    return;
  }
  res.sendFile(path.join(publicDir, 'host-login.html'));
});

// API auth
router.post('/api/host/auth', (req: Request, res: Response): void => {
  const { pin } = req.body;
  const result = auth.verifyPinAndCreateToken(pin);

  if (!result.success) {
    Logger.security('Invalid host PIN attempt', req.ip || 'unknown');
    res.status(401).json(result);
    return;
  }

  Logger.info('Host authenticated');
  res.json(result);
});

// API stats
router.get('/api/stats', (_req: Request, res: Response) => {
  res.json({
    allTime: persistence.getAllTimeLeaderboard(),
    totalRounds: gameState.round,
    totalPlayers: persistence.getStats() ? Object.keys(persistence.getStats()).length : 0,
  });
});

export default router;
export { getLocalIP };

