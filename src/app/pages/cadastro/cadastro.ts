import { Component, inject, signal } from '@angular/core';
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
  protected readonly errorMessage = signal<string | null>(null);

  protected onSubmit(): void {
    this.errorMessage.set(null);
    try {
      this.authService.register(this.email, this.password, this.displayName);
      this.router.navigateByUrl('/equipe');
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    }
  }
}
