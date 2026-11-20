# Aliases livres, capacidades declaradas e diagnóstico de conexão

Correção de conexão distribuída separadamente em 2026-11-10: cliente **0.12.5** e
motor **1.0.3**, na [release publicada](https://github.com/rlsgarcia-code/local-agent-companion/releases/tag/companion-engine-v1.0.3),
commit `f2672c210500ca0f24f14639011d97af521f5239`, branch
`fix/windows-model-connection-0.12.5`. A matriz nativa passou nas cinco plataformas.
O trabalho de Game Design deste checkout não faz parte dessa composição. A publicação
não altera instalações existentes nem comprova o gateway corporativo do usuário.
Leia a [arquitetura da suíte](SUITE_ARCHITECTURE.md).

## Configuração no VS Code

Abra **Local Agent Companion: Configure Model Provider**, etapa **Models**.
O alias principal e o alias de visão permanecem visíveis para LiteLLM e OpenAI.
Os oito checkboxes editam o alias indicado em **Features for**:

| Recurso declarado | Significado |
|---|---|
| Function calling | Necessário para usar o modelo como executor com ferramentas |
| Vision | Permite encaminhar imagens pelos caminhos já implementados |
| JSON mode | Registra suporte declarado; não força respostas normais em JSON |
| Tool choice | Registra suporte a escolha de ferramenta; não força uma chamada |
| Parallel Calls | Registra suporte a várias chamadas; não concede execução concorrente ou permissões |
| Prompt caching | Registra suporte do gateway; não envia instruções de cache automaticamente |
| Reasoning | Libera a configuração explícita de esforço; desmarcar omite esse parâmetro |
| PDF input | Registra suporte do modelo; não cria um importador/anexador PDF no cliente |

Pode-se informar um alias como `gpt-5.4` ou um identificador corporativo opaco,
preservando sua grafia no request. Um registro explícito de capacidades prevalece
sobre presets e catálogo, inclusive quando o snapshot classifica o mesmo nome
de outra maneira. Os valores são declarações do usuário sobre aquele gateway,
não afirmações universais sobre um nome comercial de modelo.

O catálogo pode sugerir valores iniciais para aliases conhecidos. Para aliases
desconhecidos, as caixas começam desmarcadas. A API é uma escolha independente:
`auto` respeita uma rota `/responses` configurada explicitamente e, nos demais
casos, preserva Chat Completions, como na 0.11.10. O nome do modelo e o snapshot
não selecionam outra API. Selecione Responses explicitamente quando necessário. OpenAI direto permanece limitado ao
endpoint e à API permitidos pela variante, e Ollama mantém sua integração própria.
Nenhuma declaração habilita rede, provedor, ferramenta, shell ou autoridade KidOS.

A fonte de desenvolvimento também permite declarar a
[janela efetiva de entrada por alias](MODEL_CONTEXT_WINDOWS.md), usada pela
compactação oficial do motor. Esse campo não integra automaticamente a release
1.0.3 citada acima nem reconfigura o servidor de inferência.

## Contratos e execução

- Schema estrito: `packages/contracts/src/model-capabilities.ts`, oito booleanos.
- Perfil por alias: `localAgentCompanion.liteLlmModelProfiles[alias].capabilities`.
- Perfil e mapa de perfis acompanham o ProviderSpec autenticado pelo Agent API.
- Normalização/validação ficam no Agent Core; o SDK e a interface não criam um
  segundo executor. A declaração manual elimina a dependência de reconhecimento
  do nome, mas mantém validação dos campos, API e parâmetros explícitos.
- Perfis portáveis preservam as declarações, sem credenciais. Perfis anteriores
  sem esse campo mantêm a compatibilidade legada até configuração explícita.
- Um perfil sem Function calling pode servir a uma operação sem ferramentas,
  como visão; não pode ser usado como executor de ferramentas.

Em Chat Completions, escolher o esforço `low` acrescenta `"reasoning_effort": "low"`
no mesmo objeto JSON de `model`, `messages` e demais parâmetros. A caixa
**Reasoning** declara suporte, mas não escolhe um esforço. **Omit** mantém o campo
fora do request. Não há uma segunda chamada ou endpoint de reasoning.

JSON mode, cache, PDF e demais capacidades não viram parâmetros arbitrários de
request. O motor continua usando a integração LangChain e os formatos existentes.
Reconhecer capacidade de um modelo não significa que todo cliente já implementa
a experiência correspondente.

## Testes e logs

**Test connection** valida configuração, catálogo opcional, chat com streaming e
schema de ferramenta, e embeddings opcionais. O probe nunca executa a ferramenta.
Sucesso comprova apenas o percurso exercitado, não certifica os oito recursos.

Cada teste recebe UUID e grava início e resultado de cada etapa em
`.local-agent/logs/agent.log` do workspace. **Open test log** abre o arquivo.
O registro contém alias, provedor, plataforma, etapa, método `models.assist`,
API, esforço configurado, duração, estado, categoria de erro e HTTP quando identificável. Não serializa
objetos de erro, causas, corpos HTTP, prompts, chaves ou certificados.
Rotação: 1 MB e um arquivo anterior; eventos são limitados pelo logger existente.
Gravação é best effort; sua falha não altera o resultado da conexão. O arquivo
permanece local e não é enviado automaticamente.

Categorias distinguem `agent_api_timeout`, `model_not_found`, autenticação,
limite de requisições, outros erros HTTP, certificado, DNS, timeout do provedor,
cancelamento, rede, configuração e erro desconhecido. Um `404` genérico não prova que o alias
é inexistente; `model_not_found` exige também mensagem específica sobre modelo.
O timeout da Agent API significa ausência de resposta local dentro do prazo,
não comprova que o gateway respondeu com HTTP 504.

**Export support** preserva apenas ID, etapa, estado, duração, categoria e código
HTTP aceitos pela allowlist. Não incorpora o log bruto, mensagens de erro,
aliases ou endpoints.

## Verificação e liberação

Validar declarações desconhecidas/conflitantes, imports, isolamento entre aliases,
omissão de reasoning, preservação de rotas e rejeição de campos de autoridade.
Usar inferência simulada local para conferir o alias e o corpo transmitidos e
registros sem segredos. Conferir os três provedores no formulário real, incluindo
troca de alias, salvar, reabrir, teste e abertura do log.

Fonte, testes locais e browser com ponte simulada não comprovam instalação no
Windows. O VSIX precisa incorporar um motor assinado que conheça estes campos;
não empacotar a nova interface com o motor antigo apenas por terem versões
compatíveis nominalmente. Fixar nova composição, verificar instalação/rollback
e registrar evidências antes de anunciar distribuição concluída.

## Auditoria da regressão em relação à 0.11.10

Comparação em 2026-11-10 entre `v0.11.10` e o código publicado em
`companion-engine-v1.0.2` (extensão 0.12.4):

- LangChain OpenAI 1.6.2, Core 1.2.17 e SDK OpenAI 7.33.0 permaneceram iguais;
  Undici passou de 6.29.0 para 6.29.1.
- A versão antiga usava Chat Completions diretamente. A publicada acrescentou
  resolução de API pelo catálogo e validação estrita: um perfil custom sem `api`
  para `gpt-5.4` era aceito antes, mas bloqueado por ausência de metadados depois;
  `claude-sonnet-5` no modo automático passou a selecionar Responses.
- Com Chat Completions e preset custom explícitos, comparação com inferência
  interceptada confirmou mesma URL, corpo e cabeçalhos de autenticação para
  parâmetros omitidos, `reasoning_effort=low` e `temperature=0.4`. Streaming,
  `stream_options.include_usage` e schema de ferramenta já existiam antes.
- A chamada de diagnóstico passou da extensão ao serviço. O prazo externo do
  SDK é de 100 segundos e não representa um HTTP 504 do gateway.
- A comparação reproduziu uma espera adicional: depois do stream, o LangChain
  tenta estimar tokens e baixar ranks de `tiktoken.pages.dev`, sem usar o timeout
  da chamada ao provedor. Esse comportamento existe também na dependência
  antiga; a migração não comprova sua introdução, mas a espera foi reproduzida
  no teste e pode explicar um timeout após resposta do gateway. O Windows do
  usuário e a versão do LiteLLM corporativo ainda precisam de evidência própria.

A fonte agora preserva Chat Completions por padrão e usa contagem offline nos
factories compartilhados e Ollama. Ranks cl100k/o200k são empacotados com
`js-tiktoken` 1.0.21; aliases sem codec conhecido usam estimativa UTF-8 local.
O cache contém apenas dois codecs, sem texto do usuário. Essas estimativas não
substituem usage informado pelo provedor nem são limites financeiros exatos.
A implementação usa o método público `getNumTokens`; não altera o loop de agente,
não baixa tabelas em runtime e não permite novos destinos de rede.

## Prazo do transporte comum de inferência

A avaliação real de produção de jogos encontrou outra espera: a chamada terminou
com erro de cabeçalhos do Undici após cerca de cinco minutos, antes do prazo de
dez minutos do SDK fixado. `ProviderModels` agora cria transportes próprios com
`headersTimeout` e `bodyTimeout` iguais ao prazo do modelo: dez minutos por
padrão, ou o valor interno explícito da operação. Reutiliza pools pelo prazo e
fecha todos ao terminar. A configuração usa o mesmo `undici.fetch` já protegido
pela rota exata; a CA corporativa permanece apenas no LiteLLM.

Não é um timeout de turno nem extensão dos limites do produto. Cancelamento do
run e prazos menores de diagnóstico continuam valendo; o executor permanece
sem repetição automática por padrão. Erro de rede não concede autoridade nem
permite trocar provedor. O caminho legado `OllamaModels` tem sua própria política;
esta mudança qualifica o factory comum `ProviderModels`.

Um teste HTTP local exerce requisições reais pelo factory, reutilização de pool,
prazo menor, cancelamento/fechamento da conexão e ausência de repetição. O SDK
fixado pode rotular o abort vindo do fetch externo como `TimeoutError`; o teste
confere o sinal do run e a desconexão, sem depender desse rótulo. Isso não mede
qualidade de geração, espera física de dez minutos ou desempenho de um jogo.
Referências: [Undici 6.29.1](https://github.com/nodejs/undici/blob/v6.29.1/docs/docs/api/Client.md)
e a configuração de cliente suportada pela [integração LangChain](https://docs.langchain.com/oss/javascript/integrations/chat/openai).

## Falha durante a resposta do modelo — fonte de 2026-11-11

Um stream pode falhar com `TypeError: terminated` tanto por desconexão quanto
por inatividade do corpo da resposta. A reprodução local usa o factory real e
LangChain, mas um servidor SSE simulado: um caso fecha a conexão e outro deixa
de enviar dados. Isso não determina retrospectivamente a causa de uma geração.

O callback comum `ModelFailureCallback` observa apenas erros de modelo pela
[API oficial de callbacks](https://reference.langchain.com/javascript/langchain-core/callbacks/base/BaseCallbackHandler).
Ele mantém a associação ao objeto original em memória, sem modificar o erro
durante o grafo ou influenciar a política existente de repetição. Somente a
falha terminal correspondente pode virar um diagnóstico público. Texto igual,
erro de ferramenta, aprovação, admissão ou reconciliação não comprovam essa origem.
Cancelamento pelo sinal do run mantém o caminho de cancelamento.

O executor preparado conserva, pelo callback da invocação raiz, o erro original
antes da projeção do stream v3. Ele retira apenas wrappers oficiais
`MiddlewareError`, preservando a causa original, status HTTP e `AgentError`.
Não procura um erro antigo pelo texto nem escolhe uma falha de subagente como
resultado da execução raiz. O grafo, checkpoints, ferramentas e repetição
continuam sob LangChain/DeepAgents.

Quando a execução termina por um erro reconhecido de transporte do modelo,
`run.error` recebe uma explicação fixa e o serviço registra `model.failure` com
o contrato fechado de [categoria/código](../packages/contracts/src/model-failure.ts).
O evento usa a correlação de sessão/run existente e pode ser recuperado no replay.
Não contém mensagens do provedor, causas brutas, prompts, URLs ou cabeçalhos.
Clientes anteriores podem ignorar o evento e continuam mostrando `run.error`.
Erros HTTP preservam o tratamento existente de credenciais e limites.

Isso não comprova que uma resposta parcial esteja correta, nem repete a chamada,
retoma ferramentas ou muda provedor, contexto ou prazo. Contagem de uso ausente
permanece desconhecida, com a reserva existente; nunca é inferida como zero.
A execução falha e exige continuação explícita, preservando eventos parciais e
os mecanismos existentes de checkpoint/recibos. O caminho de avaliação de
objetivos que já captura sua própria falha mantém seu resultado bloqueado.

Qualificação: Standard/Deep com SSE interrompido, texto parcial, replay
idempotente, evento persistido após reabrir o armazenamento, reserva sem usage,
erros HTTP/autoridade e caminho Mac com inferência simulada. Evidências em
[`provider-termination-20261111-a1`](../output/game-generation/provider-termination-20261111-a1/report.json).
Esta alteração de fonte não atualiza instalações nem torna uma geração falha
um jogo aprovado.

### Prazo do SDK transformado pelo LangChain — 2026-11-11

A reprodução do erro genérico `Request timed out.` no caminho comum encontrou
uma lacuna distinta da inatividade do stream. O SDK OpenAI 7.33.0 produz
`APIConnectionTimeoutError`, mas o wrapper de `@langchain/openai` 1.6.2 transforma
essa instância em `Error` com `name: TimeoutError`, descartando classe/cause. O
callback anterior procurava o nome textual da classe original. O pacote também
renomeia construtores durante o build; comparar essa string não é uma identidade
confiável. A primeira reprodução conservou sua suposição errada de que o callback
receberia a instância do SDK; a observação estrutural seguinte e a fonte oficial
confirmaram a transformação.

O callback agora reconhece a instância oficial por identidade e o tipo
normalizado pelo LangChain. Somente o erro observado na chamada de modelo e
reencontrado como falha terminal recebe `request_timeout`. Texto igual, nome de
construtor forjado, ferramenta, `AgentError` e cancelamento não ganham esse
tratamento. Uma resposta HTTP real — inclusive 408 ou 504, também em `response` ou
`cause` — conserva o erro original. O evento segue o contrato existente, sem
mensagens, causas, cabeçalhos ou credenciais.

O SDK já resolvido em 7.33.0 virou dependência direta exata por causa do uso da
classe pública; não houve atualização de biblioteca. Prazos, retries, provedores,
permissões e grafos permanecem iguais. Os testes Standard/Deep usam HTTP local
que não responde antes do prazo curto de teste; a reprodução CJS usa as mesmas
opções de bundle do motor. Confere um único pedido, diagnóstico persistido,
replay sem redispatch e reserva sem usage preservada. O runtime Mac é testado
nos dois modos com o SDK real e servidor simulado. Aguardar um erro não concede
nenhuma nova chamada ou execução de ferramenta.

A fonte do [wrapper oficial](https://github.com/langchain-ai/langchainjs/blob/main/libs/providers/langchain-openai/src/utils/client.ts)
e a [classe pública do SDK fixado](https://github.com/openai/openai-node/blob/v7.33.0/src/core/error.ts)
sustentam essa integração; a evidência executável usa os módulos locais fixados,
com hashes registrados. O [dossiê da correção](../output/game-generation/model-deadline-20261111-a1/report.json)
preserva a base falha, os processos corrigidos e os limites. Não reclassificar o
timeout histórico do Windmail sem a identidade original: seu evento
`model.failure` continua ausente e o jogo permanece não aprovado.
