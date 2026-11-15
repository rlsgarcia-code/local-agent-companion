# Áudio por estado nos jogos web

Fonte de desenvolvimento, **2026-11-13**, GD-03/GD-04/GD-05. O módulo opcional
`@companion/game-audio` 1.1.0 reproduz música, ambientes e efeitos em jogos Phaser
e Babylon. Não gera conteúdo sonoro nem substitui direção musical ou revisão
física. O processamento e as medições de WAV continuam no
[worker de assets](GAME_AUDIO_ANALYSIS.md); o mixer pertence ao **jogo**, sem
inteligência ou lógica de agente nas interfaces Mac/VS Code.

O [suporte AAC1.1](GAME_AUDIO_AAC_RUNTIME.md) acrescenta variantes M4A do encoder
isolado ao mesmo mixer, com inspeção limitada e reserva antes do decode nativo.
O fonte1.0 e sua qualificação WAV abaixo permanecem históricos; os resultados
AAC/1.1 têm dossiê próprio. Não há fallback automático de formato.

## Contrato e uso

Atualização posterior: o workspace usa adaptador4 para incluir também o lock do
[save opcional](GAME_SAVE_RUNTIME.md), sem modificar os bytes do mixer1.1. O
perfil fixo Core continua em adaptador1. As versões2/3 abaixo identificam as
frentes históricas de áudio/seleção, não uma instalação nova.

O compilador aceita o import exato, a partir de bytes locais fixados em
`packages/adapter-game-web/audio.lock.json`. Nenhum pacote, CDN, plugin ou módulo
é descoberto na máquina. Fonte e licença são conferidas antes do build; adulteração
recusa disponibilidade/compilação. O bundle contém a implementação e comentário
legal; a licença MIT integral fica em `engine/GAME-AUDIO-LICENSE.txt`.

Sem import explícito, o jogo não recebe script, contexto de áudio ou arquivo
de licença adicional. O perfil workspace agora usa versão de adaptador 2 com
o lock comum na identidade. O perfil fixo Core permanece em adaptador 1, sem
anunciar, carregar ou resolver esse import, mesmo quando os arquivos comuns
existirem ao lado. Isso não proíbe todo áudio em JavaScript infantil; preserva
a fronteira do novo módulo/compilador até qualificação protegida própria.

```ts
import {createGameAudio} from '@companion/game-audio';

const sound=createGameAudio({
  assets:{
    title:{path:'assets/title.wav',bus:'music',gain:.5},
    level:{path:'assets/level.wav',bus:'music',gain:.6},
    wind:{path:'assets/wind.wav',bus:'ambience',gain:.15},
    jump:{path:'assets/jump.wav',bus:'effects',gain:.4,maxInstances:3},
  },
  states:{menu:['title'],playing:['level','wind'],quiet:[]},
});
await sound.preload(['title','level','wind','jump']);
await sound.setState('menu'); // prepara, sem tocar antes do gesto
startButton.addEventListener('click',event=>{
  sound.unlock(event).catch(showAudioError);
});
// Nas transições e eventos do jogo:
await sound.setState('playing',{fadeMs:350});
const result=await sound.playEffect('jump');
if(!result.played)showOptionalSoundStatus(result.reason);
sound.setVolume('music',.4,{fadeMs:100});
sound.setMuted(true);
await sound.pause();
resumeButton.addEventListener('click',event=>{
  sound.resume(event).catch(showAudioError);
});
// Ao destruir o jogo/preview:
await sound.close();
```

Os controles e funções de erro do exemplo pertencem ao projeto. Reutilizar uma
instância entre cenas; não criar um contexto por efeito. O jogo deve explicar
falhas e escolhas de som em sua própria UI. IDs inexistentes, fontes inválidas
ou memória insuficiente geram diagnóstico; não se troca engine, formato ou fonte
silenciosamente. `snapshot()` é estado do controlador, não medição acústica.

Cada estado admite uma música e até cinco ambientes. Loops preservados entre
estados continuam no mesmo nó/posição. Trocas usam rampas lineares de ganho;
não são sincronização por compasso nem promessa de crossfade de potência constante.
Faixas que saem encerram ao final do fade. Transições novas não acumulam caudas
indefinidamente; uma cauda já superada é encerrada para liberar o limite.
Um carregamento antigo que termine depois de outra escolha não retoma o estado
anterior. Falhar no carregamento conserva o estado que já estava ativo.

Fontes podem declarar `loopStart`/`loopEnd` em segundos, dentro do áudio
decodificado; reprodução do loop começa no início desse intervalo. Efeitos
aceitam ganho, panorama e rate de 0,5–2. Não são posicionamento 3D, MIDI, trilha
adaptativa por batida ou streaming de música longa.

## Recursos e ciclo de vida

Ganho master, music, ambience e effects são independentes, entre 0 e 1. Mute não
apaga os volumes escolhidos e continua ativo após pausa/retomada. Cada efeito
tem limite de instâncias. O total padrão é 24 vozes, configurável de 12 a 32;
doze lugares ficam reservados aos loops/transições. Efeito excedente retorna
`played:false` com motivo, sem roubar música ou iniciar outra execução.

O helper busca apenas caminhos relativos `assets/*.wav` ou `assets/*.m4a`, da origem do próprio
jogo, sem query, URL externa, travessia ou redirecionamento. Nomes são codificados
por segmento. `credentials:'same-origin'` conserva somente a autenticação normal
dos recursos do jogo — necessária ao listener privado do preview — e não envia
credenciais de inferência. CSP, cookies privados, verificação de bytes e bloqueios
de rede/dispositivos do jogador permanecem nas autoridades existentes.

Usa WAV PCM16 canônico ou o perfil AAC-LC fixado, mono/estéreo, nas três taxas existentes.
Converte outras fontes explicitamente no pipeline antes de empacotar. Limites
por instância:64 assets/estados,16 MiB WAV/8 MiB AAC por arquivo,32 MiB codificados em leitura
concorrente e 64 MiB de PCM decodificado/cache. O cabeçalho limita duração e
quantidade esperada de samples **antes** da decodificação nativa; reservas são
liberadas nas falhas, sem contadores negativos. Leituras simultâneas do mesmo
asset compartilham a promessa. Isso não é sandbox do processo: um projeto pode
usar outras APIs web já permitidas pelo jogador, sujeito às suas restrições.

Contexto real começa com master silencioso e nenhuma voz. `unlock`/`resume`
exigem um evento nativo confiável e a ativação presente quando disponível.
Não há tentativa de contornar a [política de autoplay do navegador](https://developer.chrome.com/blog/autoplay/).
Ocultar a página/interromper o contexto pausa, captura posições dos loops e
encerra efeitos; voltar não reinicia áudio automaticamente. BFCache pausa;
saída definitiva fecha. Encerrar aborta leituras, descarta respostas tardias,
desconecta os nós e fecha somente o contexto criado pela própria instância.
Contextos injetados continuam pertencendo ao chamador; são silenciados/desconectados
apenas os nós desse mixer, sem suspender ou fechar outros sons do contexto.

Um `OfflineAudioContext` nativo injetado aceita renderização inaudível explícita
sem gesto; não concede playback ao hardware. A API do runtime não depende de
`OfflineAudioContext.suspend`. Automação e grafos usam a
[Web Audio API](https://www.w3.org/TR/2021/REC-webaudio-20210617/), não um loop de
IA, worker de áudio, microfone, gravação ou bridge administrativa.

## Evidência histórica1.0 e limites

Cinco testes de controle com contextos simulados cobrem deduplicação, instâncias,
transições fora de ordem, encerramento durante decode, reservas antes do codec,
mute/pausa, gesto sintético, limites e configuração inválida. Não provam PCM.
Testes reais do compilador cobrem os dois imports, licença, adulteração, omissão
e recusa pelo worker Core com binding legado válido.

`scripts/qualify-game-audio-runtime.mjs --engine=<bundle-exato>` constrói os
dois projetos pelo Node/SDK/TLS/compilador empacotado. Exporta bytes verificados
e **encerra o Agent Service antes de abrir qualquer jogador**. Cada build é
aberto no Chromium instalado e nos Firefox/WebKit de teste fixados. Observa
gesto real, contexto em execução, efeitos, mudança de estado com ambiente comum,
mute, pausa, retomada preservando mute e fechamento. Não habilita autoplay por
flag, captura de microfone, workers ou rede externa.

Os grafos nativos offline medem samples: a frequência do menu predomina antes,
a do jogo depois, e o trecho muted tem RMS zero. **A cobertura difere**:

- Chromium e WebKit: um grafo, transição programada e mute na mesma renderização.
- Firefox instalado: não oferece `OfflineAudioContext.suspend`; usa três grafos
  estáticos nativos separados para menu/jogo/mute, além das transições interativas.
  Não comprova PCM do crossfade nesse navegador.

A primeira tentativa foi recusada ao chamar a API offline ausente no Firefox.
O erro, PNG, resultados Chromium e encerramento foram preservados. A distinção
não é um fallback do produto nem filtro de erros: só o roteiro de observação
seleciona uma medição explicitamente identificada, mantendo os controles reais.
O [dossiê](../output/game-generation/game-audio-runtime-20261113-a1/report.json)
vincula cada caminho ao pacote/artefato e conserva versões anteriores.

O ensaio final `2026-11-13T12-25-53-311Z-4dcac193` passou nas seis combinações.
Usou o pacote de desenvolvimento de 477 arquivos, manifesto `f6e3ddb0…`, próprio
para esta revisão. Foram preservados os dois pacotes anteriores e os ensaios
`2026-11-13T12-17-12-857Z-7ab254e6` (recusado) e
`2026-11-13T12-19-39-549Z-6f2c84d1` (passou antes da validação explícita de cinco
ambientes). O último não é prova da revisão final. Os seis previews fecharam;
FF/WebKit confirmaram inventários inalterados e recursos/HOME removidos. O
serviço terminou com código 0 antes do playback e o pacote foi reverificado.
Passaram 731 testes e 31 verificações, um opt-in ignorado, check/builds e roteamento
local simulado. Não houve modelo, instalação, publicação ou renovação de cota.

Essas fontes são tons sintéticos declarados e canvases de fixture. Estado de
playback e PCM offline não comprovam audição física, qualidade musical, jogo
final, browser comercial, GPU/dispositivo ou instalação. A política Core,
integração Unity/Godot, arte/áudio finais e aceite humano continuam no plano.
