import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    title: 'RANDANDAN - Jogo de Adivinhação de Motos Esportivas',
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
  },
  {
    path: 'funcionalidades',
    title: 'RANDANDAN - Funcionalidades',
    loadComponent: () => import('./pages/features/features').then((m) => m.Features),
  },
  {
    path: 'como-jogar',
    title: 'RANDANDAN - Como Jogar',
    loadComponent: () => import('./pages/how-to-play/how-to-play').then((m) => m.HowToPlay),
  },
  {
    path: 'login',
    title: 'RANDANDAN - Entrar',
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
  },
  {
    path: 'cadastro',
    title: 'RANDANDAN - Criar Conta',
    loadComponent: () => import('./pages/cadastro/cadastro').then((m) => m.Cadastro),
  },
  {
    path: 'perfil',
    title: 'RANDANDAN - Meu Perfil',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/perfil/perfil').then((m) => m.Perfil),
  },
  {
    path: 'equipe',
    title: 'RANDANDAN - Escolher Equipe',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/escolha-equipe/escolha-equipe').then((m) => m.EscolhaEquipe),
  },
  { path: '**', redirectTo: '' },
];
