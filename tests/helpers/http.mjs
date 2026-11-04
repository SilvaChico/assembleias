import { request as httpRequest } from 'node:http';
import { createApplication } from '../../server.mjs';
import { createStore } from '../../lib/store.mjs';

export const bootstrap = { lisboa: 'fictional-lisboa-bootstrap', porto: 'fictional-porto-bootstrap' };
export const chosen = 'fictional-chosen-passphrase';
export async function start(t, options = {}) {
  const { filename, ...settings } = options;
  const store = settings.store || await createStore(filename);
  const app = await createApplication({ store, origin: 'http://127.0.0.1', sessionSecret: 'fictional-stable-session-secret', passwords: bootstrap, ...settings });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await new Promise(resolve => app.server.close(resolve)); await store.close();
  };
  t.after(stop);
  return { ...app, stop, ...requests(app.server.address().port) };
}
export function requests(port) {
  const request = (path, { body, cookie, origin = 'http://127.0.0.1' } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: port, path,
      method: body === undefined ? 'GET' : 'POST',
      headers: { host: '127.0.0.1', origin, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()), cookie: res.headers['set-cookie']?.[0]?.split(';')[0] }));
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const login = (slug = 'lisboa', password = bootstrap[slug]) => request(`/api/assemblies/${slug}/admin/login`, { body: { username: 'mesa', password } });
  const replace = (cookie, password = chosen, extra = {}, slug = 'lisboa') => request(`/api/assemblies/${slug}/admin/password`, { cookie, body: { password, confirmation: password, ...extra } });
  const session = (cookie, slug = 'lisboa') => request(`/api/assemblies/${slug}/admin/session`, { cookie });
  return { request, login, replace, session };
}
