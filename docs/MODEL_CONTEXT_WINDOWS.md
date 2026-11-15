# Janela efetiva de contexto e compactação

Fonte de desenvolvimento em **2026-11-11**, sem instalação ou publicação.
Leia a [arquitetura](SUITE_ARCHITECTURE.md), as
[capacidades de modelo](MODEL_CAPABILITIES.md) e o
[orçamento de inferência](INFERENCE_BUDGETS.md).

## O que configurar

Um alias de modelo não informa a janela realmente configurada no servidor de
inferência. O produto agora permite declarar essa janela de **entrada**, em
tokens, por alias exato. É metadado para gerenciamento de contexto no motor,
não uma opção HTTP, limite financeiro ou certificação do modelo.

- **VS Code:** Configure Model Provider → Models → Effective context window.
  O valor pertence ao alias principal exibido; perfis portáveis o preservam.
- **Mac:** Configuração do ambiente → Configuração ativa → Janela de contexto.
  Selecione o alias, informe o valor e salve. Cada alias conserva seu valor.
- **KidOS:** a interface infantil não configura essa opção. As rotas genéricas
  de gestão de modelos continuam recusadas, e o adaptador protegido mantém seus
  modelos administrativos. Esta alteração não modifica seu catálogo ou gateway.

O valor deve ser inteiro entre 2.048 e 2.000.000. Esses são os limites de
validação do contrato, não capacidades prometidas. Informe o limite efetivo do
ambiente utilizado, não o máximo anunciado para a família. Vazio remove a
declaração e restaura o comportamento anterior. Nenhum valor foi aplicado às
instalações ou inferido para o Ollama do usuário nesta qualificação.

Não são enviados `contextWindow`, `num_ctx`, `options` ou parâmetros arbitrários
ao provedor. Não há mudança de servidor, endpoint, modelo ou permissões.
Declarar uma janela não aumenta a memória disponível no Ollama e não garante
que instruções, ferramentas, anexos e resposta caibam no contexto.

## Contrato, execução e recuperação

| Fronteira | Implementação |
|---|---|
| Validação comum | `packages/contracts/src/model-context.ts` |
| Perfil de inferência | `ProviderSpec.profile.contextWindow` ou `modelProfiles[alias].contextWindow` |
| Configuração Mac | `models.configuration` / `models.configure`, mapa opcional `contextWindows`, com revisão e namespace existentes |
| Disponibilidade | Capacidade `model-context-window-v1`; Mac desabilita o campo quando o motor não a oferece |
| Modelo | `packages/agent-core/src/model-context.ts`: subclasses das integrações oficiais, sobrescrevendo somente o getter público `profile.maxInputTokens` |
| Grafo | `packages/agent-core/src/graph.ts`: middleware oficial, sem outro executor ou algoritmo de resumo |

O factory seleciona primeiro o perfil do alias/papel pelos mecanismos existentes.
A declaração não altera as demais capacidades de seu perfil nem a contagem
offline. O Standard acrescenta o middleware oficial somente quando há declaração
explícita: gatilho em 85% e retenção de mensagens recentes em aproximadamente
10%. O Deep utiliza a política nativa baseada no perfil efetivo, mantendo sua
política anterior quando não há declaração. Contagem/compactação são estimativas
da biblioteca; não constituem um teto exato do provedor.

O serviço captura a configuração Mac na admissão do run, em recibo privado
transacional. Retomada e reinício recuperam esse valor. Alterar preferências
não muda um run existente; execuções novas recebem a configuração nova.
Runs legados sem o recibo mantêm o padrão anterior. Clientes antigos que editam
somente papéis não apagam o mapa; um mapa explicitamente vazio o remove.
Conflitos de revisão continuam exigindo atualização da configuração.

A UI não monta grafos nem compacta mensagens. O formulário Mac preserva entrada
ainda não salva durante atualização e bloqueia os campos enquanto salva.
Fechar/reabrir o aplicativo recupera a configuração confirmada pelo serviço.
Esta declaração não torna rascunhos de configuração não salvos duráveis.

## Privacidade e orçamento

O teste inicial encontrou saída interna do resumo Deep na projeção pública de
mensagens: a chamada ocorre dentro do nó de modelo e não era ocultada pelo
filtro de nomes de nós. O middleware comum agora fornece uma vinculação
Runnable oficial com a marca `nostream` somente para a chamada nativa de
compactação e restaura o modelo original antes da execução normal. Aplica a
mesma fronteira aos perfis de subagentes; não altera tags globais do modelo,
callbacks de orçamento, políticas de repetição ou o algoritmo da biblioteca.

Compactar continua consumindo uma chamada e os tokens informados/reservados no
orçamento compartilhado. O resumo interno não deve virar mensagem pública.
O checkpoint privado continua sob o saver oficial; os dados de domínio do jogo
não são truncados ou reescritos para fazer caber uma chamada.

Referências: [summarizationMiddleware](https://reference.langchain.com/javascript/langchain/index/summarizationMiddleware),
[middleware Deep](https://reference.langchain.com/javascript/deepagents/index/createSummarizationMiddleware)
e [política baseada em perfil](https://reference.langchain.com/javascript/deepagents/middleware/computeSummarizationDefaults).
As APIs e o comportamento foram também conferidos nas dependências exatas do
lock; documentação de uma versão mais nova não substitui essa conferência.

## Evidências e limites

O [dossiê de contexto](../output/game-generation/model-context-20261111-a1/report.json)
vincula fontes, logs, capturas e o motor de desenvolvimento congelado.

- Suíte: 628 testes aprovados, um opcional ignorado; 31 verificações do
  repositório. Check, builds de extensão/Mac/motor e roteamento simulado passaram.
- Testes Standard/Deep usam LangChain real e SSE local simulado. Cada cenário
  gera um resumo privado e uma resposta pública, contabiliza duas chamadas e
  210 tokens e recupera o checkpoint sem outra chamada.
- Qualificação separada pelo SDK/TLS no motor empacotado confere os dois modos,
  ausência do marcador privado no snapshot público, corpo do provedor,
  orçamento e reinício com replay idempotente sem nova inferência.
- Mac: Electron/preload/renderer reais, SDK/TLS e configurações no serviço;
  bootstrap, inventário Ollama e atraso da primeira gravação são fixtures.
  Testa aliases, atualização com edição local, bloqueio durante salvamento,
  reabertura, remoção e recusa de valor inválido.
- VS Code: HTML/JS reais no Chromium com ponte de host simulada, para os três
  provedores. Confere valor no payload e reabertura quando aplicável. Isso não
  comprova a extensão instalada, Windows ou migração de preferências pessoais.

Falhas anteriores de teste permanecem identificadas: corrida entre compilação
e os scripts visuais, teste que não aguardava cancelamento e chave de
idempotência de fixture reutilizada entre sessões diferentes. Corrigir as
fixtures não autoriza relaxar os estados ou vínculos do serviço.

O ensaio não chama um modelo real, não continua o Windmail, não altera seu
orçamento e não prova a causa de seu timeout. Distribuição assinada, aceite nas
instalações, configuração administrativa protegida KidOS e qualificação de
produção real com uma janela explicitamente verificada continuam pendentes.

## Isolamento de compactação entre supervisor e especialistas — 2026-11-13 UTC

A conferência encontrou um desvio na integração: a mesma instância privada de
`createSummarizationMiddleware` era inserida na pilha do supervisor e nas pilhas
dos especialistas. A biblioteca fixada **deepagents1.15.0** calcula defaults na
primeira chamada e os mantém na closure, junto de identificador de histórico e
ajuste de estimativa após overflow. Um supervisor sem perfil podia fixar o
fallback de170mil tokens também para um especialista que declarava8192 tokens.
Cada pilha agora recebe sua própria instância da **mesma biblioteca oficial**.
A vinculação temporária `nostream` continua sendo aplicada somente ao resumo.

A reprodução em `test/graph-compaction-isolation.test.ts` usa o grafo Deep,
subagente declarado, ferramenta de leitura, callback de orçamento e saver SQLite
oficiais. Modelos são inteiramente simulados; não têm endpoint ou credenciais.
O controle empacota o grafo anterior exato em arquivo separado, sem substituir
fontes da árvore de trabalho, mantendo todos os demais arquivos iguais.

| Observação | Controle anterior | Fonte corrigida |
|---|---:|---:|
| Resumos do especialista com janela8192 | 0 | 2 |
| Invocações normais supervisor/especialista | 2/17 | 2/17 |
| Leituras executadas | 16 | 16 |
| Maior entrada normal de histórico em caracteres | 41.175 | 18.416 |
| Admissões/liquidações simuladas | 19/19 | 21/21 |

Os caracteres acima medem somente a projeção JSON dos conteúdos das mensagens,
sem schemas/system prompt; **não são tokens, janela total ou custo do provedor**.
Cada resumo continua consumindo uma chamada e sua usage/reserva. O ensaio confere
as16 leituras em ordem, ausência do marcador de resumo no texto público e replay
do checkpoint concluído sem outra chamada ou leitura. O resumo permanece privado.
O controle anterior falha na asserção de compactação; essa falha foi preservada.
Um erro anterior de compilação da fixture também permanece nos logs; ela passou
a observar tags pelo callback público, sem acessar campo protegido da biblioteca.

Evidências: `output/game-generation/compaction-isolation-20261113-a1/`, com
snapshots de fonte, hashes, controles antes/depois e regressão. A correção não
altera contratos de modelo, credenciais, autoridade, configuração administrativa,
releases ou instalações. Não fornece outro loop, algoritmo de resumo ou backend.
A [fonte oficial](https://github.com/langchain-ai/deepagentsjs/blob/main/libs/deepagents/src/middleware/summarization.ts)
e as [APIs oficiais](https://reference.langchain.com/javascript/deepagents/index/createSummarizationMiddleware)
foram comparadas à dependência exata; mudanças posteriores devem reconferi-la.

### Limite dessa correção para a avaliação com Luna

Uma inspeção apenas do construtor mostra que a integração OpenAI fixada ainda
não retorna `profile.maxInputTokens` para `gpt-6-luna`. Nessa condição a biblioteca
usa o fallback170mil, sem inferir a janela pelo nome. A [documentação do modelo](https://developers.openai.com/api/docs/models/gpt-6-luna)
não é autorização para inventar uma configuração efetiva de entrada ou reduzir
esse metadado apenas para forçar compactação barata.

A correção entre pilhas não antecipa esse gatilho do supervisor, não comprova
economia/qualidade com o provedor real e não renova a avaliação. A fonte agora
tem um [alvo opcional de contexto de trabalho](CONTEXT_WORKING_BUDGET.md), separado
da janela real e do teto de inferência, com qualificação própria de retenção,
captura por run e retomada. Ausência preserva o comportamento descrito acima;
não foi ativado na avaliação Luna ou nas instalações.
O Correio das Correntes continua na revisão47, sem nova invocação; o novo bloco
com Luna permanece pendente de autorização. Não houve corte silencioso de
arquivos, relatórios, mensagens públicas ou checkpoints para tentar liberá-lo.

A regressão completa dessa correção passou:667 testes, um opt-in ignorado,
31 verificações do repositório, check/build e roteamento local somente leitura.
Esses resultados de desenvolvimento não substituem a qualificação real pendente.
