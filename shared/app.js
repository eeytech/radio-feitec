const gestao = !!document.getElementById('painel');
let token = '';
try { token = sessionStorage.getItem('radioToken') || ''; } catch {}
let estado = { pedidos: [], sugestoes: [], transmissao: null };
let relogio = null;
let amostrasRelogio = [];
let ultimaResposta = 0;
let numeroConsulta = 0;
let instanciaAnterior = null;
let revisaoRecebida = -1;
let desenhoAnterior = '';
let acaoPendente = false;
let pedidoPendente = false;
const el = id => document.getElementById(id);
const audio = el('radioAudio');
const player = audio ? new RadioPlayer(audio, el('audioStatus'), el('ativarSom'),
  () => relogio === null ? Date.now() : performance.now() + relogio) : null;

async function api(path, data) {
  if (location.protocol === 'file:') {
    throw new Error('Abra a gestão pelo servidor: http://localhost:8000/gestao/ . O arquivo HTML aberto diretamente não conecta à rádio.');
  }
  let response;
  try {
    response = await fetch('/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token,
      ...(instanciaAnterior ? { 'X-Radio-Instance': instanciaAnterior } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data), cache: 'no-store'
    });
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Execute python server.py e abra http://localhost:8000/gestao/ .');
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Este endereço não está executando o servidor da rádio. Execute python server.py e acesse http://localhost:8000/gestao/ .');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.erro || 'Falha na conexão.');
  return result;
}

async function atualizar() {
  const consulta = ++numeroConsulta;
  const start = performance.now();
  try {
    const recebido = await api('estado');
    const fim = performance.now();
    if (consulta < ultimaResposta) return;
    ultimaResposta = consulta;
    // Não alterna o player entre cópias independentes da memória da Vercel.
    if (recebido.instancia && instanciaAnterior && recebido.instancia !== instanciaAnterior) {
      el('conexao').textContent = 'O servidor temporário mudou. A reprodução foi preservada. Recarregue a página para reconectar à programação; para sincronização entre todos, use o servidor Python local.';
      return;
    }
    if (recebido.instancia) instanciaAnterior = recebido.instancia;
    if (Number.isFinite(recebido.revisao) && recebido.revisao < revisaoRecebida) return;
    if (Number.isFinite(recebido.revisao)) revisaoRecebida = recebido.revisao;
    // Usa as amostras de menor latência para reduzir oscilações de rede.
    amostrasRelogio.push({ rtt: fim - start, offset: recebido.servidorAgora - (start + fim) / 2 });
    amostrasRelogio = amostrasRelogio.slice(-12);
    const melhor = amostrasRelogio.reduce((a, b) => a.rtt < b.rtt ? a : b);
    relogio = melhor.offset;
    estado = recebido;
    el('conexao').textContent = '';
    render();
  } catch (error) {
    el('conexao').textContent = error.message;
  }
}

async function entrar() {
  try {
    const result = await api('login', { senha: el('senha').value.trim() });
    token = result.token;
    try { sessionStorage.setItem('radioToken', token); } catch {}
    el('senha').value = '';
    el('login').hidden = true;
    el('painel').classList.remove('oculta');
    await atualizar();
  } catch (error) { el('erro').textContent = error.message; }
}

async function pedirMusica() {
  if (pedidoPendente) return;
  const musica = MUSICAS.find(m => m.arquivo === el('musica').value);
  if (!musica || !el('nome').value.trim()) {
    el('mensagem').textContent = 'Selecione uma música e informe seu nome.';
    return;
  }
  try {
    pedidoPendente = true;
    await api('pedir', { musica: musica.nome, arquivo: musica.arquivo, nome: el('nome').value.trim() });
    el('musica').value = '';
    el('nome').value = '';
    el('mensagem').textContent = '✅ Pedido enviado para a rádio!';
    await atualizar();
  } catch (error) { el('mensagem').textContent = error.message; }
  finally { pedidoPendente = false; }
}

async function sugerirMusica() {
  try {
    await api('sugerir', { musica: el('sugestaoMusica').value.trim(), nome: el('sugestaoNome').value.trim() });
    el('sugestaoMusica').value = '';
    el('sugestaoNome').value = '';
    el('sugestaoMensagem').textContent = '✅ Sugestão enviada para a equipe!';
  } catch (error) { el('sugestaoMensagem').textContent = error.message; }
}

async function acao(path, id) {
  if (acaoPendente) return;
  acaoPendente = true;
  try { await api(path, { id }); await atualizar(); }
  catch (error) { el('conexao').textContent = error.message; }
  finally { acaoPendente = false; }
}
function limparTudo() { if (confirm('Tem certeza que deseja limpar a lista?')) acao('limpar'); }

function button(text, action) {
  const b = document.createElement('button');
  b.textContent = text; b.onclick = action; return b;
}

function render() {
  // Uma atualização de fila não participa do ciclo de reprodução.
  if (player) {
    const t = estado.transmissao;
    el('agora').textContent = t ? `🎵 ${t.musica} — pedido por ${t.nome}` : 'Nenhuma música tocando no momento.';
    player.setTransmission(t);
  }
  const desenho = JSON.stringify([estado.pedidos, estado.sugestoes]);
  if (desenho === desenhoAnterior) return;
  desenhoAnterior = desenho;
  const box = el(gestao ? 'lista' : 'fila');
  box.replaceChildren();
  if (!estado.pedidos.length) box.textContent = 'Nenhuma solicitação na fila.';
  estado.pedidos.forEach((item, i) => {
    const row = document.createElement(gestao ? 'div' : 'li');
    if (gestao) row.className = 'gestao-item';
    const text = document.createElement('span');
    text.textContent = `${i + 1}. ${item.musica} — pedido por ${item.nome}${item.status === 'tocando' ? ' • 🎧 tocando agora' : ''}`;
    row.append(text);
    if (gestao) {
      const actions = document.createElement('div'); actions.className = 'acoes';
      const tocar = button(item.status === 'tocando' ? '🎧 Tocando' : '▶️ Tocar', () => acao('tocar', item.id));
      tocar.disabled = item.status === 'tocando';
      actions.append(tocar, button('❌ Remover', () => acao('remover', item.id)));
      row.append(actions);
    }
    box.append(row);
  });
  if (gestao) {
    el('sugestoes').replaceChildren();
    if (!estado.sugestoes?.length) el('sugestoes').textContent = 'Nenhuma sugestão recebida.';
    for (const item of estado.sugestoes || []) {
      const row = document.createElement('div'); row.className = 'gestao-item';
      const text = document.createElement('span'); text.textContent = `${item.musica} — sugestão de ${item.nome}`;
      row.append(text, button('Remover sugestão', () => acao('remover-sugestao', item.id)));
      el('sugestoes').append(row);
    }
  }
}

function ativarSom() { player?.enable(); }

if (audio) {
  el('musica').append(new Option('Selecione uma música', ''));
  MUSICAS.forEach(m => el('musica').append(new Option(m.nome, m.arquivo)));
  el('volume').oninput = () => { audio.volume = Number(el('volume').value); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });
}
if (gestao) {
  el('senha').addEventListener('keydown', event => {
    if (event.key === 'Enter') entrar();
  });
}
async function acompanhar() {
  await atualizar();
  setTimeout(acompanhar, 1000);
}
acompanhar();
