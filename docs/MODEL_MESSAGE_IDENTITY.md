# Identidade de resposta e de turno do grafo

Estado em **2026-11-11**: correção no motor em desenvolvimento; sem nova
instalação ou release. Leia a [arquitetura da suíte](SUITE_ARCHITECTURE.md) e a
[avaliação de produção](GAME_GENERATION_EVALUATION.md).

## Falha observada

A terceira continuação do jogo `windmail`, run `339c12a4…`, emitiu texto mas
terminou sem resposta final confirmada. A inspeção somente de leitura dos
checkpoints, usando o decodificador oficial, mostrou que uma mensagem AI na
posição18 mudou de15 chamadas de ferramenta para texto sem chamadas, conservando
o mesmo hash de ID. Resultados das ferramentas posteriores permaneceram no fim
da lista. Foi uma substituição de turno anterior por colisão de identidade;
o trecho HTTP real não foi gravado, portanto não se atribui a origem exata do
ID ao provedor ou ao SDK.

As evidências estruturais estão em `verification/terminal-shape.json`,
`terminal-shape-history.json` e `message-identity-shape.json` da tentativa
`output/game-generation/windmail/2026-11-11T13-16-09-385Z-c6ad46a2/`.
Só tipos, contagens, posições e hashes foram exportados. Nenhum checkpoint,
raciocínio, argumento de ferramenta ou credencial foi copiado/modificado.

O reducer oficial usa identidades para atualizar mensagens existentes. Ler uma
resposta AI antiga como se fosse a final esconderia a falha e poderia misturar
resultados de ferramentas. A extração final continua exigindo o último turno
AI elegível; não promove texto intermediário.
[Mensagens no estado LangGraph](https://docs.langchain.com/oss/javascript/langgraph/graph-api#working-with-messages-in-graph-state).

## Fronteira de correção

`packages/agent-core/src/model-message-identity.ts` fornece um middleware
oficial `wrapModelCall`, aplicado por `createProductGraph` antes de entregar a
resposta ao reducer. Se o ID retornado já existir nas mensagens da chamada ou
do estado, cria uma mensagem AI com ID novo. Conteúdo, chamadas/IDs de ferramentas
e metadados de uso/resposta permanecem preservados. Respostas sem colisão não
são alteradas. Isso não é outro cliente HTTP, reducer, agente ou loop.
[Transformação em middleware LangChain](https://docs.langchain.com/oss/javascript/langchain/middleware/custom#wrap-style-hooks).

O middleware cobre os grafos Standard/Deep e os subagentes declarados dos
produtos. Quando o produto não fornece seu perfil `general-purpose`, a composição
Deep usa a especificação pública `GENERAL_PURPOSE_SUBAGENT` com o middleware;
ferramentas, backend e permissões continuam fornecidos pela configuração oficial.
Perfis explícitos preservam suas ferramentas, instruções e permissões.

O ID novo fica no checkpoint oficial antes de executar as ferramentas. Retomar
um checkpoint conserva esse ID e os recibos; não gera outra identidade para uma
operação já executada. IDs das chamadas de ferramenta continuam sujeitos à
identificação persistente de tarefa/mensagem/chamada e à reconciliação existente.
A correção não reescreve checkpoints antigos nem reexecuta efeitos históricos.

## Verificação e limites

`test/engine-message-identity.test.ts` usa o SDK real de Chat Completions com um
servidor local simulado que reutiliza o ID de resposta em todas as chamadas SSE.
Standard/Deep preservam dois pares AI/ferramenta e a resposta final, metadados de
uso e IDs únicos. Retomada não chama o modelo ou executa a ferramenta novamente.
Os casos Deep delegam também ao perfil público e a um especialista explícito,
preservando os resultados finais do filho e do supervisor.

Esses testes reproduzem o mecanismo da falha; não certificam produção artística,
jogo completo ou a instalação dos clientes. Uma continuação real usa um novo
artefato congelado após qualificação, mantendo projeto, recibos e orçamento.
