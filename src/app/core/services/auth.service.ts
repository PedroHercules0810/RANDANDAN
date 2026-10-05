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

  /** Estado de autenticação reativo (signal somente leitura). */
  readonly authState = computed(() => this.state());

  private initPromise: Promise<void> | null = null;

  constructor() {
    configureAmplify();
    // Restaura a sessão (ou conclui o redirect OAuth do Google) já na
    // inicialização do app, sem bloquear a renderização.
    this.ensureInitialized();
  }

  /** Garante que a verificação de sessão inicial já rodou (usado pelo guard). */
  ensureInitialized(): Promise<void> {
    this.initPromise ??= this.initialize();
    return this.initPromise;
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
      throw new Error(this.mapErrorMessage(error));
    }
  }

  /** Login social via Google OAuth (Hosted UI do Cognito, PKCE). */
  async signInWithGoogle(): Promise<void> {
    try {
      // Redireciona o navegador para o Hosted UI; o fluxo é concluído
      // automaticamente em ensureInitialized() quando o usuário volta.
      await signInWithRedirect({ provider: 'Google' });
    } catch (error) {
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
      const currentUser = await getCurrentUser();
      const attributes = await fetchUserAttributes();

      const email = attributes.email ?? currentUser.userId;
      if (!email) {
        return null;
      }

      return {
        id: attributes.sub ?? currentUser.userId,
        email,
        displayName:
          attributes.name ||
          attributes.preferred_username ||
          attributes.nickname ||
          email.split('@')[0],
        emailVerified: attributes.email_verified === 'true',
        provider: this.detectProvider(attributes),
      };
    } catch {
      return null;
    }
  }

  private detectProvider(attributes: Partial<Record<string, string | undefined>>): AuthProvider {
    const identities = attributes['identities'];
    if (typeof identities === 'string') {
      try {
        const parsed = JSON.parse(identities) as Array<{ providerName?: string }>;
        if (parsed.some((identity) => identity.providerName?.toLowerCase() === 'google')) {
          return 'google';
        }
      } catch {
        // Campo malformado — trata como conta nativa.
      }
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
