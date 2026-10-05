import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected email = '';
  protected password = '';
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly isBusy = signal(false);
  protected readonly isRedirectingFromOAuth = signal(false);

  constructor() {
    this.checkForOAuthError();

    // Conclui a navegação quando o fluxo OAuth do Google retorna para
    // esta página e a sessão é estabelecida automaticamente.
    effect(() => {
      if (this.authService.authState().status === 'authenticated') {
        void this.router.navigateByUrl('/perfil');
      }
    });
  }

  protected async onSubmit(): Promise<void> {
    if (this.isBusy()) {
      return;
    }

    this.errorMessage.set(null);
    this.isBusy.set(true);

    try {
      await this.authService.signIn(this.email, this.password);
      await this.router.navigateByUrl('/perfil');
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    } finally {
      this.isBusy.set(false);
    }
  }

  protected async signInWithGoogle(): Promise<void> {
    if (this.isBusy()) {
      return;
    }

    this.errorMessage.set(null);
    this.isBusy.set(true);
    this.isRedirectingFromOAuth.set(true);

    try {
      await this.authService.signInWithGoogle();
    } catch (error) {
      this.errorMessage.set((error as Error).message);
      this.isBusy.set(false);
      this.isRedirectingFromOAuth.set(false);
    }
  }

  /**
   * O Cognito retorna erros de OAuth como query params (`?error=...`).
   * Exibimos a mensagem e limpamos a URL.
   */
  private checkForOAuthError(): void {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');

    if (oauthError) {
      const description = params.get('error_description');
      this.errorMessage.set(
        oauthError === 'access_denied'
          ? 'O login com o Google foi cancelado ou negado.'
          : `Falha no login com o Google${description ? `: ${description}` : '.'}`,
      );
      window.history.replaceState({}, '', window.location.pathname);
    }
  }
}
