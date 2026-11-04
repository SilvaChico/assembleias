import { parentPort, workerData } from 'node:worker_threads';
import { createStore } from '../../lib/store.mjs';
import { createApplication } from '../../server.mjs';

const candidates = ['ABCD', 'EFGH', 'IJKL'];
const store = await createStore(workerData.filename, { voteCodeGenerator: () => candidates.shift() || 'MNOP' });
await store.open(workerData.room, workerData.proposal);
const app = await createApplication({ store, origin: 'http://127.0.0.1', sessionSecret: 'fictional-shared-vote-secret' });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
parentPort.postMessage(app.server.address().port);
parentPort.once('message', async () => {
  await new Promise(resolve => app.server.close(resolve)); await store.close(); parentPort.close();
});
