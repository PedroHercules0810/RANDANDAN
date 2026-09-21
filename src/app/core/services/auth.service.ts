import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthState } from '../models/auth-state.model';
import { User } from '../models/user.model';
import { GuestService } from './guest.service';

/**
 * Implementação local (localStorage) do fluxo de autenticação.
 *
 * Serve como camada de abstração: quando o backend do Amplify Auth
 * (Cognito) for provisionado (`amplify add auth`), apenas os métodos
 * privados desta classe precisam ser trocados pelas chamadas do SDK
 * `aws-amplify/auth` — o restante da aplicação (guards, componentes)
 * consome apenas `authState()` e os métodos públicos abaixo.
 */
const USERS_STORAGE_KEY = 'randandan_users';
const SESSION_STORAGE_KEY = 'randandan_session';

interface StoredUser extends User {
  password: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly guestService = inject(GuestService);
  private readonly state = signal<AuthState>(this.restoreState());

  readonly authState = computed(() => this.state());

  register(email: string, password: string, displayName: string): User {
    const users = this.readUsers();
    if (users.some((u) => u.email === email)) {
      throw new Error('Já existe uma conta cadastrada com este e-mail.');
    }

    const user: StoredUser = {
      id: `user_${Date.now()}`,
      email,
      password,
      displayName,
      teamId: null,
      createdAt: new Date().toISOString(),
    };

    users.push(user);
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));

    return this.setAuthenticated(user);
  }

  login(email: string, password: string): User {
    const users = this.readUsers();
    const found = users.find((u) => u.email === email && u.password === password);
    if (!found) {
      throw new Error('E-mail ou senha inválidos.');
    }

    return this.setAuthenticated(found);
  }

  loginAsGuest(): void {
    const session = this.guestService.createSession();
    localStorage.removeItem(SESSION_STORAGE_KEY);
    this.state.set({ status: 'guest', user: null, guest: session });
  }

  logout(): void {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    this.guestService.clearSession();
    this.state.set({ status: 'anonymous', user: null, guest: null });
  }

  updateCurrentUser(patch: Partial<Pick<User, 'displayName' | 'teamId'>>): User {
    const current = this.state();
    if (current.status !== 'authenticated' || !current.user) {
      throw new Error('É necessário estar autenticado para atualizar o perfil.');
    }

    const users = this.readUsers();
    const index = users.findIndex((u) => u.id === current.user!.id);
    if (index === -1) {
      throw new Error('Usuário não encontrado.');
    }

    users[index] = { ...users[index], ...patch };
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));

    const { password: _password, ...updatedUser } = users[index];
    this.state.set({ status: 'authenticated', user: updatedUser, guest: null });
    return updatedUser;
  }

  private setAuthenticated(stored: StoredUser): User {
    const { password: _password, ...user } = stored;
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
    this.guestService.clearSession();
    this.state.set({ status: 'authenticated', user, guest: null });
    return user;
  }

  private readUsers(): StoredUser[] {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredUser[]) : [];
  }

  private restoreState(): AuthState {
    const sessionRaw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (sessionRaw) {
      return { status: 'authenticated', user: JSON.parse(sessionRaw) as User, guest: null };
    }

    const guestSession = this.guestService.getSession();
    if (guestSession) {
      return { status: 'guest', user: null, guest: guestSession };
    }

    return { status: 'anonymous', user: null, guest: null };
  }
}
