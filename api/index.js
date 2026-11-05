import { createApplication } from '../server.mjs';
import { createStore } from '../lib/store.mjs';
import { t } from '../public/i18n.js';

let applicationPromise;
async function application() {
  for (const key of ['TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','SESSION_SECRET']) {
    if (!process.env[key]) throw new Error('Configuração de servidor incompleta.');
  }
  const store = await createStore(process.env.TURSO_DATABASE_URL, { authToken: process.env.TURSO_AUTH_TOKEN });
  const testMode = process.env.REVIEW_DATA === '1';
  if (testMode) await store.seedDemo();
  const allowedOrigins = [...new Set([process.env.APP_ORIGIN, ...[process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map(host => `https://${host}`)].filter(Boolean))];
  if (!allowedOrigins.length) throw new Error('Origem da aplicação não configurada.');
  return createApplication({ store, allowedOrigins, origin: allowedOrigins[0], testMode, sessionSecret: process.env.SESSION_SECRET,
    passwords: { lisboa: process.env.LISBOA_ADMIN_PASSWORD, porto: process.env.PORTO_ADMIN_PASSWORD },
    roomCodes: { lisboa: process.env.LISBOA_ROOM_CODE, porto: process.env.PORTO_ROOM_CODE },
  });
}
export default async function handler(request, response) {
  try {
    applicationPromise ||= application();
    const app = await applicationPromise;
    const route = request.query?.route;
    if (route) {
      // Keep proposal selection and other query parameters when undoing the rewrite.
      const url = new URL(request.url, 'http://localhost');
      url.pathname = `/api/${Array.isArray(route) ? route.join('/') : route}`;
      url.searchParams.delete('route');
      request.url = `${url.pathname}${url.search}`;
    }
    await app.handler(request,response);
  } catch(error) {
    applicationPromise = undefined;
    // Log only a technical category; never SQL, credentials, IPs, or request bodies.
    console.error('application_unavailable', error.code || error.name || 'Error');
    response.setHeader('Cache-Control','no-store');
    response.setHeader('Content-Type','application/json; charset=utf-8');
    response.statusCode = 503;
    response.end(JSON.stringify({error:t('nao_foi_possivel_concluir_o')}));
  }
}
