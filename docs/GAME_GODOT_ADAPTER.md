# Adaptador Godot: builds web isolados

Fonte de desenvolvimento, **sem release ou instalação nos clientes**. Integra o
[plano completo](GAME_DESIGN_IMPLEMENTATION_PLAN.md), a
[produção comum](GAME_PRODUCTION_API.md) e a
[arquitetura da suíte](SUITE_ARCHITECTURE.md). Este documento não reduz o aceite
de Unity, dos assets, das interfaces, do KidOS ou do portfólio.

## Responsabilidade e configuração

`packages/adapter-game-godot` fornece `godot-web-isolated-v1`, registrado pelo
processo do serviço. Ele atende Mac/VS Code; **não concede Docker ao Navi**.
Game Design prepara conhecimento e design; Agent Core mantém o grafo oficial;
Agent Service mantém projeto, revisão, jobs e recibos. Não há outro agente.

O projeto permanece nativo e editável: `project.godot`, cenas `.tscn`, recursos,
GDScript e assets. Acrescentar:

```json
{"schemaVersion":1,"engineVersion":"4.7.2"}
```

em `game.godot.json`. Definir a cena principal e o renderizador Compatibility
(`gl_compatibility`) em `project.godot`. O exportador controla o preset Web,
single-thread, sem PWA ou shell HTML personalizado. C# e extensões nativas não
pertencem a esse caminho web. Caches `.godot` não são arquivos de origem.

O catálogo de capacidades inclui `projectGuide`, fornecido pelo adaptador
instalado. A interface/modelo não pode registrar outro editor, comando ou imagem.
Receitas declarativas em `data/playtests.json` ou `data/playtests/*.json` integram
o build e usam o [coletor de navegador](GAME_BROWSER_OBSERVATIONS.md).

## Ferramenta provisionada explicitamente

`toolchain.lock.json` fixa Godot **4.7.2-stable**, os arquivos oficiais por
arquitetura, templates web, runtime JavaScript/WASM, módulos de áudio, licenças e
imagem-base por digest. O provisionador confere os arquivos antes de extrair
somente as entradas fixadas. Não extrai um arquivo ZIP inteiro sobre o sistema.

O comando administrativo de desenvolvimento é:

```sh
npm run toolchain:godot -- --inputs /diretorio/com/insumos/verificados --output /estado/do/motor/toolchains/godot.json
```

Os insumos são o ZIP do editor Linux correspondente à arquitetura, o TPZ de
templates e `GODOT-LICENSE.txt`/`GODOT-COPYRIGHT.txt`. As URLs exatas dos arquivos
de release seguem o nome fixado no lock, sob
`https://github.com/godotengine/godot/releases/download/4.7.2-stable/`; os avisos
vêm da mesma tag em `raw.githubusercontent.com/godotengine/godot`. O download é
uma preparação administrativa separada; o serviço não o realiza.

O provisionador exige Docker local com a imagem-base exata já disponível e
`/usr/bin/unzip`. Monta a imagem **sem rede**, verifica a versão e grava um registro
privado com ID imutável, arquitetura, hash da receita e hash do driver. Para os
ensaios locais, o destino padrão fica em `.cache/game-toolchains/godot.json`.
Esse registro não é uma publicação assinada nem uma instalação de produto.

O motor verifica o registro, o driver empacotado e a identidade da imagem. Usa
somente transporte Docker local Unix/named pipe; endpoints remotos são
rejeitados. Não baixa imagens ou editores, troca versão ou instala licenças por
inferência. Ausência ou alteração exige reparação explícita e reinício do motor.
O pacote básico contém apenas driver/lock cobertos pelo manifesto, sem embutir
os grandes editores/templates. A distribuição assinada dessa ferramenta opcional
continua pendente.

## Isolamento e limites

Cada build recebe somente arquivos da revisão fixada, verificados pelo serviço.
O diretório de fonte é um único bind mount **somente leitura**. Nenhum home,
credencial, socket Docker, perfil do navegador ou diretório de trabalho pessoal
é montado no contêiner.

O processo usa usuário sem privilégios, raiz somente leitura, rede desligada,
capabilities removidas e `no-new-privileges`. Limites atuais por build: 3 GiB de
memória sem swap adicional, duas CPUs, 256 PIDs, 768 MiB de tmpfs de trabalho e
128 MiB temporários. Fontes: até 256 MiB; artefato: até 256 MiB. Exceder um limite
gera diagnóstico, preserva a revisão e não reduz silenciosamente o projeto.

Scripts `@tool`/plugins de importação são código executável: rodam **dentro** dessa
barreira. Não são tornados seguros por um prompt. A fonte não recebe um shell do
host; os executáveis internos continuam limitados ao contêiner descartável.

Importação e exportação usam entradas fixas do Godot. Depois da confirmação do
editor, o driver transmite uma cópia dos arquivos temporários; nenhuma pasta de
saída gravável é montada no Mac. O leitor de TAR confere limites, checksum,
caminhos portáveis e duplicatas; rejeita links, dispositivos e overrides de
tamanho. A saída só é aceita após conferir runtime WASM/JavaScript e licenças
contra o lock. Scripts inline do shell oficial são externalizados, e o HTML
exportado inclui política de conteúdo que restringe recursos à própria origem,
inclusive fora do coletor. Isso não substitui o jogador/broker protegido KidOS.

O contêiner é removido e sua ausência conferida antes de responder sucesso ou
cancelamento. A imagem e o recibo vinculam job, origem e toolchain; uma operação
nunca remove um contêiner de identidade diferente.

## Interrupção, retomada e limpeza

O serviço só publica blobs e metadados em sua transação existente. Há um recibo
privado fora do mount para reconhecer um candidato que terminou antes da queda
do serviço. A reconciliação confere identidade/hash, encerra eventual contêiner
órfão e recupera apenas esse candidato. Sem recibo reconhecido, informa ausência
e exige um novo pedido explícito; nunca repete a importação/exportação sozinho.

Se o encerramento do contêiner não puder ser confirmado, o adaptador lança
`GameProductionUncertain`. Mesmo com cancelamento solicitado, o estado permanece
`awaiting_reconciliation`, e a atualização segura do motor continua impedida.

Após um resultado terminal confirmado no serviço, `dispose` pode remover fontes
temporárias/candidatos desse job. Não remove revisões, blobs publicados ou
recibos do serviço. Falha nessa limpeza conserva o cache; não desfaz o resultado
nem repete efeitos. Insumos/imagens administrativas têm ciclo de manutenção
próprio, fora da remoção de um job.

## Verificação e maturidade

`npm run smoke:game-godot` usa o Node/serviço empacotados, SDK e IPC autenticado,
com estado temporário e o registro de desenvolvimento explícito. Cria e exporta
projetos nativos 2D/3D, observa teclado e pixels no Chromium, edita uma revisão,
reinicia o serviço, verifica idempotência e exercita cancelamento/queda e
reconciliação do editor original. Os relatórios ficam em
`output/playwright/godot-builds`, vinculados à origem, build e toolchains.

Qualificação atual limitada ao Mac ARM64 com Docker Linux ARM64 e Chromium.
Outros hosts, edição visual no editor, processamento amplo de assets, áudio
físico, performance móvel, superfícies Mac/VS Code, broker KidOS e distribuição
ainda exigem suas próprias provas. As cenas de teste são fixtures, **não os jogos
completos de referência**. Consulte o
[acompanhamento](GAME_DESIGN_IMPLEMENTATION_STATUS.md) para resultados efetivamente
executados; a existência de um script não comprova que ele passou.

Referências oficiais: [exportação web](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html),
[linha de comando](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html).
