import { parentPort, workerData } from 'node:worker_threads';
import { createStore } from '../../lib/store.mjs';
import { createApplication } from '../../server.mjs';
import { bootstrap } from './http.mjs';

const store = await createStore(workerData.filename);
const app = await createApplication({ store, origin: 'http://127.0.0.1', sessionSecret: 'fictional-stable-session-secret', passwords: bootstrap });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
parentPort.postMessage(app.server.address().port);
parentPort.once('message', async () => {
  await new Promise(resolve => app.server.close(resolve)); await store.close(); parentPort.close();
});
