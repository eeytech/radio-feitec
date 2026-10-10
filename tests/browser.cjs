// Instale playwright-core e informe PLAYWRIGHT_MODULE se estiver fora deste projeto.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const handler = require('../api/index');
const root = path.resolve(__dirname, '..');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    let text = ''; for await (const chunk of req) text += chunk;
    req.body = text ? JSON.parse(text) : undefined;
    res.status = code => { res.statusCode = code; return res; };
    res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    return handler(req, res);
  }
  let name = decodeURIComponent(url.pathname);
  if (name.endsWith('/')) name += 'index.html';
  const target = path.join(root, name);
  if (!fs.existsSync(target)) { res.statusCode = 404; return res.end(); }
  const size = fs.statSync(target).size;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg' };
  res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
  if (req.headers.range) {
    const [, from, to] = /bytes=(\d+)-(\d*)/.exec(req.headers.range);
    const start = Number(from), end = to ? Math.min(Number(to), size - 1) : size - 1;
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    return fs.createReadStream(target, { start, end }).pipe(res);
  }
  res.setHeader('Content-Length', size);
  fs.createReadStream(target).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.BROWSER_EXECUTABLE,
      channel: process.env.BROWSER_EXECUTABLE ? undefined : 'chrome',
      headless: true, args: ['--autoplay-policy=no-user-gesture-required']
    });
    const context = await browser.newContext();
    const radio = await context.newPage();
    const listener = await context.newPage();
    const admin = await context.newPage();
    const errors = [];
    const navigations = new Map();
    for (const page of [radio, listener, admin]) {
      navigations.set(page, 0);
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) navigations.set(page, navigations.get(page) + 1);
      });
    }
    for (const page of [radio, listener, admin]) page.on('pageerror', error => errors.push(error.message));
    await Promise.all([radio.goto(base + '/radio/'), listener.goto(base + '/radio/'), admin.goto(base + '/gestao/')]);
    for (const page of [radio, listener]) await page.evaluate(() => {
      window.audioEvents = { loads: 0, seeks: 0 };
      const a = document.getElementById('radioAudio');
      a.addEventListener('loadstart', () => window.audioEvents.loads++);
      a.addEventListener('seeking', () => window.audioEvents.seeks++);
    });
    await admin.locator('#senha').fill('radio123'); await admin.getByRole('button', { name: 'Entrar', exact: true }).click();
    const choices = await radio.locator('#musica option').evaluateAll(options => options.filter(x => x.value).map(x => ({ file: x.value, name: x.textContent })));
    async function requestSong(index) {
      await radio.locator('#musica').selectOption(choices[index].file);
      await radio.locator('#nome').fill('Teste navegador ' + index);
      await radio.getByRole('button', { name: '🎵 Pedir música', exact: true }).click();
      await radio.waitForFunction(() => document.getElementById('musica').value === '');
      await admin.locator('.gestao-item').filter({ hasText: choices[index].name }).waitFor();
    }
    async function startSong(index) {
      await admin.locator('.gestao-item').filter({ hasText: choices[index].name }).getByRole('button', { name: '▶️ Tocar', exact: true }).click();
      for (const page of [radio, listener]) await page.waitForFunction(file => {
        const a = document.getElementById('radioAudio');
        return decodeURIComponent(a.src).endsWith(file) && !a.paused && a.currentTime > 1;
      }, choices[index].file, { timeout: 20000 });
    }
    const snapshot = page => page.evaluate(() => {
      const a = document.getElementById('radioAudio');
      return { ...window.audioEvents, time: a.currentTime, src: a.src, paused: a.paused };
    });
    await requestSong(0); await startSong(0);
    const oldState = await (await context.request.get(base + '/api/estado')).json();
    const before = await snapshot(radio);
    await requestSong(1);
    await radio.waitForFunction(time => document.getElementById('radioAudio').currentTime > time + 2, before.time);
    const after = await snapshot(radio);
    assert.equal(after.loads, before.loads, 'Pedir a segunda não pode recarregar a primeira');
    assert.equal(after.src, before.src);
    await startSong(1);
    await requestSong(2); await startSong(2);
    // Injeta uma resposta antiga e depois uma cópia de outra instância.
    for (const altered of [oldState, { ...oldState, instancia: 'outra-instancia' }]) {
      let injected = false;
      const intercept = async route => {
        injected = true;
        await route.fulfill({ json: altered });
      };
      await radio.route('**/api/estado', intercept, { times: 1 });
      await radio.waitForFunction(() => true);
      const deadline = Date.now() + 5000;
      while (!injected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      assert(injected, 'Resposta de teste deve ser entregue');
    }
    await radio.waitForFunction(() => document.getElementById('radioAudio').currentTime > 5);
    const finalRadio = await snapshot(radio), finalListener = await snapshot(listener);
    assert.equal(finalRadio.loads, 3); assert.equal(finalListener.loads, 3);
    assert(finalRadio.seeks <= 4, 'Não deve haver ciclo de buscas');
    assert(finalListener.seeks <= 4, 'O segundo ouvinte não deve entrar em ciclo de buscas');
    assert.equal(finalRadio.paused, false); assert.equal(finalListener.paused, false);
    assert(Math.abs(finalRadio.time - finalListener.time) < 1.5, 'Ouvintes devem acompanhar a mesma posição');
    assert.deepEqual(errors, []);
    for (const count of navigations.values()) assert.equal(count, 1, 'Nenhuma página deve recarregar sozinha');
    console.log('PASS navegador Chrome: 3 faixas, pedidos durante reprodução, 2 ouvintes, 1 carregamento por faixa, sem erros JavaScript.');
    console.log(JSON.stringify({ radio: finalRadio, listener: finalListener }, null, 2));
  } finally {
    if (browser) await browser.close();
    server.close();
    server.closeAllConnections();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
