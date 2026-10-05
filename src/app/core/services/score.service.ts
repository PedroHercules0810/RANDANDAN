import { Injectable, inject } from '@angular/core';
import { GameMode, Score } from '../models/score.model';
import { User } from '../models/user.model';
import { AuthService } from './auth.service';

/**
 * Chave de persistência das pontuações por usuário, no formato
 * `randandan_scores_<sub-do-cognito>`. Sem backend de banco de dados,
 * o histórico fica salvo por usuário no próprio dispositivo.
 */
const SCORES_STORAGE_PREFIX = 'randandan_scores_';

@Injectable({ providedIn: 'root' })
export class ScoreService {
  private readonly authService = inject(AuthService);

  /** Registra a pontuação de uma partida do usuário autenticado. */
  recordScore(params: {
    guessCount: number;
    timeBonus: number;
    hintsUsed: number;
    totalPoints: number;
    mode: GameMode;
  }): Score {
    const user = this.requireAuthenticatedUser();

    const score: Score = {
      userId: user.id,
      date: new Date().toISOString(),
      ...params,
    };

    this.persistScores(SCORES_STORAGE_PREFIX + user.id, [
      ...this.readScores(SCORES_STORAGE_PREFIX + user.id),
      score,
    ]);

    return score;
  }

  /** Histórico de pontuações do usuário autenticado. */
  getPersistedScores(): Score[] {
    const user = this.authService.authState().user;
    if (!user) {
      return [];
    }

    return this.readScores(SCORES_STORAGE_PREFIX + user.id);
  }

  /** Apenas usuários autenticados no Cognito entram no ranking. */
  canJoinRanking(): boolean {
    return this.authService.authState().status === 'authenticated';
  }

  private requireAuthenticatedUser(): User {
    const state = this.authService.authState();
    if (state.status !== 'authenticated' || !state.user) {
      throw new Error('Apenas contas autenticadas podem registrar pontuação.');
    }

    return state.user;
  }

  private persistScores(key: string, scores: Score[]): void {
    localStorage.setItem(key, JSON.stringify(scores));
  }

  private readScores(key: string): Score[] {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Score[]) : [];
  }
}
