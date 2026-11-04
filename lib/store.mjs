import { createHash } from 'node:crypto';
import { t } from '../public/i18n.js';

export const CHOICES = ['favor', 'against', 'abstain'];
export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const labels = { favor: t('a_favor'), against: t('contra'), abstain: t('abstencao') };
export function validateCounts(raw) {
  const counts = {};
  for (const key of CHOICES) {
    if (!/^(0|[1-9]\d*)$/.test(String(raw[key] ?? ''))) throw new AppError(t('introduza_um_numero_inteiro_igual', { v0: labels[key] }));
    counts[key] = Number(raw[key]);
    if (!Number.isSafeInteger(counts[key]) || counts[key] > 1000000) throw new AppError(t('o_maximo_e_1_000', { v0: labels[key] }));
  }
  return counts;
}
const schema = [
  'CREATE TABLE IF NOT EXISTS assemblies (slug TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)',
  `CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT, assembly TEXT NOT NULL REFERENCES assemblies(slug),
    title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
    supports INTEGER NOT NULL DEFAULT 0 CHECK(supports >= 0),
    status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','open','closed')),
    digital_favor INTEGER NOT NULL DEFAULT 0, digital_against INTEGER NOT NULL DEFAULT 0, digital_abstain INTEGER NOT NULL DEFAULT 0,
    in_person_favor INTEGER NOT NULL DEFAULT 0, in_person_against INTEGER NOT NULL DEFAULT 0, in_person_abstain INTEGER NOT NULL DEFAULT 0,
    in_person_recorded INTEGER NOT NULL DEFAULT 0, count_version INTEGER NOT NULL DEFAULT 0, closed_order INTEGER
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS one_open_per_assembly ON proposals(assembly) WHERE status = 'open'",
  'CREATE INDEX IF NOT EXISTS proposals_assembly ON proposals(assembly)',
  'CREATE TABLE IF NOT EXISTS active_vote_receipts (proposal INTEGER NOT NULL REFERENCES proposals(id), token_hash TEXT NOT NULL, PRIMARY KEY(proposal,token_hash))',
  'CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, assembly TEXT NOT NULL REFERENCES assemblies(slug), expires INTEGER NOT NULL, binding TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS session_expiry ON admin_sessions(expires)',
  'CREATE TABLE IF NOT EXISTS access_attempts (scope TEXT NOT NULL, minute INTEGER NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY(scope,minute))',
  "INSERT OR IGNORE INTO assemblies(slug,name) VALUES ('lisboa','Assembleia de Lisboa'),('porto','Assembleia do Porto')",
];
const execute = (connection, sql, ...args) => connection.execute({ sql, args });
const get = async (connection, sql, ...args) => (await execute(connection, sql, ...args)).rows[0];
const all = async (connection, sql, ...args) => (await execute(connection, sql, ...args)).rows.map(row => ({ ...row }));
const receiptHash = token => {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new AppError(t('a_autorizacao_temporaria_deste_navegador'));
  return createHash('sha256').update(token).digest('hex');
};

export async function createStore(filename = ':memory:', { authToken } = {}) {
  const remote = /^(libsql|https?):/.test(filename);
  const { createClient } = await import(remote ? '@libsql/client/web' : '@libsql/client');
  const client = createClient({ url: remote || filename === ':memory:' || filename.startsWith('file:') ? filename : `file:${filename}`, ...(remote ? { authToken } : {}) });
  if (!remote) { await client.execute('PRAGMA journal_mode = WAL'); await client.execute('PRAGMA busy_timeout = 5000'); }
  await client.batch(schema, 'write');
  // Serialize operations on this connection. Across instances, BEGIN IMMEDIATE and
  // database constraints enforce the same conditions independently of memory locks.
  let queue = Promise.resolve();
  const transaction = (fn, mode = 'write') => {
    const result = queue.then(async () => {
      const connection = await client.transaction(mode);
      try { const value = await fn(connection); await connection.commit(); return value; }
      catch(error) { if (!connection.closed) await connection.rollback(); throw error; }
      finally { connection.close(); }
    });
    queue = result.catch(() => {}); return result;
  };
  const assembly = async (connection, slug) => {
    const row = await get(connection, 'SELECT * FROM assemblies WHERE slug = ?', slug);
    if (!row) throw new AppError(t('assembleia_nao_encontrada'), 404); return { ...row };
  };
  const proposal = async (connection, slug, id) => {
    await assembly(connection, slug);
    const row = await get(connection, 'SELECT * FROM proposals WHERE assembly = ? AND id = ?', slug, id);
    if (!row) throw new AppError(t('proposta_nao_encontrada_nesta_assembleia'), 404); return row;
  };
  const bump = (connection, slug) => execute(connection, 'UPDATE assemblies SET revision = revision + 1 WHERE slug = ?', slug);
  const requireOpen = async (connection, slug, id) => {
    const row = await proposal(connection, slug, id);
    if (row.status !== 'open') throw new AppError(t('a_votacao_nao_esta_aberta'), 409); return row;
  };
  return {
    remote,
    listAssemblies: () => transaction(connection => all(connection, 'SELECT slug,name FROM assemblies ORDER BY slug'), 'read'),
    snapshot: (slug, { admin = false } = {}) => transaction(async connection => ({
      assembly: await assembly(connection, slug),
      proposals: (await all(connection, 'SELECT * FROM proposals WHERE assembly = ? ORDER BY id', slug)).map(row => {
        const item = { id: row.id, title: row.title, description: row.description, category: row.category, supports: row.supports, status: row.status, closedOrder: row.closed_order };
        if (row.status === 'closed') {
          item.digital = Object.fromEntries(CHOICES.map(key => [key, row[`digital_${key}`]]));
          item.inPerson = Object.fromEntries(CHOICES.map(key => [key, row[`in_person_${key}`]]));
        }
        if (admin && row.status === 'open') {
          item.inPerson = Object.fromEntries(CHOICES.map(key => [key, row[`in_person_${key}`]]));
          item.inPersonRecorded = Boolean(row.in_person_recorded); item.countVersion = row.count_version;
        }
        return item;
      }),
    }), 'read'),
    submit: (slug, raw) => transaction(async connection => {
      await assembly(connection, slug);
      const title = String(raw.title ?? '').trim(), description = String(raw.description ?? '').trim();
      if (title.length < 8 || title.length > 120) throw new AppError(t('escreva_um_titulo_entre_8'));
      if (description.length < 20 || description.length > 1200) throw new AppError(t('descreva_a_proposta_com_20'));
      if (!['Espaço comum','Entreajuda','Atividades','Outros'].includes(raw.category)) throw new AppError(t('escolha_um_tema_para_a'));
      const result = await execute(connection, 'INSERT INTO proposals(assembly,title,description,category) VALUES (?,?,?,?)', slug, title, description, raw.category);
      await bump(connection, slug); return { id: Number(result.lastInsertRowid) };
    }),
    support: (slug, id) => transaction(async connection => {
      if ((await proposal(connection, slug, id)).status !== 'waiting') throw new AppError(t('os_apoios_a_discussao_estao'), 409);
      await execute(connection, 'UPDATE proposals SET supports = supports + 1 WHERE assembly = ? AND id = ?', slug, id); await bump(connection, slug);
    }),
    open: (slug, id) => transaction(async connection => {
      if ((await proposal(connection, slug, id)).status !== 'waiting') throw new AppError(t('so_pode_abrir_uma_proposta'), 409);
      if (await get(connection, "SELECT id FROM proposals WHERE assembly = ? AND status = 'open'", slug)) throw new AppError(t('feche_a_votacao_em_curso'), 409);
      await execute(connection, "UPDATE proposals SET status = 'open' WHERE assembly = ? AND id = ?", slug, id); await bump(connection, slug);
    }),
    voteRecorded: (slug, id, token) => transaction(async connection => {
      await requireOpen(connection, slug, id);
      return Boolean(await get(connection, 'SELECT 1 FROM active_vote_receipts WHERE proposal = ? AND token_hash = ?', id, receiptHash(token)));
    }, 'read'),
    vote: (slug, id, choice, token) => transaction(async connection => {
      await requireOpen(connection, slug, id);
      if (!CHOICES.includes(choice)) throw new AppError(t('escolha_a_favor_contra_ou'));
      const hash = receiptHash(token);
      if (await get(connection, 'SELECT 1 FROM active_vote_receipts WHERE proposal = ? AND token_hash = ?', id, hash)) return { alreadyRecorded: true };
      await execute(connection, 'INSERT INTO active_vote_receipts(proposal,token_hash) VALUES (?,?)', id, hash);
      await execute(connection, `UPDATE proposals SET digital_${choice} = digital_${choice} + 1 WHERE assembly = ? AND id = ?`, slug, id);
      await bump(connection, slug); return { alreadyRecorded: false };
    }),
    saveCounts: (slug, id, raw) => transaction(async connection => {
      const row = await requireOpen(connection, slug, id), counts = validateCounts(raw);
      if (!Number.isInteger(raw.version) || row.count_version !== raw.version) throw new AppError(t('a_contagem_foi_alterada_noutra'), 409);
      await execute(connection, 'UPDATE proposals SET in_person_favor = ?, in_person_against = ?, in_person_abstain = ?, in_person_recorded = 1, count_version = count_version + 1 WHERE assembly = ? AND id = ?', counts.favor, counts.against, counts.abstain, slug, id); await bump(connection, slug);
    }),
    closeVoting: (slug, id, raw) => transaction(async connection => {
      const row = await requireOpen(connection, slug, id);
      if (!row.in_person_recorded) throw new AppError(t('guarde_a_contagem_presencial_mesmo'), 409);
      if (!Number.isInteger(raw.version) || row.count_version !== raw.version) throw new AppError(t('a_contagem_mudou_reveja_os'), 409);
      await execute(connection, "UPDATE proposals SET status = 'closed', closed_order = (SELECT revision + 1 FROM assemblies WHERE slug = ?) WHERE assembly = ? AND id = ?", slug, slug, id);
      await execute(connection, 'DELETE FROM active_vote_receipts WHERE proposal = ?', id); await bump(connection, slug);
    }),
    getSession: hash => transaction(connection => get(connection, 'SELECT assembly AS slug, expires, binding FROM admin_sessions WHERE token_hash = ? AND expires > ?', hash, Date.now()), 'read'),
    saveSession: (hash, slug, expires, binding) => transaction(async connection => {
      await execute(connection, 'DELETE FROM admin_sessions WHERE expires <= ?', Date.now());
      const row = await get(connection, 'SELECT count(*) AS total FROM admin_sessions');
      if (row.total >= 100) throw new AppError(t('limite_de_sessoes_da_mesa'), 429);
      await execute(connection, 'INSERT INTO admin_sessions(token_hash,assembly,expires,binding) VALUES (?,?,?,?)', hash, slug, expires, binding);
    }),
    deleteSession: hash => transaction(connection => execute(connection, 'DELETE FROM admin_sessions WHERE token_hash = ?', hash)),
    reserveAttempt: (slug, kind, limit) => transaction(async connection => {
      const minute = Math.floor(Date.now()/60000), scope = `${slug}:${kind}`;
      await execute(connection, 'DELETE FROM access_attempts WHERE minute < ?', minute);
      const row = await get(connection, 'SELECT attempts FROM access_attempts WHERE scope = ? AND minute = ?', scope, minute);
      if ((row?.attempts || 0) >= limit) throw new AppError(t('demasiadas_tentativas_nesta_assembleia_aguarde'), 429);
      await execute(connection, 'INSERT INTO access_attempts(scope,minute,attempts) VALUES (?,?,1) ON CONFLICT(scope,minute) DO UPDATE SET attempts = attempts + 1', scope, minute);
    }),
    seedDemo: () => transaction(async connection => {
      for (const slug of ['lisboa','porto']) {
        if (await get(connection,'SELECT id FROM proposals WHERE assembly = ? LIMIT 1',slug)) continue;
        const examples = [
          ['Mais sombra no espaço da assembleia','Instalar toldos amovíveis na zona de encontro, com uma jornada coletiva de montagem e materiais reutilizados sempre que possível.','Espaço comum',24],
          ['Uma cozinha comunitária, uma vez por semana','Experimentar um almoço partilhado aos domingos. Formar um grupo de trabalho para organizar o espaço, os alimentos e a limpeza.','Entreajuda',18],
          ['Oficinas abertas de reparação','Reservar uma tarde por mês para partilhar ferramentas e aprender a reparar bicicletas, roupa e pequenos objetos.','Atividades',12],
        ];
        for (const [title,description,category,supports] of examples) await execute(connection,'INSERT INTO proposals(assembly,title,description,category,supports) VALUES (?,?,?,?,?)',slug,title,description,category,supports);
        await bump(connection,slug);
      }
    }),
    close: async () => { await queue; client.close(); },
  };
}
