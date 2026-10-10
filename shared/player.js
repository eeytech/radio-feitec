/* O player só troca o arquivo quando a gestão troca a sessão da transmissão. */
class RadioPlayer {
  constructor(audio, status, activate, serverNow) {
    this.audio = audio;
    this.status = status;
    this.activate = activate;
    this.serverNow = serverNow;
    this.track = null;
    this.generation = 0;
    this.pending = null;
    this.blocked = false;
    this.initialSeek = false;
    this.buffering = false;
    this.largeDriftCount = 0;
    this.lastSeek = -Infinity;
    this.stableSince = performance.now();
    if ('preservesPitch' in audio) audio.preservesPitch = true;
    audio.addEventListener('loadedmetadata', () => this.prepare());
    audio.addEventListener('canplay', () => {
      if (this.buffering) this.stableSince = performance.now();
      this.buffering = false;
      this.prepare();
    });
    audio.addEventListener('waiting', () => {
      this.buffering = true;
      this.largeDriftCount = 0;
      audio.playbackRate = 1;
    });
    audio.addEventListener('playing', () => {
      if (!this.track) return;
      this.buffering = false;
      this.stableSince = performance.now();
      this.status.textContent = '🔴 Ouvindo a transmissão ao vivo.';
    });
    audio.addEventListener('ended', () => this.finish());
    audio.addEventListener('error', () => {
      if (this.track) this.status.textContent = 'Arquivo de áudio indisponível. Avise a gestão.';
    });
    this.timer = setInterval(() => this.correctDrift(), 2000);
    this.activate.hidden = true;
  }

  setTransmission(track) {
    if ((this.track?.sessao || null) === (track?.sessao || null)) return;
    this.generation++;
    this.track = track;
    this.pending = null;
    this.blocked = false;
    this.initialSeek = !!track;
    this.buffering = false;
    this.largeDriftCount = 0;
    this.lastSeek = -Infinity;
    this.audio.pause();
    this.audio.playbackRate = 1;
    this.activate.hidden = true;
    if (!track) {
      this.audio.removeAttribute('src');
      this.audio.load();
      this.status.textContent = 'Aguardando a programação.';
      return;
    }
    this.status.textContent = 'Carregando a próxima música…';
    this.audio.src = '/musicas/' + encodeURIComponent(track.arquivo);
    this.audio.load();
  }

  position() {
    return this.track ? Math.max(0, (this.serverNow() - this.track.inicio) / 1000) : 0;
  }

  finish() {
    this.audio.pause();
    this.audio.playbackRate = 1;
    this.activate.hidden = true;
    this.status.textContent = 'Música encerrada. Aguardando a próxima transmissão.';
  }

  prepare() {
    if (!this.track || this.audio.readyState < 1) return;
    const target = this.position();
    if (Number.isFinite(this.audio.duration) && target >= this.audio.duration) {
      this.finish();
      return;
    }
    if (this.initialSeek) {
      // Limpa a flag ANTES de buscar: eventos de mídia não podem iniciar outra busca.
      this.initialSeek = false;
      if (target > 0.1) this.audio.currentTime = target;
      this.lastSeek = performance.now();
    }
    if (this.audio.readyState >= 2 && !this.blocked) this.play();
  }

  async play() {
    if (!this.track || !this.audio.paused || this.pending || this.audio.ended) return;
    const attempt = { generation: this.generation };
    this.pending = attempt;
    try {
      await this.audio.play();
      if (attempt.generation !== this.generation) return;
      this.blocked = false;
      this.activate.hidden = true;
    } catch (error) {
      if (attempt.generation !== this.generation || error.name === 'AbortError') return;
      this.blocked = true;
      this.activate.hidden = false;
      this.status.textContent = error.name === 'NotAllowedError'
        ? 'Toque em Ativar som para ouvir a rádio.'
        : 'Não foi possível reproduzir. Toque em Ativar som para tentar novamente.';
    } finally {
      if (this.pending === attempt) this.pending = null;
    }
  }

  enable() {
    if (!this.track) return;
    this.blocked = false;
    this.initialSeek = true;
    this.prepare();
    this.play();
  }

  correctDrift() {
    const a = this.audio;
    if (!this.track || this.blocked || this.initialSeek || this.buffering || a.seeking || a.paused || a.ended || a.readyState < 3) return;
    const target = this.position();
    if (Number.isFinite(a.duration) && target >= a.duration) return this.finish();
    const drift = target - a.currentTime;
    if (Math.abs(drift) <= 0.25) {
      a.playbackRate = 1;
      this.largeDriftCount = 0;
    } else if (Math.abs(drift) <= 3) {
      a.playbackRate = drift > 0 ? 1.02 : 0.98;
      this.largeDriftCount = 0;
    } else {
      a.playbackRate = 1;
      this.largeDriftCount++;
      // Só recupera um atraso grande e persistente após o buffer estabilizar.
      const now = performance.now();
      if (this.largeDriftCount >= 3 && now - this.lastSeek > 15000 && now - this.stableSince > 6000) {
        this.lastSeek = now;
        this.largeDriftCount = 0;
        a.currentTime = target;
      }
    }
  }
}
if (typeof module !== 'undefined') module.exports = RadioPlayer;
