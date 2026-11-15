# Escolher recursos de distribuição no Studio

A [qualificação posterior dos hosts nativos](GAME_DELIVERY_NATIVE_HOSTS.md)
complementa os ensaios emulados abaixo. Usa o código de janela/bridge/editor
real com perfis temporários; mantém separados seus resultados e as pendências
de instalação, hardware, distribuição e rollback.

Fonte de desenvolvimento de **2026-11-13**, ligada a GD-03/GD-04/GD-05/GD-08/GD-11
do [plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md). Leia o
[contrato do compilador](GAME_WEB_DELIVERY_SELECTION.md) e a
[arquitetura da suíte](SUITE_ARCHITECTURE.md). Fonte, pacote de desenvolvimento e
pontes de host emuladas não comprovam instalação, rollback ou aceite do produto.

## Uso

Na Visão geral, **Recursos do build** abre a escolha para Phaser/Babylon:

1. **Todos os recursos do projeto** conserva o comportamento anterior: recursos
   elegíveis de `assets/` e `data/`, sem fontes Blender/backups.
2. **Escolher arquivos** apresenta caminhos, tamanhos, seleção, filtro e páginas
   de30. O filtro não modifica as escolhas; alternar o modo não apaga a seleção
   temporária. O total é dos arquivos pedidos, sem runtime/avisos adicionais.
3. **Salvar recursos** pede confirmação nativa e cria uma revisão da configuração.
   Originais e histórico permanecem completos. Gerar/testar/exportar o novo build
   são ações separadas.

Selecione todos os sons, texturas e arquivos de conteúdo efetivamente usados.
Dependências dinâmicas não são inferidas. Avisos/JSON/texto registrados nos assets
selecionados e seus ancestrais são conservados pelo compilador. Isso não verifica
licenças, dependências, música ou qualidade. O projeto editável continua completo.

## Fronteiras e recuperação

`packages/contracts/src/game-studio.ts` define somente comandos de UI fechados:
`delivery-settings`, `set-delivery` e `resume-delivery`. O controlador SDK resolve
a sessão autenticada e a revisão original; renderer não escolhe namespace,
transferência ou documento arbitrário. Não há nova RPC de mutação, codec, shell,
agente, classificador ou armazenamento de projeto nas interfaces.

O controlador lê `game.web.json` limitado a8 MiB, confere bytes/tamanho/hash e o
schema compartilhado. Configuração inválida ou com campos desconhecidos é
recusada com original intacto. Ao salvar, altera somente `delivery`, preservando
entry/version; a nova serialização é JSON formatado, não edição literal de espaços.
`null` no comando significa retirar a opção, nunca apagar arquivo.

O pedido contém projeto/revisão/ID, hash da configuração e seleção exata. Escrita,
capacidade e seleção são conferidas antes/depois da confirmação e após upload.
A gravação usa `commitGameRevision` com CAS/idempotência existentes. Uma revisão
concorrente não é sobreposta. Não há build ou aprovação de qualidade automática.

Antes do envio, o renderer congela e aguarda o rascunho no arquivo privado do
host, pelo backend existente com CAS/fsync e limite de2 MiB. Armazena escolhas,
filtro, revisão/hash e pedido; não copia todo o catálogo. Dados incompatíveis ou
acima do limite permanecem preservados e impedem envio, sem truncar o projeto.
Carregar o rascunho lê metadados, nunca submete ou confirma uma alteração.

Resposta perdida mantém controles/pedido congelados. **Conferir pedido** consulta
`games.mutations.inspect`, verifica binding completo do commit original, hash e
revisão imutável. A revisão reconhecida fornece a referência da transferência;
recuperação conhecida não faz upload, não pede nova confirmação e não grava.
Pode recuperar em leitura e após trabalho posterior. Um recibo ausente ou com
outro conteúdo não encerra o efeito anterior. Somente o pedido original pode
passar novamente por consentimento/CAS, e apenas na revisão original vigente.
Recusa da retomada não libera o rascunho desconhecido nem cria outro ID.

O campo opcional privado `deliveryEdit` amplia o formato de rascunhos atual.
Leitores anteriores estritos podem recusá-lo e preservar o arquivo: isso não
constitui compatibilidade de rollback instalado. Sua preservação/conversão deverá
ser comprovada na composição de distribuição antes de instalar esta mudança.
O backend não interpreta o campo como autoridade e a UI não apaga um original
incompatível para iniciar outro pedido.

## Permissões e evolução

A capability `game-web-delivery-v1` e o modo de edição liberam nova edição no
Studio. Recuperação de commit conhecido usa a capacidade de inspeção já existente,
inclusive quando o motor não anuncia mais edição. Falta de recibo preserva a
pendência. O Core fixo continua recusando a opção; não há caminho Navi/KidOS
habilitado por esses comandos. Confirmar no Studio não é autorização parental.

Mac/VS Code usam o mesmo renderer/controlador. Labels usam texto/DOM, lista tem
checkboxes nativos e preserva foco após alternância por teclado. O filtro não
reconstrói sua própria entrada, e polling é suspenso enquanto a edição local
está aberta. Modo congelado conserva atualizações e conferência do resultado.
Tema e movimento reduzido seguem o Studio, sem redesenho da interface.

## Verificação

- `test/game-studio-delivery.test.ts`: IPC/TLS real, schema/origem, confirmação,
  CAS, recursos inválidos, autoridade alterada durante confirmação, resposta
  perdida, recibos missing/adulterado, leitura após trabalho posterior, sem
  upload/commit adicional e preservação de configuração incompatível.
- `scripts/qualify-game-delivery-studio.mjs --engine=<pacote> --input=<ensaio-AAC>`:
  serviço/SDK/renderer/controlador/backends reais, duas pontes de host emuladas,
  fonte AAC real anterior conferida por hash, filtro/paginação, rascunho/reload,
  negação, perda de resposta/missing injetados, recuperação read-only, build real
  e retorno ao inventário padrão preservando fontes/edição posterior.

Esses ensaios usam ambientes privados do mantenedor. Não substituem aplicativos
instalados, leitor de tela/dispositivos físicos, audição, licença da distribuição,
qualidade dos jogos ou rollback completo das contas. Toda a aceitação integral
permanece no plano e no acompanhamento.

### Resultado observado

O ensaio final `2026-11-13T15-12-40-472Z-9e0d2501` passou no pacote de
desenvolvimento `291efabf…`, Node22.23.4/darwin-arm64, 481 arquivos. As duas
pontes emuladas usaram Chromium157.0.8103.78, SDK/serviço/TLS, backends privados
e builds Phaser/Babylon reais. Originais AAC/WAV de fixture vieram do ensaio
anterior e foram conferidos por hash, sem nova codificação/inferência.

Paginação, filtro, escolhas ativas/inativas, reload, ausência de polling durante
edição e alternância por Space com foco preservado passaram. Negação conservou
revisão1; resposta perdida após commit2 congelou o comando. Após edição de título
em3, missing injetado não o apagou. A consulta real recuperou em leitura sem
outra gravação. Retirar a opção criou revisão4, mantendo título, master e avisos.
Os builds da seleção conservaram aviso/receita e omitiram master WAV.

O positivo inicial `2026-11-13T15-07-22-246Z-83e75ccf` não incluía a nova
observação de foco. O intermediário `2026-11-13T15-11-01-977Z-47bba280` foi
recusado porque o roteiro pressupunha ordem fixa após desmarcar/remarcar.
Não houve mudança de política do produto: o roteiro final compara os membros
esperados e continua comparando o comando congelado exato em cada recuperação.
Falha, screenshot, originais e encerramento com código0 foram preservados.
Inspeção posterior do banco original em leitura confirmou recibo/revisão2, sem
repetição. O primeiro diagnóstico usou assinatura interna incorreta e foi
recusado antes dessa conferência; não é evidência de um novo commit.

Passaram748 testes,31 verificações, um opt-in ignorado, checks/builds e
roteamento local simulado. O [dossiê](../output/game-generation/delivery-studio-20261113-a1/report.json)
conserva fontes e hashes, separando fonte/fixtures dos gates integrais pendentes.
