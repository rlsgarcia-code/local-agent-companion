# Playtests locais e consentidos

Fonte em **2026-11-11**: contratos, armazenamento transacional, SDKs e coleta no
Game Studio Mac/VS Code disponíveis em desenvolvimento. A integração de
responsáveis no KidOS, a distribuição e a rodada com pessoas reais continuam
pendentes. Ensaios sintéticos não equivalem ao aceite humano do jogo.
Leia o [plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md#portfólio-e-avaliação-humana)
e a [fronteira de qualidade](GAME_PRODUCTION_API.md#qualidade-e-comprovação).

## Finalidade e autoridade

`games.playtests.*` registra observações declaradas por um operador de uma sessão
de playtest. Não é um coletor automatizado, identificação de pessoas ou prova
independente de consentimento. O software não demonstra que um código corresponde
a uma pessoa distinta ou que ela realmente jogou. A conferência da rodada e o
aceite do jogo continuam necessários.

Essas operações não pertencem ao catálogo do agente. Não são anexadas à conversa,
memória ou eventos de inferência, nem enviadas ao modelo. Não criam relatórios
de `GameValidationCollector`, alteram revisões, aprovam qualidade ou avançam etapas.
`qualityApproved` é sempre `false`, inclusive quando os números atingem as metas.
A fonte do resumo é explicitamente `operator-attested`.

Os clientes Mac/VS Code usam seu registro autenticado e namespace existente.
IDs fornecidos não escolhem outro produto, perfil ou workspace. O KidOS recusa
essas rotas: a futura coleta pelo responsável precisa de integração própria,
qualificada e separada do Navi. Não disponibilizar um atalho pelo agente/Core
infantil para declarar avaliações humanas.

## Estudo e rodada

Cada estudo guarda título, descrição do público-alvo e referência imutável ao
build reconhecido pelo serviço: projeto, revisão, hash de fonte, hash de artefato
e engine. Um ID de build inventado ou de outro namespace não é aceito. Não há
URL remota, execução de jogo ou acesso ao host nessas operações.

O protocolo de registro versão 1 corresponde às metas do plano:

- Observar a ação principal sem orientar o participante; registrar os segundos
  observados ou `null` quando a compreensão sem ajuda não ocorreu.
- Registrar uma nota de experiência entre 1 e 5, informada na sessão.
- Confirmar consentimento e que o código representa um participante distinto
  naquela rodada; registrar ambiente e formas de entrada efetivamente usados.
- Usar apenas código UUID, sem solicitar nome, contato, data de nascimento ou
  dados de conta. Notas são opcionais e limitadas; evitar dados identificáveis
  também nos campos de texto livre.

O horário armazenado é o de registro pelo serviço, não uma medição automática do
tempo jogado. O campo de segundos é uma observação do operador, não um cronômetro
certificado. A interface explica essa diferença e exige decisões explícitas;
consentimento, distinção, nota, tempo e ambiente começam sem resposta. Um
rascunho recupera somente os valores digitados pelo operador, sem enviar nada.

O resumo considera **todos** os registros ativos da rodada. Exige ao menos dez;
oito de dez devem compreender em até 30 segundos e sete dar nota de pelo menos 4.
Com mais registros, usa 80% e 70%, arredondados para cima: não seleciona os melhores
dez para esconder observações negativas. Exibe separadamente total registrado,
ativo e retirado. Metas numéricas não certificam diversão, arte, áudio, desempenho,
adequação ao público ou uma rodada com pessoas reais.
O [cálculo compartilhado](GAME_PLAYTEST_TARGETS.md) também corrige a avaliação
de relatórios humanos de grupos maiores; compartilhar a fórmula não transforma
estes registros do operador em relatórios de qualidade.

Mudança do projeto marca o estudo como `stale`. Os registros continuam ligados
ao build antigo, inclusive quando registrados posteriormente; não migram para a
nova versão nem contam como observação dela. Uma rodada após correções deve
referenciar o novo build. Estudos distintos permanecem listáveis, sem escolher
automaticamente uma rodada favorável.

## Persistência, repetição e retirada

Criar, registrar e retirar usam `requestId` com binding do conteúdo e transação
SQLite. A mesma identidade com outro conteúdo é recusada. Um participante só
tem um registro por estudo, inclusive após retirada: um novo pedido não substitui
a nota original nem o conta novamente. Falha de resposta deve conservar ID e
conteúdo; leitura/replay não cria outra observação.

Retirada exige confirmação explícita. O registro ativo vira um tombstone com
IDs e horários; respostas, ambiente e notas deixam o registro consultável. O
recibo de idempotência contém hash e referências, sem guardar uma cópia dessas
respostas. Retomar o pedido antigo retorna o tombstone e não recria os dados.
Isso não promete apagamento físico de páginas SQLite, WAL, backups ou cópias
anteriormente exportadas; não registrar esses arquivos privados como evidência
pública. Há testes de persistência após reinício.

Leituras são paginadas por cursor, com até 100 itens. Limites de armazenamento:
1.000 estudos por projeto e 1.000 registros, incluindo retirados, por estudo.
Esgotar um limite recusa nova gravação com diagnóstico e preserva o que existe;
não trunca, elimina ou renomeia dados automaticamente.

## API e componentes

| Operação | Conteúdo |
|---|---|
| `games.playtests.create` | `requestId`, `buildId`, título e público; retorna estudo fixado |
| `games.playtests.record` | Pedido exato, estudo, código, confirmações, observações e ambiente |
| `games.playtests.correct` | Correção confirmada com hash do registro atual, motivo e respostas; histórico transacional |
| `games.playtests.corrections` | Estado atual e histórico paginado de correções ou tombstones |
| `games.playtests.withdraw` | Pedido exato, estudo, código e confirmação da retirada |
| `games.playtests.read` | Estudo, cursor e limite; resumo e página de registros |
| `games.playtests.list` | Projeto, cursor e limite; estudos, resumos e obsolescência |
| `games.playtests.inspect` | `requestId`; recibo sem respostas, binding do conteúdo e estado atual da retirada |
| `games.playtests.export` | Estudo e escolha explícita de incluir registros; snapshot transacional transferido com hash |

- [Contratos](../packages/contracts/src/game-playtests.ts): formatos fechados,
  relações de observação, tipos públicos e respostas dos SDKs.
- [Domínio do serviço](../packages/agent-service/src/game-playtests.ts): bindings,
  transações, separação por namespace, resumo e tombstones.
- SDK [TypeScript](../packages/client-ts/src/index.ts) e
  [Python](../packages/client-python/companion_client/__init__.py): chamadas sem
  runtime de agente. A capacidade da fonte é `game-playtest-studies-v1`, apenas
  nos produtos autorizados. `game-playtest-studio-v1` anuncia inspeção/exportação
  necessárias à interface nova; nenhuma delas anuncia uma interface instalada.
- [Testes](../test/engine-game-playtests.test.ts): registros inteiramente
  sintéticos, dez resultados, observação adicional desfavorável, retirada,
  replay/reinício, isolamento, staleness e clientes reais por TLS/IPC.

Qualificação e limitações:
[`playtest-recovery-20261111-a1`](../output/game-generation/playtest-recovery-20261111-a1/report.json).
Não houve participante real nesta implementação. A fonte não cumpre sozinha a
exigência de dez pessoas por jogo ou a distribuição final.

## Coleta e recuperação no Studio

A aba **Playtests** permite escolher o build da rodada, definir público e consultar o roteiro,
registrar tempo/nota/ambiente, consultar todas as rodadas e registrar retirada de
consentimento. O público é uma descrição, não um cadastro de pessoas. O roteiro
exibido é o protocolo comum versão 1; não há desenho arbitrário de questionários.
**Jogar este build** abre a revisão exata pelo preview isolado existente e exige
a confirmação normal do host. Registrar uma observação não executa o jogo.

O mesmo controller/SDK serve aos dois clientes. O motor mantém os dados e a
interface não cria um executor ou ferramenta do modelo. Criar, registrar e
retirar exigem modo de edição, seleção exata e confirmação nativa. O controller
confere novamente seleção/permissão depois da confirmação; o serviço valida o
build, namespace e binding transacional. Não transferir esses poderes ao Navi.

Antes de enviar uma alteração, o rascunho e o pedido exato precisam ser
confirmados no armazenamento do host. Uma resposta perdida conserva os campos
bloqueados e **Retomar pedido**. A retomada consulta o recibo sem resultado:
verifica o hash do pedido, estudo, participante e build e pode confirmar a
gravação anterior mesmo em modo somente leitura, sem nova aprovação ou efeito.
Um recibo ausente não prova cancelamento: somente o pedido original pode
prosseguir pelas confirmações normais. Erro, incompatibilidade do motor ou
recusa nessa tentativa não apagam um resultado anterior desconhecido.

Uma observação posteriormente retirada volta como tombstone na retomada do
pedido original. Isso não recria respostas no serviço. Um rascunho antigo ou
exportação já existente pode ainda conter a cópia local anterior; não há promessa
de apagamento físico desses arquivos. A [correção auditada](GAME_PLAYTEST_CORRECTIONS.md)
tem agora fluxo próprio em fonte, com antes/depois, motivo, CAS, consentimento,
recuperação e tombstones na retirada. Não usar retirada como mecanismo genérico
para melhorar as notas. Nem essa correção nem os estudos certificam qualidade.

## Exportação dirigida

**Exportar resumo** contém metadados do estudo/build, totais, metas e estado de
atualização, sem registros individuais. **Exportar registros** inclui também
códigos, respostas, ambiente e notas; a confirmação explicita esse alcance.
O host escolhe a pasta e grava um novo diretório privado por operação, sem
substituir arquivos existentes. Cancelamento ou falha não deixa uma exportação
parcial ativa. O renderer não fornece caminhos do computador.

O JSON conserva os dados exatos. O CSV individual cita todas as células e
neutraliza valores com aparência de fórmula, incluindo espaços/tabulações
iniciais, para que sejam lidos como texto em planilhas. Nenhum arquivo afirma
que as observações são prova independente de consentimento ou qualidade.

## Qualificação da interface em desenvolvimento

O ensaio de recuperação
[`2026-11-11T23-02-15-965Z-bb0967bb`](../output/playwright/game-playtests/runs/2026-11-11T23-02-15-965Z-bb0967bb/report.json)
usou renderer real, controller/SDK, TLS/IPC e motor empacotado, com as duas pontes
de interface emuladas. Conferiu rascunho após destruir o contexto do navegador,
resposta perdida depois da gravação, retomada somente leitura, retirada posterior,
falha ao salvar impedindo envio, exportações separadas, notas como texto e aviso
de rodada antiga. As larguras de 1200 e 760 pixels couberam sem rolagem horizontal.
Isso não é aceite de aplicações instaladas nem participação humana.

Os ensaios posteriores das janelas reais, com suas diferenças de confirmação e
armazenamento, estão na [qualificação do Studio](GAME_STUDIO_UI.md#playtests-e-gravação-durável-no-editor--2026-11-11).
Dossiê de fonte, hashes, testes, falhas preservadas e limitações:
[`playtest-ui-20261111-a1`](../output/game-generation/playtest-ui-20261111-a1/report.json).
