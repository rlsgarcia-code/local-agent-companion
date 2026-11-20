# Game Design

Especialização do Local Agent Companion para produção de jogos. Permanece neste
repositório como pacote separado, usando o motor comum; não terá serviço, loop de
agente ou permissões próprios.

## Referências de desenvolvimento

Leia nesta ordem:

1. [Arquitetura da suíte](../../docs/SUITE_ARCHITECTURE.md) e
   [instruções do repositório](../../AGENTS.md).
2. [Plano completo Game Design 1.0](../../docs/GAME_DESIGN_IMPLEMENTATION_PLAN.md):
   escopo confirmado, etapas, critérios de saída e aceite final.
3. [Acompanhamento da implementação](../../docs/GAME_DESIGN_IMPLEMENTATION_STATUS.md):
   código, evidências e lacunas; não é uma redução do plano.
4. [Contrato e estado do módulo](../../docs/GAME_DESIGN.md) e
   [integração com o executor](../../docs/GAME_AGENT_PRODUCTION.md).

## Entrega confirmada

- Jogos web 2D e 3D como caminho principal, com Phaser e Babylon.js.
- Adaptadores funcionais Unity e Godot nesta entrega: criar, editar, construir,
  executar e testar projetos reais.
- Single-player e multiplayer local; jogos locais e exportáveis.
- Arte, animação e áudio por geração original, bibliotecas licenciadas e edição
  dirigida, com origem e licença registradas.
- Produção, revisão, preview e exportação nos clientes Mac e VS Code, além de
  integração protegida Navi/KidOS.
- Seis jogos completos de referência, pedidos inéditos, testes técnicos,
  avaliação humana e instalação com rollback preservando os dados.

A referência de qualidade é o acabamento de jogos encontrados na Poki. O aceite
mensurável está no plano; geração de código, build ou fixture jogável não encerra
a entrega. Integração comercial com a Poki, anúncios, servidores e multiplayer
online ficam fora desta etapa.

## Onde implementar

| Mudança | Responsável |
|---|---|
| Conhecimento, perfis e critérios de design | Este pacote |
| Tipos públicos, schemas e compatibilidade | `packages/contracts` e SDKs |
| Grafos, modelos, planejamento e revisão de conclusão | `packages/agent-core` |
| Projetos, revisões, jobs, recuperação e recibos | `packages/agent-service` |
| Contratos de execução e processamento | `packages/game-production` |
| Builds, mídia e observação reais | Pacotes de adaptadores autorizados |
| Apresentação, decisões e recursos da interface | `desktop` e `src` |
| Core, broker, jogador, políticas e Navi | Repositório KidOS |

Comece pela [API de projetos](../../docs/GAME_PROJECTS_API.md) e pela
[API de produção](../../docs/GAME_PRODUCTION_API.md) ao atravessar essas camadas.
Para imagens, atlas e áudio, leia o [pipeline de assets](../../docs/GAME_ASSET_PIPELINE.md).
O [worker fixo de mídia](../../docs/GAME_MEDIA_WORKER.md) e o broker/porta KidOS
opt-in ficam separados desta especialização. A integração em fonte conta a
alocação Root conjunta, com composição offline de worker/serviço/Core/Root real;
isolamento instalado e distribuição ainda exigem aceite.
Ensaio de codecs não concede autoridade nem habilita mídia no Navi.
Para modelos, materiais, rig e animação com receitas tipadas, leia
[Blender isolado](../../docs/GAME_BLENDER_ADAPTER.md); o processador é um adaptador,
sem inteligência ou permissões próprias neste pacote.
Para as superfícies Mac/VS Code, leia [Game Studio](../../docs/GAME_STUDIO_UI.md).
Para alterar trechos de código preservando a fonte e os recibos, leia
[edição dirigida](../../docs/GAME_FILE_EDITS.md); o catálogo e a transação
pertencem ao serviço, sem editor ou executor nesta especialização.
Para revisar mudanças estruturais, leia a [comparação de revisões](../../docs/GAME_REVISION_COMPARISON.md).
A projeção pura pertence a este pacote; autorização e apresentação continuam no
serviço e nos clientes. Comparar campos ou hashes não executa ou aprova um jogo.
Para revisar candidatos 3D, leia o [visor de modelos](../../docs/GAME_MODEL_VIEWER.md).
O visor pertence aos adaptadores/hosts e não acrescenta um runtime de inteligência
ou autoridade a este pacote de especialização.
Para etapas, critérios e alocação de pedidos, leia
[produção persistente](../../docs/GAME_PRODUCTION_WORKFLOWS.md). Esse estado de
domínio usa o serviço existente; não cria um coordenador de inteligência.
Para invocações/tokens compartilhados entre supervisor, planejamento, revisão e
subagentes, leia [orçamento de inferência](../../docs/INFERENCE_BUDGETS.md).
Operações KidOS continuam sujeitas ao Core e ao UID real; aprovação de design
não concede autorização parental nem acesso genérico ao sistema.

Os [jogos de referência](../../docs/GAME_REFERENCE_GAMES.md) ficam em
`examples/games`, com fonte editável e qualificação pelo serviço. Não embutir
esses jogos ou um catálogo obrigatório neste pacote; geração e generalização
continuam exigindo evidências próprias.

## Versões e evidências

O [runtime opcional de save](../../docs/GAME_SAVE_RUNTIME.md) pertence ao jogo
exportado e ao compilador web, fora do pacote puro de design. O perfil orienta
seu uso quando anunciado; não implementa IndexedDB nem transfere save para as
interfaces ou o motor. Testes do helper não substituem recuperação no jogo real.

O [compilador web isolável](../../docs/GAME_WEB_COMPILER.md) é um componente de
produção separado, não outra especialização ou permissão do pacote. KidOS usa
broker, diário durável e operações protegidas próprios. A
[porta Core em fonte](../../docs/GAME_CORE_PRODUCTION_PORTS.md) já liga o serviço
ao broker, com ensaio SDK/IPC temporário; perfil Navi v2 e composição instalada
continuam exigindo integração e aceite próprios.

Game Design 1.0 identifica o produto planejado. O perfil de produção em fonte
está em 0.2.0, enquanto o contrato legado permanece em 0.1.0. Motor, protocolo e
adaptadores têm versões próprias. Fonte, testes, artefato verificado, instalação
e aceite físico são estados distintos.

Registre resultados no acompanhamento, vinculados à revisão e à cadeia de
ferramentas. Preserve projetos, versão jogável aprovada e dados novos durante
migração e rollback. Não apresentar aprovação automática do próprio jogo ou do
modelo como prova de qualidade, licença, desempenho físico ou playtest humano.
