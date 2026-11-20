# Linha do tempo de edição de chaves 3D

Fonte **2026-11-13**, parte de GD-03/GD-08. O formulário de
[edição dirigida 3D](GAME_MODEL_EDITING.md) agora apresenta uma régua gráfica por
trilha existente. É edição da receita preservada, não reprodução, deformação ou
novo executor. O [visor 3D](GAME_MODEL_VIEWER.md) continua separado.

## Operação

Em **Assets → Revisar candidato → Ajustar modelo 3D → Animações**, abrir uma
trilha mostra suas chaves e duração em quadros. A posição horizontal representa
somente o quadro; não há curva de interpolação ou avaliação simulada do Blender.

- Selecionar um marcador abre a página dos campos daquela chave. Botões permitem
  percorrer todas as chaves, inclusive as que não estão na página numérica atual.
- Arrastar propõe um quadro inteiro. Soltar aplica a mudança ao rascunho; Escape,
  cancelamento do ponteiro ou perda da captura descarta o movimento não confirmado.
- No marcador focado, setas movem um quadro, Shift move dez, Home/End propõem
  começo/fim. Quadros ocupados ou fora da duração são recusados, sem deslocar
  outras chaves ou escolher outro quadro silenciosamente.
- O controle **Quadro para nova chave** escolhe a posição; **Copiar chave neste
  quadro** copia explicitamente os valores da chave selecionada. Não interpola
  nem cria um valor presumido. **Remover chave selecionada** preserva ao menos
  uma chave por trilha.
- Reduzir a duração não corta chaves existentes. Quadros inválidos/repetidos
  continuam nos campos com diagnóstico e exigem correção explícita. Ordem,
  identidades, valores e trilhas não editados permanecem preservados.

São mantidos os limites canônicos de 600 quadros,256 chaves por trilha e8.192
chaves no conjunto. Uma duração inválida bloqueia operações gráficas. A régua
não redesenha a geometria nem oferece reprodução automática; sua visualização
não comprova pose, rigging, estética ou jogabilidade.

## Estado e fronteiras

A implementação fica no renderer compartilhado `packages/game-studio-ui/studio.js`
e usa SVG local, CSS externo e eventos de apresentação. Não acrescenta dependência,
requisição de rede, acesso ao host, operação Agent API ou inferência. O contrato
`model.scene` e o controlador existente continuam validando todos os dados.

Mudanças confirmadas atualizam o mesmo `mediaEdit` e usam os rascunhos privados do
host, com CAS/fsync e limite de2 MiB. Mover o cursor e selecionar não despacham
processamento. **Gerar variante** congela o pedido, persiste-o e passa pela
confirmação existente. Um pedido preservado deixa os marcadores com
`aria-disabled=true`; teclado/ponteiro não alteram a receita congelada. A variante
continua privada até aplicação explícita. Negar uma retomada não liquida o
resultado desconhecido anterior.

O Mac e o VS Code consomem a mesma fonte. KidOS continua dependendo do adaptador
protegido/Core, sem receber Docker, shell ou autoridade de workspace desta UI.

## Verificação

O ensaio opt-in amplia o percurso existente, com serviço/SDK/TLS da fonte,
Blender isolado exato, rascunhos em arquivos privados e renderer em Chromium:

```bash
env -u OPENAI_API_KEY node scripts/qualify-game-model-editing.mjs --timeline \
  --provision=output/game-generation/weighted-skinning-20261113-a1/blender.json
```

As pontes e confirmações Mac/VS Code são emuladas; isso não é teste nativo ou
instalação. O percurso exercita ponteiro, teclado, Escape, quadro ocupado,
cópia/remoção, duração reduzida sem perda, layout de600 pixels, recuperação,
congelamento, geração real da variante, resposta perdida, recusa e repetição
idempotente após reinício, visor e aplicação explícita. Preserva originais,
arquivos derivados, capturas, fontes e encerramento dos trabalhos próprios.
Não chama modelos nem aprova a qualidade do jogo.

O [dossiê](../output/game-generation/key-timeline-20261113-a1/report.json)
registra as execuções e verificações realmente concluídas. Não limpar ou
recompilar `dist-tests` durante esse ensaio. Um timeout exige inspecionar o
trabalho original, nunca iniciar outro para substituí-lo.

Continuam pendentes: curvas/interpolação editáveis, transformação direta na
viewport, criação/retargeting de rigs e trilhas, edição de rigs importados,
receitas grandes, dispositivos assistivos/toque físicos, aceite nativo/instalado
e arte final nos jogos completos. Esta régua não conclui o plano integral.
