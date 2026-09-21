import { GuestSession } from './guest-session.model';
import { User } from './user.model';

export type AuthStatus = 'authenticated' | 'guest' | 'anonymous';

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  guest: GuestSession | null;
}
