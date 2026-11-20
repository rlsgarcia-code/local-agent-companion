# Regra vazia permitida por hash no build web

Fonte de desenvolvimento, **2026-11-13**. Corrige a interferência de captura
identificada na [qualificação de navegadores](GAME_BROWSER_COMPATIBILITY.md),
sem filtrar mensagens, alterar o Playwright ou permitir CSS embutido em geral.
Não é atualização instalada, disponibilidade WebKit no produto ou aceite físico.

## Mudança delimitada

O compilador Phaser/Babylon gera HTML com `style-src 'self'` e somente um hash
SHA-256 adicional: o dos sete bytes UTF-8 **`body {}`**. Essa regra não contém
declarações e não muda a aparência. O Playwright1.58.2 usa esses bytes exatos
para sincronizar animações antes de capturar PNG no WebKit.

Isso é uma exceção explícita da política dos **novos artefatos**, não uma
afirmação de que a política permaneceu idêntica. Mesmo trocar um espaço produz
outro hash e continua recusado. Não há `unsafe-inline`, `unsafe-hashes`, nonce
de projeto ou permissão de script adicionados ao HTML. CSS externo empacotado,
fontes/rede/dispositivos, workers, WASM e scripts mantêm as restrições existentes.
O cabeçalho de recursos do preview, Core/jogador legado KidOS e biblioteca
instalada não mudam. Ver [CSP3: correspondência por hash](https://www.w3.org/TR/CSP/#match-element-to-source-list).

A constante é calculada no compilador, não recebida de cliente, modelo, briefing,
arquivo de configuração ou RPC. Não adicionar outros textos/hashes para fazer
um teste passar. Código de projeto continua passando pelas mesmas validações,
sem plugin ou execução no compilador. Não muda schema, autoridade ou ABI de
produção; a implementação/bundle e o HTML/artefato novos têm seus próprios hashes.

O artefato anterior permanece imutável, com sua política e resultado parcial
originais. Recompilar exige um novo job pelo serviço, sem substituir recibo,
qualidade ou versão jogável aprovada. Correção do shell não demonstra alteração
artística, gameplay novo ou uma geração autônoma pelo agente.

## Verificação técnica

`test/engine-game-web.test.ts` verifica as duas engines: hash exato único no
HTML, script ainda restrito a `self`, nenhuma permissão ampla embutida. O
compilador/engenho continua recusando imports, runtime modificado e arquivos não
fixados. O teste de string é complementado por comportamento real de navegador.

`scripts/qualify-game-empty-style.mjs --engine=<bundle-exato>` inicia somente
seu serviço temporário com Node empacotado, SDK/TLS e registro Mac de fixture.
Constrói duas fontes sintéticas, uma por adaptador, e abre cada artefato no
Firefox/WebKit de teste exatos, pela fronteira normal de recursos. Confere:

- Regra vazia exata e capturas PNG sem mensagens CSP.
- Variante `body { }`, regra com efeito visual e atributo de estilo recusados;
  a cor computada do elemento permanece a do CSS externo.
- Script embutido recusado e ausência do efeito que tentaria executar.
- Todos os erros intencionais preservados. Um mesmo script pode ser recusado
  tanto pelo cabeçalho quanto pela meta; não se remove nenhum desses registros.
- Captura posterior não acrescenta mensagens; nenhuma qualidade/revisão é
  aprovada, modelos não são chamados e todo recurso próprio é encerrado.

Não é um jogo de referência. A fixture só comprova essa política no compilador
e browsers observados. Se um build fica não terminal/indeterminado, conserva o
serviço/estado original para inspeção, sem outro build automático. Não limpar
`dist-tests` durante qualquer ensaio que o esteja usando.

O ensaio `2026-11-13T10-51-37-549Z-eba610e9` passou nas quatro combinações de
adaptador/navegador. Serviço terminou com código0; os quatro previews confirmaram
desconexão, listener fechado, HOME privado removido e distribuições inalteradas.
O [dossiê](../output/game-generation/web-empty-style-20261113-a1/report.json)
vincula fontes, pacote, capturas, testes negativos e campanha no novo build.

A campanha pelo motor empacotado em `2026-11-13T10-52-23-459Z-567e07f8` produziu
outro build e cinco relatórios técnicos pelo coletor Chromium, exportou fonte e
preservou o projeto após reinício. O preview completou os doze jardins. A prova
separada sem Agent Service no WebKit, `2026-11-13T10-54-34-615Z-ea2e9560`, também
completou a campanha, checkpoint/mapa após reload, pausa e retrato, sem erros ou
bloqueios. Capturas finais foram inspecionadas e o fechamento foi confirmado.

O hash da fonte permaneceu `fc68696f319ac876a0ee8c6b29d2651306af46c04cfa20978b099c23d44c9292`.
Somente `index.html` difere dos nove arquivos do artefato anterior: a comparação
confere a inserção exata de um hash em `style-src`, sem outra alteração no HTML.
Código, CSS, assets e bibliotecas são idênticos. O artefato novo tem hash
`93be1ac1d3ff2ee8a6d56cb2764fe60fd6d4c8ebc0b746a83e7381e774ea5300` e o manifesto
do pacote de desenvolvimento é
`862777d52ecee3656db39657fa352e7580ed7645473b79e0b864aa3c4d16acfe`.
Esses hashes não são release assinada ou instalação e não atualizam a versão
1.0.2 já instalada. `quality.ready` permanece falso.

A regressão Firefox sem serviço, `2026-11-13T10-56-25-019Z-2590d7e1`, completou
as mesmas doze fases no mesmo artefato, sem erro/bloqueio e com checkpoint/mapa,
pausa e retrato recuperados. Foram observadas22 das36 sementes nos dois browsers
de teste. O percurso Firefox teve um reset de posição por respawn; WebKit teve
zero. Esses registros não foram omitidos nem transformados em nota de qualidade.
O limite de falhas do observador permaneceu o original.

Regressão da fonte:713 testes aprovados, um opt-in ignorado e31 verificações do
repositório; check, engine:check, builds Mac/extensão e roteamento local simulado
passaram. Manifesto/verificação de todos os474 arquivos e Node22.23.4 foram
conferidos. Inventários de dependências/licenças permanecem idênticos ao pacote
de desenvolvimento anterior; não houve dependência nova, download ou inferência.

Continuam separados: Safari/Firefox de distribuição, dispositivos físicos,
WebKitGTK/Navi protegido, código nativo de Unity, generalização do agente,
arte/áudio/humanos, instalação, migração e rollback da entrega integral.
