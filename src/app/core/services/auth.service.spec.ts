import { TestBed } from '@angular/core/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as amplifyAuth from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { AuthService } from './auth.service';

vi.mock('aws-amplify/auth', () => ({
  confirmSignUp: vi.fn(),
  fetchAuthSession: vi.fn(),
  fetchUserAttributes: vi.fn(),
  getCurrentUser: vi.fn(),
  resendSignUpCode: vi.fn(),
  signIn: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock('aws-amplify/auth/enable-oauth-listener', () => ({}));

describe('AuthService (Google OAuth & Cognito)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    TestBed.configureTestingModule({});
  });

  it('deve autenticar usuário do Google OAuth lendo claims do ID Token mesmo quando fetchUserAttributes falha por falta de escopo admin', async () => {
    vi.mocked(amplifyAuth.fetchAuthSession).mockResolvedValue({
      tokens: {
        idToken: {
          payload: {
            sub: 'google-sub-123',
            email: 'piloto@gmail.com',
            name: 'Piloto Google',
            email_verified: true,
            'cognito:username': 'Google_10987654321',
            identities: [{ providerName: 'Google', userId: '10987654321' }],
          },
          toString: () => 'mock-id-token',
        },
        accessToken: {
          payload: { sub: 'google-sub-123', scope: 'openid email profile' },
          toString: () => 'mock-access-token',
        },
      },
    } as never);

    vi.mocked(amplifyAuth.getCurrentUser).mockResolvedValue({
      userId: 'google-sub-123',
      username: 'Google_10987654321',
    });

    const scopeError = new Error('Access Token does not have required scopes');
    scopeError.name = 'NotAuthorizedException';
    vi.mocked(amplifyAuth.fetchUserAttributes).mockRejectedValue(scopeError);

    const service = TestBed.inject(AuthService);
    await service.ensureInitialized();

    expect(service.authState()).toEqual({
      status: 'authenticated',
      user: {
        id: 'google-sub-123',
        email: 'piloto@gmail.com',
        displayName: 'Piloto Google',
        emailVerified: true,
        provider: 'google',
      },
    });
  });

  it('deve atualizar o estado ao receber o evento signInWithRedirect do Amplify Hub', async () => {
    vi.mocked(amplifyAuth.fetchAuthSession).mockResolvedValue({ tokens: undefined } as never);
    vi.mocked(amplifyAuth.getCurrentUser).mockRejectedValue(new Error('not authenticated'));

    const service = TestBed.inject(AuthService);
    await service.ensureInitialized();
    expect(service.authState().status).toBe('anonymous');

    vi.mocked(amplifyAuth.fetchAuthSession).mockResolvedValue({
      tokens: {
        idToken: {
          payload: {
            sub: 'google-sub-999',
            email: 'rider@gmail.com',
            given_name: 'Rider',
            email_verified: true,
            identities: [{ providerName: 'Google' }],
          },
          toString: () => 'mock-id-token',
        },
      },
    } as never);

    Hub.dispatch('auth', { event: 'signInWithRedirect' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(service.authState().status).toBe('authenticated');
    expect(service.authState().user?.provider).toBe('google');
    expect(service.authState().user?.email).toBe('rider@gmail.com');
  });

  it('deve recuperar a sessão existente se signInWithGoogle lançar UserAlreadyAuthenticatedException', async () => {
    vi.mocked(amplifyAuth.fetchAuthSession).mockResolvedValueOnce({ tokens: undefined } as never);

    const service = TestBed.inject(AuthService);
    await service.ensureInitialized();

    const alreadyAuthError = new Error('There is already a signed in user.');
    alreadyAuthError.name = 'UserAlreadyAuthenticatedException';
    vi.mocked(amplifyAuth.signInWithRedirect).mockRejectedValueOnce(alreadyAuthError);

    vi.mocked(amplifyAuth.fetchAuthSession).mockResolvedValue({
      tokens: {
        idToken: {
          payload: {
            sub: 'google-sub-456',
            email: 'ja-logado@gmail.com',
            name: 'Já Logado',
            email_verified: true,
            'cognito:username': 'Google_456',
          },
          toString: () => 'mock-id-token',
        },
      },
    } as never);

    await service.signInWithGoogle();

    expect(service.authState().status).toBe('authenticated');
    expect(service.authState().user?.email).toBe('ja-logado@gmail.com');
  });
});
