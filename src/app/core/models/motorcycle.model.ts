export type MotorcycleStyle = 'Naked' | 'Street' | 'Trail' | 'Sport' | 'Touring';

export type MatchStatus = 'correct' | 'incorrect';
export type NumericMatchStatus = 'correct' | 'higher' | 'lower';

export interface Motorcycle {
  id: string;
  manufacturer: string;
  model: string;
  displacementCc: number;
  weightKg: number;
  style: MotorcycleStyle;
  fipePrice: string;
  topSpeedKmh: number;
}

export interface GuessComparison {
  motorcycle: Motorcycle;
  manufacturerStatus: MatchStatus;
  modelStatus: MatchStatus;
  displacementStatus: NumericMatchStatus;
  weightStatus: NumericMatchStatus;
  styleStatus: MatchStatus;
  isCorrect: boolean;
}

export interface ScoreBreakdown {
  guessPoints: number;
  timeBonus: number;
  hintBonus: number;
  totalPoints: number;
}

export type RoundStatus = 'playing' | 'won' | 'lost';

export interface RoundState {
  target: Motorcycle;
  guesses: GuessComparison[];
  status: RoundStatus;
  fipeHintUsed: boolean;
  topSpeedHintUsed: boolean;
  startedAtMs: number;
  elapsedSeconds: number;
  scoreBreakdown: ScoreBreakdown | null;
}

export interface PilotRankingEntry {
  position: number;
  name: string;
  teamName: string;
  points: number;
  isCurrentUser: boolean;
}

export interface TeamRankingEntry {
  position: number;
  teamId: number;
  name: string;
  manufacturer: string;
  members: number;
  points: number;
  isCurrentTeam: boolean;
}
