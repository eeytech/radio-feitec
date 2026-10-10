const gestao = !!document.getElementById('painel');
let token = '';
try { token = sessionStorage.getItem('radioToken') || ''; } catch {}
let estado = { pedidos: [], sugestoes: [], transmissao: null };
let sessaoAudio = null;
let bloqueado = false;
let relogio = null;
let amostrasRelogio = [];
let ultimaResposta = 0;
let numeroConsulta = 0;
let alinhamentoInicial = false;
let ultimoSalto = -Infinity;
let playPendente = null;
let instanciaAnterior = null;
let instanciasDiferentes = false;
const el = id => document.getElementById(id);
const audio = el('radioAudio');

async function api(path, data) {
  if (location.protocol === 'file:') {
    throw new Error('Abra a gestão pelo servidor: http://localhost:8000/gestao/ . O arquivo HTML aberto diretamente não conecta à rádio.');
  }
  let response;
  try {
    response = await fetch('/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
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
    // Usa as amostras de menor latência para reduzir oscilações de rede.
    amostrasRelogio.push({ rtt: fim - start, offset: recebido.servidorAgora - (start + fim) / 2 });
    amostrasRelogio = amostrasRelogio.slice(-12);
    const melhor = amostrasRelogio.reduce((a, b) => a.rtt < b.rtt ? a : b);
    relogio = melhor.offset;
    estado = recebido;
    if (recebido.instancia) {
      if (instanciaAnterior && instanciaAnterior !== recebido.instancia) instanciasDiferentes = true;
      instanciaAnterior = recebido.instancia;
    }
    el('conexao').textContent = instanciasDiferentes
      ? 'A hospedagem está alternando servidores temporários. O modo sem banco não consegue manter todos os ouvintes sincronizados.' : '';
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
  const musica = MUSICAS.find(m => m.arquivo === el('musica').value);
  if (!musica || !el('nome').value.trim()) {
    el('mensagem').textContent = 'Selecione uma música e informe seu nome.';
    return;
  }
  try {
    await api('pedir', { musica: musica.nome, arquivo: musica.arquivo, nome: el('nome').value.trim() });
    el('musica').value = '';
    el('nome').value = '';
    el('mensagem').textContent = '✅ Pedido enviado para a rádio!';
    await atualizar();
  } catch (error) { el('mensagem').textContent = error.message; }
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
  try { await api(path, { id }); await atualizar(); }
  catch (error) { el('conexao').textContent = error.message; }
}
function limparTudo() { if (confirm('Tem certeza que deseja limpar a lista?')) acao('limpar'); }

function button(text, action) {
  const b = document.createElement('button');
  b.textContent = text; b.onclick = action; return b;
}

function render() {
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
      actions.append(button('▶️ Tocar', () => acao('tocar', item.id)), button('❌ Remover', () => acao('remover', item.id)));
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
  } else {
    const t = estado.transmissao;
    el('agora').textContent = t ? `🎵 ${t.musica} — pedido por ${t.nome}` : 'Nenhuma música tocando no momento.';
    sincronizar();
  }
}

function posicao() { return Math.max(0, (performance.now() + relogio - estado.transmissao.inicio) / 1000); }

function sincronizar() {
  const t = estado.transmissao;
  if (!t) {
    if (sessaoAudio !== null) {
      audio.pause(); audio.removeAttribute('src'); audio.load();
    }
    audio.playbackRate = 1;
    sessaoAudio = null; bloqueado = false;
    el('audioStatus').textContent = 'Aguardando a programação.';
    el('ativarSom').hidden = true;
    return;
  }
  if (sessaoAudio !== t.sessao) {
    sessaoAudio = t.sessao; bloqueado = false;
    alinhamentoInicial = true;
    ultimoSalto = -Infinity;
    audio.playbackRate = 1;
    audio.src = '/musicas/' + encodeURIComponent(t.arquivo);
    audio.load();
  }
  if (audio.readyState < 2 || audio.seeking || relogio === null) return;
  const target = posicao();
  if (Number.isFinite(audio.duration) && target >= audio.duration) {
    audio.pause();
    audio.playbackRate = 1;
    el('audioStatus').textContent = 'Música encerrada. Aguardando a próxima transmissão.';
    el('ativarSom').hidden = true;
    return;
  }
  const desvio = target - audio.currentTime;
  const agora = performance.now();
  if (alinhamentoInicial || (Math.abs(desvio) > 1.5 && agora - ultimoSalto > 5000)) {
    audio.currentTime = target;
    alinhamentoInicial = false;
    ultimoSalto = agora;
    audio.playbackRate = 1;
  } else if (!audio.paused && Math.abs(desvio) > 0.15 && Math.abs(desvio) <= 1.5) {
    // Pequenas diferenças são corrigidas gradualmente, sem saltos na música.
    audio.playbackRate = desvio > 0 ? 1.03 : 0.97;
  } else {
    audio.playbackRate = 1;
  }
  if (audio.paused && !bloqueado) tentarPlay();
}

async function tentarPlay() {
  const session = sessaoAudio;
  if (playPendente === session) return;
  playPendente = session;
  try {
    await audio.play();
    if (session !== sessaoAudio) return;
    bloqueado = false; el('ativarSom').hidden = true;
    el('audioStatus').textContent = '🔴 Ouvindo a transmissão ao vivo.';
  } catch (error) {
    if (session !== sessaoAudio || error.name === 'AbortError') return;
    bloqueado = true; el('ativarSom').hidden = false;
    el('audioStatus').textContent = error.name === 'NotAllowedError'
      ? 'Seu navegador pede uma interação: toque em Ativar som para ouvir a rádio.'
      : 'Não foi possível reproduzir o áudio. Toque em Ativar som para tentar novamente.';
  } finally { if (playPendente === session) playPendente = null; }
}
function ativarSom() {
  if (!estado.transmissao) return;
  if (audio.readyState >= 1) audio.currentTime = Math.min(posicao(), audio.duration || Infinity);
  bloqueado = false;
  tentarPlay();
}

if (audio) {
  el('musica').append(new Option('Selecione uma música', ''));
  MUSICAS.forEach(m => el('musica').append(new Option(m.nome, m.arquivo)));
  audio.addEventListener('loadedmetadata', sincronizar);
  audio.addEventListener('canplay', sincronizar);
  audio.addEventListener('seeked', sincronizar);
  if ('preservesPitch' in audio) audio.preservesPitch = true;
  audio.addEventListener('error', () => { el('audioStatus').textContent = 'Arquivo de áudio indisponível. Avise a gestão.'; });
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
