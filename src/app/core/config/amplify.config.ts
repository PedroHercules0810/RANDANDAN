import { Amplify } from 'aws-amplify';
import 'aws-amplify/auth/enable-oauth-listener';
import type { ResourcesConfig } from 'aws-amplify';
import { environment } from '../../../environments/environment';

let configured = false;

/**
 * Remove barra final de rotas internas (ex.: `/login/?code=...` -> `/login?code=...`)
 * adicionada pelo redirect 301 do S3/CloudFront no AWS Amplify Hosting, garantindo
 * que o `redirect_uri` calculado pelo SDK bata com o cadastrado no Cognito.
 */
function normalizePathnameBeforeOAuth(): void {
  if (typeof window === 'undefined' || !window.location || !window.history) {
    return;
  }

  const { pathname, search, hash } = window.location;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    const normalizedPath = pathname.replace(/\/+$/, '');
    window.history.replaceState(window.history.state, '', `${normalizedPath}${search}${hash}`);
  }
}

/**
 * Configura o AWS Amplify (Cognito) uma única vez.
 *
 * Os valores vêm de `src/environments/environment.ts`, que é gerado
 * a partir do `.env` por `scripts/generate-env.mjs` — dados de
 * configuração nunca ficam fixados no código-fonte.
 *
 * O Google Client Secret NUNCA é usado aqui: ele é configurado
 * apenas no console do Cognito (provedor de identidade Google).
 */
export function configureAmplify(): void {
  if (configured) {
    return;
  }
  configured = true;

  normalizePathnameBeforeOAuth();

  const { userPoolId, userPoolClientId, oauthDomain, redirectSignIn, redirectSignOut } =
    environment.cognito;

  if (!userPoolId || !userPoolClientId || !oauthDomain) {
    console.error(
      '[RANDANDAN] Configuração do Cognito ausente. ' +
        'Crie um arquivo .env (veja .env.example) e rode "npm start" ou "npm run build".',
    );
    return;
  }

  const authConfig: ResourcesConfig = {
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: {
          email: true,
          oauth: {
            domain: oauthDomain,
            scopes: ['openid', 'email', 'profile'],
            redirectSignIn: [...redirectSignIn],
            redirectSignOut: [...redirectSignOut],
            responseType: 'code',
          },
        },
      },
    },
  };

  Amplify.configure(authConfig);
}
