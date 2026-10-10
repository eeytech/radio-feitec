const { Pool } = require('pg');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let pool;
const initial = () => ({ pedidos: [], sugestoes: [], transmissao: null });
// Modo de demonstração escolar: funciona sem serviços ou variáveis externas.
let demoState = initial();
const demoInstance = crypto.randomUUID();
const password = process.env.RADIO_SENHA || 'radio123';
const tokenSecret = process.env.RADIO_TOKEN_SECRET || 'radio-conect-demonstracao-escolar-v1';
const catalog = vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '../musicas/catalogo.js'), 'utf8') + '\nMUSICAS;'
);
function signature(value) {
  return crypto.createHmac('sha256', tokenSecret).update(value).digest('hex');
}
function authenticated(req) {
  const token = req.headers.authorization || '';
  const [expires, nonce, hash] = token.split('.');
  if (!expires || !nonce || !hash || Number(expires) <= Date.now()) return false;
  const expected = signature(`${expires}.${nonce}`);
  return hash.length === expected.length && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected));
}
function fail(message, status = 400) {
  const error = new Error(message); error.status = status; throw error;
}
function mutate(state, route, data) {
  if (route === 'pedir' || route === 'sugerir') {
    const nome = typeof data.nome === 'string' ? data.nome.trim() : '';
    const musica = typeof data.musica === 'string' ? data.musica.trim() : '';
    if (!nome || nome.length > 100 || !musica || musica.length > 200) fail('Informe a música e seu nome.');
    const item = { id: crypto.randomUUID(), nome, musica, status: 'pendente' };
    if (route === 'pedir') {
      if (!catalog.some(m => m.nome === musica && m.arquivo === data.arquivo)) fail('Selecione uma música cadastrada.');
      item.arquivo = data.arquivo;
    }
    state[route === 'pedir' ? 'pedidos' : 'sugestoes'].push(item);
  } else if (route === 'tocar') {
    const item = state.pedidos.find(x => x.id === data.id);
    if (!item) fail('Pedido não encontrado.', 404);
    state.pedidos.forEach(x => { x.status = x.id === item.id ? 'tocando' : 'pendente'; });
    state.transmissao = { ...item, inicio: Date.now(), sessao: crypto.randomUUID() };
  } else if (route === 'parar') {
    state.transmissao = null;
    state.pedidos.forEach(x => { x.status = 'pendente'; });
  } else if (route === 'limpar' || route === 'remover') {
    state.pedidos = state.pedidos.filter(x => route !== 'limpar' && x.id !== data.id);
    if (state.transmissao && !state.pedidos.some(x => x.id === state.transmissao.id)) state.transmissao = null;
  } else if (route === 'remover-sugestao') {
    state.sugestoes = state.sugestoes.filter(x => x.id !== data.id);
  } else fail('Rota não encontrada.', 404);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(req.url, 'http://localhost');
    const route = req.query?.route || url.searchParams.get('route') || url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
    if (!['GET', 'POST'].includes(req.method)) fail('Método não permitido.', 405);
    const auth = authenticated(req);
    const data = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (req.method === 'POST' && route === 'login') {
      if (data.senha !== password) fail('Senha incorreta.', 401);
      const value = `${Date.now() + 86400000}.${crypto.randomBytes(24).toString('hex')}`;
      return res.status(200).json({ token: `${value}.${signature(value)}` });
    }
    if (req.method === 'POST' && !['pedir', 'sugerir'].includes(route) && !auth) {
      fail('Entre na gestão novamente.', 401);
    }
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
      if (req.method === 'GET') {
        if (route !== 'estado') fail('Rota não encontrada.', 404);
        const state = structuredClone(demoState);
        if (!auth) delete state.sugestoes;
        return res.status(200).json({ ...state, servidorAgora: Date.now(), modo: 'demonstracao', instancia: demoInstance });
      }
      mutate(demoState, route, data);
      return res.status(200).json({ ok: true });
    }
    pool ||= new Pool({ connectionString, max: 3, connectionTimeoutMillis: 10000 });
    const client = await pool.connect();
    try {
      await client.query('CREATE TABLE IF NOT EXISTS radio_estado (id INTEGER PRIMARY KEY, dados JSONB NOT NULL)');
      await client.query('INSERT INTO radio_estado (id, dados) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [JSON.stringify(initial())]);
      if (req.method === 'GET') {
        if (route !== 'estado') fail('Rota não encontrada.', 404);
        const result = await client.query('SELECT dados FROM radio_estado WHERE id=1');
        const state = result.rows[0].dados;
        if (!auth) delete state.sugestoes;
        return res.status(200).json({ ...state, servidorAgora: Date.now() });
      }
      await client.query('BEGIN');
      try {
        const result = await client.query('SELECT dados FROM radio_estado WHERE id=1 FOR UPDATE');
        const state = result.rows[0].dados;
        mutate(state, route, data);
        await client.query('UPDATE radio_estado SET dados=$1 WHERE id=1', [JSON.stringify(state)]);
        await client.query('COMMIT');
        return res.status(200).json({ ok: true });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    } finally { client.release(); }
  } catch (error) {
    const status = error.status || (error instanceof SyntaxError ? 400 : 503);
    return res.status(status).json({ erro: error.status ? error.message : 'Não foi possível acessar os dados. Confira a conexão PostgreSQL configurada na Vercel.' });
  }
};
