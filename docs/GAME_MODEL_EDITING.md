# Edição dirigida de receitas 3D no Game Studio

Implementação em fonte de **2026-11-13 UTC**, parte da
[cadeia de assets](GAME_ASSET_PIPELINE.md), do [Studio](GAME_STUDIO_UI.md) e do
[adaptador Blender isolado](GAME_BLENDER_ADAPTER.md). Não conclui o
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md), instalação ou aceite artístico.

## Uso

Em **Assets → Revisar candidato**, **Ajustar modelo 3D** fica disponível para
um candidato `model.scene` concluído pelo processador Blender, na revisão atual,
com edição autorizada e processador disponível. Os campos editam a receita
preservada, não o arquivo `.blend` e nem código do projeto.

- **Objetos:** posição, rotação em graus, escala, material, suavização e, onde
  permitido pelo contrato, bevel/subdivisão. Malhas explícitas permitem alterar
  coordenadas dos vértices mantendo a topologia original.
- **Pesos:** escolher ossos, editar/adicionar/remover até quatro influências
  por vértice e conferir sua soma. **Normalizar pesos** é uma decisão explícita;
  salvar ou enviar não redistribui pesos silenciosamente.
- **Materiais:** cor e emissão RGBA, metalicidade e rugosidade. Texturas
  existentes são identificadas e preservadas, sem seletor de novas fontes.
- **Ossos:** início e fim na posição de repouso da armadura explícita. Identidades
  e hierarquia permanecem, e comprimento inválido é recusado pelo contrato.
- **Animações:** FPS, duração e chaves das trilhas existentes, incluindo quadro,
  valores e inclusão/remoção de chaves. Trilhas e alvos permanecem explícitos;
  a [linha do tempo](GAME_KEY_TIMELINE.md) permite seleção e movimento por
  ponteiro/teclado. Não há reprodução ou avaliação da deformação no formulário.
- **Imagem de inspeção:** câmera, alvo, escala ortográfica, fundo e luzes da receita.

Objetos, vértices, materiais, ossos, trilhas e chaves são exibidos por partes,
com seções recolhíveis. Alterar a página não descarta os dados ainda não abertos.
O formulário usa o tema/estrutura já compartilhados pelos clientes Mac e VS Code.

**Gerar variante** primeiro preserva o pedido no armazenamento privado do host
e solicita confirmação nativa. O serviço produz outro candidato pelos jobs e
limites existentes; o projeto só muda depois de **Aplicar ao projeto**.
O candidato anterior, fontes e proveniência permanecem preservados. O visor
[Inspecionar modelo 3D](GAME_MODEL_VIEWER.md) continua separado e exige seleção
de um clip antes de habilitar a reprodução; seleção não inicia movimento.

## Contrato e autoridade

`adjust-model` é um comando privado do Studio em
`packages/contracts/src/game-studio.ts`, validado pelo `gameModelOperation`
canônico. Não é uma nova rota Agent API, ferramenta de modelo, registro de
adaptador, autoridade administrativa ou segundo executor de inteligência.

O controlador `packages/client-ts/src/game-studio.ts` exige o processador
`blender-model-isolated-v1`, candidato concluído e identidade de projeto/job.
Conserva processador, alvo, pasta/nome-base de saída e limita todas as referências
GLB/PNG aos pares exatos de asset/caminho já presentes na receita original.
Antes e depois da confirmação, revalida seleção, revisão, modo de edição e os
fingerprints originais. Acesso a outra textura/modelo requer outro fluxo autorizado;
adicionar uma referência no comando não concede acesso.

Os limites de malhas, ossos, pesos, chaves, imagens e contêiner continuam no
contrato e adaptador. O renderer contém somente apresentação e dados tipados;
não executa Blender, skinning, código, codec ou IA. KidOS não recebe esse
processador de workspace: continua exigindo integração própria Core/broker.

## Rascunhos e resultados desconhecidos

O rascunho usa `mediaEdit` no armazenamento autenticado do host, compartilhado
com os outros editores de mídia, sob o mesmo limite de **2 MiB** e estrutura.
Receitas que excedam o limite não são truncadas nem enviadas sem confirmação
de persistência; o candidato original permanece no serviço. Projetos grandes
precisarão de edição segmentada qualificada, ainda pendente.

Antes de enviar, a identidade e receita são congeladas e gravadas com CAS/fsync.
Fechar/reabrir restaura campos e pedido, sem despachar. Se a resposta se perde,
**Retomar pedido** reutiliza a mesma identidade pela API idempotente, passando
novamente pelo consentimento e pelas guardas existentes. Recusar uma retomada
ou receber uma recusa conhecida não liquida o possível efeito anterior.
O campo histórico `imageAdjustmentRejected` também identifica uma recusa
conhecida de ajustes 3D antes do despacho. Não o renomear unilateralmente em
um host, nem interpretar erro desconhecido como recusa antes da execução.

## Verificação e limites

`test/engine-game-studio.test.ts` verifica fontes forjadas, pasta alterada,
schema/pesos inválidos, planejamento, recusa e mudanças de seleção, permissão
ou revisão durante consentimento. Perda da resposta seguida da mesma solicitação
gera apenas um novo job e não aplica o candidato. Esse teste usa um processador
de política simulado; seus arquivos não comprovam geometria ou Blender real.

O ensaio adicional `scripts/qualify-game-model-editing.mjs` usa serviço/SDK da
fonte, TLS, arquivos privados reais de rascunho, Blender isolado e renderer real
em Chromium. As pontes e confirmações Mac/VS Code são emuladas e não equivalem
à instalação do aplicativo/extensão. Evidências e falhas ficam em
`output/playwright/game-model-editing/runs/`, com hashes e fechamento dos jobs.
O [acompanhamento](GAME_DESIGN_IMPLEMENTATION_STATUS.md) registra a execução
efetivamente aprovada; a existência do script não comprova aprovação.

O ensaio `2026-11-13T06-00-30-806Z-18401459` passou nos dois produtos, incluindo
edição de material/transformação/ossos/pesos/chaves, normalização explícita,
rascunho recuperado, falha de gravação sem despacho, reinício do serviço e
resposta perdida com recusa e retomada idempotente. Cada namespace manteve um
projeto e somente um novo job; o GLB anterior conservou seu hash. Variantes
preservaram 21 vértices de pesos mistos e um clip, abriram no visor e só criaram
nova revisão após aplicação explícita. Receitas, arquivos/candidatos originais e
derivados, fontes do ensaio e capturas estão preservados no dossiê.

A primeira tentativa encerrou antes do bootstrap por importar `playwright`
em vez do `playwright-core` já fixado. O ensaio seguinte chegou ao visor, mas
esperou reprodução habilitada sem selecionar o clip; isso contrariava o contrato
do visor. A fixture foi corrigida, sem iniciar animação automaticamente ou mudar
o produto. A primeira repetição passou; a final acrescentou preservação integral
dos arquivos ao relatório. Logs e falha visual anteriores permanecem.

Tipagem, builds Mac/extensão, roteamento local simulado e suíte completa passaram:
672 testes de aplicação, um opt-in ignorado e31 verificações do repositório.
Relatório: `output/game-generation/model-editor-20261113-a1/report.json`.
Nenhuma inferência, alteração de orçamento, instalação ou publicação foi feita.

### Motor empacotado e preparação dos hosts nativos — 2026-11-13 UTC

O ensaio `scripts/qualify-packaged-game-model.mjs` acrescenta prova do motor como
processo independente, com seu Node empacotado, SDK/TLS e a imagem Blender exata.
O run `2026-11-13T06-14-41-015Z-f7c91288` passou nos dois namespaces de produto:
geração, variante pelo controlador, resposta perdida, reinício do processo,
repetição idempotente e aplicação explícita. Arquivos originais e derivados
ficaram preservados, e o bundle continuou íntegro depois da execução. Não há
UI nativa nesse ensaio; ele não substitui a prova dos aplicativos instalados.

O motor de desenvolvimento está em
`output/game-generation/model-editor-native-20261113-a1/engine`, manifesto
`5f65b9ffb1515a17bf99d87a49f1ab4d2c2ae4e6f434909d1fca1007dc16a7b0`,
Node22.23.4/darwin-arm64, com470 arquivos verificados. É desenvolvimento sem
assinatura de release; não usar como atualização distribuída ou aceite instalado.
O `engine-dist` anterior foi conferido antes/depois e permaneceu intacto.

`scripts/build-engine.mjs --output=<pasta-nova>` permite construir esses
candidatos separados. Recusa qualquer destino existente, inclusive parcial,
em vez de limpar arquivos possivelmente usados por um processo. A forma legada
sem argumento continua limpando `engine-dist`; não a executar enquanto algum
serviço depender dessa pasta. Esse controle de build não substitui verificação,
assinatura ou ativação segura pelo instalador.

Os dois roteiros nativos agora têm uma extensão opt-in, compartilhada por
`scripts/game-model-native-ui-fixture.mjs`, com três reinícios completos do host,
edições não enviadas, resposta perdida, recusa, repetição exata, visor e aplicação.
Mac usa Electron/preload/IPC reais, com diálogos simulados somente na fixture;
VS Code usa editor, Extension Host, webview e confirmações reais em perfil privado.
São **percursos preparados, ainda sem execução positiva dessa extensão**: a
sessão gráfica foi encontrada bloqueada. Templates e fontes foram compilados,
mas isso não comprova comportamento visual ou o encerramento desses hosts.

Depois de desbloquear o Mac e conferir que nenhum ensaio anterior segue ativo:

```bash
env -u OPENAI_API_KEY node scripts/smoke-game-studio-electron.mjs --model-editing \
  --engine=output/game-generation/model-editor-native-20261113-a1/engine \
  --blender=output/game-generation/weighted-skinning-20261113-a1/blender.json
env -u OPENAI_API_KEY node scripts/smoke-game-studio-vscode.mjs --model-editing \
  --engine=output/game-generation/model-editor-native-20261113-a1/engine \
  --blender=output/game-generation/weighted-skinning-20261113-a1/blender.json
```

Os roteiros verificam o bundle de desenvolvimento e o hash do driver antes de
iniciar o serviço; o registro Blender é copiado somente para o estado temporário.
Não alteram o provisionamento global, o app de uso, o perfil pessoal ou a instalação
do VSIX. Executar sequencialmente, conservar falhas e observar os handles originais;
timeout não autoriza reiniciar trabalho incerto. Compilar testes/renderer antes
do ensaio, nunca limpar `dist-tests` durante um processo que o esteja usando.

Preparação, hashes, verificação de recusa de sobrescrita e regressão:
`output/game-generation/model-editor-native-20261113-a1/report.json`.

Continuam pendentes: manipulação direta na viewport, curvas de interpolação, criação
e retargeting de armaduras/trilhas, edição interna de rigs importados de GLB,
novas fontes e topologias, receitas maiores, outras plataformas, aceite nativo/
instalado, qualidade artística, Unity, composição protegida Navi, jogos completos,
dispositivos físicos, áudio e playtests com pessoas.
