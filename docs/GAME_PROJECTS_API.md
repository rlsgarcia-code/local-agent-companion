# Projetos de jogos: contratos e persistência v2

Estado: implementação em código-fonte, **não distribuída**. Esta é a base de
dados do [plano Game Design 1.0](GAME_DESIGN_IMPLEMENTATION_PLAN.md), não a entrega
dos adaptadores, produção autônoma ou aceite dos jogos.

A [API de produção](GAME_PRODUCTION_API.md) utiliza essas revisões para builds,
artefatos e relatórios; os SDKs mantêm o mesmo isolamento por produto/perfil.

## Contrato de domínio

`packages/contracts/src/games.ts` define briefing, design, arquivos, assets,
revisões e arquivo de intercâmbio. O design v2 suporta campanhas, fases, endless,
sandbox e competição sem exigir narrativa ou três fases de todo gênero.

O documento de projeto contém título, briefing, engine, design (inicialmente pode
ser nulo), arquivos e assets. Não aceita flags de aprovação, publicação ou sucesso
de testes. O tipo de multiplayer é somente local. Phaser é limitado ao caminho 2D.

Arquivos usam caminhos relativos portáveis e transferências verificadas; não há
caminhos de host, traversal, links ou execução nesse contrato de metadados.
O conjunto também rejeita arquivo usado como pasta, duplicatas sem distinção de
maiúsculas e grafias conflitantes de diretórios compartilhados. Por exemplo,
`assets` com `assets/player.png`, ou `Art/a.png` com `art/b.png`, são layouts
inválidos. `a` com `ab/c` permanece válido. Não renomear ou normalizar arquivos
automaticamente para corrigir um erro: preservar os dados e devolver o conflito.
Componentes precisam de Unicode válido e até 255 bytes UTF-8/unidades UTF-16;
emojis válidos são aceitos, mas surrogates isolados não podem virar outro nome
ao gravar/exportar. Esse refinamento pertence ao contrato v2 ainda não distribuído.
As mesmas regras se aplicam a artefatos e arquivos de evidência antes do commit.
Proveniência de assets referencia assets do mesmo projeto, sem ciclos. Declarar
uma licença/origem não constitui verificação independente de licença ou qualidade.

## Métodos Agent API

| Método | Entrada | Resultado |
|---|---|---|
| `games.projects.create` | `requestId`, `document` | Metadados do projeto, revisão 1 |
| `games.projects.list` | `cursor`, `limit` opcionais | Página de projetos do namespace |
| `games.projects.get` | `id` | Metadados do projeto |
| `games.projects.snapshot` | `id` | Transferência JSON com projeto, revisão atual e cursor consistente |
| `games.revisions.get` | `projectId`, `revision` opcional | Transferência JSON da revisão |
| `games.revisions.list` | `projectId`, `cursor`, `limit` | Página de metadados de revisões |
| `games.revisions.compare` | Projeto, duas revisões explícitas, área, cursor e limite | Comparação estrutural paginada, com hashes imutáveis; somente leitura |
| `games.revisions.commit` | `projectId`, `requestId`, `expectedRevision`, `document`, `message` | Nova revisão, com controle de concorrência |
| `games.mutations.inspect` | `projectId`, `requestId` | Projeção somente de leitura do recibo original: `missing` ou `acknowledged` com `bindingHash`, revisão e `contentHash` |
| `games.events.read` | `projectId`, `cursor`, `limit` | Eventos de criação/revisão/importação e próximo cursor |
| `games.files.get` | `projectId`, `revision` opcional, `path` | Transferência verificada do arquivo naquela revisão |
| `games.projects.export` | `id` | Transferência JSON do histórico completo de domínio |
| `games.projects.import` | `requestId`, `transferId`, `blobs` | Novo projeto importado com histórico |
| `games.design.convertLegacy` | `design` v1 | Transferência JSON com conversão v2 e design original preservado |

Pedidos grandes de criação, commit, importação e conversão podem usar
`{requestTransferId}` apontando para uma transferência JSON verificada. Os SDKs
fazem isso automaticamente acima de 512 KiB; o limite de frame permanece 8 MiB.
Documentos têm limite explícito de 32 MiB de metadados e transferências mantêm
os limites existentes. Não truncar dados para caber.

Os métodos são aditivos e anunciados pela capacidade `game-projects-v2` de
`engine.info`. Um motor publicado anterior sem essa capacidade não implementa
essas operações; o cliente deve apresentar a necessidade de atualização.

A [comparação de revisões](GAME_REVISION_COMPARISON.md) tem a capacidade adicional
`game-revision-comparison-v1`. Campos completos e metadados de arquivos/assets
ficam separados da verificação de qualidade, execução e restauração. SDKs usam
`compareGameRevisions` e `compare_game_revisions`; criar trabalho posterior não
troca silenciosamente as duas revisões selecionadas.

`games.mutations.inspect` exige a capacidade adicional
`game-mutation-inspection-v1`. Os SDKs expõem `inspectGameMutation` e
`inspect_game_mutation`, com validação fechada de campos e identidades. A consulta
não cria transferência, job, aprovação, evento ou recibo. Verifica o projeto e o
namespace autenticado antes de consultar a identidade original; o histórico
transacional continua disponível após reinício e rotação do registro.

O hash de vínculo é opaco no Python: não reproduzir a serialização JavaScript
com floats/inteiros para calcular autoridade. O consumidor deve conferir o vínculo
com o método e conteúdo originais antes de interpretar um recibo como commit.
`missing` não prova cancelamento ou ausência de efeito em andamento, nem autoriza
criar um pedido substituto. Esta rota não reconcilia ferramentas ou produção e
não recebe um resultado fornecido pelo cliente.

## Revisões, idempotência e isolamento

O namespace vem do registro autenticado, nunca dos parâmetros. Produtos, perfis
e workspaces distintos não consultam nem alteram o projeto de outro namespace.
Rotação do identificador de registro não muda a identidade de domínio.

Criação, commit e importação têm recibo idempotente transacional. Repetir o mesmo
pedido retorna a mesma resposta; reutilizar sua identidade para conteúdo diferente
é conflito. Commit exige a revisão esperada e não troca engine/dimensão
implicitamente. Cada revisão é imutável, com hash e vínculo ao hash anterior.
Metadados, revisão, referências a arquivos, evento e recibo são gravados juntos.

O hash de conteúdo inclui design, código referenciado e assets; ignora somente
IDs de transferência, que são locais ao transporte/namespace. Assim, transportar
o mesmo conteúdo não muda sua identidade. Esse hash ainda não é evidência de
build, desempenho ou playtest aprovado.

Arquivos só entram quando SHA-256, tamanho e tipo da transferência correspondem
ao documento. Referências SQLite impedem remover blobs usados pelo histórico.
Validação de formato/decodificação e execução isolada pertencem às próximas
etapas dos adaptadores; armazenar um blob não o executa nem certifica seu formato.

## Intercâmbio e legado

O arquivo JSON contém todas as revisões, sem aprovações ou execuções. Bytes dos
arquivos são transferidos separadamente, identificados por SHA-256. Na importação,
`blobs` mapeia cada hash a uma transferência **do namespace de destino**. IDs da
origem não dão acesso no destino. Todos os arquivos de todas as revisões precisam
estar disponíveis; a cadeia de hashes e revisões precisa ser completa.

Os SDKs TypeScript e Python expõem criação, listagem, snapshot, revisão, arquivos,
eventos e importação/exportação. Seus importadores recebem o arquivo de domínio
e os bytes originais por hash, verificam os hashes e transferem os blobs. Não
existe repetição de ferramentas, importação de checkpoints ou aprovação implícita.

A conversão v1 é somente leitura: preserva o design original em `legacy`, marca
`reviewRequired=true` e não inventa testes executados. Informações que não existiam
no contrato antigo ficam identificadas para revisão. A conexão desse conversor
à migração dos jogos reais KidOS ainda faz parte do trabalho pendente.

## Evidência de desenvolvimento

Os testes de domínio e serviço cobrem gêneros sem narrativa obrigatória, caminhos
portáveis, referências, conteúdo alterado, concorrência, transação interrompida,
persistência após reinício, isolamento e rejeição de flags de sucesso forjadas.
O teste de SDK usa TLS/IPC real, arquivo de 9 MiB, pedido de metadados em partes,
importação de duas revisões entre namespaces e cliente Python real em Unix.

Essas provas são do domínio e transporte. Não são aceite de geração de jogos,
GUI, engines, desempenho ou avaliação humana.
