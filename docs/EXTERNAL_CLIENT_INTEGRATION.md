# Clientes independentes das interfaces Companion

Auditoria de fronteira em **2026-11-11**. Leia a
[arquitetura da suíte](SUITE_ARCHITECTURE.md). Este documento registra requisitos
e lacunas; não declara uma integração externa migrada ou instalada.

## Dependência correta

Um produto como Med-Graph deve consumir o serviço local do motor por SDK/API
versionados e autenticados. VS Code e macOS Companion são outros clientes. O
produto não pode depender dessas interfaces para configurar ferramentas,
aprovar acesso, manter credenciais ou executar inteligência independente delas.
Recursos realmente dependentes de um host indisponível têm espera explícita;
registrar outro produto como cliente do editor não resolve a fronteira.

O adaptador fino pertence ao repositório do produto. Traduz mensagens, eventos e
recursos autorizados; não cria modelo, grafo, memória geral ou loop de ferramentas.
A Agent API permanece IPC local autenticado. Uma fachada HTTP interna do produto
não vira endpoint de domínio dentro do motor comum.

Configuração e aprovação de conexões pertencem ao produto/host autorizado que
as utiliza. O serviço e os adaptadores validam identidade, catálogo, permissões
e ciclo de vida. A interface apresenta as decisões; não é a origem do motor.
Um produto independente não deve exigir o Secret Storage do editor.

## Desvio encontrado no Med-Graph

A integração em `/Users/robinsongarcia/projects/med-graph` usa
`apps/api/companion.py`: descoberta de uma ponte HTTP com protocolo numérico 1,
health/threads/runs e `clinical-mcp/setup`. A interface em
`apps/web/src/ClinicalHome.tsx` manda confirmar a allowlist no VS Code.

A referência declarada é outro checkout,
`/Users/robinsongarcia/projects/codex-dev-companion`, cujo `package.json` declara
0.11.10. Seu `src/extension.ts` cria `DevelopmentAgent` e `CompanionBridgeServer`
dentro da ativação do VS Code. A configuração clínica chama a webview. O
documento `docs/architecture/local-agent-companion-integration.md` do Med-Graph
ainda descreve `MemorySaver`, runtime e segredos no editor, apesar de também
afirmar que há serviço/SDK. Essa contradição não comprova uma migração.

A consulta somente de estado a `/api/companion/status` respondeu `available:true`,
`status:ready`, protocolo 1 e `clinicalMcpConnected:false`. Esse estado refere-se
à ponte consumida pelo Med-Graph; não comprova uso da Agent API comum ou versão
do motor instalado. Nenhum paciente ou modelo foi consultado para esta auditoria.
Um checkout não substitui manifesto dos binários ativos.

## Lacunas da migração

1. **Registro próprio.** O contrato atual lista somente `companion-mac`,
   `companion-vscode` e `kidos`. Acrescentar suporte genérico a consumidores
   provisionados, com catálogo/política exatos. Não forjar o produto do editor,
   relaxar restrições KidOS ou permitir autoinscrição irrestrita por crianças.
   Conferir [identidades](../packages/contracts/src/index.ts).
2. **Ferramentas do consumidor.** Há caminhos exclusivos do editor no
   [Core](../packages/agent-core/src/index.ts) e no
   [serviço](../packages/agent-service/src/service.ts). O novo adaptador precisa
   de catálogo e transporte próprios, com decisões pela sua interface e
   recuperação independente da extensão. Regras/rotas clínicas ficam no Med-Graph.
3. **Configuração efetiva.** Importação, revisão da allowlist, teste de conexão
   e revogação devem funcionar no Med-Graph. A aprovação continua obrigatória.
   Mudar o texto ou marcar o MCP como conectado não corrige a dependência.
4. **Estado isolado.** Conversas, memória, permissões e credenciais mantêm seu
   namespace. Compartilhar configurações exige decisão e contrato explícitos,
   sem dependência tácita do workspace do editor. Preservar as variantes e
   rotas de provedor; trocar de interface não habilita endpoints novos.
5. **Retenção sensível.** O Med-Graph define que conteúdo clínico não entra em
   memória geral durável. Usar o saver SQLite normal sem política genérica de
   execução/retenção adequada violaria esse requisito. Distinguir contexto
   transitório, dados de domínio e metadados de recuperação, com provas de
   ausência do conteúdo nos checkpoints/eventos/logs não autorizados a retê-lo.
   Usar mecanismos oficiais LangChain/LangGraph, sem outro executor no adaptador.
6. **Versões exatas.** Fixar SDK/motor publicados e verificados, diagnosticar
   o artefato real e migrar domínio sem reexecutar ferramentas. Não depender
   de fontes de outro checkout nem importar diretamente checkpoints antigos.

O motor extraído para Mac/VS Code/Navi não torna automaticamente o Med-Graph um
cliente migrado. O caminho legado deve ficar identificado, sem fallback silencioso.

## Aceite da correção

Demonstrar com dados fictícios e VS Code/macOS Companion fechados: configurar e
aprovar a conexão pelo Med-Graph; executar no mesmo artefato independente; manter
namespace, catálogo, política e versão próprios; fechar/reabrir a interface e
reiniciar o serviço sem duplicar efeitos; revogar o acesso; conferir retenção e
ausência de segredos/contexto proibido nos armazenamentos genéricos.

As decisões clínicas permanecem no produto. Confirmação de plano não valida
registro clínico. Atualizar as referências contraditórias nos dois repositórios
e registrar os percursos reais antes de declarar a migração concluída.
