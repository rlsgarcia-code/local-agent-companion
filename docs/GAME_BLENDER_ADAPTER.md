# Produção 3D com Blender isolado

Referência de desenvolvimento, **2026-11-13 UTC**. Este caminho acrescenta
modelagem procedural e edição de GLB registrado à
[cadeia de assets](GAME_ASSET_PIPELINE.md). Não conclui o aceite artístico,
os quatro adaptadores nem o [produto Game Design 1.0](GAME_DESIGN_IMPLEMENTATION_PLAN.md).

## Responsabilidade e contrato

`packages/adapter-game-blender` fornece `blender-model-isolated-v1`, somente
para Mac e VS Code autenticados, com autoridade de workspace. O serviço
registra a porta; não existe cadastro por RPC. `packages/game-design` fornece
conhecimento e critérios, sem executar Blender ou criar outro loop de IA.
KidOS requer seu próprio broker/Core; esta porta não concede Docker, shell
ou acesso genérico a arquivos ao Navi.

A receita estrita `model.scene`, em `packages/contracts/src/game-models.ts`,
descreve dados, sem Python, expressões, plugins ou importação de `.blend`:

- Primitivas, malhas triangulares ou GLB autocontido registrado no projeto.
- Hierarquia de objetos, transformações, suavização, bevel e subdivisão limitados.
- Materiais PBR com cor, metalicidade, rugosidade, emissão e textura PNG registrada.
- Armadura com ossos, vínculos rígidos ou pesos explícitos por vértice; clips nomeados de transformação de
  objetos ou ossos, com chaves explícitas.
- Câmera e luzes para inspeção fixa em PNG de 512 × 512, por CPU.

As receitas usam metros, Z para cima e ângulos Euler em graus; a exportação GLB
usa Y para cima. Gerar um novo modelo não requer fonte; editar um GLB/textura
requer asset e arquivo pertencentes à revisão imutável selecionada. Uma edição
derivada usa identidade e caminho novos, preservando os originais e a cadeia de
proveniência. Não substitui silenciosamente a engine do jogo.

### Deformação por pesos explícitos

Em uma malha `geometry.kind: "mesh"`, `skin.weights` contém uma linha por
vértice original, na mesma ordem de `geometry.vertices`. Cada linha tem de uma
a quatro influências `{ bone, weight }`, com ossos existentes e distintos,
pesos positivos e soma de um, com tolerância de `1e-6`. O limite agregado é de
50 mil vértices ponderados e 200 mil influências por receita. Vínculo rígido,
objeto pai, bevel e subdivisão não podem ser combinados com essa opção: o
percurso não remapeia pesos depois de modificar a topologia.

O driver cria grupos de vértices e um modificador de armadura com deformação
linear; envelopes e preservação de volume por dual quaternion ficam desligados.
Isso evita produzir uma deformação exclusiva do Blender que não corresponda
ao GLB no navegador. Não há pesos automáticos, retargeting ou anatomia inferida.

A inspeção independente do GLB verifica os pares `JOINTS_n`/`WEIGHTS_n`, tipos,
normalização, referências de ossos, hierarquia e matrizes de vínculo. Suporta
acessores intercalados, esparsos e pesos inteiros normalizados, com orçamento
limitado de decodificação. Retorna `skinnedVertices`, `mixedWeightVertices` e
`maxSkinInfluences`; vértices duplicados pelo exportador para normais/UVs são
contados no GLB, sem multiplicar instâncias de uma mesma malha. Exige soma um
com tolerância de `1e-5` nos pesos float como política deste percurso; a
[especificação glTF](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#skinned-mesh-attributes)
a recomenda, em vez de torná-la obrigatória nesse tipo.

O leitor inspeciona até oito influências por vértice, mas a edição Blender
qualificada admite no máximo quatro: entradas acima disso são recusadas com
o original preservado, em vez de descartar influências na exportação. Essa
inspeção não comprova a qualidade visual de qualquer rig importado.

Para `outputBase: "assets/character"`, os quatro resultados obrigatórios são:

| Arquivo | Uso |
|---|---|
| `assets/character.glb` | Geometria, materiais, rig e animação para a engine |
| `assets/character.blend` | Fonte editável para trabalho posterior no Blender |
| `assets/character.preview.png` | Imagem de inspeção do candidato |
| `assets/character.model.json` | Relatório do processador; não é aprovação de qualidade |

O serviço acrescenta o JSON de proveniência. Processar não altera o projeto;
inspecionar e aplicar usam as APIs existentes `games.assets.*`, com revisão,
fingerprints e recibo idempotente. Fontes temporárias continuam temporárias nos
derivados, mesmo se o pedido tentar remover o indicador. Declarações de licença
são preservadas, com estado `declared-unverified`.

## Provisionamento explícito

A linha fixada é **Blender 4.5.15 LTS, Linux x64**. Em Mac ARM64 este percurso
usa emulação x64 dentro do contêiner, explicitamente; não comprova execução
nativa ARM nem a matriz completa de plataformas.

O administrador obtém os insumos oficiais indicados em
`packages/adapter-game-blender/toolchain.lock.json`, coloca-os em
`.cache/game-editor-inputs/blender-4.5.15/` e garante que a imagem-base exata
já esteja no isolamento local. Depois executa:

```bash
npm run toolchain:blender
```

O provisionador verifica tamanhos e SHA-256 antes da extração; valida caminhos e
links do arquivo oficial; constrói offline com imagem-base por digest e confere
a versão do editor. Nenhum download, pull, instalação, script do projeto ou
troca de versão ocorre durante um pedido de produção. O registro privado gerado
em `.cache/game-toolchains/blender.json` deve ser provisionado pelo instalador em
`<estado-do-serviço>/toolchains/blender.json`; copiá-lo sozinho não instala a imagem.

O motor básico empacota apenas driver e lock, cobertos pelo manifesto. O editor
e sua imagem são opcionais, separados; as licenças e obrigações de distribuição
das ferramentas continuam próprias e deverão acompanhar eventual pacote delas.
Fonte oficial: [Blender 4.5 LTS](https://www.blender.org/releases/4-5/) e
[arquivos oficiais da linha 4.5](https://download.blender.org/release/Blender4.5/).

## Isolamento, limites e recuperação

O driver fixo roda com rede desativada, usuário sem privilégios, raiz e fontes
somente leitura, capacidades removidas e `no-new-privileges`. Só os arquivos
selecionados são montados em `/source`; home, socket Docker e segredos não são
montados. Escritas temporárias ficam em tmpfs limitado. O executável recebe
argumentos fixos, inicialização limpa e execução automática de scripts desativada.

A fila comum reserva 4096 MiB, dois slots de CPU e exclusividade do editor.
O contêiner limita memória/swap a 4 GiB, CPU a dois processadores, PIDs a 256,
`/work` a 384 MiB e `/tmp` a 128 MiB. Processamento tem prazo de 180 segundos;
exportação e leitura de arquivos também são limitadas.

Receitas admitem até 128 objetos, 32 materiais, 128 ossos, 16 clips e 8192 chaves.
Fontes agregadas: 64 MiB. Malhas avaliadas: até 300 mil triângulos e 1024 objetos
exportados. Um GLB é limitado a 64 MiB; resultados agregados, a 128 MiB.
O parser independente verifica estrutura, buffers, acessores, índices, recursos
embutidos, vínculos/pesos e limites de trabalho. Não é um validador integral da especificação
glTF, de anatomia, deformação ou qualidade artística. Decodificadores externos e
extensões obrigatórias não qualificadas são recusados, preservando o original.

`packages/adapter-game-container` reúne CLI fixa, TAR seguro e diário por operação;
não é outro executor de agente ou fila. A identidade inclui namespace, job,
revisão/hash de fonte, receita e toolchain. Um candidato é salvo com hash e recibo
antes da confirmação no banco. A recuperação inspeciona apenas essa identidade,
confirma a parada e recupera os mesmos bytes; não inicia novamente o editor.

Cancelamento fica em `cancelling` até confirmar remoção do contêiner original.
Parada incerta conserva `awaiting_reconciliation` e a reserva. Queda antes de
salvar candidato exige reconciliação; sem candidato reconhecido, falha e pede
nova decisão explícita. Falha depois do recibo permite recuperar o candidato
sem outro processamento. O commit terminal precede a remoção do cache privado.
O erro de uma interrupção recuperada permanece nos eventos; o estado atual
concluído não continua mostrando esse erro.

## Uso em jogos e qualificação

O adaptador Babylon empacota o carregador **glTF2 9.35.0** junto do runtime
9.35.0, com hashes, origem, integridade do pacote e licença no lock. O loader é
carregado antes do código do jogo, sem CDN. O import exato
`babylonjs-loaders/glTF/2.0` também é reconhecido pelo compilador. GLBs desse
percurso são autocontidos; decodificação remota não é uma capacidade anunciada.
Referência: [carregamento oficial Babylon](https://doc.babylonjs.com/features/featuresDeepDive/importers/glTF/).

Fontes `.blend` são preservadas no projeto/exportação de domínio, mas ficam
fora dos builds runtime web e da cópia para o editor Godot; usar GLB nesses
percursos evita executar uma conversão implícita de Blender no host.

```bash
npm run smoke:game-blender
```

O ensaio usa motor empacotado e estado/IPC temporários. Verifica geração,
reimportação com rig/animação, aplicação explícita, proveniência, reinício,
falha transacional após candidato, cancelamento e queda controlada, além de
observação Chromium de GLB e animação no Babylon. Evidências ficam em
`output/playwright/game-blender/`. Resultados executados, toolchains e limitações
devem ser registrados no [acompanhamento](GAME_DESIGN_IMPLEMENTATION_STATUS.md).

### Qualificação adicional de pesos — 2026-11-13 UTC

`scripts/qualify-game-skinning.mjs --provision=<registro-exato>` usa SDK/TLS e
serviço construídos da fonte atual, não o motor instalado. Uma imagem nova
foi provisionada separadamente, sem alterar o registro global nem a anterior.
O ABI do adaptador agora é 2, mantendo `blender-model-isolated-v1`; o registro
da imagem precisa corresponder ao hash do novo driver. Não reutilizar o registro
antigo como se qualificasse essa versão.

O ensaio `2026-11-13T05-39-46-252Z-677b64b5` produziu uma malha original de
36 vértices, dois ossos e um clip; editou o GLB registrado com transformação,
preservando pesos, clip e origem. Ambos os GLBs têm 71 vértices exportados,
21 com mistura de pesos e no máximo duas influências. No Babylon/Chromium,
a base permaneceu fixa, o topo moveu aproximadamente 1,08 m e os vértices
mistos, 0,35 m. Capturas independentes mudaram 5,15% e 4,02% dos pixels.
O teste verifica dados reais de geometria no fixture de engenharia, sem usar
um indicador de sucesso fornecido por jogo.

Foram observados os dois contêineres originais sem rede, raiz/fontes somente
leitura, sem privilégios, memória de 4 GiB e limite de 256 processos; sua
remoção foi confirmada. Reinício do serviço, aplicação explícita, exportação/
importação idempotente e preservação do `.blend` também passaram. A fonte
nativa permaneceu fora dos builds web. Não houve invocação de modelo.
Relatório, hashes e capturas:
[evidência do ensaio](../output/playwright/game-skinning/runs/2026-11-13T05-39-46-252Z-677b64b5/report.json).
É uma peça geométrica de engenharia, não personagem final, aceite de jogo,
integração instalada ou qualificação física/humana.

O Studio agora oferece [edição dirigida da receita](GAME_MODEL_EDITING.md),
com variante separada e rascunho recuperável. Isso não acrescenta manipulação
direta na viewport ou edição interna de qualquer rig importado.

Continuam pendentes: rigging deformável avançado e edição de clips
ampliados, retargeting, morph targets, colisores/LOD, geração por provedores
autorizados, bibliotecas/licenças verificadas, edição artística ampliada nas interfaces,
qualificação dos quatro adaptadores, integração Core KidOS e os aceites físicos,
humanos e de distribuição. Uma fixture processada/renderizada não é jogo final.
