# AAC no mixer dos jogos web

Fonte de desenvolvimento **2026-11-13**, GD-03/GD-04/GD-05. O módulo opcional
`@companion/game-audio`1.1.0 amplia o [mixer](GAME_AUDIO_RUNTIME.md) para variantes
M4A do [codec isolado](GAME_AUDIO_CODEC.md). Pertence ao jogo, sem inferência,
tool loop, microfone, host bridge ou codec no renderer do Companion. Não é
instalação/aceite final nem suporte a qualquer MP4 da internet.

## Caminho e contrato

Preservar o master PCM16/origem, pedir `audio.encode` pelo processador disponível,
inspecionar e aplicar o candidato pela revisão correta. Escolher explicitamente
a variante na configuração do jogo:

```ts
import {createGameAudio} from '@companion/game-audio';
const sound=createGameAudio({
  assets:{
    theme:{path:'assets/theme.compact.m4a',bus:'music',gain:.5},
    ambience:{path:'assets/wind.wav',bus:'ambience',gain:.15},
    jump:{path:'assets/jump.compact.m4a',bus:'effects',gain:.4},
  },
  states:{menu:['theme'],playing:['theme','ambience']},
});
await sound.preload(['theme','ambience','jump']);
await sound.setState('menu');
startButton.addEventListener('click',event=>sound.unlock(event).catch(showError));
```

WAV/AAC usam os mesmos buses, instâncias, cache, transições e ciclo de vida.
Não há seleção automática de qualidade ou fallback para master/outra URL.
Falhas de fetch, perfil, memória ou codec ficam explícitas. Fazer preload antes
de efeitos sensíveis a latência. Masters ainda entram no pacote atual: solicitar
só a variante não comprova redução do pacote inteiro ou primeiro jogo em10 s.

O carregamento pode avançar por estado: não existe fetch global no construtor;
`setState` carrega só as faixas necessárias, e `playEffect` carrega seu efeito se
ainda faltar. `preload` permite antecipar a próxima cena; não é obrigatório
carregar todo o catálogo. Isso é carregamento progressivo de assets inteiros,
não streaming de uma trilha longa. Duração máxima e limite PCM são independentes:
uma fonte dentro de180 s pode ser recusada por memória na taxa real do contexto.

## Inspeção antes de decodificar

A implementação verifica estrutura limitada; **não decodifica AAC**. O navegador
continua dono de `decodeAudioData`, que trabalha sobre arquivo completo e
reamostra para a taxa do contexto. A reserva considera essa taxa antes da chamada.
Referência: [Web Audio, decodeAudioData](https://www.w3.org/TR/webaudio/#dom-baseaudiocontext-decodeaudiodata).

Somente o perfil não fragmentado do encoder fixado entra:

- Até8 MiB,64 boxes percorridos e1 MiB de `moov`, tamanhos32 bits, um `ftyp`,
  um `moov` anterior a um `mdat`; sem fragmentos.
- Uma track de áudio; sem vídeo, criptografia, descritores alternativos ou
  referências externas. `dref/url` deve ser autocontido, sem endereço.
- `mp4a`v0, descritores MPEG-4 limitados, AAC-LC mono/estéreo,
  22050/44100/48000 Hz e configuração exata de5 bytes do encoder; sem SBR ativo,
  PCE, URL, dependências de stream ou extensão arbitrária de codec.
- Tempos e contagens coerentes em `mdhd/stts/stsc/stsz/stco`; um chunk interno,
  descritor único, tamanho por packet limitado e soma exata do payload.
  Cada packet admite no máximo1024 frames; a última duração pode ser menor.
- Edit list opcional limitada e grupos de priming `roll` no formato fixo,
  sem taxas de edição alternativas ou duração acima do limite. O relógio do
  filme é de1 kHz ou da própria taxa de áudio, como no muxer FFmpeg9; duração
  apresentada mais priming deve corresponder aos frames da track, dentro desse
  arredondamento, sem alongamento artificial ou relógio arbitrariamente grosseiro.

AAC de outro encoder, MP4 fragmentado, HE-AAC, multicanal, QuickTime ou streaming
longo precisam de conversão própria antes de empacotar. Trocar a extensão não
converte o formato. Referência do muxer: [FFmpeg movenc](https://ffmpeg.org/doxygen/trunk/movenc_8c_source.html);
a versão/receita efetiva fica no lock do codec, sem consumo da branch mutável.

A duração nominal de até180 s admite só padding limitado. A reserva usa contagem
de packets ×1024, reamostrada para o contexto, com tolerância de arredondamento;
não confia no tamanho comprimido ou num campo preenchido pelo projeto. Cache e
reservas PCM seguem64 MiB; leitura codificada segue32 MiB concorrentes,
16 MiB/arquivo WAV ou8 MiB/AAC.

Após o decode, canais, taxa, comprimento e duração precisam caber na estrutura e
reserva. Falhas liberam contadores sem aplicar buffers ou iniciar voz. O intervalo
aceita remoção de priming/padding de até4096 frames, sem prometer identidade entre
browsers ou loops sem emenda. Medir e ouvir os loop points reais.

São limites do helper, não confinamento formal do codec nativo ou orçamento de
toda a memória do processo. O jogo já pode usar outras APIs web permitidas pelo
jogador, sob suas próprias políticas.

## Versões e autoridade

O lock aponta para `game-audio-1.1.0.mjs`, com SHA-256 e a mesma licença MIT
integral. Fonte1.0.0 e builds anteriores permanecem exatos; não reescrever um
artefato antigo para promovê-lo. Novos builds incluem a identidade do novo lock,
sem baixar módulos. Sem import explícito, não há helper/contexto/licença extra.

O Core fixo continua sem resolver `@companion/game-audio`, com binding legado
e teste de recusa. M4A no workspace não provisiona codecs ou ferramentas infantis,
não habilita Unity/Godot e não transforma uma interface no motor.

## Verificação

Testes estruturais cobrem seis combinações de taxa/canais e tabelas forjadas;
seu payload sintético não é AAC nem prova decode. Os controles anteriores passam
a exercitar1.1.0; AAC excedente, extensão incompatível e referência externa são
recusados antes do codec. O hash do fonte1.0.0 fica preservado. Integridade do
módulo corrente, licença, import explícito e ausência/recusa Core são verificados.

`qualify-game-audio-runtime.mjs --engine=<exato> --codec=<registro>` produz seis
combinações reais por engine no encoder isolado, aplica candidatos, exporta
Phaser/Babylon e encerra o serviço antes dos players. Observa preload, gestos,
loops, efeitos, mute, pausa/retomada/fechamento e PCM offline nos três browsers
de teste. Firefox conserva o modo explícito de três grafos estáticos, pois não
implementa suspensão offline. Sem `--codec`, o roteiro mantém a qualificação WAV.

O [dossiê](../output/game-generation/audio-mixer-aac-20261113-a1/) registra
resultados/encerramentos antes de qualquer conclusão. Audição real, dispositivos,
matriz comercial, jogos acabados, generalização, clientes instalados e integração
protegida continuam gates próprios do plano integral.

### Resultado observado

O ensaio final `2026-11-13T13-43-44-438Z-60dabd87` passou com o pacote de481 arquivos,
manifesto `2dfe3727…`, Node22.23.4/darwin-arm64. Produziu12 candidatos AAC reais
(seis combinações por engine), preservou masters e exportou os dois jogos de
fixture. O serviço encerrou com código0 antes dos seis previews. Os contextos
nativos carregaram todas as combinações, e gesto/estado/ambiente comum/efeito/
mute/pausa/retomada/fechamento passaram, sem erros ou pedidos bloqueados.

PCM offline mostrou predomínio de220 Hz no menu (~0,1834) e660 Hz no jogo
(~0,1292–0,1302), com RMS zero após mute. Chromium/WebKit mediram a troca no
mesmo grafo; Firefox usou três grafos estáticos identificados e os controles
interativos, sem alegar PCM do crossfade. Os inventários Firefox/WebKit ficaram
inalterados, e previews/HOMEs/listeners foram encerrados/removidos.

Passaram738 testes e31 verificações, um opt-in ignorado, checks/builds dos clientes
e roteamento simulado. A primeira suíte tinha duas expectativas ainda fixadas
no módulo1.0 (banner e arquivo adulterado); os erros foram preservados, e os
testes agora verificam o módulo corrente do lock. O hash do1.0 permaneceu exato.
Nenhuma inferência, renovação de alocação, instalação ou publicação. As fontes
são tons sintéticos: essas medições não aprovam música, audição física ou jogo.

A regressão WAV do mesmo pacote, `2026-11-13T13-43-41-839Z-e4a839b3`, passou
também nas seis combinações, com o serviço desligado antes do player. Os ensaios
anteriores `13-31-02…` (AAC) e `13-35-06…` (WAV) ficam no pacote anterior,
antes da conferência adicional de timeline; não são o aceite final.

O controle estrutural anterior aceitava um filme de180 s com track de1 s. A
revisão agora recusa essa divergência antes do codec; não se testou exploração
ou alocação real desse fixture sem AAC. A tentativa `13-39-28…` foi recusada
durante preload por presumir relógio de1 kHz, enquanto o encoder fixado usa a
taxa do áudio. Falha/PNG/encerramento e pacote foram preservados. A correção
aceita só1 kHz ou a taxa exata da track e mantém a relação entre duração,
priming e pacotes; fixtures cobrem ambos os relógios. Não houve relaxamento
genérico de contagens, recursos, CSP, erro ou qualificação.
