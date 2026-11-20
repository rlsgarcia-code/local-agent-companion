# Recursos do build e fontes editáveis

Fonte de desenvolvimento de **2026-11-13**, parte de GD-03/GD-04/GD-05/GD-11 do
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md). Não constitui instalação,
release, aceite artístico, físico ou de carregamento.

## Responsabilidade e escolha

O compilador Phaser/Babylon pode separar os recursos do jogo distribuído dos
masters e alternativas conservados no projeto. O contrato
`gameWebProjectConfig` fica em `packages/contracts/src/game-web-compiler.ts`;
`packages/adapter-game-web/src/delivery.ts` seleciona somente arquivos declarados
na revisão. Serviço, jobs, snapshots e exportação de domínio continuam existentes.
Não há codec, inferência, ferramenta ou coordenador novo nas interfaces.

Exemplo de `game.web.json`:

```json
{
  "schemaVersion": 1,
  "entry": "src/main.ts",
  "engineVersion": "4.2.1",
  "delivery": {
    "schemaVersion": 1,
    "files": ["assets/theme.compact.m4a", "data/levels.json"]
  }
}
```

O código do jogo deve usar exatamente os caminhos escolhidos. A opção seleciona
recursos estáticos `assets/` e `data/`; imports JS/TS/CSS/JSON continuam sendo
resolvidos pelo bundler, e runtime/licenças fixados continuam obrigatórios.
`delivery.files: []` permite jogo procedural sem recursos estáticos. Omitir
`delivery` conserva o inventário/comportamento anterior, incluindo WAVs e demais
recursos. `.blend` e seus backups continuam como fonte editável, fora do build.

O [Studio compartilhado](GAME_DELIVERY_STUDIO.md) oferece esse ajuste na Visão
geral, com filtro, paginação, confirmação e recuperação do commit original. As
interfaces continuam usando as mesmas revisões/transferências/recibos do serviço.

Não há globs, caminhos do host, URLs, caminhos ausentes, colisões de caixa,
traversal ou parâmetros de codec. Uma entrada ausente reprova o build inteiro.
Não se tenta outra variante, resolução ou engine. Texturas externas de GLB,
arquivos carregados por URLs construídas no jogo, shaders e receitas de playtest
devem ser escolhidos explicitamente; não há inferência de dependências dinâmicas.
Build aprovado não demonstra que essa seleção é suficiente: executar o jogo e
validar recursos/caminhos é obrigatório.

## Proveniência, avisos e inventário

Para cada asset registrado que contenha um recurso pedido, o compilador percorre
sua ancestralidade `origin.referenceIds`. Conserva os arquivos dessas entradas
com MIME declarado `text/*` ou `application/json`, como avisos completos,
`LIBRARY.json` e receitas/relatórios. Assim, retirar um master binário não retira
silenciosamente os avisos textuais registrados em sua origem. Não restaura masters
ou texturas omitidos; dependências binárias precisam constar na lista explícita.

O build inclui `engine/COMPANION-DELIVERY.json`, com hash da fonte, caminhos
pedidos, incluídos/omitidos, tamanhos e hashes, motivos de inclusão, declarações
completas de origem e flags de placeholder dos assets pertinentes. Limite de
16 MiB para esse inventário; os limites normais de arquivos/artefato permanecem.
O documento conserva declarações, com `licenseStatus: declared-unverified`.
Ele não verifica direitos, autoria, necessidade de avisos adicionais ou qualidade.
Avisos não registrados como arquivos dos assets não são descobertos por nome:
devem ser incluídos explicitamente e conferidos na revisão de distribuição.

Nada altera os blobs, assets ou revisões do projeto. A exportação editável continua
com o conjunto completo, inclusive masters e configurações anteriores. Remover
`delivery` numa revisão posterior recupera o comportamento anterior sem apagar
trabalho posterior ou substituir os artefatos já concluídos. Isso é restauração
de domínio/configuração, não prova de rollback de uma instalação.

## Compatibilidade e autoridade

O perfil workspace tem identidade de toolchain `adapter.3`, incluindo a política
de seleção no hash; o pacote exato inclui também a implementação. A capability
`game-web-delivery-v1` é apresentada a Mac/VS Code. Disponibilidade efetiva do
adaptador ainda requer seus runtimes/compilador verificados. Engines antigas
recusam a chave desconhecida; nenhum consumidor deve apagá-la silenciosamente.

O worker Core fixo permanece no binding `adapter.1` e recusa explicitamente
`delivery`, inclusive lista vazia e pedido selado com toolchain correta. O guard
também recusa produto KidOS no adaptador workspace. Compartilhar o schema não
amplia autoridade infantil ou atualiza o broker. Integração protegida, consumo
assinado e instalação têm aceite próprio.

## Verificação

- `test/engine-game-web.test.ts`: contrato fechado/portabilidade, dois compiladores
  reais, fontes intactas, variantes explícitas, ancestralidade/avisos completos,
  seleção vazia, ausência recusada e igualdade dos bytes legados ao retirar opção.
  Os bytes AAC desse teste unitário são dados sintéticos, não prova do codec.
- `test/game-web-worker.test.ts`: pedido selado real no compilador Core recusado,
  sem resultado de sucesso. Continua preservando seu binding legado.
- `scripts/qualify-game-web-delivery.mjs --engine=<pacote-exato> --input=<ensaio-AAC>`:
  Node/serviço/SDK/TLS reais, namespaces Mac/VS Code, compilações Phaser/Babylon,
  AAC anterior real conferido pelo relatório, exportação/importação de domínio
  idempotente e restauração de configuração após trabalho posterior. Os players
  usam somente bytes exportados após encerramento do serviço, nos três browsers
  de desenvolvimento. Não é teste de interface instalada, rollback de binários,
  audição física, navegador comercial ou aprovação de jogo.

O arquivo `.m4a` pode ser menor sem o pacote inteiro ser menor; runtime fixo,
metadados e avisos continuam tendo custo. Comparações devem usar os bytes totais
dos dois artefatos exatos. Remover arquivos sem carregá-los no jogo não comprova
primeiro estado jogável em 10 segundos, desempenho ou qualidade musical.

### Ensaio observado

`2026-11-13T14-52-40-890Z-c20a4517` passou com o pacote de desenvolvimento
`ad23aaf5…` (481 arquivos, Node22.23.4/darwin-arm64). O código AAC reutilizado
veio do ensaio real anterior, conferido pelos hashes do master e da variante;
não houve nova codificação. O caso Phaser no namespace Mac passou de2.846.927
para1.416.546 bytes; Babylon no namespace VS Code passou de10.792.687 para9.362.306.
Cada fonte continha master de384044 bytes e binário não solicitado de1048576;
o inventário/avisos adicionam seu próprio custo. São fixtures, não jogos acabados
ou promessa de compressão.

Ambos preservaram o aviso completo, exportaram/importaram domínio de modo
idempotente e conservaram WAVs. Nova edição de título seguida da retirada da
opção gerou revisão4, com fontes/revisões/artefato selecionado intactos. Após
encerrar o serviço com código0, os seis previews carregaram conteúdo e AAC reais,
exigiram gesto, tocaram/pausaram/fecharam. Chromium157.0.8103.78 e browsers
Playwright Firefox146.0.1/WebKit26.0 são ambientes identificados no relatório;
FF/WebKit conservaram seus inventários exatos. Não é matriz de browsers comerciais,
áudio físico, seis jogos, clientes instalados ou rollback distribuído.

A primeira repetição positiva `2026-11-13T14-50-52-236Z-ef47d6eb` permanece
preservada; a final acrescenta identificação explícita das versões e prova de
desconexão dos processos de browser no observador. A suíte passou744 testes,
um opt-in ignorado e31 verificações de repositório, tipos, builds dos clientes e
roteamento local simulado. A tentativa inicial de suíte com IPC proibido foi
conservada; execução autorizada passou sem relaxar controles. O
[dossiê](../output/game-generation/web-delivery-20261113-a1/report.json)
vincula esses resultados às fontes e deixa todos os gates integrais pendentes.
