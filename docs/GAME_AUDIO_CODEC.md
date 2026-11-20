# Variantes AAC de áudio para jogos

Fonte de desenvolvimento **2026-11-13**, separada da instalação/release. Leia a
[cadeia de assets](GAME_ASSET_PIPELINE.md), o [runtime web](GAME_AUDIO_RUNTIME.md)
e a [arquitetura da suíte](SUITE_ARCHITECTURE.md). O plano integral continua em
[Game Design 1.0](GAME_DESIGN_IMPLEMENTATION_PLAN.md).

## Responsabilidades e contrato

`packages/adapter-game-audio-codec` implementa a porta opcional
`audio-codec-isolated-v1`, somente para Mac/VS Code com autoridade workspace.
O Agent Service a registra no catálogo existente; disponibilidade exige imagem
fixada e provisionamento administrativo explícito. Não há novo agente, scheduler,
processo no renderer ou registro de ferramentas por RPC.

`packages/contracts/src/game-audio-codec.ts` define `audio.encode`, receita estrita:

```json
{
  "processorId": "audio-codec-isolated-v1",
  "target": {"id": "theme-delivery", "role": "Tema para distribuição", "placeholder": false},
  "operation": {
    "type": "audio.encode",
    "codec": "aac-lc",
    "source": {"assetId": "theme-master", "path": "assets/theme-master.wav"},
    "outputBase": "assets/theme",
    "variants": [
      {"id": "compact", "bitrateKbps": 64},
      {"id": "standard", "bitrateKbps": 128}
    ]
  }
}
```

A fonte deve ser WAV PCM16 canônico, registrada como áudio na revisão exata:
mono/estéreo, 22050/44100/48000 Hz, até180 segundos. Tamanho/hash e cabeçalho são
conferidos antes do processo. O codec não decodifica formatos arbitrários de
entrada. `audio.render` pode preparar o master; importar outra origem exige
conversão autorizada própria. A extensão de um arquivo não converte seu conteúdo.

Aceita uma a três variantes com IDs únicos e taxas explícitas64/96/128/192 kbps.
Produz `<base>.<id>.m4a` (AAC-LC em MP4 com metadados antes da mídia) e
`<base>.encoded.json`. Não aceita shell, parâmetros livres, scripts, filtros,
URLs ou dependências do projeto. Não muda o provedor de IA nem faz inferência.

O relatório vincula o hash do master, taxa, canais e frames aos caminhos,
tamanhos e hashes dos resultados. O driver decodifica cada variante pelo mesmo
FFmpeg para conferir dimensões e medir RMSE/SNR sobre os samples PCM16 iniciais
comparáveis. A diferença de até2048 frames é tolerância explícita de padding AAC,
não promessa de loops sem emenda, identidade de amostras ou fidelidade perceptual.
Esses números não medem LUFS, qualidade musical, licença de assets ou audição.
O serviço verifica também tabela limitada dos boxes MP4, sem apresentá-la como
outro decodificador AAC independente.

## Fonte, build e execução

`toolchain.lock.json` fixa FFmpeg9.0.2, arquivo de fonte/assinatura/chave por
tamanho e SHA-256, fingerprint do publicador e imagem Linux x64 por digest.
`scripts/prepare-game-audio-codec.mjs` consome somente insumos públicos já baixados,
verifica assinatura com GPG em container sem rede e extrai a fonte com limites de
tipo/caminho/quantidade/tamanho. O build offline não baixa componentes. A receita
inclui o lock, hash do driver e versão de política; gera diretório e registro
novos, recusando substituir um registro existente.

O build desliga autodetecção, rede, GPL e nonfree; habilita apenas o necessário
para WAV PCM16 e AAC/MP4, sem usar o FFmpeg global do Mac. Versão, configuração,
licença, formatos, codecs e protocolos são capturados como evidência. A base de
build/runtime é fixada; isso não equivale a auditoria de todas suas dependências.
Fonte oficial: [downloads](https://ffmpeg.org/download.html),
[licenciamento](https://ffmpeg.org/legal.html) e
[codec AAC](https://ffmpeg.org/ffmpeg-codecs.html#aac).

O administrador provisiona `<estado-do-serviço>/toolchains/audio-codec.json` com
schema, versão, arquitetura, image ID, hashes do driver/receita e executável Docker
absoluto. O serviço confere o registro, IPC local do daemon, arquitetura e label
da imagem; ausência/divergência mantém a porta indisponível, sem auto-instalação,
pull ou fallback para codec do host. O alvo atual é Linux x64: no Mac ARM64 há
emulação explícita; não é prova nativa das cinco plataformas.

A operação usa o dono de processos existente em `adapter-game-container/job.ts`:
binding durável por job/namespace/fonte/toolchain/imagem, container nomeado,
sem rede, raiz somente leitura, usuário sem privilégios, sem capabilities,
`no-new-privileges`, limites de memória/processos/tempo e tmpfs de trabalho.
Somente o input congelado é montado. A coleta TAR não extrai no host; exige
exatamente os arquivos esperados, limites, hashes e relatório estrito.

Cancelamento exige confirmação do encerramento do container original. Resultado
incerto conserva reserva/identidade e exige reconciliação; recuperar não codifica
novamente. Não inspecionar/remover containers arbitrários a partir de nomes
parecidos. O helper é uma fronteira por operação, não outro loop de inteligência.

## Aplicação, interfaces e distribuição

O resultado é candidato imutável. A aplicação existente exige revisão correta,
preserva WAV/proveniência/ancestralidade placeholder e cria outra revisão. A
aprovação do pedido não antecipa sucesso nem qualidade. Repetição com o mesmo ID
e conteúdo recupera o mesmo job; outro conteúdo com o ID é recusado.

O Studio compartilhado permite inspecionar AAC/MP4 nas mesmas ações de candidato,
asset e comparação histórica; valida bytes/seleção e conserva o limite de4 MiB
por arquivo. O navegador decodifica e a reprodução exige ação do usuário.
O [formulário de variantes](GAME_AUDIO_VARIANTS_STUDIO.md) usa os mesmos pedidos
tipados, confirmação e aplicação separada; a recuperação consulta o registro
original antes de qualquer reenvio. Os hosts não executam FFmpeg.

O módulo `@companion/game-audio`1.0.0 aceita somente WAV PCM16. O fonte posterior
[1.1.0](GAME_AUDIO_AAC_RUNTIME.md) acrescenta esse perfil AAC com inspeção e
reservas; tem qualificação distinta, sem reinterpretar o ensaio do codec abaixo
como prova do mixer. AAC também pode usar HTMLAudioElement/loader da engine.
Sem configuração adicional, o compilador conserva masters no pacote. A opção
posterior de [recursos para distribuição](GAME_WEB_DELIVERY_SELECTION.md) permite
escolher variantes e manter masters só no projeto editável, conservando os
metadados/avisos registrados. Tem binding/qualificação próprios; não reinterpreta
os ensaios anteriores como prova de pacote reduzido. Reduzir os bytes solicitados
pelo player não comprova redução do pacote completo nem primeiro carregamento
dentro da meta do produto.

O worker local de mídia recusa `audio.encode`; o contrato fixo do Core também o
recusa explicitamente. Não é uma integração protegida KidOS, acesso infantil ao
Docker ou autorização parental. Essa integração exige sua própria cadeia assinada,
provisionamento e aceite nativo.

O bundle de desenvolvimento inclui driver, lock e textos de licença, **sem**
FFmpeg/imagem/tar de fonte. Publicar o componente opcional requer fonte
correspondente, receita/configuração e avisos completos, além da verificação das
obrigações de toda a imagem e plataformas. O build mínimo e a assinatura de fonte
não são certificação jurídica nem distribuição final. Não promover estes insumos
a release/instalação sem as verificações próprias.

## Verificação

- `test/game-audio-codec.test.ts`: schema, tipos/fontes, limites de WAV/MP4,
  bindings e resultado; MP4 sintético estrutural não prova codec.
- `test/game-media-worker.test.ts`: novo pedido recusado no contrato Core fixo.
- `scripts/qualify-game-audio-codec.mjs --engine=<bundle-exato> --codec=<registro>`:
  serviço/SDK/TLS empacotados, WAV do worker, encode real isolado, candidato,
  aplicação, replay após reinício, namespaces e exportação Phaser/Babylon.
  As pontes Studio são emuladas; players observados usam bytes exportados após
  encerrar o serviço. Browsers Playwright não substituem matriz física/comercial.

O dossiê desta entrega fica em
[`output/game-generation/audio-codec-20261113-a1/`](../output/game-generation/audio-codec-20261113-a1/).
Resultados positivos, falhas, encerramento e limites devem ser registrados antes
de apresentar a qualificação como concluída. Codec, aceitação sonora/artística,
Unity/Godot, integração instalada, jogadores e distribuição são gates distintos.

### Resultado observado em 13/11

O ensaio final `2026-11-13T13-15-56-879Z-aa3fd823` passou: dois namespaces,
master do worker de960044 bytes, variantes de42041/82017 bytes, proveniência,
aplicação separada, replay após reinício e recusa de ID reaproveitado com outro
conteúdo. O Studio real usou as duas pontes de host emuladas e seu armazenamento
privado de rascunhos. Builds Phaser/Babylon exportados tocaram/pausaram AAC e
decodificaram240000 frames estéreo em Chromium e Firefox/WebKit Playwright,
sem Agent Service ativo durante a reprodução. Foi observada diferença entre a
duração da mídia no WebKit (4,9773 s) e do PCM decodificado (5 s): não alegar loops
sem emenda a partir disso. Audição física e clientes instalados não foram testados.

O roteiro usa botões próprios do jogo sobre HTMLAudioElement nativo. Uma tentativa
anterior com os controles opcionais do próprio WebKit registrou falhas nos ícones
blob desses controles sob a política do artefato. Essa falha foi preservada;
não houve filtro de erros, relaxamento de CSP ou correção/aceite desses widgets.
Também foram preservados o bloqueio inicial de IPC pelo ambiente de execução e
o erro do roteiro que esperava três arquivos e desconsiderava a proveniência.

`qualify-game-audio-codec-lifecycle.mjs` observou o FFmpeg real executando em cada
container antes de cancelar/derrubar seu serviço proprietário. O ensaio final
`2026-11-13T13-15-52-718Z-897e2df6` confirmou cancelamento e ausência do container;
após SIGKILL, o job ficou em reconciliação e terminou como falho por não haver
candidato durável, sem recodificar, aplicar ou criar outro job. Isso é recuperação
segura de resultado ausente, não continuação automática da codificação.

A primeira tentativa do harness não limpou seu socket morto antes de reiniciar;
o serviço recusou ocupar o endpoint existente. O job/container original foi
inspecionado e reconciliado separadamente, sem reexecução. O roteiro corrigido
somente remove o socket de seu próprio filho confirmado encerrado, com recusa de
conexão e inode/dispositivo/UID preservados. Instalações usam o bootstrap normal;
essa limpeza do harness não altera o serviço de produto nem endpoints alheios.
