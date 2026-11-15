# Comparar imagem e áudio entre revisões

Fonte de desenvolvimento de **2026-11-13**, GD-03/GD-08. Complementa a
[comparação estrutural e textual](GAME_REVISION_COMPARISON.md), sem executar
jogos, processar assets ou substituir o aceite artístico e humano.

## Percurso no Studio

Em **Revisões**, selecione duas revisões, filtre **Arquivos** e abra **Comparar
conteúdo** no arquivo desejado. **Comparar imagem/áudio** consulta os arquivos
preservados naquele par. O título conserva as revisões e hashes originais,
inclusive se o projeto já tiver revisões posteriores.

Imagens aparecem lado a lado, ajustadas à área disponível; **Imagens em tamanho
original** permite conferir os pixels sem reduzir a imagem, com rolagem dentro
de cada área. O navegador informa as dimensões decodificadas. Em janela estreita
as duas versões ficam empilhadas. Isso não calcula similaridade, não interpreta
a imagem nem atribui qualidade visual.

WAV oferece os controles de áudio do navegador, sem reprodução automática.
Iniciar uma versão pausa a outra. Trocar de área ou ocultar o documento pausa
os áudios; retornar não os reinicia. As posições são independentes, porque duas
revisões podem ter cortes ou durações diferentes. Não há análise de loudness,
sincronização musical, waveform ou alegação de qualidade sonora.

Fechar a mídia remove as fontes e invalida a consulta visual. Uma resposta
atrasada não reabre nem preenche o painel. Isso descarta a apresentação de uma
leitura; não cancela jobs nem resolve efeitos desconhecidos. Outra comparação,
fechamento do arquivo ou seleção de projeto também remove a mídia anterior.

## Fronteiras e contrato

`packages/contracts/src/game-studio.ts` define o comando de host `revision-media`:
projeto, revisão positiva explícita, caminho de projeto e SHA-256 esperado.
Não aceita namespace, URL, caminho do host ou revisão implícita atual. Não é um
novo RPC de inferência, registro ou produção.

`GameStudioController` usa o SDK autenticado e as operações já existentes de
revisão/transferência. Exige que o arquivo pertença ao catálogo de assets daquela
revisão, coincida com o hash pedido e seja PNG/JPEG/WebP ou WAV, com até 4 MiB
por versão. Confere tamanho e SHA-256 dos bytes recebidos e revalida o projeto
selecionado depois da transferência. Retorna também o hash da revisão; o
renderer confere esse vínculo antes de exibir. O serviço continua impondo o
namespace do cliente e a autorização de leitura.

Os lados são transferidos separadamente, pelas partes existentes; não há uma
resposta de protocolo contendo os dois arquivos grandes. Cada lado carrega
seus próprios metadados. Arquivo ausente é indicado; lado fora do formato ou
limite oferece exportação integral. SVG, código, GLB e HTML não são abertos
por esse percurso. O visor vetorial reconhecido e o visor 3D continuam separados.
Erro de decodificação do navegador preserva os bytes e oferece exportação.

A interface apenas apresenta mídia do host. Não contém codec, IA, escrita no
projeto, confirmação de aplicação ou registro de qualidade. Modo Plano e projetos
somente de leitura podem comparar. Mac e VS Code compartilham renderer e
controlador; suas pontes e seleção de destino permanecem nos respectivos hosts.
Não altera o Core, a política ou a integração protegida KidOS.

## Evidência exigida

`test/engine-game-studio.test.ts` verifica revisões históricas após outra edição,
bytes exatos, leitura sem aprovação, hash errado, campo de namespace forjado,
revisão inválida, arquivo não registrado, formato/tamanho recusados, bytes
adulterados e mudança de seleção durante a leitura. Originais, revisão atual e
fila de produção permanecem intactos.

`scripts/qualify-game-media-comparison.mjs --engine=<bundle-exato>` usa Node e
serviço empacotados, SDK/TLS, renderer real, imagens/WAV sintéticos e pontes dos
hosts emuladas em Chromium. Confere pares históricos, tamanho original/janela
estreita, resposta atrasada após fechar, controles nativos por teclado/ponteiro, reprodução
exclusiva, pausa sem reinício e ausência de builds/aplicação/qualidade. Não chama
modelo nem modifica instalações pessoais. Conserva falhas e encerra somente os
recursos temporários próprios.

Relatórios e capturas ficam em `output/playwright/game-media-comparison/`; o
[dossiê](../output/game-generation/media-comparison-20261113-a1/report.json)
vincula o resultado observado, fontes e pacote exato. Estado de reprodução no
navegador não comprova audição física, headset, latência ou qualidade musical.
Pontes emuladas não comprovam janelas instaladas, demais plataformas ou aceite
final de jogos.

O ensaio final `2026-11-13T11-36-27-893Z-dca36b59` passou nos dois produtos,
incluindo fechamento durante resposta atrasada, imagens em1200/600 pixels e
teclado/ponteiro nos controles de áudio visíveis. Serviço encerrou com código0,
navegador fechou e o pacote foi reverificado. Passaram719 testes e31 verificações,
com um opt-in ignorado, tipagem, builds extensão/Mac/motor e roteamento simulado.
Nenhuma chamada de modelo, instalação ou publicação.

A primeira tentativa `2026-11-13T11-31-55-062Z-42edb338` revelou que a trava
geral de botões impedia Fechar mídia durante a leitura. A exceção agora permite
apenas descartar essa apresentação local; não desbloqueia outra escrita. A
segunda, `2026-11-13T11-33-03-347Z-dc35e4ce`, não comprovou o foco do play nativo
ao focar o segundo elemento audio e pressionar Espaço. O roteiro passou a usar
o botão de play observado por ponteiro no destino, mantendo teclado na origem;
não chama `.play()` para fabricar o resultado. O ensaio intermediário
`2026-11-13T11-35-04-691Z-1d5eff54` passou antes do acabamento das legendas.
Todos esses resultados permanecem preservados, assim como a asserção inicial de
teste que esperava uma mensagem localizada em vez do erro estruturado de schema.
