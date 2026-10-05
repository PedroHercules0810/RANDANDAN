import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-cadastro',
  imports: [FormsModule, RouterLink],
  templateUrl: './cadastro.html',
  styleUrl: './cadastro.css',
})
export class Cadastro {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected displayName = '';
  protected email = '';
  protected password = '';
  protected confirmationCode = '';

  /** Etapas do cadastro: formulário inicial e confirmação do código por e-mail. */
  protected readonly step = signal<'form' | 'confirm'>('form');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly isBusy = signal(false);

  constructor() {
    // Cadastro confirmado com auto sign-in: sessão estabelecida.
    effect(() => {
      if (this.authService.authState().status === 'authenticated') {
        void this.router.navigateByUrl('/equipe');
      }
    });
  }

  protected async onSubmit(): Promise<void> {
    if (this.isBusy()) {
      return;
    }

    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.isBusy.set(true);

    try {
      await this.authService.register(this.displayName, this.email, this.password);
      this.step.set('confirm');
      this.successMessage.set(
        'Conta criada! Enviamos um código de verificação para o seu e-mail.',
      );
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    } finally {
      this.isBusy.set(false);
    }
  }

  protected async onConfirm(): Promise<void> {
    if (this.isBusy()) {
      return;
    }

    this.errorMessage.set(null);
    this.isBusy.set(true);

    try {
      await this.authService.confirmRegistration(this.email, this.confirmationCode);

      if (this.authService.authState().status === 'authenticated') {
        await this.router.navigateByUrl('/equipe');
        return;
      }

      // Auto sign-in ainda pendente: o usuário entra normalmente.
      this.successMessage.set('E-mail confirmado! Agora é só entrar.');
      await this.router.navigateByUrl('/login');
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    } finally {
      this.isBusy.set(false);
    }
  }

  protected async onResendCode(): Promise<void> {
    if (this.isBusy()) {
      return;
    }

    this.errorMessage.set(null);
    this.isBusy.set(true);

    try {
      await this.authService.resendConfirmationCode(this.email);
      this.successMessage.set('Novo código enviado para o seu e-mail.');
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    } finally {
      this.isBusy.set(false);
    }
  }
}
