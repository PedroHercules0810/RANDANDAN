import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  GuessComparison,
  Motorcycle,
  NumericMatchStatus,
  PilotRankingEntry,
  RoundState,
  RoundStatus,
  ScoreBreakdown,
  TeamRankingEntry,
} from '../models/motorcycle.model';
import { GameMode } from '../models/score.model';
import { AuthService } from './auth.service';
import { MotorcycleService } from './motorcycle.service';
import { ScoreService } from './score.service';
import { TeamService } from './team.service';

export const MAX_ATTEMPTS = 6;

const DAILY_STORAGE_PREFIX = 'randandan_daily_v1_';
const INFINITE_STREAK_KEY = 'randandan_infinite_streak_v1_';
const INFINITE_BEST_STREAK_KEY = 'randandan_infinite_best_streak_v1_';

interface PersistedDailyRound {
  dateKey: string;
  targetId: string;
  guessIds: string[];
  status: 'playing' | 'won' | 'lost';
  fipeHintUsed: boolean;
  topSpeedHintUsed: boolean;
  aiChatUsed?: boolean;
  startedAtMs: number;
  elapsedSeconds: number;
  scoreBreakdown: ScoreBreakdown | null;
}

@Injectable({ providedIn: 'root' })
export class GameService {
  private readonly motorcycleService = inject(MotorcycleService);
  private readonly scoreService = inject(ScoreService);
  private readonly teamService = inject(TeamService);
  private readonly authService = inject(AuthService);

  private readonly dailyRoundState = signal<RoundState>(this.createInitialDailyRound());
  private readonly infiniteRoundState = signal<RoundState>(this.createFreshInfiniteRound());

  private readonly currentInfiniteStreak = signal<number>(0);
  private readonly recordInfiniteStreak = signal<number>(0);

  readonly dailyRound = computed(() => this.dailyRoundState());
  readonly infiniteRound = computed(() => this.infiniteRoundState());
  readonly infiniteStreak = computed(() => this.currentInfiniteStreak());
  readonly bestInfiniteStreak = computed(() => this.recordInfiniteStreak());

  constructor() {
    this.loadStreaksFromStorage();

    // Recarrega o progresso diário e streaks quando o estado de autenticação muda
    effect(() => {
      this.authService.authState();
      this.dailyRoundState.set(this.loadOrCreateDailyRound());
      this.loadStreaksFromStorage();
    });
  }

  /** Retorna o estado da rodada do modo selecionado. */
  getRound(mode: GameMode): RoundState {
    return mode === 'daily' ? this.dailyRoundState() : this.infiniteRoundState();
  }

  /** Compara uma motocicleta chutada com a motocicleta secreta. */
  compareGuess(guess: Motorcycle, target: Motorcycle): GuessComparison {
    const isCorrect = guess.id === target.id;

    return {
      motorcycle: guess,
      manufacturerStatus:
        guess.manufacturer.toLowerCase() === target.manufacturer.toLowerCase()
          ? 'correct'
          : 'incorrect',
      modelStatus: isCorrect ? 'correct' : 'incorrect',
      displacementStatus: this.compareNumbers(guess.displacementCc, target.displacementCc),
      weightStatus: this.compareNumbers(guess.weightKg, target.weightKg),
      styleStatus: guess.style === target.style ? 'correct' : 'incorrect',
      isCorrect,
    };
  }

  /**
   * Calcula a pontuação final da partida conforme as regras oficiais:
   * - Palpites: 1=1000, 2=800, 3=600, 4=400, 5=200, 6=0
   * - Bônus de tempo: até 300 pts (300 - segundos decorridos)
   * - Dicas usadas: 0=+200, 1=+0, 2=-200
   * - Se o Chat com IA (Gemini) foi usado na rodada, a pontuação final é ZERADA (0 pts).
   */
  calculateScore(params: {
    guessCount: number;
    elapsedSeconds: number;
    hintsUsed: number;
    won: boolean;
    aiChatUsed?: boolean;
  }): ScoreBreakdown {
    if (!params.won || params.aiChatUsed) {
      return {
        guessPoints: 0,
        timeBonus: 0,
        hintBonus: 0,
        totalPoints: 0,
        aiChatUsed: Boolean(params.aiChatUsed),
      };
    }

    const guessPointsMap: Record<number, number> = {
      1: 1000,
      2: 800,
      3: 600,
      4: 400,
      5: 200,
      6: 0,
    };

    const guessPoints = guessPointsMap[params.guessCount] ?? 0;
    const clampedSeconds = Math.max(0, Math.floor(params.elapsedSeconds));
    const timeBonus = Math.max(0, 300 - clampedSeconds);

    let hintBonus = 200;
    if (params.hintsUsed === 1) {
      hintBonus = 0;
    } else if (params.hintsUsed >= 2) {
      hintBonus = -200;
    }

    const totalPoints = Math.max(0, guessPoints + timeBonus + hintBonus);

    return {
      guessPoints,
      timeBonus,
      hintBonus,
      totalPoints,
      aiChatUsed: false,
    };
  }

  /** Registra um palpite no modo informado (`daily` ou `infinite`). */
  submitGuess(mode: GameMode, motorcycleId: string, nowMs: number = Date.now()): GuessComparison {
    const current = this.getRound(mode);

    if (current.status !== 'playing') {
      throw new Error('Esta partida já foi encerrada.');
    }

    if (current.guesses.some((g) => g.motorcycle.id === motorcycleId)) {
      throw new Error('Você já chutou esta moto nesta partida.');
    }

    const guessedMoto = this.motorcycleService.findById(motorcycleId);
    if (!guessedMoto) {
      throw new Error('Motocicleta não encontrada no catálogo.');
    }

    const comparison = this.compareGuess(guessedMoto, current.target);
    const updatedGuesses = [...current.guesses, comparison];
    const elapsedSeconds = Math.max(0, Math.floor((nowMs - current.startedAtMs) / 1000));
    const hintsUsed = (current.fipeHintUsed ? 1 : 0) + (current.topSpeedHintUsed ? 1 : 0);

    let status: RoundStatus = current.status;
    let scoreBreakdown = current.scoreBreakdown;

    if (comparison.isCorrect) {
      status = 'won';
      scoreBreakdown = this.calculateScore({
        guessCount: updatedGuesses.length,
        elapsedSeconds,
        hintsUsed,
        won: true,
        aiChatUsed: current.aiChatUsed,
      });
    } else if (updatedGuesses.length >= MAX_ATTEMPTS) {
      status = 'lost';
      scoreBreakdown = this.calculateScore({
        guessCount: updatedGuesses.length,
        elapsedSeconds,
        hintsUsed,
        won: false,
        aiChatUsed: current.aiChatUsed,
      });
    }

    const nextState: RoundState = {
      ...current,
      guesses: updatedGuesses,
      status,
      elapsedSeconds,
      scoreBreakdown,
    };

    this.setRound(mode, nextState);

    if (status === 'won' && scoreBreakdown) {
      this.onRoundWon(mode, updatedGuesses.length, hintsUsed, scoreBreakdown);
    } else if (status === 'lost' && mode === 'infinite') {
      this.updateInfiniteStreak(0);
    }

    return comparison;
  }

  /** Revela a dica de preço FIPE (1x por partida). */
  useFipeHint(mode: GameMode): void {
    const current = this.getRound(mode);
    if (current.status !== 'playing' || current.fipeHintUsed) {
      return;
    }

    this.setRound(mode, {
      ...current,
      fipeHintUsed: true,
    });
  }

  /** Revela a dica de velocidade máxima (1x por partida). */
  useTopSpeedHint(mode: GameMode): void {
    const current = this.getRound(mode);
    if (current.status !== 'playing' || current.topSpeedHintUsed) {
      return;
    }

    this.setRound(mode, {
      ...current,
      topSpeedHintUsed: true,
    });
  }

  /**
   * Marca que o jogador utilizou o Chat de Dicas com IA (Gemini) nesta rodada,
   * zerando imediatamente a pontuação da partida atual.
   */
  markAiChatUsed(mode: GameMode): void {
    const current = this.getRound(mode);
    if (current.aiChatUsed) {
      return;
    }

    const zeroedBreakdown: ScoreBreakdown | null = current.scoreBreakdown
      ? {
          guessPoints: 0,
          timeBonus: 0,
          hintBonus: 0,
          totalPoints: 0,
          aiChatUsed: true,
        }
      : null;

    this.setRound(mode, {
      ...current,
      aiChatUsed: true,
      scoreBreakdown: zeroedBreakdown,
    });
  }

  /** Inicia uma nova partida no Modo Infinito sorteando outra moto. */
  startNextInfiniteRound(): RoundState {
    const previousId = this.infiniteRoundState().target.id;
    const nextRound = this.createFreshInfiniteRound(new Set([previousId]));
    this.infiniteRoundState.set(nextRound);
    return nextRound;
  }

  /** Atualiza o tempo decorrido da partida em andamento. */
  tickElapsed(mode: GameMode, nowMs: number = Date.now()): void {
    const current = this.getRound(mode);
    if (current.status !== 'playing') {
      return;
    }

    const elapsedSeconds = Math.max(0, Math.floor((nowMs - current.startedAtMs) / 1000));
    if (elapsedSeconds !== current.elapsedSeconds) {
      if (mode === 'daily') {
        this.dailyRoundState.set({ ...current, elapsedSeconds });
      } else {
        this.infiniteRoundState.set({ ...current, elapsedSeconds });
      }
    }
  }

  /**
   * Gera o texto de compartilhamento sem spoilers (com blocos visuais).
   */
  buildShareText(mode: GameMode): string {
    const round = this.getRound(mode);
    const dateLabel = this.motorcycleService.getFormattedBrasiliaDate();
    const modeLabel = mode === 'daily' ? `Desafio Diário (${dateLabel})` : 'Modo Infinito';
    const attemptsLabel =
      round.status === 'won' ? `${round.guesses.length}/${MAX_ATTEMPTS}` : `X/${MAX_ATTEMPTS}`;
    const hintsUsed = (round.fipeHintUsed ? 1 : 0) + (round.topSpeedHintUsed ? 1 : 0);
    const timeLabel = this.formatDuration(round.elapsedSeconds);
    const points = round.scoreBreakdown?.totalPoints ?? 0;

    const rows = round.guesses.map((guess) => {
      const cells = [
        guess.manufacturerStatus === 'correct' ? '🟩' : '⬛',
        guess.modelStatus === 'correct' ? '🟩' : '⬛',
        guess.displacementStatus === 'correct'
          ? '🟩'
          : guess.displacementStatus === 'higher'
            ? '🔼'
            : '🔽',
        guess.weightStatus === 'correct' ? '🟩' : guess.weightStatus === 'higher' ? '🔼' : '🔽',
        guess.styleStatus === 'correct' ? '🟩' : '⬛',
      ];
      return cells.join('');
    });

    return [
      `🏍️ RANDANDAN — ${modeLabel}`,
      `🎯 Tentativas: ${attemptsLabel} • 💡 Dicas: ${hintsUsed} • ⏱️ ${timeLabel} • 🏆 ${points} pts`,
      '',
      ...rows,
      '',
      'Consegue acertar a moto secreta? #Randandan',
    ].join('\n');
  }

  /** Ranking geral de pilotos combinando a pontuação do jogador autenticado. */
  getPilotRankings(): PilotRankingEntry[] {
    const basePilots: Array<{ name: string; teamName: string; points: number; isCurrentUser: boolean }> =
      [
        { name: 'MotoMaster_BR', teamName: 'Honda Racing', points: 4250, isCurrentUser: false },
        { name: 'ApexRider99', teamName: 'Yamaha Blue', points: 3980, isCurrentUser: false },
        { name: 'KawaNinja_ZX', teamName: 'Kawasaki Green', points: 3640, isCurrentUser: false },
        { name: 'BoxerGS_1250', teamName: 'BMW Motorrad', points: 3310, isCurrentUser: false },
        { name: 'HayabusaKing', teamName: 'Suzuki Blue', points: 2890, isCurrentUser: false },
        { name: 'DesmoV4_SP', teamName: 'Ducati Corse', points: 2450, isCurrentUser: false },
      ];

    const authUser = this.authService.authState().user;
    if (authUser) {
      const userScores = this.scoreService.getPersistedScores();
      const totalUserPoints = userScores.reduce((acc, s) => acc + s.totalPoints, 0);
      const currentTeam = this.teamService.getCurrentTeam();

      basePilots.push({
        name: `${authUser.displayName} (Você)`,
        teamName: currentTeam?.name ?? 'Sem Equipe',
        points: totalUserPoints,
        isCurrentUser: true,
      });
    }

    return basePilots
      .sort((a, b) => b.points - a.points)
      .map((entry, idx) => ({
        position: idx + 1,
        ...entry,
      }));
  }

  /** Ranking coletivo por equipes somando os pontos da equipe do jogador autenticado. */
  getTeamRankings(): TeamRankingEntry[] {
    const baseTeams: Record<number, { members: number; basePoints: number }> = {
      1: { members: 1247, basePoints: 18420 },
      2: { members: 1105, basePoints: 17190 },
      3: { members: 940, basePoints: 15840 },
      5: { members: 812, basePoints: 14620 },
      4: { members: 685, basePoints: 12950 },
      6: { members: 530, basePoints: 11400 },
      7: { members: 480, basePoints: 10250 },
      8: { members: 410, basePoints: 9380 },
    };

    const currentTeam = this.teamService.getCurrentTeam();
    const userPoints = this.scoreService
      .getPersistedScores()
      .reduce((acc, s) => acc + s.totalPoints, 0);

    const entries = this.teamService.listTeams().map((team) => {
      const stats = baseTeams[team.id] ?? { members: 150, basePoints: 5000 };
      const isCurrentTeam = currentTeam?.id === team.id;

      return {
        position: 0,
        teamId: team.id,
        name: team.name,
        manufacturer: team.manufacturer,
        members: stats.members + (isCurrentTeam ? 1 : 0),
        points: stats.basePoints + (isCurrentTeam ? userPoints : 0),
        isCurrentTeam,
      };
    });

    return entries
      .sort((a, b) => b.points - a.points)
      .map((entry, idx) => ({
        ...entry,
        position: idx + 1,
      }));
  }

  formatDuration(totalSeconds: number): string {
    const clamped = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(clamped / 60);
    const seconds = clamped % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  private compareNumbers(guessValue: number, targetValue: number): NumericMatchStatus {
    if (guessValue === targetValue) {
      return 'correct';
    }
    return guessValue > targetValue ? 'higher' : 'lower';
  }

  private setRound(mode: GameMode, nextState: RoundState): void {
    if (mode === 'daily') {
      this.dailyRoundState.set(nextState);
      this.persistDailyRound(nextState);
    } else {
      this.infiniteRoundState.set(nextState);
    }
  }

  private onRoundWon(
    mode: GameMode,
    guessCount: number,
    hintsUsed: number,
    breakdown: ScoreBreakdown,
  ): void {
    if (mode === 'infinite') {
      this.updateInfiniteStreak(this.currentInfiniteStreak() + 1);
    }

    if (this.scoreService.canJoinRanking()) {
      try {
        this.scoreService.recordScore({
          guessCount,
          timeBonus: breakdown.timeBonus,
          hintsUsed,
          totalPoints: breakdown.totalPoints,
          mode,
        });
      } catch {
        // Ignora caso não esteja autenticado
      }
    }
  }

  private createInitialDailyRound(): RoundState {
    return this.loadOrCreateDailyRound();
  }

  private loadOrCreateDailyRound(): RoundState {
    const dateKey = this.motorcycleService.getDailyDateKey();
    const target = this.motorcycleService.getDailyMotorcycle(dateKey);
    const persisted = this.readPersistedDailyRound(dateKey);

    if (persisted && persisted.targetId === target.id) {
      const guesses = persisted.guessIds
        .map((id) => this.motorcycleService.findById(id))
        .filter((m): m is Motorcycle => !!m)
        .map((moto) => this.compareGuess(moto, target));

      return {
        target,
        guesses,
        status: persisted.status,
        fipeHintUsed: persisted.fipeHintUsed,
        topSpeedHintUsed: persisted.topSpeedHintUsed,
        aiChatUsed: Boolean(persisted.aiChatUsed),
        startedAtMs: persisted.startedAtMs,
        elapsedSeconds: persisted.elapsedSeconds,
        scoreBreakdown: persisted.scoreBreakdown,
      };
    }

    return {
      target,
      guesses: [],
      status: 'playing',
      fipeHintUsed: false,
      topSpeedHintUsed: false,
      aiChatUsed: false,
      startedAtMs: Date.now(),
      elapsedSeconds: 0,
      scoreBreakdown: null,
    };
  }

  private createFreshInfiniteRound(excludeIds: ReadonlySet<string> = new Set()): RoundState {
    return {
      target: this.motorcycleService.getRandomMotorcycle(excludeIds),
      guesses: [],
      status: 'playing',
      fipeHintUsed: false,
      topSpeedHintUsed: false,
      aiChatUsed: false,
      startedAtMs: Date.now(),
      elapsedSeconds: 0,
      scoreBreakdown: null,
    };
  }

  private getStorageUserSuffix(): string {
    return this.authService.authState().user?.id ?? 'anon';
  }

  private persistDailyRound(round: RoundState): void {
    const dateKey = this.motorcycleService.getDailyDateKey();
    const key = `${DAILY_STORAGE_PREFIX}${this.getStorageUserSuffix()}_${dateKey}`;
    const payload: PersistedDailyRound = {
      dateKey,
      targetId: round.target.id,
      guessIds: round.guesses.map((g) => g.motorcycle.id),
      status: round.status,
      fipeHintUsed: round.fipeHintUsed,
      topSpeedHintUsed: round.topSpeedHintUsed,
      aiChatUsed: Boolean(round.aiChatUsed),
      startedAtMs: round.startedAtMs,
      elapsedSeconds: round.elapsedSeconds,
      scoreBreakdown: round.scoreBreakdown,
    };

    this.safeSetItem(key, JSON.stringify(payload));
  }

  private readPersistedDailyRound(dateKey: string): PersistedDailyRound | null {
    const key = `${DAILY_STORAGE_PREFIX}${this.getStorageUserSuffix()}_${dateKey}`;
    const raw = this.safeGetItem(key);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as PersistedDailyRound;
    } catch {
      return null;
    }
  }

  private loadStreaksFromStorage(): void {
    const suffix = this.getStorageUserSuffix();
    const streak = Number(this.safeGetItem(`${INFINITE_STREAK_KEY}${suffix}`) ?? 0);
    const best = Number(this.safeGetItem(`${INFINITE_BEST_STREAK_KEY}${suffix}`) ?? 0);
    this.currentInfiniteStreak.set(Number.isFinite(streak) ? streak : 0);
    this.recordInfiniteStreak.set(Number.isFinite(best) ? best : 0);
  }

  private updateInfiniteStreak(nextStreak: number): void {
    const suffix = this.getStorageUserSuffix();
    this.currentInfiniteStreak.set(nextStreak);
    this.safeSetItem(`${INFINITE_STREAK_KEY}${suffix}`, String(nextStreak));

    if (nextStreak > this.recordInfiniteStreak()) {
      this.recordInfiniteStreak.set(nextStreak);
      this.safeSetItem(`${INFINITE_BEST_STREAK_KEY}${suffix}`, String(nextStreak));
    }
  }

  private safeGetItem(key: string): string | null {
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
        return localStorage.getItem(key);
      }
    } catch {
      // Ignora em ambientes sem localStorage
    }
    return null;
  }

  private safeSetItem(key: string, value: string): void {
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
        localStorage.setItem(key, value);
      }
    } catch {
      // Ignora em ambientes sem localStorage
    }
  }
}
