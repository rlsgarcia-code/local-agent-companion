# Game Design no Companion

Leia primeiro a [arquitetura canônica da suíte](SUITE_ARCHITECTURE.md) e o
[guia dos agentes](../AGENTS.md). Este documento detalha o módulo; não substitui
as fronteiras entre motor, clientes, adaptadores e autoridades dos produtos.

O [plano de implementação Game Design 1.0](GAME_DESIGN_IMPLEMENTATION_PLAN.md)
define a evolução para produção completa de jogos, com Phaser, Babylon.js, Unity
e Godot funcionais e critérios de qualidade comparável à Poki. É trabalho
planejado; as seções abaixo descrevem a extração atual 0.1.0.

A implementação ampla foi iniciada: a [API de projetos v2](GAME_PROJECTS_API.md)
acrescenta contratos, revisões e persistência no serviço. O
[acompanhamento](GAME_DESIGN_IMPLEMENTATION_STATUS.md) registra o escopo comprovado;
isso não significa que produção, interfaces ou engines estejam concluídas.

A [API de produção](GAME_PRODUCTION_API.md) acrescenta jobs persistentes, artefatos,
reconciliação e contratos de coleta/qualidade. O pacote `adapter-game-web` já
compila revisões com Phaser/Babylon offline em desenvolvimento. Há também
[observação real de navegador](GAME_BROWSER_OBSERVATIONS.md) e o
[caminho Godot isolado](GAME_GODOT_ADAPTER.md) e superfícies
[Game Studio](GAME_STUDIO_UI.md) em desenvolvimento. Aceite das interfaces
instaladas, demais coletores, quatro adaptadores completos e jogos de aceite
continuam pendentes; não anunciar essa base como produto final distribuído.

O [perfil de produção v2](GAME_AGENT_PRODUCTION.md), em fonte 0.2.0, conecta
ferramentas persistentes e sete especialistas ao motor comum. O contrato v1
descrito abaixo continua em 0.1.0 para o consumidor legado KidOS. A integração
dos executores em desenvolvimento não comprova nova instalação, superfície de
projeto ou aceite visual Mac/VS Code.

## Decisão: mesmo repositório, pacote separado

O módulo pertence a `rlsgarcia-code/local-agent-companion`, em
`packages/game-design`, como `@local-agent-companion/game-design`. Não terá
repositório, processo ou loop de agente próprios. Usa o motor, os modelos por
papel e os checkpoints existentes. Mac, VS Code e Navi são clientes desse motor.

Essa localização mantém contrato, especialistas, kit de adaptadores e testes na
mesma revisão. Evita publicar outro serviço ou coordenar versões entre dois
repositórios para mudar um papel de design. O pacote não importa Agent Core,
LangChain, interfaces, KidOS ou ferramentas; o kit do motor exporta sua API.

KidOS continua no repositório privado separado. Seus adaptadores, políticas e
autoridades não passam para o Companion. Uma engine de jogos é um ambiente de
produção, diferente do motor de inteligência do Companion.

Um adaptador Unity/Godot poderá ficar inicialmente no Companion, em pacote
próprio, se atender Mac/VS Code. Só deve ganhar outro repositório quando tiver
manutenção, distribuição ou ciclo de versões independentes. Não há benefício
em criar agora um quarto produto para conteúdo de especialização.

## O que foi extraído

| Conteúdo comum | Origem KidOS | Destino |
|---|---|---|
| Contrato de design v1, campos e limites | `game_design.py` | `packages/game-design/module.json` |
| Narrativa, progressão, escolhas, save, escopo e playtest | guia do Game Studio | Guia neutro no mesmo contrato |
| Especialista de design, papel planner | adaptador Navi | `game-designer` |
| Especialista de revisão, papel evaluator | adaptador Navi | `game-reviewer` |
| Preparação de perfil e pré-verificação de capacidades | novo | `packages/game-design/src/index.ts` |

Os nomes e o formato do design existente foram preservados: `premise`,
`narrative_arc`, `progression`, `meaningful_choices`, `ending`, `save_strategy`,
`stages` e `playtest_scenarios`. O contrato v1 mantém 3–12 etapas e 3–16 cenários
para jogos completos. Protótipos explicitamente pedidos precisam declarar seu
escopo; isso não autoriza enviar um design incompleto ao contrato v1 do Core.

Instruções ligadas a `game.js`, `levels.json`, Phaser, geração de assets,
telemetria de playtest, publicação no Laboratório e confirmação parental
continuam no adaptador/Core KidOS. Validação estrutural e persistência do design
continuam no Core, inclusive quando o agente não está disponível.

O executor Python antigo permanece congelado como legado de rollback; não é
mais a fonte dos especialistas ativos nem será reativado como fallback.

## API entregue e limites

O `adapter-kit` exporta:

- `gameDesignModule`: conteúdo, contrato v1 e descrições dos especialistas.
- `prepareGameDesign({readTools, adapterGuidance})`: prepara instruções e
  especialistas, sem invocar modelos ou executar ferramentas. Só aceita uma
  lista explícita de ferramentas de leitura; o host deve intersectá-la com seu
  catálogo autenticado. Retorna `modelRole`; o adaptador vincula os modelos
  planner/evaluator já autorizados e usa o executor comum.
- `assessGameProduction(engine, capabilities, mode)`: relatório conservador de
  capacidades de projeto, edição, build, execução e teste. Ausência, estado
  desconhecido, entradas conflitantes ou falta de autorização impedem declarar
  produção completa disponível. Planejamento nunca habilita produção.

Essa pré-verificação é consultiva: não concede permissão e não prova execução.
Os dados devem vir de sondagens atuais do adaptador instalado e da política do
host, nunca de texto do usuário ou de conclusões do modelo. Cada operação
continua validada e aprovada na fronteira de ferramentas. Um projeto pode ter
somente algumas capacidades disponíveis; elas devem ser apresentadas
individualmente, sem prometer a cadeia completa.

Não foi criado novo campo RPC de seleção arbitrária de perfil, ferramentas ou
provedor. O módulo não consulta rede, instala Unity, concede shell ou decide
onde gravar. Não foi criada uma segunda coordenação de execução.

## Uso pelas interfaces e adaptadores

O fluxo pretendido é: identificar intenção de criação → consultar capacidades
reais → preparar o perfil comum → persistir proposta → obter as decisões
necessárias → produzir pelo adaptador autorizado → reunir evidências → revisar.
Seleção deve considerar conversa/projeto; não usar um detector isolado de
palavras como "jogo". Continuação deve recuperar o mesmo projeto e design.

| Camada | Responsabilidade |
|---|---|
| Game Design | Experiência, loop, narrativa, progressão, direção de arte/áudio, escopo e cenários de teste |
| Agent Core/Service | Grafo oficial, modelos por papel, orçamento compartilhado, memória, cancelamento, retomada, recibos e eventos |
| Adaptador Phaser/Unity/Godot | Sondar versão/capacidades; ler/criar/editar projeto; build, execução e teste com evidências |
| Mac/VS Code | Conversa, decisões, arquivos selecionados, previews e recursos da interface |
| Adaptador/Core KidOS | UID real, ferramentas permitidas, validação, publicação, auditoria, limites e aprovações parentais |

Fechar a interface não encerra trabalho independente dela. Recursos que exigem
editor ou interface indisponível entram em espera explícita. Históricos,
memória, anexos e arquivos continuam no namespace do produto; compartilhar o
módulo não sincroniza jogos ou conversas entre Mac, VS Code e Navi.

O contrato de capacidades de um futuro adaptador precisa identificar versão
do editor, plataforma, projeto, alvo de build, disponibilidade da licença quando
necessária, operações autorizadas e validade da sondagem. Sinais de interface
não podem habilitar comandos genéricos. Para KidOS, cada ação deve ter uma
operação Core própria, restrita ao projeto e ao UID; a instalação passa pela
autoridade existente. Até essa integração existir, Unity permanece indisponível
no Navi, mesmo que alguém instale o editor manualmente.

## Entrega honesta e evidências

Estados de produto a preservar: proposta, design persistido, arquivos gerados,
build aprovado, executável iniciado e playtest observado. Um estado não implica
o próximo. Revisão estática não é teste; build não é prova de diversão ou de
campanha completável. Uma resposta não pode anunciar "implementado" quando
entregou instruções. Em modo Plano, não oferecer criar um projeto como se a
operação já estivesse habilitada.

Especialistas aconselham com leitura. O executor principal aplica alterações
pelas ferramentas existentes, com o mesmo orçamento e as mesmas aprovações.
Aprovação de design não é aprovação parental, de instalação ou execução de
comandos. Recibos continuam usando a infraestrutura do serviço, sem reaplicar
efeitos passados ao migrar ou retomar.

## Dependência e distribuição

O módulo começa em `0.1.0`, com schema de conteúdo `1`; essas versões são
distintas da versão do motor e do protocolo Agent API. Alterações incompatíveis
do design exigem nova versão de schema e migração explícita. Novas instruções
não reescrevem designs ou checkpoints existentes.

KidOS mantém um snapshot de dados gerado como módulo Python para os instaladores
atuais, com versão e SHA-256 em
`integrations/agent-engine/game-design.lock.json`. A atualização é offline e
explícita por `sync_game_design.py --source <checkout>`; `--check` verifica a
cópia fixada e `--source <checkout> --check` também compara a origem. Não se
edita o snapshot à mão. O builder rejeita divergências antes de criar o
adaptador e inclui versão/hash no catálogo assinado.

Uma release futura deve publicar o contrato exato junto ao motor/kit, assinado
no manifesto Companion, e fixar esse artefato no lock KidOS. A cópia de
desenvolvimento por checkout não substitui essa verificação de publicação.
Instalações nunca devem buscar uma branch mutável no login ou na inferência.

## Estado desta extração e próximos passos

**Entregue no código-fonte:** pacote independente, schema/guia/especialistas,
API headless no kit, snapshot verificável e consumo pelo adaptador ativo do
Navi. O catálogo só inclui os especialistas de jogos quando a rota semântica
seleciona `game_studio`. Os limites do Core continuam intactos.

**Ainda não entregue:** distribuição/aceite do perfil nas conversas Mac/VS Code,
adaptação Unity completa, qualificação integral Godot, superfícies instaladas de design/produção, testes físicos nessas engines e nova
release/instalação. Exportar o módulo no kit não o ativa nas interfaces. Esta
extração não muda os aplicativos nem o Alien já instalados, nem a release 1.0.2.

O [adaptador Godot isolado](GAME_GODOT_ADAPTER.md) já fornece a base de produção
web em fonte, com projeto nativo, importação/exportação, observação 2D/3D,
cancelamento e reconciliação testados no Mac ARM64. Isso não qualifica as demais
plataformas, o portfólio ou a distribuição.

O trabalho seguinte está consolidado no [plano Game Design 1.0](GAME_DESIGN_IMPLEMENTATION_PLAN.md):
projetos persistentes, cadeia de assets, quatro adaptadores completos, interfaces,
integração protegida KidOS e aceite técnico/humano. Atualização do KidOS seguirá
seu pacote por computador e rollback existentes, com revisão antes de promover
a release.

## Verificação desta alteração — 2026-11-09

Passaram a verificação TypeScript, o build das interfaces, o build independente
do motor, 327 testes do Companion e 27 verificações do repositório. O smoke de
Chat Completions passou com inferência simulada em loopback, sem credenciais
reais. No KidOS, passaram 48 testes direcionados e os cinco cenários do
adaptador com o grafo oficial: Standard, Deep, orçamento, delegação e arquivos
legados. O schema extraído foi comparado ao original e permaneceu idêntico.

Essas provas são de código/integração local; não são aceite de Unity, de uma
interface nova ou de uma instalação no Alien.
