# Correção auditada de observações de playtest

Fonte e ensaio de desenvolvimento em **2026-11-13**. Complementa os
[playtests locais](GAME_PLAYTESTS.md) e as
[metas proporcionais](GAME_PLAYTEST_TARGETS.md). Os registros continuam sendo
declarações do operador: correção não prova consentimento, identidade, participação
real ou qualidade e não pertence às ferramentas do modelo.

## Contrato e persistência

`games.playtests.correct` recebe um pedido idempotente, estudo, código do
participante, hash do registro atual, motivo e confirmação explícita. As respostas
seguem as mesmas regras de nota, segundos, ambiente e consentimento do registro
original. Não aceita mudar participante, estudo, build ou horário original.

Uma transação imediata confere namespace e hash atual, registra antes/depois,
motivo, horário da correção e sequência, atualiza a visão corrente e grava o
recibo. Identidade repetida com outro conteúdo é recusada. Estado desatualizado
ou correção sem mudança de resposta não grava nada. Há limite de mil correções
por registro, sem exclusão automática das anteriores.

`games.playtests.corrections` lê o estado atual e o histórico paginado, até cem
entradas por página. O hash retornado é o vínculo para preparar uma correção;
não é prova independente de veracidade dos dados. O histórico local não é um
registro externo protegido contra quem controla a própria conta.

Uma correção mantém uma única pessoa no resumo. As metas usam as respostas
correntes de todos os registros ativos; o valor anterior permanece no histórico
consultável enquanto houver consentimento. Nunca usar essa operação para simular
uma nova pessoa, substituir uma rodada posterior ou esconder uma nota negativa.
Qualidade continua `false` e nenhum relatório de coletor é criado.

Ao retirar consentimento, a mesma transação substitui também todas as entradas
históricas por tombstones: conservam identificadores, sequência, horários e hashes,
sem respostas ou motivo. Repetir um pedido de correção antigo retorna o tombstone
atual e não restaura dados. Isso não promete apagar fisicamente SQLite/WAL,
backups, exportações ou um rascunho antigo já salvo no host.

O schema atual das respostas e da exportação existente não muda. Exportações de
registros contêm os valores correntes; não exportam esse histórico implicitamente.
Sua consulta explícita usa a nova API paginada. O banco acrescenta uma tabela;
não reescreve observações antigas para inventar correções. Importação histórica e
rollback instalado desse campo exigem sua própria evidência.

## SDKs e interfaces

A capacidade `game-playtest-corrections-v1` identifica as duas novas rotas, apenas
nos mesmos produtos autorizados para estudos. KidOS continua recusando-as; a
integração do responsável permanece uma entrega própria.

TypeScript oferece `correctGamePlaytest` e `getGamePlaytestCorrections`; Python,
`correct_game_playtest` e `get_game_playtest_corrections`. Nenhum contém agente,
codec ou outra autoridade.

O Studio compartilhado Mac/VS Code apresenta **Corrigir registro** e **Histórico
de correções**. O formulário carrega os valores atuais, mas deixa consentimento,
confirmação do código e confirmação da correção desmarcados. Exige motivo e
confirmação nativa; o controlador confere modo/projeto antes e depois dela. O
serviço aplica o hash final mesmo se outro cliente alterar o registro durante
a confirmação. Motivos/notas são texto, sem execução de HTML.

Rascunhos e pedidos congelados usam o armazenamento privado durável existente.
Após uma resposta perdida, a retomada consulta o recibo exato primeiro: pode
confirmar a gravação sem nova aprovação, inclusive somente leitura, após outra
correção ou retirada. Um recibo ausente, incompatível ou rejeitado não encerra
um efeito desconhecido. Motor antigo não recebe uma nova correção; um recibo
conhecido pode ser recuperado pelo mecanismo anterior sem repetir o efeito.

## Evidência e limites

O [dossiê](../output/game-generation/playtest-corrections-20261113-a1/report.json)
conserva fonte, regressão anterior e logs. Passaram 755 testes, um opt-in ignorado,
40 verificações, tipos, builds Mac/extensão, motor independente e roteamento local
simulado. Os testes exercitam CAS, histórico antes/depois, paginação, replay,
reinício, retirada de todas as cópias consultáveis, SDKs reais TypeScript/Python,
isolamento, recusa KidOS, confirmação do host e recuperação sem autoridade nova.

O ensaio `2026-11-13T18-20-58-877Z-2f15420d` usa renderer/controlador/SDK/TLS/IPC
e motor empacotado reais, com as duas pontes de interface emuladas. Os dados são
inteiramente sintéticos. Conservou um rascunho não enviado ao reabrir, perdeu a
resposta após o commit e recuperou sem outra gravação/aprovação em modo somente
leitura; histórico texto e retirada foram conferidos. Layouts de 1200 e 760 pixels
sem overflow horizontal. Serviço 87800 e browser 87806 terminaram com código 0;
estado temporário removido. Não houve IA, pessoas, instalação ou publicação.

Duas falhas anteriores permanecem preservadas: a primeira usou TMPDIR diferente
no processo do serviço, impedindo observar seu endpoint; o processo foi encerrado
por SIGTERM antes de repetir. A segunda leu o checkbox antigo antes de o formulário
assíncrono aparecer; a captura posterior mostra as três confirmações desmarcadas.
Serviço e browser terminaram com código 0. Corrigiu-se o ambiente/espera do roteiro,
sem relaxar o produto ou inicializar consentimento automaticamente. Os estados
privados dessas falhas foram preservados, sem bancos/credenciais no dossiê público.

O pacote de desenvolvimento tem manifesto
`e14ce1b4253e25416c37e627fdf1dd3102ac61c0ca728a7058cf05f683f2168f`.
O ensaio não comprova aplicativos instalados, consentimento real, integração
parental, playtest de um jogo ou aceite integral de Game Design 1.0.
