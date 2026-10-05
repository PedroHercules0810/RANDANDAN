import { Injectable, inject } from '@angular/core';
import { Team } from '../models/team.model';
import { User } from '../models/user.model';
import { AuthService } from './auth.service';

const TEAMS: Team[] = [
  { id: 1, name: 'Honda Racing', manufacturer: 'Honda' },
  { id: 2, name: 'Yamaha Blue', manufacturer: 'Yamaha' },
  { id: 3, name: 'Kawasaki Green', manufacturer: 'Kawasaki' },
  { id: 4, name: 'Suzuki Blue', manufacturer: 'Suzuki' },
];

/**
 * Chave de persistência da equipe por usuário, no formato
 * `randandan_team_<sub-do-cognito>`. Sem backend de banco de dados,
 * a escolha fica salva por usuário no próprio dispositivo.
 */
const TEAM_STORAGE_PREFIX = 'randandan_team_';

@Injectable({ providedIn: 'root' })
export class TeamService {
  private readonly authService = inject(AuthService);

  listTeams(): Team[] {
    return TEAMS;
  }

  /** Vincula o usuário autenticado do Cognito a uma equipe. */
  joinTeam(teamId: number): Team {
    const user = this.requireAuthenticatedUser();

    const team = TEAMS.find((t) => t.id === teamId);
    if (!team) {
      throw new Error('Equipe não encontrada.');
    }

    localStorage.setItem(TEAM_STORAGE_PREFIX + user.id, String(teamId));
    return team;
  }

  getCurrentTeam(): Team | null {
    const user = this.authService.authState().user;
    if (!user) {
      return null;
    }

    const rawTeamId = localStorage.getItem(TEAM_STORAGE_PREFIX + user.id);
    const teamId = rawTeamId ? Number(rawTeamId) : Number.NaN;

    return TEAMS.find((t) => t.id === teamId) ?? null;
  }

  private requireAuthenticatedUser(): User {
    const state = this.authService.authState();
    if (state.status !== 'authenticated' || !state.user) {
      throw new Error('Apenas contas autenticadas podem escolher uma equipe permanente.');
    }

    return state.user;
  }
}
