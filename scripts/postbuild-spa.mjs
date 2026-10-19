/**
 * Copia o `index.html` gerado pelo build do Angular para cada rota
 * estática da SPA (`login/index.html`, `perfil/index.html`, etc.).
 *
 * Isso evita que o S3/CloudFront do AWS Amplify Hosting retorne
 * HTTP 404 quando o Cognito redireciona o callback OAuth para `/login?code=...`
 * ou quando o usuário recarrega uma rota diretamente.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BROWSER_DIST = resolve(import.meta.dirname, '../dist/RANDANDAN/browser');
const INDEX_HTML = resolve(BROWSER_DIST, 'index.html');

const SPA_ROUTES = [
  'login',
  'cadastro',
  'perfil',
  'equipe',
  'funcionalidades',
  'como-jogar',
];

if (!existsSync(INDEX_HTML)) {
  console.warn(`[postbuild-spa] ${INDEX_HTML} não encontrado — pulando cópia de rotas.`);
  process.exit(0);
}

for (const route of SPA_ROUTES) {
  const routeDir = resolve(BROWSER_DIST, route);
  mkdirSync(routeDir, { recursive: true });
  copyFileSync(INDEX_HTML, resolve(routeDir, 'index.html'));
}

copyFileSync(INDEX_HTML, resolve(BROWSER_DIST, '404.html'));
console.log(`[postbuild-spa] Rotas SPA geradas em ${BROWSER_DIST}: ${SPA_ROUTES.join(', ')}.`);
