# Correio: barco visível e campanha responsiva

Desenvolvimento de **2026-11-13**, sem instalação, publicação ou nova inferência.
Integração manual sobre a [revisão responsiva53](GAME_WINDMAIL_RESPONSIVE_UI.md),
preservada. Não é geração autônoma, pedido inédito ou aceite integral do plano.

Continuação separada: [foco e teclado na revisão55](GAME_WINDMAIL_FOCUS_RECOVERY.md).
O diagnóstico posterior localizou a falha reproduzida em um diálogo oculto.
Os resultados54 abaixo permanecem históricos desse artefato.

## Problema observado e correção

Os PNGs dos percursos53 mostram o rótulo DOM “4 Garças” cobrindo a bandeira e,
depois, quase todo o barco. A primeira leitura externa exigia pixels dourados;
outra tentou a vela clara, mas também perdeu o casco sob o rótulo. Ambas falharam
e continuam preservadas. É um problema de apresentação para quem joga, não uma
prova de erro de física ou dos controles.

A [fonte separada](../examples/game-integrations/windmail-labels/README.md)
oculta temporariamente o nome que se sobrepõe ao retângulo visual do barco.
O rótulo reaparece quando o barco se afasta; o destino permanece no HUD.
`visibility` conserva a geometria. As caixas DOM são medidas após resize e
convertidas ao mapa1024×768, sem leituras de layout a cada quadro. A margem de3px
protege a silhueta; não muda colisores, raio de entrega, velocidade ou pontuação.

O jogo passa à sua própria apresentação o retângulo retornado por
[`getBounds`](https://docs.phaser.io/api-documentation/namespace/gameobjects-components-getbounds),
que considera escala/rotação. Reutiliza o mesmo objeto Rectangle. Não é uma ponte
de diagnóstico nem estado exposto ao observador. Documentação4.1, runtime4.2.1.
O [patch exato](../scripts/game-qualification/windmail-labels-patch.mjs) exige os
hashes de main/chrome/world53 e compara o bloco inteiro de simulação antes/depois.
Somente `src/main.ts` e `src/chrome.ts` mudam; assets e esquema/coordenador de save
permanecem iguais. A fonte anterior de `windmail-responsive` continua intacta.

O SDK/serviço sem provedores construiu a revisão54 numa cópia privada de
metadados. Não copiou checkpoints, mudou cotas ou reenrolou o cliente original.
O ledger original e o copiado ficaram iguais antes/depois. Serviço54347 encerrou0.

| Identidade | Valor |
|---|---|
| Projeto | `5006ab22-93d5-4991-b29f-dbd1f8e60bf7` |
| Fonte54 | `0eb6abc90eb17421f2636061b677770fb540d0259480317e07b81e1ec88cbae4` |
| Artefato54 | `4152f055b3994b74c9f394fb517ac14fa5e322cd3d747c4a4aa1ac1788b1de9c` |
| Motor da construção | `d9f826ddfefb20e6c922a30dfcdc5d9e83e8396aeec2e6b26112f12265335d7b` |

## Percurso externo e recuperação

O [controlador externo](../scripts/qualify-windmail-visual-campaign.mjs) lê apenas
PNGs compostos e a projeção pública de cartas, pontos e vento. O observador filho
confere os bytes do artefato e aplica teclas/botões normais. Recolher a vela é
uma ação normal documentada para manobrar. Waypoints são geometria autoral da
rota, fora do jogador; posições estimadas de pixels não são estado interno.

Pausa entre capturas, limite de100 comandos e deadline de15min permanecem.
Não escreve storage/variáveis, modifica clock/física, registra coletor ou concede
qualidade. Não integra os pacotes, interfaces, ferramentas de modelo ou Navi.

O percurso completo no Chrome instalado concluiu5/5,1.684pontos, zero colisões,
resultado e recorde recuperados após reload, nova viagem mantendo recorde/mute,
mais34s de ré/curva para observar mudança do vento, save/reload e confirmação
de reinício em retrato. Imagens de resultado, recuperação e rótulo ocultado foram
revisadas. O browser55490 encerrou0, desconectou e removeu o HOME descartável.

O mesmo artefato54 completou o percurso também nas duas engines Playwright
existentes, com zero colisões, resultado/recorde/mute recuperados, nova viagem,
vento e confirmação em retrato:

| Ambiente | Cartas/pontos | Comandos normais do percurso |
|---|---:|---:|
| Chrome instalado | 5/5 · 1684 | 49 |
| Firefox146.0.1 de testes | 5/5 · 1685 | 44 |
| WebKit26.0 de testes | 5/5 · 1684 | 47 |

Firefox/WebKit confirmaram desconexão, listener fechado, HOME privado removido
e inventários inalterados. Não há exit code dos processos nesses wrappers.
PNGs do resultado recuperado, vento/pausa e confirmação em retrato foram revistos
nos três ambientes; não aprovar arte ou ergonomia a partir dessas imagens.

O [dossiê de qualificação](../output/game-generation/windmail-labels-20261113-a1/qualification.json)
registra separadamente resultados por engine, falhas, hashes e encerramentos.
Os três também repetiram layout390×844/320×568/844×390/1024×768, áreas de48px,
texto de ação14px, uma entrega e recuperação por reload/mute. Chrome exercitou
dois contatos emulados/soltura/cancelamento; Firefox/WebKit, mouse capturado,
teclado e taps. Não extrapolar multitouch para esses dois. Roteiro WebKit conserva
os200ms adicionais já registrados na qualificação53.
Firefox/WebKit de Playwright não são Firefox/Safari comerciais nem dispositivos
físicos. Quando o wrapper não registra exit code, não inferi-lo do fechamento.

Os pais dos quatro primeiros percursos falhos preservam hash e comandos, sem
uma cópia integral daquele código de controle. Nos três percursos aprovados, a
cópia feita após o ensaio foi conferida contra o hash registrado antes do launch;
o filho sempre preservou seu código. Novos pais passam a copiar seu código antes
de iniciar. Não apresentar hashes sozinhos como fontes históricas recuperadas.

Uma tentativa54 anterior também chegou5/5 e recuperou o resultado, mas falhou
na pausa por `P` imediatamente após outra retomada. O PNG mostra o jogo ativo;
a causa não foi estabelecida e a falha continua. O percurso posterior usa uma
única ação no botão visível **Pausar** nesse ponto. Isso comprova esse caminho
de interface, não corrige/reclassifica a falha específica do atalho. Durante a
rota, o atalho continua sendo exercitado. Não ampliar prazos ou apagar falhas.

## Guia compartilhado e exportação

`packages/game-design/production.json` agora orienta verificar sobreposição de
HUD/rótulos durante movimento/resize e coerência entre silhueta, frente e câmera.
É conhecimento puro distribuído aos sete perfis do motor comum. Não há outro
agente, ferramenta ou autoridade. O pacote `engine-guide` foi criado num destino
novo e verificado; seus bytes são distintos do motor usado no build54. Duas
sondagens usaram argumento/campo errados e foram corrigidas no ensaio, sem
iniciar serviço/modelo. A orientação ainda não foi avaliada por inferência real.

O [export oficial](../output/game-generation/windmail-labels-20261113-a1/editable-export/report.json)
preserva54 revisões,69 blobs/275648bytes e53 arquivos atuais. O serviço54884
encerrou0 e conservou o ledger. Arquivo e blobs são formato de domínio, sem
bancos, checkpoints, credenciais ou chaves privadas. Não houve reimportação dessa
exportação ou certificação do fluxo npm do projeto; o build usa o adaptador fixado.

O barco ainda é placeholder e sua perspectiva lateral segue pendente de revisão
artística. O plano integral continua exigindo Unity, composição protegida Navi,
clientes instalados, seis jogos/pedidos inéditos, dispositivos reais, avaliação
de arte/áudio e playtests consentidos. Percurso técnico não certifica diversão,
FPS físico, instalação ou aprovação de qualidade.

Tipos, build,779 testes/um opt-in ignorado,40 verificações e roteamento local
simulado passaram. [Verificação e snapshots](../output/game-generation/windmail-labels-20261113-a1/verification.json).
O pacote do guia contém484 payloads verificados; não é uma release instalada.
