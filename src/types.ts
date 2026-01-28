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
  auctionScore?: number; // Click Auction taps (may differ from clicks after Fastest Finger)
}

export interface Winner extends Player {
  id: string;
}

export interface GameState {
  status: 'waiting' | 'auction_countdown' | 'auction' | 'fastestFinger_countdown' | 'fastestFinger_tap' | 'finished';
  players: Record<string, Player>;
  auctionDuration: number;
  countdownDuration: number;
  timeRemaining: number;
  winner: Winner | null;
  winnerAd: string | null;
  round: number;
  finalLeaderboard: LeaderboardEntry[];
  auctionScores: Record<string, number>;
  fastestFingerStartTime: number | null;
  fastestFingerCountdownDuration: number;
}


