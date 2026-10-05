import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Aguarda a verificação/restauração da sessão no Cognito, que inclui
  // a conclusão do fluxo OAuth do Google quando a página carrega com
  // o código de autorização na URL.
  await authService.ensureInitialized();

  if (authService.authState().status === 'authenticated') {
    return true;
  }

  return router.createUrlTree(['/login']);
};
