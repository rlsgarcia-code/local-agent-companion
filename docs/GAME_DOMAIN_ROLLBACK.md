# Rollback real de binários com dados de jogos novos

**Preparação de 15/11/2026:** a leitura da máquina encontrou Mac 0.12.10 / motor
1.0.7 e VS Code 0.12.8 / motor 1.0.6. As assinaturas e todos os bytes de ambos
foram conferidos usando seus SDKs oficiais correspondentes, igualmente verificados.
Isso identifica os binários anteriores; não comprova rollback de dados.

O candidato 1.1.0 acrescenta `contextWindows` e incorpora `webResearch` do motor
1.0.9. O schema persistido de modelos em 1.0.6/1.0.7 é estrito e não conhece esses
campos. Antes de ativar sobre dados pessoais, a instalação precisa qualificar a
restauração/importação de configurações e perfis, além de conversas/jogos. Conservar
apenas o aplicativo anterior ou abrir o mesmo banco com um binário antigo não
resolve essa incompatibilidade. Preservar os dois conjuntos de dados e recibos;
não apagar campos novos para fazer uma consulta antiga passar. Os ensaios abaixo
não cobrem esse cenário novo nem autorizam a instalação pessoal.

Evidência local de **2026-11-13**, GD-01/GD-11 do
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md). Complementa os
[hosts nativos](GAME_DELIVERY_NATIVE_HOSTS.md) e a
[integridade do VSIX](GAME_VSIX_INTEGRITY.md). Verifica dados sob troca de
processos reais; não instala nem certifica aplicativos distribuídos.

## Versões e confiança

O runner [qualify-game-domain-rollback.mjs](../scripts/qualify-game-domain-rollback.mjs)
recebe dois bundles e o SDK exato da versão anterior. O verificador existente
em `smoke-engine-rollback.cjs` foi exportado, mantendo o CLI sob guarda
`require.main`. Confere assinatura oficial e todos os arquivos do SDK antes
de importar seu código. O bootstrap desse SDK confere o bundle anterior.
O atual é desenvolvimento, explicitamente verificado como tal pelo bootstrap
atual; não recebe assinatura ou versão modificadas para parecer uma release.

| Componente | Identidade |
|---|---|
| Atual | `1.0.2`, Node `22.23.4`, `darwin-arm64`, desenvolvimento |
| Manifesto atual | `291efabfc606847ae393c815fc2a339f207c0842cbff6fa8e51d792da8938ae9` |
| Anterior | `1.0.1`, mesmo Node/target, assinatura oficial já existente |
| Manifesto anterior | `59e7eba63a12d81aa5d0646bf5dd2f6fb192cde07a2bbd2f2c481b88cfbe360c` |
| Manifesto SDK anterior | `cea0236ff43a63ba33ef6e198fa4bb07790509ecb3cd6fab04614b645d067b5e` |
| Commit anterior | `f1ebe66fa48ae304f7fa09c34697eb209df5cd32` |

Cada processo usa o Node do respectivo bundle, em estado temporário privado.
O filho recebe ambiente fechado, sem credenciais de modelo/publicação/GitHub.
Não há `runs.start`, inferência, concessão de orçamento, instalador, LaunchAgent,
perfil pessoal ou alteração de chave. A troca de processo exige
`engine.quiesceIfIdle` aceito e encerramento confirmado com código zero.

## Percurso observado

O estado contém dois registros autenticados: `companion-mac` e
`companion-vscode`, com namespaces distintos e sem ferramentas de host.
Na versão atual, para cada produto:

1. Importa histórico público sintético por API, sem executar mensagens.
2. Importa o projeto exportado pela janela Mac no ensaio nativo anterior:
   três revisões e 11 blobs conferidos. Repete a importação para testar idempotência.
3. Cria revisão 4 com título próprio, preservando WAV, AAC, avisos e configuração.
   As 40 referências a arquivos nas quatro revisões são verificadas por tamanho/hash.
4. Produz build Phaser real com compilador empacotado e confere cada arquivo
   via SDK. Build não significa qualidade aprovada.
5. Registra rodada/observação **sintéticas**, assim identificadas. Não há
   participante ou consentimento humano comprovados; qualidade continua falsa.
6. Grava escolhas não enviadas de recursos/áudio no backend privado real de
   rascunhos. Nenhum pedido é despachado por esse rascunho.

Depois de encerrar a versão atual, SQLite somente de leitura calcula contagem
e hash das **23 tabelas `game_*`**, incluindo recibos. Bancos, WAL, chaves e
credenciais não entram no dossiê.

O anterior inicia com o mesmo estado e recupera exatamente os históricos novos.
Recusa jogos com `-32601 / Method not found.`, sem outro motor ou ferramenta
substituta. Cada produto cria outra conversa de domínio sintético nessa versão.
Após encerrá-la, as 23 tabelas de jogos continuam idênticas.

Reativando o atual, são conferidos novamente projeto, revisões, bytes de fontes
e artefatos, jobs, rodada/observação, histórico e rascunho. As conversas criadas
durante o rollback também são recuperadas. Repetir importação/build devolve IDs
originais, sem revisão, job ou build adicional. As tabelas continuam iguais.
As duas identidades não consultam o projeto alheio.

## Resultado e tentativa preservada

Positivo `attempt-2`, no
[dossiê](../output/game-generation/game-domain-rollback-20261113-a1/report.json).
Processos `58919`, `58922` e `58923` encerraram com código zero. Só depois foi
removido seu estado privado.

A primeira tentativa permanece reprovada. Comparava a exportação de playtest
inteira, incluindo `exportedAt`, que a API gera novamente em cada exportação.
O observador final compara todos os campos persistidos e verifica o novo horário
separadamente como inteiro válido, posterior à criação e monotônico. Não relaxa
a comparação de respostas, consentimentos declarados, estudo, build ou resumo.

Os três processos anteriores também encerraram com código zero e seu estado
privado foi conservado. Inspeção posterior readonly confirmou duas produções
terminais e 23 tabelas, sem reinício ou replay. Falha, observador original,
encerramento e diagnóstico ficam preservados; o positivo não os substitui.

Passaram as 40 verificações do repositório e a sintaxe dos dois scripts. O ensaio
completo confirmou os dois bundles novamente após encerrar todos os processos.
Não houve mudança em código de runtime/contratos/interfaces nem novo build do
motor; a suíte de aplicação anterior permanece vinculada ao seu próprio dossiê.

## Limites do aceite

- Processos/SDKs reais em fixture privada, sem instalar `.app` ou VSIX.
- Anterior oficialmente assinado, atual de desenvolvimento: não são duas releases finais.
- Sem checkpoints antigos ou trabalho ativo: não demonstra conversão de grafo,
  interrupção de inferência/build ou reconciliação de efeito desconhecido.
- Preservar arquivos privados não prova que uma UI antiga renderize campos novos.
  Leitores estritos e compatibilidade instalada exigem aceite próprio.
- O build não foi aprovado ou publicado como jogo final; não comprova preservação
  de uma versão jogável aprovada por pessoas.
- Mac/VS Code são namespaces, sem janelas abertas neste ensaio. Evidências de
  janelas separadas não se somam automaticamente a instalação integral.
- Não exercita Navi/Core, atualizador do Alien, outras plataformas, hardware,
  Unity ou participantes reais.

Continuam obrigatórios os três clientes instalados, perfis completos e rollback
com dados novos/versão aprovada, quatro engines, portfólio e avaliação física,
artística e humana. Esta prova reduz uma lacuna de continuidade de dados.
