import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-features',
  templateUrl: './features.html',
  styleUrl: './features.css',
})
export class Features {
  protected readonly tabs = [
    { id: 'modo-diario', label: 'Modo Diário' },
    { id: 'modo-infinito', label: 'Modo Infinito' },
    { id: 'sistema-equipes', label: 'Sistema de Equipes' },
    { id: 'dicas', label: 'Dicas Estratégicas' },
    { id: 'rankings', label: 'Rankings' },
    { id: 'competicoes', label: 'Competições' },
  ];

  protected readonly activeTab = signal('modo-diario');

  protected selectTab(id: string): void {
    this.activeTab.set(id);
  }
}
