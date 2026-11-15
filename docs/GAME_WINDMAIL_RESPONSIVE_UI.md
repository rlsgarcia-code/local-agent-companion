# Correio: HUD e controles responsivos

Fonte de desenvolvimento de **2026-11-13**, sem instalação/publicação. Integração
manual no mesmo projeto, numa cópia privada da revisão52. O Luna51 original e o
[build52 observado](GAME_WINDMAIL_CAMPAIGN_OBSERVATIONS.md) permanecem intactos.
Não é geração autônoma, novo pedido inédito, aceite físico ou jogo aprovado.

Continuação separada: [revisão54, rótulos e campanha](GAME_WINDMAIL_LABEL_VISIBILITY.md).
Os resultados e falhas53 abaixo permanecem históricos daquele artefato; não são
reclassificados pela construção/qualificação posterior.

## Alteração entregue em fonte

[Implementação](../examples/game-integrations/windmail-responsive/README.md):
o mapa continua1024×768 e inteiro, com FIT no próprio elemento pai. HUD, nomes dos
portos, controles e diálogos de pausa/desfecho passam a DOM do jogo, com tamanhos
em pixels CSS. Retrato usa comandos abaixo do mapa; paisagem baixa usa coluna
lateral. Há safe areas, foco visível, teclado, reduced-motion e áreas de48px.

Toque oferece esquerda/direita, acelerar, ré e vela, equivalentes às entradas
existentes. Um ledger local distingue contatos/teclas: soltar um não cancela outro.
Pointer, Mouse e Touch compartilham esse ledger sem duplicar eventos compatíveis;
não há seleção por nome de browser. Cancelamento, perda de captura/foco, pausa e
diálogo liberam comandos. Pausa por perda de foco exige continuar explicitamente.

`ResizeObserver` detecta mudanças no espaço do mapa, inclusive quando o texto
quebra linha. O callback consulta os limites do pai e atualiza o Scale Manager;
não muda coordenadas ou tamanho-base do mundo. A API documenta
[FIT e parent sizing](https://docs.phaser.io/api-documentation/class/scale-scalemanager)
e [reset das teclas](https://docs.phaser.io/api-documentation/class/input-keyboard-key).
Documentação consultada4.1; runtime efetivamente fixado/testado4.2.1.

`windmail-responsive-patch.mjs` exige os hashes exatos de main/UI/world52. Compara
o trecho completo de simulação antes/depois, normalizando somente o OR da entrada
de ré por toque. Fórmulas, mapa, assets e esquema2/coordenador de save permanecem
iguais. Nova revisão53 existe apenas em cópias privadas. Não reescrever um save,
trocar física ou simplificar desafios para fazer o observador passar.

## Guia comum, não outro motor

O perfil0.2 em `packages/game-design/production.json` passa a orientar separação
entre escala do mundo/interface,48×48px CSS, texto principal/ações de14px, retrato/
paisagem, contatos simultâneos e cancelamento. É conhecimento neutro fornecido
pelo Agent Core aos sete especialistas, sem ferramentas/autoridade novas.

O [pacote de desenvolvimento](../output/game-generation/windmail-responsive-20261113-a4/engine-guide-verification.json)
foi construído numa pasta nova e verificado. Seu adapter-kit retorna o guia igual
ao JSON-fonte e o inclui nos sete perfis de leitura. Não houve inferência para
validar a nova orientação nem atualização das instalações. O jogo foi compilado
pelo pacote anterior imutável `d9f826dd…`; distinguir as duas identidades.

## Evidências nativas e limites

[Dossiê](../output/game-generation/windmail-responsive-20261113-a4/qualification.json):
artefato final `97df428421e5e52cd9c3598bb3aaec1f48d1b114f198c435583b4180634ee518`,
fonte `0dc538fbf892c5113da868d2519dadfa0b98553e3e058205ff66b7c11799131d`.

- Chrome e Firefox/WebKit Playwright existentes:390×844,320×568,844×390 e1024×768.
  O observador mede caixas/fontes reais, verifica48×48/14px, ausência de sobreposição,
  limites da tela, canvas único e proporção4:3. PNGs são revisados separadamente.
- Chrome: dois contatos nativos emulados, soltar direção mantendo aceleração,
  cancelar e pausar durante contato. Firefox/WebKit: captura de mouse e soltura
  fora do botão, teclado e taps. Multitouch não foi exercitado nesses dois.
- Os três: uma entrega real,260pontos, pausa/save, reload, recuperação de pontos/
  mute e cancelamento de nova viagem. WebKit usou mais200ms de seta para concluir
  a aproximação vista no PNG; o caso anterior0/5 continua falho.
- Firefox/WebKit conservam os inventários e encerram seus recursos/HOME privados.
  Wrappers confirmam fechamento da página; não registram exit code dos browsers.
  Algumas tentativas falhas anteriores guardam somente o hash do encerramento,
  sem o inventário completo. Não reconstruir retroativamente esses dados.

Tentativas preservadas: primeiro CDP nomeou o contato errado; depois, leitura
imediata de estado, ajuste de geometria, caminho de mouse sem Pointer e pausa
nativa por perda de foco foram investigados. Diagnóstico capturou somente eventos
de apresentação, sem objetos de engine/storage ou interferir nos eventos. A
suspeita inicial de ativação errada por foco não se confirmou: Chrome passou com
confirmação do evento, e WebKit exibiu pausa após Tab, retomada explicitamente.
Logs e código sugerem perda de foco; não é prova geral do comportamento do Safari.
Não transformar hipótese em causa geral ou reclassificar esses resultados.

**Campanha nova ainda pendente:** o observador manual chegou a4/5 e sete colisões,
mas atingiu15min; seu browser40533 terminou por SIGKILL do próprio deadline. O
replay de22 entradas previamente concluídas no build52 chegou a3/5; browser42459
encerrou0, observador falhou. Nenhum prazo foi ampliado ou resultado trocado.
O desfecho DOM53 está implementado, mas não foi alcançado nesses dois percursos.
As campanhas52 concluídas em três engines não comprovam o novo artefato.

## Diagnóstico visual de direção

O [observador externo](../scripts/diagnose-windmail-heading.mjs) mediu o mesmo
artefato53, sem serviço/modelo, edição, objetos do jogo ou escrita de save pelo
observador. Um contexto novo recebeu dois pulsos normais de acelerar, de600ms,
com pausa explícita entre eles. A análise usa somente o retângulo DOM do canvas
e pixels de casco marrom/bandeira dourada nos PNGs compostos.

No [resultado](../output/playwright/windmail-heading-20261113-a2/report.json),
o centro dos pixels do casco avançou116,78px a−31,52°. O vetor do casco à bandeira
ficou a3,17° desse deslocamento; o eixo principal dos pixels do casco ficou
a81,75°. A fonte do SVG confirma uma vista lateral com vela/bandeira acima do
casco. O código gira essa imagem para que o topo acompanhe a direção matemática.
Assim, existe uma ambiguidade de representação: a bandeira indica o deslocamento,
enquanto o casco aparenta mover-se de lado. Isso **não demonstra inversão dos
comandos**, posição exata da proa ou causa das duas campanhas incompletas.
O centro da máscara de cor também não é a coordenada interna do barco.

Os PNGs antes/depois foram conferidos e mostram a primeira entrega real1/5,
260pontos, sem colisão. Não é campanha completa, playtest ou aprovação da arte.
Uma próxima revisão artística deve tornar a proa/direção legível na perspectiva
do mapa; não alterar física, tolerância do porto ou pontuação para aprovar QA.
O barco continua marcado como placeholder. A primeira tentativa falhou ao iniciar
Chrome; sua falha foi preservada e o PID/perfil específico não estava mais ativo
antes da repetição. A segunda encerrou o browser47812 com código0, desconectou e
removeu o HOME descartável. [Dossiê e hashes](../output/game-generation/windmail-heading-20261113-a1/report.json).

## Fonte editável e conservação

O [export oficial pelo SDK](../output/game-generation/windmail-responsive-20261113-a4/editable-export/report.json)
preserva53 revisões,67 blobs/247352bytes e53 arquivos atuais, com hashes conferidos.
`archive.json`/`blobs` permitem importação pelo contrato compatível; `source/` contém
os arquivos editáveis. Exportar não executou o package.json do projeto nem
certifica seu fluxo npm: a construção verificada usa `game.web.json` e runtime
fixado do adaptador. Não houve reimportação deste novo arquivo nesta etapa.

Serviços da construção/exportação encerraram0. Antes/depois, hashes das três
tabelas de inferência permaneceram iguais; credencial de teste sem provedores.
Não exportar bancos, checkpoints, credenciais ou chaves TLS das cópias privadas.

779 testes, um opt-in ignorado,40 verificações, tipos/build e roteamento simulado
passaram. Tamanho de botão/emulação não comprova hardware, áudio, FPS, conforto
ou diversão. Arte placeholder, desfecho53, pessoas, Unity, composição Root/Navi,
instalação e distribuição integral seguem pendentes no plano completo.
