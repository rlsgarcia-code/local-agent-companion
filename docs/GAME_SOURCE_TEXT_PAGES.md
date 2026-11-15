# Leitura dirigida de código dos jogos

Fonte e pacote de desenvolvimento em **2026-11-13**, sem instalação/release.
Parte de GD-01/GD-02/GD-08 no [plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md).
Leia a [arquitetura](SUITE_ARCHITECTURE.md), a
[integração no agente](GAME_AGENT_PRODUCTION.md) e as
[edições literais](GAME_FILE_EDITS.md).

## Problema e uso

`game_edit_file` aceita fontes UTF-8 de até 8 MiB, mas a leitura legada de
`game_read_file` só devolve conteúdo completo até 256 KiB. Além disso, corrigir
uma função não exige sempre reenviar todo o arquivo ao modelo. A opção
`textPage` acrescenta leitura de trechos do arquivo salvo, com identidade exata;
não substitui o arquivo por um resumo ou uma versão truncada.

O catálogo instalado oferece a opção ao supervisor e aos especialistas de
leitura dos clientes comuns. Não há novo método RPC para executar ferramentas,
loop de inteligência ou operação de filesystem. Mac e VS Code continuam clientes
do serviço. A capacidade é `game-source-text-pages-v1`; o KidOS não a anuncia nem
recebe essa porta workspace. Seu Core/adaptador continua responsável por acesso
e políticas protegidos.

Percurso:

1. Consultar `game_project` e obter a revisão, o caminho e **`file.sha256`**.
2. Pedir a página necessária por `game_read_file`:

```json
{
  "projectId": "id-retornado-pelo-servico",
  "path": "src/gameplay.ts",
  "textPage": {
    "revision": 12,
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "cursor": 0,
    "limit": 8192
  }
}
```

O hash ilustrativo precisa ser substituído pelo hash real do arquivo. O hash do
projeto não serve como hash do arquivo. `revision` e `sha256` são obrigatórios
na opção; `cursor` assume 0 e `limit` assume 8192 quando omitidos.

3. Conferir a resposta `kind: "text-source-page"`, com `projectId`, `revision`,
   `sourceHash`, referência completa `file`, `encoding: "utf-8"`, `content`,
   `offset`, `cursor`, `hasMore` e `totalBytes`.
4. Para continuar, usar o **cursor em bytes retornado**, com a mesma revisão e
   hash. Não interpretar o cursor como número de linha ou de caracteres.
5. Ler o contexto necessário e usar as edições literais existentes. Uma página
   não é o arquivo inteiro; não substituir o arquivo por ela. Uma edição contra
   revisão/hash antigos continua sendo conflito e exige reconciliação.

Se a revisão externa legada também for fornecida, precisa coincidir com
`textPage.revision`. O serviço recusa divergências antes de ler o blob. Outra
edição pode criar uma revisão nova enquanto as páginas antigas continuam
referindo os mesmos bytes históricos. Isso não concede autorização para editar
a revisão nova usando o hash antigo.

## Limites e integridade

Até **8 MiB por fonte**, páginas de **256 a 16.384 bytes**, no namespace e projeto
autenticados. Cada leitura verifica o hash esperado contra a referência da
revisão e confere tamanho/SHA-256 dos bytes do blob antes de decodificar.
Cursor fora do arquivo ou dentro de uma sequência UTF-8 é recusado. O final de
uma página retrocede até uma fronteira UTF-8 válida; por isso o avanço pode ser
menor que `limit`. Cursor no fim retorna página vazia e `hasMore:false`.

BOM, CRLF, acentos e caracteres fora do BMP permanecem nos bytes. Não há
normalização, parsing de código, execução ou interpretação de instruções dentro
do arquivo. UTF-8 inválido ou NUL não vira base64 silenciosamente neste modo;
gera diagnóstico limitado, sem repetir conteúdo privado no erro. Fontes maiores
retornam referência e `kind:"sdk-download-required"` antes de ler seus bytes.
Os originais continuam disponíveis pela transferência autenticada existente.

Omitir `textPage` conserva o comportamento anterior, inclusive seus formatos de
texto/base64 e encaminhamento de arquivos grandes ao SDK. Serviços antigos não
aceitam a opção; a ausência da capacidade não autoriza truncar, abrir o host ou
escolher outra ferramenta silenciosamente. Não há migração ou alteração de
recibos, arquivos, revisões, políticas, aprovações ou limite de inferência.

## Organização

| Componente | Responsabilidade |
|---|---|
| `packages/contracts/src/game-source-views.ts` | Opção tipada, limites e tipo da resposta |
| `packages/contracts/src/game-agent.ts` | Schema/descrição do catálogo existente |
| `packages/game-production/src/text-pages.ts` | Paginação UTF-8 pura, compartilhada com evidências textuais |
| `packages/game-production/src/source-views.ts` | Integridade e limites do texto de fonte |
| `packages/agent-service/src/game-agent-tools.ts` | Namespace, revisão, hash, acesso ao blob e resultado |
| `packages/game-design/production.json` | Orientação de leitura dirigida para os perfis comuns |

O serviço grava o recibo normal de leitura pela identidade original do grafo.
Ler não cria revisão, diff, build, relatório, execução de teste ou qualidade.
Nenhuma função de paginação importa LangChain ou uma interface; as interfaces
não executam esse processamento como inteligência própria.

## Verificação e pendências

O [dossiê](../output/game-generation/source-text-pages-20261113-a1/report.json)
vincula fontes, logs e pacote
`cbcdd2ccd31380e3969487313c4257c0fdd9812fa96787cad7738b0ef094fbb3`.

- 767 testes passaram, um opt-in ignorado e mais 40 verificações de repositório.
  Tipos, builds da extensão/Mac/motor e roteamento simulado passaram.
- Testes reconstruíram uma fonte maior que o limite legado, preservando todos
  os bytes, enquanto outra revisão já existia. Exercitaram o limite de 8 MiB,
  hashes/bytes corrompidos, cursores incompatíveis, binários e recusa por outro
  perfil. Os grafos oficiais Standard/Deep invocaram o catálogo com o modelo
  simulado oficial, em registros Mac/editor, inclusive no modo Plano.
- O pacote independente executou Node 22.23.4, SDK/TLS/IPC/serviço e grafos reais,
  com SSE simulado local. Quatro namespaces receberam arquivos de 450.003 bytes;
  oito runs leram páginas de no máximo 257 bytes, antes e depois de editar/reiniciar.
  Os projetos sintéticos permaneceram na revisão 2 e as páginas apontaram para a 1.
  Dezesseis pedidos simulados, zero confirmações, processos 5163/5165 exit0,
  estado privado removido. Nenhum provedor real ou instalação foi usado.
- A regressão anterior foi recusada por campos de paginação desconhecidos. Um
  teste posterior conservado falhou porque a fixture declarava MIME diferente
  do blob; a fixture foi corrigida, mantendo a verificação de mídia do produto.

Isso demonstra entrega menor de **conteúdo de arquivo por leitura**, não redução
medida de tokens, custo ou tempo de uma produção real. Catálogo, guia e outras
partes do contexto continuam tendo custo. Não comprova escolha eficaz de trechos
pelo modelo, jogos concluídos, UI instalada, composição KidOS, humanos ou matriz
física. A continuação Luna anterior não foi retomada nem recebeu outro bloco.
