# Game Design 1.0: produção completa de jogos 2D e 3D

Documentado em **2026-11-09**; escopo confirmado em **2026-11-10**.
Status: **implementação iniciada; entrega integral pendente**.
As decisões de produto abaixo foram confirmadas na conversa. Registrar este plano
não significa implementar, instalar ou publicar os componentes previstos.

Leia primeiro a [arquitetura da suíte](SUITE_ARCHITECTURE.md), o
[guia dos agentes](../AGENTS.md) e o [estado atual do módulo](GAME_DESIGN.md).
`1.0` identifica a entrega planejada do módulo; o contrato legado extraído permanece
em `0.1.0`, e o perfil de produção v2 em desenvolvimento está em `0.2.0`. O motor
Companion e seus contratos têm versionamento independente.

O [acompanhamento de implementação](GAME_DESIGN_IMPLEMENTATION_STATUS.md) separa
o código já construído das evidências e entregas ainda pendentes. O escopo abaixo
permanece integral.

Este documento é a referência do escopo de Game Design 1.0. Decisões de
implementação, indisponibilidade de ferramentas ou resultados parciais devem ser
registrados no acompanhamento, sem reduzir os critérios de conclusão abaixo.
Mudanças de escopo exigem decisão explícita do usuário e atualização desta
referência. A arquitetura da suíte continua sendo a referência para as fronteiras
entre motor, especializações, adaptadores, interfaces e autoridades.

### Decisões confirmadas pelo usuário

| Tema | Decisão para esta entrega |
|---|---|
| Ambição | Produto completo de produção de jogos, com acabamento comparável à referência Poki; sem encerrar a entrega em protótipo, template ou MVP |
| Caminho principal | Jogos 2D e 3D para navegador |
| Engines | Web completo e adaptadores Unity **e** Godot funcionais nesta mesma entrega |
| Distribuição dos jogos | Uso local e exportação; sem integração comercial com a Poki agora |
| Assets | Geração original, bibliotecas licenciadas e edição dirigida |
| Jogadores | Single-player e multiplayer local; multiplayer online em uma frente posterior |
| Organização | `packages/game-design` no Companion, com produção e adaptadores em pacotes próprios; interfaces clientes e autoridades KidOS desacopladas |

Essas decisões orientam os marcos e o aceite deste documento. A disponibilidade
atual de uma engine, licença, modelo ou dispositivo determina o que pode ser
verificado naquele ambiente; não transforma uma obrigação da entrega em item
opcional. O acompanhamento registra tais impedimentos e as evidências faltantes.

### Como usar este plano

Para iniciar ou continuar o desenvolvimento, leia este documento inteiro e depois
o [acompanhamento](GAME_DESIGN_IMPLEMENTATION_STATUS.md). Escolha a próxima
entrega pelos critérios de saída da seção 4 e registre ali as evidências e
pendências. Não substituir este plano por uma lista limitada às capacidades
disponíveis na máquina atual.

A [entrada do pacote](../packages/game-design/README.md) indica os responsáveis
por cada camada e os documentos de implementação. Contratos, código e testes
descrevem a implementação; este plano define a entrega pretendida. Em caso de
divergência, registrar a lacuna explicitamente, preservando o escopo confirmado.

### Navegação do plano

- [Resultado e padrão de qualidade](#1-resultado-e-padrão-de-qualidade): o que o
  produto completo deve entregar.
- [Arquitetura e contratos](#2-arquitetura-e-contratos): responsabilidades,
  persistência e fronteiras entre os pacotes e produtos.
- [Cadeia completa de criação](#3-cadeia-completa-de-criação): design, especialistas,
  assets, quatro engines, interfaces e integração protegida KidOS.
- [Implementação, migração e distribuição](#4-implementação-migração-e-distribuição):
  seis marcos com critérios de saída, dependências e preservação de dados.
- [Aceite obrigatório do produto](#5-aceite-obrigatório-do-produto): qualidade,
  dispositivos, seis jogos, pedidos inéditos, avaliação humana e dossiê final.

## 1. Resultado e padrão de qualidade

Transformar `packages/game-design` na especialização de produção de jogos do
Companion, integrada ao motor comum e utilizável pelo aplicativo Mac, pela
extensão VS Code e pelo Navi.

A entrega será um produto capaz de **conceber, produzir, testar, corrigir,
empacotar e evoluir jogos completos**. Não estará concluída com geração de código,
templates jogáveis ou demonstrações técnicas.

Decisões confirmadas:

- Jogos **2D e 3D web** como caminho principal.
- **Phaser, Babylon.js, Unity e Godot com adaptadores funcionais na mesma
  entrega**, incluindo criação, edição, build, execução e testes reais. Unity e
  Godot não ficam limitados a contratos ou integrações futuras.
- Single-player e multiplayer local; servidores e multiplayer online ficam para
  uma frente posterior.
- Jogos locais e exportáveis, sem integração comercial, anúncios ou publicação
  na Poki nesta entrega.
- Arte, animação e áudio combinam geração original, bibliotecas licenciadas e
  edição dirigida.
- O módulo permanece no repositório Companion, separado das interfaces e das
  autoridades KidOS.

Os caminhos web são prioritários, sem excluir os adaptadores de editor do aceite
final. A referência Poki orienta o acabamento e a jogabilidade; o resultado desta
entrega são jogos locais e exportáveis, sem submissão comercial à plataforma.

“Nível Poki” será traduzido em qualidade observável: controles agradáveis,
identidade visual, profundidade, conteúdo completo, bom primeiro contato e
funcionamento consistente entre dispositivos. Esses aspectos correspondem aos
critérios públicos da plataforma, que também recomenda avaliação com jogadores
reais. Não constituem promessa de aprovação comercial pela Poki.
[Critérios oficiais](https://developers.poki.com/guide/what-we-look-for).

A liberação exigirá a cadeia completa de produção, os quatro adaptadores e jogos
de aceitação aprovados. As etapas intermediárias serão marcos internos de
desenvolvimento.

## 2. Arquitetura e contratos

### Separação dos componentes

| Componente | Responsabilidade |
|---|---|
| **`game-design`** | Contratos de design, conhecimento especializado, perfis, definição das etapas de produção e critérios de avaliação |
| **Produção compartilhada** | Contratos de ferramentas, projetos, revisões, artefatos, builds e relatórios; coordenação pelo Agent Service |
| **Adaptadores Phaser/Babylon.js, Unity e Godot** | Criar e editar projetos, importar assets, construir, executar, testar e exportar |
| **Adaptador de assets** | Geração/importação, composição, animação, processamento de áudio e otimização |
| **Agent Core/Service** | LangChain/DeepAgents, modelos, checkpoints, orçamento, recuperação, ferramentas e recibos |
| **Mac, VS Code e Navi** | Apresentação, decisões, contexto, previews e recursos específicos do host |
| **KidOS Core** | Operações protegidas, execução isolada, publicação local, permissões e controles parentais |

`game-design` continuará sem processo, loop de ferramentas ou acesso direto ao
sistema. Os especialistas serão executados pelo motor existente. Suas
recomendações não concederão ferramentas ou permissões.

### Projeto persistente de jogo

Introduzir um contrato de projeto versionado que reúna:

- Briefing, público, gênero, dimensão, dispositivos e controles.
- Experiência central, mecânicas, progressão, conteúdo e critérios de conclusão.
- Direção visual, sonora e de animação.
- Engine, capacidades verificadas e versões da cadeia de ferramentas.
- Arquivos, assets, proveniência e licenças.
- Revisões do design, decisões, tarefas, builds, evidências e feedback.
- Formato do save, compatibilidade e migrações.

O design evoluirá para **schema v2**, adequado a campanhas, puzzles, arcade,
esportes, exploração e experiências abertas. O contrato atual não será ampliado
apenas adicionando campos: deixarão de existir exigências universais de narrativa
ou de três fases para gêneros em que isso não faz sentido.

Projetos v1 terão leitor e conversão explícita, preservando seus dados e arquivos
originais. Não haverá migração automática de engine.

### API comum e estado

Acrescentar operações tipadas para projetos, revisões de design, produção, assets,
validação e exportação. Os SDKs compartilharão os contratos; arquivos grandes
continuarão usando transferências em partes.

O estado distinguirá **etapa de produção**, **estado da execução** e **qualidade
comprovada**. “Código produzido”, “build aprovado”, “jogo executado” e “jogo aprovado
em playtest” serão resultados diferentes.

Cada evidência ficará vinculada à revisão, ao build, à engine e ao ambiente
testado. Alterações posteriores invalidarão os testes afetados. Reconexão,
cancelamento e retomada usarão os mecanismos existentes de idempotência e
reconciliação.

## 3. Cadeia completa de criação

### Concepção e direção

O módulo deverá transformar pedidos abertos em propostas próprias, sem limitar o
usuário a um catálogo de templates.

Antes da produção, consolidará:

- Fantasia do jogador, ações principais e diferencial.
- Regras, câmera, física, controles e feedback.
- Progressão, variedade, dificuldade e duração adequada ao gênero.
- Escopo de conteúdo, condições de derrota, recuperação e encerramento.
- Direção visual/sonora e plano de testes.
- Restrições reais de execução, assets e orçamento.

A escolha da engine considerará o pedido, o projeto existente e as capacidades
verificadas. Phaser será o padrão para novos projetos 2D web; Babylon.js, para
novos projetos 3D web. Projetos Unity/Godot existentes continuarão em sua engine.
Uma preferência explícita do usuário será respeitada quando houver capacidade
disponível.

Antes de iniciar uma produção inviável, o sistema explicará o impedimento e
oferecerá alternativas concretas, sem trocar de engine silenciosamente.

### Especialistas e execução

Ampliar os papéis atuais para cobrir:

- Design e progressão.
- Engenharia de gameplay.
- Direção de arte e animação.
- Design de áudio.
- Construção e balanceamento de conteúdo.
- Revisão técnica, visual e de jogabilidade.
- Desempenho e compatibilidade.

Esses serão perfis especializados do mesmo motor, não agentes autônomos com
poderes próprios. O supervisor aplicará alterações pelas ferramentas autorizadas;
revisores terão leitura e testes explícitos. A delegação será limitada pela
necessidade, pelo orçamento compartilhado e pelas dependências do projeto.

A produção seguirá: **design → experiência central → sistemas → conteúdo →
acabamento → testes → correções → candidato de entrega**. Não avançará apenas
porque o modelo declarou a etapa concluída.

### Arte, animação e áudio

Entregar uma cadeia de assets que inclua:

- Guia visual por projeto: paleta, proporções, iluminação, materiais, silhuetas e
  referências.
- Produção consistente de personagens, cenários, objetos, efeitos e interface.
- Spritesheets, atlas, ciclos de animação e transições.
- Modelos 3D com escala, pivôs, colisores, materiais, rigging e animação.
- Música, efeitos, ambientes, mixagem e transições por estado de jogo.
- Compressão, variantes de qualidade e carregamento progressivo.

Usar Blender para processamento/modelagem/animação 3D automatizados, além de
ferramentas de composição e processamento de imagens/áudio.

A geração por modelos será fornecida por adaptadores configurados e autorizados.
Não haverá descoberta automática de provedores ou mudança silenciosa das
restrições atuais do Companion. A cadeia continuará permitindo assets
procedurais, locais e bibliotecas aprovadas.

Cada asset terá origem, licença, referências, versão e vínculo com os builds.
Assets temporários serão identificados; um jogo não passará pelo aceite visual
com placeholders apresentados como arte final.

### Quatro adaptadores completos

| Adaptador | Entrega obrigatória |
|---|---|
| **Phaser** | Projetos modulares, cenas, animação, física, tilemaps, áudio, controles, save, testes e build web |
| **Babylon.js** | Cenas 3D, personagens e câmeras, colisão/física, materiais, animação, iluminação, partículas, LOD, otimização e build web |
| **Godot** | Projetos editáveis 2D/3D, cenas, recursos, GDScript, importação, testes e exportação web automatizada |
| **Unity** | Projetos editáveis 2D/3D, cenas, prefabs, C#, importação, testes e build web automatizado |

Godot web usará inicialmente GDScript, renderizador Compatibility e exportação
sem threads. A documentação consultada registra limitações para C# e vantagens
de compatibilidade na exportação single-thread.
[Exportação web Godot](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html).

Unity usará a linha LTS suportada, com patch estável corrigido, módulo web e
licença válida. O adaptador realizará builds por entradas controladas do editor,
com alvo explícito e logs estruturados.
[Build por linha de comando Unity](https://docs.unity.com/en-us/engine/6000.3/manual/building-and-publishing/build-command-line).

As versões exatas das engines, plugins e ferramentas serão fixadas em lock após
qualificação. Editores grandes serão dependências opcionais verificadas,
separados do pacote básico do motor.

“Adaptador funcional” exigirá criar, editar, construir, abrir e testar um jogo
real. Hosts não suportados ou sem editor/licença terão indisponibilidade explícita,
preservando a matriz de plataformas do motor comum.

### Experiência nas interfaces

Mac e VS Code receberão uma superfície de projeto com design, assets, progresso,
preview, evidências e revisões. A conversa continuará sendo a entrada principal.

O usuário poderá:

- Criar por descrição e referências.
- Revisar a proposta e acompanhar a produção.
- Jogar o candidato e apontar mudanças.
- Comparar versões e restaurar a última versão aprovada.
- Continuar um projeto em conversas posteriores.
- Exportar fonte editável e build executável.

As interfaces mostrarão impedimentos e trabalho restante. Fechar uma janela não
perderá a produção nem cancelará tarefas independentes dela.

### Integração protegida no KidOS

Ampliar o formato atual, hoje limitado a cinco arquivos e poucos assets, com um
manifesto de projeto que suporte código modular, áudio, modelos, texturas e
builds das quatro engines.

Manter:

- Operações Core específicas por projeto e UID.
- Assets e dependências empacotados, sem rede externa durante o jogo.
- Jogador isolado da interface administrativa e do motor de IA.
- Limites de tempo, sites, instalação e autorizações existentes.
- Builds isolados, sem acesso genérico ao diretório infantil, segredos ou rede.

Projetos Unity/Godot contêm código executável. Seus builds passarão pelo broker
de produção isolado, sem entregar ao Navi um shell ou acesso ao Docker. O runtime
antigo continuará disponível para jogos existentes; sua política não será
afrouxada globalmente para acomodar o novo formato.

## 4. Implementação, migração e distribuição

A implementação seguirá esta ordem. Cada marco exige evidências reproduzíveis
antes de ser registrado como concluído:

| Marco | Entrega | Critério de saída |
|---|---|---|
| **1. Contratos e projeto persistente** | Schema v2, revisões, arquivos, capacidades, API/SDKs e importadores | Criar, editar, fechar, recuperar e exportar/importar um projeto sem perda; importação repetida idempotente; concorrência e isolamento testados; design v1 preservado |
| **2. Perfis e produção compartilhada** | Especialistas, seleção semântica, orçamento, ferramentas, jobs e evidências | Uma produção atravessa etapas pelo grafo comum; interrupção e retomada preservam trabalho; efeitos desconhecidos exigem reconciliação; relatórios se vinculam ao build e não podem ser fabricados pela interface ou pelo modelo |
| **3. Assets e caminhos web** | Arte, animação, áudio e adaptadores Phaser/Babylon.js | Produzir e revisar jogos 2D e 3D com assets finais coerentes, save, controles e conteúdo; construir, jogar e exportar sem dependências externas em tempo de jogo; demonstrar edição posterior sem perder projeto |
| **4. Engines de editor** | Adaptadores Godot **e** Unity | Em cada engine, criar e editar projetos 2D/3D reais, importar assets, construir para web, abrir e testar; fonte editável, versões e licenças verificadas; ausência de ferramentas apresentada explicitamente |
| **5. Interfaces e KidOS** | Superfícies Mac/VS Code, Navi, manifesto, jogador e broker | Produção e revisão recuperáveis nos três clientes; previews e exportação funcionais; KidOS rejeita operações não autorizadas e preserva tempo, sites, instalação e aprovações parentais |
| **6. Qualificação e distribuição** | Portfólio, pedidos inéditos, pacotes e relatórios | Cumprir integralmente a seção de aceite abaixo; instalar versões exatas, migrar projetos existentes e demonstrar rollback preservando dados novos e a versão jogável aprovada |

Contratos e geração de código são pré-requisitos. Os marcos 1–5 não substituem
o aceite técnico e humano do marco 6. Implementações parciais devem permanecer
identificadas no [acompanhamento](GAME_DESIGN_IMPLEMENTATION_STATUS.md), sem
alterar estes critérios para acomodar o que já foi construído.

### Organização do trabalho e dependências

O Companion é responsável pelo módulo comum, produção, contratos, SDKs,
adaptadores reutilizáveis e interfaces Mac/VS Code. O KidOS é responsável pelo
consumidor Navi, broker, Core, jogador e políticas. Alterações de contrato entre
os repositórios exigem versões compatíveis fixadas e testes dos dois lados.

Adaptadores de produção e processamento de assets terão pacotes próprios no
Companion, separados do domínio puro de `packages/game-design`. Não criar outro
serviço de inteligência para coordená-los. O Agent Service mantém o trabalho e
seus recibos; o Agent Core executa os perfis pelo grafo existente.

Antes de qualificar uma engine, registrar editor/runtime, módulos de exportação,
plugins, hashes, licenças, plataforma e capacidades efetivamente verificadas.
Antes dos testes de desempenho, fixar dispositivos, versões de navegador,
configuração gráfica e método de medição. Antes dos playtests, definir público,
roteiro, consentimento e registro das respostas. Ausência de editor, dispositivo
ou participante deixa o respectivo aceite pendente, sem substituí-lo por teste
simulado.

A última versão jogável aprovada será preservada enquanto novas revisões são
produzidas. Builds falhos ou incompletos ficarão como candidatos privados, sem
substituir o jogo publicado.

Históricos e projetos serão migrados por estado de domínio, sem reexecutar
ferramentas ou converter diretamente checkpoints Python para TypeScript.
Rollback preservará também projetos e revisões criados após a atualização.

Custos e orçamento serão estimados por etapa e respeitarão as políticas do
produto. Esgotar orçamento salvará o progresso e indicará continuação pendente;
não transformará uma entrega incompleta em “jogo concluído”.

A entrega terá versões próprias de módulo, contratos e adaptadores, com commits,
hashes e compatibilidade registrados. Publicação e instalação seguirão a revisão
e ativação segura já existentes na suíte.

### Matriz de entregáveis para execução do plano

Os identificadores abaixo permitem acompanhar a entrega entre os dois
repositórios. São grupos de requisitos deste plano, não declarações de conclusão.
O estado e as evidências datadas pertencem ao
[acompanhamento](GAME_DESIGN_IMPLEMENTATION_STATUS.md).

| ID | Entregável | Responsável | Evidência necessária |
|---|---|---|---|
| GD-01 | Projeto persistente e migração | Contratos, SDKs e Agent Service no Companion | Schema v2, revisões, importação idempotente, concorrência, exportação e preservação do projeto legado |
| GD-02 | Especialização e produção recuperável | `game-design`, Agent Core e Agent Service | Especialistas pelo grafo comum, etapas comprovadas, orçamento compartilhado, retomada e reconciliação sem repetir efeitos |
| GD-03 | Arte, animação e áudio | Adaptadores de assets no Companion | Geração autorizada, bibliotecas licenciadas, edição dirigida, Blender, proveniência, consistência e ausência de placeholders no aceite final |
| GD-04 | Produção web 2D | Adaptador Phaser no Companion | Criar, editar, construir, jogar, testar e exportar um jogo completo com código e assets locais |
| GD-05 | Produção web 3D | Adaptador Babylon.js no Companion | Mesmo percurso completo com personagens, câmera, física, materiais, animação e otimização |
| GD-06 | Produção Godot | Adaptador Godot no Companion | Projetos editáveis 2D e 3D, importação, build web, testes reais, isolamento e cadeia de ferramentas qualificada |
| GD-07 | Produção Unity | Adaptador Unity no Companion | Projetos editáveis 2D e 3D, licença válida, importação, build web, testes reais e execução isolada |
| GD-08 | Clientes Mac e VS Code | Interfaces e adaptadores de host no Companion | Proposta, decisões, produção, preview, feedback, comparação, restauração e exportação recuperáveis nas duas interfaces |
| GD-09 | Navi e execução infantil protegida | Repositório KidOS | Manifesto ampliado, broker e jogador, UID real, restrições Core e controles parentais preservados |
| GD-10 | Qualidade e generalização | Produção/QA no Companion e integração KidOS | Seis jogos completos, pedidos inéditos, quatro engines, matriz física e playtests consentidos com os critérios da seção 5 |
| GD-11 | Distribuição e continuidade | Publicação Companion e atualizador KidOS | Artefatos exatos verificados, compatibilidade, instalação, migração e rollback preservando dados novos e a versão jogável aprovada |

Começar pelos contratos e pela recuperação (GD-01/GD-02); desenvolver assets e
engines sobre essas fronteiras. As interfaces podem consumir capacidades já
verificadas durante a implementação, mantendo explícito o que ainda está
indisponível. A integração KidOS depende de seu próprio broker e aceite de
autoridade. A qualificação final depende do conjunto completo, incluindo Unity,
Godot, os três clientes e os jogos aprovados; não apenas do caminho web inicial.

Para cada entrega, registrar requisito, revisão/artefato, ambiente, teste,
resultado e lacuna restante. Uma falha de ferramenta, licença, dispositivo ou
participação humana deve aparecer nesse registro; não permite retirar o
requisito do aceite. Estimativas de prazo serão feitas a partir dessa decomposição
e da disponibilidade verificada, sem prometer duração com base apenas em geração
de código.

## 5. Aceite obrigatório do produto

### Qualificação técnica e de recuperação

Testar:

- Importação repetida, arquivos grandes, revisões concorrentes e rollback.
- Fechamento da interface, queda do cliente, reinício do serviço e retomada.
- Cancelamento durante geração, build e teste.
- Ausência de editor, licença, modelo, ferramenta ou capacidade gráfica.
- Falhas entre execução e confirmação, sem duplicar efeitos.
- Isolamento entre produtos, perfis, projetos e UIDs.
- Rejeição de tentativas de ampliar ferramentas ou contornar o Core.
- Jogos executando sem modelo, credenciais de IA ou conexão externa.

### Qualidade dos jogos gerados

| Dimensão | Critério de aceite |
|---|---|
| Jogabilidade | Controles responsivos, colisão coerente, câmera adequada e estados sem bloqueios |
| Conteúdo | Escopo aprovado implementado, progressão real e desfecho ou ciclo completo adequado ao gênero |
| Apresentação | Arte consistente, animação, efeitos, áudio e interface acabados |
| Experiência inicial | Objetivo e controles compreensíveis durante o jogo, sem explicação externa obrigatória |
| Robustez | Pausa, reinício, perda de foco, redimensionamento, save e recuperação testados |
| Dispositivos | Teclado/mouse, toque e multiplayer local quando aplicável |
| Desempenho | Meta de 60 fps no desktop; piso de 30 fps sustentados nos dispositivos móveis de referência |
| Carregamento | Primeiro estado jogável em até 10 segundos no perfil de rede de teste: 20 Mb/s, RTT de 100 ms e cache frio |
| Exportação | Build autocontido, fonte editável, dependências e licenças identificadas |

Esses números serão metas próprias do produto, não apresentados como certificação
da Poki. Os requisitos públicos reforçam compatibilidade entre dispositivos,
assets empacotados, entrada simples e carregamento rápido.
[Requisitos oficiais](https://developers.poki.com/guide/requirements-quality).

A matriz incluirá Chrome/Edge, Firefox e Safari, além do jogador WebKit KidOS,
com testes físicos no Mac, Alien, Android intermediário e iPhone/iPad de
referência. Emulação não substituirá validação de GPU, áudio e toque.

A verificação automática observará execução, entradas, imagens, áudio, erros e
desempenho pelo ambiente de testes. Indicadores declarados pelo próprio código
gerado não serão prova suficiente de funcionamento.

### Portfólio e avaliação humana

Entregar seis jogos completos de referência, cobrindo plataforma, puzzle,
arcade/física, exploração 3D, corrida e multiplayer local. O conjunto utilizará
os quatro adaptadores e servirá como regressão, sem limitar os gêneros
disponíveis no produto.

Cada jogo passará por:

- Testes dos caminhos previstos e das situações de falha.
- Revisão de arte, áudio, controles e conteúdo.
- Playtest com dez pessoas do público-alvo.
- Meta de oito compreenderem a ação principal em até 30 segundos, sem orientação.
- Meta de sete avaliarem a experiência com pelo menos quatro de cinco.
- Nova rodada após corrigir problemas materiais.

As avaliações serão locais e consentidas, sem telemetria oculta. Diversão não
será declarada por uma nota produzida pelo próprio agente: testes humanos e
iteração são necessários.
[Playtesting na referência Poki](https://developers.poki.com/guide/playtesting).

Também haverá uma bateria de pedidos inéditos para verificar que o sistema
generaliza além dos seis jogos e não apenas reproduz projetos preparados.

**A entrega estará concluída quando módulo, adaptadores, interfaces, integração
KidOS e exportação estiverem distribuíveis, com os quatro caminhos funcionando
e o portfólio aprovado.** O resultado será acompanhado de documentação para
agentes, matriz de capacidades, relatórios de qualidade, evidências de instalação
e demonstração de rollback.

### Dossiê da entrega final

O relatório final deverá permitir que outro agente ou mantenedor reproduza a
verificação, distinguindo a versão de desenvolvimento da composição instalada.
Deverá reunir:

- Matriz dos requisitos deste plano, indicando a evidência e o resultado de
  cada critério; pendências permanecem visíveis e impedem declarar aceite integral.
- Versões, commits, hashes, assinaturas, licenças e compatibilidade do módulo,
  motor, contratos, adaptadores e clientes efetivamente distribuídos.
- Para cada um dos seis jogos, fonte editável, build autocontido, revisão de
  design, assets e proveniência, receitas de build, relatórios técnicos,
  dispositivos testados e resultados agregados dos playtests consentidos.
- Pedidos inéditos, resultados e correções, preservando os casos falhos para
  regressão, sem selecionar apenas os exemplos bem-sucedidos.
- Evidências dos quatro adaptadores, dos três clientes e das restrições KidOS,
  incluindo funcionamento dos jogos exportados sem o motor de IA.
- Percursos de instalação, migração, recuperação e rollback, comprovando a
  preservação da versão jogável aprovada e dos dados criados após a atualização.

Esse dossiê será produzido durante a implementação. Este plano não registra
esses percursos como executados; os resultados reais pertencem ao
[acompanhamento](GAME_DESIGN_IMPLEMENTATION_STATUS.md) e aos relatórios vinculados.

## 6. Referências e manutenção do plano

As referências públicas da Poki foram conferidas em **2026-11-10**:

- [O que a plataforma procura](https://developers.poki.com/guide/what-we-look-for):
  experiência de jogo, originalidade, profundidade, primeiro contato e
  funcionamento entre dispositivos.
- [Requisitos técnicos](https://developers.poki.com/guide/requirements-quality):
  compatibilidade, recursos empacotados e robustez de execução.
- [Playtesting](https://developers.poki.com/guide/playtesting): avaliação com
  jogadores para orientar correções e evolução.

Essas fontes sustentam a referência de qualidade. Não acrescentam integração
comercial, SDK de anúncios ou publicação na plataforma ao escopo confirmado.
Os números de desempenho, carregamento e avaliação humana da seção 5 são
critérios deste plano, não uma certificação nem exigências numéricas atribuídas
à Poki.

Ao alterar a implementação, atualizar o acompanhamento e os contratos afetados.
Ao alterar uma decisão de produto, registrar a decisão neste plano e manter
coerentes a entrada de `packages/game-design`, a arquitetura da suíte e a
referência local do KidOS. Novas evidências devem identificar a revisão testada;
não substituir relatos históricos por resultados que não foram repetidos.
