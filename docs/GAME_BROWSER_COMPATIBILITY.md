# Compatibilidade de jogos entre navegadores

Qualificação de desenvolvimento, **2026-11-13**. Complementa o
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md), a
[entrega privada de recursos](GAME_ARTIFACT_DELIVERY.md) e o
[percurso de Lume](GAME_LUME_QUALIFICATION.md). Não substitui dispositivos físicos,
Safari/Firefox de distribuição, o jogador WebKit KidOS ou avaliação humana.

**Adição posterior de fonte:** a [permissão por hash da regra vazia](GAME_EMPTY_STYLE_POLICY.md)
produziu um artefato novo, `93be1ac1d3ff2ee8a6d56cb2764fe60fd6d4c8ebc0b746a83e7381e774ea5300`.
Esse candidato completou os doze jardins em WebKit sem erros, mantendo recusas
de CSS/script não autorizados em testes negativos separados. O resultado
parcial abaixo continua sendo o histórico do artefato anterior, sem reclassificação.
O dossiê da correção distingue builds, engine e testes físicos ainda pendentes.

## Camadas de evidência

A [medição de rede/cache frio em Lume](GAME_COLD_NETWORK_OBSERVATIONS.md)
registra transferências nativas e marcos externos no Chrome com janela. Perfil
simulado, PNG/HUD e entrada normal não certificam RTT físico, FPS ou a matriz;
cache sem hits refere-se somente aos recursos HTTP registrados do build.

O [diagnóstico gráfico com janela no Mac](GAME_BROWSER_HARDWARE_READINESS.md)
registra GPU/recursos informados pelo Chrome numa página própria. É prontidão do
ambiente, sem inferir FPS/carregamento físico de jogos ou registrar coletor.

| Ambiente | O que permite observar | O que não comprova |
|---|---|---|
| Chrome/Edge instalado e qualificado | Percurso daquele build pelo preview e coletor atuais | Outros browsers, GPU/áudio/toque físicos ou diversão |
| Firefox/WebKit de Playwright fixado | Comportamento nas engines de teste e no SO registrados | Firefox/Safari comercial, iPhone/iPad, Android ou WebKitGTK do KidOS |
| Dispositivo físico com navegador identificado | Entrada, GPU, áudio, desempenho e recursos efetivamente testados | Outros dispositivos/configurações ou aprovação humana sem playtest |
| Playtest consentido | Observações declaradas do público, por build | Certificação automática de qualidade ou generalização do motor |

Playwright usa versões próprias com patches. O WebKit de teste não é o aplicativo
Safari e o Firefox correspondente não é o executável comercial. As versões são
vinculadas à biblioteca instalada; escolher outra pasta em cache ou atualizar
automaticamente não mantém essa relação. Consulte a
[documentação oficial de navegadores](https://playwright.dev/docs/browsers).

## Percurso de exportação sem motor de IA

`scripts/qualify-lume-export.mjs` aceita `--browser=chromium|firefox|webkit`.
Ausência mantém o preview Chromium atual, sem alterar a interface do produto.
`--attempt` deve apontar para um build Lume com campanha original de doze jardins
já observada. O script confere todos os bytes contra o artefato antes da abertura;
não constrói, corrige ou reimporta o jogo para fazer o ensaio passar.

```bash
node scripts/qualify-lume-export.mjs \
  --attempt=output/playwright/lume/runs/2026-11-13T07-37-43-509Z-73b1daa7 \
  --browser=firefox
node scripts/qualify-lume-export.mjs \
  --attempt=output/playwright/lume/runs/2026-11-13T07-37-43-509Z-73b1daa7 \
  --browser=webkit
```

O helper de qualificação `scripts/game-qualification/installed-browser.mjs`
resolve somente o Firefox/WebKit instalado previsto por `playwright-core`.
Exige metadados, marcador de instalação, versão em execução e inventário completo
antes/depois; links devem terminar dentro da distribuição. Até20 mil entradas e
1 GiB de bytes, conferidos por streaming, sem conteúdo pessoal nos relatórios.
O inventário identifica bytes observados; não certifica assinatura do fornecedor
ou constitui bootstrap de release.
Não baixa, atualiza, ativa ou registra coletores/adaptadores. Seu suporte atual
de inventário é macOS; não anuncia disponibilidade nas demais plataformas.

Cada lançamento usa contexto e HOME descartáveis, sem herdar credenciais de
inferência do ambiente. Usa a fronteira existente `openGameArtifactPage` e o
mesmo listener loopback autenticado: inventário/hash por recurso, CSP,
restrições de rede/dispositivos, WebSockets, downloads e popups. Uma barreira
incompatível causa falha; não se abre um caminho de execução menos restrito.
Esse contexto do browser não substitui o isolamento Root/Core exigido no KidOS.

O observador externo mantém somente teclas/botões normais e leituras PNG/HUD.
Não acessa objetos do jogo, injeta estado, escreve save ou altera relógio/física.
As mesmas doze fases, checkpoint, desfecho/mapa após reload, pausa e viewport
390×844 são verificados. Não há Agent Service/Agent API ou chamada a modelos.

## Resultados e conservação

O Firefox146.0.1 de Playwright1.58.2, revisão1509, completou os doze jardins em
`2026-11-13T10-31-30-615Z-ba63365f`, sem resets de posição por respawn observados,
com checkpoint/mapa recuperados, pausa e viewport retrato, sem erros/bloqueios.
Inventário de96 arquivos,268.735.499 bytes, hash
`df0aa1ed19a898df3d6f0ec5dfa26f9c07511c7b867fa397361a9ba55d55c80b`.
Fechamento confirmou browser desconectado, listener fechado, HOME privado removido
e inventário inalterado. É percurso técnico headless, não aceite físico/comercial.

As repetições com captura após a transição natural do painel também passaram:

| Ensaio final | Navegador | Campanha | Sementes observadas | Erros/bloqueios |
|---|---|---|---|---|
| `2026-11-13T10-40-26-083Z-ea4ffda4` | Firefox146.0.1, Playwright1509 | 12 jardins, checkpoint/mapa restaurados | 22 de36 | Nenhum |
| `2026-11-13T10-42-31-688Z-5930f77e` | Chromium instalado157.0.8103.78 | Mesmo percurso | 23 de36 | Nenhum |

Ambos observaram pausa/retrato e encerramento do preview, sem resets de posição
por respawn nesse percurso. Não certificam todos os colecionáveis ou qualquer
outro requisito do aceite humano/físico. Fonte do jogo continua
`fc68696f319ac876a0ee8c6b29d2651306af46c04cfa20978b099c23d44c9292`;
artefato `8f9806b70d43efa620d2053c648eca6e280f5a707481fda295b4d0d5ee68f97d`.
Os treze arquivos autorais foram conferidos contra o inventário original e não
mudaram. A fonte de qualificação externa tem seus próprios snapshots/hashes.

O WebKit26.0, revisão2248, também atravessou a campanha em
`2026-11-13T10-33-41-322Z-48e5a8c4`, mas o ensaio **foi recusado** por mensagens
CSP durante as capturas. Não converter esse caso em passe ou ignorar mensagens.
O diagnóstico `2026-11-13T10-39-42-649Z-ca3f9e3e` observou zero mensagens antes
dos PNGs, uma após o primeiro e duas após o segundo. A implementação instalada
do Playwright cria um `<style>` temporário com `body {}` para sincronizar
animações no WebKit, antes de cada screenshot. Esse código é da ferramenta,
não do jogo, e encontra a política estrita do artefato. Fontes primárias:
[screenshotter1.58.2](https://github.com/microsoft/playwright/blob/v1.58.2/packages/playwright-core/src/server/screenshotter.ts)
e [WebKit1.58.2](https://github.com/microsoft/playwright/blob/v1.58.2/packages/playwright-core/src/server/webkit/wkPage.ts).
O diagnóstico evidencia essa interferência; não prova ausência de todo defeito
WebKit ou autoriza enfraquecer CSP. Política, jogo e biblioteca permanecem intactos.
Uma forma de captura compatível precisa de qualificação própria.

Esse é o registro histórico do artefato `8f9806b7…`, cuja recusa permanece.
A [correção posterior por hash da regra vazia](GAME_EMPTY_STYLE_POLICY.md) altera
somente a política dos novos HTMLs compilados e exige outro build identificado.
Não reclassifica o ensaio antigo, permite CSS genérico ou atualiza a biblioteca.

`scripts/diagnose-game-csp.mjs --attempt=<ensaio-exato> --browser=webkit` repete
somente esse diagnóstico curto: botão Jogar normal, leitura de eventos CSP e
propriedades DOM de apresentação, depois dois PNGs. Não toca na simulação,
storage, estilos ou relógio do jogo; não aprova qualidade. Conserva contagens
antes/depois, browser, hashes e fechamento. As observações não viram autoridade.

Os percursos falhos de doze jardins anteriores ficaram preservados. O observador
externo passou a distinguir melhor altura de aterrissagem, frear antes de uma
borda na descida e reconhecer a altura fixa de plataformas com movimento
horizontal dentro dos limites autorais. Não consulta a fase do movimento nem
posição interna de plataformas verticais. Os limites originais de tempo e
recomeços continuam. As capturas iniciais do Firefox foram feitas durante a
transição do painel: não são aceite de aparência final. O observador agora
aguarda a opacidade renderizada terminar naturalmente, sem desabilitar animação
ou avançar relógios.

O [dossiê desta etapa](../output/game-generation/browser-matrix-20261113-a1/report.json)
identifica as execuções, resultados, navegador/distribuição, bibliotecas, fonte,
artefato e implementação do transporte testados. Arquivos do jogo não mudam.
Ensaios falhos ficam preservados, com diagnóstico e captura quando disponíveis;
fechamento espera somente recursos próprios. Um processo vivo deve ser observado
pelo handle original, sem reinício motivado por timeout de observação.

Resultados externos não são inseridos no serviço como relatórios confiáveis nem
alteram `quality.ready`. A integração de um novo coletor de produção requer sua
própria composição, processo dono, cancelamento/recuperação e aceite. O preview
do produto continua exigindo Chrome/Edge qualificado; este helper não adiciona
uma escolha silenciosa ou uma dependência de outro computador.

Continuam obrigatórios: demais jogos e engines, Chrome/Edge e Firefox/Safari
reais, WebKitGTK KidOS, rede/latência controladas, FPS sustentado e carregamento,
dispositivos físicos, arte/áudio, dez participantes consentidos por jogo,
pedidos inéditos, distribuição, instalação e rollback. Uma campanha em browser
headless não reduz nenhum desses requisitos.
