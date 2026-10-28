import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  GuessComparison,
  Motorcycle,
  NumericMatchStatus,
  PilotRankingEntry,
  RoundState,
  TeamRankingEntry,
} from '../../core/models/motorcycle.model';
import { GameMode } from '../../core/models/score.model';
import { AuthService } from '../../core/services/auth.service';
import { GameService, MAX_ATTEMPTS } from '../../core/services/game.service';
import { GeminiChatService } from '../../core/services/gemini-chat.service';
import { MotorcycleService } from '../../core/services/motorcycle.service';
import { TeamService } from '../../core/services/team.service';

export type ArenaTab = 'daily' | 'infinite' | 'rankings';

@Component({
  selector: 'app-home',
  imports: [RouterLink, FormsModule],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly motorcycleService = inject(MotorcycleService);
  private readonly gameService = inject(GameService);
  private readonly teamService = inject(TeamService);
  protected readonly geminiChat = inject(GeminiChatService);

  protected readonly maxAttempts = MAX_ATTEMPTS;
  protected readonly activeArenaTab = signal<ArenaTab>('daily');
  protected readonly searchQuery = signal('');
  protected readonly chatQuestion = signal('');
  protected readonly dropdownOpen = signal(false);
  protected readonly highlightedIndex = signal(0);
  protected readonly feedbackError = signal<string | null>(null);
  protected readonly copyFeedback = signal(false);
  protected readonly countdownFormatted = signal('00:00:00');
  protected readonly todayDateFormatted = signal(this.motorcycleService.getFormattedBrasiliaDate());

  protected readonly authState = this.authService.authState;
  protected readonly infiniteStreak = this.gameService.infiniteStreak;
  protected readonly bestInfiniteStreak = this.gameService.bestInfiniteStreak;

  private timerId: ReturnType<typeof setInterval> | null = null;

  protected readonly activeMode = computed<GameMode>(() =>
    this.activeArenaTab() === 'infinite' ? 'infinite' : 'daily',
  );

  protected readonly activeRound = computed<RoundState>(() =>
    this.activeMode() === 'daily'
      ? this.gameService.dailyRound()
      : this.gameService.infiniteRound(),
  );

  protected readonly guessedIds = computed<ReadonlySet<string>>(
    () => new Set(this.activeRound().guesses.map((g) => g.motorcycle.id)),
  );

  protected readonly filteredSuggestions = computed<Motorcycle[]>(() => {
    const query = this.searchQuery();
    return this.motorcycleService.search(query, this.guessedIds()).slice(0, 8);
  });

  protected readonly remainingSlots = computed<number[]>(() => {
    const used = this.activeRound().guesses.length;
    const remaining = Math.max(0, MAX_ATTEMPTS - used);
    return Array.from({ length: remaining }, (_, idx) => used + idx + 1);
  });

  protected readonly hintsUsedCount = computed<number>(() => {
    const r = this.activeRound();
    return (r.fipeHintUsed ? 1 : 0) + (r.topSpeedHintUsed ? 1 : 0);
  });

  protected readonly currentHintBonusPreview = computed<number>(() => {
    const used = this.hintsUsedCount();
    if (used === 0) return 200;
    if (used === 1) return 0;
    return -200;
  });

  protected readonly elapsedFormatted = computed<string>(() =>
    this.gameService.formatDuration(this.activeRound().elapsedSeconds),
  );

  protected get currentTeam() {
    return this.teamService.getCurrentTeam();
  }

  protected get pilotRankings(): PilotRankingEntry[] {
    return this.gameService.getPilotRankings();
  }

  protected get teamRankings(): TeamRankingEntry[] {
    return this.gameService.getTeamRankings();
  }

  ngOnInit(): void {
    this.updateTimers();
    this.timerId = setInterval(() => {
      this.updateTimers();
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  protected selectArenaTab(tab: ArenaTab): void {
    this.activeArenaTab.set(tab);
    this.feedbackError.set(null);
    this.copyFeedback.set(false);
    this.dropdownOpen.set(false);
  }

  protected scrollToArena(tab?: ArenaTab): void {
    if (tab) {
      this.selectArenaTab(tab);
    }
    if (typeof document !== 'undefined') {
      document.getElementById('arena-jogo')?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  protected onSearchInput(value: string): void {
    this.searchQuery.set(value);
    this.highlightedIndex.set(0);
    this.feedbackError.set(null);
    this.dropdownOpen.set(true);
  }

  protected onSearchFocus(): void {
    if (this.activeRound().status === 'playing') {
      this.dropdownOpen.set(true);
    }
  }

  protected closeDropdownDelayed(): void {
    setTimeout(() => {
      this.dropdownOpen.set(false);
    }, 180);
  }

  protected onSearchKeydown(event: KeyboardEvent): void {
    const list = this.filteredSuggestions();
    if (!list.length) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.dropdownOpen.set(true);
      this.highlightedIndex.update((i) => (i + 1) % list.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.dropdownOpen.set(true);
      this.highlightedIndex.update((i) => (i - 1 + list.length) % list.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const index = Math.min(this.highlightedIndex(), list.length - 1);
      const selected = list[Math.max(0, index)];
      if (selected) {
        this.chooseMotorcycle(selected);
      }
    } else if (event.key === 'Escape') {
      this.dropdownOpen.set(false);
    }
  }

  protected submitCurrentSearch(): void {
    const list = this.filteredSuggestions();
    if (!list.length) {
      this.feedbackError.set('Nenhuma motocicleta encontrada para este termo.');
      return;
    }

    const index = Math.min(this.highlightedIndex(), list.length - 1);
    const selected = list[Math.max(0, index)];
    if (selected) {
      this.chooseMotorcycle(selected);
    }
  }

  protected chooseMotorcycle(moto: Motorcycle): void {
    this.feedbackError.set(null);
    this.copyFeedback.set(false);

    try {
      this.gameService.submitGuess(this.activeMode(), moto.id);
      this.searchQuery.set('');
      this.highlightedIndex.set(0);
      this.dropdownOpen.set(false);
    } catch (error) {
      this.feedbackError.set((error as Error).message);
    }
  }

  protected revealFipeHint(): void {
    this.gameService.useFipeHint(this.activeMode());
  }

  protected revealTopSpeedHint(): void {
    this.gameService.useTopSpeedHint(this.activeMode());
  }

  protected async sendChatQuestion(): Promise<void> {
    const question = this.chatQuestion().trim();
    if (!question || this.geminiChat.isSending()) {
      return;
    }
    this.chatQuestion.set('');
    await this.geminiChat.sendQuestion(question, this.activeMode());
  }

  protected async sendQuickQuestion(question: string): Promise<void> {
    if (this.geminiChat.isSending()) {
      return;
    }
    await this.geminiChat.sendQuestion(question, this.activeMode());
  }

  protected async reconnectChatWebSocket(): Promise<void> {
    await this.geminiChat.reconnect();
  }

  protected nextInfiniteChallenge(): void {
    this.feedbackError.set(null);
    this.copyFeedback.set(false);
    this.searchQuery.set('');
    this.gameService.startNextInfiniteRound();
  }

  protected async copyShareResult(): Promise<void> {
    const text = this.gameService.buildShareText(this.activeMode());
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
      this.copyFeedback.set(true);
      setTimeout(() => this.copyFeedback.set(false), 3000);
    } catch {
      this.copyFeedback.set(true);
    }
  }

  protected shareOnWhatsApp(): void {
    const text = this.gameService.buildShareText(this.activeMode());
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  protected describeNumericStatus(status: NumericMatchStatus): string {
    if (status === 'correct') {
      return '✓ CORRETO';
    }
    return status === 'higher' ? '▲ MAIOR QUE O SECRETO' : '▼ MENOR QUE O SECRETO';
  }

  protected trackGuess(_index: number, guess: GuessComparison): string {
    return guess.motorcycle.id;
  }

  private updateTimers(): void {
    const now = new Date();
    this.todayDateFormatted.set(this.motorcycleService.getFormattedBrasiliaDate(now));

    const remainingSecs = this.motorcycleService.getSecondsUntilNextDailyReset(now);
    const hrs = Math.floor(remainingSecs / 3600);
    const mins = Math.floor((remainingSecs % 3600) / 60);
    const secs = remainingSecs % 60;
    this.countdownFormatted.set(
      `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
    );

    if (this.activeArenaTab() !== 'rankings') {
      this.gameService.tickElapsed(this.activeMode(), now.getTime());
    }
  }
}
