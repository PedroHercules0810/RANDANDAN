import { Injectable, inject } from '@angular/core';
import { GameMode, Score } from '../models/score.model';
import { AuthService } from './auth.service';

const SCORES_STORAGE_KEY = 'randandan_scores';
const GUEST_SESSION_SCORES_KEY = 'randandan_guest_scores';

@Injectable({ providedIn: 'root' })
export class ScoreService {
  private readonly authService = inject(AuthService);

  /**
   * Registra a pontuação da partida.
   * - Autenticado: gravação persistente, entra em ranking geral.
   * - Convidado: gravação apenas na sessão local (não entra em ranking).
   */
  recordScore(params: {
    guessCount: number;
    timeBonus: number;
    hintsUsed: number;
    totalPoints: number;
    mode: GameMode;
  }): Score {
    const state = this.authService.authState();
    const score: Score = {
      userId: state.status === 'authenticated' ? state.user!.id : null,
      date: new Date().toISOString(),
      ...params,
    };

    if (state.status === 'authenticated') {
      this.persist(SCORES_STORAGE_KEY, score);
    } else {
      this.persist(GUEST_SESSION_SCORES_KEY, score, { replace: true });
    }

    return score;
  }

  getPersistedScores(): Score[] {
    const state = this.authService.authState();
    if (state.status !== 'authenticated') {
      return [];
    }

    return this.readScores(SCORES_STORAGE_KEY).filter((s) => s.userId === state.user!.id);
  }

  canJoinRanking(): boolean {
    return this.authService.authState().status === 'authenticated';
  }

  private persist(key: string, score: Score, options?: { replace: boolean }): void {
    const scores = options?.replace ? [score] : [...this.readScores(key), score];
    localStorage.setItem(key, JSON.stringify(scores));
  }

  private readScores(key: string): Score[] {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Score[]) : [];
  }
}
