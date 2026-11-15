# Reserva de inferência conforme o pedido

Fonte e pacote de desenvolvimento em **2026-11-13**, sem instalação ou release.
Leia [orçamentos compartilhados](INFERENCE_BUDGETS.md),
[limites do proprietário](OWNER_INFERENCE_LIMITS.md) e a
[arquitetura da suíte](SUITE_ARCHITECTURE.md).

## Problema observado

O [segundo bloco autorizado do Luna](GAME_GENERATION_ADDITIONAL_BLOCK.md)
terminou com 58 chamadas novas e 4.200.064 tokens informados: 5.760 acima da
autorização de 4.194.304. A última chamada havia sido admitida com a reserva fixa
de 65.536. O excesso continua integralmente registrado, com as reservas antigas
de uso desconhecido preservadas. Esta alteração não reescreve aquela execução,
não devolve consumo e não autoriza um terceiro bloco.

A regressão local reproduziu a admissão de uma entrada grande com reserva fixa:
o modelo oficial LangChain, usando somente um `fetch` simulado, chegou ao
provedor falso quando deveria ter sido recusado. Com a mudança, a mesma entrada
é recusada antes do envio, sem registrar uma chamada admitida.

## Responsabilidades e cálculo

| Camada | Responsabilidade |
|---|---|
| `agent-core/src/inference-request-size.ts` | Estimativa transitória do pedido no callback oficial do modelo |
| `agent-core/src/inference-budget.ts` | Encaminha apenas o número pela porta interna de admissão |
| `contracts/src/inference-budget.ts` | Projeção pura da demanda e campo opcional de decisão |
| `agent-service/src/inference-budgets.ts` | Reserva transacional, decisões e recibos persistidos |
| `agent-service/src/service.ts` | Espera/confirmação existente, vinculada à demanda exata |
| Interfaces e SDKs | Exibem decisões; não escolhem a reserva ou concedem cotas |

Os caminhos acima ficam dentro de `packages/`. LangChain/DeepAgents continuam
executando o grafo, ferramentas, compactação e checkpoints. Não há outro loop,
cliente HTTP, provedor ou endpoint.

Quando o callback oferece `invocation_params.model`, a estimativa usa os bytes
UTF-8 da serialização de **mensagens, tools/functions, response_format,
tool_choice e function_call**. Soma margem de resposta de pelo menos 65.536,
ou o maior `max_completion_tokens`, `max_tokens` ou `max_output_tokens`
inteiro positivo informado. O serviço reserva o maior entre esse valor e os
pisos de todos os escopos envolvidos. O piso instalado não é reduzido.

O cálculo acontece no início da chamada efetiva, após a preparação do grafo.
Se DeepAgents mover um texto humano grande para seus arquivos virtuais, a
reserva considera a mensagem preparada que chega ao callback. Essa operação
nativa continua ativa; a mudança não lê arquivos virtuais por fora do grafo.

Sem os metadados suportados, permanece o piso anterior. Uma projeção que não
possa ser serializada com segurança, ultrapasse 64 MiB ou produza inteiro
inválido recusa a chamada. Não serializa modelo, URL, headers, credenciais ou
os demais parâmetros arbitrários da configuração. O conteúdo não atravessa a
porta de orçamento; o ledger recebe somente IDs, escopos, reserva e uso.

## Decisão, contabilização e recuperação

`nextReservationTokens` é opcional e aparece na projeção de uma decisão que
precisa de mais capacidade. Não vira piso permanente nem campo de configuração
do cliente. O binding inclui esse número quando presente; decisões antigas sem
o campo conservam seu binding. O serviço reavalia o estado antes da concessão,
preservando idempotência, concorrência e o máximo de blocos instalado.

Pedidos que não cabem nem no máximo permitido são recusados sem pedir uma
confirmação incapaz de resolvê-los. A capacidade
`request-sized-inference-reservations-v1` é anunciada apenas aos produtos
comuns. O adaptador/gateway e a autoridade Root do KidOS continuam separados;
esta capacidade não habilita orçamento workspace no Navi.

Uma recusa não cria recibo de chamada nem aumenta contadores. Uma admissão grava
a reserva efetiva em cada escopo e no recibo original. Uso informado ajusta esse
valor ao total real. Falha, ausência de uso ou reinício mantêm **toda a reserva
admitida**, inclusive quando maior que 65.536. Repetir o ID pendente não amplia
sua reserva; uma demanda aumentada sob o mesmo ID é recusada.

O qualificador de continuação compara a decisão exata com uma projeção dos
orçamentos autenticados atuais. Isso preserva a autorização limitada existente;
não executa uma avaliação nem cria nova permissão por conta própria.

## Limites da estimativa

Bytes são uma aproximação conservadora local, não contagem exata do provedor.
Tokenização, imagens/arquivos, formatação interna e resposta gerada podem
divergir. Uso real superior à reserva continua registrado integralmente; a
próxima chamada pode ser bloqueada. **Não é teto rígido de faturamento ou da
resposta em curso**, e não modifica os retries oficiais do SDK.

A documentação da OpenAI distingue estimativa local e contagem da entrada
preparada, especialmente com ferramentas, schemas e mídia. O endpoint descrito
para contagem pertence à Responses API; esta implementação preserva a rota
Chat Completions autorizada e não o adiciona.
[Referência oficial](https://developers.openai.com/api/docs/guides/token-counting).
O ponto de integração usa os argumentos oficiais do
[callback LangChain](https://reference.langchain.com/javascript/langchain-core/callbacks/base/BaseCallbackHandler/handleChatModelStart).

Esta frente melhora a admissão. Não reduz o catálogo, prompts ou uso real dos
jogos e não comprova eficiência, qualidade artística ou conclusão de geração.

## Evidências

O [dossiê](../output/game-generation/request-sized-reservations-20261113-a1/report.json)
vincula fontes, regressão, logs e o novo pacote de desenvolvimento
`bc8d10e1651c11f52ccdb59ff88650a8c7857f5c476f06a7ab42f3f103486b06`.

- 762 testes passaram, um opt-in ignorado, mais 40 verificações de repositório;
  tipos, builds de extensão/desktop/motor e roteamento simulado passaram.
- O primeiro ciclo completo reteve sete falhas de assertions antigas que
  esperavam reserva fixa. Foram alteradas para conferir o recibo exato e sua
  preservação como uso desconhecido, mantendo o restante dos cenários.
- `scripts/qualify-request-sized-reservations.mjs` usa Node 22.23.4,
  serviço/SDK/TLS/IPC reais e SSE falso em loopback. Quatro registros separados
  Mac/VS Code × Standard/Deep, pela Agent API comum, recusaram a entrada grande
  antes do provedor, admitiram duas pequenas e preservaram o resultado após
  reiniciar no mesmo estado. Oito pedidos simulados, zero confirmações, zero
  chamadas reais; dois processos encerrados com código 0 e estado privado removido.
- A primeira observação reteve uma expectativa incorreta sobre entrada humana
  que DeepAgents havia reduzido nativamente. A segunda excedeu o tamanho público
  permitido para `systemPrompt`, sendo recusada na API; o processo posteriormente
  ausente não tem código de saída registrado. Ambas permanecem preservadas.
  O ensaio final usa contexto de sistema dentro do contrato e um orçamento
  restritivo apenas da fixture; não relaxa middleware ou política de produto.

Não é aceite das interfaces instaladas, inferência real, composição protegida
KidOS, cinco plataformas, jogo completo, jogadores reais ou release. O estado
privado da avaliação Luna anterior permanece independente e não foi retomado.
