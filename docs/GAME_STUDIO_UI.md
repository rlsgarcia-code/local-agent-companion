# Game Studio: interfaces Mac e VS Code

Estado em **2026-11-11**: superfície funcional em fonte e ensaios de
desenvolvimento. A entrega integral do [plano](GAME_DESIGN_IMPLEMENTATION_PLAN.md),
o aceite das instalações e a distribuição continuam pendentes. Leia a
[arquitetura](SUITE_ARCHITECTURE.md) e as APIs de
[projeto](GAME_PROJECTS_API.md), [produção](GAME_PRODUCTION_API.md) e
[assets](GAME_ASSET_PIPELINE.md).

Qualificação recente: [playtests e rascunhos duráveis](#playtests-e-gravação-durável-no-editor--2026-11-11).

## Composição e uso

A direção visual mantém superfícies calmas, uma cor de ação, listas e divisores.
O conteúdo principal é o projeto e seu preview; informações de design, assets,
builds, testes, playtests consentidos e revisões ficam em abas. Mudanças de aba, hover e carregamento
têm transições curtas, respeitando redução de movimento. Não existe tela de
marketing, catálogo de jogos prontos ou nova interface de agente.

No Mac, **Game Studio** na navegação abre uma janela ligada à conversa e ao
workspace de origem. No VS Code, o botão correspondente ou o comando
`Local Agent Companion: Open Game Studio` abre o painel desse produto.
Mudar de conversa na interface principal não redireciona silenciosamente uma
janela já aberta do Studio. As duas interfaces usam o mesmo renderer, porém
conversas, projetos e permissões continuam em namespaces separados.

As abas fornecem:

- **Playtests:** rodadas ligadas ao build exato, registros consentidos por código,
  tempo observado, nota, ambiente e retirada; exportação de resumo ou registros
  individuais por confirmação nativa. São declarações do operador, fora das
  ferramentas/modelos e sem aprovação automática de qualidade. Leia
  [coleta e limites](GAME_PLAYTESTS.md).
- **Visão geral:** briefing, build disponível, captura de observação, preview
  jogável e exportações. A captura é identificada como imagem de uma revisão;
  não é tela ao vivo nem substitui clicar em Jogar.
- **Design:** leitura das seções e edição por campos de premissa, ações,
  progressão, câmera, arte, animação, som e save. O formulário conserva os demais
  campos, registra nova revisão e recusa concorrência. Listas são carregadas por
  partes ao abrir seções; não eliminar conteúdo grande para caber no renderer.
- **Assets:** catálogo, condição temporária/final declarada, origem, autor,
  licença e arquivos. Imagens PNG/JPEG/WebP e WAV de até 4 MiB têm inspeção local;
  outros formatos/tamanhos exigem exportação, preservando seus bytes.
  SVG de `local-media-v1/image.vector` reconhecido também tem prévia como imagem;
  o controlador confere projeto, asset, job e hash. SVG importado/alterado ou
  apenas marcado como processado não recebe essa confiança.
  **Candidatos de mídia** lista processamentos concluídos, separados dos assets
  já aplicados. A revisão mostra os arquivos, a origem/licença declaradas e uma
  prévia de imagem/WAV elegível. Áudio não toca automaticamente. **Aplicar ao
  projeto** pede confirmação nativa e cria uma revisão; inspecionar ou conferir
  novamente não processa outro candidato nem modifica o jogo.
  **Exportar candidato** preserva todos os seus formatos e metadados em uma
  nova pasta escolhida no host, mesmo quando ainda não foi aplicado.
  **Ajustar imagem** abre os parâmetros de uma composição local: dimensões,
  fundo, posição/tamanho/opacidade/cor/espelhamento/escala de cada camada e
  recorte opcional da fonte. Gerar uma variante exige confirmação nativa e
  preserva o candidato anterior; a aplicação ao jogo continua separada.
  **Tamanho do PNG** oferece [redução sem perda de pixels](GAME_PNG_OPTIMIZATION.md)
  quando o motor anuncia a capacidade. Mantém a escolha no rascunho privado e
  no pedido congelado; em motor antigo preserva o ajuste com diagnóstico.
  Não comprime na interface nem promete redução para toda imagem.
  **Ajustar ilustração** abre campos próprios de SVG tipado: formas, curvas,
  cores/gradientes, contorno, transformações e ordem. Não exige editar markup ou
  JSON, e também produz outro candidato antes de qualquer aplicação.
  **Ajustar áudio** abre duração, qualidade/canais, normalização, ganho,
  panorama, cortes e envelopes das faixas, além de notas, frequência/deslizamento
  e forma de onda. Permite duplicar/remover faixas já referenciadas e
  acrescentar/duplicar/remover notas. As fontes e o arquivo-alvo são preservados;
  processamento e aplicação exigem decisões separadas, sem reprodução automática.
  **Forma de onda e medições** gera, por escolha explícita, o
  [relatório do WAV codificado](GAME_AUDIO_ANALYSIS.md). O candidato mostra os
  envelopes dos canais, pico/RMS e trechos abaixo do limiar, sem DSP na interface
  ou alteração do áudio. A escolha usa o mesmo rascunho e pedido congelado.
  **Bibliotecas** abre busca paginada dos recursos locais: autor, citação, licença
  declarada, arquivos dependentes e nomes de animações. **Preparar candidato**
  exige confirmação e mantém o jogo intacto; revisão e aplicação são separadas.
  O documento completo da licença de uma importação reconhecida pode ser lido
  como texto na revisão do candidato, sem HTML ou execução de conteúdo.
- **Builds e testes:** jobs, estados de espera/reconciliação, falhas,
  cancelamento, inspeção de efeitos e verificadores instalados. Um build
  concluído não certifica arte, áudio, conteúdo ou experiência humana.
  Jobs `queued` com `waitingReason: "resources"` aparecem aguardando recursos
  de produção; a interface não aumenta orçamento nem altera prioridade.
  A [etapa persistente](GAME_PRODUCTION_WORKFLOWS.md) mostra critérios e consumo
  compartilhado de pedidos. Avanço exige evidência vigente; esgotamento oferece
  continuação com confirmação nativa, sem apagar o progresso. Uma produção
  posterior preserva o ciclo e a revisão/build anteriormente aceitos.
  Linhas de [uso da IA](INFERENCE_BUDGETS.md) mostram invocações e tokens
  informados/reservados do ambiente e da etapa. Esse consumo não é a contagem
  de builds; sua continuação é solicitada na conversa pelo fluxo de aprovação.
- **Revisões:** histórico paginado e restauração como nova revisão, conservando
  o estado posterior e sem repetir ferramentas. **Comparar versões** consulta
  duas revisões explícitas, com campos lado a lado, metadados de arquivos/assets,
  filtros e paginação. Arquivos oferecem comparação textual por linha, contexto
  e exportação do par histórico; binários/limites recebem diagnóstico explícito.
  Imagens e WAV registrados oferecem [comparação lado a lado e reprodução
  exclusiva](GAME_MEDIA_COMPARISON.md), com tamanho original opcional e vínculos
  exatos ao par histórico. Não executa o jogo ou aplica candidatos.
  Continua disponível somente para leitura e não altera o
  par escolhido quando surge uma revisão posterior. Consulte a
  [comparação de revisões e arquivos](GAME_REVISION_COMPARISON.md) e seus limites.

“Gerar build” e verificações externas exigem confirmação nativa. Edição e
restauração também confirmam a mudança e respeitam modo de edição/confiança do
host. O serviço revalida toolchain, revisão, catálogo e autoridade; a tela não
concede capacidade. Ausência de ferramenta resulta em impedimento explícito.

## Fronteiras e caminhos

| Componente | Caminho e responsabilidade |
|---|---|
| Comandos da UI | `packages/contracts/src/game-studio.ts`: schema fechado; sem escolha de produto, perfil, workspace, ferramenta genérica ou caminho do host |
| Controlador do cliente | `packages/client-ts/src/game-studio.ts`: coordena chamadas ao SDK e callbacks do host; não contém inferência ou execução de agente |
| Renderer compartilhado | `packages/game-studio-ui`: HTML/CSS/JS sem dependências de inteligência ou bridge para o jogo |
| Mac | `desktop/game-studio.ts`, preload restrito e `runtime-client.ts`: sessão autenticada, janela, confirmação e seleção de pasta |
| VS Code | `src/game-studio.ts`, `agent.ts` e comando/webview: sessão autenticada, confiança do workspace e painel com nonce |
| Preview | `packages/adapter-game-browser/src/preview.ts`, isolamento e recursos compartilhados com o coletor |
| Exportação | `packages/client-ts/src/game-export.ts`: diretório novo, hashes, histórico de domínio e fonte editável |

Cada comando de um projeto carrega sua identidade. Se outra janela mudar a
seleção, o controlador recusa a operação antiga. Um formulário em edição conserva
projeto e revisão de origem, mesmo quando uma atualização mostrar outro jogo;
nunca salvar seu design no projeto recém-selecionado. Dados exibidos têm horário
de atualização; indisponibilidade do serviço preserva a tela com aviso de dados
potencialmente antigos, sem fallback de inteligência.

O candidato fica vinculado ao job, projeto e revisão conferida. Mudança de
revisão desabilita aplicar até nova conferência; troca de projeto fecha sua
inspeção e remove a mídia. Confirmação nativa não dispensa nova checagem de modo
de escrita/seleção, e o serviço revalida `expectedRevision`, fingerprints de
fontes/alvo e conflitos antes do commit. Uma prévia de candidato usa somente
arquivos do resultado reconhecido e a mesma lista de formatos/limite de 4 MiB.
O botão usa a identidade da aplicação guardada na inspeção, sem escolher outra
silenciosamente após erro. Não há autoplay; sair da aba Assets pausa o áudio.
Isso não verifica licenças, elimina placeholders herdados ou aprova qualidade.
Os comandos fechados são `asset-result`, `asset-media`, `export-asset` e `apply-asset`; nenhum
recebe caminho do host, namespace, receita executável ou permissão. A seleção
de arquivo e o botão de aplicar ficam desabilitados durante pedidos pendentes.

Os ajustes de imagem usam o schema canônico `gameImageComposeOperation`, também
utilizado pelo processador. O comando fechado `adjust-image` conserva o job de
origem, arquivo de saída, quantidade/ordem/fontes das camadas e alvo/processador
do resultado reconhecido. Fontes precisam manter os fingerprints de bytes e
proveniência. Modo de edição, seleção e revisão são conferidos antes e depois da
confirmação. O serviço continua verificando receita, fontes, orçamento e recursos;
o renderer não executa codecs nem recebe ferramentas de host.

O formulário conserva projeto/revisão e uma identidade de pedido. Depois do
primeiro envio, uma falha de resposta conserva exatamente o mesmo conteúdo/ID,
com campos bloqueados. **Retomar pedido** não cria outro ID; a API recupera seu
job idempotente. Recusar essa retomada não cancela nem esquece um efeito anterior
incerto. Um impedimento conhecido antes do primeiro despacho libera os ajustes;
na retomada, não é prova de que o pedido anterior não ocorreu. O catálogo de
trabalhos continua disponível. Mudança concorrente de revisão pode bloquear a
retomada pelo formulário; a inspeção do job original permanece necessária, sem
refazer o processamento automaticamente. Os rascunhos de design e ajustes agora
são preservados pelo host, conforme a seção de recuperação abaixo; jobs e
candidatos já admitidos continuam sendo estado do serviço. Reabrir restaura
campos/identidade, sem despachar novamente.

As ilustrações `image.vector` de `local-media-v1` usam `adjust-vector` e o schema
canônico `gameVectorImageOperation`. O controlador conserva nome-base/pasta,
alvo e processador do resultado reconhecido; pode escolher SVG ou PNG real
para a variante, com receita editável e codec local verificado. Não aceita
fontes externas ou markup e não renomeia bytes antigos.
O formulário permite acrescentar, duplicar, remover e reordenar formas; editar
geometria, alfa, preenchimento, gradientes/pontos de cor, contorno e transformações;
e adicionar/remover/editar pontos M/L/Q/C/Z por campos. Formas e pontos são
carregados por partes, conservando os dados que ainda não foram abertos.
O processamento continua no worker; a prévia é a do candidato reconhecido,
sem gerar SVG no renderer. Desenho direto no canvas e prévia contínua dos ajustes
continuam pendentes. A receita `.vector.json` e o candidato anterior permanecem.

Valores inválidos no comando vetorial recebem uma recusa conhecida antes de
despachar. Essa resposta não liquida um pedido anterior com confirmação perdida:
na retomada, o formulário mantém seu conteúdo/ID e campos bloqueados. Registro,
modo, seleção e revisão são revalidados antes/depois da confirmação nativa;
novo candidato não se aplica automaticamente nem altera licença/placeholder.
Atlas e seleção de novas fontes têm contratos próprios e continuam pendentes
nesse formulário. A [edição de receitas 3D](GAME_MODEL_EDITING.md) agora usa
`adjust-model`, mantendo o processador isolado e guardas de fontes. A edição
de áudio usa o percurso abaixo.

`audio.render` usa `adjust-audio` e `gameAudioRenderOperation`, o mesmo schema
canônico empregado pela produção. O formulário edita duração, taxa de amostragem,
canais, pico normalizado opcional, ganho/panorama/cortes/fades das faixas e
frequência/deslizamento, forma de onda, ataque/liberação e semente das notas.
Pode duplicar/remover as faixas já referenciadas e acrescentar/duplicar/remover
notas. A lista carrega 20 notas por vez e conserva os dados ainda não abertos.
Os limites e envelopes continuam validados pelo contrato/worker; fontes,
arquivo-alvo, processador, revisão e consentimento não são ampliados pela UI.
O resultado é outro candidato WAV, com proveniência e aplicação separadas.

A resposta histórica `imageAdjustmentRejected` também identifica uma recusa
conhecida de ajustes de áudio antes do despacho. Recusar a retomada não liquida
uma operação anterior com resposta perdida: a identidade e os campos congelados
permanecem. A recuperação pelo host também conserva notas/faixas não abertas.
Seleção de novas fontes, waveform/timeline visual, prévia contínua e aceite
auditivo/instalado continuam pendentes. Não há execução de DSP ou agente no renderer.

Atualização automática pausa enquanto um formulário visível tem edição local
não enviada; pedidos congelados e a aba de jobs podem continuar atualizando.
Atualização explícita/envio continuam validando o estado atual no serviço.
Durante uma chamada, botões refletem a mesma barreira de ocupação do controlador:
um clique de revisão não fica habilitado para ser silenciosamente ignorado.
Ao receber snapshot, o estado anterior dos botões é liberado antes de renderizar
as novas decisões de permissão/revisão, preservando os controles bloqueados.

Histórico e produção aceitam paginação `order: asc | desc`, com `asc` como padrão
compatível nos SDKs TS/Python. A UI começa pelos mais recentes. A consulta de
capacidades pode ser reaproveitada por até 30 segundos no controlador, evitando
recalcular hashes do navegador a cada atualização. As operações continuam
sondando a disponibilidade atual no serviço, independentemente desse cache.

O renderer usa texto/DOM para dados do projeto, sem inserir HTML gerado. CSP
proíbe rede, frames, objetos e código inline. No Mac, o preload expõe apenas o
pedido Studio; o main valida janela e frame de origem. A janela usa sessão
própria, sem Node no renderer. No VS Code, somente recursos estáticos do Studio
são liberados, e respostas se correlacionam por identificadores imprevisíveis.

## Bibliotecas e recuperação da importação

`libraries` é leitura; `import-library` aceita somente a operação canônica
`library.copy` de uma [seleção instalada](GAME_LICENSED_LIBRARIES.md). Não aceita
produto/perfil, caminhos do host, instruções executáveis ou declaração de licença
como autoridade. O controlador consulta a seleção exata por `entryId`, compara
seu conteúdo completo e confere modo, seleção, revisão, identidade nova do asset,
conflitos de arquivos e disponibilidade antes **e** depois da confirmação. A
preparação continua nos jobs/recursos/orçamentos existentes do serviço.

A interface usa busca explícita, páginas de dez recursos, detalhes por campos e
uma ação principal. Ao preparar, conserva projeto/revisão e conteúdo/ID do pedido
antes de despachar. Resposta perdida congela campos e oferece **Retomar pedido**;
recusar a retomada não descarta um efeito anterior. Recarregar não submete nada
sozinho. Um impedimento conhecido libera o primeiro envio, mas não liquida uma
solicitação anterior sem confirmação. O candidato só entra na revisão após a
confirmação própria de **Aplicar ao projeto**. A classificação “Final declarado”
é uma escolha de catálogo do usuário, sem aprovação jurídica, artística ou humana.

O controlador compartilhado é o dono da validação canônica. A ponte VS Code
valida seu envelope e mantém sessão/autenticação, mas não antecipa outro parser
que transforme uma recusa conhecida em erro de comunicação. A mesma fronteira
serve aos comandos vetoriais existentes; não amplia capacidades ou dispensa a
revalidação do serviço.

### Inspeção de modelos

Os candidatos GLB também oferecem [inspeção 3D isolada](GAME_MODEL_VIEWER.md),
com texturas, câmera orbital e clips sem reprodução automática. A inspeção
continua disponível em planejamento e não aplica nem concede qualidade. Os hosts
Mac/VS Code empacotam seu runtime exato; esse percurso não roda dentro do renderer
administrativo nem amplia ferramentas do Navi.

### Rascunhos duráveis do host

O estado de design, ajustes de imagem/vetor/áudio/modelo 3D e importação de biblioteca
contém somente campos locais e vínculos dos pedidos. O envelope versionado é
limitado a **2 MiB de JSON**, com limites de profundidade/entradas; não contém
credenciais ou ferramentas. O SDK fornece `GameStudioDraftStore`, a validação
limitada e ordenação/CAS. Os comandos privados `draft-read`/`draft-write` são
tratados pelos hosts, fora da Agent API, sem dar acesso a arquivos ou seleção de
namespace. O escopo vem do registro autenticado: produto, perfil, workspace e
sessão. Rotacionar uma credencial não exige copiar seu segredo para o rascunho.

No Mac, `desktop/game-studio-drafts.ts` grava um arquivo privado no `userData`,
com nome derivado do escopo, escrita temporária exclusiva, sincronização e rename
atômico. Recusa links, permissões abertas e arquivo incompatível, conservando o
original. O fechamento normal aguarda as gravações; falha não confirmada oferece
voltar ao Studio, preservando o arquivo anterior. No VS Code, o host usa
[`ExtensionContext.workspaceState`](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext.workspaceState),
com a mesma chave de escopo e confirmação de `Memento.update`. O usuário reabre o
Studio na mesma conversa para recuperar o estado. Não há serializer para reabrir
automaticamente a posição do painel no editor.

O rodapé distingue gravação em andamento, confirmação e recuperação necessária.
Antes de enviar design, importação ou variante, a UI aguarda a gravação exata do
pedido congelado; sem confirmação não despacha. Um save confirmado cuja resposta
se perdeu pode ser recuperado pelo mesmo CAS/conteúdo, sem outra escrita. Outra
janela com conteúdo divergente não sobrescreve o primeiro rascunho. Erro/versão
incompatível conserva dados e impede novo envio pelo formulário, em vez de apagar
ou criar identidade substituta. Não promete conservar uma digitação que ainda
não recebeu confirmação diante de encerramento forçado/falha física.

Restaurar apenas apresenta campos e identidade: não processa, aplica, aprova ou
retoma automaticamente. O controlador e serviço revalidam todo conteúdo como
dado não confiável. Respostas `designEditRejected`, `libraryImportRejected` e
`imageAdjustmentRejected` descrevem somente a invocação conhecida; na retomada
não provam que um efeito anterior deixou de ocorrer. O design também revalida
modo, seleção e revisão antes/depois da confirmação nativa.

Para design com resposta perdida, **Retomar pedido** envia o comando privado
`resume-design` com os campos e identidade originais. O controlador exige a
capacidade `game-mutation-inspection-v1` e consulta `games.mutations.inspect`.
Um recibo confirmado precisa corresponder ao método, mensagem, revisão esperada
e documento completo reconstruído da revisão original. A revisão confirmada
também precisa apresentar o mesmo hash do recibo. A UI informa a revisão em que
o pedido foi salvo e conserva o snapshot atual, inclusive trabalho posterior:
não repete o commit nem pede autorização para uma consulta somente de leitura.
Isso funciona em modo de planejamento, desde que o mesmo projeto esteja selecionado.

Recibo ausente não prova ausência de efeito: somente o pedido original pode seguir
pelas verificações normais, confirmação nativa e concorrência transacional do
serviço. Motor antigo, vínculo divergente ou consulta interrompida preservam o
pedido congelado com diagnóstico. Reabrir não consulta/despacha automaticamente
esse pedido. Não criar outra identidade nem repetir a alteração como solução
automática; esta recuperação não concede autorização parental ou qualidade.

O `getState`/`setState` do webview e o `sessionStorage` antigo permanecem apenas
como origem de migração do antigo rascunho de biblioteca. O novo dado confirmado
pelo host tem precedência. Limites da biblioteca/receita/controlador permanecem;
o maior envelope local não amplia permissões, tamanho de mídia ou orçamento.

`asset-media` permite ler somente os documentos `text/plain` apontados pela
licença da seleção reconhecida, com até 256 KiB. O SDK verifica os bytes e a UI
usa `textContent`; não renderiza markup. Arquivo maior ou não UTF-8 continua
exportável integralmente. Seleção/revisão/candidato continuam vinculados e a
prévia é limpa quando muda o projeto. GLB, scripts ou qualquer texto do host não
ganham acesso por esse caminho. A textura PNG pode ser inspecionada; este seletor
não afirma oferecer viewport de modelo 3D ou reprodução das animações.

## Preview e exportação

Jogar abre Chrome/Edge qualificado em perfil descartável, com sandbox ativo e
somente os arquivos do build fixado. Não abre o navegador pessoal ou entrega a
bridge do aplicativo ao jogo. Navegação/requests externos, WebSockets, popups,
dispositivos, seletores de arquivo e WebRTC não ficam disponíveis. Os saves são
temporários e isso é informado antes da abertura. Ao fechar a UI, seus previews
são encerrados; builds e trabalho independente no serviço continuam.

O transporte é o mesmo listener efêmero de recursos do coletor, em loopback, com
capacidade HttpOnly exclusiva, sem RPC, mutação, proxy ou leitura livre de disco.
Tamanho e SHA-256 são conferidos contra o manifesto de cada arquivo, tanto nas
rotas do navegador quanto nos recursos servidos para worklets. Agent API continua
somente em TLS/IPC Unix/named pipe. O suporte Godot a WebAssembly não habilita
`unsafe-eval` genérico.

A pasta de exportação é escolhida pelo diálogo nativo, nunca pelo renderer.
Arquivos são baixados/verificados numa pasta privada nova e publicados por
rename; falhas removem somente essa preparação. Nada sobrescreve a pasta de
um projeto existente. Caminhos portáveis de até 400 caracteres continuam válidos
quando colocados nos diretórios de exportação.

- **Fonte:** `source/` editável, `project.json`, `history.json`, `production.json` e `blobs/` por
  SHA-256. Conserva todas as revisões exportadas, inclusive anteriores a uma
  restauração; etapas/eventos são preservados como histórico, sem conceder
  autoridade, orçamento ou qualidade ao importar. Não exporta checkpoints nem
  reexecuta ações; migração de ciclos ativos ainda está pendente.
- **Build:** `build/` autocontido e `artifact.json` com revisão, ferramenta e
  hashes. O README explica o uso por HTTP local e os limites do aceite.
- **Candidato de mídia:** `candidate/` com todos os arquivos do resultado
  reconhecido pelo serviço, inclusive JSON e formatos sem prévia, mais
  `candidate.json` com receita, origem/licenças, placeholders, hashes de fontes,
  revisão e toolchain. Cada arquivo é conferido por tamanho/SHA-256 antes da
  publicação da pasta nova. Não aplica, processa ou importa permissões; modo
  Plano pode exportar um resultado existente. Troca de seleção recusa comandos
  de outro projeto; cancelar o seletor ou falhar a transferência preserva os
  arquivos já existentes. O renderer recebe apenas sucesso/cancelamento, sem
  escolher ou receber o caminho do host.

## Verificação reproduzível

```bash
npm run smoke:game-studio
npm run smoke:game-studio-native
npm run smoke:game-studio-vscode
```

O primeiro usa o Node/motor empacotados, TLS/IPC real e os dois namespaces.
Exercita o renderer copiado pelos builders Mac/VS Code, protocolos de bridge,
layouts claro/escuro/largura reduzida, design por campos, troca concorrente de
projeto durante edição, restauração, mídia, preview isolado e exportações.
Verifica ainda avanço Design/Core, recusa sem evidências de controles e
esgotamento/continuação da alocação por etapa com builds reais.
Simula ainda indisponibilidade da bridge, preservação dos dados antigos,
recuperação e ausência de avisos repetidos a cada consulta de fundo.
As bridges nesse ensaio são emuladas; não é prova de um webview VS Code real.

O segundo abre uma janela Electron de desenvolvimento com o preload e handler
reais, perfil temporário e serviço empacotado. Verifica ausência de Node/bridge
geral no renderer, edição, exportação e preservação do estado ao fechar a janela.
Também avança a etapa inicial, observa o bloqueio seguinte sem evidência de
controles e verifica a etapa no arquivo de produção exportado.
Os diálogos são simulados **somente no harness temporário**. Não inicia o main
com dados pessoais nem modifica o aplicativo instalado.

O terceiro abre o VS Code existente com perfil, workspace, armazenamento de
segredos em memória e extensão de desenvolvimento temporários. Usa as classes
reais `DevelopmentAgent`, `EditorServiceRuntime` e `openEditorGameStudio`; apenas
a fábrica de conexão é vinculada ao serviço temporário já iniciado. Não chama
bootstrap/instalador ou LaunchAgent do usuário. O webview, `acquireVsCodeApi`,
nonce, URIs de recursos, SDK/sessão e diálogos customizados do VS Code são reais.
Exercita edição, restauração, preview isolado e exportação pelo seletor de pasta,
além da ausência de Node/bridge Mac dentro do webview. O depurador de renderer é
temporário e local, não uma porta da Agent API.

O ensaio foi demonstrado no **VS Code 1.145.2 / Mac ARM64**. A largura real do
painel foi 786 px, sem overflow horizontal, usando a composição compacta. O
renderer passa ao layout compacto até 920 px e usa o token de link do tema para
texto selecionado, separando-o do fundo dos botões para manter contraste.
Isso não qualifica outras plataformas nem instala/promove uma VSIX.

Encerrar uma conexão CDP pode deixar o Code sem janelas no Mac. O runner encerra
e verifica somente o grupo de processos que criou e o Crashpad identificado pelo
caminho privado do perfil temporário, antes de removê-lo. Não usar `killall`,
instâncias pessoais ou sucesso impresso antes de confirmar a limpeza. O runner
de processos é POSIX; o aceite Windows continua pendente.

Capturas e relatórios ficam em `output/playwright/game-studio/`; a subpasta
`native-mac` identifica o ensaio Electron e `native-vscode`, o painel real do
editor, com confirmação de limpeza no relatório. Os projetos são fixtures técnicas,
não os jogos de aceite do portfólio. Testes do serviço/SDK cobrem recusa de modo
Plano, namespaces/projetos forjados, paginação, concorrência, exportação íntegra,
perda de download e preservação de pastas existentes.

O ensaio do renderer agora guarda cada execução em `runs/<data-id>/`, sem
sobrescrever a anterior. A rodada de candidatos em
`runs/2026-11-11T12-27-39-726Z-343f11c1/` usou os dois contextos de bridge,
worker PNG/WAV real e o serviço empacotado. Conferiu imagem decodificada, WAV
carregado sem autoplay, recusa sem alteração, revisão concorrente bloqueada,
nova conferência e aplicação explícitas, placeholder herdado, exportação dos
bytes aplicados e limpeza de áudio ao trocar de projeto. Capturas claro/escuro
e largura reduzida foram inspecionadas. Não é aceite dos aplicativos instalados,
de audição física, de estética final ou da produção de um jogo completo.

Na rodada `runs/2026-11-11T13-23-51-786Z-d008bc78/`, os dois contextos também
cancelaram o seletor de candidato e exportaram WAV/JSON com igualdade de bytes
e metadados, sem aprovação de escrita ou nova revisão. A regressão passou
538 testes, um opt-in ignorado, 30 verificações e 15 direcionados; tipagem e
builds da extensão/Mac/motor passaram. O motor `18679989…` respondeu `MOTOR_OK`
com Qwen Coder Standard/Deep. Fontes/logs/hashes em
`output/game-generation/candidate-export-20261111-a1/report.json`. O primeiro
ensaio visual terminou por timeout na observação de uma mensagem de concorrência;
foi preservado. O harness seguinte também confere o pedido/rejeição do projeto
original, além da mensagem exibida, e aguarda a consulta em curso antes de enviar.
Nenhum desses testes demonstra aplicação instalada, arte ou audição física.

O ensaio `runs/2026-11-11T14-07-46-830Z-7fb5b16f/` conferiu os ajustes visuais
nos dois contextos: recusa sem processamento, nova variante32×32, resposta perdida,
campos/ID preservados, recusa de retomada sem esquecer o efeito anterior, retomada
do mesmo job, revisão intacta até a aplicação e exportação dos bytes aplicados.
Serviço/SDK/worker/navegador reais, com bridges e confirmações simuladas. Capturas
clara/escura foram inspecionadas. A regressão passou545 testes, um opt-in ignorado,
30 verificações e seis direcionados, tipagem e builds extensão/Mac/motor.
Fonte/logs/hashes em `output/game-generation/image-adjustment-20261111-a1/report.json`.
Os ensaios visuais anteriores falharam na contagem paginada do próprio teste;
foram preservados. A checagem de exatamente um novo job não foi retirada.

Pendências registradas nesse ensaio de 2026-11-11: integração visual e aceite dos aplicativos/VSIX instalados,
bootstrap de distribuição, edição artística ampliada, criação de fontes e receitas
de atlas/áudio/modelos pela UI e prévias de outros
formatos/tamanhos, importação de arquivos externos e bibliotecas adicionais, comparação visual de revisões, demais plataformas e
distribuição assinada. Os quatro adaptadores, KidOS e critérios físicos/humanos
mantêm o escopo integral do plano.

## Qualificação de bibliotecas — 2026-11-11

A integração passou 563 testes, um opt-in ignorado, 30 verificações do repositório
e 15 direcionados de Studio/bibliotecas, com typecheck e builds extensão/Mac/motor.
O motor desta composição tem manifesto
`557c49389fb5b7d06a378f33357203d1717f4b8a25ae8bca05c7120605e979cf`.
Roteamento simulado e smoke real somente de leitura Qwen3-coder:30b passaram em
Standard e Deep. Esses testes não produzem nem aprovam um jogo.

Evidências novas, sem substituir os percursos anteriores:

- Renderer/SDK/serviço reais, bridges/consentimentos emulados nos dois produtos:
  `output/playwright/game-library-studio/runs/2026-11-11T16-26-58-229Z-966742a2/`.
  Busca vazia/por animação, 22 entradas paginadas, 32 nomes de clips, licença
  completa, recusa, resposta perdida, recarga sem envio automático, recusa da
  retomada sem esquecer o efeito, mesmo ID/job, exatamente um processamento,
  exportação dos bytes, aplicação explícita, modo e troca de projeto. Viewports
  de 1200, 740 e 400 pixels foram conferidos sem rolagem horizontal.
- Janela Electron/preload e SDK reais, perfil temporário e diálogos emulados:
  `output/playwright/game-studio/native-mac/runs/2026-11-11T16-19-28-767Z/`.
  Entrada inválida permaneceu editável; resposta perdida e recarga da janela
  recuperaram o mesmo job. Licença integral lida, aplicação na revisão3 e estado
  preservado no serviço após fechar a UI. Não é o `.app` instalado/notarizado.
- VS Code, classes de produção e webview reais, conexão com motor temporário e
  confirmações próprias do editor:
  `output/playwright/game-studio/native-vscode/runs/2026-11-11T16-28-20-880Z/`.
  A recarga usa **Developer: Reload Webviews**, aguarda a saída do frame anterior
  e comprova `getState`/`setState` com o pedido congelado; retorna o mesmo job,
  lê licença, aplica na revisão4 e confirma encerramento dos processos da fixture.
  A captura da licença foi conferida dentro da área visível do painel. Não é
  instalação/atualização do VSIX pessoal ou aceite das outras plataformas.
- Regressão de design, composição, vetor, áudio, histórico, preview e exportações:
  `output/playwright/game-studio/runs/2026-11-11T16-27-12-106Z-f09a9204/`.
- Cópia e renderização Babylon/textura/walk pela toolchain atual:
  `output/playwright/game-library/runs/2026-11-11T16-27-59-404Z-740386fe/`.
  Esse último é outro ensaio, sem alegação de viewport 3D dentro do seletor.

As falhas iniciais foram preservadas: o primeiro teste de UI procurou a lista de
busca anterior após recarga, que restaura o pedido e não aquela lista; o teste
passou a consultar novamente. No VS Code, navegação direta por `location.reload`
não exercitava o ciclo de recarga controlado pelo editor; a fixture adotou seu
comando próprio. A observação seguinte encontrou o frame antigo durante a
substituição; agora aguarda o descarte confirmado e procura o novo documento.
Não houve relaxamento de quantidade de jobs, identidade, revisão ou licença.
A descoberta da validação duplicada na ponte foi corrigida no código do produto,
não contornada na fixture.

Fontes, logs, manifestos e hashes de UI:
`output/game-generation/library-studio-20261111-a1/report.json`.
Naquele registro, a restauração após destruir painel/app ainda estava pendente;
a seção de rascunhos duráveis registra a implementação e as provas posteriores.
O [visor 3D](GAME_MODEL_VIEWER.md) foi implementado e qualificado posteriormente.
Bibliotecas/formatos adicionais, edição artística completa, instalações,
plataformas, Unity/Core, jogos completos e aceite físico/humano seguem no plano integral.


## Qualificação de rascunhos do host — 2026-11-11

- Cinco testes próprios verificam persistência/reabertura, escopos, CAS e resposta
  perdida, congelamento de dados enfileirados, limites/JSON, fechamento aguardando
  confirmação e preservação de dados inválidos/links/permissões.
- `output/playwright/game-studio-drafts/runs/2026-11-11T19-00-53-139Z-58cb2a6c/`:
  ambas as pontes emuladas, renderer/SDK/serviço reais, arquivo Mac real e fixture
  Memento apoiada em arquivo; destrói o contexto inteiro e recria controlador/
  store. Design e áudio locais reaparecem, pedido perdido e recusa permanecem
  congelados, não há autoplay/autoenvio, a retomada recupera um único job e a
  falha de gravação impede o despacho. Corrupção permanece intacta com diagnóstico.
- `output/playwright/game-studio/native-mac/runs/2026-11-11T18-57-40-172Z/`:
  Electron/preload/IPC reais, confirmações simuladas somente na fixture isolada.
  O processo inteiro é fechado e relançado com nova partição/renderer/controlador;
  o arquivo privado recupera a importação congelada. O contador confirma ausência
  de despacho ao reabrir e a retomada explícita mantém pedido/job; aplicação separada.
- `output/playwright/game-studio/native-vscode/runs/2026-11-11T18-59-11-375Z/`:
  VS Code/webview/contexto/Memento reais em perfil de desenvolvimento temporário;
  edição, restauração, exportação, preview, licença e recarga da importação mantêm
  as guardas. Não demonstra relançamento completo do processo do editor.
- Regressões de biblioteca e Studio com PNG/áudio passaram nos diretórios
  `2026-11-11T19-00-50-354Z-13fa845b` e `2026-11-11T19-00-54-377Z-16eb683e`,
  dentro de `output/playwright/game-library-studio/runs` e
  `output/playwright/game-studio/runs`. Seus handles confirmaram encerramento0;
  os serviços temporários terminaram normalmente, sem intervenção ou reexecução.

O primeiro ensaio preservou um timeout na verificação da mensagem de corrupção:
a atualização inicial apagava o aviso. O aviso foi corrigido, sem afrouxar a
verificação de dados conservados. As capturas seguintes foram lidas. Nada foi
instalado/publicado. Aceite das instalações, reinício completo do VS Code,
demais plataformas, arte completa, jogos e matriz
física/humana permanecem distintos desta qualificação.

## Recuperação do recibo de design — 2026-11-11

A API e ambos os SDKs agora consultam o recibo transacional original. Os testes
cobrem isolamento entre produto/perfil/workspace, rotação do registro, transação
desfeita, reinício, projeções forjadas e compatibilidade com motor antigo. O
controlador também recusa vínculo/hash divergentes e confirma a revisão original
sem repetir commit, sem apagar trabalho posterior e sem pedir aprovação de escrita
em modo de planejamento. Recibo ausente mantém as verificações e o pedido exato.

- `output/playwright/game-studio-drafts/runs/2026-11-11T19-56-50-979Z-8af299ab/`:
  renderer/controlador/serviço e os dois armazenamentos de host; perde a resposta
  após commit, cria uma revisão posterior, destrói contexto/store e reabre em modo
  somente de leitura. Nenhum envio automático; retomar reconhece revisão2 e mantém
  revisão3. Pontes emuladas, não aceite instalado.
- `output/playwright/game-studio/native-mac/runs/2026-11-11T19-57-01-794Z/`:
  Electron/preload/IPC e arquivo privados reais, relançamento completo do processo;
  o pedido perdido volta congelado e é reconhecido com um único commit. Somente
  as confirmações nativas são simuladas na fixture; o app pessoal não foi alterado.

O ensaio real de desenvolvimento do VS Code iniciado em
`output/playwright/game-studio/native-vscode/runs/2026-11-11T19-44-55-972Z/`
terminou posteriormente com erro no último atalho de fechamento, após as capturas
intermediárias. Elas não o tornam aprovado. O relatório
`output/game-generation/design-receipt-20261111-a1/report.json` distingue os
resultados finais. O ensaio posterior do visor passou sem aquele atalho final;
o percurso de reinício integral está registrado a seguir. Instalações e demais
critérios do plano continuam separados.

## Reinício integral do VS Code — 2026-11-11

A fixture nativa recria **todo o processo Code e o Extension Host**, conservando
o perfil privado, workspace e `workspaceState` reais. Ela reabre o Studio por
comando explícito: o produto continua sem serializer para restaurar automaticamente
a posição do painel. PID novo de ambos os processos e sessão estável são conferidos.

Dois casos no mesmo percurso:

1. Commit de design concluído no serviço com resposta perdida. O pedido volta
   congelado após recriar o painel e encerrar/reabrir o editor inteiro. Não há
   novo commit ao abrir; retomar consulta o recibo original, mantém revisão 2 e
   não exibe confirmação de escrita.
2. Design editado e confirmado pelo armazenamento local, **ainda não enviado**.
   Outro reinício integral recupera o texto editável, sem nova revisão. Cancelar
   essa edição é explícito; o histórico no serviço permanece intacto.

Os ensaios completos com os mesmos critérios passaram em
`output/playwright/game-studio/native-vscode/runs/2026-11-11T20-59-01-069Z/` e
`output/playwright/game-studio/native-vscode/runs/2026-11-11T21-02-57-031Z/`.
Incluem restauração de revisão, preview, exportação, candidato perdido/recarga,
licença integral, visor 3D, aplicação separada e serviço disponível depois de
terminar o editor. Ambos confirmaram saída 0 e limpeza da fixture. Não houve
substituição do app/VSIX pessoal, cópia manual de banco ou reinício do serviço.

Os dois ensaios iniciais preservam uma falha posterior aos reinícios:
`page.goto` atingiu o limite existente de 5 segundos ao abrir o preview. Os dados
voltaram corretamente, mas esses percursos completos **falharam**. A causa das
falhas de navegação não foi estabelecida. Nas duas execuções posteriores,
leituras dos cinco arquivos duraram 6–128 ms e 9–106 ms, respectivamente; esses
números não explicam retrospectivamente os casos falhos. A medição não altera
promessas/resultados nem grava código, corpos de mensagens ou credenciais.
Nenhum timeout, limite, permissão, engine ou critério de QA foi afrouxado.

Fontes/diagnóstico/falhas e hashes:
`output/game-generation/editor-restart-20261111-a1/report.json`.
A retomada de rascunhos/pedidos após processo inteiro foi demonstrada neste Mac;
instalações, outras plataformas, credenciais/execuções ativas e a investigação da
intermitência do preview continuam exigindo suas próprias provas. Não inferir
recuperação de digitação ainda não confirmada, qualidade de jogos ou aceite
físico/humano desses ensaios.

## Playtests e gravação durável no editor — 2026-11-11

A nova aba usa as [operações de playtest](GAME_PLAYTESTS.md) pelo mesmo
controller/SDK e motor. O formulário não presume consentimento, pessoa distinta,
nota, tempo ou ambiente. A rodada fica ligada ao build reconhecido, com números
declarados pelo operador, registro de retirada e exportações separadas de resumo
ou dados individuais. Nenhum desses números aprova o jogo.

Os pedidos são preservados no host antes de enviar e podem ser conferidos por
recibo após perder a resposta, inclusive em modo Plano. O binding inclui o
conteúdo original e o serviço mantém a autoridade de namespace/build. Recibo
ausente ou recusa de uma nova tentativa não cancela um efeito anterior. Um
registro já retirado não é recriado ao recuperar o pedido antigo.

O ensaio real do editor em
`output/playwright/game-studio/native-vscode/runs/2026-11-11T22-56-07-927Z/`
falhou antes dos playtests: após encerrar o processo inteiro, o design não enviado
voltou ao conteúdo anterior. O Memento havia respondido à gravação, mas o ensaio
não confirmou que os últimos dados estavam duráveis no disco. Essa falha continua
preservada; os passes anteriores não a apagam.

A correção compartilha o backend de arquivo privado do SDK entre Mac e VS Code:
write/`fsync`, rename atômico e `fsync` do diretório precedem a confirmação do
rascunho. O escopo vem do registro autenticado e da sessão, não do renderer.
O editor usa `globalStorageUri` do próprio host e conserva Memento apenas como
entrada legada quando não existe arquivo atual. Arquivo atual inválido não
provoca fallback silencioso. URI remota ou de provedor arbitrário não é tratada
como caminho local. O caso local `vscode-userdata` corresponde ao provedor de
perfil do VS Code desktop, não a uma permissão genérica de filesystem.
[Armazenamento de extensões](https://github.com/microsoft/vscode-docs/blob/main/api/extension-capabilities/common-capabilities.md),
[provedor local de perfil](https://github.com/microsoft/vscode/blob/main/src/vs/platform/userData/common/fileUserDataProvider.ts).

A tentativa intermediária
`output/playwright/game-studio/native-vscode/runs/2026-11-11T22-59-50-146Z/`
revelou que aceitar apenas `file:` excluía
o armazenamento de perfil nativo. Não houve aprovação ou fallback para contornar
a recusa; o guard foi limitado ao provedor local comprovado.

O mesmo ensaio original passou depois, em
[`2026-11-11T23-01-41-220Z`](../output/playwright/game-studio/native-vscode/runs/2026-11-11T23-01-41-220Z/evidence.json):
editor e Extension Host foram reiniciados de verdade, o texto não enviado foi
recuperado sem outro commit e o painel realizou criar/registrar/retirar e exportar
resumo, com confirmações reais. Não foi necessário ampliar os prazos do teste.

O ensaio das duas pontes emuladas
[`2026-11-11T23-02-15-965Z-bb0967bb`](../output/playwright/game-playtests/runs/2026-11-11T23-02-15-965Z-bb0967bb/report.json)
usa os dois backends reais de arquivo; cobre também rascunho não enviado,
resposta perdida, retomada de tombstone, falha de salvamento, notas como texto,
exportação individual e rodada antiga. O caso anterior
`2026-11-11T22-59-54-981Z-b272f397` fechou o contexto antes de todas as últimas
confirmações estarem salvas: a checkbox não confirmada permaneceu desmarcada e
o formulário recusou a gravação. O runner agora espera o reconhecimento de todos
os valores, sem preencher consentimento automaticamente nem prometer recuperar
digitação não confirmada.

A janela/preload Electron reais também passaram em
[`2026-11-11T23-04-29-283Z`](../output/playwright/game-studio/native-mac/runs/2026-11-11T23-04-29-283Z/evidence.json),
com o mesmo backend compartilhado, reinício completo do host para os recibos,
criar/registrar/retirar e exportação de resumo pelo host. Apenas nesse harness
temporário os diálogos nativos foram simulados; o ensaio do VS Code acima usa
confirmações reais. Nenhum dos dois é a instalação pessoal atualizada.

São dados sintéticos e perfis temporários. A instalação de `.app`/VSIX, demais
plataformas e playtests com pessoas reais continuam pendentes. A fonte não
fornece ainda correção auditada de observações nem integração parental KidOS.

## Restauração recuperável — fonte de2026-11-13 UTC

Em **Revisões → Restaurar**, o renderer agora congela projeto, revisão desejada,
revisão atual esperada e identificador do pedido. Salva esse vínculo no backend
privado do host e aguarda a confirmação durável antes de despachar. `restoreEdit`
é um campo opcional do rascunho de interface; não guarda código/credenciais nem
concede autoridade. Após a confirmação da limpeza, esse campo é omitido do
arquivo: rascunhos sem pedido pendente não passam a exigir o leitor novo por
um valor nulo desnecessário. O limite de2MiB e o CAS do armazenamento continuam iguais.
Os clientes mais antigos podem recusar esse campo desconhecido; devem preservar
o arquivo em vez de descartá-lo ou recorrer a um estado legado.

Se a resposta se perde, **Conferir restauração** conserva o mesmo pedido. Reabrir
a tela recupera a seção sem despachar, aprovar ou repetir a operação. Novas
restaurações ficam indisponíveis até conferir a anterior; outras leituras e
alterações do projeto continuam separadas. Um rascunho presente inválido, inclusive
`false`, interrompe novas restaurações e envios que dependem do rascunho, preservando os
bytes originais.

`resume-restore` é um comando privado do host/SDK, sem ferramenta nova do modelo.
Usa `game-mutation-inspection-v1` e o recibo existente de commit. Confere o hash
do pedido original, sua mensagem/identidade, a revisão esperada de destino e o
hash da revisão imutável reconhecida. Assim, consegue confirmar uma restauração
já concluída **em modo de leitura**, sem novo consentimento para mutação, sem
outro commit e sem sobrescrever revisões posteriores.

Recibo ausente, incompatível ou engine antigo não provam cancelamento. O pedido
continua preservado. Só o mesmo vínculo poderá atravessar novamente a confirmação
nativa e o CAS do serviço. Negar uma tentativa de retomada não apaga o resultado
ainda desconhecido da anterior. Antes e depois da confirmação, o controller
confere modo de edição, projeto selecionado e revisão. Rejeições conhecidas antes
do despacho usam `restoreRejected`; falhas posteriores continuam desconhecidas.
A limpeza local do pedido também aguarda confirmação; falha nessa gravação mantém
o vínculo e orienta reabrir para conferir o armazenamento.

### Evidência e alcance

`test/engine-game-studio.test.ts` usa SDK/serviço/TLS reais em projetos temporários:
permissão/seleção/revisão alteradas durante confirmação, resposta perdida após
commit, nova instância do controller, trabalho posterior preservado, leitura sem
aprovação, recibo divergente, motor sem suporte e recusa de replay em modo Plano.
A fixture de armazenamento exercita o mesmo campo em CAS e recriação do host.

`scripts/qualify-game-studio-drafts.mjs` ampliou a qualificação com renderer/JS
reais nas duas **pontes emuladas**. O ensaio
`output/playwright/game-studio-drafts/runs/2026-11-13T05-10-26-618Z-965e32ef/`
passou em1200px/Mac e760px/editor: recarga após fechar o contexto inteiro,
resposta perdida, revisão posterior, leitura sem confirmação, falha de save
impedindo despacho, negativa conservando o pedido e repetição com ID/conteúdo
exatos. Rascunho inválido permaneceu intacto. Também perdeu a confirmação da
limpeza depois de ela ser gravada e reabriu sem repetir o commit. Os controles
respeitaram leitura/edição após a limpeza. Uma chamada sintética ao listener de
um botão DOM antigo foi recusada após trocar de seleção, sem alterar o outro
projeto; isso exercita o vínculo da tela, sem executar código do jogo. As
capturas foram inspecionadas.

O serviço usado tem manifesto
`3f4dfc66ce3fb104a9a49aa0abf4ec9c76252b8f1073f2bd90bed222e18cddd5`;
SDK/controller/renderer e builds de desenvolvimento são da fonte atual, registrados
separadamente. O teste Mac usa backend de arquivo real; o editor usa fixture de
Memento apoiada em arquivo. Isso **não é** Electron/Extension Host real, aceite
das instalações ou nova prova de durabilidade do backend nativo do editor.
Nenhuma IA, instalação, publicação ou migração pessoal foi executada.
Relatório consolidado: `output/game-generation/studio-restore-recovery-20261113-a1/report.json`.

As falhas intermediárias de qualificação permanecem preservadas. Em
`2026-11-13T05-03-23-095Z-4fcf05f9`, uma asserção exigiu habilitar controles
mesmo com o host em leitura; a expectativa foi corrigida, mantendo a restrição.
Em `2026-11-13T05-07-28-666Z-4742fa91`, o novo passo tentava usar a página após
fechar seu contexto; o runner agora abre a próxima página. Não foram atribuídas
essas falhas ao provedor, nem repetidas operações de resultado incerto. Os
ensaios anteriores passaram somente os checks que continham; não retroagem os
checks acrescentados no ensaio final.

Verificações da fonte final:668 testes aprovados, um opt-in ignorado,31
verificações do repositório, check/builds Mac e extensão e roteamento local
somente leitura. As cópias HTML/JS dos dois builds correspondem à fonte
qualificada. Isso não constitui publicação nem aceite nativo/instalado.
