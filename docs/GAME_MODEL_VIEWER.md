# Inspeção 3D de candidatos no Game Studio

Implementação em fonte, conferida em **2026-11-13 UTC**. Parte de
[assets](GAME_ASSET_PIPELINE.md) e [Game Studio](GAME_STUDIO_UI.md), sem concluir
o [plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md), instalação ou aceite dos jogos.

## Uso e responsabilidade

Em **Assets → Revisar candidato**, **Inspecionar modelo 3D** abre o GLB selecionado
em um visor separado, após confirmação do host. Permite girar/ampliar, reenquadrar,
consultar dimensões/malhas e escolher, reproduzir, pausar ou reiniciar animações.
A seleção de um clip não o reproduz. Perda de visibilidade pausa a animação;
voltar à janela não a retoma. Não há rotação automática, áudio ou gravação no projeto.

### Navegação da animação

A linha **Posição da animação** permite buscar uma pose pelo controle deslizante
ou teclado, além dos botões **Quadro anterior** e **Próximo quadro**. Buscar ou
avançar pausa a reprodução e mantém a pose escolhida; não inicia movimento.
**Voltar ao início** retorna à primeira pose do clip e permanece pausado.
Escolher outro clip prepara sua primeira pose, também sem reprodução automática.

O intervalo é o do grupo de animação carregado, inclusive seu início, não um
valor de duração presumido. Os botões avançam uma unidade de quadro do runtime
de inspeção e param nos limites. Esses quadros podem ter outra taxa que a fonte
original do editor. A posição e duração em segundos só aparecem quando todas
as trilhas do grupo usam uma mesma taxa finita positiva; o visor não inventa
uma taxa para grupos mistos. Em reprodução, a posição acompanha os quadros reais
do grupo; pausada, permanece estável.

Sem clip selecionado, ou em um modelo sem animação, os controles de movimento
ficam desabilitados. Um clip de duração zero não oferece busca. Os controles
mantêm rótulos de teclado/leitor de tela e o valor não é anunciado continuamente
por uma região viva a cada quadro. A linha se reorganiza em janelas estreitas.

Essa é uma timeline de **inspeção**, sem criação/edição de chaves, retargeting,
gravação, aplicação de assets ou qualidade concedida. A
[edição de receita](GAME_MODEL_EDITING.md) continua sendo outro percurso,
com confirmação do host, processamento isolado e candidato separado.

O visor identifica nome, revisão de origem, declaração de recurso temporário/final
e proveniência. **Aplicar ao projeto** continua sendo outra decisão, com revisão,
modo de edição e autoridade existentes. A inspeção funciona em planejamento:
não concede edição, aprovação parental, qualidade ou verificação independente
de licença. Uma textura/paleta não é apresentada como renderização do modelo.

O controlador verifica candidato concluído, projeto, job, caminho/MIME e seleção
depois da confirmação nativa. Não abre automaticamente ao revisar um candidato.
O renderer envia apenas identidade e caminho; não recebe GLB, runtime, endereço
do host, ferramentas ou credenciais. Cliente sem esse recurso informa atualização.
O visor aguarda o primeiro quadro pronto antes de devolver a abertura ao host.

## Fronteiras de implementação

| Camada | Responsabilidade |
|---|---|
| `packages/contracts/src/game-studio.ts` | Comando privado `preview-model`, sem registro ou permissão da Agent API |
| `packages/client-ts/src/game-studio.ts` | Vínculo ao candidato autenticado, confirmação e chamada do recurso do host |
| `packages/adapter-game-browser/src/model-preview.ts` | Inventário privado, bytes verificados e ciclo de vida do visor |
| `packages/adapter-game-browser/src/model-viewer-source.ts` | UI fixa, câmera orbital, renderização e controles de clips; sem inteligência |
| `desktop/game-studio.ts`, `src/game-studio.ts` | Janela/host, confirmação e encerramento ao fechar o Studio |
| `scripts/copy-game-model-runtime.mjs` | Empacotamento offline dos arquivos exatos Babylon/glTF2 e licenças nos dois clientes |

O recurso usa `GameStudioHost.previewModel`; não acrescenta um processo de agente,
ferramenta do modelo, job de produção, build, recibo ou relatório de QA. A projeção
privada `PinnedBrowserResources` reúne arquivos/entrada/engine para reutilizar
o transporte e isolamento do preview. Não fabrica um `GameArtifact`, identidade
de build ou transferência. As rotas de jogos continuam obtendo seus artefatos
reais do serviço. O motor headless não importa a interface do visor.

## Arquivos, runtime e limites

- GLB2 de até **64 MiB**, pertencente ao candidato concluído. Cabeçalho e JSON
  (até 8 MiB) são conferidos antes de abrir. Isso não é validação geométrica completa.
- Buffers/imagens relativos precisam existir no mesmo candidato; preservam caminhos
  e hashes. Somente buffers binários e PNG/JPEG/WebP nesse percurso. URLs externas,
  `file:`, `data:`, query/fragmento e caminhos codificados ambíguos são recusados.
- Inventário de até 256 buffers/imagens por coleção e **128 MiB** de recursos
  preservados, incluindo runtime. São limites do inventário; não uma quota rígida
  da memória/GPU do navegador.
- Babylon e loader glTF2 **9.35.0**, os mesmos bytes de
  `packages/adapter-game-web/runtime.lock.json`. Builder e abertura conferem SHA-256;
  JS, licenças e notices completos ficam em `game-model-runtime` dos clientes.
  Runtime ausente/alterado exige reparar a instalação exata; não há download.
- Decodificadores Draco/Meshopt/Basis não são buscados. Extensões correspondentes,
  áudio e interatividade ficam desativadas; se obrigatórias, o modelo é recusado
  preservando o original. Não muda o contrato independente `inspectGameGlb`, nem
  habilita plugins do projeto ou outros formatos de editor.

A [documentação oficial glTF](https://doc.babylonjs.com/features/featuresDeepDive/importers/glTF/)
descreve os decodificadores e sua configuração; o visor usa somente dependências
locais fixadas. A câmera segue os controles da
[ArcRotateCamera](https://doc.babylonjs.com/features/featuresDeepDive/cameras/camera_introduction/).
As provas abaixo usam o runtime exato, não presumem compatibilidade com versões futuras.

Cada abertura usa perfil Chromium descartável, os mesmos bloqueios de navegação,
popups, dispositivos, WebRTC e arquivos do preview de jogos. O listener privado
é loopback, exige cookie aleatório HttpOnly e só entrega a coleção verificada:
não é Agent API, proxy ou acesso genérico ao disco. Não há bridge para o Studio,
IA ou navegador pessoal. Fechamento/abort encerra visor e listener; trabalho de
produção no serviço permanece separado. O sandbox do navegador não equivale ao
broker protegido Core ou a limites de recursos do sistema operacional.

## Qualificação e limites do aceite

Três testes do visor usam candidato real do processador offline de bibliotecas:
GLB, textura relativa e 32 clips preservados. Cobrem corrupção, dependência
externa/ausente, runtime modificado, abort e fronteira de leitura. O teste de
renderização observa pixels reais; seleção não inicia movimento, reprodução
altera os quadros, pausa os conserva. Canary externo recebe zero acessos.
Outro teste do Studio cobre confirmação recusada, cliente antigo, caminho
forjado, troca de seleção durante consentimento e inspeção em planejamento,
sem nova revisão/job ou qualidade concedida.

O primeiro ensaio do novo fixture usou o campo errado da API (`expectedRevision`
em vez de `revision`); foi corrigido no fixture, sem mudar o contrato. O primeiro
ensaio visual detectou aviso de carregado antes do primeiro quadro: o produto
agora aguarda materiais e renderiza antes da confirmação. Ambos os logs falhos
permanecem. Não houve redução do critério de pixels ou alteração manual do modelo.

As duas pontes emuladas com renderer/SDK/serviço reais passaram em
`output/playwright/game-library-studio/runs/2026-11-11T20-30-32-150Z-dc9b7c53/`.
Os hosts nativos de desenvolvimento passaram em:

- Mac: `output/playwright/game-studio/native-mac/runs/2026-11-11T20-30-31-405Z/`;
  Electron/preload/IPC e reinício inteiro, com diálogos simulados só na fixture.
- VS Code: `output/playwright/game-studio/native-vscode/runs/2026-11-11T20-30-33-107Z/`;
  editor/webview/Memento e confirmações reais em perfil temporário. Recria o painel
  e confirma serviço disponível depois de terminar o processo de teste. Não prova
  reabertura do processo inteiro do editor ou instalação do VSIX.

O [ensaio posterior de reinício integral](GAME_STUDIO_UI.md#reinício-integral-do-vs-code--2026-11-11)
acrescenta recuperação de pedidos congelados e edições confirmadas ainda não
enviadas depois de relançar o Code/Extension Host. Conserva falhas iniciais de
navegação e não transforma essas provas de desenvolvimento em aceite instalado.

O ensaio anterior do VS Code terminou com erro no último `keyboard.press` de
fechamento, após as capturas intermediárias. A fixture final usa o encerramento
verificado do processo criado por ela e consulta o serviço depois; o atalho do
produto não foi alterado. Nenhum PID arbitrário foi encerrado. As três execuções
finais confirmaram saída 0 e limpeza normal dos serviços temporários.

Relatório, fontes, capturas, logs e hashes:
`output/game-generation/model-preview-20261111-a1/report.json`.

### Qualificação adicional da linha do tempo — 2026-11-13 UTC

O teste usa o personagem real do catálogo offline, com 32 clips, no Babylon/
glTF2 9.35.0 fixado e Chromium descartável. A busca por ponteiro alterou os
pixels do modelo, manteve a pose estável, avançou/recuou um quadro, respeitou
o fim e restaurou a pose inicial. O teclado do controle moveu a timeline sem
girar a câmera. Pausa interrompeu movimento/posição e remover a seleção
desabilitou a navegação. O teste adicional usa um modelo estático real do mesmo
catálogo e confere controles desabilitados e ausência de overflow horizontal
em 520 × 720. Não usa um indicador de sucesso fornecido por jogo.

Os ensaios finais preservam o candidato completo, seus arquivos originais,
licenças/proveniência, fonte do visor, lock do runtime, capturas e hashes em
`output/playwright/game-model-viewer/tests/`. O primeiro ensaio falhou ao exigir
igualdade decimal exata no limite do input: o navegador serializou
40.000001192092896 como 40.0000011920929. A comparação numérica foi corrigida
com tolerância de 1e-8; critérios de pose/pixels/pausa não foram reduzidos.
A repetição direcionada passou nos quatro testes, com a falha preservada.
A suíte final passou em 673 testes de aplicação, um opt-in ignorado e 31
verificações do repositório, com tipagem, builds Mac/extensão e roteamento local
simulado. As capturas finais identificam o item real do catálogo; a fixture
estática deixou de reutilizar o título genérico de personagem. A descrição das
evidências também foi esclarecida para não sugerir instalação do aplicativo.

Essa prova usa código de inspeção dos clientes e catálogo reais em navegador
temporário. Não demonstra o aplicativo instalado, os hosts nativos da extensão
3D mais recente, acessibilidade assistiva física, desempenho, qualidade artística
ou aceite humano. O motor empacotado previamente qualificado permanece uma
evidência distinta. Registro desta ampliação:
`output/game-generation/model-timeline-20261113-a1/report.json`.

Uma [edição numérica de receitas 3D](GAME_MODEL_EDITING.md) foi acrescentada
posteriormente ao Studio, com processamento separado e nova variante. Não altera
o visor para manipulação direta nem expõe os rigs internos de qualquer GLB.

**Pendentes:** instalações, demais plataformas/dispositivos, inspeção de formatos
adicionais, edição direta na viewport/timeline gráfica, qualidade artística, Unity/Navi e os
seis jogos/avaliações físicas e humanas do plano. Não tratar renderização ou
contagem de testes como aprovação de um jogo completo.
