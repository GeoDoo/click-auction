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
  reactionTime?: number | null;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  clicks: number;
  color: string;
  suspicious: boolean;
  reactionTime: number | null;
  finalScore: number;
}

export interface Winner extends Player {
  id: string;
}

export interface GameState {
  status: 'waiting' | 'countdown' | 'bidding' | 'stage2_countdown' | 'stage2_tap' | 'finished';
  players: Record<string, Player>;
  auctionDuration: number;
  countdownDuration: number;
  timeRemaining: number;
  winner: Winner | null;
  winnerAd: string | null;
  round: number;
  finalLeaderboard: LeaderboardEntry[];
  stage1Scores: Record<string, number>;
  stage2StartTime: number | null;
  stage2CountdownDuration: number;
}


