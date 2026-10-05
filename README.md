# RANDANDAN

Jogo de adivinhação de motos esportivas — landing page e aplicação em [Angular 22](https://angular.dev) com autenticação via **AWS Cognito** (e-mail/senha + Google OAuth).

## Desenvolvimento local

```bash
# 1. Instalar dependências
npm install

# 2. Configurar as variáveis de ambiente (Cognito/OAuth)
cp .env.example .env   # preencha com os valores do seu User Pool

# 3. Rodar o servidor de desenvolvimento
npm start
```

O app fica disponível em `http://localhost:4200/`.

> O arquivo `.env` **não é versionado**. Antes de `start`/`build`/`test`, o script
> `scripts/generate-env.mjs` lê o `.env` (ou variáveis de ambiente do processo) e gera
> o `src/environments/environment.ts`, que também não vai para o git.

## Autenticação (AWS Cognito + Google OAuth)

- **E-mail/senha**: cadastro nativo com confirmação de código por e-mail (auto sign-in habilitado).
- **Google OAuth**: via Hosted UI do Cognito com Authorization Code + PKCE (`signInWithRedirect`).

Nenhum login local (localStorage) é usado: a sessão é gerenciada inteiramente pelo SDK `aws-amplify/auth`.

### Checklist de configuração no console AWS Cognito

1. **User Pool** com login por e-mail e provedor federado **Google**
   (Client ID/Secret do Google são configurados **apenas aqui**, nunca no código).
2. **App integration > Domain**: domínio do Hosted UI (ex.: `xxx.auth.us-east-1.amazoncognito.com`).
3. **App client** (tipo SPA, sem client secret) com Hosted UI habilitado:
   - **Allowed callback URLs**: `http://localhost:4200/login`, `https://SEU-DOMINIO/login`
   - **Allowed sign-out URLs**: `http://localhost:4200/`, `https://SEU-DOMINIO/`
   - **Identity providers**: Google (e Cognito user pool)
   - **OAuth grant type**: Authorization code grant
   - **OAuth scopes**: `openid`, `email`, `profile`
4. **Política de senha** (padrão): mínimo de 8 caracteres com maiúscula, minúscula, número e símbolo.

### Variáveis de ambiente (`.env`)

| Chave | Descrição |
|---|---|
| `NG_APP_COGNITO_USER_POOL_ID` | ID do User Pool (`us-east-1_xxxxx`) |
| `NG_APP_COGNITO_USER_POOL_CLIENT_ID` | ID do App Client (SPA) |
| `NG_APP_COGNITO_DOMAIN` | Domínio do Hosted UI (sem `https://`) |
| `NG_APP_OAUTH_REDIRECT_SIGN_IN` | URLs de callback, separadas por vírgula |
| `NG_APP_OAUTH_REDIRECT_SIGN_OUT` | URLs de logout, separadas por vírgula |

Em produção (AWS Amplify Hosting), configure as mesmas chaves em
**App settings > Environment variables** — o script `generate-env.mjs` lê
as variáveis do processo durante o build.

## Build de produção

```bash
npm run build
```

Os artefatos ficam em `dist/RANDANDAN/browser` (configurado no `amplify.yml`).

## Testes unitários

```bash
npm test
```

Executa os testes com [Vitest](https://vitest.dev/).
