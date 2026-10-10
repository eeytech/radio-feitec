RÁDIO CONECT

INICIAR: execute python server.py nesta pasta (Python 3.10 ou superior).
Rádio: http://localhost:8000/radio/
Gestão: http://localhost:8000/gestao/ — senha inicial: radio123.
Outros dispositivos: http://IP-DO-SERVIDOR:8000/radio/ na mesma rede.
Para internet, hospede o servidor Python com HTTPS. Hospedagem somente estática
ou abertura direta do HTML não executam a API.

PEDIDOS: selecione uma música cadastrada e informe seu nome.
SUGESTÕES: formulário separado na rádio, com consulta e remoção na gestão.
Para incluir uma sugestão, adicione o MP3 em /musicas/ e cadastre nome e arquivo
em /musicas/catalogo.js, mantendo o formato existente. Recarregue a página.

TRANSMISSÃO: Tocar inicia diretamente a música do pedido para todos.
O horário central de início sincroniza quem já está ouvindo e quem entra depois.
Atualização da fila a cada segundo, sem recarregar o player.
O arquivo de áudio só muda quando a sessão da transmissão muda.
Ajustes de tempo ocorrem separadamente, a cada 2 segundos; durante buffer ou
busca, não há correções. Pequenos desvios usam ajustes de velocidade de 2%.
Atrasos acima de 3 segundos só causam busca se persistirem por três medições,
com buffer estável e ao menos 15 segundos desde a busca anterior.
Respostas antigas são ignoradas. Se a instância temporária da Vercel mudar,
a reprodução atual é preservada e a página pede reconexão, em vez de alternar
entre programações conflitantes. Isso evita interrupções, mas não cria um
armazenamento compartilhado entre instâncias.
A sincronização é aproximada e depende da rede e do navegador.
Parar, remover o pedido tocando ou limpar a fila interrompe a transmissão.
Ao terminar uma faixa, a rádio aguarda o próximo Tocar.
Navegadores podem exigir uma primeira interação para liberar áudio com som.
Nesse caso aparece Ativar som; as próximas músicas tocam automaticamente,
conforme as permissões do navegador. Não é possível garantir áudio sem nenhuma
interação em todos os navegadores.

DADOS: persistidos em radio.sqlite3. Dados antigos do localStorage não são
importados. Os tokens da gestão expiram ao reiniciar o servidor; entre novamente.
Configure RADIO_SENHA para mudar a senha e PORT para mudar a porta.
Exemplo no PowerShell:
$env:RADIO_SENHA = 'sua-nova-senha'
python server.py
Não há dependências externas.

DEPLOY NA VERCEL
O projeto inclui vercel.json, build estático e API Node.js para PostgreSQL.
1. Envie a pasta que contém package.json e vercel.json ao repositório do deploy.
2. Na Vercel, selecione essa pasta como Root Directory e Framework Preset Other.
3. Build Command: npm run build. Output Directory: public.
4. Nenhuma variável é obrigatória: a senha padrão é radio123.
   Sem banco, funciona em modo de demonstração com dados temporários na
   memória da função. A Vercel pode reiniciar ou criar outras instâncias:
   pedidos podem desaparecer e ouvintes em instâncias diferentes podem
   receber estados diferentes. Esse modo não garante sincronização entre
   todos os dispositivos. Para persistência e estado compartilhado confiável,
   configure opcionalmente DATABASE_URL (ou POSTGRES_URL) com PostgreSQL.
   RADIO_SENHA e RADIO_TOKEN_SECRET também são opcionais.
5. Faça um NOVO deploy com esses arquivos e variáveis.
6. Acesse /radio/ e /gestao/. A raiz / também abre a rádio.
A API cria sua tabela automaticamente; o usuário do banco deve ter permissão
para CREATE TABLE. Use a conexão com pooling fornecida pelo banco, se disponível.
Não envie credenciais por chat e não inclua arquivos .env no repositório.
O SQLite local não é usado na Vercel e não é migrado automaticamente.
O teste local com python server.py continua disponível, com banco separado.

TESTES DE REGRESSÃO
npm install
npm test
npm run check
npm run build
O teste de navegador está em tests/browser.cjs e usa Chrome instalado e
playwright-core. Para executá-lo: npm install --no-save playwright-core
Depois: npm run test:browser
BROWSER_EXECUTABLE pode indicar outro executável Chromium/Edge.
O teste inicia sua própria API local, usa dois ouvintes e três faixas, envia
pedidos durante a reprodução e injeta respostas antigas e de outra instância.
Não modifica o deploy publicado nem o banco local Python.
