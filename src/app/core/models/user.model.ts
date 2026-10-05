export type AuthProvider = 'cognito' | 'google';

export interface User {
  /** Identificador único do usuário no Cognito (atributo `sub`). */
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  /** Origem da autenticação: conta nativa (e-mail/senha) ou Google. */
  provider: AuthProvider;
}
