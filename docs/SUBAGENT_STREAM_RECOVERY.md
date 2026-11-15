# Falhas nas projeções de subagentes

Correção em fonte, **2026-11-11**, no executor comum dos produtos. Leia a
[arquitetura](SUITE_ARCHITECTURE.md), o
[diagnóstico de modelos](MODEL_CAPABILITIES.md#falha-durante-a-resposta-do-modelo--fonte-de-2026-11-11)
e o [contrato v3 oficial](https://reference.langchain.com/javascript/langchain/index/ReactAgent/streamEvents).

## Falha observada

A continuação Windmail `2026-11-11T21-47-46-521Z-f6dda6d8`, motor de desenvolvimento
`512c1e6366a9354a9d483a0978e9f2988fe43304288b0ca737f7d17ed8bc9a29`,
perdeu conexão após uma recusa de orçamento. O processo original ficou ausente;
o armazenamento ainda dizia `running`. Não era um resultado terminal do run nem
um timeout que autorizasse reiniciar ou repetir ferramentas.

O log local contém `Subagent … failed` originado no transformer oficial, seguido
de `StreamMux`/lifecycle/pump. O v3 produz `output` para cada subagente mesmo que
o consumidor principal só esteja lendo mensagens, ferramentas e valores raiz.
Sua rejeição sem observador derrubava o Node. Uma reprodução isolada com os
módulos anteriores confirmou exit1 tanto para falha de stream do especialista
quanto para admissão recusada. Ela não depende de Ollama ou do código do jogo.

## Correção e limites

`executePreparedGraph` agora observa também `run.subagents`. A observação acompanha
recursivamente resultado, mensagens e ferramentas dos filhos, sem iniciar,
repetir ou agendar subagentes. `settleToolCallStreams` liga os observadores das
promessas quando cada handle chega, sem esperar uma chamada anterior para
observar outra já iniciada.

`consumeAssistantMessageStreams` liga o observador de `output` antes de aguardar
o texto. Assim, falha do iterador de texto não deixa a promessa irmã sem
tratamento, inclusive nas saídas ocultas de compactação e dos especialistas.
O texto dos filhos é drenado sem publicação pela nova observação. Não se lê nem
expõe raciocínio interno e não há outro loop de inteligência.

Uma falha do filho não decide automaticamente sucesso ou fracasso do supervisor:
o grafo oficial e seu resultado raiz continuam sendo a autoridade. O supervisor
pode tratar a falha; se ela chegar à raiz, o caminho normal de erro permanece.
Os observadores não autorizam cotas, ferramentas ou efeitos e não mudam retries,
cancelamento, provedor ou checkpoints.

Os testes usam processo filho próprio para provar sobrevivência do Node, além
do resultado da função. A versão corrigida chega ao marcador de término; a
anterior morre com a rejeição não observada. A recusa impede até a chamada ao
provedor simulado do filho. Outros testes cobrem falha simultânea de texto e
resultado, visível/oculto. Não se instalou um handler global que esconda
rejeições desconhecidas.

## Recuperação do caso original

A inspeção copiou main/WAL/SHM para um diretório privado temporário, conferiu
hashes estáveis e consultou somente metadados na cópia. Não leu checkpoints,
prompts ou credenciais para o relatório. A cópia foi removida. Havia sete chamadas
com usage, nenhuma admissão pendente, nenhum job não terminal e nenhum recibo
de ferramenta `started`. Projetos continuavam nas revisões 31 e 6.

Após qualificação, o novo motor foi congelado lado a lado apenas nesse estado
privado. O procedimento conferiu novamente PID ausente, conexão recusada e
identidade/UID/inode do socket obsoleto antes de retirar somente aquele socket.
Guardou backup privado do SQLite e usou a recuperação oficial, sem `runs.resume`,
nova inferência ou execução de ferramenta. O run ficou `awaiting_host`, mantendo
projetos e contadores. O serviço criado pelo ensaio foi encerrado normalmente.
Isso não atualizou LaunchAgent, aplicativos, Alien, serviços do sistema ou release.

A etapa `core` do projeto original chegou às 128 chamadas do primeiro bloco.
A política do ensaio recusou ampliação; a quota permanece igual e sua continuação
exige autorização explícita. A recuperação não converte essa recusa em aprovação.
O caso continua sem jogo aprovado e sem relatório terminal de geração fabricado.

Evidências no diretório
[`2026-11-11T21-47-46-521Z-f6dda6d8`](../output/game-generation/windmail/2026-11-11T21-47-46-521Z-f6dda6d8/recovery.json)
e no [registro da qualificação](../output/game-generation/playtest-recovery-20261111-a1/report.json).
O backup contém estado privado e não deve ser copiado para distribuição ou PR.
