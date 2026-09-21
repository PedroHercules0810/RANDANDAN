import { Component, inject, signal } from '@angular/core';
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

  protected onSubmit(): void {
    this.errorMessage.set(null);
    try {
      this.authService.login(this.email, this.password);
      this.router.navigateByUrl('/perfil');
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    }
  }

  protected playAsGuest(): void {
    this.authService.loginAsGuest();
    this.router.navigateByUrl('/');
  }
}
