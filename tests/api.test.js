const test = require('node:test');
const assert = require('node:assert/strict');
// O processo deste teste usa exclusivamente o modo escolar, sem banco externo.
for (const key of ['DATABASE_URL', 'POSTGRES_URL', 'RADIO_SENHA', 'RADIO_TOKEN_SECRET']) delete process.env[key];
const handler = require('../api/index');
async function call(route, body, token, instance) {
  const res = {
    setHeader() {}, status(code) { this.code = code; return this; },
    json(data) { this.data = data; }
  };
  await handler({ url: '/api/' + route, method: body ? 'POST' : 'GET', body,
    headers: { authorization: token, 'x-radio-instance': instance } }, res);
  return res;
}
test('pedir segunda música mantém a primeira; tocar repetido é idempotente; instância divergente não recebe alterações', async () => {
  const login = await call('login', { senha: 'radio123' });
  assert.equal(login.code, 200);
  const token = login.data.token;
  assert.equal((await call('tocar', { id: 'invalido' })).code, 401);
  await call('pedir', { nome: 'Teste', musica: 'Burguesinha - Seu Jorge', arquivo: 'Burguesinha - Seu Jorge.mp3' });
  const first = (await call('estado')).data.pedidos[0];
  await call('tocar', { id: first.id }, token);
  const playing = (await call('estado')).data;
  await call('pedir', { nome: 'Teste 2', musica: '5 KM - Henrique e Juliano', arquivo: '5 KM - Henrique e Juliano.mp3' });
  const queued = (await call('estado')).data;
  assert.deepEqual(queued.transmissao, playing.transmissao);
  assert(queued.revisao > playing.revisao);
  await call('tocar', { id: first.id }, token);
  assert.deepEqual((await call('estado')).data.transmissao, playing.transmissao);
  const second = queued.pedidos[1];
  await call('tocar', { id: second.id }, token);
  const switched = (await call('estado')).data;
  assert.notEqual(switched.transmissao.sessao, playing.transmissao.sessao);
  const rejected = await call('parar', {}, token, 'outra-instancia');
  assert.equal(rejected.code, 409);
  assert.deepEqual((await call('estado')).data.transmissao, switched.transmissao);
});
