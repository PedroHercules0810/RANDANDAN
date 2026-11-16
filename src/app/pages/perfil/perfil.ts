import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ProfileImageService } from '../../core/services/profile-image.service';
import { ScoreService } from '../../core/services/score.service';
import { TeamService } from '../../core/services/team.service';

@Component({
  selector: 'app-perfil',
  imports: [RouterLink, DatePipe, FormsModule],
  templateUrl: './perfil.html',
  styleUrl: './perfil.css',
})
export class Perfil implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly teamService = inject(TeamService);
  private readonly scoreService = inject(ScoreService);
  private readonly router = inject(Router);
  protected readonly profileImageService = inject(ProfileImageService);

  protected readonly authState = this.authService.authState;
  protected readonly isLoggingOut = signal(false);
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly localPreviewUrl = signal<string | null>(null);
  protected readonly customEndpoint = signal<string>(this.profileImageService.apiEndpoint());

  ngOnInit(): void {
    void this.profileImageService.loadProfileImage();
  }

  protected get currentTeam() {
    return this.teamService.getCurrentTeam();
  }

  protected get scoreHistory() {
    return this.scoreService.getPersistedScores();
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;

    if (!file) {
      this.selectedFile.set(null);
      this.localPreviewUrl.set(null);
      return;
    }

    const validationError = this.profileImageService.validateImageFile(file);
    if (validationError) {
      this.selectedFile.set(null);
      this.localPreviewUrl.set(null);
      if (input) {
        input.value = '';
      }
      alert(validationError);
      return;
    }

    this.selectedFile.set(file);
    const reader = new FileReader();
    reader.onload = () => {
      this.localPreviewUrl.set(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  }

  protected async uploadSelectedImage(): Promise<void> {
    const file = this.selectedFile();
    if (!file || this.profileImageService.isUploading()) {
      return;
    }

    this.profileImageService.setApiEndpoint(this.customEndpoint());
    const ok = await this.profileImageService.uploadProfileImage(file);
    if (ok) {
      this.selectedFile.set(null);
      this.localPreviewUrl.set(null);
    }
  }

  protected async reloadImageFromS3(): Promise<void> {
    this.profileImageService.setApiEndpoint(this.customEndpoint());
    await this.profileImageService.loadProfileImage();
  }

  protected async logout(): Promise<void> {
    if (this.isLoggingOut()) {
      return;
    }

    this.isLoggingOut.set(true);

    try {
      await this.authService.logout();
      await this.router.navigateByUrl('/');
    } finally {
      this.isLoggingOut.set(false);
    }
  }
}
