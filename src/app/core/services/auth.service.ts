import { Injectable, computed, signal } from '@angular/core';
import {
  confirmSignUp,
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  resendSignUpCode,
  signIn,
  signInWithRedirect,
  signOut,
  signUp,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { AuthState } from '../models/auth-state.model';
import { AuthProvider, User } from '../models/user.model';
import { configureAmplify } from '../config/amplify.config';

/**
 * Mensagens amigáveis para os erros mais comuns do Cognito.
 * A chave é o `name` retornado pelo SDK do Cognito.
 */
const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  UserAlreadyAccountException: 'Já existe uma conta cadastrada com este e-mail.',
  UsernameExistsException: 'Já existe uma conta cadastrada com este e-mail.',
  NotAuthorizedException: 'E-mail ou senha inválidos.',
  UserNotConfirmedException: 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.',
  CodeMismatchException: 'Código de verificação inválido.',
  ExpiredCodeException: 'Código de verificação expirado. Solicite um novo código.',
  InvalidPasswordException:
    'A senha não atende aos requisitos de segurança (mínimo de 8 caracteres, com maiúscula, minúscula, número e símbolo).',
  InvalidParameterException:
    'Dados inválidos. Verifique o e-mail e a senha (mínimo de 8 caracteres, com maiúscula, minúscula, número e símbolo).',
  PasswordResetRequiredException: 'É necessário redefinir sua senha antes de entrar.',
  TooManyRequestsException: 'Muitas tentativas. Aguarde alguns instantes e tente novamente.',
  LimitExceededException: 'Muitas tentativas. Aguarde alguns instantes e tente novamente.',
  NetworkError: 'Falha de conexão. Verifique sua internet e tente novamente.',
};

/**
 * Autenticação da aplicação via AWS Cognito (AWS Amplify Auth).
 *
 * - E-mail/senha (com confirmação de código por e-mail)
 * - Google OAuth através do Hosted UI do Cognito (`signInWithRedirect`)
 *
 * Toda a sessão fica sob controle do Cognito (tokens gerenciados pelo
 * SDK) — não existe mais autenticação local com localStorage.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly state = signal<AuthState>({ status: 'anonymous', user: null });
  private readonly oauthFailure = signal<string | null>(null);

  /** Estado de autenticação reativo (signal somente leitura). */
  readonly authState = computed(() => this.state());

  /** Erro assíncrono emitido pelo fluxo de callback OAuth, se houver. */
  readonly oauthError = computed(() => this.oauthFailure());

  private initPromise: Promise<void> | null = null;

  constructor() {
    configureAmplify();
    this.registerHubListener();
    // Restaura a sessão (ou conclui o redirect OAuth do Google) já na
    // inicialização do app, sem bloquear a renderização.
    this.ensureInitialized();
  }

  /** Garante que a verificação de sessão inicial já rodou (usado pelo guard). */
  ensureInitialized(): Promise<void> {
    this.initPromise ??= this.initialize();
    return this.initPromise;
  }

  /** Limpa mensagens de erro pendentes do fluxo OAuth. */
  clearOAuthError(): void {
    this.oauthFailure.set(null);
  }

  /** Login com e-mail e senha (usuário nativo do Cognito). */
  async signIn(email: string, password: string): Promise<void> {
    try {
      const result = await signIn({ username: email.trim(), password });

      if (!result.isSignedIn) {
        throw new Error(this.describeSignInStep(result.nextStep.signInStep));
      }

      await this.refreshUser();
    } catch (error) {
      if ((error as { name?: string })?.name === 'UserAlreadyAuthenticatedException') {
        await signOut();
        const retryResult = await signIn({ username: email.trim(), password });
        if (!retryResult.isSignedIn) {
          throw new Error(this.describeSignInStep(retryResult.nextStep.signInStep));
        }
        await this.refreshUser();
        return;
      }
      throw new Error(this.mapErrorMessage(error));
    }
  }

  /** Login social via Google OAuth (Hosted UI do Cognito, PKCE). */
  async signInWithGoogle(): Promise<void> {
    this.oauthFailure.set(null);

    try {
      // Redireciona o navegador para o Hosted UI; o fluxo é concluído
      // automaticamente quando o usuário retorna com `?code=...`.
      await signInWithRedirect({ provider: 'Google' });
    } catch (error) {
      if ((error as { name?: string })?.name === 'UserAlreadyAuthenticatedException') {
        await this.refreshUser();
        if (this.state().status === 'authenticated') {
          return;
        }
        await signInWithRedirect({
          provider: 'Google',
          options: { prompt: 'SELECT_ACCOUNT' },
        });
        return;
      }
      throw new Error(this.mapErrorMessage(error));
    }
  }

  /**
   * Registra um novo usuário nativo no Cognito.
   * Depois de chamar este método, o usuário recebe um código por e-mail
   * que deve ser confirmado com `confirmRegistration`.
   */
  async register(displayName: string, email: string, password: string): Promise<void> {
    try {
      await signUp({
        username: email.trim(),
        password,
        options: {
          userAttributes: {
            email: email.trim(),
            name: displayName.trim(),
          },
          // Ao confirmar o código, o usuário entra automaticamente.
          autoSignIn: { enabled: true },
        },
      });
    } catch (error) {
      throw new Error(this.mapErrorMessage(error));
    }
  }

  /** Confirma o cadastro com o código enviado por e-mail. */
  async confirmRegistration(email: string, code: string): Promise<void> {
    try {
      const { nextStep } = await confirmSignUp({
        username: email.trim(),
        confirmationCode: code.trim(),
      });

      if (nextStep.signUpStep !== 'DONE' && nextStep.signUpStep !== 'COMPLETE_AUTO_SIGN_IN') {
        throw new Error('Não foi possível confirmar o e-mail. Solicite um novo código.');
      }

      // Auto sign-in habilitado no cadastro: a sessão pode levar alguns
      // instantes para ser estabelecida após a confirmação.
      await this.establishSessionWithRetry();
    } catch (error) {
      throw new Error(this.mapErrorMessage(error));
    }
  }

  /** Reenvia o código de confirmação para o e-mail informado. */
  async resendConfirmationCode(email: string): Promise<void> {
    try {
      await resendSignUpCode({ username: email.trim() });
    } catch (error) {
      throw new Error(this.mapErrorMessage(error));
    }
  }

  /** Encerra a sessão no Cognito (inclusive a sessão OAuth do Google). */
  async logout(): Promise<void> {
    try {
      await signOut();
    } finally {
      this.state.set({ status: 'anonymous', user: null });
    }
  }

  /** Recarrega o usuário autenticado a partir do Cognito. */
  async refreshUser(): Promise<void> {
    const user = await this.loadAuthenticatedUser();
    this.state.set(user ? { status: 'authenticated', user } : { status: 'anonymous', user: null });
  }

  /**
   * Escuta eventos de autenticação do Amplify Hub para reagir à conclusão
   * (ou falha) assíncrona do fluxo OAuth (`signInWithRedirect`).
   */
  private registerHubListener(): void {
    Hub.listen('auth', ({ payload }) => {
      switch (payload.event) {
        case 'signInWithRedirect':
        case 'signedIn':
        case 'tokenRefresh':
          this.oauthFailure.set(null);
          void this.refreshUser();
          break;
        case 'signInWithRedirect_failure': {
          const rawError = (payload as { data?: { error?: unknown } }).data?.error;
          this.oauthFailure.set(this.mapOAuthErrorMessage(rawError));
          break;
        }
        case 'signedOut':
          this.state.set({ status: 'anonymous', user: null });
          break;
      }
    });
  }

  /** Tenta estabelecer a sessão algumas vezes (auto sign-in pós-confirmação). */
  private async establishSessionWithRetry(retries = 4, delayMs = 500): Promise<void> {
    for (let attempt = 0; attempt < retries; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, attempt * delayMs));
      await this.refreshUser();

      if (this.state().status === 'authenticated') {
        return;
      }
    }
  }

  /**
   * Restaura a sessão existente e conclui o fluxo OAuth (troca do
   * código de autorização), se a página foi carregada com `?code=...`.
   */
  private async initialize(): Promise<void> {
    try {
      await fetchAuthSession();
    } catch {
      // Usuário não autenticado — segue como anônimo.
    }

    await this.refreshUser();
  }

  private async loadAuthenticatedUser(): Promise<User | null> {
    try {
      const session = await fetchAuthSession();
      const idTokenPayload = session.tokens?.idToken?.payload as
        | Record<string, unknown>
        | undefined;

      let currentUserId: string | undefined;
      let currentUsername: string | undefined;
      try {
        const currentUser = await getCurrentUser();
        currentUserId = currentUser.userId;
        currentUsername = currentUser.username;
      } catch {
        // Caso getCurrentUser falhe mas o idToken esteja válido na sessão.
      }

      // No login via Google OAuth com escopos ['openid', 'email', 'profile'],
      // o AccessToken não possui o escopo 'aws.cognito.signin.user.admin'.
      // Chamar fetchUserAttributes() (API GetUser do Cognito) sem esse escopo
      // lança NotAuthorizedException ("Access Token does not have required scopes").
      // Por isso, lemos as claims OIDC diretamente do ID Token e só consultamos
      // fetchUserAttributes() como fallback opcional se necessário.
      let attributes: Partial<Record<string, string>> = {};
      if (!idTokenPayload?.['email']) {
        try {
          attributes = await fetchUserAttributes();
        } catch {
          // Ignora falha de escopo do GetUser quando autenticado via OAuth.
        }
      }

      const sub =
        (typeof idTokenPayload?.['sub'] === 'string' ? idTokenPayload['sub'] : undefined) ??
        attributes['sub'] ??
        currentUserId;

      const email =
        (typeof idTokenPayload?.['email'] === 'string' ? idTokenPayload['email'] : undefined) ??
        attributes['email'] ??
        currentUserId;

      if (!sub || !email) {
        return null;
      }

      const tokenName =
        (typeof idTokenPayload?.['name'] === 'string' ? idTokenPayload['name'] : undefined) ||
        (typeof idTokenPayload?.['given_name'] === 'string'
          ? idTokenPayload['given_name']
          : undefined) ||
        (typeof idTokenPayload?.['preferred_username'] === 'string'
          ? idTokenPayload['preferred_username']
          : undefined) ||
        (typeof idTokenPayload?.['nickname'] === 'string'
          ? idTokenPayload['nickname']
          : undefined);

      const displayName =
        tokenName ||
        attributes['name'] ||
        attributes['preferred_username'] ||
        attributes['nickname'] ||
        (email.includes('@') ? email.split('@')[0] : email);

      const provider = this.detectProvider(idTokenPayload, attributes, currentUsername);

      const emailVerifiedClaim = idTokenPayload?.['email_verified'] ?? attributes['email_verified'];
      const emailVerified =
        emailVerifiedClaim === true ||
        emailVerifiedClaim === 'true' ||
        (provider === 'google' && emailVerifiedClaim !== false && emailVerifiedClaim !== 'false');

      return {
        id: sub,
        email,
        displayName,
        emailVerified,
        provider,
      };
    } catch {
      return null;
    }
  }

  private detectProvider(
    idTokenPayload: Record<string, unknown> | undefined,
    attributes: Partial<Record<string, string | undefined>>,
    username?: string,
  ): AuthProvider {
    const rawIdentities = idTokenPayload?.['identities'] ?? attributes['identities'];

    if (Array.isArray(rawIdentities)) {
      if (
        rawIdentities.some(
          (identity) =>
            typeof identity === 'object' &&
            identity !== null &&
            (identity as { providerName?: string }).providerName?.toLowerCase() === 'google',
        )
      ) {
        return 'google';
      }
    } else if (typeof rawIdentities === 'string') {
      try {
        const parsed = JSON.parse(rawIdentities) as Array<{ providerName?: string }>;
        if (parsed.some((identity) => identity.providerName?.toLowerCase() === 'google')) {
          return 'google';
        }
      } catch {
        // Campo malformado — segue para verificação pelo username.
      }
    }

    const cognitoUsername =
      (typeof idTokenPayload?.['cognito:username'] === 'string'
        ? idTokenPayload['cognito:username']
        : undefined) ?? username;

    if (cognitoUsername?.toLowerCase().startsWith('google_')) {
      return 'google';
    }

    return 'cognito';
  }

  private describeSignInStep(step: string): string {
    switch (step) {
      case 'CONFIRM_SIGN_UP':
        return 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.';
      case 'NEW_PASSWORD_REQUIRED':
        return 'É necessário redefinir sua senha antes de entrar.';
      default:
        return `Não foi possível concluir o login (etapa pendente: ${step}).`;
    }
  }

  private mapOAuthErrorMessage(error: unknown): string {
    const message = (error as Error)?.message ?? String(error ?? '');
    if (message.includes('cancelled') || message.includes('canceled') || message.includes('access_denied')) {
      return 'O login com o Google foi cancelado ou negado.';
    }
    return 'Não foi possível concluir o login com o Google. Tente novamente.';
  }

  private mapErrorMessage(error: unknown): string {
    const errorName = (error as { name?: string })?.name ?? '';

    if (errorName && FRIENDLY_ERROR_MESSAGES[errorName]) {
      return FRIENDLY_ERROR_MESSAGES[errorName];
    }

    const message = (error as Error)?.message;
    if (message && !message.startsWith('access_denied')) {
      return message;
    }

    return 'Ocorreu um erro inesperado. Tente novamente em instantes.';
  }
}
