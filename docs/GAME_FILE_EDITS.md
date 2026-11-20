# Edição dirigida de arquivos de jogo

Fonte de desenvolvimento, **2026-11-11**, sem instalação/publicação. Parte da
[produção compartilhada](GAME_AGENT_PRODUCTION.md), preservando o
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md).

## Uso e responsabilidade

`game_edit_file` permite corrigir trechos de um arquivo existente sem pedir ao
modelo que reenvie todo o arquivo. É uma ferramenta do catálogo instalado do
Agent Service, disponível ao supervisor Mac/VS Code pelo grafo comum. Não cria
outro executor, editor de código, ferramenta de shell ou método de filesystem.
Navi mantém o adaptador protegido: não recebe essa porta genérica.

O motor declara `game-file-text-edits-v1` para os produtos autorizados. O schema
tipado pertence aos contratos; a transformação pura está em
`packages/game-production/src/text-edits.ts`; autoridade, leitura de blobs e
commit pertencem a `packages/agent-service/src/game-agent-tools.ts`.
Os SDKs continuam usando os contratos existentes de sessões/runs e projetos;
esta ferramenta não acrescenta uma rota RPC genérica para executar ferramentas.

Percurso do supervisor:

1. Consultar o projeto/revisão e ler o arquivo necessário por `game_read_file`.
2. Usar **`file.sha256`**, não o hash do projeto, como `baseSha256`.
3. Enviar `projectId`, `expectedRevision`, `path` relativo, `baseSha256` e `edits`.
4. Cada edição contém somente `{before, after}`. São substituições literais
   sequenciais: cada `before` deve ocorrer exatamente uma vez no texto produzido
   até aquele passo. Contexto inalterado pode desambiguar o trecho.
5. Conferir a revisão retornada. Uma alteração exige novo build/teste para os
   bytes novos; não transfere qualidade de um build anterior.

Não há regex, seleção implícita da primeira ocorrência, interpretação de `$&`,
normalização Unicode, mudança de quebras de linha ou execução do texto. Matches
sobrepostos também são ambíguos. `after` vazio remove o trecho; `before` vazio,
edição sem mudança e sequência cujo resultado final é idêntico são recusados.
Arquivo novo ou substituição completa deliberada continuam usando `game_write_file`.

## Vínculos, limites e recuperação

O serviço verifica sessão/namespace, projeto, revisão e hash do arquivo antes
de ler os bytes. A leitura usa o blob autenticado existente. Texto precisa ser
UTF-8 válido, sem NUL; BOM, CRLF e caracteres fora de ASCII permanecem nos bytes
não afetados. MIME, ordem dos arquivos, demais arquivos, design e declarações de
assets são preservados. Preservar declarações não certifica origem/licença.

Limites explícitos: até 32 edições; cada string até 65.536 unidades de texto;
JSON completo das edições até 256 KiB UTF-8; fonte, resultados intermediários e
resultado final até 8 MiB UTF-8. Limites não autorizam truncar arquivos. Fontes
binárias ou maiores continuam preservadas e acessíveis pela transferência SDK;
a ferramenta retorna diagnóstico. O limite de leitura para contexto do modelo
é independente. A atualização posterior acrescenta
[páginas de fonte](GAME_SOURCE_TEXT_PAGES.md) em `game_read_file`, com revisão e
hash exatos, sem alterar estas regras de edição ou o caminho de leitura legado.

Todas as edições são calculadas antes da gravação. Match ausente/ambíguo,
hash/revisão incorretos, UTF-8 inválido ou expansão excessiva não gravam parte da
alteração. Blob, referência e revisão compartilham a transação SQLite existente.
Diagnósticos indicam o índice/condição, sem repetir trechos submetidos.

A identidade persistente da invocação e os argumentos exatos continuam sendo
validados pelo recibo comum. Replay recupera a revisão histórica mesmo após
outra edição; não aplica o patch novamente. Reutilizar a identidade com outros
argumentos é conflito. Falha desconhecida continua exigindo reconciliação, sem
ser convertida em erro de texto retryable.

O efeito é **write**, com evidência de diff. Modo Plano e revisores especialistas
não ganham a ferramenta; em Revisar, ela usa a aprovação exata existente do
produto. Não amplia a apresentação do diálogo de aprovação para um editor de
diff completo, concede autoridade parental ou marca o jogo como pronto.

## Verificação

O [dossiê](../output/game-generation/game-text-edits-20261111-a1/report.json)
identifica fontes, motor, comandos e limites da qualificação.

Testes exercitam literalidade, Unicode/BOM/CRLF, deleção, múltiplos passos,
ambiguidade/sobreposição, limites em bytes, rejeição de caminho/hash inválidos,
commit atômico, conflito, arquivo binário, replay após alteração posterior e
reinício. Os grafos Standard/Deep reais também invocam o catálogo instalado com
modelo LangChain simulado, sem callback de host; isso não é geração real ou
aceite das instalações. Evidência de edição inclui o novo hash/revisão e mantém
`ready:false` enquanto os demais critérios faltarem.

A avaliação Windmail já em curso utiliza sua própria cópia congelada anterior;
alterar esta fonte não troca ferramentas ou prompts de uma execução ativa.
