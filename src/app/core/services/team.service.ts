import { Injectable, inject } from '@angular/core';
import { Team } from '../models/team.model';
import { AuthService } from './auth.service';

const TEAMS: Team[] = [
  { id: 1, name: 'Honda Racing', manufacturer: 'Honda' },
  { id: 2, name: 'Yamaha Blue', manufacturer: 'Yamaha' },
  { id: 3, name: 'Kawasaki Green', manufacturer: 'Kawasaki' },
  { id: 4, name: 'Suzuki Blue', manufacturer: 'Suzuki' },
];

@Injectable({ providedIn: 'root' })
export class TeamService {
  private readonly authService = inject(AuthService);

  listTeams(): Team[] {
    return TEAMS;
  }

  /**
   * Vincula o usuário autenticado a uma equipe de forma permanente.
   * Convidados não podem persistir uma equipe (perdem esse benefício).
   */
  joinTeam(teamId: number): Team {
    const state = this.authService.authState();
    if (state.status !== 'authenticated') {
      throw new Error('Apenas contas autenticadas podem escolher uma equipe permanente.');
    }

    const team = TEAMS.find((t) => t.id === teamId);
    if (!team) {
      throw new Error('Equipe não encontrada.');
    }

    this.authService.updateCurrentUser({ teamId });
    return team;
  }

  getCurrentTeam(): Team | null {
    const state = this.authService.authState();
    if (state.status !== 'authenticated' || state.user?.teamId == null) {
      return null;
    }

    return TEAMS.find((t) => t.id === state.user!.teamId) ?? null;
  }
}
