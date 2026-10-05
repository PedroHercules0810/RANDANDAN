import { User } from './user.model';

export type AuthStatus = 'authenticated' | 'anonymous';

export interface AuthState {
  status: AuthStatus;
  user: User | null;
}
