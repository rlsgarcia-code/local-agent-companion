# Player Unity: candidato web e ciclo de vida

Fonte em **2026-11-13 UTC**, sem engine registrada, build Unity real, instalação
ou aceite de jogo. Leia a [arquitetura](SUITE_ARCHITECTURE.md), o
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md), a
[qualificação/licença](GAME_UNITY_QUALIFICATION.md) e o
[formato/inspeção do exportador](GAME_UNITY_PROJECTS.md).

## Responsabilidades

`packages/adapter-game-unity/src/player.ts` monta um **candidato não qualificado**
a partir dos bytes já inspecionados do exportador. Chama novamente a inspeção
pura: o chamador não pode substituí-la por um objeto com `success: true`.
Não abre editor, rede, filesystem ou modelo. Não registra adapter/RPC, concede
licença, cria job/recibo ou aprova QA. `src/kit.ts` reúne as funções puras no
módulo de manutenção empacotado `unity-output-inspector.cjs`.

A integração de produção ainda precisa do broker licenciado/isolado, identidade
persistente da operação, encerramento confirmado da árvore de processos e
publicação transacional. O consumidor KidOS continua sob Core/Root; esta fonte
não habilita Navi v2, Docker, shell ou acesso genérico à conta infantil.

## Montagem e preservação

`createUnityPlayer` recebe TAR, diagnóstico, configuração Unity, identidade/título
do projeto e avisos de distribuição com bytes/tamanho/SHA-256 exatos. A identidade
não seleciona outro produto, credencial ou autoridade. O título é escapado na
página; configurações ficam em JSON externo.

O HTML original é substituído explicitamente por uma página própria. O resultado
registra hash do TAR/mapa originais e do `index.html`, além dos caminhos gerados.
O chamador deve **conservar o TAR original privado**: a função pura não grava
backup e não publica esse HTML como uma segunda página executável. Arquivos HTML
adicionais são recusados; conflitos no namespace reservado `companion-player/`
também são recusados, sem renomear/descartar originais. Os demais arquivos nativos
mantêm caminhos e bytes, incluindo recursos/StreamingAssets e símbolos opcionais.

A página usa arquivos externos de JavaScript, CSS e configuração. O texto do
player é apresentação e ciclo de vida do runtime; não contém outro executor de
IA, ponte para o host ou loop de ferramentas. O canvas recebe teclado/foco,
redimensiona com o espaço disponível e fica separado dos controles do player.
Animação de entrada respeita redução de movimento.

Os avisos são obrigatórios para preparar o candidato: 1–128 documentos UTF-8,
até4MiB cada/8MiB no conjunto, com tamanho/hash conferidos e nomes portáveis sem
colisão. O player permite consultá-los como **texto**, sem executar markup.
O conjunto final fica limitado a20.000 arquivos/256MiB. Exceder um limite é
recusa explícita, nunca truncamento de uma licença ou arquivo.

Essas verificações **não certificam origem, suficiência ou direito de distribuição
dos avisos fornecidos**. O futuro provisionador deve fixar os avisos reais da
Unity, componentes e assets no catálogo verificado. O ensaio usa um documento
claramente identificado como sintético, não uma licença Unity inventada.

## Recursos, política e ciclo de vida

A página gerada aplica CSP restrita à própria origem, scripts externos e
compilação WASM; não usa `unsafe-eval`, scripts inline, frames, workers ou endpoints
externos. O transporte privado compartilhado acrescenta `wasm-unsafe-eval`
somente para Godot/Unity, mantendo os demais bloqueios, hashes de bytes originais,
cookie efêmero e isolamento. Phaser/Babylon não recebem essa permissão.
Não muda a política do jogador KidOS nem permite acesso TCP à Agent API.

O player usa o contrato documentado da LTS:
[`createUnityInstance`, `SetFullscreen` e `Quit().then(...)`](https://docs.unity.com/en-us/engine/6000.3/manual/platform-specific/webgl/building-distribution/templates/web-templates-build-configuration).
O carregador nativo é local; somente **Jogar** inicia a instância. O botão fica
inativo durante preparação e não permite uma segunda inicialização. Progresso
é limitado a0–1; erros públicos são genéricos, sem repetir mensagens privadas
do runtime. Inicialização recusada oferece recarregar explicitamente, sem retry.

Tela cheia depende da interação e da capacidade do navegador/runtime. Encerrar
mostra espera e só informa conclusão após a Promise `Quit` resolver. Rejeição
ou resposta incompatível indica encerramento não confirmado; não inicia outra
partida automaticamente nem emite recibo do supervisor. Fechar a página faz
somente tentativa de limpeza; o host continua responsável pelo fechamento do
browser/transporte próprios. Uma Promise não comprova liberação física de memória.

Os nomes de cache do loader usam identidade estável do projeto. Isso não
reconfigura `Application.companyName`, implementa save do jogo, migra PlayerPrefs
ou prova recuperação de um build Unity real. O preset do editor mantém data
caching desligado. Arte, áudio, pausa, save e gameplay continuam sendo
responsabilidade do jogo e exigem seus testes reais.

`file://` recebe orientação explícita para abrir pelo player/servidor local.
Não baixar runtime ou dependência em tempo de jogo. Compatibilidade real da LTS
com essa CSP ainda precisa ser demonstrada: não acrescentar `unsafe-eval`, rede
ou permissões para fazer um fixture passar.

## Verificação e limites

Os [testes](../test/game-unity-player.test.ts) cobrem preservação da fonte/runtime,
transformação explícita, escaping, avisos completos e recusas, caminhos e CSP.
O [ensaio de navegador](../scripts/qualify-unity-player.mjs) usa o módulo e Node
empacotados, transporte/browser comuns e **loader/framework simulados** com um
WASM mínimo. A própria tela identifica esse cenário como teste de protocolo.
Isso não é um jogo Unity, nem prova do runtime real ou dos dispositivos físicos.

A fixture observa chamadas locais, canvas, texto literal dos avisos, viewport,
estados de início/encerramento e recusas. O serviço real/SDK/TLS verifica
separadamente que esses módulos não registram Unity nem admitem um job sem o
adaptador qualificado. Modelos, editor, Hub e licença não são usados.
Evidências, tentativas falhas e limites:
[dossiê desta etapa](../output/game-generation/unity-player-20261113-a1/report.json).

Para concluir GD-07 ainda faltam licença válida, broker/barreira completos,
importação/build/edit de jogos2D/3D reais, compatibilidade desse runtime/CSP,
recuperação/cancelamento, avisos verificados e distribuição. A corrida de
referência, quatro engines, clientes, KidOS e aceite técnico/físico/humano do
plano completo permanecem obrigatórios.

### Observação em 2026-11-13

O ensaio
[`2026-11-13T09-33-52-972Z-ad75e585`](../output/playwright/unity-player/runs/2026-11-13T09-33-52-972Z-ad75e585/report.json)
exercitou início normal, inicialização recusada e `Quit` recusado. O Node do
bundle montou os arquivos e encerrou antes da abertura do browser; nenhum
Agent Service ou modelo foi necessário durante o player. Chromium buscou o
framework, WASM e dados locais; o WASM mínimo realmente compilou e o canvas foi
observado. Licenças foram mostradas como texto literal, sem imagem/markup, em
1050×760 e viewport390×844, sem overflow. Os três browsers/transporte próprios
foram fechados.

**Qualificação parcial:** o navegador retornou `TypeError: not granted` ao pedido
de tela cheia, embora declarasse suporte. A tela agora apresenta essa recusa.
Não foi removido o sandbox, ampliada a política ou classificada essa recusa como
entrada bem-sucedida. A causa exata no ambiente nativo não foi isolada. Tela cheia
real e os demais critérios de Unity continuam pendentes.

As duas tentativas anteriores que exigiam entrada/saída positiva foram preservadas
em `2026-11-13T09-26-36-885Z-8c6294e5` e
`2026-11-13T09-28-59-258Z-09c80e2b`. A segunda capturou o retorno do browser e a
ausência de mensagem visível. O ajuste de produto acrescentou a apresentação de
`fullscreenerror`. O ensaio final verifica essa falha real e mantém a observação
positiva como **não comprovada**, em vez de certificar a funcionalidade.

O guard do motor final confirmou Mac/VS Code sem adaptador **ou coletor** Unity e
recusa de build antes de criar job:
[SDK/TLS/serviço real](../output/game-generation/unity-source-engine/2026-11-13T09-33-53-949Z-2dec85b3/report.json).
Passaram705 testes, um opt-in não executado, e31 verificações do repositório.
Esses números e o canvas simulado não são licença, importação/build Unity real,
qualidade artística, desempenho físico, instalação ou conclusão do plano.
