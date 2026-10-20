import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { MotorcycleService } from './motorcycle.service';

describe('MotorcycleService', () => {
  let service: MotorcycleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MotorcycleService);
  });

  it('deve listar todo o catálogo de motos brasileiras', () => {
    const all = service.listAll();
    expect(all.length).toBeGreaterThanOrEqual(30);
  });

  it('deve filtrar motos por marca ou modelo ignorando maiúsculas/minúsculas e excluindo IDs informados', () => {
    const results = service.search('cb 500');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.some((m) => m.id === 'honda-cb-500f')).toBe(true);

    const filtered = service.search('cb 500', new Set(['honda-cb-500f']));
    expect(filtered.some((m) => m.id === 'honda-cb-500f')).toBe(false);
  });

  it('deve retornar sempre a mesma moto diária para a mesma chave de data e mudar entre datas', () => {
    const motoDayA1 = service.getDailyMotorcycle('2026-10-19');
    const motoDayA2 = service.getDailyMotorcycle('2026-10-19');
    expect(motoDayA1.id).toBe(motoDayA2.id);

    const differentDays = new Set([
      service.getDailyMotorcycle('2026-10-19').id,
      service.getDailyMotorcycle('2026-10-20').id,
      service.getDailyMotorcycle('2026-10-21').id,
      service.getDailyMotorcycle('2026-10-22').id,
    ]);
    expect(differentDays.size).toBeGreaterThan(1);
  });

  it('deve calcular os segundos restantes até a próxima meia-noite no horário de Brasília', () => {
    // 23:59:00 BRT (02:59:00 UTC do dia seguinte) -> faltam 60s
    const fakeNow = new Date(Date.UTC(2026, 9, 20, 2, 59, 0));
    expect(service.getSecondsUntilNextDailyReset(fakeNow)).toBe(60);
  });
});
