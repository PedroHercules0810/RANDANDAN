import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ScoreService } from '../../core/services/score.service';
import { TeamService } from '../../core/services/team.service';

@Component({
  selector: 'app-perfil',
  imports: [RouterLink, DatePipe],
  templateUrl: './perfil.html',
  styleUrl: './perfil.css',
})
export class Perfil {
  private readonly authService = inject(AuthService);
  private readonly teamService = inject(TeamService);
  private readonly scoreService = inject(ScoreService);
  private readonly router = inject(Router);

  protected readonly authState = this.authService.authState;

  protected get currentTeam() {
    return this.teamService.getCurrentTeam();
  }

  protected get scoreHistory() {
    return this.scoreService.getPersistedScores();
  }

  protected logout(): void {
    this.authService.logout();
    this.router.navigateByUrl('/');
  }
}
