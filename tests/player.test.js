const test = require('node:test');
const assert = require('node:assert/strict');
const RadioPlayer = require('../shared/player');

class Audio {
  constructor() {
    this.listeners = {}; this.paused = true; this.readyState = 0;
    this.duration = 200; this.currentTime = 0; this.loads = 0; this.seeks = 0;
  }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name) { for (const fn of this.listeners[name] || []) fn(); }
  get currentTime() { return this.time; }
  set currentTime(value) { this.time = value; this.seeks = (this.seeks || 0) + 1; }
  load() { this.loads++; this.readyState = 0; }
  pause() { this.paused = true; }
  removeAttribute() {}
  play() { this.paused = false; this.emit('playing'); return Promise.resolve(); }
  ready() { this.readyState = 1; this.emit('loadedmetadata'); this.readyState = 4; this.emit('canplay'); }
}
function setup(t) {
  const audio = new Audio();
  const status = {}, activate = {};
  const player = new RadioPlayer(audio, status, activate, () => 100000);
  t.after(() => clearInterval(player.timer));
  return { audio, player, status, activate };
}
const track = (sessao = 'primeira') => ({ sessao, inicio: 90000, arquivo: sessao + '.mp3' });

test('novos pedidos e respostas repetidas não recarregam nem reposicionam a primeira faixa', t => {
  const { player, audio } = setup(t);
  player.setTransmission(track()); audio.ready();
  const seeks = audio.seeks;
  audio.time = 12;
  for (let i = 0; i < 50; i++) player.setTransmission({ ...track() });
  assert.equal(audio.loads, 1); assert.equal(audio.currentTime, 12); assert.equal(audio.seeks, seeks);
});

test('segunda e terceira músicas carregam uma vez cada, mesmo com eventos repetidos', t => {
  const { player, audio } = setup(t);
  for (const session of ['primeira', 'segunda', 'terceira']) {
    player.setTransmission(track(session)); audio.ready();
    const seeks = audio.seeks;
    for (let n = 0; n < 20; n++) { audio.emit('canplay'); audio.emit('loadedmetadata'); audio.emit('seeked'); }
    assert.equal(audio.seeks, seeks);
  }
  assert.equal(audio.loads, 3); assert.equal(audio.paused, false);
});

test('uma tentativa antiga rejeitada não bloqueia a nova música', async t => {
  const { player, audio, activate } = setup(t);
  let rejectOld;
  audio.play = () => new Promise((_, reject) => { rejectOld = reject; });
  player.setTransmission(track()); audio.ready();
  const old = rejectOld;
  audio.play = Audio.prototype.play;
  player.setTransmission(track('segunda')); audio.ready();
  old(Object.assign(new Error(), { name: 'NotAllowedError' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(player.blocked, false); assert.equal(activate.hidden, true); assert.equal(audio.paused, false);
});

test('buffer instável e busca em andamento não disparam saltos corretivos', t => {
  const { player, audio } = setup(t);
  player.setTransmission(track()); audio.ready(); audio.time = 0;
  const seeks = audio.seeks;
  audio.emit('waiting');
  for (let i = 0; i < 10; i++) player.correctDrift();
  assert.equal(audio.seeks, seeks);
  player.buffering = false; audio.seeking = true;
  for (let i = 0; i < 10; i++) player.correctDrift();
  assert.equal(audio.seeks, seeks);
});

test('desvio pequeno usa velocidade sem reiniciar o arquivo', t => {
  const { player, audio } = setup(t);
  player.setTransmission(track()); audio.ready(); audio.time = 9;
  const seeks = audio.seeks;
  player.correctDrift();
  assert.equal(audio.playbackRate, 1.02); assert.equal(audio.seeks, seeks); assert.equal(audio.loads, 1);
});

test('parada repetida e término não reiniciam a música', t => {
  const { player, audio } = setup(t);
  player.setTransmission(track()); audio.ready();
  audio.ended = true; audio.emit('ended'); audio.emit('canplay');
  assert.equal(audio.paused, true);
  player.setTransmission(null); player.setTransmission(null);
  assert.equal(audio.loads, 2);
});
