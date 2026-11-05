import { createServer } from 'node:http';

// Exercise the production entry point with a local database and fictitious credentials.
export async function createHostedServer({ filename = ':memory:', origin, passwords }) {
  Object.assign(process.env, {
    TURSO_DATABASE_URL: filename,
    TURSO_AUTH_TOKEN: 'fictional-local-token',
    SESSION_SECRET: 'fictional-hosted-test-session-secret',
    APP_ORIGIN: origin,
    VERCEL_URL: '', VERCEL_PROJECT_PRODUCTION_URL: '', REVIEW_DATA: '0',
    LISBOA_ADMIN_PASSWORD: passwords.lisboa, PORTO_ADMIN_PASSWORD: passwords.porto,
    LISBOA_ROOM_CODE: '', PORTO_ROOM_CODE: '',
  });
  const { default: handler } = await import('../../api/index.js');
  return createServer((request, response) => {
    const url = new URL(request.url, origin);
    if (url.pathname.startsWith('/api/')) {
      // Model vercel.json's rewrite, preserving the incoming query alongside route.
      url.searchParams.set('route', url.pathname.slice('/api/'.length));
      request.query = Object.fromEntries(url.searchParams);
      request.url = `/api/index?${url.searchParams}`;
    }
    return handler(request, response);
  });
}
