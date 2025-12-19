import { Socket } from 'socket.io';

export interface CustomSocket extends Socket {
  clientIP?: string;
}

export interface Player {
  name: string;
  clicks: number;
  color: string;
  adContent: string;
  suspicious?: boolean;
  suspicionReason?: string | null;
  disconnectedRound?: number;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  clicks: number;
  color: string;
  suspicious: boolean;
}

export interface Winner extends Player {
  id: string;
}

export interface GameState {
  status: 'waiting' | 'countdown' | 'bidding' | 'finished';
  players: Record<string, Player>;
  auctionDuration: number;
  countdownDuration: number;
  timeRemaining: number;
  winner: Winner | null;
  winnerAd: string | null;
  round: number;
  finalLeaderboard: LeaderboardEntry[];
}


