# Recursos do build: qualificação dos hosts nativos

Evidência de desenvolvimento de **2026-11-13** para GD-08/GD-11 do
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md). Complementa o
[Studio compartilhado](GAME_DELIVERY_STUDIO.md) e a
[seleção no compilador](GAME_WEB_DELIVERY_SELECTION.md).

Os ensaios usam código de host de produção em aplicativos/perfis temporários.
Não substituem `.app`/VSIX instalados, distribuição assinada, migração das contas,
rollback de binários ou a aceitação técnica/humana dos jogos completos.

## O que foi executado

| Caminho | Código real | Fixture explícita |
|---|---|---|
| Mac | `openDesktopGameStudio`, BrowserWindow/preload/IPC, SDK/controlador e arquivo privado de rascunho | App Electron temporário, conexão com serviço de fixture, decisões de diálogo e uma resposta perdida |
| VS Code | `openEditorGameStudio`, webview/bridge, `DevelopmentAgent`, `EditorServiceRuntime`, SDK/controlador e arquivo privado | Extensão de desenvolvimento mínima, factory de conexão vinculada ao serviço temporário e uma resposta perdida |
| Serviço | Mesmo pacote de desenvolvimento, Node22.23.4, autenticação TLS/IPC, domínio/revisões/recibos/transferências | Estado e credenciais efêmeros próprios de cada produto, sem provedor chamado |

O pacote exato foi
`output/game-generation/delivery-studio-20261113-a1/engine`, manifesto SHA-256
`291efabfc606847ae393c815fc2a339f207c0842cbff6fa8e51d792da8938ae9`,
481 arquivos, `darwin-arm64`, versão do motor1.0.2, `development:true`.
Não foi produzido/promovido outro motor para estes ensaios. UI/hosts são
componentes separados, com fontes e hashes próprios no dossiê.

Cada percurso abriu três processos de host distintos sobre o mesmo estado:

1. Escolher arquivos e filtro; aguardar confirmação de gravação do rascunho.
2. Encerrar o host inteiro; reabrir e recuperar a escolha sem commit automático.
   Salvar, confirmar e perder deliberadamente a resposta depois do commit2.
3. Encerrar novamente; preservar uma edição externa posterior em3 e reabrir em
   leitura. Conferir o pedido original sem nova confirmação, upload ou commit.

O mesmo processo de serviço permaneceu vivo durante as reinicializações. Cada
host exportou a fonte com a revisão posterior e o master original. Não houve
modelo, geração adicional, instalação, atualização pessoal ou perfil infantil.
Isso comprova esse ciclo de domínio/rascunho; não é interrupção/retomada de uma
inferência ou build em execução, nem reinício do próprio serviço neste ensaio.

## Resultado Mac

`scripts/qualify-game-delivery-electron.mjs --engine=<pacote> --input=<ensaio-AAC>`
usa o Electron já instalado no projeto e o preload copiado pelo builder desktop.
A UI copiada precisa coincidir byte a byte com o fonte atual. O processo de
serviço recebe ambiente fechado; nenhum segredo de provedor é herdado.

O positivo `2026-11-13T15-20-59-866Z-9e212349` observou:

- Electron45.2.1 com Node interno24.22.1, separado do Node22.23.4 do serviço.
- Três processos38347/38354/38359, todos encerrados com código0.
- Rascunho não enviado, filtro e escolhas recuperados após reabrir o aplicativo.
- Um único envio de configuração, com resposta perdida injetada; edição posterior
  preservada em3 e recuperação em leitura sem outro diálogo/upload/commit.
- Exportação pela implementação real do host para pasta de fixture.
- Build Phaser pelo host, excluindo master WAV do artefato e conservando o aviso
  registrado; master continua no projeto editável e `quality.ready` permanece falso.
- Serviço encerrado com código0 somente ao terminar o ensaio.

O modo de leitura do Mac é o callback normal fornecido ao host, controlado por
um marker somente na fixture. Decisões dos diálogos Mac são simuladas; não é
aceite humano de confirmação, privilégio administrativo ou autorização parental.
O renderer permaneceu sem `require`/`process`, com apenas sua bridge restrita.

## Resultado VS Code

`scripts/qualify-game-delivery-vscode.mjs --engine=<pacote> --input=<ensaio-AAC>`
abre o editor existente com `--user-data-dir`, workspace/extensões privados e
Secret Storage em memória. As configurações da fixture desabilitam telemetria,
atualizações, experimentos e extensões externas. O diagnóstico CDP pertence
somente ao processo de editor criado por esse ensaio, nunca ao perfil pessoal.

O positivo `2026-11-13T15-29-31-332Z-38d6c6bc` observou:

- VS Code1.146.0, extensão em modo de desenvolvimento.
- Processos de extensão39393/40044/40690, todos ligados à mesma sessão
  `7f0534a5-e0a3-4675-83b1-c9abeedf8eae`.
- Três grupos de editor39380/40034/40680 encerrados e verificados, incluindo
  crashpad somente quando seu caminho de banco corresponde ao perfil privado.
- Reabertura do Studio por comando explícito: não há serializer/reabertura
  automática alegada. O estado vem do arquivo privado, não de painel retido.
- Rascunho e pedido congelado recuperados após reinício de todo o editor.
- Terceiro processo em `autonomyMode: plan` real da configuração do workspace.
  Recuperação não pediu Continuar, não fez outro upload/commit e conservou3.
- Exportação pelo seletor de pasta customizado nativo do VS Code, no diretório
  temporário, com master e histórico preservados. Layout sem overflow horizontal.
- Serviço independente sobrevivente e encerramento final com código0.

O renderer ficou sem `require`/`process`, usando somente a comunicação webview
existente. A captura de recuperação do workbench conserva a posição de scroll;
não é um novo aceite visual de todos os campos nem da aplicação inteira.

### Diagnóstico e tentativas preservadas

`2026-11-13T15-25-16-025Z-74261291` e
`2026-11-13T15-28-23-669Z-8813e610` não abriram workbench e permanecem reprovados.
O segundo roteiro acrescentou diagnóstico de targets e log privado, sem trocar
o motor. O log apontou `listen EINVAL`: o socket `1.14-main.sock` do editor
excedia o limite103 de caminho no macOS com o prefixo temporário escolhido.
Não houve ativação/commit do Studio nesses dois ensaios.

A correção é exclusivamente no preparador do teste: diretório novo curto em
`/private/tmp/`, limite de60 bytes para o caminho do perfil. Não aumenta limites
do sistema, permissões, transporte da suíte ou timeout para promover uma falha.
Os grupos dos processos anteriores foram confirmados encerrados antes de outra
tentativa. Perfis falhos e logs privados foram preservados, sem copiar bancos,
credenciais ou chaves para o dossiê público. Metadados públicos de falha,
diagnóstico de targets e encerramentos ficam vinculados a cada tentativa.

## Limites de aceite e continuação

Os inputs AAC/WAV são fixtures anteriores reais conferidas por hashes; estes
ensaios não codificam, tocam nem avaliam música. No Mac, o build foi observado
como domínio/artefato, sem alegar execução/qualidade desse jogo. Aprovação
parental, integração Core, Wayland, telas/voz e navegação infantil permanecem
fora deste percurso.

A ausência de credenciais/assinatura comercial e os wrappers temporários
continuam explícitos. Faltam instalação dos três clientes, composição protegida
KidOS, compatibilidade de rascunhos em rollback, Unity licenciada/isolada,
portfólio completo, pedidos inéditos, hardware e playtests consentidos. Os
resultados não alteram o orçamento esgotado nem a seleção GPT Luna anterior.

O [dossiê desta qualificação](../output/game-generation/delivery-native-20261113-a1/report.json)
liga scripts/fontes, pacote exato, exports, screenshots, testes e encerramentos.
Preserve os resultados históricos; novo pacote/host exige qualificação própria.
