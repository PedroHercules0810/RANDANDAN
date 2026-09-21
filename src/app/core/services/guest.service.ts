import { Injectable } from '@angular/core';
import { GuestSession } from '../models/guest-session.model';

const GUEST_STORAGE_KEY = 'randandan_guest_session';
const GUEST_SESSION_HOURS = 24;

@Injectable({ providedIn: 'root' })
export class GuestService {
  createSession(): GuestSession {
    const now = new Date();
    const expires = new Date(now.getTime() + GUEST_SESSION_HOURS * 60 * 60 * 1000);

    const session: GuestSession = {
      guestId: `guest_${Math.random().toString(36).slice(2)}${Date.now()}`,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };

    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  getSession(): GuestSession | null {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const session = JSON.parse(raw) as GuestSession;
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      this.clearSession();
      return null;
    }

    return session;
  }

  clearSession(): void {
    localStorage.removeItem(GUEST_STORAGE_KEY);
  }
}
