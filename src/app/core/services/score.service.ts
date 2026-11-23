import { Injectable, inject, signal } from '@angular/core';
import { GameMode, Score } from '../models/score.model';
import { User } from '../models/user.model';
import { AuthService } from './auth.service';

const SCORES_STORAGE_PREFIX = 'randandan_scores_';

@Injectable({ providedIn: 'root' })
export class ScoreService {
  private readonly authService = inject(AuthService);
  private readonly remoteScoresSignal = signal<Score[] | null>(null);
  private onScoreRecordedCallback: ((score: Score) => void) | null = null;

  /** Registra callback usado pelo ProfileImageService para sincronizar novas pontuações no DynamoDB. */
  registerDynamoSyncCallback(cb: (score: Score) => void): void {
    this.onScoreRecordedCallback = cb;
  }

  /** Atualiza o histórico local com os scores vindos do DynamoDB. */
  hydrateFromDynamoDB(scores: Score[]): void {
    const user = this.authService.authState().user;
    this.remoteScoresSignal.set(scores);
    if (user && scores.length > 0) {
      this.persistScores(SCORES_STORAGE_PREFIX + user.id, scores);
    }
  }

  /** Registra a pontuação de uma partida do usuário autenticado (localStorage + DynamoDB). */
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

    const updated = [...this.getPersistedScores(), score];
    this.remoteScoresSignal.set(updated);
    this.persistScores(SCORES_STORAGE_PREFIX + user.id, updated);

    if (this.onScoreRecordedCallback) {
      this.onScoreRecordedCallback(score);
    }

    return score;
  }

  /** Histórico de pontuações do usuário autenticado (hidratado pelo DynamoDB). */
  getPersistedScores(): Score[] {
    const user = this.authService.authState().user;
    if (!user) {
      return [];
    }

    const remote = this.remoteScoresSignal();
    const local = this.readScores(SCORES_STORAGE_PREFIX + user.id);

    if (remote && remote.length >= local.length) {
      return remote;
    }
    return local;
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
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
        localStorage.setItem(key, JSON.stringify(scores));
      }
    } catch {
      // Ignora caso localStorage não esteja disponível
    }
  }

  private readScores(key: string): Score[] {
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as Score[]) : [];
      }
    } catch {
      // Ignora caso localStorage não esteja disponível
    }
    return [];
  }
}
