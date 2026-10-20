import { Injectable } from '@angular/core';
import { MOTORCYCLES_CATALOG } from '../data/motorcycles.data';
import { Motorcycle } from '../models/motorcycle.model';

@Injectable({ providedIn: 'root' })
export class MotorcycleService {
  /** Retorna todas as motocicletas do catálogo. */
  listAll(): readonly Motorcycle[] {
    return MOTORCYCLES_CATALOG;
  }

  /** Busca uma motocicleta pelo seu identificador único. */
  findById(id: string): Motorcycle | undefined {
    return MOTORCYCLES_CATALOG.find((moto) => moto.id === id);
  }

  /**
   * Filtra motocicletas por marca, modelo, estilo ou cilindrada,
   * ignorando maiúsculas/minúsculas e excluindo motos já chutadas.
   */
  search(query: string, excludeIds: ReadonlySet<string> = new Set()): Motorcycle[] {
    const normalized = this.normalizeText(query);

    return MOTORCYCLES_CATALOG.filter((moto) => {
      if (excludeIds.has(moto.id)) {
        return false;
      }

      if (!normalized) {
        return true;
      }

      const fullLabel = this.normalizeText(
        `${moto.manufacturer} ${moto.model} ${moto.displacementCc}cc ${moto.style}`,
      );
      return fullLabel.includes(normalized);
    });
  }

  /**
   * Retorna a data no formato `YYYY-MM-DD` no fuso horário de Brasília (`America/Sao_Paulo`).
   */
  getDailyDateKey(now: Date = new Date()): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(now);
  }

  /**
   * Retorna a data formatada em padrão brasileiro `DD/MM/YYYY` no fuso de Brasília.
   */
  getFormattedBrasiliaDate(now: Date = new Date()): string {
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(now);
  }

  /**
   * Seleciona deterministicamente a moto do dia a partir da chave `YYYY-MM-DD`.
   * Todos os jogadores recebem exatamente a mesma moto no mesmo dia (BRT).
   */
  getDailyMotorcycle(dateKey: string = this.getDailyDateKey()): Motorcycle {
    let hash = 2166136261;
    const seed = `randandan-daily-${dateKey}`;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    const index = Math.abs(hash >>> 0) % MOTORCYCLES_CATALOG.length;
    return MOTORCYCLES_CATALOG[index];
  }

  /**
   * Calcula os segundos restantes até a próxima meia-noite no horário de Brasília (UTC-3).
   */
  getSecondsUntilNextDailyReset(now: Date = new Date()): number {
    // Horário de Brasília é UTC-3 fixo (sem horário de verão)
    const brasiliaOffsetMs = -3 * 60 * 60 * 1000;
    const brasiliaNow = new Date(now.getTime() + brasiliaOffsetMs);

    const nextMidnightBrasiliaUtcMs = Date.UTC(
      brasiliaNow.getUTCFullYear(),
      brasiliaNow.getUTCMonth(),
      brasiliaNow.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    );

    const diffSeconds = Math.floor((nextMidnightBrasiliaUtcMs - brasiliaNow.getTime()) / 1000);
    return Math.max(0, diffSeconds);
  }

  /**
   * Sorteia uma motocicleta aleatória do catálogo para o Modo Infinito,
   * evitando repetir motos informadas em `excludeIds`.
   */
  getRandomMotorcycle(excludeIds: ReadonlySet<string> = new Set()): Motorcycle {
    const candidates = MOTORCYCLES_CATALOG.filter((m) => !excludeIds.has(m.id));
    const pool = candidates.length > 0 ? candidates : MOTORCYCLES_CATALOG;
    const index = Math.floor(Math.random() * pool.length);
    return pool[index];
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
