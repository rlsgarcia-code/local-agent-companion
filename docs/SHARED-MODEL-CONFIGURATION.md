# Configuração compartilhada de modelos

## Objetivo

O Local Companion é a autoridade única para seleção de provedor, catálogo, modelos por função e credenciais. Mac, Med-Graph e futuras interfaces apresentam ou consomem essa configuração; não implementam motores de IA paralelos.

## Contrato

Uma configuração contém:

- `provider`: `ollama` ou `openai` no aplicativo Mac;
- `selectionMode`: `optimized` ou `custom`;
- `optimizationProfile`: `quality`, `balanced` ou `speed`;
- `roles`: `executor`, `planner`, `evaluator`, `vision` e `embedding`;
- `endpoint`: loopback `/v1` para Ollama ou a base fixa oficial da OpenAI;
- `credentialRef`: referência opaca, nunca o segredo.

O serviço local oferece `models.configuration`, `models.configure` e `models.catalog`; o SDK TypeScript expõe os wrappers tipados `modelConfiguration()`, `configureModels()` e `modelCatalog()`. A lista é obtida do servidor ativo. O catálogo OpenAI usa somente `GET https://api.openai.com/v1/models`, sem redirects; Ollama permanece restrito ao loopback.

## Credenciais

No macOS, a chave OpenAI é cifrada com `safeStorage`, que usa o Keychain. O processo de interface entrega ao serviço um lease em memória apenas para atualizar o catálogo ou executar uma solicitação. Estado persistido, snapshots e integrações recebem somente `openAiKeyStored` e `credentialRef`.

## Integração do Med-Graph

O adaptador do Med-Graph deve:

1. registrar-se como cliente Companion autorizado;
2. ler `models.configuration` ao abrir a aplicação e observar novas revisões;
3. usar `models.catalog` para apresentar escolhas, sem chamar Ollama/OpenAI diretamente;
4. enviar a função clínica desejada — por exemplo, extração, composição ou embedding — e deixar o Companion resolver o modelo configurado;
5. solicitar ao host a presença da credencial quando necessário, sem armazenar ou transportar a chave.

O Med-Graph pode oferecer um atalho para abrir a configuração global, mas não mantém uma segunda seleção divergente. Preferências clínicas específicas devem ser capacidades ou políticas da tarefa, não outra credencial ou outro catálogo.

## Limites

- O VSIX preserva suas variantes de distribuição e nunca habilita simultaneamente os dois provedores opcionais no mesmo artefato.
- O aplicativo Mac aceita somente Ollama e OpenAI fixa; LiteLLM continua reservado às superfícies autorizadas.
- Trocar provedor não altera memória, histórico ou autonomia.
- A recomendação otimizada não concede ferramentas nem amplia permissões.
