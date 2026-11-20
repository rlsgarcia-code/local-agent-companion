# Diagnósticos de jogos no motor comum

Implementação de desenvolvimento em **2026-11-12**. Esta frente permite que os
grafos leiam as falhas observadas antes de orientar uma correção. Não comprova
geração autônoma de um jogo acabado, análise visual ou instalação das interfaces.
Leia a [integração do executor](GAME_AGENT_PRODUCTION.md), as
[observações do navegador](GAME_BROWSER_OBSERVATIONS.md) e o
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md).

## Contrato e autoridade

O catálogo compartilhado oferece três operações de leitura:

| Operação | Resultado |
|---|---|
| `game_reports` | Cabeçalhos dos relatórios de um build real: IDs, revisão, hashes, ambiente, coletor e contagens. Cursor por registro; até vinte por página. |
| `game_report` | Uma seção completa e paginada: checks, referências de evidence, métricas ou cobertura de conteúdo/cenários. |
| `game_read_report_file` | Trecho UTF-8 de um arquivo efetivamente vinculado àquele relatório, com cursor em bytes e referência original. |

A capacidade `game-validation-reports-v1` é anunciada nos produtos comuns. Plano
e os especialistas revisores recebem somente essas operações de leitura. O
catálogo genérico continua recusado para KidOS: esta adição não provisiona um
coletor protegido, não habilita Navi v2 e não concede autoridade parental.

O serviço consulta o namespace autenticado antes de devolver qualquer dado.
Listagem usa índice por namespace/build e limite no SQLite; o modelo não recebe
todos os relatórios para filtrá-los. O cabeçalho preserva a identidade do build
histórico. A revisão atual mudar não transforma observação antiga em aceite novo.

Páginas conservam registros completos e avançam pelo número realmente devolvido,
com orçamento de 64 KiB para os registros JSON. Um registro individual excessivo
produz diagnóstico explícito para download pelo SDK; não é cortado silenciosamente.
Arquivos textuais têm no máximo 8 MiB, páginas de 256 a 16.384 bytes, validação
UTF-8 estrita e limites entre caracteres completos. BOM e CRLF são preservados.
Um cursor dentro de um caractere é recusado. Binários, imagens e textos maiores
continuam disponíveis integralmente pela transferência autenticada, sem base64
injetado no contexto nem alegação de visão.

O [parecer visual](GAME_VISUAL_OPINIONS.md), acrescentado em 13/11, é uma operação
separada: `game_review_image` resolve somente uma PNG efetivamente registrada,
envia seus bytes privadamente ao papel `vision` explícito e devolve texto.
As três leituras acima continuam textuais. Esse parecer não é coleta nem aceite;
preserva a revisão histórica, orçamento e exclusão de KidOS.

Checks e arquivos são dados não confiáveis. Lê-los não executa seu conteúdo,
inicia produção, responde aprovações, concede orçamento ou melhora qualidade.
`runtime.json` e `trace.json` devem ser descobertos pelas referências devolvidas,
não por caminhos arbitrários do host. Após uma edição, novos build e observação
precisam corresponder à nova revisão; a falha anterior permanece no histórico.

## Verificação

`test/game-report-tools.test.ts` verifica paginação/escape JSON, Unicode, bytes,
limites, recusa de caminhos, identidade estrangeira, persistência após reinício,
histórico de uma revisão anterior e ausência de novos efeitos/qualidade. Os
grafos Standard/Deep recebem diagnósticos por ferramentas reais com modelo
simulado. A suíte direcionada passou com 27 testes; a suíte completa teve
**637 aprovados, um opt-in ignorado e 31 verificações do repositório**. TypeScript,
builds da extensão, desktop e motor e roteamento local simulado passaram.

O driver `scripts/qualify-game-report-tools.mjs` tem entradas explícitas e
mutuamente exclusivas: revisão original viva, exportação de domínio preservada
ou `--diagnostic-fixture`. Nunca reinicia uma geração ausente. O último modo é
um caso autoral deliberadamente falho, não um jogo gerado. Usa compilador e
Chromium reais, relatórios persistidos, SDK/TLS e grafos oficiais com SSE local
simulado. Receber um erro real com esse modelo não comprova que um modelo real
consegue decidir a correção. As aprovações da fixture ficam limitadas aos IDs,
revisão, build e coletor exatos; não integram o produto.

A primeira prova sobre a revisão 35 de Correio das Correntes está em
`output/game-generation/report-tools-native/2026-11-12T01-50-37-812Z-cbb9f5a5/`.
O processo original e seu diretório temporário já não existiam na conferência
de 12/11. Isso não fornece resultado terminal, recibo de inferência nem cota
disponível. Não repetir efeitos ou renovar orçamento a partir dessa ausência.

Uma nova prova tentou importar sem alterações a exportação da revisão 34:
`2026-11-12T18-09-14-833Z-df8762e1`. O build foi produzido, mas a admissão do teste
recusou `data/playtests.json`, cujo valor é um array em vez do objeto exigido.
A falha foi preservada; não se editou o jogo para transformar esse ensaio em
sucesso. O serviço próprio da fixture foi inspecionado e encerrado depois de
confirmar ausência de trabalho pendente; a prova de fechamento está no diretório.

O ensaio seguinte, `2026-11-12T18-11-22-987Z-69f959d4`, usou a fixture negativa
declarada: os dois grafos receberam o erro real de recurso ausente, quatro
chamadas simuladas por modo, replay sem nova inferência e qualidade ainda falsa.
O build tem fonte `f41af8f6de71b65e19244863508b510b6a9e7469ed506d9c05a345667bfb0056`.
O manifesto do motor é
`1559223aa114b264959714aa029f26b10f92317b4ef349c198ba82a345b89e60`.

Todos esses ensaios são desenvolvimento. Permanecem obrigatórios o ciclo com
modelo real, jogo jogável com acabamento, quatro adaptadores completos, seis
referências, testes físicos/humanos e distribuição com migração/rollback.

## Ciclo de correção controlado — 2026-11-13 UTC

O ensaio `2026-11-13T01-22-49-626Z-0925397a` passou com o mesmo manifesto de motor.
Depois das leituras em Plano/Standard e Plano/Deep, uma sequência finita de SSE
simulado conduziu o grafo Deep em modo de execução por dez chamadas: ler o erro
real e a fonte, editar pelo hash/revisão exatos, solicitar build, solicitar
validação, descobrir os novos relatórios, ler suas evidências e consultar
qualidade. O provedor simulado e as esperas do driver são uma fixture de teste,
não um coordenador de inteligência no cliente.

A edição foi aplicada no projeto da fixture, revisão 1 → 2. Duas aprovações
foram respondidas com booleano conforme o contrato, após validação estrita dos
argumentos de projeto/revisão/build/coletor. O novo build
`eca44dd5-d239-4d0b-a9e7-78ab3666217a` passou nos checks automatizados e o
diagnóstico de recurso ausente desapareceu. Os relatórios anteriores ficaram
inalterados. Replay do run não produziu novas chamadas ou jobs. A qualidade
integral permaneceu **falsa**, como exigido para esse caso artificial.

As falhas de observação e de disponibilidade anteriores continuam preservadas:
`2026-11-12T18-14-48-694Z-5acae6a9`,
`2026-11-13T01-18-35-162Z-970b4f3b` e
`2026-11-13T01-21-32-514Z-df405c1d`. Uma conferência posterior dos navegadores
instalados confirmou versão e hashes; não comprova a causa histórica da
indisponibilidade. Não foram relaxados limites de coleta/qualidade nem baixados
componentes para esse resultado. A observação de bootstrap foi separada da
execução dos testes; o ensaio atual confirmou publicação do runtime original.

O driver conserva os dados privados de ensaios falhos em um diretório exclusivo
sob `.cache/game-report-qualification-state/`, com proprietário/permissões
restritos; os ensaios aprovados encerram seu próprio serviço e removem esse
estado. Credenciais não fazem parte dos relatórios públicos. Isso evita depender
da área temporária para inspecionar uma falha posterior, sem reconstruir sessões
ou orçamento antigos. Não existe retomada automática da fixture.

O [dossiê](../output/game-generation/game-report-tools-20261113-a1/report.json)
identifica fontes, artefato congelado, testes, limites e casos falhos. Este ciclo
controlado não muda o resultado negativo de Correio das Correntes nem comprova
capacidade de um modelo real produzir a correção ou um jogo acabado.
