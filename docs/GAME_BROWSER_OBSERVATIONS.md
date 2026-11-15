# Evidências de execução no navegador

Estado: **fonte e artefato de desenvolvimento; não distribuído**. Integra o
[plano completo](GAME_DESIGN_IMPLEMENTATION_PLAN.md), a
[produção](GAME_PRODUCTION_API.md) e o [executor comum](GAME_AGENT_PRODUCTION.md).
Não representa aceite dos jogos, dos quatro adaptadores ou das interfaces instaladas.

## Coletor e fronteiras

`packages/adapter-game-browser` fornece o coletor instalado
`web-browser-runtime-v1`, para os builds Phaser, Babylon.js e Godot. Ele usa Playwright
1.58.2 e um Chrome/Edge instalado, cuja identidade é conferida por versão e hash
do executável e dos componentes encontrados (incluindo o framework no Mac).
O manifesto exato do motor integra o hash de toolchain dos adaptadores e do
coletor. Mudança de implementação ou navegador não reutiliza a mesma identidade
de qualificação. Fora do artefato empacotado, a identidade é explicitamente de
desenvolvimento, sem qualificação de release.

O navegador não é baixado automaticamente. Falta ou alteração da instalação
aparece na sondagem de capacidades; reiniciar o motor é necessário para fixar
uma nova identidade. Isso não qualifica automaticamente todos os navegadores,
sistemas e dispositivos da matriz de aceite.

O coletor é registrado pelo processo do serviço, nunca pela interface/modelo.
Seu catálogo permite apenas produtos Companion. No KidOS, execução e testes
continuam dependendo de uma integração Core/broker própria; este adaptador não
concede um navegador ou ferramentas workspace ao Navi.

O [candidato fixo para o Core](GAME_BROWSER_CORE_CANDIDATE.md) reutiliza esta
coleta em uma entrada Linux de um job, com build selado e verificador KidOS em
fonte. O teste real de bytes no Mac não substitui isolamento Linux ou disponibiliza
um coletor no Navi. Seu ciclo de vida Core ainda precisa de integração própria.

Cada coleta abre um navegador descartável, com o sandbox Chromium habilitado e
contextos separados por caso. Os pedidos de recursos são respondidos apenas com
os blobs verificados daquele build. Um listener HTTP descartável em
`127.0.0.1`, porta aleatória e autorização efêmera por cookie HttpOnly atende
também os AudioWorklets, cujo carregamento não passa pela interceptação comum do
Playwright. Não oferece Agent API, proxy, escrita ou leitura de arquivos do host;
é encerrado ao final/cancelamento. O IPC do motor continua sem porta TCP/LAN.
A [entrega comprimida](GAME_ARTIFACT_DELIVERY.md) negocia gzip no mesmo listener,
conferindo os bytes originais a cada pedido e mantendo cache/CPU limitados.
A interceptação encaminha recursos permitidos ao HTTP em vez de fabricar seus
bytes; assim, WASM/JS e AudioWorklets usam a mesma verificação e representação.
Outros destinos, WebSockets, workers gerais, frames, popups, captura de dispositivos e seletores de
arquivos do host são bloqueados. Não se usa perfil pessoal, cookies existentes,
chaves de provedor, permissões herdadas ou arquivos escolhidos na sessão normal.
Isso é uma barreira do navegador para observação local, não um substituto do
isolamento do sistema exigido no KidOS.

Godot recebe permissão restrita de compilação WebAssembly (`wasm-unsafe-eval`),
sem `unsafe-eval` JavaScript ou scripts inline; seu runtime e módulos de áudio
continuam locais. A detecção de canvas observa pixels não uniformes, aceitando
também pixel art com duas cores; não certifica semântica de gameplay.
Leia a [fronteira de produção Godot](GAME_GODOT_ADAPTER.md).

O pedido `game_validate` exige a aprovação externa existente no motor. O SDK
administrativo também pode pedir a coleta de um build exato. Ao cancelar, o job
permanece em cancelamento até o navegador parar. Queda antes da confirmação exige
reconciliação; o coletor não abre outra sessão silenciosamente.

O catálogo de capacidades expõe `collectors[].projectGuide` opcional, fornecido
apenas pelo coletor instalado e limitado a 4.000 caracteres pelo serviço. Assim
como nos adaptadores de build, é referência de formato; não altera `available`,
admissão, produtos, recursos, aprovação ou qualidade. O coletor web publica a
referência comum `gameBrowserTestGuide`, junto do schema canônico de receitas:
caminhos empacotados, raiz JSON, campos de cada ação, limites, teclas balanceadas
e baseline de imagem anterior. O exemplo é somente sintaxe de interação; seu
resultado depende do jogo e uma falha continua falha. `game_studio` entrega essa
mesma informação ao grafo, sem outro tool ou executor. Coletores legados sem
guia continuam válidos; isso não ativa capacidades KidOS.

Antes de compilar/coletar, o catálogo do agente permite `game_check_tests` para
conferir a receita registrada na revisão do projeto. Usa o mesmo schema e teto
de1 MiB e verifica referências de playtests aceitas pelo runtime. É análise de
formato, sem sondar ou iniciar navegador, produzir relatório, consumir uma
admissão de coleta ou alterar arquivo. Diagnósticos são limitados; a fonte
original permanece intacta. A coleta real continua validando o arquivo empacotado
do build exato, mesmo após uma conferência bem-sucedida da fonte.

O coletor agora declara ao serviço o formato privado `browser-v1`. A conferência
canônica também ocorre **antes da autorização/admissão**, nos bytes do artefato
e no design da revisão daquele build. Receita inválida não cria job, sonda
navegador, pede consentimento ou consome reserva/etapa. O SDK administrativo
passa pela mesma admissão. Replay tem precedência; depois do consentimento o
serviço confere novamente e o worker conserva sua verificação independente.
Suíte explícita ausente é recusada; default implícito ausente permite só boot,
sem conceder cobertura. Coletores de outro formato não herdam essa exigência.

Receitas podem combinar `key-down`, espera e `key-up` para movimento contínuo
e teclas simultâneas, além de `press`. O schema exige transições balanceadas:
não libera tecla ausente, repete uma tecla já mantida, faz `press` nela ou
recarrega a página antes de soltá-la. Cada caso tem contexto próprio; o coletor
solta teclas também no fechamento após falha e depois fecha o contexto.
São entradas reais no navegador descartável por
[Keyboard.down/up do Playwright](https://playwright.dev/docs/api/class-keyboard),
sem código de projeto executado pelo coletor, atalhos globais do host ou novo
canal de controle. Teclas mantidas não concedem cobertura semântica ou aceite
físico; esses requisitos continuam separados.

## Supervisor e recuperação durável

A implementação atual usa **ABI 4**, com um auxiliar Node instalado e verificado,
`game-browser-worker.cjs`. Não há fallback para coleta no processo do motor. O
processo auxiliar executa somente uma observação: não recebe grafos, conversa,
credenciais do provedor ou ferramentas de host. A especialização e o loop do
agente continuam no Agent Core.

O auxiliar usa o Node empacotado, heap máximo de 768 MiB e ambiente explícito,
com HOME/cache/temporários próprios, sem herdar variáveis arbitrárias. O limite
de heap não é um sandbox do sistema operacional. O jogo continua dentro do
sandbox Chromium e das restrições de recursos do build. O controle usa apenas
o descritor IPC herdado do [fork do Node 22](https://github.com/nodejs/node/blob/v22.23.4/doc/api/child_process.md#child_processforkmodulepath-args-options);
não existe listener de controle TCP ou novo serviço de inteligência.

Em `game-browser-jobs/<jobId>/`, o adaptador mantém arquivos privados:

- `operation.json`: namespace, job, hashes de fonte/build, toolchain, hash do
  auxiliar e nonce. Os caminhos não vêm do código do jogo.
- `input/`, `request.json` e `prepared.json`: blobs por hash, metadados mínimos
  e fingerprint da preparação. O auxiliar só recebe permissão para iniciar
  depois de o motor persistir sua identificação em `lease.json`.
- `runtime.json`: identificação observada do navegador e endereço efêmero dos
  recursos; não contém o cookie de acesso.
- `stopped.json`: confirmação de fechamento do navegador e do transporte,
  incluindo verificação de ausência do PID principal observado.
- `receipt.json`, `result.json` e `output/`: resultado e evidências com hashes,
  separados da confirmação transacional no serviço.

Ao perder o IPC do motor ou receber cancelamento, o auxiliar interrompe a coleta
e fecha o navegador pelo handle que criou. O [contrato de fechamento do Playwright](https://playwright.dev/docs/api/class-browser#browser-close)
é complementado pela verificação do PID observado antes do checkpoint de parada.
A coleta conserva o limite de 120 segundos; o coordenador aguarda até 150 segundos
pelo auxiliar. Expirar essa espera mantém reconciliação; não reconhece término.

Uma instância nova da **mesma toolchain** inspeciona o recibo, os vínculos e a
ausência do auxiliar. Enquanto o PID existir, retorna espera; possível reutilização
de PID pode adiar a inspeção, nunca provocar encerramento de processo alheio.
A inspeção não envia sinais de término a PIDs registrados. Um candidato completo
é verificado e publicado pelo serviço sem abrir outro navegador. Uma parada
confirmada sem candidato encerra o job com diagnóstico, exigindo nova solicitação
explícita para outro teste. Nenhuma evidência vira aprovação de gameplay.

Ausência do auxiliar ou de um relatório, isoladamente, **não prova encerramento**.
Recibo incerto, identidade divergente, corrupção ou desaparecimento sem checkpoint
de parada conservam `awaiting_reconciliation` e a reserva da
[fila de produção](GAME_PRODUCTION_API.md#fila-e-recursos-de-produção). Morte
simultânea do auxiliar e do motor antes da confirmação ainda exige inspeção
adicional; não existe liberação forçada por parâmetro da interface/modelo.

O hook `dispose` remove payloads apenas após confirmação terminal no serviço,
preservando pequenos registros de vínculo e auditoria. Candidatos desconhecidos
ficam intactos. A coleta automática dos caches deixados por queda entre commit
e `dispose` ainda é uma frente própria. Os antigos reconhecimentos em memória
da ABI 3 são compatibilidade histórica, não prova aceita pela ABI 4.

O ensaio `npm run smoke:game-browser-recovery` usa o motor empacotado, Chromium
real e estado temporário. Interrompe apenas o motor que criou, verifica parada
dos PIDs observados e do listener, reinicia e reconcilia. Também força falha no
commit do relatório, reinicia e recupera o candidato exato sem repetir a coleta.
O runner só registra sucesso depois de confirmar limpeza; na falha conserva
diagnóstico. Seu bootstrap direto limpa somente o socket privado comprovadamente
morto desse teste; não demonstra instalação ou atualização do LaunchAgent.
Evidências: `output/playwright/game-browser-recovery/evidence.json`.

O percurso foi qualificado em desenvolvimento no Mac ARM64. Demais plataformas,
instalações e falhas de encerramento mais amplas continuam na matriz obrigatória.
O preview interativo da interface tem ciclo de vida próprio; não passou a usar
este supervisor e não deve ser apresentado como recuperável após morte do host.

## Receitas de teste declarativas

Incluir `data/playtests.json` no projeto, ou separar casos em arquivos sob
`data/playtests/`. Como esses arquivos integram o build, suas mudanças alteram o
hash de origem/artefato. Não são carregados plugins, comandos, código de teste
arbitrário ou URLs fornecidas como destino de navegação.

Exemplo de observação de resposta visual a uma tecla:

```json
{
  "schemaVersion": 1,
  "viewport": { "width": 640, "height": 360 },
  "scenarios": [{
    "id": "move-right",
    "steps": [
      { "action": "wait", "ms": 200 },
      { "action": "capture", "selector": "canvas", "name": "before" },
      { "action": "press", "key": "ArrowRight" },
      { "action": "wait", "ms": 100 },
      { "action": "expect-image", "selector": "canvas", "baseline": "before", "comparison": "changed", "threshold": 0.001 }
    ]
  }]
}
```

Ações: tecla, clique, toque, espera limitada, resize, reload, texto/visibilidade
observados no DOM, captura e comparação de imagem. Seletores são CSS, não JavaScript.
Imagens são capturadas pelo navegador e comparadas por pixels decodificados pelo
coletor, sem consultar um campo `ready`, FPS ou resultado fornecido pelo jogo.
Capturas de referência precisam preceder a comparação no mesmo caso.

Cada arquivo aceita até 50 casos com 30 passos por caso. Uma coleta tem limite
de 120 segundos, 100 imagens e 64 MiB de evidências. Casos maiores devem ser
separados em arquivos nomeados; falta de orçamento é uma falha explícita, sem
alterar a fonte do projeto ou declarar os testes restantes aprovados.

O campo opcional `designScenarioId` precisa apontar para um cenário de gameplay,
técnico ou acessibilidade existente. Ele identifica a intenção do caso; não
prova que uma comparação genérica verificou sua semântica. O coletor não marca
aquele cenário do design como coberto por esse vínculo isolado.

## Resultados e limites do aceite

O coletor verifica início com pixels efetivamente renderizados, erros do
navegador/console, recursos ausentes e as ações/assertivas declaradas. Registra
por caso ações executadas, resultado, tempo e imagens. Um caso aprovado em
outra suíte não apaga um caso que falhou. Nova execução do mesmo caso pode
substituir a observação anterior no mesmo build/ambiente.

Os relatórios têm escopo **automated**. Atributos de desempenho físico, diversão,
consentimento, licenças, arte final ou conteúdo completo não são deduzidos desses
resultados. Movimento de pixels pode ser animação; não prova, sozinho, que um
controle, colisão ou mecânica satisfaz o design. O coletor certifica somente os
checks que observou; os demais requisitos continuam faltantes na avaliação.

Não há leitura de telemetria de sucesso do próprio jogo. Um jogo que declara
`passed: true` e não apresenta a resposta visual esperada falha no teste. Nem
mesmo todos os casos declarativos aprovados tornam `game_quality.ready` verdadeiro
sem os outros critérios técnicos, visuais, sonoros e humanos do plano.

## API, arquivos e persistência

`games.validation.start` / `startGameValidation` / `start_game_validation` aceitam
`testSuite` (Python `test_suite`) opcional para escolher um arquivo nomeado. Esse
argumento participa da identidade idempotente do pedido. A capacidade do coletor
informa `available` e, quando necessário, o motivo da indisponibilidade.

`games.validation.reports` inclui referências de evidências por relatório.
`games.validation.file` recebe `reportId` e `path`; SDKs usam
`downloadGameReportFile` / `download_game_report_file`. As referências ficam
restritas ao namespace e recebem SHA-256 verificado. Não são caminhos do host.

Blobs, relatório, referências de arquivo e confirmação do job são gravados na
mesma transação. Falha na referência final não publica um relatório sem suas
imagens. Arquivos fixados por relatório não podem ser removidos como transferências
avulsas. O limite de armazenamento do namespace continua aplicável; não apagar
historicamente projetos ou evidências em silêncio para liberar espaço.

## Verificação reproduzível

```sh
npm run smoke:game-browser
```

O smoke constrói o motor, usa seu Node empacotado e SDK autenticado em dados
temporários, compila as fixtures 2D/3D, observa entrada e pixels e baixa as provas.
Os arquivos ficam em `output/playwright/game-builds/<engine>/observations/` e
`observations.json`, vinculados aos respectivos hashes. Essas fixtures não são
jogos completos do portfólio de aceite.

`test/engine-game-browser.test.ts` testa navegador real quando há instalação
qualificada; indisponibilidade é explicitamente registrada, sem equivaler a
aceite naquela plataforma. A regressão inclui falha de assertiva, sinal falso de
sucesso do jogo, outra origem loopback, Babylon real, casos nomeados, cancelamento
e recuperação dos bytes por SDK TypeScript/Python. A atomicidade e o isolamento
são exercitados também nos testes do serviço.

As interfaces ainda precisam apresentar e permitir revisar essas evidências,
e os coletores de qualidade semântica, visual, áudio, desempenho físico, licença
e avaliação humana continuam previstos no plano integral.
