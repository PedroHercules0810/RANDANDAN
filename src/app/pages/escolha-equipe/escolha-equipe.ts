import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TeamService } from '../../core/services/team.service';

@Component({
  selector: 'app-escolha-equipe',
  templateUrl: './escolha-equipe.html',
  styleUrl: './escolha-equipe.css',
})
export class EscolhaEquipe {
  private readonly teamService = inject(TeamService);
  private readonly router = inject(Router);

  protected readonly teams = this.teamService.listTeams();
  protected readonly errorMessage = signal<string | null>(null);

  protected selectTeam(teamId: number): void {
    this.errorMessage.set(null);
    try {
      this.teamService.joinTeam(teamId);
      this.router.navigateByUrl('/perfil');
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    }
  }
}
