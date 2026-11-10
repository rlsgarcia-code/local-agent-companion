# Aliases livres, capacidades declaradas e diagnóstico de conexão

Composição de distribuição preparada em 2026-11-10: cliente 0.12.5 e motor 1.0.3.
A correção exige os dois componentes e não altera os VSIX anteriores.
Leia a [arquitetura da suíte](../README.md#arquitetura).

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
