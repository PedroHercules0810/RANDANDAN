import { Routes } from '@angular/router';

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
  { path: '**', redirectTo: '' },
];
