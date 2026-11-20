# Protocolo privado do coletor Core

Estado em **2026-11-11**: contrato/kit e broker KidOS em fonte, com testes.
**Composição assinada de release, instalação e qualificação Linux permanecem pendentes.**
Uma [porta/factory opt-in](GAME_CORE_VALIDATION_PORT.md) foi ligada em fonte e
ensaiada com assinatura efêmera na etapa posterior.
Leia [admissão](GAME_VALIDATION_ADMISSION.md), [candidato fixo](GAME_BROWSER_CORE_CANDIDATE.md)
e [portas protegidas](GAME_CORE_PRODUCTION_PORTS.md). No KidOS, a referência local
é `docs/PROTECTED_GAME_VALIDATION.md`.

O contrato está em `packages/contracts/src/kidos-game-validation.ts`; o kit
`installedGameProductionAPI` expõe `coreValidationSchemas`, request/result de
candidato e a função de toolchain. É API do processo dono da composição, não
um registro de ferramentas por RPC. O ABI privado permanece 1 nesta fonte não
publicada; o hash da implementação faz parte da identidade exata da ferramenta.

O broker KidOS usa `game_validation.*` e a ponte fixa `command: validation`.
Reutiliza o ciclo de vida de build/mídia sob UID real. Recibo tem
`production_kind: validate`, `admitted` e vínculo de projeto/etapa Root. Não usa
aprovação comum como autoridade parental. O serviço já tem os hooks de admissão
antes da fila; a factory KidOS agora se conecta a este protocolo quando o catálogo
opcional declara `gameValidation`. Não altera o perfil Navi v2 por padrão.

Capacidades exigem validação/fila ABI 1, worker/browser exatos e plataforma Linux
correspondente. Reconhecem Phaser/Babylon/Godot e somente runtime automatizado;
não anunciam Unity, licença, qualidade física/humana ou aceite de gameplay.
O motor/headless permanece independente; não recebe framework KidOS ou UI.

## Transferência e verificação

- Request: até 16 MiB de metadados, build fixado de até 256 MiB, somente blobs
  registrados por hash e suíte JSON empacotada.
- Page: cabeçalho de identidade original, `collector_id`, `observation_count`,
  referência do `report` e até 100 arquivos com cursor. Não traz observações
  completas numa resposta Core de 1 MiB.
- `report.json`: os bytes exatos do resultado do worker, até 4 MiB, lidos por
  `file.read` em blocos de 256 KiB. Metadados e dados são verificados separadamente.
- Evidências: transporte numerado por observação/arquivo, até 2.000 e 64 MiB.
  O relatório conserva os nomes originais; não misturar arquivos de outro caso.

A porta deve conferir request SHA, fonte, artefato, suíte, toolchain,
contagem e o mapa **exato** de arquivos contra o relatório baixado. Deve validar
bytes antes de devolver `CollectedGameObservation[]`. Resultado de inspeção não
é parâmetro de interface; recuperar não reserva nem abre outro navegador.
Finalização de cgroup e orçamento continuam no Core/Root, separados de QA.

O relatório Python de fixture foi aceito pelo kit empacotado com hashes e blocos
conferidos. Permissão/auditoria e relatório acima de 1 MiB passaram por socket Core
real em teste temporário. Browser real Mac→verificador Python é um ensaio separado.
Essas provas não compõem serviço/SDK/porta assinada/Root/browser Linux instalado.

Regressão: 509 testes Companion passaram, um opt-in ignorado, 30 verificações de
repositório; 918 KidOS passaram, dois ignorados. O ensaio explícito de browser
passou em oito testes. Tipos, builds e smoke de leitura com provedor simulado
passaram. Evidência local: `output/core-validation-broker/attempt-1/`.
Nenhuma instalação, release ou ativação do Navi v2 foi feita.
