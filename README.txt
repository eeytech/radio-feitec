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
