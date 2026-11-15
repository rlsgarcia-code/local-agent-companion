# Diagnóstico gráfico do navegador no Mac

Evidência local de **2026-11-13**, preparação de GD-10 do
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md). Complementa
[observações de navegador](GAME_BROWSER_OBSERVATIONS.md) e
[compatibilidade](GAME_BROWSER_COMPATIBILITY.md). O resultado registra prontidão
informada pelo navegador; FPS, carregamento e aceite físico dos jogos continuam
pendentes.

## Fronteira e procedimento

[probe-headed-browser-hardware.mjs](../scripts/probe-headed-browser-hardware.mjs)
é um diagnóstico administrativo de desenvolvimento, sem registro como ferramenta
do agente, coletor de produção ou capacidade KidOS. O suporte inicial é somente
macOS, com Node22.23.4 e um navegador Chromium já instalado/qualificado. Não baixa
navegadores nem altera uma instalação.

O script:

1. Cria saída exclusiva e HOME temporário. A sondagem de versão e o browser
   recebem ambiente fechado, sem credenciais herdadas de modelo/publicação.
2. Confere versão e hashes do executável/framework pelo qualificador existente.
3. Abre processo próprio com janela, sandbox Chromium habilitado e perfil novo
   privado criado por Playwright. Confere nome/modo/proprietário desse perfil e
   recusa flags de headless, GPU desabilitada ou sandbox desabilitado.
4. Conecta apenas ao controle temporário em loopback do processo criado. O
   endpoint fica em memória, sem entrar nos relatórios; não é Agent API ou LAN.
5. Usa uma página `about:blank` própria, bloqueando requisições e WebSockets do
   contexto, sem permissões ou downloads. Num mundo isolado, cria um canvas
   WebGL2 com `failIfMajorPerformanceCaveat:true` e uma cor uniforme conhecida.
6. Consulta versão, GPU e estados gráficos pelo CDP; grava somente a projeção
   pública necessária, sem linha de comando ou perfil pessoal. A
   [definição do protocolo](https://chromedevtools.github.io/devtools-protocol/)
   fornece esses diagnósticos; eles não são um sensor independente de desempenho
   de jogo.
7. Encerra o processo proprietário, confirma exit0/desconexão e a remoção do
   perfil temporário. Confere novamente os componentes do browser e remove
   o HOME privado apenas no positivo.

Há deadline global de30 segundos e limites nos subprocessos. Falhas ficam em
saídas novas, sem executar outro navegador/perfil para substituí-las. O script
não recebe projeto, código de jogo, receita, ID de build, provedor ou modelo.

## Observado neste Mac

O ensaio final `probe-with-profile-closure` usou:

- Google Chrome **157.0.8103.78**, protocolo CDP1.3, macOS/ARM64.
- Dispositivo informado: **Apple M3 Max**, `ANGLE_METAL`, driver26.6.2.
- `webgl`, `gpu_compositing` e `rasterization`: `enabled`.
- Contexto WebGL2 criado, página visível e focada; nenhum identificador conhecido
  de software/virtualização na projeção retornada.
- Zero requisições da página e zero chamadas de IA.
- Processo71336 encerrado com código0, desconectado, perfil e HOME removidos.

Os dois componentes verificados antes/depois foram o executável Chrome e seu
framework. Não é inventário completo da distribuição, assinatura do fornecedor,
validação de drivers ou observação de todos os componentes do sistema.

O positivo anterior `probe` permanece associado ao observador anterior à guarda
explícita de remoção do perfil. Seu processo70931 encerrou com código0. Não se
atribui retroativamente a ele a nova asserção. O ensaio final usa o observador
atual, cujo hash está no controle e no snapshot do
[dossiê](../output/game-generation/browser-hardware-20261113-a1/report.json).

## Como interpretar e continuar

`browserReportsHardwareAcceleration:true` descreve o conjunto de informações
retornado pelo Chrome e o contexto simples criado. A captura é deliberadamente
uma cor uniforme; não é um jogo, prova de carregamento ou conteúdo renderizado
de um artefato. Nenhum relatório de `GameValidationCollector` foi criado e
`physicalGamePerformanceApproved`/`qualityApproved` continuam falsos.

O próximo percurso ainda precisa medir um **build exato de jogo** com viewport,
controles, estado inicial e cenário de referência fixados; cache frio e perfil
de20 Mb/s/100 ms; tempos e bytes externos; e evidências de frames durante jogo.
Cadência de `requestAnimationFrame`, DOM/PNG ou contadores do próprio jogo não
podem ser reclassificados como FPS físico comprovado. A interpretação do ambiente
e do workload precisa ser registrada e revisada com essas limitações.

Novas medições de projeto devem usar as barreiras existentes de recursos,
cookies, hash, CSP, rede e dispositivos do jogador/coletor. Não reutilizar a
página branca de diagnóstico como jogador menos restrito, relaxar navegação ou
inserir relatórios físicos por uma RPC. O supervisor durável/ABI4 permanece
obrigatório para coletores de produção; este CLI não o substitui.

O plano continua exigindo60 fps desktop,30 fps mobile, primeiro estado jogável
em até10 segundos no perfil definido e matriz física Mac/Alien/Android/iOS,
além de áudio, toque, controles e pessoas reais. Nada neste diagnóstico completa
esses critérios, instala clientes ou habilita Navi v2.
