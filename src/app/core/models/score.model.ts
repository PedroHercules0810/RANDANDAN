export type GameMode = 'daily' | 'infinite';

export interface Score {
  userId: string | null;
  guessCount: number;
  timeBonus: number;
  hintsUsed: number;
  totalPoints: number;
  mode: GameMode;
  date: string;
}
