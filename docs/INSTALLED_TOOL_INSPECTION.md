# Operações do adaptador instalado: identidade e conferência

Estado em 2026-11-10: **fonte de desenvolvimento; sem atualização instalada**.
Leia a [arquitetura da suíte](SUITE_ARCHITECTURE.md) e a
[integração de produção](GAME_AGENT_PRODUCTION.md). Esta interface de inspeção não fornece
portas de build, acesso ao sistema nem autorização administrativa.
As [portas Core de produção](GAME_CORE_PRODUCTION_PORTS.md) são outro hook
do adaptador assinado, sem aceitar autoridade ou resultados declarados pela UI.

## Identidade fora dos argumentos

O `InstalledAdapter` recebe um quinto argumento em `invokeTool`:
`Readonly<{id, runId, sessionId}>`. O serviço o cria somente ao executar a
operação já registrada no diário. O ID é `engine-` seguido do SHA-256 canônico
de namespace autenticado, execução e chamada. É estável entre reinícios;
a vinculação existente da operação rejeita reutilização com ferramenta ou
argumentos diferentes. Não é um token de autoridade nem uma credencial.

O kit anuncia `installedToolInvocationVersion: 1`. Adaptadores antigos podem
ignorar o argumento; composições novas que dependam dele devem exigir a versão,
sem inventar IDs ou selecionar outro executor. Essa extensão do contrato
interno deve entrar em um artefato exato verificado antes de uma instalação.

## Conferência pelo responsável pela operação

O adaptador protegido pode implementar `reconcileTool(registration, definition,
invocation, signal)`. Recebe a definição original, resolvida no catálogo
autenticado, e retorna exclusivamente:

- `known` com resultado observado pela autoridade original;
- `unknown`, mantendo a reserva;
- `unsupported`, para ferramentas ainda sem conferência automática.

`tools.inspect {runId, callId}` e os métodos SDK `inspectTool`/`inspect_tool`
não aceitam resultado, argumentos, ID substituto ou namespace da interface.
Exigem execução em reconciliação, recibo original `started` e adaptador instalado
do KidOS com o hook. `unknown` e `unsupported` mantêm o recibo e impedem a
retomada. Resultado conhecido é salvo antes de liberar a espera; a retomada
continua explícita e recupera esse recibo, sem executar novamente a ação.

O serviço anuncia `installed-tool-invocation-v1` e
`installed-tool-inspection-v1`. Consultas concorrentes para a mesma operação
compartilham a inspeção; desligamento a cancela e aguarda sua saída antes de
fechar o banco. Uma inspeção ativa impede a ativação de atualização nesse ponto.

`tools.reconcile` preserva a intervenção manual legada onde o adaptador declara
`unsupported`; para ferramentas com inspeção, o resultado do Core prevalece
sobre o resultado enviado pela interface. Clientes infantis não devem usar
essa compatibilidade para inventar confirmação: usam somente `tools.inspect`.
Esta extensão não qualifica retroativamente as ferramentas legadas.

## Consumidor KidOS e limites

O catálogo opcional `game_runtime` do adaptador KidOS usa essa identidade para
`game_bundles.play` e inspeciona somente `game_bundles.play.reconcile` com o
mesmo ID. Ausência de recibo não prova ausência de efeito. Recibos de outra
operação ou sem observação histórica são recusados. `opened` representa página
carregada no passado; não certifica presença, gameplay ou qualidade.

O Core continua validando UID real, publicação e controles parentais. O Navi
não recebe shell, filesystem, Docker, autoridade parental ou seleção de modelo.
O catálogo é opt-in na construção de uma composição de desenvolvimento;
não altera automaticamente a integração KidOS fixada em engine 1.0.2.

No pedido explícito de continuação, Navi GTK/terminal pode conferir aberturas de
bundle pendentes se o serviço anuncia a capacidade. Ferramentas legadas, motor
antigo, Core indisponível ou efeito desconhecido permanecem em espera. O cliente
não produz um resultado substituto e não cria outro run para contornar a reserva.

## Verificação

`test/installed-tool-reconciliation.test.ts` cobre identidade imutável,
reinício, recusa de resultado forjado, inspeção sem resultado, resposta inválida,
falta de suporte, concorrência e encerramento, sem repetir o efeito simulado.
Testes do repositório KidOS cobrem a ponte Python, o diário real do Core com
lançador controlado e o perfil pelo grafo oficial com inferência simulada.
Essas provas não equivalem a uma nova instalação, broker de produção protegido,
perfil Game Design v2 ou aceite físico na conta infantil.
