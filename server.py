"""Servidor da Rádio Conect, sem dependências externas. Execute: python server.py"""
import json
import os
import secrets
import sqlite3
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
LOCK = threading.RLock()
DB = sqlite3.connect(os.environ.get('RADIO_DB', str(ROOT / 'radio.sqlite3')), check_same_thread=False)
DB.execute('CREATE TABLE IF NOT EXISTS estado (id INTEGER PRIMARY KEY, dados TEXT)')
row = DB.execute('SELECT dados FROM estado WHERE id=1').fetchone()
STATE = json.loads(row[0]) if row else {'pedidos': [], 'sugestoes': [], 'transmissao': None}
TOKENS = set()
PASSWORD = os.environ.get('RADIO_SENHA', 'radio123')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def reply(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/api/estado':
            with LOCK:
                public = {**STATE, 'servidorAgora': time.time() * 1000}
                if self.headers.get('Authorization') not in TOKENS:
                    public = {k: v for k, v in public.items() if k != 'sugestoes'}
                self.reply(public)
            return
        if path == '/':
            self.send_response(302)
            self.send_header('Location', '/radio/')
            self.end_headers()
            return
        # Somente os arquivos públicos fazem parte do servidor web.
        target = Path(self.translate_path(self.path)).resolve()
        if not any(target.is_relative_to(ROOT / folder) for folder in ('radio', 'gestao', 'musicas', 'shared')):
            self.send_error(404)
            return
        if target.is_dir() and not (target / 'index.html').exists():
            self.send_error(404)
            return
        if target.is_file() and target.suffix.lower() == '.mp3' and self.headers.get('Range'):
            import re
            match = re.fullmatch(r'bytes=(\d+)-(\d*)', self.headers['Range'])
            size = target.stat().st_size
            if not match or int(match[1]) >= size:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.end_headers()
                return
            start = int(match[1])
            end = min(int(match[2]) if match[2] else size - 1, size - 1)
            if end < start:
                self.send_error(416)
                return
            self.send_response(206)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.send_header('Content-Length', str(end - start + 1))
            self.end_headers()
            with target.open('rb') as source:
                source.seek(start)
                remaining = end - start + 1
                while remaining:
                    chunk = source.read(min(65536, remaining))
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            return
        super().do_GET()

    def do_POST(self):
        try:
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= 8192:
                raise ValueError('Requisição inválida.')
            data = json.loads(self.rfile.read(size))
            path = urlparse(self.path).path
            with LOCK:
                if path == '/api/login':
                    if data.get('senha') != PASSWORD:
                        self.reply({'erro': 'Senha incorreta.'}, 401)
                        return
                    token = secrets.token_urlsafe(32)
                    TOKENS.add(token)
                    self.reply({'token': token})
                    return
                if path in ('/api/pedir', '/api/sugerir'):
                    nome = str(data.get('nome', '')).strip()
                    musica = str(data.get('musica', '')).strip()
                    if not nome or not musica or len(nome) > 100 or len(musica) > 200:
                        raise ValueError('Informe a música e seu nome (até 100 caracteres).')
                    item = {'id': secrets.token_hex(12), 'nome': nome, 'musica': musica, 'status': 'pendente'}
                    if path == '/api/pedir':
                        arquivo = data.get('arquivo')
                        # Valida contra o catálogo efetivamente cadastrado, não só arquivos existentes.
                        catalog = (ROOT / 'musicas/catalogo.js').read_text(encoding='utf-8')
                        import re
                        entries = re.findall(r'nome:\s*"([^"]+)"\s*,\s*arquivo:\s*"([^"]+)"', catalog)
                        if (musica, arquivo) not in entries or not (ROOT / 'musicas' / arquivo).is_file():
                            raise ValueError('Escolha uma música cadastrada.')
                        item['arquivo'] = arquivo
                    STATE['pedidos' if path == '/api/pedir' else 'sugestoes'].append(item)
                else:
                    if self.headers.get('Authorization') not in TOKENS:
                        self.reply({'erro': 'Entre na gestão novamente.'}, 401)
                        return
                    if path == '/api/tocar':
                        item = next((x for x in STATE['pedidos'] if x['id'] == data.get('id')), None)
                        if not item:
                            raise ValueError('Pedido não encontrado.')
                        for x in STATE['pedidos']:
                            x['status'] = 'tocando' if x is item else 'pendente'
                        STATE['transmissao'] = {**item, 'inicio': time.time() * 1000, 'sessao': secrets.token_hex(12)}
                    elif path == '/api/parar':
                        STATE['transmissao'] = None
                        for x in STATE['pedidos']:
                            x['status'] = 'pendente'
                    elif path in ('/api/remover', '/api/limpar'):
                        STATE['pedidos'] = [x for x in STATE['pedidos'] if path != '/api/limpar' and x['id'] != data.get('id')]
                        if STATE['transmissao'] and not any(x['id'] == STATE['transmissao']['id'] for x in STATE['pedidos']):
                            STATE['transmissao'] = None
                    elif path == '/api/remover-sugestao':
                        STATE['sugestoes'] = [x for x in STATE['sugestoes'] if x['id'] != data.get('id')]
                    else:
                        self.reply({'erro': 'Rota não encontrada.'}, 404)
                        return
                DB.execute('INSERT OR REPLACE INTO estado VALUES (1, ?)', (json.dumps(STATE),))
                DB.commit()
                self.reply({'ok': True})
        except (ValueError, TypeError, KeyError):
            self.reply({'erro': 'Dados inválidos. Confira os campos e a música selecionada.'}, 400)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8000'))
    print(f'Rádio: http://localhost:{port}/radio/ | Gestão: http://localhost:{port}/gestao/', flush=True)
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
