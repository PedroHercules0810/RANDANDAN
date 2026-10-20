import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { GameService, MAX_ATTEMPTS } from './game.service';
import { AuthService } from './auth.service';
import { ScoreService } from './score.service';
import { MotorcycleService } from './motorcycle.service';
import { AuthState } from '../models/auth-state.model';

describe('GameService', () => {
  let gameService: GameService;
  let motorcycleService: MotorcycleService;
  const mockAuthState = signal<AuthState>({ status: 'anonymous', user: null });
  const mockRecordScore = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.set({ status: 'anonymous', user: null });

    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthService,
          useValue: {
            authState: mockAuthState.asReadonly(),
          },
        },
        {
          provide: ScoreService,
          useValue: {
            canJoinRanking: () => mockAuthState().status === 'authenticated',
            recordScore: mockRecordScore,
            getPersistedScores: () => [],
          },
        },
      ],
    });

    motorcycleService = TestBed.inject(MotorcycleService);
    gameService = TestBed.inject(GameService);
  });

  it('deve comparar corretamente os 5 atributos indicando higher quando o palpite é maior que o secreto e lower quando menor', () => {
    const target = motorcycleService.findById('honda-cb-500f')!; // 471cc, 189kg, Naked, Honda
    const higherGuess = motorcycleService.findById('honda-cbr-1000rrr-fireblade')!; // 1000cc, 201kg, Sport, Honda
    const lowerGuess = motorcycleService.findById('yamaha-mt-03')!; // 321cc, 169kg, Naked, Yamaha

    const higherComp = gameService.compareGuess(higherGuess, target);
    expect(higherComp.manufacturerStatus).toBe('correct');
    expect(higherComp.modelStatus).toBe('incorrect');
    expect(higherComp.displacementStatus).toBe('higher');
    expect(higherComp.weightStatus).toBe('higher');
    expect(higherComp.styleStatus).toBe('incorrect');
    expect(higherComp.isCorrect).toBe(false);

    const lowerComp = gameService.compareGuess(lowerGuess, target);
    expect(lowerComp.manufacturerStatus).toBe('incorrect');
    expect(lowerComp.displacementStatus).toBe('lower');
    expect(lowerComp.weightStatus).toBe('lower');
    expect(lowerComp.styleStatus).toBe('correct');

    const exactComp = gameService.compareGuess(target, target);
    expect(exactComp.isCorrect).toBe(true);
    expect(exactComp.modelStatus).toBe('correct');
    expect(exactComp.displacementStatus).toBe('correct');
    expect(exactComp.weightStatus).toBe('correct');
  });

  it('deve calcular a pontuação seguindo as regras de palpites, bônus de tempo e dicas', () => {
    // 1 palpite (1000) + 50s (300 - 50 = 250) + 0 dicas (+200) = 1450
    const score1 = gameService.calculateScore({
      guessCount: 1,
      elapsedSeconds: 50,
      hintsUsed: 0,
      won: true,
    });
    expect(score1).toEqual({
      guessPoints: 1000,
      timeBonus: 250,
      hintBonus: 200,
      totalPoints: 1450,
    });

    // 3 palpites (600) + 100s (200) + 2 dicas (-200) = 600
    const score2 = gameService.calculateScore({
      guessCount: 3,
      elapsedSeconds: 100,
      hintsUsed: 2,
      won: true,
    });
    expect(score2).toEqual({
      guessPoints: 600,
      timeBonus: 200,
      hintBonus: -200,
      totalPoints: 600,
    });
  });

  it('deve vencer a partida ao acertar a moto secreta e registrar pontuação quando autenticado', () => {
    mockAuthState.set({
      status: 'authenticated',
      user: {
        id: 'user-1',
        email: 'piloto@teste.com',
        displayName: 'Piloto',
        emailVerified: true,
        provider: 'google',
      },
    });

    const round = gameService.getRound('infinite');
    gameService.useFipeHint('infinite');
    expect(gameService.getRound('infinite').fipeHintUsed).toBe(true);

    const result = gameService.submitGuess('infinite', round.target.id, round.startedAtMs + 30_000);
    expect(result.isCorrect).toBe(true);
    expect(gameService.getRound('infinite').status).toBe('won');
    expect(gameService.infiniteStreak()).toBe(1);
    expect(mockRecordScore).toHaveBeenCalledTimes(1);
  });

  it('deve encerrar a partida como derrota após 6 palpites incorretos', () => {
    const round = gameService.getRound('infinite');
    const wrongMotos = motorcycleService
      .listAll()
      .filter((m) => m.id !== round.target.id)
      .slice(0, MAX_ATTEMPTS);

    for (const moto of wrongMotos) {
      gameService.submitGuess('infinite', moto.id);
    }

    expect(gameService.getRound('infinite').status).toBe('lost');
    expect(gameService.getRound('infinite').guesses.length).toBe(MAX_ATTEMPTS);
    expect(gameService.getRound('infinite').scoreBreakdown?.totalPoints).toBe(0);
  });
});
