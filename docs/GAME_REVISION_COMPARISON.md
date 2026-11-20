# Comparação de revisões de jogos

Fonte em **2026-11-11**, em desenvolvimento. Parte da experiência de revisão
GD-08 do [plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md), com API comum,
SDKs e superfície Mac/VS Code. Instalação, comparação visual dos builds e aceite
integral dos jogos continuam pendentes.

Imagens e WAV registrados agora têm [comparação de mídia histórica](GAME_MEDIA_COMPARISON.md)
em fonte: versões explícitas, bytes/hash conferidos e controles de reprodução.
Isso complementa a projeção de texto; não compara cenas executadas ou certifica
arte, mixagem, audição física ou qualidade de um build.

## Responsabilidades

O [contrato](../packages/contracts/src/game-comparison.ts) define duas revisões
explícitas e páginas de diferenças. A projeção estrutural pura fica em
[`packages/game-design/src/comparison.ts`](../packages/game-design/src/comparison.ts),
ao lado da identidade do documento. Não cria modelos, agentes, permissões,
arquivos, builds, restaurações ou evidências de qualidade.

O serviço busca as duas revisões imutáveis no projeto do namespace autenticado e
calcula a página dentro de uma transação de leitura. O controller/renderer só
apresenta o resultado. A extensão, o Mac e outro consumidor provisionado podem
usar a mesma API; não é necessário abrir uma interface para realizar o cálculo.
O catálogo de ferramentas do modelo não foi ampliado por essa superfície.

## API e identidades

`games.revisions.compare`, capacidade **`game-revision-comparison-v1`**:

| Entrada | Regra |
|---|---|
| `projectId` | Projeto no produto/perfil/workspace autenticado |
| `baseRevision`, `targetRevision` | Inteiros positivos explícitos; a consulta nunca resolve “atual” silenciosamente |
| `section` | `all`, `overview`, `design`, `files`, `assets` ou `legacy` |
| `cursor`, `limit` | Offset estável e até 100 diferenças por página; 30 por padrão |

O resultado identifica origem/destino por número, hash e horário; contém totais
por área, diferenças da página, cursor e condição de continuação. Ler outro
namespace ou uma revisão inexistente é recusado. SDK TypeScript:
`compareGameRevisions`; Python leve: `compare_game_revisions`.

Commits posteriores não mudam as duas revisões escolhidas. A continuação de uma
página conserva o mesmo projeto, par de revisões e filtro. O controller confere
novamente o projeto selecionado antes de retornar; o renderer descarta respostas
de outra seleção e recusa concatenar páginas com hashes divergentes.

É uma leitura: não exige modo de edição ou aprovação para modificar o projeto.
Não grava revisão, recibo de efeito, evento, transferência ou resultado de QA.
A [restauração recuperável](GAME_STUDIO_UI.md#restauração-recuperável--fonte-de2026-11-13-utc)
continua sendo uma operação separada, com confirmação, vínculo durável e controle
de concorrência. Comparar uma versão não a torna aprovada.

## O que a comparação mostra

- **Briefing e design:** campos escalares completos, objetos/listas adicionados
  ou removidos, controles, regras, progressão, arte, áudio, save e planos de teste.
  Não há truncamento de um campo comum para caber na interface.
- **Listas com IDs:** identidade preservada entre versões; mudanças de posição
  aparecem separadas de mudanças nos campos. Listas sem IDs usam seus índices
  ordenados. Mudança de ID aparece como retirada/adição, sem inferir renomeação.
- **Arquivos:** caminho, SHA-256, tamanho e MIME, incluindo mudança de posição
  no documento. O ID local da transferência não é diferença de conteúdo.
- **Assets:** campos, origem/licença declaradas, referências e condição temporária
  ou final declarada. Uma declaração de licença continua sem verificação independente.
- **Legado:** tamanho e hash explícitos quando metadados legados mudam. O
  conteúdo original, potencialmente grande e arbitrário, continua na exportação
  integral do histórico; a projeção não o substitui por um texto truncado.

Os totais contam diferenças estruturais, incluindo posições e contêineres, e não
quantidade de arquivos alterados ou uma medida de qualidade. Arquivos continuam
com metadados na projeção estrutural. O diff textual abaixo tem contrato e
qualificação próprios; não oferece análise semântica ou comparação visual/sonora
de builds.

## Uso nas interfaces

Em **Revisões → Comparar versões**, escolha origem, destino e área. Valores são
apresentados lado a lado como texto, inclusive código/markup que exista em campos
do projeto. Arquivos do jogo não são executados ao comparar. **Carregar mais
diferenças** preserva o par original, mesmo com trabalho posterior no projeto.

O título mostra as revisões efetivamente consultadas; a legenda mantém seus
hashes e indica em qual revisão o projeto está agora. Editar as opções prepara
outra consulta e não retargeta o resultado já apresentado. Consultas em modo
Plano e em um projeto somente de leitura continuam disponíveis.

## Qualificação e limites

[`engine-game-comparison.test.ts`](../test/engine-game-comparison.test.ts) exercita
campos de 4.000 caracteres, IDs e posições, transporte sem efeito na identidade,
legado grande sem perda, páginas completas, dois SDKs por TLS/IPC, isolamento,
ausência de efeitos, novas revisões e seleção alterada durante leitura.

O ensaio de renderer/serviço empacotado
[`2026-11-11T23-28-19-654Z-d02c551b`](../output/playwright/game-comparison/runs/2026-11-11T23-28-19-654Z-d02c551b/report.json)
passou nas duas pontes emuladas, com dados sintéticos. Conferiu 123 diferenças,
consulta reversa, revisão idêntica, filtro de arquivos, seleção imutável após um
commit posterior, valores tratados como texto e layout em 1200/600 pixels.
O ensaio anterior foi preservado: a asserção verificou a legenda antes de a
atualização assíncrona responder. O runner passou a aguardar a resposta visível,
mantendo os mesmos critérios.

Essas observações não demonstram instalação, desempenho gráfico, jogadores reais,
qualidade artística ou a conclusão do plano. Ensaios nativos e a composição exata
precisam permanecer identificados separadamente.

Ensaios posteriores, com o mesmo motor de desenvolvimento de manifesto
`0ccae6a0a144e0671852f7d68f81ebd17bfb9c726ed3f1136df6f5bb9360c642`:

- [Mac/Electron real](../output/playwright/game-studio/native-mac/runs/2026-11-11T23-35-03-669Z/evidence.json):
  consultas 1→3 e 3→3, filtro de arquivos e retorno ao par original; janela,
  preload e IPC reais, com diálogos simulados apenas no harness temporário.
- [VS Code/Extension Host reais](../output/playwright/game-studio/native-vscode/runs/2026-11-11T23-36-39-232Z/evidence.json):
  consultas 1→4 e 4→4, filtro e retorno; perfil temporário, confirmações reais
  nas demais operações e encerramento verificado do editor mantendo o serviço.

Antes dessas consultas, o primeiro ensaio Mac em
`output/playwright/game-studio/native-mac/runs/2026-11-11T23-32-27-055Z/`
parou aguardando a confirmação visual de exportação do resumo de playtest. Não
chegou a comparar revisões. A tentativa instrumentada posterior passou sem
alterar código de produto ou ampliar prazos; isso não isola a causa da
intermitência. Os registros de ações agora guardam somente nome/estado/horário,
sem campos de rascunho, fonte ou credenciais; novos erros também preservam a tela
e o estado antes de fechar o harness. A falha anterior continua sendo evidência.

Passaram 612 testes de aplicação, um opcional ignorado, 31 verificações do
repositório, builds e roteamento simulado somente de leitura. Nenhum cliente
pessoal foi instalado ou atualizado. A comparação visual/sonora dos builds,
o diff por linha descrito a seguir e a intermitência de exportação continuam
fora daquele aceite histórico.

Dossiê com fontes, hashes, testes e limites:
[`revision-comparison-20261111-a1`](../output/game-generation/revision-comparison-20261111-a1/report.json).

## Conteúdo de arquivos — fonte de 2026-11-13

Em **Revisões → Comparar versões**, uma diferença de arquivo oferece
**Comparar conteúdo**. A consulta fixa o mesmo caminho e o par exibido. Mostra
linhas adicionadas/removidas, números de origem/destino, intervalos iguais
omitidos e contexto configurável (0–20 linhas). Espaços, tabs, acentos, BOM e
quebras LF/CRLF/CR/ausência de quebra final permanecem distinguíveis; não há
normalização Unicode, interpretação de markup ou execução do conteúdo.

`games.revisions.compareFile`, capacidade **`game-file-comparison-v1`**, usa o
[contrato fechado](../packages/contracts/src/game-file-comparison.ts).
SDKs: `compareGameFile` e `compare_game_file`. Entradas: `projectId`, números
explícitos `baseRevision`/`targetRevision`, `path`, `context`, `cursor`, `limit`
(1–100 linhas/intervalos). Páginas seguintes exigem o `bindingHash` original,
vinculado ao par, hashes, caminho, contexto e versão do algoritmo. Reutilizá-lo
com outra consulta é conflito. Campos de namespace ou caminhos de host não são
aceitos. O serviço consulta somente blobs autenticados, conferindo tamanho e
SHA-256 antes de decodificar os arquivos admitidos.

O [projetor puro](../packages/game-design/src/file-comparison.ts) usa
**jsdiff 9.0.0**, fixado no lock, licença **BSD-3-Clause** com texto integral no
inventário do motor. O algoritmo permanece no serviço; SDKs e interfaces não
importam esse executor nem calculam outro diff. A biblioteca oficial faz a
comparação exata dos tokens de linha, incluindo a terminação. O limite de
edições é determinístico, sem timeout que gere páginas diferentes a cada leitura.

Limites de apresentação: **512 KiB por arquivo**, **16.000 linhas no conjunto**,
**16 KiB por linha**, **512 inserções/remoções** e aproximadamente **128 KiB por
página** (linhas completas). UTF-8 inválido, controles binários ou limites excedidos
retornam `unavailable` e motivo explícito, sem diff parcial. Os bytes originais
não são truncados, normalizados ou sobrescritos. **Exportar origem/destino** usa
a seleção nativa de pasta e a exportação existente da revisão histórica exata.
Não é uma ferramenta genérica de filesystem nem grava uma restauração.

Consulta somente de leitura, disponível no modo Plano/readonly. Não cria
transferências, revisões, recibos de efeito, jobs ou QA. O controller negocia a
capacidade e reconfere a seleção após a resposta. O renderer usa texto literal,
conserva o par após commits posteriores e descarta uma resposta invalidada por
outra seleção/consulta. Recomparar contexto exige ação explícita. A restauração
continua separada, com sua confirmação e identidade durável.

Os [testes](../test/engine-game-file-comparison.test.ts) cobrem reconstrução exata
de bytes textuais, arquivos ausentes/vazios, paginação, limites, controle de
namespace, fonte corrompida, SDKs TLS/IPC e exportação histórica. O
[ensaio empacotado](../scripts/qualify-game-file-comparison.mjs) exercita os dois
bridges emulados com renderer e serviço reais; evidências datadas ficam no
[dossiê](../output/game-generation/file-comparison-20261113-a1/report.json).
Isso não é aceite nativo das instalações, comparação de builds ou qualidade de
jogos. Nenhuma chamada de IA, instalação ou publicação faz parte deste ensaio.
