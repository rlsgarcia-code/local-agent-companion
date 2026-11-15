# Bibliotecas de assets licenciados

Estado em **2026-11-11**: implementação em fonte, com SDK/serviço/renderização qualificados no Mac ARM64. Não é uma
release instalada, aprovação jurídica/artística ou conclusão do
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md).

## Fronteira e funcionamento

`packages/adapter-game-library` fornece catálogo offline e cópia de dados
imutáveis. `packages/game-design` fornece orientação; o executor permanece no
motor comum. Não há outro agente, scheduler, download automático ou avaliação
de direitos pelo modelo. Somente o dono do processo registra o adaptador.

`licensed-libraries-v1` é exclusivo dos produtos Mac/VS Code com autoridade de
workspace. A conta KidOS não pode usar o catálogo genérico nem importar recursos
por ele: precisa de catálogo e autorização próprios no Core. O contrato fixo de
mídia Core recusa `library.copy` explicitamente. Isso não altera o pacote Root
já congelado para qualificação ou ativa Navi v2.

1. `games.assets.libraries` recebe `processorId` (padrão `licensed-libraries-v1`),
   `libraryId` e `entryId` opcionais, busca, cursor e limite de até 30 entradas. SDKs:
   `listGameLibraries` e `list_game_libraries`. O agente usa `game_libraries`,
   ferramenta somente de leitura, inclusive para os especialistas.
2. Cada seleção inclui hash do manifesto, versão, autor, origem HTTPS citada,
   licença declarada, documentos completos, arquivos dependentes, hashes,
   tamanhos, formatos e nomes originais das animações. A URL não é buscada.
3. `game_process_assets`/`games.assets.process` recebe `library.copy`, seleção
   **exata** e diretório relativo novo em `assets/`. O catálogo instalado decide
   a seleção autorizada; campos enviados pelo cliente não concedem autoridade.
4. A operação usa os jobs, cotas, fila de recursos, recibos e eventos existentes.
   A cópia é somente de arquivos do pacote instalado para o candidato em memória;
   não executa modelos, plugins, scripts do projeto ou ferramentas nativas.
5. O candidato conserva caminhos relativos, bytes dos modelos/texturas/licenças,
   `LIBRARY.json` e proveniência usual. A aplicação exige operação explícita e
   revisão/fingerprints atuais. Processar não modifica o projeto.

Arquivo GLB com `Textures/colormap.png` externo depende desse caminho relativo;
copiar somente o GLB quebra seu material. Os arquivos do grupo são inseparáveis
na seleção, no processamento, no candidato e na aplicação. Não converter por
renomeação, omitir notices ou substituir materiais silenciosamente.

Origem passa a `library`, com autor/citação/licença completos e referência ao
manifesto fixado. A declaração continua `declared-unverified`: integridade dos
bytes e origem fixada não certificam direitos ou compatibilidade do jogo final.
Placeholder do alvo existente é preservado numa substituição por biblioteca.

## Integridade e limites

O índice fixa SHA-256 de cada manifesto; a toolchain fixa índice e implementação.
O carregamento valida contratos, identidades e todos os blobs. Pacote ausente ou
alterado fica indisponível, sem download/fallback. Cada processamento compara a
seleção completa ao manifesto já fixado em memória e reconfere os blobs lidos.
Manifesto substituído não altera o catálogo de um processo já iniciado; no
próximo início, divergência do índice é recusada.

Entradas têm até 16 arquivos e 64 MiB no total; cada manifesto, até 2 MiB; catálogo,
até 30 bibliotecas e 256 MiB únicos. Nomes portáveis, colisões, sidecar reservado,
licenças ausentes e metadados falsificados são recusados. Arquivos precisam ser
regulares, sem symlink/hardlink, com tamanho e SHA-256 conferidos. A leitura
confere mudanças durante a operação. Essa fronteira valida dados de instalação,
**não é um sandbox de código** ou defesa contra o dono da própria conta alterando
todo seu software. Nenhum caminho do host pode ser escolhido por RPC/modelo.

Queda antes da confirmação não deixa editor/processo externo de cópia ativo.
O inspetor informa a ausência do candidato sem copiar de novo. O coordenador
mantém resultado desconhecido até reconciliação; replay não cria outro job.
Candidato confirmado permanece recuperável e aplicável após reinício.

## Primeiro pacote fixado

Mini Arena 1.0, de Kenney, crédito adicional Tony Schär:

- Origem oficial: [Starter Kit, revisão a6927e6](https://github.com/KenneyNL/Starter-Kit-Basic-Scene/tree/a6927e66ff8dd8e173660ce4825abe773c65f683/sample/Mini%20Arena).
- Somente os dados de arte: 22 modelos GLB, uma textura e o `License.txt`
  original; 24 arquivos, 558.803 bytes. Não inclui código, templates ou projeto.
- O personagem `character-soldier` conserva 32 clips originais, incluindo
  `idle`, `walk`, `sprint` e `jump`; os nomes são consultáveis, não inventados.
- A licença **declarada pelo arquivo original** é CC0-1.0. O documento integral
  e todos os créditos acompanham cada grupo importado e a distribuição do motor.
- Manifesto SHA-256:
  `d3dc09403c382dc93dc1f09c1c4b74643e72885f8957098d93b07f1ff7533adf`.

`packages/adapter-game-library/upstream.lock.json` registra commit, caminho,
tamanho, Git blob SHA-1 e SHA-256 de cada entrada. Os insumos foram obtidos da
origem pública oficial por ação administrativa, com revisão exata e sem redirect;
o commit não foi descrito como assinatura do publisher. O prepare é **offline**:

```sh
node scripts/prepare-game-library.mjs /pasta/dos/insumos-verificados
```

Ele valida os dois hashes/tamanhos, estrutura GLB, dependências conhecidas e
animações; produz índice, manifestos e blobs por hash. O build copia somente a
lista fechada verificada, inclui notices legíveis e os cobre pelo manifesto do
motor. Alterar a biblioteca exige revisão do lock, novo pacote/hash e qualificação;
não atualizar uma branch mutável durante uso. Assinatura/publicação de nova
release continua uma etapa própria.

## Verificação e pendências

`test/game-library.test.ts` exercita catálogo paginado, bytes/licenças e textura
externa, metadados/arquivos forjados, corrupção, links, reinício, isolamento de
namespace, aplicação explícita/idempotente e recusa Core. O teste não concede
autoridade parental ou licença independente.

`scripts/smoke-game-library.mjs` usa SDK, serviço empacotado e Babylon/loader
offline reais, reinicia antes de aplicar e coleta teclado, textura e rig no
navegador. Guarda builds, candidatos, relatórios, capturas e falhas em
`output/playwright/game-library/runs/`. É uma fixture declarada, nunca fornecida
à geração real de jogos. Seu resultado precisa ser lido no acompanhamento;
existir um script não comprova que passou.

O [seletor visual do Studio](GAME_STUDIO_UI.md) está em fonte, com busca,
seleção exata, confirmação, candidato e leitura integral da licença. Seus
ensaios e limites de recuperação são registrados no acompanhamento.

Permanecem: mais estilos e formatos, viewport 3D na biblioteca,
revisão dirigida de licenças/adequação, Unity/Godot e Core próprios, coerência
artística em jogos completos, matriz física/humana e distribuição instalada.


Composição inicial qualificada nesta frente: motor
`56dc4834cce6edfc5b9c6d02188fa0e52b85c5d3dc194b9f77b9dd0b352b7575`,
562 testes aprovados, um opt-in ignorado e 30 verificações do repositório.
A fixture final em `output/playwright/game-library/runs/2026-11-11T15-54-35-675Z-d1412110/`
passou com personagem/material, movimento e caminhada originais. Uma falha de
espera de carregamento no cenário de animação foi preservada antes da correção;
limiares não foram reduzidos. Trinta e dois clips estão preservados; somente
`walk` foi exercitado nessa observação. Ver o acompanhamento e o relatório
`output/game-generation/licensed-library-20261111-a1/report.json` para os hashes.

A integração posterior no [Studio](GAME_STUDIO_UI.md#qualificação-de-bibliotecas--2026-11-11)
usa o manifesto `557c49389fb5b7d06a378f33357203d1717f4b8a25ae8bca05c7120605e979cf`.
Inclui seleção visual e licença integral, testes nativos Mac/VS Code em perfis
temporários e recuperação após recarga, com 563 testes aprovados, um opt-in
ignorado e 30 verificações. O índice/manifesto do pacote de arte continua o mesmo;
`entryId` é filtro exato de leitura e não amplia autoridade. O novo ensaio de
renderização dessa composição está em
`output/playwright/game-library/runs/2026-11-11T16-27-59-404Z-740386fe/`.
Não transformar recarga do painel em prova de restauração após fechar o app,
viewport de modelo no Studio, licença independente ou instalação da release.
