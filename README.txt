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
Atualização a cada segundo; desvios maiores que 0,8 segundo são corrigidos.
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
4. Conecte um banco PostgreSQL e configure as variáveis do projeto:
   DATABASE_URL: URL de conexão do banco (ou POSTGRES_URL).
   RADIO_SENHA: senha de acesso à gestão (radio123 para manter a atual).
   RADIO_TOKEN_SECRET: segredo aleatório longo, mantido somente no servidor.
   Gere um segredo localmente com:
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
5. Faça um NOVO deploy com esses arquivos e variáveis.
6. Acesse /radio/ e /gestao/. A raiz / também abre a rádio.
A API cria sua tabela automaticamente; o usuário do banco deve ter permissão
para CREATE TABLE. Use a conexão com pooling fornecida pelo banco, se disponível.
Não envie credenciais por chat e não inclua arquivos .env no repositório.
O SQLite local não é usado na Vercel e não é migrado automaticamente.
O teste local com python server.py continua disponível, com banco separado.
