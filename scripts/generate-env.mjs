/**
 * Gera o arquivo `src/environments/environment.ts` a partir das
 * variáveis de ambiente.
 *
 * Fontes (em ordem de prioridade):
 *   1. Variáveis de ambiente do processo (definidas no console da AWS
 *      Amplify, por exemplo).
 *   2. Arquivo `.env` na raiz do projeto (desenvolvimento local).
 *
 * Arquivos `.env` NUNCA são versionados no git.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const ENV_FILE_PATH = resolve(PROJECT_ROOT, '.env');
const OUTPUT_PATH = resolve(PROJECT_ROOT, 'src/environments/environment.ts');

const REQUIRED_KEYS = [
  'NG_APP_COGNITO_USER_POOL_ID',
  'NG_APP_COGNITO_USER_POOL_CLIENT_ID',
  'NG_APP_COGNITO_DOMAIN',
  'NG_APP_OAUTH_REDIRECT_SIGN_IN',
  'NG_APP_OAUTH_REDIRECT_SIGN_OUT',
];

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const variables = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    variables[key] = value;
  }

  return variables;
}

/** Remove protocolo e barra final do domínio do Hosted UI. */
function cleanDomain(rawDomain) {
  return rawDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/** Converte "url1,url2" em ['url1', 'url2']. */
function splitList(rawValue) {
  return rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readValue(key, fileVariables) {
  return process.env[key] ?? fileVariables[key] ?? '';
}

const fileVariables = parseEnvFile(ENV_FILE_PATH);
const values = Object.fromEntries(REQUIRED_KEYS.map((key) => [key, readValue(key, fileVariables)]));

const missing = REQUIRED_KEYS.filter((key) => !values[key]);
if (missing.length > 0) {
  console.warn(
    `[generate-env] ATENÇÃO: variáveis de ambiente ausentes: ${missing.join(', ')}.\n` +
      '[generate-env] Crie um arquivo .env (veja .env.example) ou configure as variáveis no console do Amplify.',
  );
}

const environment = {
  cognito: {
    userPoolId: values.NG_APP_COGNITO_USER_POOL_ID,
    userPoolClientId: values.NG_APP_COGNITO_USER_POOL_CLIENT_ID,
    oauthDomain: cleanDomain(values.NG_APP_COGNITO_DOMAIN),
    redirectSignIn: splitList(values.NG_APP_OAUTH_REDIRECT_SIGN_IN || 'http://localhost:4200/login'),
    redirectSignOut: splitList(values.NG_APP_OAUTH_REDIRECT_SIGN_OUT || 'http://localhost:4200/'),
  },
};

const output = `// GERADO AUTOMATICAMENTE por scripts/generate-env.mjs — não edite manualmente.
// Os valores vêm do arquivo .env (local) ou das variáveis de ambiente do processo (CI/Amplify).

export const environment = ${JSON.stringify(environment, null, 2)};
`;

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, output);

console.log(`[generate-env] ${OUTPUT_PATH} gerado com sucesso.`);
