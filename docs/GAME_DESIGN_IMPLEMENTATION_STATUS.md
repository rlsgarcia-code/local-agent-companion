# Game Design 1.0: acompanhamento da implementação

## Candidato integrado Mac/VS Code — 15/11/2026

Prioridade atual: entregar o percurso integrado das duas interfaces antes de
retomar o acabamento de jogos individuais. A cópia `companion-game-design`,
branch `codex/game-design-integrated-candidate`, concilia o Game Design preservado
com o Companion `main` até `a6f3977`; a cópia original permanece intacta.
Candidato: motor 1.1.0, clientes 0.13.0, Node empacotado 22.23.4.

- Tipos, build VS Code, SDK empacotado e build Mac passaram localmente.
- Suíte: 802 testes passaram e um foi explicitamente ignorado; outros 42 testes
  de repositório passaram. O roteamento LangChain/DeepAgents passou com servidor
  simulado e ambiente sem credenciais. Não houve nova geração real de jogo.
- Quatro simulações antigas de fábrica de modelos não interceptavam o caminho
  atual; houve requisições recusadas pelo Ollama real na primeira execução.
  Foram corrigidas; a suíte agora bloqueia TCP externo e os gateways reais
  11434/8788, permitindo somente servidores temporários e IPC.
- SDK/Studio Mac e barreiras de atualização foram conciliados. Jobs de jogo e
  reconciliações impedem substituição do motor, mesmo fora de uma conversa ativa.
- O pacote de desenvolvimento ARM64 foi construído em diretório novo. Não é
  assinatura de release, instalação, aceite visual ou rollback instalado.

Rodada remota inicial do commit `e60d391`: Mac ARM64 e Linux ARM64 concluíram
a geração assinada; a release em rascunho foi corretamente impedida pelas falhas
em Linux x64, Windows e Mac Intel. Os erros Windows identificaram transformação
de bytes no checkout e `fsync` de diretórios; a correção mantém os hashes fixos,
rejeita links também sem `O_NOFOLLOW` e expõe a limitação de flush no diagnóstico.
A correção passou em 854 testes locais, com um skip explícito, além dos builds
atualizados do motor, SDK, Mac e extensão.
Linux conserva reconciliação quando não há prova de encerramento; o recibo de
fixture passa a preservar a causa original do lançamento. Os erros de renderização
e tempo no runner Mac Intel ainda exigem diagnóstico; não foram convertidos em
passe ou skip. Essa rodada não criou nem promoveu uma release.

O diagnóstico posterior confirmou `Socket path too long` no Chrome/Linux e
recusa do diretório de dados de depuração no Chrome/Windows. A correção prepara
um temporário curto por operação, com dono/dispositivo/inode vinculados ao journal,
e AppData privado explícito no Windows. O worker confere esse vínculo; limpeza
de produção exige recibo exato de encerramento e ausência do processo original.
Operações antigas continuam reconhecidas; encerramento desconhecido conserva o
temporário. A suíte local passou com 856 testes e um skip explícito. A nova rodada
remota ainda precisa comprovar os dois caminhos e a renderização restante.
A rodada `95b0ce9` passou no CI de Linux x64, Linux ARM64 e Mac ARM64. Windows
continuou recusando a resolução do perfil, e o runner Mac Intel mostrou saturação
(um prazo de5s retornando erro após quase1min). A próxima revisão usa a estrutura
Windows `USERPROFILE/AppData/{Local,Roaming}`, mantém o perfil de dados separado,
e espera o primeiro quadro do visor antes de informar carregamento. Os testes
unitários passam a ser seriados; nenhum prazo de produção ou assert foi aumentado.

O teste do visor conserva os checks reais de pose, animação e câmera; a abertura
usa o detector compartilhado de pixels não uniformes em lugar de exigir uma
paleta de mais de cinquenta cores, que varia com o backend gráfico. O contador
continua disponível como diagnóstico numérico, separado de aprovação artística.

A rodada `5003d2f` confirmou os dois Linux e Mac ARM64. No Windows passaram
lançamento privado e pixels reais do modelo; restou a verificação que lia a
limpeza antes de o serviço ficar ocioso. Ela agora aguarda a barreira existente,
sem mudar prazos de produção ou aceitar recibo desconhecido. No Mac Intel,
serializar eliminou a saturação geral, mas restaram duas falhas de abertura do
visor GLB. O próximo CI conserva diagnóstico textual limitado das fixtures
locais, sem upload de PNG ou dados pessoais.

Os testes locais passaram com 820 execuções e um skip explícito, mais 42
verificações de repositório. Os 21 casos focados de navegador/visor/configuração
também passaram após as alterações seguintes. A configuração de modelos ganhou
armazenamento compatível e passou no rollback com os binários oficiais 1.0.6 e
1.0.7, em estados temporários e sem IA; veja [escopo e limites](GAME_DOMAIN_ROLLBACK.md).

Pendente desta primeira entrega: matriz assinada sobre commit exato, percurso
visual nas duas interfaces instaladas, migração e rollback com dados novos. O
Mac foi encontrado bloqueado e o desbloqueio foi solicitado. A base atual também
contém seleção Ollama/OpenAI no Mac; a conciliação dessa política com o plano
antigo foi perguntada ao usuário e não autoriza ativação enquanto sem resposta.
Unity, Navi protegido, jogos completos e aceitação física/humana continuam nas
etapas seguintes do plano integral. Nenhum desses critérios foi removido.


Conferência do caminho restante: [dependências de aceite](GAME_DESIGN_ACCEPTANCE_READINESS.md).
Consulta readonly fresca não observou a tentativa Root5 no Alien; controle do
Mac confirmou sessão bloqueada. A autorização repetida do Luna continua consumida,
e a nova decisão está pendente. Preparação Unity, fixtures, PNGs e contagem de testes
não satisfazem os gates de geração real, instalação, dispositivos ou pessoas.
O plano completo e suas pendências permanecem, sem substituição por mais demos.

Avanço de recuperação **GD-02/GD-04/GD-10, 2026-11-13**:
[primeira tecla após diálogo](GAME_WINDMAIL_FOCUS_RECOVERY.md). O baseline54
reproduziu P no botão oculto, sem bubble ao window; foco/captura anterior evitavam
a falha. Revisão55 privada muda somente `src/ui.ts`: listener restrito ao modal
aberto e foco confirmado ao fechar, sem timers. Doze cenários Chrome/Firefox/
WebKit de testes passaram, inclusive fechar/reabrir por P; a campanha Chrome55
concluiu5/5,1684pontos/zero colisões e P imediato após recuperar o vento.
Export55 preserva55 revisões/70 blobs; main/simulação/assets/save ficaram iguais.
Guia nos sete perfis e484 payloads verificados,779 testes/40 verificações,
sem IA, nova concessão, instalação ou publicação. Aceite físico/humano e demais
requisitos integrais permanecem pendentes.

Avanço de apresentação/qualificação **GD-02/GD-04/GD-10, 2026-11-13**:
[rótulos e campanha responsiva do Correio](GAME_WINDMAIL_LABEL_VISIBILITY.md).
PNGs53 comprovaram nomes cobrindo o barco; revisão54 privada oculta somente
o rótulo sobreposto, mantendo simulação byte a byte, assets e save. Build4152f055…
completou5/5, zero colisões, resultado/recorde/mute, nova viagem, vento após34s/
reload e retrato em Chrome1684pontos, Firefox Playwright1685 e WebKit1684.
Entradas normais por PNG/HUD, sem objetos internos, fonte/clock/storage alterados
pelo observador ou inferência. Falhas anteriores preservadas, inclusive `P`
imediato após retomada; usar o botão depois não reclassifica esse caso. Export54
preserva54 revisões/69 blobs. Guia puro nos sete perfis e pacote novo verificado,
sem instalar/publicar, ativar KidOS ou aprovar qualidade. Arte placeholder,
Unity/Root/Navi, clientes/dispositivos físicos, pessoas e distribuição seguem
no escopo integral; nenhuma nova alocação Luna foi concedida.

Diagnóstico externo **GD-04/GD-10, 2026-11-13**:
[direção visual do Correio](GAME_WINDMAIL_RESPONSIVE_UI.md#diagnóstico-visual-de-direção),
mesmo artefato53, zero IA ou edição do jogo. Dois pulsos normais mostraram
deslocamento116,78px quase alinhado à bandeira e quase transversal ao casco de
vista lateral. É ambiguidade de representação, não prova de comandos invertidos
ou causa das campanhas falhas. Próxima arte precisa de proa/direção legível;
placeholder, campanha53 e aceite integral continuam pendentes. Browser47812
encerrou0; primeira falha de lançamento preservada. A confirmação de orçamento
com referência `call_d0816a9c4f7f412cbb3f7f07ad58208d` já consta da alocação
anterior: sua reapresentação não concedeu outro bloco, alterou cotas ou ledger.

Avanço de fonte **GD-02/GD-04/GD-10, 2026-11-13**:
[HUD/controles responsivos](GAME_WINDMAIL_RESPONSIVE_UI.md), revisão53 privada,
mapa/física/save preservados. Layout/48px/14px em quatro tamanhos e uma entrega
com reload/mute passaram em Chrome e Firefox/WebKit de testes. Chrome exercitou
multitouch emulado; não é aceite físico. Guia neutro atualizado nos sete perfis
do motor, pacote separado verificado sem IA. Export SDK preserva53 revisões e
todos os blobs. As duas campanhas53 falharam/ficaram incompletas, preservadas;
desfecho novo continua pendente. Nenhum cliente foi instalado/publicado ou
capacidade infantil ativada. Escopo integral permanece inalterado.

Avanço de evidência **GD-04/GD-10, 2026-11-13**:
[campanha do Correio](GAME_WINDMAIL_CAMPAIGN_OBSERVATIONS.md) concluída no mesmo
artefato3462eb87…: Chrome1693pontos/0 colisões; Firefox Playwright1360/5;
WebKit Playwright1695/0. Recorde/mute/desfecho após reload, nova viagem e vento
recuperados. Os dois replays fixos falharam e foram preservados; Firefox/WebKit
passaram por entradas corrigidas após PNGs, sem alterar fonte/física/clock/save.
Zero nova inferência. Retrato expôs HUD/controles pequenos; não há aceite móvel,
físico, humano, artístico ou instalado. A consulta SSH readonly não observou
diretório/processos da tentativa Root5; autenticação do operador segue pendente.

Avanço de integração **GD-04/GD-10, 2026-11-13**:
[Correio com save](GAME_WINDMAIL_SAVE_INTEGRATION.md), revisão52 em cópia privada,
zero inferência/alteração do Luna51 original. Build fixado `d9f826dd…`, providers
vazios e ledgers comparados. Percurso confirmou3/5 cartas/898 pontos antes/depois
de reload, cancelar reinício, confirmar nova viagem e recuperá-la. Browser22326/
serviço22075 exit0; PNGs revisados. Primeiro percurso e startup EPERM preservados.
Integração manual não equivale a geração autônoma, qualidade humana ou instalação.

Avanço de fonte **GD-04/GD-05/GD-10, 2026-11-13**:
[runtime de save](GAME_SAVE_RUNTIME.md), import opcional e fixado
`@companion/game-save`1.0.0 nos compiladores workspace4. Estado JSON por origem/
gameId/slot, IndexedDB transacional, comparação de bytes, confirmação em complete,
validação/limites, migração e descarte explícitos; preserva conflitos, corrupção
e versões futuras. Core1 continua recusando o import. Passaram773 testes, um
opt-in ignorado, 40 verificações, tipos/builds/roteamento simulado. Pacote
`d9f826dd…` de484 payloads; SDK/serviço reais construíram exports Phaser/Babylon
e encerraram antes de seis percursos com IndexedDB nativo em Chrome e browsers
Playwright Firefox/WebKit. Reload, duas conexões concorrentes, controller
close/reopen e falhas exercitados por UI de fixture; não são browser restart,
disco/consumidores físicos ou jogo aprovado. Guardas de ambiente e busca inicial
de Firefox falharam e foram preservadas; final serviço14265 exit0, seis páginas/
fechamentos confirmados, estado removido, inventários dos patches inalterados.
[Dossiê](../output/game-generation/game-save-runtime-20261113-a1/report.json).
Zero IA, reparo automático do Luna51, instalação ou publicação. Save original,
preview persistente, demais engines, integração infantil, portfólio, pessoas e
matriz/distribuição integral permanecem pendentes.

Avanço de evidência **GD-10, 2026-11-13**:
[Correio das Correntes: rota e recuperação](GAME_WINDMAIL_ROUTE_OBSERVATIONS.md).
Mesmo build finalLuna51 (`5ca8fa05…`/`ad592916…`), sem edição ou nova IA. Entradas
normais e PNGs externos alcançaram5/5 em dois percursos (1.463/1.693 pontos);
mesmo replay também ficou4/5, com colisões. Primeiro observador com pausa sem
confirmação foi preservado; o posterior confere a borda visível sem ler variáveis
do jogo. Reload parcial mostrou3/5/898 pontos →0/5/zero, contrariando o design
persistente; a fonte guarda só recorde. Sem correção ou reclassificação da QA
antiga, eficiência/qualidade aprovadas ou licença/instalação. Cinco browsers
próprios terminaram exit0/desconectados/perfis removidos. O
[dossiê](../output/game-generation/windmail-route-20261113-a1/report.json) mantém
replay falho, PNGs/hash, fonte/design e feedback preparado, sem autorizar outra
execução. Save, prontidão inicial, arte/barco placeholder, vento, matriz física,
pessoas, Unity/Root e distribuição integral continuam pendentes.

Avanço de fonte **GD-01/GD-02/GD-08, 2026-11-13**:
[leitura dirigida de código](GAME_SOURCE_TEXT_PAGES.md). `game_read_file.textPage`
recebe revisão/hash exatos, cursor em bytes e limite; devolve páginas UTF-8 de
até16 KiB sobre fontes de até8 MiB, preservando BOM/CRLF e a referência histórica.
Omitir conserva o caminho legado. Serviço valida namespace/blob; perfis comuns
orientam a leitura, sem novo executor, filesystem ou autoridade KidOS. Passaram
767 testes, um opt-in ignorado, 40 verificações, tipos/builds/roteamento simulado.
Pacote `cbcdd2cc…`, Node/SDK/TLS/IPC/serviço e grafos Standard/Deep com quatro
registros Mac/editor e SSE falso leram fontes de450.003 bytes em páginas de
no máximo257 bytes. Oito runs/16 pedidos simulados, com edição posterior e
reinício; referências antigas preservadas, PIDs5163/5165 exit0, estado removido.
[Dossiê](../output/game-generation/source-text-pages-20261113-a1/report.json).
Regressão de campos ausentes e erro de MIME da fixture preservados. Zero IA
real, instalação, nova autorização ou aceite de jogos; não é economia medida
de tokens/custo. Root5, Unity, integração instalada, portfólio, matriz física,
pessoas e distribuição integral permanecem pendentes.

Avanço de fonte **GD-02/GD-10, 2026-11-13**:
[reserva por tamanho do pedido](INFERENCE_REQUEST_RESERVATIONS.md). Callback
oficial calcula estimativa transitória de mensagens/ferramentas e margem;
serviço mantém admissão/decisões/recibos exatos, sem mudar cotas ou permissões.
Uso desconhecido conserva a reserva efetiva. Passaram 762 testes, um opt-in
ignorado, 40 verificações, tipos/builds/roteamento simulado. Novo pacote
`bc8d10e1…`, quatro registros Mac/editor × Standard/Deep pela Agent API comum,
oito pedidos SSE simulados: pedidos grandes recusados antes do envio, pequenos
admitidos, reinício preserva contadores. Processos 1634/1639 exit0, estado privado
removido; duas observações falhas e primeiro ciclo de assertions antigas foram
preservados. [Dossiê](../output/game-generation/request-sized-reservations-20261113-a1/report.json).
Não reduz payload/consumo real nem garante teto rígido de faturamento. Sem nova
inferência Luna, terceiro bloco, instalação, release ou aceite de jogos. Root5,
Unity, composição instalada, corpus, matriz física e jogadores reais pendentes.

Continuação real **GD-02/GD-10, 2026-11-13**:
[bloco adicional Luna](GAME_GENERATION_ADDITIONAL_BLOCK.md), explicitamente
autorizado pelo usuário, executado na mesma identidade/sessão/ledger. Teto de
admissão conservador não reaproveitou saldo antigo; nenhuma reserva foi devolvida.
Run `ebed52c9…` terminou por orçamento após 58 chamadas novas e quatro revisões,
chegando à revisão 51 (`5ca8fa05…`). Quatro builds/coletas reais; no último, boot/
console e dois cenários passaram, um de pausa/retomada falhou e os PNGs mostram
ainda a introdução. Diagnóstico pareado posterior, sem IA e sem alterar o build:
três entradas imediatas ficaram na introdução; três após a primeira captura
permitiram pausa/retomada. Não reclassifica a falha antiga ou aprova o jogo. Qualidade
continua falsa, com placeholders e demais gates pendentes. Contabilização nova:
4.200.064 tokens, 5.760 acima da autorização pela última resposta já admitida;
o controle impede a chamada seguinte, mas não limita uma resposta em curso. A
limitação está explícita e não autoriza outra renovação. PID/endpoint ausentes,
zero runs/jobs pendentes, estado privado preservado; sem código de saída do filho
registrado, instalação ou publicação. Passaram 759 testes, um opt-in ignorado e
40 verificações antes da execução. Relatórios em
`windmail/2026-11-13T18-33-51-287Z-1271772d`; não é aceite do jogo/produto.

Avanço de fonte **GD-08/GD-10, 2026-11-13**:
[correção auditada de playtests](GAME_PLAYTEST_CORRECTIONS.md). Serviço/contratos/
SDKs e Studio compartilhado têm correção com hash do registro atual, motivo,
antes/depois, confirmação e histórico paginado. Replay não duplica pessoas;
retirada remove respostas/motivos também do histórico consultável, preservando
tombstones. Recibo exato recupera somente leitura sem repetir efeitos; ausência
não encerra um pedido perdido. KidOS/model tools/coletores continuam excluídos.
Passaram 755 testes, um opt-in ignorado, 40 verificações, tipos, builds e novo
motor independente (`e14ce1b4…`). Renderer/SDK/IPC/serviço reais, pontes Mac/VS Code
emuladas, demonstraram rascunho, confirmação perdida, histórico como texto e
retirada em dois namespaces. Processo 87800/browser 87806 exit0 e estado removido;
falhas de ambiente/espera do roteiro e respectivos encerramentos preservados. O
[dossiê](../output/game-generation/playtest-corrections-20261113-a1/report.json)
vincula fonte, pacote, regressão e imagens. Sem IA, participante real, instalação,
publicação ou qualidade aprovada. Fonte/UI instalada, integração parental e
rodadas reais continuam pendentes. O usuário autorizou um novo bloco Luna de
até 128 chamadas/4.194.304 tokens, sem renovação automática; a autorização está
recebida, ainda sem nova admissão ou alteração do ledger anterior nesta frente.

Avanço de diagnóstico **GD-10, 2026-11-13**:
[Lume com rede/cache HTTP frio](GAME_COLD_NETWORK_OBSERVATIONS.md).
Chrome 157 com janela/sandbox/perfil privado aplicou 20 Mb/s e latência mínima
por requisição de 100 ms antes de navegar no artefato original 93be1ac1….
Calibração de 4 MiB levou 1.789 ms; os cinco recursos HTTP registrados confirmaram
regra/status200 sem cache. Outros cinco flags de imagem permanecem no trace,
sem caminhos privados; a primeira descrição ampla de cache foi preservada e
corrigida em nova observação. Cena capturada em 1.646 ms e movimento por tecla
normal confirmado em 1.991 ms, sem objetos internos/save/relógio alterados.
Apple M3 Max/Metal informado pelo browser; processo 77519 exit0, perfil/HOME
removidos, bytes originais/componentes iguais. Passaram 752 testes, um opt-in
ignorado, 40 verificações, tipos/build e pacote independente novo de 481 payloads
(`c94766b4…`). EPERM inicial preservado; mesma suíte permitida passou. O
[dossiê](../output/game-generation/cold-network-20261113-a1/report.json)
vincula fontes/duas observações/calibração/trace/PNGs. Zero IA, instalação,
publicação ou novo coletor. Tempos incluem automação/captura; não são FPS/RTT
físico, carregamento integral, GameQuality ou aceite de matriz. Luna continua
selecionado no bloco esgotado; Root5, Unity, integração instalada, seis jogos,
playtests, distribuição e rollback integral continuam pendentes.

Avanço de prontidão **GD-10, 2026-11-13**:
[diagnóstico gráfico do navegador no Mac](GAME_BROWSER_HARDWARE_READINESS.md).
Página própria em Chrome157.0.8103.78, com janela/sandbox/perfil privado e ambiente
sem credenciais: CDP informou Apple M3 Max/Metal, WebGL/composição/rasterização
habilitados; WebGL2 com recusa de major performance caveat foi criado e a página
estava visível/focada. Zero requisições de página/IA. Ensaio final confirmou
processo71336 exit0, desconexão, remoção do perfil/HOME e hashes iguais dos dois
componentes qualificados do browser. Primeiro positivo70931 permanece anterior
à asserção explícita do perfil. Captura da página uniforme foi conferida; não é
jogo ou aceitação de canvas de um build. O
[dossiê](../output/game-generation/browser-hardware-20261113-a1/report.json)
vincula observador, Chrome, resultados e encerramentos. Não há FPS, carga de jogo,
perfil de rede, relatório físico/qualidade, modelo, instalação ou coletor novo.
Coletores continuam na autoridade/supervisor existentes. Medições físicas dos
builds, matriz Mac/Alien/mobile, áudio/controles, público real, Root5/instalação
Navi, Unity, geração Luna além do bloco esgotado e distribuição integral continuam
pendentes no plano.

Avanço de fonte/evidência **GD-10, 2026-11-13**:
[metas proporcionais de playtest](GAME_PLAYTEST_TARGETS.md). Regressão conservada
comprovou que a avaliação de qualidade aceitava grupo de11 com apenas8/7 positivos,
embora o resumo do estudo já exigisse proporções. Ambos usam agora a política
pura de mínimo10, 80%/70% arredondados para cima e contagens inteiras seguras.
Registros do operador não viraram relatórios ou aprovação. Passaram750 testes,
40 verificações, um opt-in ignorado, tipos e build independente. Novo motor de
desenvolvimento `56d62877…`, 481 payloads, mantém o anterior intacto. Ensaio real
de Node/serviço/SDK/TLS/IPC em namespaces Mac/VS Code, com dois builds Phaser e
rodadas sintéticas20: 8/7 recusado, 16/14 só numérico; retirada deixa19 com15/13 e
invalida as metas. Resumos/tombstones persistiram após reinício; replay não
duplicou nem recriou a resposta. `ready` permaneceu falso e não houve relatórios
de qualidade. Processos65846/65849 encerrados com exit0 e estado privado removido.
O [dossiê](../output/game-generation/playtest-targets-20261113-a1/report.json)
liga fontes, pacote, testes, falha e encerramentos. Zero IA/novo orçamento,
instalação ou publicação. Root5 aguarda autenticação; Unity, Luna além do bloco
esgotado, integração instalada/Navi, portfólio, distribuição e aceite físico,
artístico/humano continuam pendentes no plano integral.

Avanço de fonte/prontidão **GD-09, 2026-11-13**: Alien voltou a responder pelo
alias `alien`. Leitura confirmou UID1000, user manager, Node/manifesto Root com
os hashes/modos preparados, e404 processos lidos sem recusa. Não havia caminho,
relatório ou processo da tentativa Root4, nem marcador local: execução não
observada, sem resultado de qualificação. O lançador KidOS ignorava o host
configurado e usava `alien.local`; a regressão reproduziu o defeito. Agora usa
host validado em todos os transportes, confere manifesto/pins e conectividade
antes do marcador, preserva tentativa marcada e mantém sudo interativo.
Passaram33 guardas e1.019 testes KidOS, dois opcionais ignorados. Nova tentativa5
conserva os mesmos677 arquivos públicos congelados de2026-11-11 e hashes da4,
com token novo/alias corrigido; nenhuma fonte foi recompilada como se fosse
qualificação de mudanças posteriores. Preparada, aguardando autenticação do
operador no Terminal; não executada automaticamente, instalada ou anunciada
como perfil Navi v2. O
[dossiê de prontidão](../output/game-generation/native-root-readiness-20261113-a1/report.json)
preserva logs, regressão, pins e preparação. Composição Root positiva, integração
atual instalada/Navi, Unity, Luna além do bloco esgotado, portfólio, distribuição
e todo o aceite físico/artístico/humano permanecem pendentes no plano integral.

Avanço de evidência **GD-01/GD-11, 2026-11-13**:
[rollback real de binários/domínio](GAME_DOMAIN_ROLLBACK.md). Mesmo estado privado
atravessou 1.0.2 de desenvolvimento → 1.0.1 oficialmente assinada → 1.0.2. SDK
anterior foi verificado antes de importar/executar; processos só trocaram após
quiescência e exit0. Dois namespaces Mac/VS Code importaram histórico/projeto de
três revisões/11 blobs, criaram revisão4, build Phaser real, rodada/observação
sintéticas e rascunhos privados novos. Fonte/artefato e 40 referências históricas
por produto foram conferidos antes/depois. As 23 tabelas de jogos e recibos
permaneceram iguais sob a versão antiga, que recusou métodos de jogos com -32601.
Históricos criados antes e durante o rollback foram recuperados; replay do
import/build devolveu IDs existentes sem outro job. Processos58919/58922/58923
encerrados com código0; estado positivo removido. A primeira tentativa fica
reprovada/conservada: comparava o novo `exportedAt` com o horário antigo. Só o
observador mudou para conferir horário separadamente e preservar comparação
exata dos campos persistidos; inspeção readonly posterior e três exit0 foram
registrados, sem reinício ou replay do original. O
[dossiê](../output/game-generation/game-domain-rollback-20261113-a1/report.json)
liga versões, fontes, dados sintéticos, hashes e encerramentos. Não instalou
clientes, abriu UI antiga, converteu checkpoints ou testou trabalho ativo/perfis
inteiros/versão jogável aprovada; não combina provas separadas em aceite instalado.
As 40 verificações do repositório e sintaxe passaram; ambos os bundles foram
reverificados após os processos. Runtime, contratos e interfaces não mudaram.
Zero IA/novo orçamento. Unity, geração Luna além do bloco esgotado, composição
KidOS, releases finais, portfólio e todo o aceite físico/artístico/humano continuam
no escopo integral e pendentes.

Avanço de fonte/evidência **GD-11, 2026-11-13**:
[integridade do motor no VSIX](GAME_VSIX_INTEGRITY.md). Regressão comprovou que
o verificador anterior aceitava manifesto/assinatura alterados: eram contados,
mas seus hashes não eram comparados. A falha ficou conservada. Agora os bytes
são capturados antes de VSCE, verificados com a chave esperada e comparados no
ZIP junto aos payloads, recusando omissões, duplicatas, aliases, links e perda
de execução do Node POSIX. O bootstrap e a chave oficial continuam obrigatórios;
não muda API, runtime de agente ou autoridade. VSCE 4.0.0 real empacotou uma
cópia do cliente 0.12.4/LiteLLM e motor 1.0.2 darwin-arm64/Node 22.23.4:
118.775.828 bytes, 848 arquivos totais, 483 arquivos do motor conferidos.
Inventários de origem permaneceram iguais. É `QUALIFICATION-ONLY.vsix`, com
assinatura efêmera anterior recusada pelo produto; nenhuma chave compilada foi
trocada. Não é release, instalação, ativação ou rollback. O
[dossiê](../output/game-generation/vsix-engine-integrity-20261113-a1/report.json)
liga fontes/arquivo/logs e a recusa anterior. Passaram 748 testes, 40 verificações
do repositório e typechecks, um opt-in ignorado. O primeiro teste amplo com
84 falhas em ambiente restrito, incluindo sockets `EPERM`, foi preservado;
repetição autorizada com IPC passou sem afrouxar produto/testes. Zero IA/novo orçamento; Luna
continua selecionado e seu bloco esgotado preservado. Assinatura oficial,
cinco plataformas, clientes instalados, Unity, composição KidOS, portfólio e
aceite físico/artístico/humano permanecem pendentes no plano integral.

Avanço de fonte/evidência **GD-11, 2026-11-13**:
[empacotamento imutável do motor](IMMUTABLE_ENGINE_PACKAGING.md). A assinatura
deixa de reescrever `engine-dist`: cria cópia nova, confere entrada/cópia/TAR,
preserva diretórios vazios, rejeita colisões/omissões/entradas extras e calcula
hash por streaming. Checkout/commit exatos e chave pública fixada continuam
obrigatórios no CLI; Git, compilador do verificador e TAR não herdam segredos.
Os quatro consumidores do CI agora recebem o caminho assinado emitido pelo
passo, e upload exclui staging/parciais. YAML foi validado localmente, sem
disparo de Actions. O ensaio `full-engine-private-umask` usou o motor real
`291efabf…`, chave efêmera não aceita pelo produto e commit sentinela zero,
sem gravar chave privada. Gerou92723200 bytes,483 arquivos/74 diretórios e
conservou245020044 bytes/modos de payload sob umask077; assinatura pública0644.
Serviço original manteve identidade/sessão, outro iniciou pela cópia, ambos
encerrados com código0. A chave oficial recusou a fixture. A primeira tentativa
que não previa dois diretórios vazios e a falha inicial da lista literal de testes
permanecem conservadas, sem promoção retroativa. O CLI real recusou a árvore
alterada sem criar saída. O
[dossiê](../output/game-generation/immutable-engine-package-20261113-a1/report.json)
vincula scripts, arquivos, assinaturas de teste e encerramentos. Não há release,
`.app`/VSIX novos, instalação, atualização de conta, IA ou renovação de orçamento.
Assinatura oficial sobre commit/versão revisados, cinco plataformas, clientes
instalados, rollback de dados, Unity, Navi/Core, portfólio e toda a aceitação
física/artística/humana permanecem pendentes no plano integral.

Avanço de evidência **GD-08/GD-11, 2026-11-13**:
[hosts nativos de Recursos do build](GAME_DELIVERY_NATIVE_HOSTS.md), mesmo pacote
`291efabf…`, sem alterações de executores/instalações ou inferência. Mac
`2026-11-13T15-20-59-866Z-9e212349`: janela/preload/IPC/controlador e rascunho
privado reais, diálogos/conexão/resposta perdida de fixture. Três processos
Electron45.2.1/Node24.22.1 preservaram rascunho e pedido sobre o serviço separado
Node22.23.4. Conferência em leitura após edição posterior em3 não fez novo
diálogo/upload/commit; exportação nativa e build Phaser conservaram master/aviso.
VS Code `2026-11-13T15-29-31-332Z-38d6c6bc`: host/webview, DevelopmentAgent e
EditorServiceRuntime reais, somente factory de conexão/falha de fixture. Três
processos de extensão1.146.0 recuperaram a mesma sessão por comando explícito;
no modo Plano real, pedido foi recuperado sem Continuar/upload/commit adicional,
conservando3 e exportando a fonte pelo seletor do editor. Todos os hosts/grupos
e serviços tiveram encerramento confirmado. Os dois ensaios iniciais do editor
sem workbench continuam reprovados: diagnóstico identificou socket macOS acima
de103 caracteres; só a pasta do perfil temporário foi encurtada, sem mudança de
produto, transporte ou timeout. Logs privados/perfis anteriores foram conservados.
Passaram748 testes e31 verificações, um opt-in ignorado, checks/builds.
O [dossiê](../output/game-generation/delivery-native-20261113-a1/report.json)
vincula fontes, capturas, exports, versões e encerramentos. É qualificação de
código de host em fixtures nativas, não `.app`/VSIX instalados ou rollback das
contas. Não cobre inferência/build ativo durante fechamento nem reinício do
serviço neste ensaio. Unity, Luna além do bloco esgotado, composição KidOS,
portfólio, distribuição e todo o aceite físico/artístico/humano continuam no
escopo integral e pendentes.

Avanço de fonte **GD-03/GD-04/GD-05/GD-08/GD-11, 2026-11-13**:
[Recursos do build no Studio](GAME_DELIVERY_STUDIO.md), na Visão geral
compartilhada Mac/VS Code. Lista de30 por página, filtro e tamanhos, escolha
manual ou inventário padrão, navegação por teclado com foco preservado, rascunho
privado durável e confirmação. Controlador confere configuração/revisão/hash e
permissões antes/depois do consentimento; desconhecidos são recusados, sem
descartar campos. Usa commits/recibos existentes, sem nova RPC de mutação ou
agente na UI. Commit conhecido é recuperado em leitura, após edição posterior,
sem upload, nova confirmação ou gravação; missing/recusa não apagam o pedido.
O ensaio final `2026-11-13T15-12-40-472Z-9e0d2501`, motor `291efabf…` de481
arquivos, passou nas duas pontes de host emuladas com renderer/controlador,
serviço/SDK/TLS, arquivos privados e compiladores reais. Escolhas/filtro e seleção
inativa sobreviveram a reload; negação não gravou; resposta perdida/missing
injetados conservaram o mesmo pedido. Conferência em leitura recuperou revisão2
com título posterior em3, sem outro commit; retirar só a opção criou revisão4,
conservando master e avisos. Os builds selecionados reais omitiram WAV e
conservaram aviso/receita. Não é instalação, codec novo ou rollback distribuído.
Passaram748 testes e31 verificações, um opt-in ignorado, checks/builds e
roteamento simulado. O primeiro ensaio positivo permanece anterior ao teste de
teclado. A tentativa intermediária reprovou uma expectativa do observador sobre
ordem de seleção após desmarcar/remarcar, sem falha de produto; foi conservada,
encerrada e seu recibo original/revisão2 confirmado por inspeção de banco somente
de leitura. A versão final compara o conjunto esperado e mantém comparações
exatas do comando congelado na recuperação. O
[dossiê](../output/game-generation/delivery-studio-20261113-a1/report.json)
vincula fontes, pacote, resultados e encerramentos. Zero IA, instalação ou
publicação; GPT Luna/bloco anterior intactos. Compatibilidade do novo campo privado
em rollback, instalação dos três clientes, Unity, KidOS e todo o portfólio/aceite
físico/artístico/humano continuam pendentes no plano integral.

Avanço de fonte **GD-03/GD-04/GD-05/GD-11, 2026-11-13**:
[seleção explícita de recursos web](GAME_WEB_DELIVERY_SELECTION.md) no compilador
workspace3. `game.web.json.delivery` escolhe recursos estáticos; omissão mantém
bytes/inventário legados, e arquivo ausente reprova sem fallback. Masters/revisões
ficam no projeto/exportação editável; texto/JSON dos assets selecionados e toda
ancestralidade conservam avisos/receitas. Inventário vincula paths/tamanhos/hashes
e declarações, sem certificar licenças. O worker Core1 recusa o novo campo, mesmo
num pedido selado exato. Passaram744 testes e31 verificações, um opt-in ignorado,
checks/builds e roteamento simulado. A primeira execução restrita encontrou
bloqueio de sockets IPC; foi conservada, sem alterar produto/política para passar.
O ensaio final `2026-11-13T14-52-40-890Z-c20a4517`, pacote `ad23aaf5…` de481
arquivos, usou serviço/SDK/TLS/compiladores reais em namespaces Mac/VS Code;
não interfaces instaladas. Reutilizou AAC real conferido por seu recibo anterior,
sem novo encode/IA. Phaser caiu de2.846.927 para1.416.546 bytes e Babylon
de10.792.687 para9.362.306 nessa fixture com master/arquivo binário não solicitado;
não é proporção garantida. Seis players após serviço encerrado carregaram AAC e
conteúdo selecionado, tocaram por gesto, pausaram/fecharam, com versões dos
browsers e encerramento registrados. Exportação/importação idempotente preservou
WAV; retirar só a seleção criou revisão4, preservando título posterior e
artefato anterior. Isso é restauração de domínio, não rollback de instalação.
O [dossiê](../output/game-generation/web-delivery-20261113-a1/report.json)
conserva fonte, pacote, ensaio anterior positivo e limites. Zero IA, alocação,
instalação ou publicação. Alien voltou a expirar por SSH; tentativa Root original
permanece sem inspeção/reinício. Unity, geração Luna além do bloco esgotado,
clientes instalados, KidOS, distribuição e todo o aceite físico/artístico/humano
continuam pendentes no escopo integral.

Avanço de fonte **GD-03/GD-08, 2026-11-13**: [formulário de variantes](GAME_AUDIO_VARIANTS_STUDIO.md)
no renderer/controlador compartilhados, com WAV registrado, qualidades,
confirmação nativa e rascunho privado durável antes de disparar. A nova consulta
`games.assets.inspect` lê o binding do pedido original, sem novo job ou consumo;
SDKs TS/Python a validam. KidOS não recebe essa capacidade/endpoint. Pedido
congelado, fonte/hash/revisão, permissões e seleção são preservados; consulta
ausente/rejeitada não apaga efeito desconhecido. O ensaio final
`2026-11-13T14-27-37-640Z-dd8d2b2c`, motor `fdeb6d7d…`, passou nas duas pontes
de host emuladas com serviço/SDK/TLS, worker, codec, renderer e arquivo de
rascunho reais. Fonte alternativa/taxas desativadas restauradas, polling estável,
negação sem job, resposta perdida e consulta missing injetada após trabalho
posterior não produziram outra codificação: um pedido por namespace. Revisar e
aplicar criou revisão5, conservando título posterior e ambos os WAVs. Passaram741
testes e31 verificações, um opt-in ignorado, checks/builds e roteamento simulado.
Fixtures incompletos/expectativas de diagnóstico e seletor ambíguo de UI foram
recusados e preservados antes da correção dos observadores. A captura desktop
posterior limita-se ao formulário/DOM único; a antiga pintura repetida após
resize permanece como evidência, sem alegar correção do produto. O
[dossiê](../output/game-generation/audio-encode-studio-20261113-a1/report.json)
conserva fontes e resultados. Zero IA, instalação ou publicação. O novo campo
de rascunho exige compatibilidade/preservação no rollback distribuído; esse
aceite, clientes instalados, áudio físico/artístico, Unity, KidOS e todo o
portfólio/matriz/estudos humanos permanecem no escopo integral.

Avanço de fonte **GD-03/GD-04/GD-05, 2026-11-13**: [AAC no mixer1.1](GAME_AUDIO_AAC_RUNTIME.md),
com o mesmo ciclo de música/ambientes/efeitos. Carregador aceita WAV ou o perfil
LC explícito do codec fixado; inspeciona uma track/descritor interno, tabelas,
contagens/ranges/priming antes de reservar memória reamostrada e chamar decode
nativo. Não aceita MP4 genérico nem escolhe outra fonte. O lock1.1 é fixado para
novos builds; fonte1.0 e artefatos prévios permanecem exatos. Core continua sem
resolver o import. O ensaio final `2026-11-13T13-43-44-438Z-60dabd87` produziu12
candidatos AAC reais (mono/estéreo,22050/44100/48000 por engine), aplicou/exportou
Phaser/Babylon e encerrou o serviço antes dos seis previews. Todos carregaram
os sons e passaram gestos, transições, ambiente comum, efeitos, mute, pausa,
retomada e fechamento. PCM offline mostrou mudança de frequência e mute zero;
Firefox conserva o modo explícito de três grafos estáticos. Não prova seu PCM
de crossfade, audição física, loops sem emenda ou música acabada. Passaram738
testes e31 verificações, um opt-in ignorado, checks/builds e roteamento simulado.
A primeira suíte com duas expectativas presas no1.0 foi conservada; os testes
foram atualizados para o módulo corrente, sem relaxar integridade ou política.
O [dossiê](../output/game-generation/audio-mixer-aac-20261113-a1/report.json)
vincula fontes, lock, pacote e encerramentos. Zero IA, instalação ou publicação;
orçamento Luna anterior preservado. Formulário de variantes, distribuição do
codec, clientes instalados, KidOS protegido e todo o aceite humano/artístico/
físico do plano seguem pendentes. No mesmo pacote `2dfe3727…`, a regressão WAV
`2026-11-13T13-43-41-839Z-e4a839b3` passou nas seis combinações. O controle
estrutural comprovou a recusa de timeline180 s sobre track1 s antes do codec;
a tentativa intermediária que presumiu relógio1 kHz foi preservada como falha.
O perfil final admite só1 kHz ou a taxa da track, mantendo a coerência de frames,
priming e duração; testes cobrem os dois. Resultados prévios permanecem vinculados
aos respectivos pacotes, sem promoção retroativa.

Avanço de fonte **GD-03/GD-04/GD-08, 2026-11-13**: [variantes AAC isoladas](GAME_AUDIO_CODEC.md)
a partir de WAV PCM16 registrado. Adaptador opcional fixado por fonte assinada,
imagem/driver/receita exatos, sem rede ou FFmpeg global; candidato preserva master,
proveniência, placeholder, revisão e aplicação explícita. O worker Core fixo
recusa o pedido. No ensaio final `2026-11-13T13-15-56-879Z-aa3fd823`, os dois
namespaces e pontes de host emuladas usaram serviço/SDK/TLS/renderer reais;
masters de960044 bytes geraram variantes de42041/82017 bytes. Replay após reinício
recuperou o job original, ID com conteúdo diferente foi recusado, e Phaser/Babylon
exportados tocaram/pausaram/decodificaram AAC nos três browsers de teste com o
serviço já desligado. Não é redução do pacote inteiro: o compilador conserva WAVs.
WebKit reporta duração da mídia diferente do PCM, e sua tentativa anterior com
controles nativos registrou falhas de ícones blob, preservadas. O roteiro final
usa botões do jogo; não filtra erros nem relaxa CSP ou certifica esses widgets.
O ensaio `2026-11-13T13-15-52-718Z-897e2df6` observou FFmpeg real antes de
cancelar/derrubar seu serviço; confirmou encerramento, reconciliação do resultado
ausente como falho, sem repetição/aplicação e fonte intacta. A primeira tentativa
de reinício encontrou socket morto, foi recusada e teve seu job original
reconciliado separadamente, sem recodificar. Passaram735 testes,31 verificações,
um opt-in ignorado, checks/builds e roteamento simulado. A repetição inicialmente
restrita pelo ambiente falhou por bloqueio de IPC e foi preservada, sem alterar
o produto para contorná-lo. O
[dossiê](../output/game-generation/audio-codec-20261113-a1/report.json)
vincula fonte, imagem, pacote, resultados e encerramentos. Zero inferência,
instalação ou publicação; GPT Luna permanece selecionado e orçamento anterior
intacto/esgotado. O mixer1.0.0 ainda recebe apenas WAV; formulário de variantes,
distribuição/licenças completas da imagem, native/instalado, audição, integração
protegida e todos os critérios artísticos/humanos do plano continuam pendentes.

Avanço de fonte **GD-03/GD-04/GD-05, 2026-11-13**: [runtime de áudio por
estado](GAME_AUDIO_RUNTIME.md), módulo opcional fixado para Phaser/Babylon.
Música/ambientes/efeitos, preload, fades, panorama/rate, volumes/mute, instâncias,
reservas de memória, gerações de estado, gesto confiável e pausa/retomada/fechamento
pertencem ao jogo, sem novo motor. Perfil workspace2 verifica código/licença;
Core fixo1 conserva binding e recusa o import. Passaram731 testes,31 verificações,
um opt-in ignorado e os checks/builds aplicáveis. O ensaio final
`2026-11-13T12-25-53-311Z-4dcac193` abriu dois builds exportados em três browsers,
com Agent Service já encerrado: reprodução nativa, transições, ambiente comum,
efeito, mute/pausa, retomada e fechamento. PCM offline comprovou mudança de
frequência e trecho muted zero no mesmo grafo em Chromium/WebKit; Firefox não
oferece suspensão offline e usa três grafos estáticos identificados, além dos
controles interativos. A primeira tentativa com essa API ausente foi preservada,
sem filtro de erros ou fallback no produto. O
[dossiê](../output/game-generation/game-audio-runtime-20261113-a1/report.json)
conserva cada pacote, fonte, modo e encerramento. Zero inferência, instalação
ou publicação. Não comprova audição física, mixagem artística, jogos completos,
browser comercial ou integração protegida; todas essas obrigações permanecem.

Avanço de fonte **GD-03/GD-08, 2026-11-13**: [forma de onda e medições digitais
do WAV](GAME_AUDIO_ANALYSIS.md), por escolha explícita. Worker mede PCM16
codificado e preserva WAV/receitas legados; JSON e resumo `result.info` ficam
vinculados ao hash do som. O agente consulta o resumo pela ferramenta existente,
e o Studio desenha envelopes por canal, sem codec/DSP/IA próprios. Core fixo
recusa o campo novo. O ensaio final `2026-11-13T11-55-52-692Z-b3b26109` passou
nos dois hosts emulados com serviço/SDK/TLS/worker/renderer reais: escolha após
reload, 512 blocos, pedido congelado, recusa/resposta perdida/replay único,
normalização, fonte intacta, dois gráficos e aplicação separada. Pacotes e
resultados anteriores foram mantidos. Passaram723 testes,31 verificações, um
opt-in ignorado, check/builds e roteamento simulado; nenhuma inferência,
instalação ou publicação. O
[dossiê](../output/game-generation/audio-analysis-20261113-a1/report.json)
registra hashes, medições e limites: RMS/limiar digital não certificam loudness,
arte sonora, audição física ou aceite instalado. Mac foi confirmado bloqueado;
`alien.local` não resolveu e o alias SSH retornou Host is down, sem inspeção ou
reinício do job Root original. O plano integral continua pendente.

Avanço de fonte **GD-03/GD-08, 2026-11-13**: [comparação histórica de imagem e
áudio](GAME_MEDIA_COMPARISON.md) no SDK/Studio. Usa revisão/caminho/hash exatos,
assets registrados, transferências existentes e reconfirmação de seleção. Modo
somente de leitura, imagens lado a lado/tamanho original, WAV sem autoplay,
reprodução exclusiva, pausa ao sair e descarte de resposta atrasada após fechar.
O ensaio final `2026-11-13T11-36-27-893Z-dca36b59` passou nas duas pontes de host
emuladas com motor/SDK/TLS/renderer reais: preservou arquivos e revisões após
trabalho posterior, sem build, aplicação ou aceite de qualidade. A primeira
tentativa expôs bloqueio indevido de Fechar durante leitura, corrigido; a segunda
não comprovou foco do play nativo do segundo áudio. Todos os registros foram
conservados; teclado/ponteiro em controles visíveis passaram depois, sem chamar
DOM `.play()` no roteiro. Passaram719 testes,31 verificações, um opt-in ignorado,
check/builds e roteamento local simulado. O
[dossiê](../output/game-generation/media-comparison-20261113-a1/report.json)
separa prova técnica de audição física, cliente instalado e aceite artístico.
Zero inferências, instalação ou publicação. Alien continuou sem DNS; nenhuma
tentativa Root foi reiniciada. O escopo integral e suas pendências permanecem.

Avanço de fonte **GD-03/GD-08, 2026-11-13**: [PNG sem perda de pixels](GAME_PNG_OPTIMIZATION.md)
em composição/atlas, por escolha explícita; padrão/receitas legadas preservados.
O worker compara RGBA/RGB/cinza/paleta exata, informa bytes e não quantiza.
O Studio usa capacidade do serviço, rascunhos privados, confirmação e aplicação
separada; o worker fixo Core recusa o novo campo. Passaram718 testes,31
verificações, um opt-in ignorado, check/builds e roteamento simulado. O ensaio
`2026-11-13T11-21-04-707Z-82ba30d7` usou motor/SDK/TLS/worker, renderer e loaders
Phaser/Babylon reais com pontes dos hosts emuladas: restauração, reinício,
resposta perdida, recusa/replay idêntico, um candidato por namespace e originais
preservados. A fixture de216.127 bytes caiu para46.083 com samples idênticos;
não é promessa de taxa ou arte final. Falha inicial do roteiro preservada.
O [dossiê](../output/game-generation/png-lossless-20261113-a1/report.json) registra
o pacote exato e limites. Nenhuma IA, instalação, publicação ou renovação de
orçamento; qualidade integral e os gates anteriores continuam pendentes.

Avanço de fonte **GD-04/GD-05/GD-10, 2026-11-13**: a
[permissão fixa por hash de uma regra CSS vazia](GAME_EMPTY_STYLE_POLICY.md)
resolveu a interferência da captura WebKit em novos builds web. A regra não tem
declarações; CSS genérico, atributos de estilo e scripts embutidos continuam
recusados. Quatro combinações de adaptador/browser passaram por testes negativos
com o motor empacotado real, sem filtro de erros ou patch da biblioteca.
Lume foi recompilado: mesmo hash de fonte, somente o HTML mudou, artefato
`93be1ac1…`. A campanha inteira passou em Chromium, WebKit e Firefox; nos dois
últimos, o build exportado usou apenas arquivos locais, sem Agent Service/IA.
Qualidade integral continua falsa. O artefato anterior e os ensaios recusados
foram conservados. Passaram713 testes,31 verificações, um opt-in ignorado,
check/builds/roteamento simulado; não houve instalação ou publicação. O
[dossiê](../output/game-generation/web-empty-style-20261113-a1/report.json)
registra hashes, recusas, capturas, recuperação e aceites ainda pendentes.

Avanço técnico **GD-10, 2026-11-13**: [compatibilidade de Lume entre navegadores](GAME_BROWSER_COMPATIBILITY.md).
O mesmo build exportado passou pelos doze jardins no Firefox146.0.1 de teste,
sem Agent Service/IA, com checkpoint, mapa após reload, pausa, retrato e nenhum
erro/bloqueio. WebKit26.0 atravessou o conteúdo, mas o ensaio permaneceu recusado
por mensagens CSP geradas pela captura do Playwright1.58.2; diagnóstico curto
isolou a relação entre PNGs e mensagens. Sem filtro de erros ou alteração de
política, biblioteca, jogo ou artefato. Inventários completos antes/depois e
fechamento preservados; navegadores comerciais, dispositivos físicos, arte/
áudio e pessoas continuam pendentes. O
[dossiê](../output/game-generation/browser-matrix-20261113-a1/report.json) conserva
falhas e diferencia percurso observado de aceite integral.

Avanço de fonte **GD-03/GD-08, 2026-11-13**: [linha do tempo para editar chaves
3D](GAME_KEY_TIMELINE.md), com seleção/paginação, ponteiro, teclado, cancelamento,
cópia e remoção explícitas. Mantém trilhas/valores e recusa quadros ocupados,
sem cortar chaves quando a duração diminui. Reutiliza rascunhos privados e pedido
congelado, sem codec, deformação ou IA na interface. O ensaio
`2026-11-13T10-13-57-904Z-837c2312` passou nos dois produtos com serviço/SDK/TLS,
Blender isolado real, renderer em Chromium e pontes/confirmações emuladas;
incluiu reinício, resposta perdida, bloqueio de edição, recusa/replay, visor e
aplicação explícita. Originais preservados, um novo job por namespace, qualidade
falsa e nenhuma inferência. Mac continua bloqueado para aceite nativo; o
controlador do Alien continua indisponível. Não é instalação, aceite artístico
ou conclusão do plano. O [dossiê](../output/game-generation/key-timeline-20261113-a1/report.json)
registra fontes, testes e limites desta etapa.

Avanço de fonte **GD-02/03, 2026-11-13**: [parecer visual sobre PNGs](GAME_VISUAL_OPINIONS.md)
no motor comum, com papel explícito, imagem original privada, vínculo imutável e
orçamento/recibos compartilhados. Passaram oito casos direcionados,713 testes
gerais e31 verificações, um opt-in ignorado; check/builds e roteamento simulado
também passaram. Pacote real/SDK/TLS e Standard/Deep foram exercitados com respostas
HTTP/SSE simuladas. Não é visão real, instalação ou aceite artístico. A avaliação
Luna permanece no bloco esgotado, sem renovação. O
[dossiê](../output/game-generation/visual-opinion-20261113-a1/report.json) conserva
artefato, hashes e falha inicial da fixture.

Fonte **GD-07, 2026-11-13**: candidato de player Unity com página própria,
scripts/CSS/JSON locais, avisos completos como texto e ciclo de vida explícito.
Não registra a engine ou substitui o broker/licença/build real. A
[referência do player](GAME_UNITY_PLAYER.md) e o
[dossiê](../output/game-generation/unity-player-20261113-a1/report.json) separam
protocolo simulado, política de navegador e aceite Unity ainda pendente. A
observação final é parcial: início/recusas, WASM e avisos foram exercitados;
tela cheia recebeu `not granted`, com mensagem apresentada e aceitação positiva
pendente. Passaram705 testes e31 verificações, um opt-in ignorado.


Avanço **GD-07, 2026-11-13**: inspeção independente da saída Unity em fonte,
com TAR/diagnóstico limitado, conjunto coerente Web e tabela UnityWebData sem
execução de HTML/JS/WASM ou extração. Inclui preservação de nomes com BOM no
parser comum. Não registra adaptador, produz player ou comprova licença/build.
O [contrato e limites](GAME_UNITY_PROJECTS.md#inspeção-independente-da-saída--fonte-de-2026-11-13)
registram as pendências; o
[dossiê](../output/game-generation/unity-output-20261113-a1/report.json) identifica
os testes e artefatos próprios desta etapa.


Atualização de fonte **2026-11-13 — comparação textual GD-08**: o serviço comum
agora projeta linhas de duas revisões imutáveis; SDKs e Game Studio Mac/VS Code
apresentam contexto, quebras, paginação vinculada e exportação histórica. Binários
e limites retornam recusa explícita, preservando os originais. Consulte o
[contrato, limites e evidências](GAME_REVISION_COMPARISON.md#conteúdo-de-arquivos--fonte-de-2026-11-13).
Não é aceite instalado, comparação visual/sonora ou conclusão de GD-08.


Objetivo integral: [plano de implementação](GAME_DESIGN_IMPLEMENTATION_PLAN.md).
Estado: **ativo; entrega integral não concluída**. Atualização: 2026-11-13 UTC.
Não interpretar marcos de código como redução do escopo ou aceite do produto.

## Conferência atual: produto ainda não qualificado

A frente Unity ganhou [preflight de projetos e exportador C#](GAME_UNITY_PROJECTS.md)
em fonte. O driver compilou contra o compilador/referências exatos da LTS, sem
abrir Unity, executar a DLL ou ativar licença. Há catálogo de módulos integrados,
validação de versão/cenas/bytes/pacotes e diagnóstico sem conteúdo privado.
O empacotamento inclui fonte/locks e um inspetor puro de candidatos; SDK/TLS/serviço com duas identidades
confirmam que isso não registra Unity, não admite build nem troca de engine.
Licença, broker, isolamento, import/build2D/3D reais e jogador continuam pendentes.
Registro: `output/game-generation/unity-driver-20261113-a1/report.json`.

O [Lume completou o percurso dos doze jardins no navegador](GAME_LUME_QUALIFICATION.md),
com build pelo motor empacotado/SDK/TLS, checkpoint restaurado, desfecho e mapa
inteiro recuperado após reload. A fonte do jogo não mudou; o observador externo
foi corrigido após três tentativas falhas, todas conservadas. Foram recolhidas22
das36 sementes por controles normais, sem escrita de estado ou inferência.
O build exportado passou novamente pela campanha somente com arquivos locais,
sem Agent Service/Agent API, incluindo save, pausa e viewport retrato.
Isso é qualificação técnica de conteúdo autoral, sem geração autônoma, revisão
artística/sonora ou aceite físico/humano. `quality.ready` permanece falso.
Fonte/build/motor, exportação e logs:
`output/game-generation/lume-campaign-20261113-a1/report.json`.

O [alvo opcional de contexto de trabalho](CONTEXT_WORKING_BUDGET.md) está em
fonte e foi exercitado no motor empacotado independente, SDK/TLS e grafos
Standard/Deep com respostas locais simuladas. Não redefine a janela do modelo,
o provedor ou a quota. Política antiga permanece no run após reinício; só novas
admissões recebem a nova configuração. Resumos privados, uso contabilizado,
recusa de arquivo inválido e replay sem inferência foram conferidos. Uma pilha
Deep sem perfil reduziu o maior histórico simulado de41.959 para8.291 caracteres,
com cinco chamadas de resumo adicionais, todas contabilizadas; isso não mede
tokens/custo ou qualidade de Luna real. Ausência mantém defaults e KidOS não
aplica essa política. Nenhuma instalação ou alocação real mudou; a avaliação
Luna continua parada no bloco esgotado. Passaram682 testes, um opt-in ignorado,
31 verificações, check/builds e roteamento local simulado. Fontes/logs/hashes:
`output/game-generation/working-context-20261113-a1/report.json`.

O [visor 3D agora tem linha do tempo de inspeção](GAME_MODEL_VIEWER.md#navegação-da-animação):
busca por ponteiro/teclado, avanço/recuo por quadro, limites e retorno à pose
inicial, sempre sem reprodução automática. O teste com 32 clips reais observou
mudança de pixels, pose estável e teclado sem giro da câmera; um asset estático
real manteve controles desabilitados e layout sem overflow em 520 × 720.
Candidatos completos, fonte do visor, capturas e hashes foram preservados.
Passaram 673 testes e 31 verificações, um opt-in ignorado, check/builds Mac/extensão
e roteamento local simulado. É código dos clientes em Chromium temporário,
sem timeline gráfica de edição, aceite nativo/instalado, IA ou nova distribuição.
Registro: `output/game-generation/model-timeline-20261113-a1/report.json`.

O caminho 3D também passou no **motor empacotado independente**, manifesto
`5f65b9ffb1515a17bf99d87a49f1ab4d2c2ae4e6f434909d1fca1007dc16a7b0`,
Node22.23.4/darwin-arm64: dois produtos autenticados, Blender isolado,
resposta perdida, reinício, repetição idempotente e aplicação explícita, sem IA.
O ensaio `2026-11-13T06-14-41-015Z-f7c91288` preservou todos os arquivos e
confirmou o bundle íntegro após executar. Os roteiros Electron/VS Code reais
foram ampliados e preparados, **ainda não executados nessa extensão**; a sessão
gráfica foi encontrada bloqueada e o desbloqueio solicitado. O builder agora
aceita destino novo e recusa sobrescrita; o motor anterior permaneceu intacto.
672 testes e31 verificações passaram, com um opt-in ignorado, check/builds e
roteamento local simulado. Desenvolvimento sem assinatura de release, instalação
ou publicação. [Limites e percurso](GAME_MODEL_EDITING.md#motor-empacotado-e-preparação-dos-hosts-nativos--2026-11-13-utc).
Registro: `output/game-generation/model-editor-native-20261113-a1/report.json`.

A [edição dirigida 3D no Studio](GAME_MODEL_EDITING.md) agora cobre
transformações, materiais, vértices/pesos, repouso dos ossos, chaves de animação
e câmera/luzes da receita. Usa o schema canônico, fontes originais limitadas,
rascunho privado e confirmação antes de outro candidato; aplicação é separada.
O ensaio `2026-11-13T06-00-30-806Z-18401459` passou com Blender/SDK/TLS/serviço,
renderer real e pontes Mac/VS Code emuladas: fechar/reabrir, falha de gravação,
reinício, resposta perdida, recusa e retomada sem job duplicado. Originais,
variantes, receitas e hashes ficaram preservados. Passaram672 testes e31
verificações, um opt-in ignorado, check, builds Mac/extensão e roteamento local
simulado. Não usou IA nem instalou/publicou. Viewport editável, timeline gráfica,
aceite nativo/instalado e demais critérios integrais continuam pendentes.
Registro: `output/game-generation/model-editor-20261113-a1/report.json`.

A [deformação por pesos explícitos](GAME_BLENDER_ADAPTER.md#deformação-por-pesos-explícitos)
foi implementada no contrato, driver isolado e inspeção GLB independente.
Geração e edição registrada preservaram pesos/clips; Babylon/Chromium confirmou
base fixa e movimento dos vértices mistos. Reinício, aplicação explícita,
importação idempotente e isolamento dos dois contêineres passaram. A imagem
nova ficou separada da anterior, sem modificar provisionamento global nem
instalação. Passaram671 testes e31 verificações, um opt-in ignorado, check/build
e roteamento local simulado. Não houve IA; a peça geométrica de teste não é
personagem final ou aceite artístico/físico/humano. Registro:
`output/game-generation/weighted-skinning-20261113-a1/report.json`.

A [restauração de revisão](GAME_STUDIO_UI.md#restauração-recuperável--fonte-de2026-11-13-utc)
agora preserva um pedido durável no host antes de despachar. A retomada confere
o recibo original sem repetir commit ou apagar trabalho posterior; renderer e
pontes Mac/VS Code emuladas passaram com serviço real e dados sintéticos.
Aceite nativo/instalado dessa ampliação permanece pendente; não consumiu IA.
Passaram668 testes/31 verificações, com um opt-in ignorado, builds e roteamento
local. Evidência: `output/game-generation/studio-restore-recovery-20261113-a1/report.json`.

A [compactação entre papéis](MODEL_CONTEXT_WINDOWS.md#isolamento-de-compactação-entre-supervisor-e-especialistas--2026-11-13-utc)
foi corrigida em fonte: supervisor e especialistas agora possuem instâncias
independentes do middleware oficial. Uma reprodução Deep com modelos simulados
concluiu16 leituras, dois resumos privados contabilizados e replay sem nova
inferência/leitura; o controle anterior reproduz a falha. Isso não antecipa o
gatilho do Luna sem perfil, não amplia seu bloco e não comprova qualidade real
ou instalação. Passaram667 testes/31 verificações, com um opt-in ignorado, check/build e
roteamento local somente leitura. Registro:
`output/game-generation/compaction-isolation-20261113-a1/report.json`.

A recuperação foi executada com OpenAI. Após o prazo excedido de `gpt-5-mini`
e a escolha posterior do usuário, o motor usou **GPT-6 Luna** na mesma sessão e
no mesmo bloco. Chegou à revisão47 com alterações e recursos locais aplicados,
mas parou por alocação esgotada. A QA do operador, sem IA, construiu a revisão:
canvas visível, sem erros de recursos/console, dois cenários aprovados e um falho;
ainda sem aceite de qualidade. O bloco soma 75 admissões e duas reservas sem
usage. Nova autorização está pendente; não há renovação automática nem instalação.
Veja [a sequência e os limites](GAME_GENERATION_EVALUATION.md#openai-executado-escolha-de-luna-e-limite-atingido--2026-11-13-utc).

A referência cooperativa **Maré a Dois/Godot** completou a qualificação técnica
da campanha: doze travessias e final por teclas usuais, mapa recuperado após
reload, dois contatos emulados independentes, cancelamento, pausa e mute/save.
Regras/cena isoladas, build/exportação e reinício do serviço também passaram.
O [método e as falhas preservadas](GAME_MARE_QUALIFICATION.md) distinguem essas
observações de aceitação por pessoas/dispositivos. Agora há **cinco campanhas
autorais observadas em desenvolvimento**, de seis exigidas; corrida/Unity,
arte/áudio, desempenho físico e playtests continuam pendentes. O WASM Godot de
39,5MB sem compressão excedia a meta de carregamento. A fonte do
[transporte privado](GAME_ARTIFACT_DELIVERY.md) agora negocia gzip sem alterar
os bytes/hashes originais: o mesmo tabuleiro apareceu em6,07s, contra17,43s
identity, em20Mb/s/100ms emulados. A medição não qualifica dispositivos físicos
ou instalação; a primeira observação falsa da tela de título foi rejeitada e preservada.
A repetição com transporte novo completou as12 travessias, final e retomada;
666 testes/31 verificações e roteamento local passaram, com um opt-in ignorado.
Registro: `output/game-generation/mare-compressed-delivery-20261113-a1/report.json`.


O trabalho está em desenvolvimento/integração, com infraestrutura avançada e
produção autônoma de um jogo acabado ainda não demonstrada. Há cinco referências
autorais em qualificação, de seis exigidas; nenhuma tem aceite integral físico/
humano. Unity, composição instalada Navi e distribuição de Game Design continuam
pendentes. Contagem de testes não representa percentual de conclusão do produto.

Fundação anterior: avaliação durável e [teto restritivo do proprietário](OWNER_INFERENCE_LIMITS.md).
Novas avaliações preservam identidade/estado em cache privado; inspeção e
continuação mantêm as guardas anteriores. O motor empacotado aplicou limites em
Standard/Deep simulados: duas admissões entre sessões, reinício sem devolver
consumo e terceira invocação bloqueada antes do provedor. Configuração inválida
recusou bootstrap sem alterar o banco ou expor conteúdo.

O Correio das Correntes foi preparado para recuperação de domínio: 34 revisões,
todos os arquivos conferidos por hash e um novo build/preview de referência.
Fonte e falhas foram preservadas, sem checkpoint, cotas ou aprovações legadas
importados. O novo namespace confirmou zero invocações e bloco único de até 128,
com alocação de 4.194.304 tokens; resultado/saldo antigos continuam desconhecidos.
Naquela preparação, a seleção do operador foi **OpenAI**, com identidade
separada somente OpenAI; a preparação Ollama permaneceu sem inferência.
A execução posterior com Luna e a nova pendência de autorização estão descritas acima.
O comando exige essa decisão, confere novamente projeto/identidade/engine/limite
e recusa sessão já utilizada. É calibração com fonte recuperada, não teste inédito.

Passaram **653 testes de aplicação, um opt-in ignorado e 31 verificações do
repositório**, 15 testes direcionados, check, builds e roteamento simulado.
O [dossiê](../output/game-generation/durable-evaluation-20261113-a1/report.json)
fixa o motor, a preparação e as provas. Não houve instalação ou publicação.
O saldo de tokens é alocação/reserva de admissão, não teto rígido do provedor.

A nova [leitura de diagnósticos](GAME_REPORT_READS.md) passou em 27 testes
direcionados, suíte completa de 637 aprovados/um opt-in ignorado, 31 verificações
do repositório, builds e roteamento simulado. O ensaio nativo
`2026-11-12T18-11-22-987Z-69f959d4` demonstrou leitura de erro real de navegador
pelos grafos Standard/Deep com inferência simulada. Isso não demonstra decisão
autônoma de correção por modelo real. O ensaio adicional de correção controlada
`2026-11-12T18-14-48-694Z-5acae6a9` excedeu a observação e preservou dados: a
inspeção encontrou processo ausente e run persistido em `awaiting_approval`, sem
resultado terminal. Outro ensaio, `2026-11-13T01-18-35-162Z-970b4f3b`, não confirmou
bootstrap no prazo de observação; não reiniciar esses serviços por suposição.
Essas falhas permanecem abertas; não contar o ciclo completo como aprovado.

A qualificação controlada posterior `2026-11-13T01-22-49-626Z-0925397a` passou:
Deep leu o erro real de uma fixture, editou a fonte, solicitou as duas aprovações,
construiu/testou a nova revisão e leu o diagnóstico sem aquele erro. Relatórios
falhos foram preservados, replay não repetiu efeitos e qualidade integral
continuou falsa. As decisões foram uma sequência de inferência simulada,
portanto o ciclo por modelo real continua pendente. O
[dossiê](../output/game-generation/game-report-tools-20261113-a1/report.json)
fixa o motor verificado, fontes e limites; não é release ou instalação.

A nova referência [Arco/Phaser](GAME_REFERENCE_GAMES.md#arco-arcade-e-física)
acrescenta arcade/física ao portfólio. Doze mesas, pontuação/combos/estrelas,
teclado/arrasto, arte e partitura originais, pausa e checkpoint de voo estão em
fonte. A campanha inteira foi observada por controles comuns no navegador,
com build/exportação/recuperação reais e qualidade integral ainda falsa.
O primeiro ensaio falhou na quarta mesa; uma regressão reproduziu divergência
por cadência de frames e a correção manteve passos constantes com acumulador.
O ensaio final `2026-11-13T01-45-03-490Z-db18638f` conserva o build e as
observações das doze mesas. O build posterior `2026-11-13T01-50-14-268Z-24f4b109` repetiu a campanha e passou no toque emulado, cancelamento sem lançamento, checkpoint, pausa e mute; preservou a falha anterior de `touchcancel` não cancelável, corrigida na configuração do jogo. Não é geração autônoma nem aceite físico/humano.

Regressão final dessa frente: **643 testes aprovados, um opt-in ignorado e 31
verificações do repositório**, TypeScript, build da extensão e roteamento local
simulado passaram. Os seis testes específicos cobrem campanha, física/colisões,
cadências de frames, checkpoint/armazenamento e contratos. Os bytes da fonte
atual foram conferidos contra a revisão exportada qualificada. O
[dossiê Arco](../output/game-generation/arco-reference-20261113-a1/report.json)
reúne hashes, artefato, percursos, testes e pendências, sem publicação/instalação.

A tentativa real Windmail de 01:05 UTC perdeu seu processo e diretório temporário
antes da conferência seguinte. A última inspeção autenticada e os eventos
públicos preservados não fornecem resultado terminal nem cota disponível.
Não repetir inferência/efeitos ou recriar orçamento a partir dessa ausência.
O preview independente do build da revisão35 mostrou tela preta, seis recursos
ausentes e erro de áudio. A exportação anterior, revisão34, também contém receita
de testes inválida. Ainda não existe jogo gerado aprovado nessa avaliação.

Os registros a seguir são históricos datados; descrições de processos então
ativos não comprovam execução atual.

Frente anterior: [edição dirigida de arquivos de jogo](GAME_FILE_EDITS.md).
O catálogo do motor oferece alterações literais atômicas com hash do arquivo e
revisão exatos, preservando bytes não afetados, MIME, outros arquivos e recibos.
Os grafos Standard/Deep a exercitaram com modelo simulado; replay, conflito,
UTF-8/binário e recuperação passaram. Suíte final: 633 testes aprovados, um
opcional ignorado e 31 verificações do repositório, com check, builds e
roteamento simulado. O primeiro ensaio ignorou também um preview por browser
indisponível; a repetição dirigida e a suíte final o executaram com sucesso,
sem comprovar a causa da indisponibilidade. Falha de tipos da fixture MIME foi
preservada, com correção do teste para um formato de transferência permitido.
[Dossiê](../output/game-generation/game-text-edits-20261111-a1/report.json).
Nenhuma instalação, publicação ou habilitação do caminho genérico no KidOS.

Em paralelo, a [continuação real com contexto verificado](GAME_GENERATION_EVALUATION.md#continuação-com-janela-verificada--2026-11-12-utc)
preserva a sessão e o orçamento Windmail, com 131.072 tokens confirmados pelo
Ollama carregado. Na inspeção de 01:19:09 UTC, o run original seguia em execução
e o build da revisão34 estava concluído; gameplay/arte/QA ainda não comprovados.
O processo usa o motor congelado anterior, sem receber a nova ferramenta em
tempo de execução. Autenticação do ensaio nativo KidOS continua não demonstrada:
a consulta SSH deste turno não resolveu `alien.local`, sem iniciar/repetir ensaio.

Frente anterior: [janela efetiva de contexto por alias](MODEL_CONTEXT_WINDOWS.md).
Contratos, factories e grafo comum recebem a declaração; Mac/VS Code oferecem
configuração como clientes. Compactação nativa Standard/Deep foi exercitada com
orçamento real do serviço e provedor SSE simulado, sem expor o resumo privado.
O Mac congela a configuração por run, inclusive após espera/reinício; o ensaio
do motor empacotado confirmou replay sem novas chamadas. Passaram 628 testes
de aplicação, um opcional ignorado, 31 verificações do repositório, builds e
roteamento simulado. Capturas Mac nativas e formulário VS Code com ponte
simulada têm limites explícitos no
[dossiê](../output/game-generation/model-context-20261111-a1/report.json).
Essa qualificação não fez instalação, inferência real ou alteração de configuração pessoal.

Frente anterior: [diagnóstico do prazo do SDK no motor comum](MODEL_CAPABILITIES.md#prazo-do-sdk-transformado-pelo-langchain--2026-11-11).
A base simulada reproduziu perda de diagnóstico porque o wrapper oficial
transforma o erro em `TimeoutError`. A correção mantém identidade de modelo,
HTTP/cancelamento, reserva sem usage e replay sem redispatch; passou em
Standard/Deep empacotados e nos dois modos do runtime Mac. Suíte completa:
620 testes de aplicação aprovados, um opcional ignorado, 31 verificações do
repositório; depois, 13 testes dirigidos passaram, incluindo dois novos casos
Mac. Builds e roteamento simulado de leitura passaram. O artefato de
desenvolvimento foi congelado/verificado, sem instalação ou geração real.
[Dossiê](../output/game-generation/model-deadline-20261111-a1/report.json).

A conferência privada somente de leitura do Windmail terminou sem alterações
nos bancos: etapa `core` com 154/256 chamadas, nenhuma pendente, sete sem usage.
Não houve concessão de outro bloco. A estimativa/forma do checkpoint não
comprova excesso de contexto ou causa da falha; o perfil do alias não declara
janela efetiva. A configuração genérica agora tem qualificação simulada em fonte;
a janela real desse servidor/alias não foi declarada nem aplicada. O run
histórico continua `failed`, revisão34 sem build aprovado.

Frente anterior: [Vigília/Babylon, referência de exploração 3D](GAME_REFERENCE_GAMES.md#vigília-exploração-babylonjs).
Três ilhas, doze memórias, nove ressonadores, caminhos progressivos e retorno ao
cais. A fonte foi construída/exportada pelo serviço e percorrida no navegador
por controles normais, com recuperação do save final. Os dois contatos de toque
simulados e seu cancelamento foram observados no build exportado, sem iniciar
motor/modelo. Arte/síntese são originais locais; revisão artística/sonora,
dispositivos físicos e dez jogadores reais continuam pendentes. Passaram 616
testes de aplicação (um opcional ignorado), 31 verificações do repositório,
builds e roteamento Standard/Deep simulado de leitura. Fonte/hash/artefato,
capturas, falhas preservadas e limites estão no
[dossiê Vigília](../output/game-generation/vigilia-reference-20261111-a1/report.json).
Nenhuma instalação ou publicação foi realizada; `quality.ready` continua falso.

Frente anterior: [comparação estrutural de revisões](GAME_REVISION_COMPARISON.md)
na API, SDKs e Studio Mac/VS Code. São consultas paginadas de duas versões
imutáveis, com campos lado a lado e metadados, sem restaurar ou aprovar o jogo.
Passaram 612 testes de aplicação (um opcional ignorado), 31 verificações do
repositório, builds, roteamento simulado e os percursos das duas janelas reais
em perfis temporários. Uma falha de confirmação da exportação Mac anterior à
comparação continua preservada, com causa ainda não isolada. Comparação visual/
sonora ou por linha, instalações e aceite integral continuam pendentes.
Dossiê: [`revision-comparison-20261111-a1`](../output/game-generation/revision-comparison-20261111-a1/report.json).

Os [playtests no Studio](GAME_PLAYTESTS.md) e rascunhos duráveis permanecem em
desenvolvimento, com dados sintéticos nos ensaios. Nenhum jogador real,
instalação ou release foi acrescentado nesta frente. Dossiê anterior:
[`playtest-ui-20261111-a1`](../output/game-generation/playtest-ui-20261111-a1/report.json).

Windmail recebeu o único bloco adicional autorizado pelo usuário. A continuação
com `qwen3.6:latest` terminou em falha de inatividade, identificada por
`model.failure: response_inactivity / UND_ERR_BODY_TIMEOUT`; as revisões 31/6
foram preservadas, sem novo jogo aprovado. A autorização não fica pendente nem
permite renovar outro bloco automaticamente. Consulte a
[atualização terminal](GAME_GENERATION_EVALUATION.md#bloco-adicional-autorizado-e-falha-identificada--2026-11-11).

A avaliação posterior escolheu explicitamente `qwen3-coder:30b` já instalado,
sem mudar a configuração dos aplicativos. Manteve projeto/sessão/saldo do bloco
existente e recusou novas ampliações. O handle 54965 terminou com exit1, run
`failed` / `Request timed out.`; sem evento `model.failure` nesta tentativa, a
causa específica permanece não classificada. O original chegou à revisão34,
sem build dessa revisão. Não há jogo aprovado. Veja a
[continuação e auditoria terminal](GAME_GENERATION_EVALUATION.md#continuação-com-modelo-explicitamente-escolhido--2026-11-11).

Registro anterior do transporte: a continuação de Windmail com `qwen3.6:latest`
terminou com `terminated`, ainda sem jogo aprovado. A causa histórica não ficou
registrada. A reprodução simulada distingue queda de conexão e inatividade, e
o [diagnóstico comum em fonte](MODEL_CAPABILITIES.md#falha-durante-a-resposta-do-modelo--fonte-de-2026-11-11)
agora preserva a causa reconhecida, erros de autoridade, texto parcial e reservas
desconhecidas. O run antigo tem 21 chamadas com usage informado e uma sem usage,
cuja reserva de 65.536 tokens foi mantida. Não houve nova geração, alteração
manual do jogo, instalação ou aumento de prazo nesta correção. Consulte o
[registro delimitado](../output/game-generation/provider-termination-20261111-a1/report.json).

## Requisitos e evidências

| Frente do plano | Estado atual | Evidência / o que ainda falta |
|---|---|---|
| Contratos de projeto e design v2 | Implementados em fonte | `packages/contracts/src/games.ts`; gêneros completos sem narrativa/quantidade de fases universal |
| Revisões, idempotência, concorrência e persistência | Implementados em fonte | `game-projects.ts`, transações SQLite e testes de serviço |
| Arquivos grandes, namespace e SDKs | Implementados em fonte | Transferências verificadas, histórico fixando blobs, SDKs TS/Python; teste TLS/IPC com 9 MiB |
| Layout portável de arquivos | Validação reforçada em fonte | Rejeita colisões arquivo/diretório, divergência de capitalização em pastas compartilhadas, Unicode inválido e componentes maiores que 255 bytes UTF-8/unidades UTF-16; não renomeia dados automaticamente |
| Intercâmbio e leitura de design v1 | Parcial | Arquivo de revisões e conversor preservando fonte; migração dos projetos reais KidOS e arquivos incompatíveis ainda pendentes |
| Evidências vinculadas ao build e invalidação de QA | Base e observação de navegador implementadas em fonte | Jobs, artefatos/relatórios/PNG transacionais, toolchain exata e coletor Chromium real; demais coletores e aceite integral dos jogos pendentes |
| Especialistas, roteamento e orçamento de produção | Parcial em fonte | Perfil v2 0.2.0, sete disciplinas, seleção semântica e delegação oficial Deep; [etapas](GAME_PRODUCTION_WORKFLOWS.md), [inferência por namespace/etapa](INFERENCE_BUDGETS.md) e [backend protegido KidOS](GAME_KIDOS_INFERENCE.md) em fonte; consumidor opcional KidOS com espera/inspeção ABI 1; composição instalada, etapas protegidas, custos/duração e cobertura integral ainda pendentes |
| Ciclos e aceite de produção | Implementados em fonte | Gates cumulativos para fonte atual, bloqueio por job pendente/desconhecido, avanço atômico, ciclo concluído exigido para entrega, revisão/build aceitos preservados e eventos exportados; migração dos ciclos e aceite instalado ainda pendentes |
| Recursos agregados de produção | Fila implementada em fonte | Builds, coleta e mídia compartilham estimativas de memória/CPU, concorrência e exclusividade; FIFO, cancelamento e reservas desconhecidas após reinício; inferência, previews e orçamento por etapa ainda separados |
| Recuperação da coleta de navegador | Supervisor durável em fonte | Auxiliar Node verificado, recibos por namespace/build/toolchain, parada após perda do motor e candidato recuperado sem outra coleta no Mac ARM64; morte não confirmada do auxiliar e demais hosts permanecem na matriz |
| Arte, animação, áudio e bibliotecas | Processamento, geração vetorial e biblioteca offline parciais em fonte | [Catálogo licenciado fixado](GAME_LICENSED_LIBRARIES.md) com 22 modelos e personagem com 32 clips originais; [SVG original tipado, PNG/composição/atlas e WAV/síntese/mixagem com [medições/envelope](GAME_AUDIO_ANALYSIS.md)](GAME_ASSET_PIPELINE.md) e [Blender isolado](GAME_BLENDER_ADAPTER.md) para modelo/GLB, rig rígido, pesos explícitos e clips; [ajustes tipados de receitas no Studio](GAME_MODEL_EDITING.md), geração/edição com deformação observadas em fonte, proveniência declarada, candidatos e aplicação transacional; ampliar geração autorizada, licenças verificadas, rigging avançado e cadeia artística completa continuam pendentes |
| Phaser completo | Parcial | Compilador offline com runtime 4.2.1 verificado, TypeScript/CSS modular, assets e licenças; fixture compilada pelo motor empacotado e renderizada em navegador; cadeia completa de produção/QA pendente |
| Babylon.js completo | Parcial | Compilador offline com runtime e loader glTF2 9.35.0 verificados; GLB produzido/editado no Blender e animação observados em Chromium; sistemas, assets finais e QA completos pendentes |
| Godot funcional | Base web em fonte; qualificação parcial | Godot 4.7.2 fixado, imagem local isolada, projetos nativos 2D/3D, edição, exportação e observação Chromium; isolamento/cancelamento/queda/reconciliação demonstrados no Mac ARM64; demais hosts, assets, UI e distribuição pendentes |
| Unity funcional | Preparação LTS, preflight/exportador em fonte; produção pendente | [LTS 6000.3.28f1](GAME_UNITY_QUALIFICATION.md) separada e verificada; [formato/exportador/inspeção de saída](GAME_UNITY_PROJECTS.md) com C# compilado, TAR/UnityWebData verificados como dados e guard SDK/serviço, sem abrir editor ou registrar adaptador; licença/broker, isolamento completo, runtime e builds2D/3D reais ainda pendentes |
| Interfaces Mac e VS Code | Superfície funcional em desenvolvimento | [Game Studio](GAME_STUDIO_UI.md): design por campos, assets, bibliotecas licenciadas com leitura da licença, composição PNG e edição vetorial por campos, builds/testes, revisões com comparação estrutural/textual paginada, [imagem/WAV históricos](GAME_MEDIA_COMPARISON.md) e restauração recuperável, preview isolado e exportações; renderer/SDK, Electron e VS Code reais ensaiados em perfis temporários no Mac; biblioteca/recarga também ensaiadas em janelas nativas com perfis temporários; desenho direto, edição artística ampliada, comparação de cenas/builds executados, audição física, demais plataformas e aceite das instalações pendentes |
| Navi, manifesto ampliado e broker protegido | Core, jogador e porta de produção em fonte; perfil v2 pendente | Bundles, lançamento com recibos e Lume por Core/IPC/WebKit Linux temporário; broker e porta SDK/serviço ensaiados, sem etapas/inferência protegidas completas ou Navi v2 ativo; não afrouxar o runtime atual |
| Recuperação de abertura pelo Navi | Catálogo opcional em fonte | [Identidade/inspeção do adaptador](INSTALLED_TOOL_INSPECTION.md), Core confirma o recibo original e UI não fornece resultado; Standard/Deep e modo Plano testados com inferência/ponte controladas; composição instalada e produção protegida continuam pendentes |
| Compilação protegida KidOS | Broker e porta em fonte, ensaiados por SDK/serviço/Core Linux x64 | [Worker fixo](GAME_WEB_COMPILER.md) e [porta protegida](GAME_CORE_PRODUCTION_PORTS.md), ABI 1, admissão, uploads e diário; SIGKILL do serviço recuperado sem outro início, seleção por produto e hashes conferidos; assinatura de teste, perfil v2 e instalação ainda pendentes |
| Mídia protegida KidOS | Composição offline aprovada e isolamento nativo Alien em fixture | [PNG/atlas/WAV](GAME_MEDIA_WORKER.md) por SDK/TLS/serviço/porta assinada/Core oficial/Root; pixels/áudio, cota conjunta, fila, SIGKILL e auditoria; nove cenários systemd/bwrap reais no Alien com runtime temporário do UID; provisão Root/composição instalada, Navi e aceite físico/artístico pendentes |
| Workers/atualização por computador KidOS | Fonte e shell real em Linux descartável; sem nova instalação de produto | Runtime/entrypoints e workers no journal; 841 testes, dois ignorados; nove cenários com Core/autoridade/SDK/motor/UIDs reais e managers simulados; release, systemd e login gráfico pendentes |
| Validações protegidas | Distribuição/rollback browser em fonte; isolamento nativo temporário e composição offline qualificados separadamente | Oito casos reais systemd/bwrap no Alien, 18 casos SDK/porta assinada/Core/Root com browser simulado e quarto componente assinado/chunked no instalador; composição nativa Root preparada, resultado ainda não obtido; consulta SSH atual não resolveu `alien.local`, sem reinício da tentativa; composição instalada/Navi v2 pendentes; não combinar provas distintas em aceite instalado |
| Qualidade, desempenho e dispositivos | Observação automatizada parcial | Chromium real observa entradas/pixels/erros; semântica, arte/áudio, desempenho físico, demais browsers e dispositivos continuam pendentes |
| Seis jogos completos e pedidos inéditos | Cinco referências autorais em qualificação; aceite integral pendente | [Lume, Farol, Vigília, Arco e Maré](GAME_REFERENCE_GAMES.md), incluindo campanha cooperativa; builds e observações reais, sem aprovação física/humana ou geração autônoma demonstrada; corrida/Unity, quatro adaptadores completos e pedidos inéditos pendentes |
| Produção por modelo real | Sem jogo aprovado; Luna chegou à revisão51 e encerrou o segundo bloco | [Continuação autorizada](GAME_GENERATION_ADDITIONAL_BLOCK.md): 58 chamadas novas, quatro revisões/builds/coletas; dois de três cenários passaram no último, com falha de entrada precoce diagnosticada separadamente sem alterar o artefato. Consumo4.200.064, excedente5.760 pela última resposta em curso; sem renovação. Fonte, resultados antigos e reservas permanecem preservados; qualidade e eficiência de geração pendentes |
| Avaliação humana | API e Studio em desenvolvimento; pessoas reais pendentes | [Estudos locais por build](GAME_PLAYTESTS.md), formulários Mac/VS Code, códigos, confirmação declarada, retirada, resumo, recuperação e exportação dirigida; integração parental, correção auditada, público real e dez pessoas por jogo com revisão/iteração continuam pendentes |
| Pacotes, instalação, migração e rollback | Pendente para esta entrega | Não confundir o rollback anterior do motor 1.0.2 com aceite de Game Design 1.0 |

## Validação executada nesta frente

Passaram na base de projetos: verificação TypeScript,
**335 testes de aplicação e 27 verificações do repositório**, build independente
do motor, build da extensão e smoke local de Chat Completions/LangChain/DeepAgent
com inferência simulada somente de leitura. O teste de projetos executou os SDKs
TypeScript e Python por TLS/IPC real, incluindo arquivo de 9 MiB, duas revisões,
importação entre namespaces e metadados transferidos em partes.

Logs locais de desenvolvimento ficam fora do pacote de distribuição. Consulte
[a API de projetos](GAME_PROJECTS_API.md) para escopo e limites; não houve geração,
aceite visual ou playtest de um jogo nesta frente. O motor construído é um
artefato de desenvolvimento, não substitui a release final 1.0.2 instalada.

Na frente seguinte, os testes exercitaram builds idempotentes, cancelamento com
confirmação, transações de artefatos, espera por reconciliação, toolchain original,
isolamento de produtos, SDKs TS/Python e rejeição de relatórios forjados. Os dois
compiladores web usaram runtimes oficiais fixados, sem resolver dependências do
host ou da rede. O smoke iniciou o Node e o serviço empacotados com dados
temporários e produziu builds Phaser/Babylon via IPC autenticado. A inspeção em
Chromium mostrou Canvas 2D e WebGL2; imagens em `output/playwright/` são evidência
de desenvolvimento, não jogos de aceite. Consulte a
[API de produção](GAME_PRODUCTION_API.md) para limites e verificações.

Verificação final dessa frente: TypeScript, **350 testes de aplicação e 27
verificações do repositório**, build do motor independente e build da extensão
passaram. O smoke do motor empacotado confirmou os dois caminhos web após os
ajustes finais. Essas evidências cobrem esta base de produção, não o aceite
integral dos adaptadores, as cinco plataformas ou os jogos finais.

A integração seguinte conectou o perfil v2 ao motor usado pelo editor e pelo
Mac. Dez cenários direcionados verificaram Standard/Deep, delegação real de um
especialista com escrita bloqueada, continuidade entre turnos/reinício, recusa
de catálogos forjados, isolamento KidOS, aprovação após desconexão, revisão sem
diff fictício no host e build web real solicitado pelo grafo. A verificação
completa passou com **360 testes de aplicação e 27 verificações do repositório**,
TypeScript, build da extensão, motor independente e smoke de inferência local
simulada somente de leitura. Consulte a [integração do executor](GAME_AGENT_PRODUCTION.md).
Não houve teste visual de uma nova superfície dos aplicativos nem substituição
das instalações. O consumidor protegido KidOS continua no contrato legado fixado.

Em 2026-11-10 foi acrescentado o
[coletor real de navegador](GAME_BROWSER_OBSERVATIONS.md), com receitas sem código,
comparação independente de PNG, recursos restritos ao build, cancelamento e
evidências transacionais. Os testes rejeitaram sucesso autodeclarado pelo jogo,
detectaram uma resposta visual ausente e bloquearam outra origem loopback.
Suites nomeadas não escondem casos falhos; SDKs TS/Python recuperaram os bytes
verificados de relatórios privados. O smoke do motor empacotado produziu e
observou as fixtures Phaser/Babylon, salvando PNG/JSON em `output/playwright/`.
Essas provas não certificam um jogo completo nem dispensam a matriz física/humana.

Verificação final dessa frente: **370 testes de aplicação e 27 verificações do
repositório**, sem testes ignorados neste Mac, TypeScript, build da extensão,
motor independente, smoke de inferência local e auditoria de produção passaram.
O smoke final `--observe` repetiu builds/coleta pelos SDKs no Node empacotado;
ambos produziram dois relatórios com início/console/caso observados aprovados,
PNG/JSON verificados e qualidade integral ainda pendente. A verificação unitária
da descoberta Windows lê versão/DLL sem iniciar um navegador pessoal; não equivale
a aceite físico Windows. Nenhuma instalação foi substituída.

## Validação do caminho Godot

Em 2026-11-10 foi integrado o
[adaptador Godot isolado](GAME_GODOT_ADAPTER.md). O motor empacotado criou e
exportou cenas nativas 2D/3D com GDScript/Compatibility. O coletor observou
respostas ao teclado e pixels; uma revisão alterada foi recuperada após reinício,
reconstruída e deduplicada. As fixtures continuam sem aceite de jogo completo.

O ensaio inspecionou rede desligada, fonte/raiz somente leitura, usuário sem
privilégios e limites de memória/swap/PIDs/tmpfs. Demonstrou cancelamento com
remoção comprovada e queda forçada do serviço com reconciliação do contêiner
original, sem repetir a exportação. O harness usa estado/socket temporários;
a limpeza do socket após morte confirmada não instala nem altera o LaunchAgent
do usuário. Sem recibo de candidato, o resultado fica explicitamente falho e
requer um novo pedido. Uma falha desconhecida durante cancelamento conserva
`awaiting_reconciliation`.

Os AudioWorklets exigiram transporte local real de recursos: o coletor passou a
usar um listener loopback descartável com autorização efêmera, restrito aos
blobs do build. O Agent API continua por IPC sem porta TCP. Testes rejeitaram
acesso sem autorização, origem externa, escrita e arquivos ausentes; arquivos
TAR rejeitaram links, caminhos inseguros, duplicação e overrides de tamanho.

A suíte completa passou com **377 testes de aplicação e 27 verificações do
repositório**, sem testes ignorados neste Mac. Após o último limite de tamanho
da configuração, passaram também os **16 testes direcionados** de Godot,
produção e recursos locais, TypeScript e novo build independente. O build da
extensão e o smoke LangChain/DeepAgent somente de leitura passaram. Evidências
dos builds/observações ficam em `output/playwright/godot-builds`, com o relatório
de ciclo de vida e as toolchains exatas. Não houve nova release ou instalação.

O artefato de desenvolvimento qualificado naquela frente tinha manifesto SHA-256
`137447bf363fdb46ef3996363c4f53bf00a26c619553f47e522efc6e67ae65d3`.
Nele passaram os três builds/observações Godot (2D, edição 2D e 3D), o ensaio de
ciclo de vida e a regressão empacotada Phaser/Babylon com dois relatórios por
engine. As imagens/JSON tiveram seus hashes conferidos; as avaliações de
qualidade integral permaneceram falsas. O HTML Godot exportado também conserva
a política de recursos locais fora do coletor. Os contêineres do ensaio foram
removidos. Esta identidade qualifica somente esse artefato local no Mac ARM64.

## Preparação Unity e portabilidade — 2026-11-10

A [preparação offline Unity](GAME_UNITY_QUALIFICATION.md) foi implementada com
lock LTS exato, hashes em streaming, assinaturas PKG/app, publisher e inventário
determinístico. O registro mantém `prepared-unqualified` e `available: false`.
Não foi criado um build simulado para anunciar disponibilidade. A instalação
Unity existente permanece distinta da ferramenta preparada em `.cache`.

O ensaio de arquivo/rede com canários passou, e a LTS respondeu à versão sob o
perfil restrito. A consulta de licença ao criar um projeto vazio não concluiu
dentro de 45 segundos; o auxiliar remanescente foi identificado por caminho
exato e encerrado. A licença não foi declarada ausente. Verificar o Hub pela UI
ficou pendente de desbloqueio do Mac, solicitado ao usuário. Isso não comprova
isolamento completo, licença disponível, build ou aceite Unity.

Na frente independente, a árvore de arquivos passou a ser validada no domínio,
nos artefatos, nas evidências e na leitura de TAR. Conflitos são rejeitados antes
de gravar blobs/relatórios, preservando a revisão anterior e os dados de entrada.
Testes cobrem ambos os sentidos de arquivo/pasta, capitalização, prefixos
semelhantes válidos, Unicode inválido e limites por componente. Não confundir
essa validação conservadora com qualificação física dos cinco sistemas.

Passaram **379 testes de aplicação e 30 verificações do repositório**, sem skips
neste Mac, TypeScript, build da extensão e novo motor independente. O smoke de
roteamento Standard/Deep foi somente de leitura, com inferência simulada. O
motor empacotado repetiu os builds/observações 2D/3D Godot, edição/retomada,
cancelamento e queda/reconciliação após os novos limites de nomes.

Manifesto de desenvolvimento desta frente:
`e409541c93b56c1ac2e57c945a55f27ecb3fae76ce6cdde7f87d82f566e8a7d1`.
Também passaram os builds/observações Phaser e Babylon no mesmo artefato; as
avaliações integrais dos jogos continuam pendentes. O inventário local Unity é
`d41dd68e66a444fc3a42e2d51a1fa3677bbc6e9a6024c18db23bc9466e68d50f`,
com 71.280 arquivos/links, sem ativação no motor. Nenhum pacote foi publicado ou
instalado nos clientes nesta frente.

## Processamento local de assets — 2026-11-10

O [pipeline de assets](GAME_ASSET_PIPELINE.md) acrescenta composição PNG,
atlas multipágina com trim/padding/animações e áudio WAV com síntese, mixagem,
fades, normalização e reamostragem filtrada. É uma frente parcial da cadeia
artística prevista, sem geração por provedor, Blender, curadoria de bibliotecas
ou aprovação visual/sonora. Fontes e licenças completas são preservadas como
declarações não verificadas; placeholders das fontes propagam ao derivado.

Processar cria um candidato imutável. Aplicar é uma decisão explícita que gera
nova revisão transacional, valida fingerprints/fontes/alvo e bytes, rejeita
sobrescrita de outros assets ou arquivos compartilhados e mantém candidatos
em caso de conflito. SDKs TS/Python, jobs/eventos e os grafos oficiais
Standard/Deep usam a mesma implementação. O processador local não está
autorizado no KidOS; a integração protegida permanece pendente.

Passaram **396 testes de aplicação e 30 verificações do repositório**, sem skips
neste Mac, TypeScript, build da extensão, motor independente e smoke de
roteamento somente de leitura com inferência simulada. Os testes exercitaram
pixels e formatos binários, filtro de reamostragem, transações com falha,
idempotência, alteração concorrente de fonte/alvo, namespaces, corrupção de
blobs, reinício e SDKs por TLS/IPC. O cancelamento confirmou término de um
worker observado em execução. Os limites do worker não constituem isolamento
de segurança do sistema operacional.

O novo `smoke:game-assets` executou quatro operações pelo Node empacotado:
composição, atlas, síntese e mixagem. Demonstrou reinício entre processamento e
aplicação e replay da aplicação sem nova revisão. O WAV foi inspecionado pelo
leitor Python independente. O build Phaser carregou o multiatlas processado e
respondeu ao teclado, com observação real de pixels e ausência de erros de
console. PNG/JSON/WAV e o relatório ficam em `output/playwright/game-assets/`.
São fixtures técnicas; qualidade integral continua falsa, sem aceite de jogo,
audição física ou avaliação humana.

Manifesto do artefato local desta frente:
`2be7bf656ba729d7e19acc78203d4ac5c9a3c104184c92aa8722c2f548b9b2eb`.
O inventário inclui `pngjs` 7.0.0/MIT e o worker no manifesto. Não houve
publicação ou substituição de instalações. As verificações Godot da seção
anterior permanecem vinculadas ao artefato anterior; não foram repetidas neste
artefato de mídia.

## Game Studio Mac/VS Code — 2026-11-10

O [Game Studio](GAME_STUDIO_UI.md) agora tem renderer compartilhado, controlador
SDK sem inteligência e integração nos dois clientes. Inclui design por campos,
assets/origem/licença declarada, captura observada, jobs/verificações, histórico
paginado dos mais recentes, restauração como nova revisão, preview isolado e
exportação de fonte/histórico/build. Os diálogos e permissões ficam nos hosts;
não foi criado outro motor, transporte Agent API em TCP ou acesso infantil
genérico ao sistema.

Cada comando e formulário fica vinculado ao projeto/revisão de origem. A troca
de seleção em outra janela não redireciona uma edição aberta. Exportações usam
pastas novas, hashes e ativação por rename, sem sobrescrever dados existentes;
falha de download remove somente a preparação. Caminhos no limite portável de
400 caracteres são preservados dentro dos diretórios de exportação. O preview
não usa perfil pessoal, não tem bridge do produto e serve somente bytes
conferidos contra o build; fonte idêntica em uma revisão restaurada continua
distinta de um novo build/aceite dessa revisão.

Passaram **400 testes de aplicação e 30 verificações do repositório**, sem skips
neste Mac, TypeScript, builds dos dois clientes, motor independente e roteamento
Standard/Deep simulado somente de leitura. O ensaio de UI utilizou o serviço
empacotado e os dois namespaces por TLS/IPC, com bridges emuladas, layouts claro,
escuro e reduzido, mídia, edição concorrente, restauração, jogo e exportações.
Os projetos de cada produto ficaram separados e a qualidade integral falsa.
O ensaio também simulou indisponibilidade da bridge: dados antigos permaneceram
identificados, a reconexão recuperou a consulta e o mesmo erro não foi anunciado
repetidamente nas atualizações de fundo.

Também passou uma janela **Electron 45.2.1 real de desenvolvimento**, com
preload/IPC do Studio, perfil temporário, ausência de Node e da bridge geral no
renderer, edição por campos, exportação e dados preservados ao fechar a janela.
Seus diálogos são simulados apenas no harness; esse resultado não comprova
notarização, instalação, o main completo do aplicativo ou o painel dentro do
VS Code real. Capturas e relatórios: `output/playwright/game-studio/`, incluindo
a subpasta `native-mac`. Os projetos são fixtures, não portfólio.

Manifesto do motor local usado nesta frente:
`987572a589080fa0a367f8ca4b545652c6032e3942d270878c38491141af4a08`.
No mesmo artefato passaram novamente mídia/atlas/WAV, reinício e aplicação,
builds/observações Phaser/Babylon e Godot 2D/3D, edição, cancelamento e
queda/reconciliação. Os contêineres do ensaio foram encerrados. A mudança no
transporte compartilhado preserva verificação de hashes, capacidade privada,
CSP e proibição de requests externos. Nenhuma instalação foi substituída ou
release promovida nesta frente.

## Painel VS Code real — 2026-11-10

O novo `smoke:game-studio-vscode` demonstrou o painel no **VS Code 1.145.2 real,
Mac ARM64**, com o motor empacotado de manifesto
`987572a589080fa0a367f8ca4b545652c6032e3942d270878c38491141af4a08`.
Não foi uma emulação de `acquireVsCodeApi`: nonce, recursos do webview,
mensagens, confirmações e seletor customizado de pasta foram exercitados pelo
editor. O teste utiliza `DevelopmentAgent`, `EditorServiceRuntime` e o módulo
Studio reais, vinculando somente a fábrica de conexão ao serviço temporário.
Não executa inferência, bootstrap/instalador, contas ou configurações pessoais.

Passaram leitura do projeto/captura, ausência de Node e bridge Mac no webview,
edição por campos, restauração como revisão 3, preview isolado, exportação de
fonte e preservação do projeto ao fechar o painel. O ensaio visual motivou o
layout compacto até 920 px e o uso correto dos tokens de link/botão do tema.
No painel real de 786 px, a rolagem horizontal permaneceu ausente.

O runner agora só informa sucesso após encerrar o grupo de processos criado e
o Crashpad do perfil temporário. A primeira observação mostrou que fechar CDP
pode manter Code sem janelas no Mac; esse estado foi inspecionado e encerrado
por identidade, sem atingir instâncias pessoais. A execução final confirmou
`cleanupVerified: true` e removeu seu perfil temporário. Evidências em
`output/playwright/game-studio/native-vscode/`.

Após o ajuste passaram novamente TypeScript, builds Mac/VS Code,
**400 testes de aplicação e 30 verificações do repositório**, sem skips neste
Mac. Este aceite é do componente em uma extensão de desenvolvimento com conexão
isolada; não comprova instalação da VSIX completa, bootstrap de publicação,
demais plataformas ou qualidade de jogos. Unity continua sem adaptador
qualificado: nova consulta ao Hub foi impedida pelo bloqueio do Mac, sem
alteração de licença ou fallback permissivo.

### Próximas frentes

Pendências técnicas que não devem ser confundidas com o ensaio aprovado:

- Estender a coordenação de recursos aos previews e aos orçamentos por etapa;
  a fila de builds/coleta/mídia está descrita na frente abaixo.
- Recolher caches de candidatos deixados por queda entre commit do serviço e
  `dispose`, preservando todos os jobs ainda não reconciliados.
- Completar a matriz de recuperação do navegador, inclusive morte do auxiliar
  antes do checkpoint; a queda do coordenador no Mac e o candidato durável estão
  demonstrados na frente do supervisor abaixo.

Prosseguir com orçamento/etapas de produção, demais coletores de qualidade,
geração/edição artística completa de assets, processamento 3D,
quatro adaptadores completos, interfaces, KidOS e
qualificação integral. A versão planejada 1.0 não deve ser publicada ou marcada
como pronta antes desses critérios. Nenhuma instalação foi substituída por estas
mudanças de desenvolvimento.

## Fila comum de recursos de produção

Em 2026-11-10, o serviço passou a coordenar builds, validações e processamento
de mídia dos projetos e produtos do mesmo usuário. As estimativas de memória,
slots de CPU e grupos exclusivos vêm das portas instaladas e ficam fixadas no
job. Clientes não escolhem custo, prioridade ou orçamento. O contrato é aditivo,
com a capacidade `game-production-resource-queue`; detalhes e limites na
[API de produção](GAME_PRODUCTION_API.md#fila-e-recursos-de-produção).

Oito testes adicionais verificam FIFO entre Mac/VS Code, concorrência permitida
e limitada por memória/CPU, exclusividade, tarefas canceladas sem iniciar ou
limpar ferramentas, fila cheia, entradas forjadas, falhas conhecidas e reservas
conservadas para efeitos desconhecidos. Um snapshot SQLite feito com tarefas
persistidas reproduz recuperação de queda: pedidos que não começaram não são
reexecutados; reservas desconhecidas sobrevivem inclusive a orçamento menor.
Inspeção ainda em execução ou falha de inspeção não libera a fila. Dois workers
reais de áudio em projetos diferentes completaram em intervalos sem sobreposição.

O smoke `scripts/smoke-game-scheduling.mjs` usa o Node e o motor empacotados,
registros autenticados Mac/VS Code e estado temporário. Passaram cancelamento de
processamento real de áudio, cancelamento antes da execução, recuperação do mesmo
recibo sem reentrada, espera do pedido seguinte, isolamento entre produtos e
compilação Phaser. Evidência em `output/playwright/game-scheduling/evidence.json`.
O processo de teste encerrou o serviço e removeu seu estado temporário.

Manifesto de desenvolvimento testado, SHA-256:
`c9fd60e3c0c7999439d900645b8d5987d29aeec574d77119174e48f342ff0960`.
Passaram TypeScript, builds Mac/VS Code e do motor independente, **408 testes de
aplicação e 30 verificações do repositório**, sem skips, e roteamento local
Standard/Deep com inferência simulada somente de leitura. Os smokes de mídia
com atlas/Phaser, Godot nativo 2D/3D com edição, queda/reconciliação e superfícies
compartilhadas Mac/VS Code também passaram após a integração. O ensaio de
superfícies emula as bridges; não substitui aceite das instalações nativas.

As estimativas são limites de admissão, não limites de RAM/CPU impostos pelo SO.
O coletor Chromium agora só reconhece a ausência de resultado após confirmar
encerramento no processo original (cache limitado de 256 reconhecimentos).
Uma instância nova não presume parada: sem inspeção durável qualificada,
conserva a reconciliação e a reserva. O teste real distingue reconhecimento
original de uma instância recém-criada; falha de lançamento sem handle ou de
fechamento de recursos também não declara término seguro. Identidade ABI 3.
Essa proteção não conclui a limpeza de processos após morte abrupta do serviço.

Contêineres e workers mantêm seus controles próprios. Esta frente não conclui
orçamentos de tokens/custos/duração por etapa, geração e edição artística,
Blender, Unity, integração protegida KidOS, portfólio, dispositivos físicos,
playtests humanos ou distribuição. Nenhuma instalação ou release foi alterada.

## Supervisor durável do navegador — 2026-11-10

O coletor passou da confirmação em memória (ABI 3) para o supervisor por job
(ABI 4), descrito nas [observações de navegador](GAME_BROWSER_OBSERVATIONS.md#supervisor-e-recuperação-durável).
O pacote do motor inclui `game-browser-worker.cjs`, com hash coberto pelo
manifesto e pela identidade da toolchain. O processo proprietário fixa o worker,
Node, navegador e orçamento; não existe registro por RPC ou fallback permissivo.
O auxiliar não recebe conversa, credenciais do provedor ou runtime de agente.

O journal vincula namespace, job, hashes de fonte/build, toolchain e nonce;
blobs e evidências usam nomes internos por hash. Leituras limitadas rejeitam
links, arquivos públicos e identidades divergentes. O processo só inicia a
coleta após o handshake e a gravação da identificação do auxiliar. A perda do
IPC do coordenador interrompe a coleta, fecha o navegador e o listener e grava
parada confirmada. A ausência do PID principal observado é verificada antes do
checkpoint. Uma instância nova pode publicar um candidato completo, com hashes
conferidos, sem abrir outra sessão de navegador.

O hook de limpeza dos coletores foi ligado ao commit terminal do serviço.
Relatórios e blobs permanecem no armazenamento do serviço; payloads temporários
são removidos somente depois, preservando pequenos recibos para auditoria.
Reservas e candidatos desconhecidos continuam intactos. PID ausente sem recibo
não é prova suficiente; os inspetores não enviam sinais de término a PIDs lidos
do cache. Isso evita transformar falha do auxiliar em autorização para repetir.

O ensaio `scripts/smoke-game-browser-recovery.mjs` passou com o motor empacotado
e Chromium real. Demonstrou:

- Queda forçada apenas do coordenador de teste, com auxiliar/navegador observados
  ativos antes e ausentes depois, listener recusando conexão e recibo de parada.
- Reinício, reconciliação explícita e preservação da revisão de origem, sem
  executar novamente a coleta interrompida.
- Falha deliberada no commit do relatório após candidato completo, nova queda,
  reinício e publicação do candidato exato, com PNG/JSON verificados e apenas
  uma entrada de execução no histórico.
- Limpeza de todos os payloads temporários após confirmação; o runner encerrou
  os processos próprios e retirou o estado de teste antes de informar sucesso.

O runner usa bootstrap direto de teste: remove somente seu socket morto após
confirmar identidade, inode e recusa de conexão. Não demonstra instalação do
LaunchAgent. O primeiro roteiro usou uma espera inválida e foi corretamente
recusado; outro ensaio expôs a necessidade dessa limpeza de bootstrap no harness.
Ambos foram corrigidos no teste, sem afrouxar a validação nem a proteção do
endpoint do produto. A execução final está em
`output/playwright/game-browser-recovery/evidence.json`.

Manifesto final de desenvolvimento, SHA-256:
`eeccbf734ae13d803750a958444459422205ac49eb7dec4e85e3273ea6803e62`.
Passaram TypeScript, build independente do motor, builds Mac/VS Code,
**412 testes de aplicação e 30 verificações do repositório**, sem skips neste
Mac, e roteamento Standard/Deep com inferência local simulada somente de leitura.
Os novos testes também rejeitam corrupção de evidências/metadados, links,
permissões abertas, outro namespace/toolchain e desaparecimento de auxiliar sem
confirmação. Uma variável-canário sintética demonstrou que o ambiente do host
não é herdado pelo auxiliar; a recuperação não aumentou seu contador de execução.

Passaram ainda os smokes empacotados de Phaser/Babylon com observação, mídia com
atlas/AudioWorklets, Godot nativo 2D/3D com edição e recuperação, e superfícies
compartilhadas Mac/VS Code com captura, preview e exportação. Essas superfícies
usam bridges emuladas nesse ensaio; o aceite das instalações nativas permanece
separado. As fixtures continuam sem aceite integral de jogos.

Pendências preservadas: morte simultânea do auxiliar antes do checkpoint de
parada, demais plataformas, recuperação do preview interativo, coleta automática
de caches entre commit e limpeza, produção/QA completos, Unity, Blender,
integração protegida KidOS, portfólio e playtests físicos/humanos. Não houve nova
release, instalação ou alteração de provedor.

## Etapas persistentes e alocação de pedidos — 2026-11-10

A [produção persistente](GAME_PRODUCTION_WORKFLOWS.md) acrescenta ciclos de oito
etapas ao armazenamento do Agent Service. Avanços dependem de evidências
cumulativas da fonte atual; jobs pendentes ou com resultado desconhecido impedem
o avanço. A entrega completa do agente agora exige o ciclo concluído, aceite da
revisão/hash atuais e qualidade vigente, em vez de apenas um relatório anterior
positivo. Mudanças delimitadas de projeto continuam tendo conclusão própria.

Builds, validação e mídia compartilham uma alocação de pedidos por projeto/etapa,
debitada na transação de admissão. Replay não duplica consumo, falha/cancelamento
não o reembolsam e rollback transacional não deixa débito órfão. Continuar exige
confirmação do host e concede um único bloco instalado; essa operação e a
reabertura não são ferramentas do modelo. Limites menores após reinício são
respeitados. A última revisão/build aceitos permanecem fixados ao reabrir.

SDKs TS/Python e Game Studio oferecem leitura, avanço, continuação e eventos.
A exportação conserva snapshot e histórico até um cursor fixado em
`production.json`, sem importar autoridade ou qualidade. Migração de ciclos
ativos continua pendente. Não houve nova concessão de capacidades ao KidOS.

Passaram TypeScript, builds do motor/Mac/VS Code,
**422 testes de aplicação e 30 verificações do repositório**, sem skips neste
Mac, e roteamento local Standard/Deep somente de leitura com inferência simulada.
Os dez testes de workflow cobrem também política reduzida, fonte antiga,
resultado desconhecido, confirmação recusada, concorrência, exportação,
isolamento e IPC/SDKs reais. Standard e Deep atravessaram as oito etapas pelo
grafo oficial e gravaram recibos de metadados; os relatórios de qualidade desse
cenário são sintéticos, sem certificação de jogos ou playtests reais.

Com o motor empacotado, passaram novamente Phaser/Babylon com observação,
quatro candidatos de mídia com aplicação/reinício, Godot 2D/3D com edição,
cancelamento/queda/reconciliação e recuperação durável do navegador sem repetir
a coleta. O ensaio compartilhado de Studio realizou 64 builds reais na etapa
Core, exibiu o esgotamento e só continuou após confirmação; não certificou
controles a partir de boot/pixels. Layouts claro/escuro e estreito foram
inspecionados sem transbordamento horizontal.

As superfícies nativas também passaram: Electron **45.2.1** e VS Code
**1.145.2**, com processos/perfis de desenvolvimento temporários. Verificaram
avanço Design/Core, bloqueio, edição/restauração conforme o cliente, exportação
do ciclo e preservação ao fechar a UI. Mac usa diálogos simulados só no harness;
VS Code usa webview/classes de produção e diálogos customizados reais. O runner
do editor confirmou a retirada de seus processos antes de informar sucesso.
Evidências e capturas estão em `output/playwright/game-studio/ui-evidence.json`,
`native-mac/evidence.json`, `native-vscode/evidence.json` e respectivos
`workflow.png`; os dois últimos caminhos são relativos a `game-studio/`.

Manifesto de desenvolvimento SHA-256:
`45ae8f959d095b420502a12dfc4e6fc28d407128d8adef0c19453c8c9bdd1622`.
`service.cjs` SHA-256:
`fc61b3b5f907d262c2a394635b6a8e43648df4232cd31846f6c9259b90fb3186`.
Motor **1.0.2**, protocolo **1.0**, Node **22.23.4**, alvo **darwin-arm64**,
marcado como desenvolvimento. Não houve publicação, substituição de instalação
ou alteração do provedor.

A alocação de pedidos não é orçamento de tokens, dinheiro ou duração. Consumo
agregado entre sessões/projetos e inferência continua pendente; criar outro
projeto não é atualmente impedido por um limite agregado de pedidos. Permanecem
obrigatórios a cadeia artística completa, coletores semânticos/físicos/humanos,
Unity funcional, demais plataformas, integração protegida KidOS, seis jogos e
pedidos inéditos, migração dos ciclos e distribuição com rollback. O escopo do
plano integral permanece inalterado.

## Admissão compartilhada de inferência — 2026-11-10

A [política de inferência](INFERENCE_BUDGETS.md) passou a integrar Standard/Deep
do executor comum e do runtime Mac. O serviço agrega invocações e tokens
informados/reservados entre sessões/projetos do namespace e na etapa ativa.
Planejamento, interpretação, execução, especialistas, compactação e revisores
recebem o mesmo callback LangChain. Não foi criado outro loop ou cliente de
inferência. Produtos/perfis/workspaces continuam isolados.

A admissão é transacional e antecede o provedor. Faltando capacidade, o run
aguarda confirmação durável; negar não inicia a chamada seguinte. Callbacks
duplicados e modelos paralelos compartilham as esperas correspondentes, sem
concessões duplicadas ou promessas perdidas. Responder a uma solicitação mantém
a espera explícita se houver outras pendentes. Reinício preserva consumo e
recupera a confirmação; uma chamada pendente passa a consumo não informado,
conservando a reserva. Não guardar prompt/resposta/credencial no registro de uso.

SDKs TS/Python consultam `inference.budgets.get`; a UI compartilhada apresenta
uso da IA separado dos pedidos de build/teste/mídia. Não há concessão pública,
parâmetro de quota vindo do cliente ou ferramenta de orçamento do modelo. Os
10 testes dessa frente incluem tokens acima da reserva, corrida antes do
provedor, hooks duplicados, filhos paralelos, compactação oficial, política
reduzida, isolamento, recusa e reconexão/reinício. O teste Mac usa os modelos
LangChain e respostas JSON/SSE simuladas, verificando tokens de interpretação,
planejamento, executor e revisão; a ausência de evidência continua impedindo
declarar a tarefa concluída.

Passaram TypeScript, builds de motor/Mac/VS Code,
**432 testes de aplicação e 30 verificações do repositório**, sem skips neste Mac,
e o smoke de roteamento somente de leitura com inferência simulada. O smoke
empacotado de Game Studio realizou uma chamada de leitura LangChain por produto,
via servidor HTTP/SSE simulado efêmero em loopback: cada namespace registrou
**1 chamada, 7 tokens de entrada e 3 de saída**, sem compartilhar o débito.
O snapshot de inferência está em `output/playwright/game-studio/ui-evidence.json`.
Continuaram passando restauração, mídia, builds, observação, preview, exportação,
continuação de pedidos e recuperação da bridge nesse ensaio.

Electron **45.2.1** e VS Code **1.145.2** reais passaram novamente com perfis
temporários: etapas, leitura das alocações, edição/exportação, preservação do
estado e limpeza do runner do editor. Capturas `workflow.png` e relatórios estão
em `output/playwright/game-studio/native-mac/` e `native-vscode/`. Esses percursos
não substituem o aceite das instalações nem uma conversa com modelo real.

Manifesto de desenvolvimento SHA-256:
`c75b46cef5d9cc887391af411426c687d20b8981f1ffc035f613430a70428a35`.
`service.cjs` SHA-256:
`30345d85cf0be69738bd4466e69223803dd817e20cbc79dde68790fa27c8daa4`.
Motor **1.0.2**, protocolo **1.0**, Node **22.23.4**, alvo **darwin-arm64**,
marcado como desenvolvimento. Não houve publicação, instalação ou mudança de
provedores configurados. As autoridades e a instalação KidOS não foram alteradas.

Este controle não garante a fatura nem limita rigidamente os tokens de uma
chamada já iniciada. Excesso informado é contabilizado e impede a próxima;
ausência de metadados não é uso zero. Retentativas HTTP internas, duração,
valores monetários, assistência manual/embeddings/geradores externos e configuração
administrativa de alocações na UI continuam pendentes. Não há total de inferência
entre namespaces diferentes nem agregação de pedidos de build entre projetos.
Permanecem também Unity funcional, cadeia artística/Blender, integração protegida
KidOS, coletores completos, seis jogos/pedidos inéditos, dispositivos/playtests,
migração e distribuição/rollback do produto integral.

## Modelos, rig e animação com Blender isolado

Em **2026-11-10** foi acrescentada a porta opcional
`blender-model-isolated-v1`, com [contrato próprio](GAME_BLENDER_ADAPTER.md).
Receitas `model.scene` são dados tipados: primitivas/malhas/GLB registrado,
materiais PBR e PNG, hierarquia, ossos rígidos e clips por objeto/osso. Não
aceitam Python do projeto, expressões, plugins ou importação de `.blend`.
O driver fixo produz GLB, fonte editável `.blend`, PNG de inspeção e relatório.
Processamento, revisão e aplicação continuam separados, com origem/licença,
fingerprints e placeholder das fontes preservados.

Foi provisionado **Blender 4.5.15 LTS Linux x64**, em isolamento local sem rede,
raiz/fontes somente leitura, sem privilégios, com memória/swap/PIDs/CPU/tmpfs
limitados. No Mac ARM64 o editor x64 foi executado sob emulação; isso não é
aceite nativo ARM ou prova das demais plataformas. O provisionador só usa
arquivos verificados e base local por digest, sem pull/download em runtime.
O motor empacota driver/lock, não o editor. As primitivas de contêiner/TAR foram
separadas em `packages/adapter-game-container`, preservando os reexports Godot;
essa camada mantém recibos por operação, sem nova fila ou loop de inteligência.

O ensaio `npm run smoke:game-blender` demonstrou pelo serviço empacotado e
TLS/IPC temporário:

- Modelo original de integração com **2832 triângulos, 13 meshes, um skin e
  um clip**, verificados pelo parser GLB independente, além da fonte e PNG.
- Reinício antes da aplicação, repetição idempotente e revisão preservada até
  aplicação explícita. Reimportação do GLB para edição de transformação,
  preservando rig/animação, bytes originais e proveniência; placeholder não
  pode ser apagado por um derivado.
- Falha controlada na transação após salvar candidato e recibo; reinício e
  recuperação dos mesmos bytes. O histórico Docker registrou **uma única
  criação de contêiner** para esse job, sem outro processamento na reconciliação.
- Cancelamento após observar o editor vivo, confirmado só após remoção;
  SIGKILL do serviço de teste, espera explícita e reconciliação do contêiner
  original sem repetir a operação ou modificar a revisão do projeto.
- Build Babylon com GLB editado e loader **glTF2 9.35.0** oficial empacotado,
  fixado por hash e licença, sem CDN. O Chromium observou deslocamento por
  teclado e mudanças de imagem durante animação; três relatórios passaram.
  Fontes `.blend` ficaram fora do build runtime, preservadas no projeto.

Capturas do render CPU e do navegador foram inspecionadas. Evidências e
manifestos: `output/playwright/game-blender/integration-evidence.json`,
`generated/`, `edited/`, `build/` e `observations/`. `quality.ready` permaneceu
**false**: são fixtures de infraestrutura, sem portfólio ou aceite artístico.
Uma interrupção recuperada mantém seu erro no histórico de eventos; o estado
atual concluído passou a limpar o erro e a espera anteriores.

Passaram **438 testes de aplicação e 30 verificações do repositório**, sem skips,
TypeScript, build do motor independente, extensão e desktop. O smoke LangChain/
DeepAgent com inferência simulada somente de leitura passou. A regressão Godot
também passou com builds 2D/3D, edição/reinício, observação Chromium,
cancelamento e queda/reconciliação após a separação das primitivas de contêiner.
Passou ainda a regressão de imagem/áudio: quatro candidatos processados e
aplicados, reinício do serviço, PCM inspecionado independentemente e atlas
Phaser observado no navegador. Evidências em `output/playwright/game-assets/`.

Manifesto de desenvolvimento SHA-256:
`7e62a9b97f79eb07e09bd0e5ab6c0d06dfc442cee4b79eb7c707b120bb0b5b98`.
`service.cjs` SHA-256:
`d36112fe14da470ab124e9226e803d75d4eb74570c63f48f4bcf0c9e4f3c8e81`.
Imagem Blender:
`sha256:d7956f3d5cd63baa25a3024c1978788fddc806ad689a175e254dcc3835565402`.
Motor **1.0.2**, protocolo **1.0**, Node **22.23.4**, alvo **darwin-arm64**,
composição de desenvolvimento. Não houve release, substituição de instalações,
alteração de provedores pessoais ou afrouxamento do Core KidOS.

Continuam pendentes geração por provedores autorizados e bibliotecas/licenças
verificadas, rigging deformável e edição ampliados, consistência artística e
conteúdo final, Unity funcional, integração protegida Navi/KidOS, os quatro
adaptadores completos, coletores/matriz física, seis jogos e pedidos inéditos,
playtests humanos e distribuição/migração/rollback do produto integral.


## Primeira referência jogável: Lume

Em **2026-11-10**, foi criada a referência de plataforma
[Lume — Jardim Suspenso](../examples/games/lume/README.md), separada do motor,
dos adaptadores e do pacote de especialização. O
[contrato dos jogos de referência](GAME_REFERENCE_GAMES.md) distingue essa fonte
escrita pelo mantenedor/agente de desenvolvimento das produções autônomas que
continuam precisando de comprovação.

O jogo tem doze jardins em três capítulos, 36 sementes, checkpoints, salto com
altura variável, vento, plataformas móveis e conclusão. Inclui direção vetorial
original, partitura/síntese locais, mapa e repetição, melhores resultados, pausa,
reinício e mute. Teclado e botões de toque usam a mesma simulação; perder foco
pausa e libera entradas. Save preserva fase, lanterna, sementes, tempo e
recomeços; formato incompatível fica preservado e falta de armazenamento mantém
a partida jogável. Não depende de modelo ou rede externa.

Quatro testes novos verificam percurso nas doze fases por entradas normais,
altura variável, checkpoint/save e transições de teclas mantidas no coletor.
O percurso usa a física real da simulação, sem teletransporte ou alterações
diretas de estado; não prova todos os caminhos nem substitui o navegador.

O coletor passou a aceitar `key-down`/`key-up`, com transições balanceadas e
liberação ao fechar o caso, inclusive em falha. A receita continua sem código
arbitrário, restrita à página do build. Sua identidade inclui o novo worker,
sem modificar o protocolo de recuperação ABI 4 ou abrir controle do host.

`npm run qualify:game-lume` importou a fonte pelo SDK e motor empacotados,
construiu Phaser, reiniciou o serviço e exportou fonte/histórico. No Chromium
isolado, cinco relatórios passaram: boot/console e quatro cenários de movimento
contínuo/pausa, semente/reload, toque/retrato/redimensionamento e conclusão da
primeira fase com abertura da segunda. Fonte e build permanecem ligados às
evidências. `quality.ready` continuou **false**.

A inspeção das capturas levou a correções: câmera/campo visível no retrato,
área do HUD, ocultação de controles durante menus e conclusão, e mensagens
acessíveis atualizadas apenas quando mudam. A página declara `pt-BR`.
Foram preservadas as observações falhas iniciais; cada tentativa seguinte tem
pasta própria. São provas de desenvolvimento, sem aceite físico/humano.

A edição final verificada está em:
`output/playwright/lume/runs/2026-11-10T15-27-46-698Z-80abfcde/`.
Inclui build autocontido, fonte/histórico exportados, design, assets declarados,
relatórios e capturas. `output/playwright/lume/latest.json` aponta para essa
edição; não é uma versão instalada ou release.

Fonte SHA-256: `fc68696f319ac876a0ee8c6b29d2651306af46c04cfa20978b099c23d44c9292`.
Artefato SHA-256: `65d6f36f53b52ecd5ea1d6ff66fe9702cbf8b3bfdcdd965921a0e0f261d3710a`.
Manifesto de desenvolvimento SHA-256:
`618fefb68dcbc035063bd3a96bb94aa9b951d9169b4f6f7f48a7e362934fb6b9`.
`service.cjs` SHA-256:
`5cb4aef314ff7334cefff4b7f9f2098baa0c102b23af5550c50c0c5eeea556b3`.

Passaram **442 testes de aplicação e 30 verificações do repositório**, sem skips,
TypeScript e builds do motor, Mac e VS Code. O smoke de roteamento LangChain/
DeepAgent somente de leitura com inferência simulada passou, assim como a
regressão de queda do coletor: parada real do navegador/listener, recuperação
do candidato exato sem outra coleta e limpeza após commit. Motor **1.0.2**,
protocolo **1.0**, Node **22.23.4**, alvo **darwin-arm64**, desenvolvimento.

Lume ainda exige revisão de arte/áudio, todos os percursos reais, dispositivos,
desempenho físico e playtests consentidos. Não há dez participantes ou metas de
diversão registradas; não foi declarado jogo aprovado. A referência tampouco
comprova que o Companion gere um jogo equivalente de um pedido novo. Permanecem
as cinco outras referências, geração/generalização, Unity funcional, quatro
adaptadores completos, cadeia artística ampliada, Core/Navi, coletores completos,
matriz física/humana, migração e distribuição/rollback. O Mac permaneceu bloqueado
na tentativa de consultar o Hub; a licença Unity não foi classificada como ausente.
Não houve nova instalação, release ou alteração de provedor pessoal.

## Recebimento de builds pelo Core KidOS

Em **2026-11-10**, o repositório KidOS ganhou `game_bundles.py`, produtor em
partes e capacidades `game_bundles.*`, com referência local em
`docs/GAME_BUNDLES.md`. É a camada de armazenamento/publicação do novo formato;
o perfil Navi continua no caminho legado e os adaptadores workspace Companion
continuam recusando KidOS. Não foram habilitados jogador, shell, Docker,
filesystem genérico ou nova escolha de modelos.

O Core aplica o escopo da sessão/UID, valida manifesto e hash canônico
`GameArtifact`, recebe blocos de 256 KiB e confere cada arquivo. Publicação e
restauração usam revisão esperada e transação; recibos impedem duplicação e
reutilização de identidade. Cancelar upload não apaga publicação ou libera a
identidade para outro pedido. As versões posteriores são preservadas no rollback.
O caminho é separado de `web_games`/Studio antigo, sem afrouxar seu formato.

Limites em fonte: manifesto 16 MiB, vinte mil arquivos, artefato 256 MiB,
armazenamento reservado 2 GiB por conta, oito uploads pendentes e dez mil
recibos. Paginação respeita o transporte Core de 1 MiB; não são limites de
tempo parental ou inferência. Hashes são integridade, não autoridade ou qualidade.
Lock de contrato explicitamente de desenvolvimento preserva o engine lock
instalado e referencia hashes das definições Companion.

A suíte KidOS retornou **525 testes aprovados, dois ignorados** por ausência da
dependência opcional do executor Python legado. Os 22 testes novos de bundles
cobrem arquivo de 9 MiB, manifesto de 6001 arquivos, resposta perdida,
concorrência, falha transacional, corrupção, quotas, links, isolamento de homes,
escopos e auditoria. O snapshot legado permaneceu válido em `--check`.

Um ensaio real pelo IPC Core recebeu duas edições exportadas do Lume, conferiu
todos os arquivos, reiniciou, restaurou a primeira e conservou a segunda.
Repetir o pedido concluído não recopiou arquivos nem reativou a versão restaurada.
Os hashes das fontes Companion também foram conferidos contra o lock.
Relatório no KidOS: `build/game-bundles/compatibility.json`, com hashes dos
módulos/registro e dos artefatos
`d1c8c18f40632593f23ed8027c791cd81dd94ffc038b399ebb5cf66ac6c71506` e
`65d6f36f53b52ecd5ea1d6ff66fe9702cbf8b3bfdcdd965921a0e0f261d3710a`.

Este ensaio usa sockets e homes temporários no Mac, sem inferência, instalação
ou GTK. Não comprova UIDs Linux distintos, controles de tempo durante jogo,
carregamento/desempenho de arquivos grandes, migração instalada ou rollback de
release. Permanecem broker/portas protegidas, etapas/orçamento, contexto/UI Navi,
jogador WebKit com recursos e política impostos pelo host, quatro engines e
distribuição, além dos aceites artísticos, físicos e humanos do plano integral.

## Continuação: jogador de bundles KidOS e ensaio WebKit

Em 2026-11-10 foi acrescentado no KidOS um jogador GTK/WebKit separado, por
`--bundle`, sem ampliar o player legado ou ativar o perfil Navi v2. As fontes
`game_bundle_resources.py` e `game_bundle_player.py` fixam publicação/manifesto,
verificam recursos em partes antes da exposição e aplicam política do host por
esquema próprio, CSP, MIME/`nosniff`, filtro e navegação. Não há bridge JavaScript
administrativa ou acesso a arquivos do host. A API `game_bundles.player.prepare`
exige lançamento autorizado e tempo parental; o processo verifica novamente a
decisão e para se o Core falhar. As identidades do jogador são normalizadas nas
cotas existentes. Freeze dos descendentes WebKit sob autoridade instalada ainda
precisa de aceite físico; o polling não substitui esse mecanismo.

A suíte KidOS completa passou com **554 aprovados e dois ignorados** pela
dependência Python legada; snapshot protegido e compatibilidade Core/IPC com as
duas edições reais Lume passaram novamente. Os 29 testes novos incluem paths,
integridade antes de entregar bytes, publicação fixada, estado privado, escopo,
auditoria e aliases de cota. O transporte não carrega toda a implementação Core
no cliente; o despacho do servidor continua usando a identidade local validada.

No Alien x64/UID 1000, WebKit **2.52.6**, foram executados três processos GTK
em backend Broadway privado, sem janelas na sessão de Isaac e sem instalação.
O teste usa **fixture e cliente temporários**, não a autoridade instalada:
recurso local/JS permitido, bridge ausente, fetch HTTP e arquivo/popup recusados,
servidor-canário com zero acessos, save **1 → 2** entre processos do mesmo jogo
e **1** para outro jogo. A retirada simulada da permissão foi observada antes do
shutdown. Os PIDs e hashes da fonte/teste estão no relatório KidOS
`build/game-bundles/native-player/2026-11-10-webkit-2.52.6-verified.json`.

Os ensaios identificaram e corrigiram sintaxe de filtro não suportada e perda
do MIME ao substituir headers, conservando `nosniff`. Vários contextos no mesmo
processo não conservaram o valor; essa observação não foi promovida a aceite.
O percurso validado usa processos separados, como a CLI. Concorrência do mesmo
jogo, IndexedDB, migração/rollback de saves, Lume completo no WebKit, GPU, áudio,
controles físicos, X11/Wayland e UIDs/cotas reais continuam pendentes.

Continuam também broker e portas do adaptador assinado, etapas/orçamento
protegidos, UI/contexto Navi e distribuição. Os testes de fixture não demonstram
geração pelo produto, produção em quatro engines ou qualidade dos seis jogos.
Nenhum release, serviço instalado, pareamento ou dado infantil foi substituído.
O plano integral e seus aceites permanecem ativos.

## Continuação: lançamento durável e Lume pelo Core no Alien

Em 2026-11-10 o Core KidOS ganhou `game_bundles.play`, `play.get` e
`play.reconcile`, com escopo de lançamento e validação parental para nova
abertura. O pedido fixa a publicação, reserva recibo antes do efeito e usa
bloqueio por jogo entre threads/processos. Repetir ou recuperar após reinício
retorna o mesmo recibo; reutilizar ID com outro conteúdo é rejeitado. Timeout e
efeito desconhecido permanecem reservados até inspeção da unidade original.
Nem o modelo nem a UI fornecem resultado, PID, unidade ou comando genérico.

O novo percurso exige systemd do usuário e jogador próprio, com limites de
1536 MiB/256 tarefas/200% CPU, `NoNewPrivileges` e término do grupo. A conferência
de fechamento exige unidade inativa, PIDs principal/controle zerados e grupo
removido. Inspeção não relança nem mata PIDs. O sinal de página carregada é
retirado em falha/fechamento; sem ele o estado volta a pedir reconciliação.
`play.get` é histórico, não presença ao vivo ou aprovação de gameplay.

O ensaio `integrations/agent-engine/test_game_bundle_lume.py`, no repositório
KidOS, usou **Core candidato e socket Unix reais** no Alien x64/UID 1000,
catálogos/home temporários e WebKit 2.52.6 em Broadway/Cairo privado. Uma seleção
pequena das fontes foi combinada com dependências instaladas identificadas por
hash; isso não é release nem aceite do perfil infantil. Sem inferência ou
instalação, o artefato Lume
`65d6f36f53b52ecd5ea1d6ff66fe9702cbf8b3bfdcdd965921a0e0f261d3710a`
foi transferido pelo Core, aberto e renderizado em sua janela gerenciada.

Botões DOM normais conduziram abertura, primeiro jardim e pausa, com seis PNGs
WebKit conferidos. O Core foi encerrado/reaberto mantendo janela, unidade e PID
reais; repetir o pedido não criou outra janela. Depois do fechamento observado,
novo pedido mostrou “Continuar”, recuperou o mesmo save e continuou seu relógio.
O observador não alterou save, posição ou estado interno do jogo. As propriedades
efetivas dos limites foram conferidas no gerenciador; as unidades terminaram com
grupo removido. A inspeção visual aguardou as animações estabilizarem.

Relatório final, fontes, imagens e observação bruta de fechamento ficam no KidOS
em `build/game-bundles/native-lume/attempt-6/`; SHA-256 do relatório
`c8f625fcd48e6cf1eb4e4466d3aca2225bcb696457807682cbfb6b791e8fd549`.
Casos falhos de socket gráfico, sessão D-Bus sem desktop e leitura provisória de
localStorage pelo observador foram conservados em diretórios distintos. O teste
foi corrigido sem retirar CSP/filtro/sandbox. A regressão final de HTTP/arquivo,
ausência de bridge, save por jogo e retirada simulada da permissão também passou.

A suíte KidOS completa retornou **570 aprovados e dois ignorados** da dependência
Python legada, incluindo 16 casos novos de recibos/inspeção/arquivos/concorrência
e autoridade. Snapshot e compatibilidade/rollback dos dois builds Lume passaram.
Fontes, contrato e PNGs do ensaio foram novamente comparados aos hashes locais.

Permanecem campanha completa no WebKit, teclado/toque/áudio e GPU físicos,
autoridade/cotas de Isaac, UIDs distintos, saves incompatíveis/rollback,
broker/portas do adaptador, etapas/orçamento protegidos, UI Navi e distribuição.
Não foi ativado o perfil Navi v2, modificado dado infantil ou publicada release.
As exigências dos quatro adaptadores, seis jogos, pedidos inéditos e avaliação
humana continuam integrais; essa evidência não certifica qualidade comparável
à Poki ou geração de jogos pelo produto.

## Ponte de bundles e conferência pelo adaptador instalado

Em 2026-11-10 o serviço passou a fornecer identidade imutável de operação ao
adaptador instalado, depois de persistir a intenção. O hook protegido inspeciona
a operação original, sem executar novamente ou aceitar um resultado da interface.
`tools.inspect` é uma rota sem resultado enviado pelo cliente; os SDKs TS/Python
expõem a operação. Resultados desconhecidos, inválidos e sem suporte mantêm a
reserva. Consultas concorrentes compartilham a inspeção e o desligamento a
cancela, inclusive antes de o hook iniciar. A compatibilidade manual das
ferramentas antigas permanece separada; não é fallback da UI infantil.

O KidOS acrescentou um catálogo opcional de cinco ferramentas de publicações,
ponte Python fixa para Core e continuação explícita no Navi GTK/terminal após
conferência conhecida. O catálogo não permite ao modelo escolher a identidade
de abertura, UID, caminho ou resultado. O Core mantém as validações existentes
de escopo/tempo. Recibos resumidos não expõem unidade, token ou PID. A composição
legada e o lock de engine 1.0.2 não foram ativados ou alterados por essa opção.

Passaram TypeScript, **444 testes de aplicação e 30 verificações do repositório**,
builds de extensão, motor independente e Mac, além do smoke local de inferência
simulada somente de leitura. Após acrescentar o caso de cancelamento antes do
início da inspeção, os seis testes direcionados passaram novamente, sem mudança
posterior de código de produção. No KidOS, **591 aprovados e dois ignorados**
por dependências opcionais do legado; snapshot Game Design preservado.

O teste CJS usou Node/kit cujos hashes foram conferidos no manifesto local de
desenvolvimento: quatro percursos Standard/Deep com/sem modo Plano passaram,
além dos cinco cenários prévios de orçamento, delegação e arquivos legados.
O diário real do Core foi exercitado com lançador controlado; inferência e
ponte do teste CJS são simuladas. Esses ensaios não demonstram a composição
inteira instalada na conta infantil. As primeiras execuções completas restritas
falharam ao abrir sockets locais; as novas execuções autorizadas passaram,
preservando os logs das tentativas anteriores.

Fontes e procedimento KidOS: `docs/GAME_BUNDLE_NAVI.md` no seu repositório.
Permanecem broker e portas de produção protegidos, perfil v2, etapas/orçamento,
ensaios da composição em sessão infantil, matriz física, quatro engines completas,
seis jogos, pedidos inéditos, avaliação humana e distribuição/rollback finais.
Esta frente não publicou release, não modificou instalações e não concluiu o plano.

## Compilador web isolável: fonte e ensaio Linux

Em 2026-11-10 o pacote do motor ganhou `game-web-worker.cjs`, com contrato
privado de entrada/resultado, blobs por hash, verificação de todos os arquivos,
reserva antes de compilar e candidato imutável. Usa o compilador comum offline,
sem executar código/plugins do projeto. O componente KidOS verifica instalação
exata protegida e constrói somente o comando fixo systemd/bwrap, sem expor shell,
filesystem ou Docker ao Navi. Consulte [compilador isolado](GAME_WEB_COMPILER.md).

Passaram TypeScript, **454 testes de aplicação e 30 verificações do repositório**,
builds do motor, Mac e extensão e o smoke de inferência local simulada somente
de leitura. O KidOS retornou **611 aprovados e dois ignorados** por dependências
opcionais do legado; snapshot preservado. Os casos novos cobrem adulteração,
links, import do host, troca de pedido/fonte/toolchain, cancelamento, conflitos
de arquivos e preservação do candidato anterior.

O ensaio no Alien Linux x64/UID 1000 usou pacote mínimo de 43 arquivos, hashes
conferidos, esbuild 0.25.12 com SRI do lock e Node 22.23.4 de instalação imutável
cujo binário foi conferido antes de copiar. Compilou a fonte Lume/Phaser e a
fixture Babylon em namespaces privados, recusou import de `node:fs`, bloqueou
home/arquivo-canário/rede do host e herdou ambiente limpo. Runtime e input
permaneceram somente leitura. Não houve modelo, execução gráfica, publicação
ou alteração de instalações, dados infantis ou serviços permanentes.

O probe confiável separado confirmou no kernel `memory.max=1610612736`,
`pids.max=128` e `cpu.max=200000 100000`. A unidade confirmou `NoNewPrivileges=yes`,
`KillMode=control-group` e duração máxima de cinco minutos. A tarefa em espera
foi encerrada pela unidade exata; as cinco unidades do ensaio final ficaram
inativas, com PIDs zero e grupo vazio. O canário de rede recebeu zero conexões.
O probe pertence ao ensaio, não a uma ferramenta disponibilizada ao Navi.

Relatório final SHA-256:
`89c85dd3c782f27ef153f0004151f276bdbf220a6a1d34abc293dd7df440bf6c`.
Arquivo local: `build/game-web-compiler/native-2rhh_9c9/evidence/report.json` no
KidOS. Os resultados/candidatos foram conferidos novamente no Mac; seus bytes
estão em `native-hmn13a97/evidence`, com resultados idênticos por hash aos do
ensaio final. A primeira tentativa falhou antes do lançamento porque o ensaio
criara arquivos com umask aberto; foi preservada, e a correção tornou os arquivos
privados sem afrouxar a verificação do pacote.

Isso qualifica este componente no ambiente descrito, não o broker completo:
faltam admissão/cotas protegidas, upload/diário durável, cancelamento/reconciliação
Core, porta `kidos-core`, produção Navi v2, demais hosts e integração instalada.
Também permanecem quatro adaptadores completos, portfólio de seis jogos,
pedidos inéditos, qualidade artística, dispositivos/testes humanos e distribuição
com migração/rollback. O escopo integral não foi reduzido.

## Broker Core: admissão, diário e recuperação real

Em 2026-11-10 o KidOS ganhou treze operações Core `game_builds.*` com escopo
próprio existente e auditoria: capacidades, begin/get/progress, transferência
em partes, selagem, início, conferência/cancelamento e resultado/download paginados.
O diário persiste intenção antes de admitir/executar. Repetição de ID/conteúdo
recupera o pedido; outros argumentos, paths, UID, comando ou resultado de UI
são recusados. Há exclusividade por conta e reserva lógica de armazenamento.

A autoridade mantém admissões únicas por UID e pedido, vinculadas ao corpo e ID
opaco do Core, com limites diários em armazenamento de sistema. Consulta os
controles parentais ao admitir, sem aceitar aprovação declarada pelo agente.
Reiniciar/copiar estado local ou mudar de projeto não renova uma admissão.
Os limites de produção atuais são separados de tokens, custos e uso ativo de tela;
superfície administrativa e ligação ao orçamento por etapa permanecem pendentes.

O envio ao systemd aguarda somente confirmação de exec. Pedido de unidade sem
confirmação continua reservado: ausência de unidade/PID sozinha não é prova de
falha. A conferência exige fechamento do cgroup e candidato vinculado/verificado;
bytes são persistidos antes de concluir. Cancelamento que coincide com sucesso
preserva o candidato e seu histórico, sem publicação automática. A checagem de
atualização aguarda pedidos pendentes e o marcador de ativação bloqueia novos
inícios. O domínio não cria outro agente ou motor.

A suíte completa KidOS passou com **629 aprovados e dois ignorados** do executor
legado; snapshot preservado. Casos novos cobrem fonte de 9 MiB, retomada, perda de
resposta, recebimento concorrente de cancelamento, orçamento/UID, auditoria,
comandos forjados, cópia de estado e ativação segura. O compilador e o motor
Companion não mudaram nesta frente; as evidências anteriores continuam com seus
respectivos escopos, sem inferir nova instalação.

No Alien, o pacote temporário mínimo de 16 arquivos teve hashes conferidos contra
a fonte. Core e autoridade de teste comunicaram-se por Unix IPC com UID real.
Depois de iniciar Phaser/Lume e Babylon, o ensaio matou o processo Core com
SIGKILL antes de confirmar saída, reabriu o mesmo diário e recuperou os dois
candidatos sem outra compilação. Todas as páginas/blocos de saída foram baixados
e verificados por SHA-256. Houve duas admissões e duas unidades encerradas,
com PIDs zero e cgroups vazios. Manifestos confirmados e fonte foram conferidos
novamente no Mac.

Relatório SHA-256:
`0a97ce1fa75f21fc2351c1082662679f6d8b0ff57221434c35e673e0e8d8f4e0`.
Arquivo KidOS: `build/game-build-broker/native-j0yb7781/evidence/report.json`;
`committed-results.json` e `verification.json` vinculam pedidos, fontes e candidatos.
A autoridade temporária desse ensaio roda sob UID 1000, não como o serviço root
instalado: comprova lógica/IPC, não proteção física do banco, outro UID ou aceite
na conta infantil. Nenhum dado de conta, serviço permanente ou instalação mudou.

Referência operacional: `docs/GAME_PRODUCTION_BROKER.md` no KidOS. Permanecem porta
`kidos-core` assinada no motor, integração do perfil Navi v2, configurações e
orçamentos por etapa, tratamento administrativo de efeitos ambíguos, mídia/coleta,
qualificação dos quatro adaptadores, seis jogos, pedidos inéditos, dispositivos,
testes humanos, composição assinada, instalação e rollback finais.

## Porta protegida: SDK, serviço e Core pelo caminho real

Esta frente posterior entrega a ligação em fonte da porta `kidos-core` ao
adaptador instalado/assinado do motor. O ABI 1 fornece schemas e construtores
do mesmo processo; o carregador exige autoridade Core/produto exclusivo KidOS.
As portas são selecionadas por produto e engine, permitindo workspace Mac/VS Code
e Core coexistirem sem fallback entre produtos. O builder KidOS opt-in exige
composição Linux exata e preserva o catálogo/perfil legado por padrão.

O Core acrescenta consulta por pedido sem efeito e vínculo de entrada nos
recibos. A porta envia/verifica partes, confirma candidatos e reconcilia o pedido
original sem chamar `start`. Cancelamento sem encerramento confirmado permanece
reservado. Não há filesystem, shell, Docker ou provedor alternativo na porta,
nem liberação dos bloqueios de perfil v2, etapas e inferência infantil.

O ensaio Linux x64/UID 1000 usou SDK TypeScript, TLS/Unix IPC, Agent Service e
SQLite reais, carregador com assinatura efêmera, ponte Python, Core e autoridade
temporários. O registro público provisionado foi conferido pela política do
sistema, com token privado novo, sem reutilizar credenciais instaladas.
Após o início de Phaser/Lume e Babylon, o serviço recebeu SIGKILL; a reconexão
recuperou os dois candidatos pelo mesmo job, conferindo dezenove arquivos por
SHA-256. Houve um `start` por pedido, duas admissões e duas unidades com PIDs
zero e cgroups vazios. A qualidade permaneceu não aprovada.

Relatório Core SHA-256:
`f982ac27b47738c5bc762445c70548af0719f750a74dd1443693f8ae3fd5076a`.
Relatório SDK/serviço:
`6c546fa4cbf4ce468644f2402b9fcf9b1f42f8d6740636b3309a7ae7b9de5955`.
Arquivos no KidOS: `build/production-service-port/native-9CcT2k/evidence`.
Foram conferidas vinte fontes atuais e os metadados dos dois artefatos no Mac.
Tentativas anteriores recusadas por registro e por falta do dispatch de progresso
foram preservadas. A falha real de dispatch foi corrigida e recebeu regressão
de upload/paginação pela API autorizada.

Passaram os testes Companion de carregamento/seleção por produto, a suíte de
**470 testes de aplicação e 30 verificações do repositório**, builds de motor e
interfaces, teste CJS da porta com perda/adulteração/cancelamento, TypeScript e
smoke Chat Completions/LangChain/Deep com provedor simulado. Depois da correção
Core, passaram **634 testes KidOS e dois ignorados** do legado. A primeira
execução dessa suíte falhou somente por restrição de socket do ambiente;
foi repetida com a permissão necessária. Tipos do helper nativo foram corrigidos
antes de concluir a compilação completa dos testes.

Assinatura e ownership do ensaio são de teste; a autoridade não roda como root
instalado. Não comprova proteção física do banco, Isaac, GTK/terminal Navi,
produção pelo agente, gameplay, composição de release ou instalação/rollback.
Permanecem integração protegida completa v2 e orçamentos, mídia/coleta, quatro
adaptadores completos, seis jogos, pedidos inéditos, matriz física, avaliação
humana e distribuição final. O plano integral continua ativo.

## Autoridade de inferência e canal da conta de serviço KidOS

Frente posterior à porta de build: [backend protegido](GAME_KIDOS_INFERENCE.md)
em fonte no KidOS, com políticas idempotentes/concorrentes, cota persistente por
UID/dia e consumo confirmado somente pelo gateway. A política começa desligada.
Trocar projeto/sessão não reinicia contadores; falta de uso ou resultado conserva
a reserva. Há consulta do recibo original, sem reexecução do provedor.

O gateway Unix identifica o peer pelo Linux e usa a conta sem privilégios
`kidos-model`. A autoridade permite a essa conta somente admitir, confirmar ou
consultar chamadas; alterações de regra continuam com root/responsável pareado.
Não aceita UID, modelo, rota ou consumo do corpo enviado pela criança. EOF sem
terminal no gateway Responses/Ollama passou a produzir erro preservando o texto
parcial. Consumo válido vem do callback privado do gateway, sem alterar os eventos
legados ou persistir prompts/chaves no banco administrativo.

Passaram **687 testes KidOS e dois ignorados do legado**, incluindo 61 direcionados
a autoridade/transporte/provedores. No Alien x64/UID 1000, seis casos com sockets
e `SO_PEERCRED` reais verificaram recusa de impersonação, consumo, replay e
SIGKILL durante chamada ativa. Três invocações simuladas geraram três débitos;
o pedido interrompido continuou reservado e não foi repetido. A chamada pela
identidade dedicada do gateway à autoridade foi simulada em processo: não é
aceite da conta de serviço instalada ou da proteção root do banco.

Relatório SHA-256:
`d37cc361ca88756aef84ee1b865565246b3bfd38e6642ca832d98d5c9d8c2eda`.
No KidOS, `build/protected-inference/native-__ro1bvz/evidence` vincula os dez
arquivos por hash. Tentativas/revisões anteriores foram preservadas. O ensaio
não usou inferência real, credenciais ou dados de conta e não mudou a instalação.

Na fotografia desse ensaio de seis casos, a unidade existia em fonte, sem
instalação; consumidor, espera e composição protegida permaneciam pendentes.
A seção seguinte registra a ligação posterior em fonte. Orçamento por etapa,
intervenção operacional e corte do HTTP legado continuam pendentes. O backend
não limita a inferência hoje instalada, não remove as guardas Navi v2 e não é
teto financeiro/rígido de saída. O escopo integral de engines, assets, interfaces,
jogos, dispositivos, testes humanos e distribuição/rollback continua ativo.

## Consumidor opcional da inferência protegida KidOS — 2026-11-10

A [integração protegida](GAME_KIDOS_INFERENCE.md) avançou do backend ao consumidor
do adaptador em fonte. O contrato privado em `packages/contracts/src/kidos-inference.ts`
e o kit declaram ABI 1; o builder KidOS exige motor/SDK exatos e kit por hash para
`--protected-inference`. O padrão e a composição instalada não mudaram. O novo
perfil não ativa produção Game Design v2, workflows ou concessões genéricas.

O transporte Node usa socket fixo e identidade dedicada em metadado root, sem
endpoint selecionado pela UI, fallback HTTP ou retentativa interna do modelo.
Antes de enviar, o adaptador grava ID/papel/hash no memo privado do run; o gateway
persiste o hash do frame e o vínculo resolvido administrativamente. O registro
antigo migra com hash nulo, preservando histórico e débito, sem permitir replay.
Todos os papéis usam a mesma fábrica LangChain e o grafo existente.

Os hooks verificados do adaptador fornecem pendência e inspeção ao serviço.
`inference.inspect({ runId })`, SDKs TS/Python e Navi já recuperam o recibo
original em fonte. Cliente não fornece resultado nem identidade substituta.
`waitingFor: protected-inference` distingue a espera da ausência da sessão
gráfica. Resultado desconhecido retém reserva e intenção de cancelamento;
confirmação libera somente continuação explícita ou conclui o cancelamento.
Ferramentas ainda desconhecidas continuam bloqueadas. A inspeção não chama modelo.

O instalador opcional escreve `/etc/kidos/agent-inference.json` após resolver a
conta de sistema e inclui o arquivo nos controles transacionais/backup. Não
instala/ativa a unidade, habilita política ou corta HTTP. O fluxo de candidatos
ainda não seleciona a opção. O registro administrativo não é reiniciado no rollback.

Verificações desta composição de fontes:

- Companion: **473 testes aprovados**, **30 verificações do repositório**,
  TypeScript, builds da extensão/motor/Mac e roteamento Standard/Deep somente de
  leitura com inferência simulada. Casos novos preservam isolamento, cancelamento
  pendente e inspeção sem resultado fornecido pelo cliente.
- KidOS: **697 aprovados e dois ignorados do legado**; identidade da autoridade,
  vínculo exato, migração sem perda e cliente Navi cobertos. Snapshot da
  especialização conferido separadamente.
- Kit empacotado: **onze cenários** do transporte de socket, incluindo fragmentação,
  vínculos inválidos, truncamento, cota, cancelamento, propriedade e ausência de
  fallback. Standard, Deep, pausa por orçamento, delegação e arquivos legados
  passaram no grafo/checkpointer oficiais com transporte simulado.
- Linux x64/UID 1000: **nove casos**, Node **22.23.4**, cliente Node→gateway Python
  e kit real, cinco chamadas simuladas e oito inicializações do gateway. Replay
  não reexecutou provedor; uma chamada pendente reteve **65.536 tokens** da reserva.
  O total conservado foi **196.706 tokens contabilizados**, com uma pendência.
  Esse valor inclui reservas anteriores fechadas explicitamente só na fixture,
  sem reembolso; não é medição de uma fatura.

No KidOS, `build/protected-inference-client/native-u8glo3o0/evidence/report.json`
tem SHA-256 `38486007e1d2df5948f9d40f838756a50894542591dd7bbfa1c0aea9eba48dd4`.
`verification.json` confere doze fontes, o relatório e o kit
`a6c15ed5cb792c5d3b197d87d40c94ab930804c285be35fbfcf42d87cb3739bc`.
Os relatórios anteriores permanecem históricos e não comprovam essas novas fontes.

O ensaio Linux usa sockets/kernel reais, mas a identidade gateway→autoridade é
uma fachada temporária em processo e o provedor é simulado. Naquela evidência, grafos, serviço e transporte foram
exercitados em percursos separados. A seção seguinte registra a composição
posterior com SDK, assinatura de teste e UIDs reais. Continuam pendentes a
composição de release, instalação/rollback, corte do HTTP e aceite
GTK/terminal/perfil infantil. Nenhuma
conta, unidade permanente, credencial, instalação ou release foi alterada.
Os requisitos integrais do plano, incluindo quatro engines, cadeia artística,
seis jogos, pedidos inéditos e jogadores reais, permanecem pendentes de conclusão.

## Composição protegida com root e UIDs reais — 2026-11-10

A [fronteira de inferência](GAME_KIDOS_INFERENCE.md#qualificação-conjunta-com-uids-reais)
foi qualificada em conjunto: SDK TS → TLS/IPC → Agent Service → loader assinado →
adaptador KidOS → gateway Unix → autoridade root. Não houve injeção de transporte
ou facade de identidade/autoridade; os dois sockets identificaram os UIDs reais
pelo kernel. O root mantém dados/políticas/artefatos; UID 555 executa somente
gateway e UID 1000 executa cliente/serviço. O provedor e o contexto/finalização de
desktop são simulados; a fixture recusa ações de sistema.

`test/kidos-inference-harness.ts` é um helper explícito de qualificação, fora de
entrypoints do motor/release. No KidOS, preparador, controlador e ponte de fixture
ficam em `integrations/agent-engine`; o contrato de execução está em
`docs/PROTECTED_INFERENCE_COMPOSITION.md`. A assinatura é efêmera e de teste;
o loader real exige propriedade root, integridade e pin do bundle. A política
provisionada recusa produto/perfil/catálogo alterados. O filho não escreve no
banco, metadado, política ou transporte, e o gateway não acessa `admin.*`.

Passaram **oito cenários**: Standard, Deep, repetição idempotente, desconexão do
cliente, política desligada com continuação explícita, SIGKILL do serviço durante
chamada ativa, stream desconhecido com inspeção/cancelamento após reinício e
rejeições reais entre UIDs. Foram doze chamadas simuladas, sem repetição na
reconciliação. A fixture root encerrou explicitamente as duas chamadas desconhecidas
sem restituir tokens: 131.562 contabilizados e zero reservas pendentes ao final.
Não foi exercitada delegação neste percurso; ela tem os testes separados do grafo
documentados anteriormente.

Evidência KidOS: `build/inference-composition/attempt-6/evidence/report.json`,
SHA-256 `c03f387159a54258c852e977795eaf84846e4958c8fc4168090fd8dba488b6c8`.
`verification.json` confere as 52 entradas públicas e 1.637 inputs atuais do
bundle; manifesto, assinatura e chave pública da fixture foram preservados e
a assinatura Ed25519 foi verificada fora do contêiner. Tokens, identidade TLS,
banco, checkpoints e chave privada não foram exportados. Falhas de preparação
anteriores permanecem em diretórios próprios, sem sobrescrever a evidência.

Ambiente: Linux x64 sobre Docker no Mac ARM64, imagem imutável
`sha256:2074385ca804b31f612ba01ac4d2025a6962fda2a0746541dab663336d304934`,
Node 22.23.4/SQLite de runtime fixado, sem rede e com entradas somente de leitura.
Os helpers root recusam execução fora do contêiner/instalação descartável com
guardas que não desaparecem sob Python otimizado. TypeScript/compilação e os
sete testes existentes de loader/inspeção passaram após adicionar o harness.
Os executores de produto não mudaram nesta frente.

Esta composição de fontes não é um novo artefato completo de release, unidade
systemd instalada ou inferência real. Não prova desempenho físico, GTK ou conta
infantil. Continuam obrigatórios estágios protegidos por projeto, decisões
administrativas operacionais, corte do HTTP legado, instalação/migração/rollback,
aceite nos três clientes e todo o escopo criativo/técnico/humano do plano.

## Alocação protegida de inferência por projeto/etapa — 2026-11-10

O domínio KidOS `guardian_inference_projects.py` mantém alocação por UID/projeto,
referência opaca Root, etapa de orçamento, blocos, decisões idempotentes/CAS e
auditoria. Por padrão são 128 chamadas/4.194.304 tokens por bloco e 16 blocos
máximos; a cota global permanece adicional e independente. Consumo, reservas e
histórico não reiniciam ao trocar de conversa, projeto ou dia. A etapa da chamada
fica fixada na admissão. Alteração de etapa recusa pendências; confirmação de uso
atualiza os dois relatórios pela mesma linha da autoridade.

Só root/responsável com `rules` no perfil cria, altera, concede ou muda a alocação.
Gateway não recebe esses poderes; criança só lê. `require_project` é nova política
global, false em dados antigos; se habilitada, recusa chamadas Unix sem referência
autorizada. Não limita o HTTP legado. Estágio de orçamento não é gate técnico,
aceite criativo, permissão de ferramenta ou conclusão de jogo.

O serviço captura a seleção ao admitir o run e preserva sua identidade em
recibo privado. O adaptador com opção assinada resolve o projeto Root, persiste
ref e envia todos os papéis por esse vínculo; sem seleção, usa a alocação
administrativa `navi-conversations`. Projeto sem orçamento autorizado aguarda.
RunSpec não aceita referência de autoridade, e outra janela não muda a seleção
de conversa com run ativo. Na retomada não se escolhe outro orçamento.

O builder tem a opção adicional `--protected-inference-projects`, dependente do
transporte protegido, artefatos exatos e `installedCoreInferenceProjectABI: 1`.
O kit declara `installedCoreInferenceProjectVersion: 1`. Recibos vinculados têm
`production: { ref, stage }`; o transporte recusa referência/estágio divergentes,
campo injetado ou ABI ausente antes de enviar. Defaults, perfil instalado e
builder de candidatos continuam sem ativar a opção. Migração aditiva mantém
registros anteriores sem escopo; downgrade que ignore a política não está qualificado.

Passaram **715 testes KidOS e dois ignorados do legado**, **474 testes Companion**
e **30 verificações do repositório**, TypeScript, builds da extensão/motor/Mac
e smoke Standard/Deep simulado somente de leitura. O teste do serviço rejeita
seleção por RunSpec e conserva a seleção no run. São **16 cenários de transporte**.

A composição Linux x64 descartável com root, gateway UID 555 e cliente/serviço
UID 1000 passou em **nove cenários**. O novo caso não chamou provedor para projeto
sem alocação; esgotou Design com duas chamadas; recusou a terceira; reiniciou o
serviço, recusou troca do projeto ativo e só retomou depois de decisão Root.
Design preservou duas chamadas/98 tokens; Core registrou outras duas/98. As 16
chamadas simuladas do conjunto tiveram 16 débitos; houve 131.758 tokens
contabilizados ao final, incluindo duas reservas desconhecidas conservadas após
intervenção explícita da fixture. Não é medição de fatura ou prova de qualidade.

Relatório KidOS `build/inference-composition/attempt-8/evidence/report.json`,
SHA-256 `af84725616c1b47ef1805b631423e94703aa66d66571fc5676aeca089dd4cb88`.
Manifesto de 53 entradas:
`29b5e5177007f8506e8c57bb47e930769932a65a0838fbb7a5e7e7849f9cc275`.
`verification.json` confere também os 1.637 inputs atuais do bundle e a assinatura
pública de fixture. Imagem, limites e ferramentas são os mesmos do ensaio
anterior; o Linux x64 usa emulação no Mac ARM64. O provedor/contexto são simulados;
não há instalação, conta infantil real, systemd ativo ou aceite físico.

O contrato local completo é `docs/PROTECTED_PROJECT_INFERENCE.md` no KidOS.
Continuam pendentes workflow técnico protegido, atribuição de builds/testes/mídia,
superfície administrativa e Navi v2, migração/rollback instalados com revisão
mínima da autoridade, corte do HTTP legado e o aceite integral do plano.

## Admissões protegidas de build por projeto/etapa — 2026-11-10

Root, broker e porta assinada passaram a vincular as admissões de compilação ao
projeto e estágio de orçamento. `requests_per_block` começa em zero, incluindo
registros antigos: só inferência aprovada não concede builds. Root/responsável
com `rules` e perfil autorizado habilita a alocação via política CAS/idempotente.
O contador `production_requests` é separado de chamadas/tokens e permanece
debitado em falha/cancelamento/reconciliação. O débito global e o de etapa são
transacionais na autoridade, sem reinício por projeto, run ou dia.

A política `game-build.policy.get/update` tem seu próprio `require_project`,
independente da política de inferência. Criança não altera os limites. A porta
resolve a referência Root pelo projeto persistido no job e inclui o par no
descritor/hash de entrada. O broker confere/guarda o grant antes do despacho e
os recibos fixam ref/projeto/etapa. Perder confirmação não produz outra execução;
inspeção recupera a admissão original mesmo depois de mudança administrativa
de etapa. Uma alocação não libera um Core com efeito desconhecido, tampouco
certifica qualidade ou avanço de workflow técnico.

O ABI privado é `installedCoreGameProjectVersion: 1`, manifesto
`installedCoreGameProjectABI: 1` e Core `project_budget_abi: 1`.
`--game-production-projects` exige a opção Core e composição exata; defaults,
catálogo legado e instalações não foram ativados. Porta legada incompatível com
exigência de projeto já aparece indisponível na sondagem, sem fallback.

Passaram **724 testes KidOS e dois ignorados do legado**, **474 testes Companion**
e **30 verificações do repositório**, TypeScript, builds de motor/extensão/Mac e
smoke Standard/Deep simulado somente de leitura. **Catorze cenários de porta**
exercitam escopo/ABI, cota, falta de autoridade, cancelamento, recibos incorretos
e recuperação. Os testes de domínio cobrem concorrência, fase antiga preservada,
exigência independente de IA e ausência de concessão implícita para registros legados.

A composição SDK/TLS/serviço/assinatura/porta/broker/autoridade passou em **dez
cenários** no Linux x64 descartável sobre Mac ARM64. Root/UIDs 555/1000 usam
identidade real do kernel. O novo caso recuperou o primeiro build após SIGKILL
do serviço, recusou outro pela etapa esgotada e concluiu uma solicitação nova
após concessão Root com inferência desligada. Duas admissões ficaram registradas
em Design; conferir não produziu outro débito. Qualidade permaneceu não aprovada.
O compilador, ciclo de vida e transporte Core desse caso são simulados em torno
do domínio real; não é aceite de bwrap/systemd, registro completo de permissões/
auditoria, jogo, GTK, instalação ou desempenho físico.

Relatório KidOS `build/inference-composition/attempt-11/evidence/report.json`,
SHA-256 `f54302208dd3d337ab2d290c760518f93254cf31e648552f477b65f707bf516a`.
Manifesto das 60 entradas:
`306d1aadced6697bd0741fdcd591189818ad75271ddedfce64983c4f9605b2c0`.
`verification.json` confere 1.638 inputs atuais do bundle, fontes/runtime e
assinatura pública da fixture. A tentativa anterior que não persistiu design foi
recusada corretamente pelo serviço; a guarda foi preservada e o fixture corrigido.

O contrato é `docs/PROTECTED_PROJECT_BUILDS.md` no KidOS. Ainda falta contar a
fila antes de chegar ao Core e integrar testes/mídia, workflow técnico protegido,
superfície administrativa/Navi v2, corte dos caminhos legados, composição com
compilador/isolamento reais e instalação/migração/rollback com revisão mínima.
O escopo completo de engines, assets, clientes, jogos, dispositivos, pedidos
inéditos e avaliação humana permanece obrigatório; a entrega integral está ativa.

### Reserva pré-fila: protocolo Root/Core, consumidor ainda pendente — 2026-11-10

Foi implementada em fonte a separação entre reservar cota de produção e autorizar
um despacho único. O novo modo Core `admission_mode: "queue"` exige projeto
protegido, permite `game_builds.admit` antes de enviar arquivos e devolve o estado
de admissão sem expor o token. Reserva não ocupa o slot do compilador: outro
pedido pode admiti-la durante uma compilação ativa.

Root persiste a reserva, claim e cancelamento vinculados ao UID e conteúdo.
Cancelar conserva a cota já consumida; cancelar antes de um pedido atrasado cria
um bloqueio persistente sem cobrar uma reserva inexistente. Inspeção não cria
admissões. Reinício não troca etapa nem autoriza repetir; claim com confirmação
perdida mantém reconciliação quando a submissão não foi comprovada.

A política administrativa opt-in `require_queue` recusa novas reservas fora
desse modo. Uma edição antiga que omita o campo não desativa a exigência já
vigente. Os schemas Companion reconhecem a capacidade `queue_budget_abi: 1`,
o campo `admitted` e os estados Core `reserving`/`admission_unknown`. A porta
atual informa indisponibilidade se a política exige o contrato novo.

Passaram **739 testes KidOS, dois ignorados do legado**, incluindo oito casos
Root e sete do broker novos: concorrência, cancelamento/claim atrasados,
falsificação de identidade/conteúdo, reserva sem upload completo, reinício,
confirmação perdida e rejeição sem efeito. O teste de escopo/auditoria do Core
inclui a operação nova. Passaram **474 testes Companion e 30 verificações do
repositório**, TypeScript, builds de motor/extensão/Mac, dezesseis casos da porta
e smoke Standard/Deep de leitura com provedor simulado.

O contrato está em `docs/PROTECTED_BUILD_QUEUE.md` no KidOS. **O hook de admissão
antes da fila do Agent Service e seu consumidor na porta assinada ainda não
foram implementados.** Portanto, não há ainda cobrança de todo pedido cancelado
na fila do SDK. A política permanece false por padrão; não houve instalação ou
ativação Navi v2. Compilador/processos são fixtures nos testes novos; o ensaio
`attempt-11` anterior é histórico e não qualifica esta revisão.

A próxima entrega deve persistir a intenção do job, confirmar a reserva antes
de aguardar recursos e fechar a identidade original em cancelamento/recuperação.
Continuam pendentes testes/mídia, workflow protegido, composição assinada e
isolamento real, interfaces/instalação/migração/rollback. O restante integral do
plano, incluindo quatro engines e aceite dos jogos, permanece necessário.

### Admissão protegida ligada à fila do serviço e à porta — 2026-11-10

O Agent Service agora persiste a intenção do job antes de chamar os hooks
privados de admissão de sua porta instalada. O job começa `admitting`, com journal
`pending`; só a reserva confirmada o leva a `queued`/`reserved` e permite aguardar
recursos. A UI distingue “Confirmando cota” de “Na fila”. O limite inclui pedidos
ainda em admissão; parâmetros da interface não escolhem esses estados ou hooks.

A porta KidOS opt-in resolve a referência Root pelo projeto persistido, cria a
identidade Core original e reserva antes de enviar arquivos ou iniciar compilação.
`build` usa somente essa reserva. Cancelar na fila fecha o pedido original e
preserva o débito; sem reconhecimento, mantém reconciliação e recursos. Queda
durante admissão ou espera exige inspeção do mesmo pedido, sem nova reserva ou
despacho. Recusa conhecida antes de reservar encerra com diagnóstico sem exigir
outra consulta à autoridade; não bloqueia o projeto como resultado desconhecido.

O Core também oferece `cancel.request`, restrito ao descritor original: fecha um
begin perdido/atrasado sem readmitir ou inferir que ausência de recibo é prova de
ausência de efeito. Cancelamento durante a reserva conserva a intenção e termina
pela conferência posterior. O registro/capacidade exige `game_lab.write.own`.

O kit/manifesto negociam `installedCoreGameQueueVersion: 1`/
`installedCoreGameQueueABI: 1`. `--game-production-queue` exige projeto, produção
Core e os insumos exatos; catálogo `queueAdmission: { schema: 1 }`. Portas legadas
ou somente por projeto recusam `require_queue`. Defaults, instaladores e perfil
Navi v2 não foram ativados. Hook de admissão incompleto é recusado pelo carregador
assinado e pelo serviço; uma confirmação do modelo não concede autoridade.

Passaram **742 testes KidOS, dois ignorados do legado**, **480 testes Companion**
e **30 verificações do repositório**, TypeScript, builds de motor/extensão/Mac e
smoke Standard/Deep de leitura com provedor simulado. **25 cenários da porta**
cobrem reserva anterior ao upload, recusas, Core antigo, confirmações perdidas e
fechamento desconhecido. Os testes do serviço incluem persistência anterior ao
efeito, cancelamento sem perda de cota, reserva pendente/no limite, recuperação
de fila após queda e ausência de repetição.

A composição SDK/TLS/serviço/assinatura/porta/broker/autoridade passou em **11
cenários**, Linux x64 emulado no Mac ARM64, com Root/UIDs 555/1000 reais. O novo
percurso admitiu enquanto outro build mantinha recursos, cancelou na fila e
preservou uma unidade no projeto cancelado. Foram **três admissões e dois
despachos do compilador de fixture**. Recuperação após SIGKILL, recusa por cota,
continuação Root e produção com inferência desligada continuaram passando.
Qualidade permaneceu não aprovada.

Relatório KidOS `build/inference-composition/attempt-14-queue/evidence/report.json`,
SHA-256 `de63ad78485ac51792c91a3a4e75c67627da5e90fd313b81c6184e2085593fa8`.
Manifesto de 60 entradas:
`2931f83f7173c52ecebc00b3922ea589d72b8f78e9028f775a953e848a1bc54a`.
`verification.json` verifica fontes mínimas, 1.638 inputs do bundle Companion,
runtime, logs das verificações e assinatura pública Ed25519 de fixture. A
tentativa 12 falhou porque a ponte de teste ainda recusava operações novas;
foi preservada. A tentativa 13 passou antes do ajuste de recusa conhecida e é
histórica. A revisão final foi novamente qualificada na tentativa 14.

Compilador, ciclo de vida e transporte Core são controlados nesse ensaio; não
qualifica bwrap/systemd, registro completo de permissões/auditoria Core,
compilação real, GUI, licença ou desempenho físico. O bundle usa runtime Linux
explícito anterior, não é release completa do motor. Nada foi instalado no Alien.
O contrato local é `docs/PROTECTED_BUILD_QUEUE.md` no KidOS.

Continuam pendentes contagem de validações/mídia, workflow técnico protegido,
superfície administrativa/Navi v2, corte de rotas legadas, composição distribuível
com isolamento real e instalação/migração/rollback. Engines, assets, clientes,
seis jogos, pedidos inéditos, dispositivos e playtests mantêm o aceite integral
do plano. A entrega completa permanece em desenvolvimento.

### Worker real de mídia e preparação Core, sem broker ativado — 2026-11-10

Foi acrescentado o contrato privado de uma operação de mídia e o componente
`game-media-worker.cjs` ao build do motor. Reutiliza os codecs de PNG/atlas/WAV;
não há outro executor de agente, geração remota ou provedor novo. O serviço e
worker passaram a compartilhar a validação pura de fontes: assets registrados,
arquivos/tipos da revisão, identidades distintas, ciclos e orçamento de 64 MiB.
A API de erros do serviço e o fluxo processar/aplicar foram preservados.

O worker valida novamente documento, receita e ferramenta fixados; só lê blobs
declarados por hash. O candidato liga request SHA, fonte, receita e toolchain,
com até 17 arquivos/128 MiB. Marcador de operação e commit sem sobrescrita impedem
repetição sobre um resultado reconhecido. Bytes, links, inputs extras, receitas
ou composição alterados são recusados, preservando originais/candidato. O hash
normalizado da receita vem do Node e é conservado pelo Core, evitando divergência
de representação de números pequenos em Python.

No KidOS, `MediaWorkerInstallation` verifica a instalação imutável Root e prepara
somente o comando fixo de isolamento, com limites de memória/CPU/processos/tempo.
`verify_media_candidate` confere os bytes originais após encerramento comprovado,
sem reprocessar. O compilador web mantém seus parâmetros anteriores. **Esses
componentes não adicionam broker/RPC/porta/cota de mídia ou capacidade Navi.**

Passaram **764 testes KidOS, dois ignorados do legado**, **489 testes Companion
e 30 verificações do repositório**, TypeScript, builds de motor/extensão/Mac,
smoke Standard/Deep simulado somente de leitura e os 25 cenários da porta de
builds. Os testes novos cobrem processamento real, hash, fonte, ancestralidade,
links, concorrência, cancelamento e preservação do resultado anterior.

O ensaio do worker real passou em **sete cenários** Linux x64 emulado no Mac
ARM64, offline, runtime Root e worker UID 1000. Foram conferidos pixels PNG,
atlas de duas páginas/dois frames com animação, WAV de 1.103 frames a 22.050 Hz,
recibos pelo Core e recusa de escrita no runtime Root. Adulteração de bytes/
receita não produziu resultado reconhecido; repetir não substituiu o candidato.
O componente exercitado é idêntico, em bytes, ao worker do build atual do motor.

Relatório KidOS `build/media-qualification/attempt-2/evidence/report.json`, SHA-256
`745d0ec1f0841f62384d46bb6dc1aba91b5c9a705660bf57c81594bc0b2e7321`.
Manifesto de 12 entradas:
`f98ff31caae83588cbf61cc2b06081837df695703ec1bf8e9311883f82d00ef3`.
`verification.json` confere 137 inputs Companion, fontes Core, runtime e bytes do
componente empacotado. A tentativa 1 fica preservada: o tmpfs estava `noexec`,
impedindo iniciar o Node antes dos codecs; a montagem da fixture foi corrigida.

Passaram também os **11 cenários de regressão** de fila/inferência/builds com as
fontes atuais, UIDs reais, assinatura de fixture, três admissões e dois despachos
de compilador simulado. Relatório KidOS
`build/inference-composition/attempt-15-media-base/evidence/report.json`, SHA-256
`394ebb055829635746e64cb18e24f0a6fc02c84ff7090cccd41e6d1b34bfe8b5`.
Inputs SHA-256 `6c7b1df030d4a72a70005149e9b03f08471c0546b4a754435cdec34eb1ec30b5`;
são 60 entradas e 1.639 inputs Companion conferidos. Relatórios anteriores
permanecem históricos. Essa regressão não integra a mídia ao broker.

Referências: [worker fixo de mídia](GAME_MEDIA_WORKER.md) e
`docs/GAME_MEDIA_PREPARATION.md` no KidOS. Não houve instalação no Alien nem
release nova. O ensaio de mídia usa isolamento de contêiner; não executa o comando
systemd/bwrap preparado, nem certifica GUI, GPU, áudio físico, arte ou licenças.
O runtime explícito anterior mais bundle atual não é uma release completa assinada.

Faltam broker/porta de mídia com admissão, contagem de mídia/validações, workflow
protegido, perfil Navi v2, corte de rotas legadas, isolamento real do broker e
instalação/migração/rollback. A entrega integral de engines, assets, interfaces,
seis jogos, pedidos inéditos, dispositivos e playtests permanece obrigatória.

### Broker de mídia, porta protegida e alocação conjunta em fonte — 2026-11-10

O KidOS passou a ter `game_media.*`, usando o ciclo durável de produção existente,
com limites próprios de fontes/saída, verificação do candidato e rota separada
dos builds. Ambos compartilham armazenamento, bloqueio e slot único. O worker
não ganhou política, agente ou execução genérica. A porta opt-in `media.cjs`
chega ao serviço pelo adaptador assinado e exige reserva, cancelamento e inspeção.
O builder confere ABI/manifesto/worker/codec exatos e conserva os defaults e
ferramentas do modelo. Não foi habilitado o perfil Navi v2.

Root conta builds e mídia na mesma alocação por projeto/etapa e nos limites
diários por UID, com divisão por tipo no histórico. Registros antigos migram
como build; cancelamento e reinício não devolvem consumo. O serviço reserva
antes da fila de recursos, conserva admissões desconhecidas e nunca aplica
automaticamente um candidato ao projeto. A inspeção por identidade original
também corrige o caso de perda do recibo local: claim ou grant legado emitido
mantém efeito desconhecido e bloqueia despacho, mesmo sem unidade observável.

Passaram **783 testes KidOS, dois ignorados do legado**, **492 testes Companion
e 30 verificações do repositório**, tipos, builds de motor/extensão/Mac e smoke
Standard/Deep simulado de leitura. **14 cenários da porta de mídia** e **25 da
porta web** usam Core simulado. Domínio com ledger Root real/worker controlado
verificou cota/slot conjuntos, recuperação, fontes e perda do recibo após claim.
O loader de assinatura recusou autoridade/produto/hooks de mídia inadequados.

A regressão Linux SDK/TLS/IPC/assinatura/Root passou em **11 cenários**:
relatório KidOS `build/inference-composition/attempt-17-media-port/evidence/report.json`,
SHA-256 `e1b073e2cc1d0530e1339e852456f55150e3ced8935983a2f8553bbb96f780e4`.
Inputs SHA-256 `1422e96654d8e8890e951a2ed33675454879546788cdfab1d7d1ee5832dec062`;
62 entradas e 1.642 fontes Companion conferidas; assinatura pública verificada.
A tentativa 16 falhou antes da fixture por entrypoint implícito da imagem; foi
preservada, com invocação explícita na tentativa 17. Compilador, transporte e
ciclo de vida desse ensaio são simulados; não compõem o worker real de mídia.
Referências: [mídia protegida](GAME_MEDIA_WORKER.md) e os documentos KidOS
`docs/GAME_MEDIA_PREPARATION.md` / `docs/PROTECTED_BUILD_QUEUE.md`.

Continuam necessários: composição worker/broker/porta/Root real, contagem de
validações, workflow protegido, bwrap/systemd reais, autoridade administrativa e
Navi v2, corte legado, release exata e instalação/migração/rollback. A conferência
do Unity Hub chegou à tela de login, sem licença confirmada; desbloqueio do Mac
não equivale a licença. Nenhuma instalação ou publicação foi realizada nesta etapa.
Os quatro adaptadores, três clientes, arte/áudio, seis jogos, pedidos inéditos,
dispositivos e aceite humano continuam no escopo integral obrigatório.

### Mídia real composta com serviço, Core oficial e autoridade — 2026-11-10

O ensaio offline passou em **15 cenários**, incluindo PNG/atlas/WAV reais pelo
SDK, TLS/IPC, serviço e porta verificada por assinatura de fixture. `KidOSCore`
e `CoreUnixServer` usam o registro de capacidades, UID do kernel, permissões e
auditoria reais, com home/catálogos sintéticos. Root/gateway/conta infantil são
processos/UIDs separados. O worker usa runtime Root e bytes idênticos ao build.

Foram conferidos pixels, duas páginas de atlas com frames/animação e WAV de
1.103 frames a 22.050 Hz, preservando receita `1e-7`. Processar conservou a
revisão até aplicação explícita. SIGKILL do serviço recuperou o candidato sem
novo processo; cancelar mídia na fila manteve consumo sem executá-la; mudar
de build para mídia não contornou a alocação. Foram sete admissões Root, três
workers de mídia e dois despachos web simulados. A produção continuou com IA
desligada. Outro UID e falta de escopo foram recusados; cadeia de auditoria íntegra.

Relatório KidOS: `build/inference-composition/attempt-21-official-core-media/evidence/report.json`,
SHA-256 `2b66fa83c6fab78ad9526f008bc486f802d8d53abd751e7f6ad8383b3c9865b6`.
Inputs SHA-256 `1662e330d75945f6d291c9c8bd02e99c5a55c9e2c628592e29930d17809b1c6f`;
182 entradas e 1.669 fontes Companion conferidas, assinatura pública verificada.
Worker SHA-256 `0dfaf573bdd89704b46a1b4ea3cccba74a163ec84b7ae8d68fc430cd183a3134`.
Passaram **786 testes KidOS, dois ignorados do legado**, **492 Companion e 30
verificações do repositório**, tipos/build e guardas recusando execução fora do
contêiner mesmo com Python otimizado. Não foram exportados logs de auditoria,
bancos, tokens, checkpoints ou chave privada. As tentativas anteriores permanecem:
18 falhou antes do Core; 19 passou com transporte de fixture; 20 passou pelo Core
oficial antes da última guarda; a 21 valida a revisão final.

O gerenciador de processos é uma fixture com filhos reais e confirmação controlada
de término; não executa systemd/bwrap nem prova limites por job instalados. O
compilador web continua simulado. A prova não certifica GUI, audição física,
arte/licenças, jogos completos ou nova release. Permanecem contagem de validações,
workflow protegido, isolamento instalado, autoridade/UI administrativa, Navi v2,
corte legado, composição de release, instalação/migração/rollback e toda a matriz
de engines, assets, três clientes, seis jogos, pedidos inéditos e aceite humano.
Referências: [mídia](GAME_MEDIA_WORKER.md) e `docs/GAME_MEDIA_PREPARATION.md` no KidOS.

### Mídia em systemd/bubblewrap reais no Alien — 2026-11-10

Passaram **nove cenários nativos** em Linux x86_64, conta alien/UID 1000,
por SSH e pasta temporária privada. `MediaWorkerInstallation.command` executou
systemd/bwrap reais com o worker exato do build. PNG, atlas de duas páginas e
WAV de 1.103 frames a 22.050 Hz foram decodificados/conferidos, incluindo `1e-7`.
Fontes/receita adulteradas e repetição foram recusadas sem sobrescrever candidato.
O sandbox não acessou home/canário/variável externos nem escreveu runtime/input;
o listener loopback do host recebeu zero conexões.

Foram observados 768 MiB, 64 tarefas, uma CPU, NoNewPrivileges e um minuto de
runtime configurado. Cancelamento e timeout (reduzido a três segundos só no
teste) confirmaram PIDs zerados, cgroup vazio e heartbeat parado. Não foi medido
desempenho físico nem exaurida memória/tarefas. Os nove nomes de unidade são
próprios do teste; não se encerrou processo ou unidade arbitrários.

Node Root existente foi conferido antes da cópia; o runtime novo do ensaio é do
UID, com override exclusivo de fixture. **Não foi instalado um runtime Root do
novo worker, alterada política/pareamento ou habilitado Navi v2.** A composição
Root/serviço/Core anterior e esta prova nativa não equivalem a aceite instalado.

Relatório KidOS `build/native-media/attempt-2/report.json`, SHA-256
`53e04ab3dc8dc34fd2dd105f97b9bf3bbc6f71bbe0d7d891a0e61fed680872d9`;
payload SHA-256 `4ef7997bcf78a0b24e47fe5e12f525f80a20798e50153e9818783de27afa4f36`.
São 11 entradas mais manifesto e 138 fontes Companion verificadas. Worker
`0dfaf573bdd89704b46a1b4ea3cccba74a163ec84b7ae8d68fc430cd183a3134`
idêntico ao componente do motor. A tentativa 1 foi preservada. A 2 qualifica a
revisão final, com hashes verificados antes de importar módulos transferidos.
Um teste com módulo adulterado comprova recusa sem carregá-lo.

Passaram **792 testes KidOS**, dois ignorados do legado, **492 Companion e 30
verificações de repositório**, tipos/build. Os helpers de fixtures foram extraídos
para uso comum e a regressão descartável Root/UID passou em sete cenários:
`build/media-qualification/attempt-3-shared-fixtures/evidence/report.json`, SHA-256
`7515ebc35357b9ee5399bf6d33ef90b20953a5d34e5835c496638ad860bb1790`;
inputs `b05ac1049af0f2f959599239fc48407dea11a30d3c61d45b47cd5af15660dc68`.
Referência: `docs/GAME_MEDIA_NATIVE_QUALIFICATION.md` no KidOS.

Permanecem composição Root instalada, workflow/cota de validações, autoridade/UI
administrativa, Navi v2, corte legado, release/migração/rollback. A conta Isaac,
GPU/Wayland, áudio físico e qualidade/licenças exigem provas próprias. Quatro
adaptadores, arte original/licenciada, três clientes, seis jogos, pedidos inéditos
e aceite humano continuam obrigatórios; o objetivo integral segue ativo.

### Workers protegidos no instalador: composição e rollback em fonte — 2026-11-10

O instalador KidOS agora valida os catálogos opt-in web/mídia contra a composição
assinada: runtimes, compilador, codec, toolchains, projeto/fila e ABI privados.
O recibo só registra os workers selecionados; defaults legados são preservados.
Durante ativação, publica apontamentos Root exatos para compilador web/mídia e
inclui ambos no journal. Downgrade remove apontamentos não selecionados sem
apagar releases. Falha/recuperação/rollback restauram o conjunto anterior.
Não concede cota, ferramentas ou política parental.

A preparação compara as cópias congeladas com os hashes capturados inicialmente,
recusando inclusive substituição por outro componente com assinatura válida.
Rejeita hard links e verifica propriedade dos releases no sistema real. Somente
Node e o esbuild nativo da plataforma ficam executáveis; foi corrigida a
normalização que deixaria o compilador sem execução. Produção persistida no
serviço agora bloqueia atualização mesmo sem run ou recibo Core; estado inválido
não libera atualização.

Passaram **805 testes KidOS**, dois ignorados do legado. Os testes novos usam
chaves Ed25519 efêmeras, componentes fictícios e diretórios de sistema simulados,
sem executar código recebido. Cobrem Linux x64/ARM64 em metadados, opt-in/recusa,
troca durante cópia, permissões, falha após publicar controles, recuperação e
rollback. Não são teste nativo ARM64, pacote de release ou aceite Root instalado.
As provas nativas anteriores do worker mantêm seus escopos próprios.

Referência operacional: `docs/PROTECTED_WORKER_INSTALLATION.md` no KidOS.
Ficam explícitas duas lacunas antes de instalar: o empacotador/lock ainda usa a
integração legada e exige novos artefatos exatos/revisados; o updater geral copia
Core/autoridades antes da transação do motor e precisa coordenar esse intervalo
com bloqueio/quiescência e recuperação de todo o pacote. Nada foi instalado no
Alien ou publicado nesta etapa. Workers/autoridades/serviço/Navi instalados,
workflow/cota de validações, corte legado, migração/rollback real e toda a entrega
de engines/assets/interfaces/jogos/aceite humano permanecem obrigatórios.


### Atualização conjunta Core/motor em fonte — 2026-11-10

Esta etapa avança a janela do updater registrada no ensaio anterior: o código
Python do sistema passa a versões imutáveis e o shell de instalação só é chamado
sob o mesmo marcador, após a ociosidade autenticada e a segunda verificação de
trabalho. O updater não sobrescreve `/usr/lib/kidos`; cada novo processo resolve
uma versão e mantém esse caminho para imports tardios. Metadados inválidos não
provocam fallback. Navi conserva o cliente do runtime do adaptador; não ganha
outro executor ou ferramentas genéricas.

A integração assinada declara `systemUpdateABI: 1`; empacotador/helper recusam
pacotes sem esse contrato. O runtime preparado liga-se à mesma publicação e aos
hashes de motor/SDK/adaptador. Cópia congelada, assinatura, árvores instaladas,
propriedade e permissões são verificadas antes da seleção. O preflight da máquina
usa a versão candidata verificada, em vez de depender de módulos antigos em cache.
EntryPoints, unidades, release e seleção Python entram no journal junto ao motor
e aos workers. Rollback preserva modos de execução e dados posteriores; bancos,
chaves, pareamentos, regras familiares e cotas não voltam a fotografias antigas.

Falha anterior ao commit restaura controles e recarrega unidades; se isso falhar,
o marcador continua bloqueando admissões até recuperação. Uma interrupção entre
commit e remoção do marcador conserva a seleção nova. Falhas já restauradas não
são reaplicadas depois. Startup ocorre após commit: se falhar, fica `pending`
e o updater retorna 75, sem desfazer uma seleção que já pode ter recebido trabalho.
Pré-requisitos de pacotes, contas/grupos e certificados do sistema não têm rollback
integral por este journal; migrações precisam manter compatibilidade de retorno.

Passaram **836 testes KidOS, dois ignorados**, com Python 3.12.4 no Mac; 31 casos
novos exercitam o runtime/transação em diretórios temporários, com assinaturas
efêmeras. Incluem processo separado conservando import tardio antigo, adulteração,
troca assinada durante cópia, vinculação de componentes, dois checks de ociosidade,
shell fixo com ambiente restrito, reload/falhas/interrupções, startup e rollback.
O instalador shell e binários recebidos não são executados nesses casos. A primeira
execução integral não tinha acesso aos sockets privados temporários; a execução
final com esse acesso passou em 28,71 s. Não foi necessário chamar um provedor.

Referência KidOS: `docs/SYSTEM_RUNTIME_UPDATES.md` e
`docs/PROTECTED_WORKER_INSTALLATION.md`. Logs/hashes locais desta fotografia:
`build/system-runtime-update/` no KidOS. Não há instalação ou release
nova, nem habilitação de Navi v2. A próxima qualificação exige pacote exato e
Linux descartável, Root/UIDs, shell e serviços reais, contas, interrupção e
rollback com dados posteriores. As provas nativas anteriores do worker têm
escopo próprio e não cobrem essa atualização conjunta.

Permanecem a composição de release/instalação, workflow e validações protegidas,
corte legado e toda a entrega confirmada de Game Design: quatro engines,
arte/áudio, interfaces, seis jogos, pedidos inéditos e aceite físico/humano.


### Shell real, Core e rollback em Linux descartável — 2026-11-11

O ensaio do instalador por computador passou em **nove cenários**, com snapshot e
assinaturas, `update.sh`/`install.sh` reais, Core/autoridade oficiais em processos
separados, SDK/TLS, motor 1.0.2 e dois UIDs reais. Instalou os componentes em uma
raiz de contêiner nova, nunca no Alien. O pacote usa fontes públicas atuais,
assinatura KidOS efêmera e duas gerações de fixture; não é uma nova release.
Os gerenciadores de pacotes/serviços são simulados e não equivalem a systemd real.

Os cenários verificaram proteção dos controles Root, separação de perfis,
recusa por job de produção desconhecido sem trocar seleção, SIGKILL após o shell
e recuperação pelo coordenador instalado, imports tardios conservando código
anterior e rollback com histórico anterior/posterior. O terminal instalado
`navi --list` funcionou nas duas contas; uma decisão administrativa posterior e a
chave da família permaneceram após restaurar o código. Não houve inferência.

A execução inicial encontrou uma falha real: `transport.serve` referenciava
`KidOSCore` definido apenas em `TYPE_CHECKING`. A correção importa a classe ao
iniciar o serviço e mantém o cliente IPC leve. Nova regressão exercita entrada,
socket/dispatch e encerramento. A suíte KidOS passou em **841 testes**, dois
legados ignorados, em 29,04 s. Ensaios falhos foram preservados; permissões do
tmpfs e readline/ffi do Python do laboratório foram corrigidos sem relaxar o produto.

Referência KidOS: `docs/MACHINE_UPDATE_QUALIFICATION.md`. Evidência local:
`build/machine-qualification/attempt-6/evidence/report.json`, SHA-256
`99151629049372a3817711af04fa49f7fe9a685d66554dbece40576f230c3911`.
Manifesto dos 513 arquivos de entrada:
`d05b4f8f27430aebbfb97e52fb24fca204be7cc333a0e3286a71ccbd611a1c77`.
Python 3.12.14, Linux x86_64 emulado no Mac ARM64; motor/SDK assinados 1.0.2
permanecem em commit `0d5030bfe244c1bbfd33f3b24eb8037bd4ba012a`.
Este teste não certifica os grafos de produção novos, workers habilitados, uma
migração de schema de motor, a sessão GTK ou o desempenho de hardware.

A próxima prova de distribuição exige managers/Ubuntu/systemd reais, login/logout,
composição Root/workers/serviço/Navi, pacote de release exato e integração revisada.
Não habilita Navi v2 ou amplia permissões. Toda a entrega confirmada de quatro
engines, assets, três clientes instalados, seis jogos, pedidos inéditos e aceite
físico/humano permanece obrigatória. O plano integral segue ativo.


### Admissão de validações e contador Root compartilhado — 2026-11-11

O serviço comum agora admite validações externas antes de esperar recursos,
usando os mesmos jobs/estados de builds e mídia. Os hooks do coletor recebem
build/artefato fixados e leitura somente de seus arquivos. O journal registra
`pending` antes do efeito e `reserved` depois da confirmação. Recusa conhecida,
cancelamento e confirmação perdida conservam estados distintos; reinício não
readmite nem abre navegador. Somente o inspetor da operação original pode fechar
um efeito desconhecido, sem prova substituta do modelo/UI.

O adaptador assinado pode fornecer `gameValidationCollectors` somente Core/KidOS,
com probe, reserva, cancelamento, validação e inspetor. O construtor também recusa
portas KidOS sem admissão. O kit/manifesto do motor declaram validações ABI 1;
é capacidade de integração do serviço, não disponibilidade de browser/worker Core.
Coletores workspace existentes conservam sua operação, sem novos privilégios.

A autoridade KidOS reconhece `production_kind: validate` com projeto e fila
obrigatórios. Builds, mídia e validações compartilham `requests_per_block`, além
da reserva diária por UID. Snapshots mostram as três contagens, inclusive zero;
não são tokens de modelo nem aprovação de qualidade. Cancelamento/replay,
reinício, dia novo e mudança de etapa preservam débito/etapa originais. Projetos
antigos de inferência continuam sem pedidos de produção automáticos.

O contrato da política aceita listas legadas e `validate`, recusando tipos
estranhos. Novos catálogos declaram `budgetPolicyABI: 2` e exigem motor/kit ABI 1
de validações. Builder/factory/instalador conferem o vínculo declarado; catálogo
histórico válido continua verificável para rollback com seu sistema correspondente,
sem reclassificá-lo como leitor da política nova. Não atualizar componentes avulsos
ou aceitar fallback por incompatibilidade de composição.

Passaram tipos/build, build headless de desenvolvimento, **499 testes Companion,
30 verificações do repositório e 858 testes KidOS**, dois legados ignorados.
O smoke Chat Completions local usou somente leitura e um provedor simulado.
O kit empacotado contém o mesmo ABI do manifesto. A porta web passou em 25 cenários
simulados, mais as guardas de negociação executadas antes deles; o primeiro comando
dessa checagem usou catálogo incorreto e foi corrigido, com falha preservada.

As provas novas cobrem contexto fixado, recusa, cancelamento desconhecido sem
coletar, perda de confirmação/reinício sem readmissão, relatório inconclusivo,
assinatura/produto e composição incompatível. Dez casos da autoridade usam SQLite
real temporário e UID passado pelo teste, incluindo concorrência entre três tipos,
cancelamento/replay/reinício, projeto/etapa/dia e concessão legada. Não são aceite
de kernel/Root instalado nem validação de jogo real.

Referências: [admissão de validações](GAME_VALIDATION_ADMISSION.md) e, no KidOS,
`docs/PROTECTED_VALIDATION_BUDGET.md`. Logs/hashes locais:
`output/validation-admission/attempt-1/` no Companion e
`build/validation-admission/attempt-1/` no KidOS. Não houve instalação, release ou
inferência real. Permanecem request/recibo de coleta, worker/browser Core isolados,
porta assinada executável e composição SDK/Core/Root antes de integrar workflow,
habilitar Navi v2 ou cortar legado. O plano integral de quatro engines, assets,
três clientes instalados, seis jogos, pedidos inéditos e aceite físico/humano
segue ativo.


## Candidato fixo e verificador de validação — 2026-11-11

O [candidato Core de navegador](GAME_BROWSER_CORE_CANDIDATE.md) acrescenta o
contrato privado, worker de um job, pin da árvore browser inteira, commits sem
sobrescrever e verificador KidOS. Reutiliza o coletor atual; não cria executor de
IA. Browser real no Mac ARM64 produziu canvas/PNG, encerrou e teve o candidato
conferido duas vezes pelo Python KidOS; bytes alterados foram rejeitados.

Regressão: **506 testes Companion passaram, um opt-in ignorado, 30 verificações
de repositório; 896 KidOS passaram, dois ignorados**. O ensaio explícito real passou
nos oito testes. Tipos, build da extensão, motor headless e smoke Chat Completions
de leitura com provedor simulado passaram. Evidência local e hashes ficam em
`output/core-browser-candidate/attempt-3/` e, no KidOS,
`build/browser-candidate/attempt-3/`. O primeiro registro de evidência falhou pela
ausência da pasta-pai; log preservado, tentativas posteriores separadas.

O comando de isolamento e seus limites têm testes de estrutura, não qualificação
Linux real. Continuam faltando broker/porta Core executáveis, confirmação de
unidade/cgroup, provisão/rollback do browser, composição SDK/Core/Root e aceite
instalado. Não houve instalação, release, habilitação de Navi v2 ou confirmação
de licença Unity; o controle do Mac ainda informou sessão bloqueada. O objetivo
integral e seus quatro adaptadores, assets, três clientes, seis jogos, pedidos
inéditos e aceite físico/humano permanecem abertos.


## Broker Core e protocolo de validação — 2026-11-11

O [broker/protocolo](GAME_CORE_VALIDATION_PROTOCOL.md) agora existe em fonte: usa
o diário/lock de builds e mídia, admissão Root `validate` antes da fila, claim
único, inspeção/cancelamento da unidade original, permissão/auditoria e bloqueio
de atualização. Request vincula projeto/build/arquivos/suíte/toolchain. A árvore
browser também precisa declarar plataforma Linux compatível com o Node.

Relatórios do worker são conservados como bytes originais e transferidos por
blocos, sem ampliar a resposta Core de 1 MiB. Um relatório de **1.216.936 bytes**
foi reconstituído em cinco blocos pelo kit empacotado; outro teste atravessou o
socket Core real. O relatório não é aceite de gameplay. O primeiro teste de
integração revelou retorno incorreto dos bytes do último blob no lugar dos bytes
do relatório; corrigido e coberto por transferência grande/retomada. Falhas e
correções permanecem em logs separados.

Passaram **509 testes Companion**, um opt-in ignorado, 30 verificações do
repositório; **918 KidOS**, dois ignorados. Vinte cenários novos do broker usam
Root/SQLite reais em fixture, mas UID de autoridade e process manager são
fornecidos pelo teste. Schemas Python/kit e browser Mac real→verificador também
passaram; o ensaio explícito teve oito testes. Tipos, builds e smoke de leitura
Chat Completions com provedor simulado passaram. Evidência/hashes locais:
`output/core-validation-broker/attempt-1/` e, no KidOS,
`build/validation-broker/attempt-1/`.

Ainda faltam a porta de coletor assinada, composição serviço/SDK/Core/Root,
qualificação nativa do isolamento/cgroup, instalador/rollback do browser e aceite
Navi instalado. Sem instalação, release ou remoção das guardas v2. Unity segue
sem confirmação de licença; o controle continua sem acesso à sessão do Mac. O
plano integral não foi reduzido: quatro engines, assets, três clientes, seis jogos,
pedidos inéditos e aceite físico/humano continuam obrigatórios.


## Porta/factory de validação opt-in — 2026-11-11

A [porta protegida](GAME_CORE_VALIDATION_PORT.md) agora liga a factory KidOS ao
protocolo: identidade por UID/namespace/job, build fixado, admissão anterior à
fila, start único e inspeção sem reexecutar. Confere cabeçalho, relatório original
e mapa exato de bytes por observação; não chama browser ou ferramentas do host.
O kit/manifesto negociam ABI de porta 1 além do ABI de admissão. O builder fixa
o manifesto browser da mesma plataforma Linux e preserva ferramentas/grupos.

Passaram 28 casos simulados da porta, 14 de mídia e 25 de build. A factory real
e módulos gerados foram verificados por `loadSignedAdapter`, Ed25519 temporário
e pin/owner/ponte de fixture: uma coleta/admissão, recuperação e recusa de módulo
adulterado. A primeira tentativa recusou corretamente o carregador compilado
antigo; após compilar a fonte atual, passou. Log preservado, sem dispensar ABI.

Regressão: **934 KidOS**, dois ignorados; **509 Companion**, um opt-in ignorado,
30 verificações, tipos, builds e smoke de leitura com provedor simulado. Os 44
testes selecionados de catálogo/instalador passaram; um erro inicial de organização
do teste foi corrigido mantendo as verificações anteriores de ativação. Evidência:
`output/core-validation-port/attempt-1/` e `build/validation-port/attempt-1/`.

Não houve instalação ou release. O instalador recusa `gameValidation` até que
a composição inclua provisão/rollback do browser protegido. A próxima etapa deve
implementar isso e qualificar o conjunto serviço/SDK/porta/Core/Root/processos no
Linux, preservando guardas Navi v2 e o plano integral. Assinatura de fixture não
comprova autoridade instalada, inferência real, desempenho, Unity ou jogos finais.


## Distribuição assinada do browser e rollback — 2026-11-11

O instalador KidOS agora aceita validação somente com um quarto componente browser
assinado/pinado, dividido em partes de até 64 MiB. Mantém o limite de arquivo
recebido e o limite agregado da composição; remonta dados sob a versão imutável,
sem executar código recebido durante preparação. Confere partes e árvore derivada
novamente ao ativar/reusar. Executáveis são uma lista assinada; modos especiais,
links, caminhos conflitantes e substituição durante cópia são recusados.

O manifesto externo também entra na identidade da toolchain, com ABI privado de
componente 1 no motor/kit. A configuração administrativa e o CLI exigem esse pin;
não podem reduzir a identidade ao manifesto runtime. O apontamento browser entra
no journal de ativação/recuperação/rollback. Um rollback histórico sem esses
workers remove apontamentos novos; não reverte dados/cotas/chaves da autoridade.
Detalhes em `docs/PROTECTED_BROWSER_DISTRIBUTION.md` no KidOS.

Verificação desta etapa: tipos, build da extensão, motor independente e smoke
Chat Completions de leitura com provedor simulado passaram; 509 testes Companion,
um opt-in ignorado e 30 verificações do repositório passaram. Os 108 testes
selecionados de catálogo/componente/worker passaram; a regressão final KidOS
passou com **979 testes e dois ignorados**. Seus hashes estão em `output/browser-distribution/attempt-1/report.json`, com cópia
KidOS em `build/browser-distribution/attempt-1/`. Portas simuladas: 28 casos de
validação, 14 mídia, 25 build; factory assinada temporária passou. Logs de falhas
anteriores foram preservados: sockets recusados no ambiente restrito; fixture de
cópia corrigida; metadado setuid fornecido explicitamente quando o Mac o remove.

São componentes sintéticos e sistemas temporários, não navegador Linux/Root
instalado. Ainda faltam composição nativa serviço/SDK/porta/Core/Root/processos,
release e aceite Navi. Nenhuma instalação, publicação ou habilitação v2 ocorreu.
O controle do Mac continuou retornando sessão bloqueada após a confirmação do
usuário, portanto licença Unity segue não verificada. O plano integral continua
ativo: quatro adaptadores, assets, três clientes, seis jogos, pedidos inéditos e
aceite físico/humano permanecem obrigatórios.


## Browser nativo Linux e regressão da falha observada — 2026-11-11

O [CLI foi executado no Alien](GAME_BROWSER_LINUX_QUALIFICATION.md) com browser,
systemd/bubblewrap e Node reais. Oito cenários passaram: teclado/pixels, repetição
preservando bytes, canvas uniforme mantendo sua observação reprovada, input e
componente adulterados recusados, barreira de arquivos/ambiente/loopback e
cancelamento/timeout do navegador real. Todas as unidades confirmaram PIDs zero
e cgroup vazio. Limites foram lidos enquanto ativas, com timeout de teste de 8 s.

O Chrome de 269.778.136 bytes atravessou transferência em cinco partes e foi
remontado/reverificado pelos helpers reais do instalador. Assinatura efêmera,
runtime do UID e pasta temporária são limites explícitos: nenhuma instalação,
chave de publicação, modelo ou dado pessoal foi usado. A tentativa 3 mostrou
corretamente o canvas uniforme como falho; a 4 passou sete cenários; a 5 manteve
a falha na regressão e passou oito. Tentativas e falhas de preparação anteriores
foram preservadas. Não houve alteração de critério para promover o canvas.

Evidência: `output/native-browser/attempt-5/`; árvore completa KidOS em
`build/native-browser/attempt-5/`. Relatório SHA-256:
`152360902b98d7c9b9c3c9878b3bf8b91a2ab2b46565a133d83b2cbd199ae487`.
Regressão geral passou com 986 KidOS/dois ignorados, 509 Companion/um opt-in
ignorado e 30 verificações. Depois das correções finais da fixture passaram
novamente sete guardas, tipos/build e o ensaio nativo. O relatório diferencia
essas revisões; o runtime do produto permaneceu igual nesta etapa.

Próximo aceite: composição única serviço/SDK/porta assinada/Core/autoridade Root/
processos reais, seguida de distribuição/instalação e Navi. As provas separadas
não certificam esse conjunto. O plano integral segue ativo, incluindo quatro
adaptadores, assets, três clientes, seis jogos, pedidos inéditos e aceite físico/
humano; licença/build Unity continuam pendentes.


## Validação SDK/serviço/porta/Core/Root — 2026-11-11

A composição de inferência/produção agora passou em **18 cenários** com validação
pelo SDK, serviço, porta Ed25519 de fixture, Core oficial e banco Root. Os três
novos cenários verificam cota compartilhada esgotada, admissão anterior à fila/
cancelamento sem devolução de débito e SIGKILL/reconciliação sem repetir coleta.
A auditoria confirmou uma única operação `game_validation.start`; o total final
permaneceu em 11 admissões de produção e zero inferências pendentes. Relatório
e JSON de evidência atravessaram schemas/hashes/blocos reais. Qualidade segue
false e a observação unverified: o browser/process manager desse conjunto é
simulado explicitamente. Não reutiliza capturas da prova nativa como resultado.

Passaram 986 testes KidOS/dois ignorados, 509 Companion/um opt-in ignorado,
30 verificações, 36 testes direcionados, tipos/build. Relatório SHA-256
`d43c8814a219f7cf1b3d03f08dc8815b57b37bf55f23ac3ea86bc98302a42ba9`;
manifesto de 549 arquivos com 1.672 inputs Companion fixados. Evidência KidOS em
`build/inference-composition/attempt-22-validation/`; cópia Companion em
`output/core-validation-composition/attempt-22/`.

A referência completa é `docs/PROTECTED_VALIDATION_COMPOSITION.md` no KidOS.
O teste nativo do browser segue separado: ainda falta combinar essas fronteiras
com provisão Root e processos reais no Alien. A autenticação sudo nova não está
disponível; nenhuma execução administrativa/instalação foi feita nesta etapa.
Os helpers descartáveis não tiveram suas guardas removidas. O plano integral
permanece ativo, com quatro adaptadores, assets, três clientes, seis jogos,
pedidos inéditos, distribuição/rollback e aceite físico/humano pendentes.


## Pacote da composição nativa Root preparado — 2026-11-11

Foi preparado o próximo ensaio real, sem backend simulado: SDK/serviço, Core,
autoridade, compilador, browser e unidades nativas. O bootstrap confere código
Root antes de importar, remonta partes do browser, verifica Node/SQLite e abre
namespace privado de mounts. O cliente faz builds, pixels/teclado, fila/cota,
SIGKILL e reconciliação. Guards estritos recusam namespace normal/ambíguo e
entrada alterada. A senha sudo nova é necessária para a execução no Alien; o
operador recebeu o launcher concreto após as verificações locais.

Estado: **prepared-not-executed**. A consulta SSH encontrou a tentativa ainda
não iniciada, sem handle de execução. Pasta KidOS: `build/native-root-validation/attempt-4/`,
com REVIEW, hashes e `.command`. Referência: `docs/NATIVE_ROOT_VALIDATION_PREPARATION.md`
no KidOS. Arquivo SHA-256 `ca1fc90aff7343457936e51779a8aa0e09999ba566e8d81d84b46f1974fcaf39`;
677 arquivos e 1.645 inputs Companion fixados. Nenhuma seleção instalada, release
ou perfil foi alterado. Não há aceite nativo Root novo para anunciar.

Passaram 18 guardas finais, 510 Companion/um opt-in ignorado, 30 verificações,
tipos/build. KidOS: 1.002 passaram/dois ignorados na regressão anterior aos dois
casos finais do launcher, cobertos depois nas 18 guardas. Uma falha de tipagem
do MIME da fixture foi corrigida antes do pacote atual; o builder agora verifica
a tipagem dos testes antes de criar saída. O plano integral continua ativo, com
quatro adaptadores, assets, três interfaces, seis jogos, pedidos inéditos,
distribuição/rollback e aceite físico/humano.

## Segunda referência autoral: Farol/Godot — 2026-11-11

`examples/games/farol` contém puzzle original com dezesseis ilhas em quatro
capítulos. Espelhos, lentes, divisores, peças fixas e rochas compõem as regras;
há teclado/toque, mapa, estrelas opcionais, undo, reinício, dica sem aplicação
automática, pausa, áudio/movimento configuráveis e save versionado. Arte vetorial,
ícone/imagem de abertura e síntese sonora são locais, com origem declarada.
O desenho é conteúdo de referência: não foi produzido por um pedido autônomo
ao motor e não concede autoridade ao módulo Game Design.

O qualificador `npm run qualify:game-farol` usa SDK/TLS/serviço/Node empacotados e
o adaptador Godot isolado. Importa fonte/design, compila/exporta, observa cinco
relatórios Chromium, reinicia o serviço, confere projeto e exporta fonte editável.
Depois percorre a campanha pelas ações normais do jogo, capturando os resultados
visíveis das dezesseis ilhas e o mapa 48/48. Soluções ficam apenas no qualificador;
nenhum QA, debug bridge ou endpoint de conclusão é enviado ao jogo.

Passaram os testes GDScript de rotas/undo/dicas nas 16 ilhas e os quinze saves
inválidos preservados, round-trip, melhores resultados e desbloqueio sequencial.
A retomada web foi observada separadamente no browser. Capturas de desktop,
retrato e paisagem larga foram revisadas; corrigiram glifos de estrela ausentes,
layout largo e abertura padrão. O exportador usa a imagem de boot, separada do
ícone do projeto; a fonte exportada compara dimensões, alpha exato e diferença
visível máxima de um nível em 255, sem comparar RGB invisível como conteúdo.
Referência: [shell web oficial Godot](https://docs.godotengine.org/en/stable/tutorials/platform/web/customizing_html5_shell.html).

Evidência final: `output/playwright/farol/runs/2026-11-11T08-16-24-396Z-fcecdbd3/`,
incluindo `verification/report.json`, logs, build, fonte, relatórios e capturas.
SHA-256 da fonte `fbef6eea0eb20fd451c050e77852e606c07c9acf1ae62cc7db301eb2b6ae25a5`;
artefato `e9d9144eb57a4f38aa5f3278c3334955d9e51553495e0121c944bfb7d0e49069`;
evidência `925368a652a0d142741c402d233beec0c2a298adb7369d03c4c5ac2a484d558a`.
Tentativas anteriores permanecem, inclusive roteiro inicialmente inválido,
glifos/layout anteriores e comparação de RGB transparente que foi corrigida.
O aviso opcional `libfontconfig.so.1` do editor headless foi preservado nos logs;
o coletor final não encontrou erros de página/console/recursos bloqueados.

A regressão Companion passou: 510 testes, um opt-in ignorado, 30 verificações,
tipagem e build. Os testes de engine cobrem o mesmo manifesto empacotado; os
GDScripts e o qualificador cobrem a revisão final do jogo. `quality.ready` segue
falso: faltam arte/áudio e desempenho físicos, entradas/tamanhos de toque reais,
outros dispositivos/browsers, dez jogadores, geração pelo motor e pedidos inéditos.
Os outros quatro jogos e o restante do plano integral continuam obrigatórios.

Nenhuma instalação ou release foi feita. A consulta SSH da tentativa nativa Root
preparada retornou novamente `NATIVE_ROOT_NOT_STARTED`. O acesso visual ao Unity
Hub ainda retornou Mac bloqueado, mesmo após o aviso de desbloqueio; a licença
continua não verificada, e nenhuma capacidade Unity foi habilitada.

## Produção real: intenção, validação e calibração — 2026-11-11

Foi criado um [ensaio explícito com Ollama real](GAME_GENERATION_EVALUATION.md),
por SDK/serviço/Node empacotados, sem fornecer fonte ou design de exemplos.
O corpus fixa cinco solicitações antes da primeira invocação. Perfil/estado são
temporários, sem ferramentas do host. Confirmações de desenvolvimento se limitam
a contratos/projeto/revisão/engine exatos, build, browser e mídia local; não
renovam orçamento ou alteram autoridades. Arquivos pessoais não entram no teste.

O primeiro `windmail` terminou sem projeto: o classificador marcou `uncertain`
porque o modelo alegou não poder executar. A intenção era clara. O middleware
comum agora recebe nomes de ferramentas do executor e separa intenção de
viabilidade. Mac e VS Code passam esse inventário; a incerteza real, o modo
Plano e o gate de qualidade continuam ativos. Não houve detecção por palavra ou
reescrita do objetivo para aceitar uma entrega menor.

O segundo ensaio com o mesmo pedido/corpus/modelo classificou `game_delivery` e
consultou `game_studio`, mas seis chamadas de criação observadas foram rejeitadas
por tipos/campos inválidos. Não houve projeto ou build. O operador cancelou o
run pela API após esse diagnóstico concreto; `run.json` confirma `cancelled`.
Não foi reinício por timeout. O diagnóstico exportou somente erros de argumentos
revalidados, sem checkpoint, raciocínio ou credenciais. Tentativas:
`output/game-generation/windmail/2026-11-11T08-32-12-850Z-d8b7fe47/` e
`output/game-generation/windmail/2026-11-11T08-39-31-767Z-f3f4926a/`.

O segundo problema era o retorno de erro repetindo o documento inteiro antes de
informar os tipos inválidos. O novo middleware canônico devolve caminhos/tipos
limitados antes do handler, sem converter strings, remover campos ou chamar a
autoridade para uma mutação inválida. O evento `game.tool_rejected` e atividades
existentes apresentam a rejeição. Standard/Deep testaram rejeição seguida de
correção, sem recibo de execução da entrada inválida; o teste do retorno ao
próprio modelo confirma ausência de eco. Efeito desconhecido continua em
`awaiting_reconciliation`, com uma única tentativa.

Passaram 517 testes, um opt-in ignorado, 30 verificações, 28 testes direcionados,
tipagem, build e empacotamento. Os smokes de leitura Standard/Deep com Qwen 3.5
retornaram `MOTOR_OK`. O SDK de release em cache tinha versão incompatível e foi
corretamente recusado; usou-se um SDK temporário da fonte correspondente, sem
alterar o antigo ou enfraquecer o verificador. Motor de desenvolvimento final:
SHA-256 `e11d6512c080d99784a4c4950b9f1436511dc33fe541b04632e21dedaeb4e991`.

Terceira tentativa: `output/game-generation/windmail/2026-11-11T09-09-23-960Z-ba6d4210/`.
Estado final: **cancelled; nenhum projeto/build**. Ela fixou previamente quatro
rejeições antes de despacho, mantendo o pedido e modelo. O limite foi atingido
e o cancelamento pela API foi confirmado em `run.json`, encerrando o observador
e seu serviço. Os quatro diagnósticos canônicos ficaram visíveis/limitados, mas
o modelo não conseguiu criar o documento válido. A inspeção autenticada anterior
do PID 47603 era uma fotografia viva, agora superada pelo resultado terminal;
não retomar essa tentativa cancelada nem confundir esse PID com serviço atual.
Não houve reinício por timeout. O inspetor não despacha nem aprova ferramentas.

As primeiras duas tentativas não persistiam o token do observador; esse limite
do harness foi corrigido antes da terceira, somente no bootstrap privado. O
inspetor foi testado com TLS/serviço reais e executor simulado: leitura preserva
o run ativo e recusa credencial exposta/identidade ou pasta alteradas. Nenhum
token ou banco privado foi exportado. Isso não comprova instalação ou geração.

O resultado ainda não demonstra um jogo novo completo, generalização ou aceite
de qualidade. O plano integral continua ativo, incluindo quatro engines, assets,
três interfaces, integração protegida KidOS, seis jogos e testes físicos/humanos,
distribuição, migração e rollback. Nenhuma instalação ou release foi realizada.

### Contrato de entrada e quinta tentativa — 2026-11-11

A quarta tentativa escolheu explicitamente `qwen3-coder:30b`, já instalado:
`output/game-generation/windmail/2026-11-11T09-23-31-052Z-2f450af9/`.
Foi cancelada pelo limite declarado de quatro rejeições, sem projeto/build.
O modelo corrigiu o conteúdo, mas alternou a versão entre documento e design,
deixando uma das constantes ausente. O diagnóstico preserva apenas esses campos;
não exporta checkpoint ou raciocínio. O pedido/corpus não foi simplificado.

O catálogo agora publica JSON Schema de entrada, sem tornar defaults obrigatórios.
`game_create`/`game_update_design` preenchem só constantes internas omitidas com
o número 2. Os construtores canônicos compartilham conteúdo e refinamentos;
arquivo/API públicos continuam exigindo versões explícitas. Valores incorretos,
documentos como strings, jogadores/referências inválidos continuam rejeitados.
O primeiro uso de `safeExtend` foi recusado pela tipagem por ampliar a entrada;
o log negativo foi preservado, e a solução compartilha construtores sem cast,
duplicação das regras ou remoção dos refinamentos.

Passaram **519 testes, um opt-in ignorado, 30 verificações e 19 direcionados**,
tipagem, build e empacotamento. Standard/Deep retornaram `MOTOR_OK` com o modelo
explicitamente selecionado. Motor de desenvolvimento:
SHA-256 `03f1a0c1bb645922dd07722e6b98dbf039c9a01c621aaa1b46380eb913071c1b`.

A quinta tentativa original terminou **cancelled, sem projeto/build**, em
`output/game-generation/windmail/2026-11-11T09-42-52-300Z-a77475db/`, com o mesmo
pedido/corpus/Qwen Coder/limite quatro. A cópia privada do motor é verificada
antes do processo, impedindo substituição por builds posteriores. O cancelamento
por API foi confirmado; as inspeções vivas anteriores foram superadas pelo
resultado terminal. Não reiniciar essa tentativa cancelada. Uma rejeição apontou
o tipo da câmera e as três seguintes a incompatibilidade de campanha/pontuação;
nenhuma voltou a falhar por constante de versão. `verification/report.json` fixa
fontes, logs e hash do resultado terminal, mantendo o resultado negativo.

O diagnóstico canônico agora aponta `progression.completion.type` e o valor
literal obrigatório `ending` quando `structure` é `campaign`. O catálogo também
explica estruturas para rodadas por pontuação. A regra e os tipos aceitos são os
mesmos; não inventar um fim de campanha para alterar o gênero solicitado.
Essa melhoria de retorno não comprova geração bem-sucedida. Instalação, licença
Unity, composição Root/Navi e aceite integral continuam pendentes.

A sexta tentativa usou o mesmo pedido/corpus/Qwen Coder/limite quatro, no motor
SHA-256 `4e0bd4f2ee42b00a33c76b2f2d6ffab442614af26e615c6b3b5417462f3f8ba2`:
`output/game-generation/windmail/2026-11-11T09-50-32-684Z-65e6233e/`.
**Cancelled, sem projeto/build**. Rejeições: documento como string, projectId
nulo e duas chamadas com encerramento de etapa como objeto em vez de texto.
O resultado não demonstra que a nova descrição resolveu a produção. A bateria
atual novamente passou 519 testes/um opt-in ignorado, 30 verificações, tipagem,
build, pacote e leituras Standard/Deep. A nova asserção de diagnóstico inicialmente
assumiu a ordem de erros; foi corrigida para localizar o campo, preservando
ambas as rejeições de etapas ausentes e conclusão incompatível. Os dois logs
e o resultado terminal permanecem em `verification/` da tentativa.

Uma comparação explícita com `gpt-oss:20b`, já instalado, terminou no Ollama
local, sem alterar configuração dos aplicativos, corpus, motor, runtime Standard,
limite quatro ou autoridades:
`output/game-generation/windmail/2026-11-11T09-55-17-607Z-4f6664cf/`.
Standard/Deep passaram primeiro pelo smoke de leitura com esse modelo. Resultado
terminal: **run completed, tarefa incomplete, sem projeto/build ou ferramentas**.
O grafo fez as duas correções de conclusão já previstas; o modelo continuou
produzindo texto e instruções. Não houve rejeição de argumentos ou cancelamento.
`run.json` e `verification/report.json` preservam essa diferença. A inspeção viva
de 10:00:58 UTC foi superada pelo resultado terminal; o observador 55016 encerrou
com código 1. O PID 65751 é histórico e não autoriza encerrar outro processo.

Modelos não são baixados e não há fallback de produção. Até esse resultado nenhum
dos ensaios de geração produziu um jogo; testes de transporte/diagnóstico não são
substitutos para esse aceite. O controle visual do Mac continuou retornando
bloqueio após a confirmação do usuário; a conferência da licença no Unity Hub
continua pendente, sem ativar o adaptador ou aceitar termos.

### Conhecimento no supervisor — 2026-11-11

A inspeção encontrou uma lacuna de exposição: o perfil passava só `routing` ao
supervisor. O guia completo já existia nos especialistas e em `game_studio`, mas
o modelo que não consultava essa ferramenta não o recebia. A nova orientação
dinâmica usa o middleware oficial e o contrato semântico já classificado; não
adiciona classificador, loop ou inferência. Tarefas `game_delivery` e
`game_project_change` recebem o guia completo. Execuções SDK sem contrato também
recebem a orientação; respostas/edições comuns com contrato não a recebem.
Nomes do guia não concedem ferramentas e edições limitadas não autorizam reescrita
integral. Catálogo, modo Plano, autoridades, evidências e limite de duas correções
de conclusão continuam iguais. Essa orientação foi qualificada em fonte;
não atribuir a ela geração ou instalação já demonstradas.

Os testes direcionados verificam dez combinações de runtime/contrato: guia uma
vez por chamada em Standard/Deep, ausência em respostas/edições comuns,
preservação do contexto do host, catálogo sem ferramentas extras e nenhuma nova
mensagem de usuário/sistema na conversa. A delegação Deep real do ensaio também
confere o guia único do especialista e a escrita negada. O primeiro teste revelou
que o middleware não via o contrato de outro middleware sem declarar esse campo;
foi adotado o mesmo `taskContractSchema`, sem cast de estado ou novo classificador.

A regressão expôs o eco artificial do modelo sintético das oito etapas: uma
resposta Deep chegou a 455.884 bytes, dobrando o contexto anterior. O diagnóstico
isolado preserva só tipos/tamanhos/nomes de ferramenta, sem conteúdo. O fixture
agora mantém respostas curtas, os mesmos tool calls, oito recibos e limites do
grafo. Não foi alterada a compactação, o gate ou o orçamento de produção para
obter aprovação. Os 40 testes direcionados, 520 testes/um opt-in ignorado,
30 verificações, tipagem, build, pacote e leituras Standard/Deep passaram.
Motor SHA-256 `6b70943d334bf9037b88d653005a6d74fbe6171cf19dbece657f92f0b4811483`.

Oitava tentativa:
`output/game-generation/windmail/2026-11-11T10-19-50-398Z-b7ed63b7/`.
O GPT-OSS consultou `game_studio` e tentou `game_create`, mas quatro documentos
inválidos foram recusados. Cancelamento confirmado, nenhum projeto/build.
Houve mudança de comportamento observada, sem produção demonstrada e sem inferir
causalidade geral de uma única amostra. Uma prova adicional Standard/Deep com
`ProviderModels` e HTTP simulado confirmou schemas, guia completo e instruções
do host na fronteira Chat Completions; não prova interpretação pelo provedor
real. Conteúdo system usa blocos de texto estruturados oficiais. A bateria dessa
prova passou 521 testes/um opt-in ignorado e 30 verificações. Sua fonte/logs
ficam em `verification/wire-contract/`, separados da tentativa original.

### Abrir projeto antes de preencher o design — 2026-11-11

O tool `game_create` agora aceita a abertura com `title`, `brief` no formato
declarado e `engine`. Só quando ausentes, design vira `null`, arquivos/assets
viram arrays vazios e a versão interna recebe 2. Não há inferência de conteúdo
ou metadados de arquivos. O resultado passa pelo schema canônico completo; tipos,
referências e qualidade continuam estritos. O schema público não foi alterado.
`game_update_design` continua exigindo o design completo. Rascunhos ficam na
etapa Design, com `design-missing`, e o avanço pela API é recusado.

Passaram **523 testes, um opt-in ignorado, 30 verificações e 36 direcionados**,
tipagem, build, empacotamento e leituras Standard/Deep com GPT-OSS. Foram conferidos
persistência canônica nos dois grafos, início idempotente com uma criação/recibo,
recusa de campos inválidos e referências a arquivo ausente, gate bloqueado e
defaults opcionais preservados no HTTP simulado. Motor:
SHA-256 `daa71cf5968a848daa949a3b1a66b3e81d2ae18c9b63fc925e9d0c657ef34b78`.

A nona tentativa conservou pedido/corpus/GPT-OSS/Standard/limite quatro:
`output/game-generation/windmail/2026-11-11T10-35-43-218Z-820eac96/`.
**Terminou cancelled; primeiro projeto persistido, sem design/código/build.**
Projeto `195d81bd-38bf-48ed-8c6a-8e10578ff4af`, revisão 1, hash
`0c1414f3a14f1fdd551dc039b26c016bb92dca590743437273488e2dec41c4c8`.
Snapshot e exportação editável confirmam `design:null`, arquivos/assets vazios,
nenhum job e `quality.ready=false`, com `design-missing`/demais pendências.
A criação só ocorreu após três rejeições; a quarta foi o design inválido, quando
o limite declarado cancelou o run pela API. O observador 84308 terminou; a
inspeção posterior encontrou ENOENT, sem reiniciar serviço. Seu `source-only`
histórico descreve apenas os metadados; a partir da próxima tentativa o runner
registra `draft-only`/`design-only` e contagens explícitas, preservando o histórico.

O runner agora permite executor/planner/evaluator escolhidos explicitamente no
mesmo Ollama, com `roles` registrados e defaults anteriores preservados. Papéis
declarados não provam invocação; nenhuma configuração do produto é alterada.
Uma comparação Qwen Coder executor/GPT-OSS avaliador foi feita em novo namespace,
mantendo fonte do motor, pedido, corpus, runtime e limite:
`output/game-generation/windmail/2026-11-11T10-43-09-157Z-e9ccdfaa/`.
Estado terminal **cancelled, draft-only**, projeto
`1410c52d-7bf6-4bdc-8f35-d747b6318abe`, revisão 1, hash
`7c59f4de46d3e7dc6079930ec478dc6d0a86f5672d02fe22c5c7bebcb8171059`.
O executor criou o projeto após uma rejeição de documento como string, mas três
edições de design foram rejeitadas. Persistiram encerramentos de etapa como objeto
em vez de texto e conteúdo/playtests ausentes ou vazios. Snapshot/exportação
confirmam design nulo e zero arquivos/assets/jobs/builds; `quality.ready=false`.
Os relatos agora apresentam `documentState`, sem chamar esse estado de fonte
implementada. O observador 74677 encerrou com código 1. Não é continuação do
projeto cancelado anterior nem demonstração de geração completa.

O corte de quatro rejeições foi um orçamento de diagnóstico, não um critério do
produto ou do plano. Ele cancelou ambos os ensaios após a abertura do projeto,
antes de haver um design válido. A etapa seguinte priorizou correções de
schema mais informativas (inclusive a distinção entre encerramento da etapa e
do jogo) e uma tentativa de produção maior, com orçamento declarado
**antes** do início. Não mudar o limite de execução já ativa, apagar falhas,
converter objetos em texto, ignorar campos ou declarar qualidade por persistência.
Uma tentativa maior não é comparação controlada com as de quatro rejeições e
continuará sujeita aos limites/autoridades/gates do motor e ao aceite integral.
O plano integral, Unity, quatro engines, portfólio, clientes instalados, integração
protegida KidOS e aceite físico/humano continuam pendentes.

### Orientação de schema e produção mais longa — 2026-11-11

O retorno `GameToolInputRejection` pode incluir `hint` extraído só da descrição
do campo no schema instalado. Modelos recebem a diferença entre texto de
encerramento de etapa e objeto de conclusão global, formato do briefing,
catálogos não vazios e especificação de save. Tipos, limites e refinamentos
canônicos não mudaram; nenhuma entrada é convertida ou descartada. A busca
recusa metadados herdados, ambiguidade, referências e excesso de nós/alternativas;
o texto de até 160 caracteres preserva Unicode e não contém os valores enviados.

Passaram **525 testes, um opt-in ignorado, 30 verificações e 22 direcionados**,
tipagem, build, pacote e quatro leituras reais Standard/Deep com Qwen Coder e
GPT-OSS. O inspetor adicional passou seu teste de autenticação/limites após
ganhar contagens por snapshot. Fonte, logs e hashes estão na pasta de verificação
da tentativa abaixo. Motor:
SHA-256 `48811dc24a7d312a11fc8dc80ba058e566757b48541022460543201c95d2a783`.

A **11ª tentativa terminou `failed`**, com 12 rejeições declaradas antes de iniciar:
`output/game-generation/windmail/2026-11-11T11-03-38-792Z-f0805f4c/`.
Pedido/corpus e Qwen executor/GPT-OSS avaliador são mantidos; motor e orçamento
mudaram, logo não há comparação controlada com o grupo de quatro rejeições.
Não houve template, design ou arquivo de referência fornecido ao modelo.

A inspeção autenticada de **11:08:39 UTC** confirmou o projeto
`28adbd09-3675-40a6-a472-b6934261fbe0`, revisão 3, hash
`444490c2b07d2e60cf83e192bc8aefe8fc20a71304fd34be95369358ab83a017`:
design presente e um arquivo registrado, zero assets/jobs. É evidência do domínio
gravado pelo modelo, sem build, teste ou aceite naquela fotografia.

O resultado terminal substitui essa fotografia: run
`746d5835-f4e4-458c-91dc-0dbc61429ef5` falhou ao esperar os cabeçalhos do provedor.
O observador encerrou e preservou os dados; o handle 13709/PID 95874 são históricos,
sem autorização para terminar processos. O projeto chegou à revisão 8, hash
`185513ca835b552be324c7b655c2a69640993eda444cd0ed5f1d7882c8e088ff`, com design,
três arquivos e zero assets. Dois builds (revisões 5 e 6) falharam por arquivo
ausente; nenhum artefato ou observação de runtime foi produzido. Não houve
rejeição de schema nessa tentativa. `quality.ready=false`; a etapa avançou
somente de Design para Core. Fonte exportada, relatórios e falhas permanecem
guardados. Uma continuação deverá usar esse projeto/namespace, sem repetir
efeitos ou reiniciar o pedido como se fosse inédito.

Também foi guardada consulta manual de contexto do Ollama: Qwen em GPU integral,
contexto alocado 131.072, Mac com 64 GiB. Não houve mudança de contexto/modelos;
a fotografia não prova ausência de truncamento antigo ou desempenho do jogo.
O escopo integral permanece pendente: quatro adaptadores completos, assets,
clientes instalados, integração protegida KidOS, seis jogos, novos pedidos,
hardware/pessoas, distribuição, migração e rollback.

### Diagnóstico do arquivo ausente — 2026-11-11

A fonte agora identifica o caminho relativo canônico ausente e a revisão no erro
do adaptador. O primeiro build real precisava de `game.web.json`; o diagnóstico
anterior não dizia qual arquivo faltava. Caminhos inválidos, absolutos, longos ou
com caracteres de controle não são reproduzidos. Código/classe do erro, recibos e
reconciliação permanecem iguais; não há repetição automática de operação desconhecida.

O candidato `4752dce253f99503713de64526457e860033072b062184603dff2e7028ccd576`
passou 527 testes, um opt-in ignorado, 30 verificações, 17 direcionados, tipagem,
build/pacote e leitura real Standard/Deep com Qwen Coder. Evidência:
`output/game-generation/source-diagnostic-20261111-a1/report.json`.
A 11ª tentativa usou sua cópia congelada anterior `48811d…`, portanto não recebeu
esse diagnóstico. Alterar a fonte/build não substitui módulos de uma execução viva.

### Prazo da inferência e próximo ponto de retomada — 2026-11-11

A falha final da 11ª tentativa expôs a diferença entre o prazo do SDK (dez
minutos) e a espera padrão de cabeçalhos/inatividade do Undici (cinco minutos).
O factory comum agora fornece um transporte próprio com prazos correspondentes,
reutilização por deadline e fechamento dos pools. CA corporativa, rotas exatas,
cancelamento e prazos menores continuam aplicados. Não altera políticas do jogo,
budgets, aprovação, repetição de efeitos ou o caminho legado `OllamaModels`.
Leia a [política de transporte](MODEL_CAPABILITIES.md#prazo-do-transporte-comum-de-inferência).

Passaram **528 testes, um opt-in ignorado, 30 verificações e 18 direcionados**,
tipagem, build, engine e leituras reais Standard/Deep com Qwen Coder. Um teste
HTTP confere também cancelamento pela desconexão real, apesar do rótulo de erro
do SDK. O teste estático antigo de wiring foi atualizado para as duas chamadas
de transporte; não remove a obrigação de propagar o sinal. Os ensaios inicialmente
malsucedidos foram preservados nos logs, junto ao resultado final.

Candidato de desenvolvimento: SHA-256
`73118641461bc191fe6540a24cc2b187f775f52a6d519e2aa27488f18873a3a0`.
Fontes/logs/hashes em
`output/game-generation/provider-deadline-20261111-a1/report.json`.
Não houve instalação/publicação ou nova tentativa de geração nesta qualificação.
O próximo ensaio deve continuar o projeto/namespace da revisão 8, conferir os
estados anteriores pela API, preservar recibos/alocações e registrar separadamente
feedback e motor escolhidos; não contabilizá-lo como pedido inédito sem contexto.

Após outro aviso de desbloqueio, o controle visual voltou a informar Mac bloqueado
ao selecionar Unity Hub. A licença continua não verificada, sem confirmação de
ausência e sem ativar o adaptador. Isso não impede o desenvolvimento web comum.

### Continuação real no mesmo projeto — 2026-11-11

O driver agora permite retomar explicitamente uma tentativa terminal. O
verificador conserva credencial, sessão, namespace e projeto; recusa estado
pendente/desconhecido, PID vivo/reutilizado, endpoint existente, corpus diferente,
credencial exposta ou ferramentas de host. Após iniciar uma cópia imutável ao
lado da anterior, confere novamente pela API run/sessão, revisão/hash, link e jobs
antes de `runs.start`. Não reinscreve clientes, edita bancos ou reexecuta efeitos.
Os testes de retomada/inspeção/política passaram oito casos; a regressão daquele
conjunto passou 532 testes, um opt-in ignorado e 30 verificações, tipagem/build.

Foi iniciada uma **continuação**, não um pedido inédito:
`output/game-generation/windmail/2026-11-11T11-58-01-526Z-187b06af/`.
O baseline pela API confirmou a revisão 8 e suas alocações preservadas; motor
`7311864…`, mesma sessão `300873f5-790f-4864-b52b-9d5c218be6d7`, run novo
`f4099d33-9100-40e7-934d-0dc309493fe1`. Recebeu feedback explícito sobre a
continuação e a configuração ausente, sem código/template preparado.

A inspeção autenticada de **12:05:24 UTC** confirmou a revisão 9, hash
`1584b2cacbd2ad2ed4239447995f0fc8e02028190be2c7d0dd7157d13cd1be82`, com quatro
arquivos, incluindo `game.web.json` gravado pelo modelo, design presente e zero
assets. O primeiro novo build (da revisão 8) ficou `failed` e expôs o caminho
ausente corretamente; não substitui nem oculta os dois fracassos anteriores.
Não havia build concluído ou QA nessa fotografia. O handle **59950** continua
vivo na última observação; PID 22672 e bootstrap privado estão em `control.json`.
Preservar esse run original até resultado autoritativo; contagem de eventos sem
delta de texto não prova travamento. O registro de qualificação e a fotografia
estão em `verification/report.json`, sem credenciais/checkpoints exportados.

Na inspeção posterior de **12:07:03 UTC**, o build
`f3831d70-d134-4696-8522-1514309d8f14` terminou `completed` para a revisão 9 e
o hash acima, pelo adaptador Phaser fixado. É o primeiro build concluído desse
projeto. O run continuava ativo e ainda não havia job de validação; compilar
não demonstra que o jogo abre, tem controles corretos ou atende ao escopo.

### Orientação do formato de testes no catálogo — 2026-11-11

`GameValidationCollector`/capacidades agora têm `projectGuide` opcional, entregue
somente pelo processo instalado e limitado a 4.000 caracteres pelo serviço. O
coletor web publica a referência canônica de receitas, ações/limites, transições
de teclas e baseline de imagem. `game_studio` consegue explicar como produzir
testes registrados, sem criar outro executor, fornecer testes falsamente aprovados
ou modificar disponibilidade, produtos, admissão e aprovação. O formato de receita
continua estrito; JavaScript/URLs/comandos genéricos não são aceitos.

Passaram **534 testes, um opt-in ignorado, 30 verificações, 19 direcionados**,
tipagem, build e engine. O candidato separado tem SHA-256
`1ecdc2813ddf67fc73710f5fd43f1cb31804ce9a8a6c0e1d2c0bfe4eb0ead24c`;
fontes/logs em `output/game-generation/collector-guide-20261111-a1/`.
A leitura real desse candidato terminou com `MOTOR_OK` em Standard/Deep com
Qwen Coder; o handle 60677 encerrou com sucesso. O run de
produção usa sua cópia `7311864…` e não recebeu essa orientação nova durante a
execução. Nenhum desses registros comprova jogo completo, release, instalação,
Unity disponível ou aceite físico/humano. O escopo do plano permanece integral.

### Resultado da primeira continuação e retomada seguinte — 2026-11-11

O run `f4099d33-9100-40e7-934d-0dc309493fe1` terminou `completed`, com tarefa
`incomplete`. Revisão final 10, hash
`95d94a36614ab68728392f6bb705e3d663937bd1e65daf5c08e05f91b621141c`: cinco
arquivos, zero assets e qualidade integral falsa. O build concluído da revisão 9
é histórico; não contém o arquivo de testes acrescentado depois. A receita era
`{"tests":[]}`, incompatível com o contrato. Não foi iniciada coleta de runtime.

Os recibos distinguem duas tentativas: rejeição canônica do caminho `testSuite`
antes do despacho e, depois, uma confirmação recusada pelo **harness automático**
por usar o build inexistente `719e87a9-8f10-4d50-a7cf-417424e56921`. Não houve
pessoa recusando nem falha coletada do runtime. A descrição inicial tratou esse
ID como build antigo; a auditoria corrigiu o registro. O feedback já admitido na
retomada seguinte permanece original com errata em `verification/report.json`,
sem reescrever evidência. O handle 59950 encerrou; não é mais uma espera viva.

Uma segunda continuação usa a mesma identidade/sessão/projeto e o motor com guia
do coletor `1ecdc281…`:
`output/game-generation/windmail/2026-11-11T12-18-22-870Z-ca8c925c/`.
Run `5a551215-cb2e-4d1b-a538-954099295627`, PID 30718, handle **39740** então
vivo. A API de **12:38:43 UTC** mostrou revisão 13, hash
`51a53df95e038ba7bd33d9b14eee2942827cf215daedbf63938191e12dec2e69`, cinco
arquivos, código principal com 10.462 bytes e receita com 1.343 bytes, sem assets.
Os builds 12 e 13 terminaram `completed`; ainda sem job de validação naquela
fotografia. Fonte maior e compilação não demonstram controles, conteúdo ou arte.
Essa era uma fotografia intermediária; o resultado terminal está registrado abaixo.

Foi identificada uma lacuna de recuperação para a próxima correção: o modelo
tem `game_job(id)`, mas não descoberta paginada de jobs, embora a API/SDK a tenha.
O caminho de confirmação também deve diagnosticar build inexistente antes de
pedir aprovação, conservando a revalidação na execução e sem converter efeitos
desconhecidos em erros repetíveis. Essas mudanças foram implementadas e qualificadas
posteriormente, conforme a seção de descoberta de jobs abaixo.

### Revisão e aplicação de candidatos no Studio — 2026-11-11

Mac/VS Code compartilham agora, em desenvolvimento, catálogo de candidatos de
mídia concluídos, inspeção de origem/licença/arquivos, PNG/JPEG/WebP e WAV de até
4 MiB e aplicação explícita. O controlador/SDK mantém inteligência e codecs no
serviço. Inspecionar não aplica; confirmação nativa, modo de escrita, seleção,
revisão e fingerprints são revalidados. Troca de projeto remove a mídia, áudio
não toca sozinho e cliques de aplicação ficam indisponíveis durante pedidos.
Aplicar cria revisão, preserva placeholder herdado e não concede aceite/licença.

Passaram **535 testes, um opt-in ignorado, 30 verificações, quatro testes de
Studio**, tipagem, builds da extensão/Mac/motor e o ensaio visual dos dois
contextos em `output/playwright/game-studio/runs/2026-11-11T12-27-39-726Z-343f11c1/`.
Serviço/SDK/TLS e PNG/WAV reais; bridges Mac/editor emuladas. Foram verificados
recusa, revisão concorrente, conferência, aplicação, exportação dos bytes,
seleção e ausência de autoplay/overflow. Capturas clara e escura foram lidas.
Não é aceite dos aplicativos instalados ou audição/arte física.

Motor desse candidato: `8575b2cf216674a705f4454d0d2f8938a474c60b1a92ba7df2f2fb215763491a`.
A leitura Standard/Deep com GPT-OSS completou; a de Qwen excedeu os 180 segundos
do **observador** e permanece inconclusiva, sem atribuir uma causa ao provedor.
A comparação não substitui essa lacuna nem muda o modelo da produção ativa.
Fonte/logs/hashes: `output/game-generation/studio-candidates-20261111-a1/report.json`.
O run do jogo conserva seu motor congelado `1ecdc281…`; não recebeu o candidato
da UI durante a execução. Edição artística dirigida, receitas pela UI, outros
formatos/exportação de candidatos, instalação, KidOS, quatro engines completas,
portfólio, novos pedidos, dispositivos/pessoas e distribuição seguem pendentes.

### Descoberta de jobs e conferência antes da confirmação — 2026-11-11

`game_jobs` expõe a listagem paginada existente ao supervisor/especialistas de
leitura, inclusive Plano, com IDs reais, resumos limitados, fotografia de
revisão/hash e `matchesSource`. O serviço confere o alvo de validação antes de
pedir consentimento, sem sondar processo, reservar ou despachar; repete os mesmos
critérios na admissão real. Erros conhecidos de alvo não viram recusa humana,
rejeição canônica de schema ou repetição de efeito desconhecido. Replay de recibo
continua anterior à operação; isolamento e autoridade KidOS permanecem iguais.

Passaram **537 testes, um opt-in ignorado, 30 verificações e 40 direcionados**,
tipagem/build/motor e leitura real Qwen Coder Standard/Deep. Motor:
`a7676e632fe91781e14e96eb55fd2a81569b4b86f6c003dde17d90e1a0cc29a9`.
Fontes/logs, inclusive falhas iniciais de fixture, em
`output/game-generation/job-discovery-20261111-a1/report.json`.
Nenhuma instalação, publicação ou nova autoridade foi concedida.

O resultado terminal da segunda continuação substitui sua fotografia intermediária:
run `5a551215…` terminou `failed`, erro `terminated` de causa não comprovada.
Fonte final revisão **22**, hash
`ee12129997763208e1973b7d429a238a6b8bafc6fba72429a92d8dcd3940e855`,
14 arquivos e zero assets. Naquele encerramento só havia builds históricos
9/12/13, sem build22 ou coleta. O handle39740 encerrou; não é espera ativa.
Relatório/recibos/exportação de domínio foram preservados.

### Terceira continuação: build atual, teste ainda inválido — 2026-11-11

`output/game-generation/windmail/2026-11-11T13-16-09-385Z-c6ad46a2/` usa a mesma
identidade/sessão/projeto, Standard e o motor `a7676e…`, com feedback explícito
registrado, sem fonte/template preparado ou renovação de limites. O modelo usou
`game_jobs`, manteve a revisão22 e produziu o build atual
`d47e6246-1837-408e-b6f8-2cd8c978bc40`, confirmado `completed`.

O pedido do modelo para validar o build **real histórico da revisão13** foi
recusado pelo harness automático por não corresponder à fonte atual. Não era ID
inexistente, recusa humana ou falha da conferência de alvo. O run
`339c12a4-6562-4eac-9ce1-d18ec9f61d10` terminou `failed`: “The graph stopped
without a final assistant response.” Os deltas públicos não substituem uma
resposta final confirmada; a causa exige investigação, sem presumir travamento.

Depois, o observador do host pediu uma coleta independente do build22, conforme
sua política já declarada. O job `ae9f1d0e-f995-4c1c-80f9-278b4c3d5fb4` falhou
antes da coleta: espera acima de2000ms e comparação sem baseline anterior na
receita salva. Não houve relatório de runtime. Qualidade permanece falsa; o
operador não corrigiu o arquivo do modelo nem repetiu a coleta. Estado terminal,
hashes e atribuição agente/observador em `verification/report.json`. Esse caso
é calibração/recuperação, sem substituir pedidos inéditos, portfólio ou aceite.

A nova tentativa de selecionar Unity Hub após aviso de desbloqueio voltou a
retornar Mac bloqueado. Licença segue **não verificada**, não ausente; Unity
continua `prepared-unqualified`, sem ampliar isolamento ou aceitar termos.

### Exportação de candidatos antes da aplicação — 2026-11-11

O Game Studio Mac/VS Code agora exporta um candidato concluído sem aplicá-lo.
O comando fechado carrega projeto/job, sem destino do host ou manifesto enviado
pelo renderer. O controlador confere seleção e resultado do projeto; o host
escolhe uma pasta e o SDK recupera o resultado reconhecido. Todos os formatos,
receita, proveniência/licenças, placeholder, toolchain e hashes são preservados.
Arquivos são conferidos por tamanho/SHA-256 e publicados em diretório novo;
falhas removem apenas a preparação privada, sem sobrescrever dados existentes.
Não inicia processamento, revisão, importação de autoridade ou aceite de qualidade.

Passaram **538 testes, um opt-in ignorado, 30 verificações e 15 direcionados**,
tipagem, builds da extensão/Mac/motor e leitura real Qwen Coder Standard/Deep.
Motor `18679989c1b9e2980181c79325ddbcb5395d8d9f95a85b17993a033d7597bf34`.
Fontes/logs/hashes em `output/game-generation/candidate-export-20261111-a1/report.json`.
Teste SDK/TLS/worker real confere caminho portável de400 caracteres, WAV/JSON,
metadados completos, modo Plano, seleção forjada, cancelamento, download alterado,
caminho inválido e preservação do projeto/pastas. Não remove limites do preview.

O ensaio do renderer em
`output/playwright/game-studio/runs/2026-11-11T13-23-51-786Z-d008bc78/` verificou
os contextos Mac/editor, com bridges emuladas e serviço/navegador/codecs reais.
Cancelar não exporta; exportar mantém bytes/metadados e revisão, sem aprovação
de mutação. Capturas clara e escura foram lidas, com ações sem overflow.
O ensaio anterior terminou por timeout ao observar uma mensagem de concorrência;
sua causa exata não foi comprovada. O harness passou a conferir também o pedido
original e a rejeição do controlador, além da mensagem da UI e consulta em curso.
A falha e os arquivos anteriores foram preservados.

Esta fonte não foi instalada/publicada. Edição de receitas, arte dirigida,
prévias adicionais, composição nativa/instalada, Unity, KidOS, seis jogos,
pedidos inéditos, dispositivos/pessoas e distribuição continuam pendentes.
A terceira continuação do jogo utilizou sua cópia congelada `a7676e…`; não recebeu
as alterações de exportação durante a execução.

### Recuperação de identidade e conferência de receitas — 2026-11-11

A investigação da terceira continuação encontrou colisão de ID de resposta no
histórico do grafo. Inspeção SQLite somente de leitura e decodificador oficial
mostraram a mesma identidade AI na posição18 trocando15 chamadas de ferramentas
por texto, enquanto resultados posteriores permaneceram no fim. Só metadados
estruturais e hashes foram exportados, sem copiar/modificar checkpoints, mensagens,
raciocínio ou credenciais. O trecho HTTP real não foi gravado; não se atribui a
origem exata do ID ao provedor/SDK. Detalhes em
[identidade de mensagens](MODEL_MESSAGE_IDENTITY.md).

O middleware comum agora confere colisões antes do reducer oficial. IDs sem
colisão, conteúdo, chamadas de ferramenta e metadados permanecem preservados.
O ID novo é persistido com o turno e conservado no replay. Standard/Deep e
especialistas declarados usam a mesma fronteira; o perfil `general-purpose`
padrão utiliza a especificação pública da biblioteca com esse middleware, sem
novas ferramentas/backend/permissões. Não há extração de resposta antiga como
final, reparo de checkpoints históricos, replay de efeitos ou outro loop.

`game_check_tests` acrescenta leitura da receita salva da revisão/hash exatos,
com o schema canônico e teto de1 MiB do coletor. Confere JSON/UTF-8, ações/limites,
baselines, teclas e referências ao design. Até20 diagnósticos limitados mais
contagem omitida, sem ecoar chaves extras. Não altera arquivos, compila, coleta
ou concede qualidade. A orientação exige construir, aguardar o job real e só
então pedir a coleta correspondente; não paralelizar uma dependência ainda sem ID.
KidOS continua recusando o catálogo workspace e exige sua integração Core própria.

Passaram **544 testes, um opt-in ignorado, 30 verificações e 12 direcionados**,
tipagem, builds da extensão/Mac/motor e leitura real Qwen Coder Standard/Deep.
O teste HTTP simulado usa o SDK/SSE reais com ID repetido: preserva sequência,
metadados, resultado final, checkpoint e replay sem outra chamada/efeito, inclusive
nos subagentes padrão e explícito. O teste de receitas usa os grafos oficiais em
Plano, referências de revisão, namespace estrangeiro, JSON inválido, vazio,
limites, baseline, chave extra privada e diagnóstico limitado, sem job ou aprovação.
Falhas de preparação da fixture foram corrigidas sem alterar o contrato e ficaram
nos logs. Fonte/logs/hashes em
`output/game-generation/recipe-recovery-20261111-a1/report.json`.
Motor `bce238b83ef81f049903e8c28baf6ddd04a656fec952f83a7f8560d06f5b17e7`.
Sem instalação ou publicação; os requisitos integrais do plano permanecem abertos.

Uma quarta continuação foi admitida no mesmo estado privado:
`output/game-generation/windmail/2026-11-11T13-46-10-028Z-15d96c9d/`,
run `79c971d6-5cc6-4e2e-b91d-71deba0b70a6`, mesma sessão/projeto da revisão22,
motor congelado `bce238b8…`, Standard e rejeições12. Feedback explícito e baseline
API estão preservados; nenhum arquivo/receita pronto foi fornecido ao modelo.
A inspeção autenticada após a admissão confirmou o run `running`. O observador
original é o handle76650/PID80131; conservar até estado terminal autoritativo,
sem reinício por silêncio ou timeout. Conferir a fotografia e o resultado futuro
em `verification/report.json`; esta admissão ainda não demonstra correção do jogo.

### Ajustes dirigidos de composição de imagem — 2026-11-11

O Game Studio Mac/VS Code agora oferece controles para `image.compose` do worker
local: dimensões/fundo, posição/tamanho/opacidade/cor/espelhamento/escala e recorte
opcional de cada camada existente. O schema nomeado é o mesmo da operação do
processador. Fonte, ordem/quantidade das camadas, saída, alvo e processador são
preservados; não há caminho de host, receita executável, novo provedor ou codec
no renderer. Referências e fingerprints incluem bytes/proveniência atuais.
Modo, seleção e revisão são conferidos antes/depois da confirmação nativa.

Gerar uma variante é um job sujeito aos limites/fila já existentes, sem aplicar
ou alterar o jogo. O candidato anterior permanece intacto. A aplicação continua
separada e exige confirmação/revisão; placeholders e licenças não são promovidos.
O formulário conserva origem, revisão e ID/conteúdo do pedido após perda de
resposta. Campos ficam bloqueados e a retomada usa a mesma identidade; recusar
uma retomada não esquece um efeito anterior incerto. Diagnósticos prévios desta
invocação não provam ausência de efeitos de uma chamada antiga. Rascunhos visuais
entre fechamentos e consulta completa por ID de pedido continuam pendentes;
trabalhos já admitidos ficam preservados no serviço.

Passaram **545 testes, um opt-in ignorado, 30 verificações e seis direcionados**,
tipagem, builds da extensão/Mac/motor e o ensaio do renderer nos dois contextos.
O teste SDK/TLS/worker PNG real verifica pixels/dimensões, imutabilidade do
original, recusa/Plano, seleção/modo/revisão concorrentes, source fingerprint,
resposta perdida, recuperação sem outro job, conflito de conteúdo sob o mesmo ID,
aplicação explícita e origem/placeholder. A regressão inclui os testes simulados
do grafo/SDK, sem repetir inferência real durante a produção ativa.

Evidência visual:
`output/playwright/game-studio/runs/2026-11-11T14-07-46-830Z-7fb5b16f/`.
Serviço/SDK/worker/Chromium reais; bridges Mac/editor e confirmações emuladas.
Nos dois contextos, foram conferidos recusa, formulário preservado, resposta
perdida, recusa de retomada sem esquecer o efeito, mesmo ID/job na retomada,
variante32×32, aplicação na revisão5 e exportação dos bytes. Capturas clara e
escura foram lidas. Falhas anteriores do harness na contagem de página e direção
do cursor foram corrigidas, mantendo a exigência de exatamente um novo job.
Logs e capturas falhas permaneceram preservados.

Motor desta fonte:
`706618a7734f5749c7bd4a2cee7e3b0f7db5879a9145b94180d7b056dafb7467`.
Fontes/logs/hashes em
`output/game-generation/image-adjustment-20261111-a1/report.json`.
Não é aceite de aplicativo instalado, licença, arte final ou audição/dispositivo
físico. O ensaio real do jogo continua com o motor congelado `bce238b8…`, sem
receber essas alterações durante a execução. Na fotografia autenticada de
**14:10:02 UTC**, estava `running`, revisão23, hash
`422b1e8c9b24f1f653039a2ce2b8a5633d1409b3f48564420262b853cbe05045`,
14 arquivos, zero assets registrados e build23 concluído. Ainda sem nova coleta
nessa fotografia; observar handle76650/PID80131 até estado autoritativo terminal.

Geração de fontes artísticas originais consistentes por adaptador autorizado,
bibliotecas/licenças verificadas, atlas/áudio/modelos pela UI, composição KidOS,
Unity, instalação, seis jogos completos, pedidos inéditos e aceite físico/humano
permanecem requisitos do plano. Editar/compor um PNG existente não os substitui.

### Resultado terminal da quarta continuação — 2026-11-11

O observador original handle76650 terminou, sem reinício por silêncio. Run
`79c971d6-5cc6-4e2e-b91d-71deba0b70a6`: `completed`, tarefa `incomplete`.
Revisão23/hash `422b1e8c9b24f1f653039a2ce2b8a5633d1409b3f48564420262b853cbe05045`,
14 arquivos e zero assets registrados. O modelo corrigiu a receita/construiu,
mas encerrou sem executar a coleta. O observador coletou o build23 pelo job
`f1dc3c56-489e-4ed1-9121-1df1bd89081e`, que completou com **seis relatórios
falhos**: sem canvas renderizado, 84 erros de runtime/recursos e cinco cenários
reprovados. Imagens de vento e música/efeitos eram referenciados sem arquivos.
Não é um jogo completo nem uma produção validada.

A fotografia anterior foi preservada em `verification/pre-terminal-inspection-a3.json`;
`verification/report.json` foi atualizado a partir dos artefatos públicos
terminais. O relatório original mantém `built-not-observed` (a classificação
antiga significava ausência de coleta totalmente aprovada). O runner agora
separa falha/incompletude observada de ausência de coleta; os resultados antigos
não foram reescritos. Motor congelado `bce238b8…`, Standard e rejeições12
continuaram os mesmos. Nenhum arquivo de jogo foi corrigido pelo operador.

### Arte original vetorial e prévias reconhecidas — 2026-11-11

`image.vector` agora produz SVG original a partir de formas/curvas/gradientes
fechados, com receita `.vector.json` editável. Usa o mesmo worker, fila, revisão,
proveniência e candidato transacional de mídia; não acrescenta dependência,
provedor, executor ou código de projeto no processador. Não é rasterização PNG:
composição/atlas continuam exigindo PNG. A geração por modelos de imagem/áudio,
arte consistente em jogos completos e revisão de licenças continuam pendentes.

O Studio Mac/editor pré-visualiza somente SVG do resultado reconhecido do worker
local, com arquivo/hash e projeto/asset/job correspondentes. A imagem é carregada
por `<img>`, sem inserir XML na página. SVG importado, modificado ou copiado de
outro projeto fica preservado e exportável sem essa confiança. Aplicar segue
separado, com confirmação nativa e revisão. A receita é preservada, mas não há
editor visual de geometria; o formulário PNG não é oferecido a SVG. O contrato
Core fixo recusa a nova operação até qualificação própria: nenhum formato,
provisionamento ou perfil Navi foi ampliado por esta frente.

Passaram **550 testes, um opt-in ignorado, 30 verificações e 11 direcionados**,
tipagem, builds Mac/extensão/motor e roteamento Chat Completions simulado.
O motor final também respondeu `MOTOR_OK` em Standard e Deep com o Ollama
configurado, somente leitura. A primeira tentativa desse smoke foi recusada
corretamente pelo SDK antigo em `release/sdk`; o SDK atual foi construído em
pasta temporária, sem substituir artefatos publicados. Esse erro foi preservado.

Motor final: `588bf95bb6091ff6efb22d6e6b3e1d9f9ca70e9f3edee4a4603769fb36a79a4b`.
Arquivo de fontes/logs/hashes:
`output/game-generation/vector-art-20261111-a1/report.json`.
Ensaio do SVG pelo SDK/TLS/worker empacotado e coletor real:
`output/playwright/game-vector/runs/2026-11-11T14-40-06-424Z-be3f5549/`.
Duas fixtures autorais Phaser/Babylon, sem fonte fornecida ao modelo: candidato
sem modificar projeto, reinício antes da aplicação, idempotência, bytes/receita/
proveniência e cor/gradientes/movimento por teclado no navegador. A conferência
visual detectou a inversão de textura na fixture Babylon, corrigida no loader;
falha inicial de documento da fixture e capturas anteriores foram preservadas.

Ensaio do renderer compartilhado:
`output/playwright/game-studio/runs/2026-11-11T14-39-10-005Z-5f87ceeb/`.
Bridges Mac/editor e decisões emuladas; serviço, SDK, worker e Chromium reais.
Nos dois namespaces: SVG candidato256×256, formulário PNG ausente, projeto
inalterado antes da confirmação, aplicação na revisão 6 e inspeção da fonte
reconhecida. Capturas claras/escuras foram conferidas. Não é aceite nativo das
instalações, obra final, licença verificada, dispositivo físico ou playtest.
Os requisitos integrais do plano, inclusive Unity e seis jogos, permanecem.

Uma quinta continuação real foi admitida em
`output/game-generation/windmail/2026-11-11T14-41-57-869Z-2499e9ad/`.
A mudança Standard→Deep é explícita e registrada, no mesmo projeto, estado,
recibos e orçamento; não é um caso inédito nem nova evidência de generalização.
Mantém Qwen3-coder:30b, planner/evaluator GPT-OSS:20b, rejeições12 e autoridade
estreita de desenvolvimento. Feedback informa as falhas coletadas e as novas
capacidades, sem oferecer fontes, ilustrações ou receitas prontas. Observar o
handle21973/PID17088 e os recibos originais antes de qualquer reinício/continuação.

Fotografia autenticada da quinta continuação em **14:44:09 UTC**: run
`0e4cd4ed-fab1-46c2-99b1-e8198e4f25f4` ainda `running`, revisão23/hash acima,
14 arquivos e zero assets registrados. `verification/inspection-a1.json` e
`verification/report.json` conservam essa leitura; não é resultado terminal.
O controle do Unity Hub foi tentado novamente após o aviso de desbloqueio deste
turno e ainda retornou Mac bloqueado; a licença permanece **não verificada**.
Não houve aceitação de termos, ativação, adaptação Unity disponível ou instalação.

### Edição vetorial dirigida e disponibilidade Deep — 2026-11-11

O Studio passou a editar `image.vector` por campos tipados: dimensões/fundo,
retângulos/elipses/curvas M/L/Q/C/Z, preenchimento e gradientes lineares/radiais,
pontos de cor, contorno, alfa, transformações e ordem. Permite acrescentar,
duplicar e remover formas/pontos, com carregamento por partes e limites da
receita. O renderer manipula dados/DOM, sem produzir SVG, executar codecs ou
conter inteligência. Não é desenho direto no canvas ou prévia contínua dos
ajustes; essas funções continuam pendentes. A prévia é do candidato processado.

`adjust-vector` usa o schema canônico, preserva saída/alvo/processador e valida
modo, seleção e revisão antes/depois da confirmação nativa. Produz um job e
outro candidato, sem aplicação automática. Dados inválidos recebem recusa
conhecida antes do despacho; isso não liquida uma chamada anterior com resposta
perdida. O formulário mantém conteúdo/ID e campos bloqueados nesse caso, inclusive
se a retomada for recusada. O candidato original, placeholder e origem/licença
continuam preservados. A gravação exige aplicação explícita à revisão conferida.

A quinta continuação real Deep terminou **failed**, não em espera: run
`0e4cd4ed-fab1-46c2-99b1-e8198e4f25f4`, erro `The editor backend is not registered.`
Não mudou fonte, jobs ou relatórios; as seis reprovações do build23 são da
coleta anterior. O observador21973 terminou e sua fotografia foi arquivada antes
de atualizar `verification/report.json`. Não houve reinício por silêncio.

A correção está no backend comum do editor: ausência do método canônico produz
um resultado de erro V2 antes de chamar o host, mantendo o grafo e suas demais
ferramentas. `/workspace/` continua reservado, sem fallback para scratch/disco/
shell. O prompt informa o catálogo real. Registro parcial e Plano não ampliam
permissões; host registrado continua aguardando/reconectando e resultado
incerto continua interrompido para reconciliação. Ver
[disponibilidade do backend](WORKSPACE_BACKEND_AVAILABILITY.md).

Passaram **556 testes, um opt-in ignorado, 30 verificações e 23 direcionados**,
tipagem, builds Mac/extensão/motor, roteamento simulado e resposta real somente
de leitura `MOTOR_OK` em Standard/Deep com Qwen3-coder:30b no Ollama configurado.
Os testes usam o grafo/checkpointer oficiais: todos os métodos indisponíveis,
leitor delegado, canário real do disco intacto, scratch separado, leitura de
projeto de jogo após a recusa, registro parcial, Plano, reconciliação e espera/
reconexão com um recibo no serviço. Inferência e host desses testes são simulados.
Falhas iniciais dos modelos da fixture (interface incompleta e conteúdo
estruturado) foram corrigidas e mantidas nos logs, sem adaptar o produto a elas.

Ensaio final de UI:
`output/playwright/game-studio/runs/2026-11-11T15-15-08-177Z-dbfc2953/`.
Bridges/decisões Mac/editor emuladas; serviço, SDK, worker e Chromium reais.
Conferidos: geometria/gradientes/contorno/transformação, inclusão/remoção de
pontos e formas, reordenação, recusa, confirmação perdida, recusa de retomada
sem esquecer o efeito e mesmo ID/job ao retomar, exatamente uma variante,
imutabilidade do original, aplicação na revisão 6 e SVG320×256 reconhecido.
Capturas claras/escuras e viewports foram lidos; formulários expandidos não
excederam a largura do editor. Não é aceite das instalações ou da arte final.

Composição qualificada:
`e36ef019d401bb6e8808ba1129990b852157bd633d21c98dc3e646aaf2d9bd44`.
Fontes, logs, bundles do renderer e hashes:
`output/game-generation/vector-editor-backend-20261111-a1/report.json`.
Não houve dependência, provedor, instalação, release ou capacidade KidOS nova.
Unity, demais controles artísticos, comparação, seis jogos completos, pedidos
inéditos, dispositivos físicos, playtests e distribuição continuam no plano.

A sexta continuação foi admitida em
`output/game-generation/windmail/2026-11-11T15-18-25-812Z-d8d9a3a9/`,
run `fd297160-20ca-4f9c-a5b3-2dd49f69f939`, mesmo projeto/estado/orçamento,
Deep/Qwen3-coder:30b e GPT-OSS:20b nos papéis anteriores. Nenhuma fonte, figura
ou receita pronta foi fornecida. O observador original handle93943 terminou com saída 1. O run foi cancelado ao
atingir o limite previamente declarado de 12 rejeições canônicas de argumentos.
Revisão23 e zero assets mantidos, sem nova coleta. O resumo terminal está em
`verification/terminal-outcome.json`; os relatórios incluídos continuam sendo
os reprovados históricos da quarta continuação. A ausência do socket após o
encerramento não autoriza relançar efeitos ou descrever o jogo como aprovado.


## Biblioteca licenciada offline — 2026-11-11

[Contrato e limites](GAME_LICENSED_LIBRARIES.md). O novo pacote
`packages/adapter-game-library` integra seleção/cópia aos jobs e à aplicação
transacional existentes, sem outro agente, scheduler, download ou concessão de
permissão. SDKs TypeScript/Python e `game_libraries` usam a mesma rota autenticada;
`game_process_assets` recebe uma seleção exata do catálogo instalado.

Primeiro insumo real: Kenney Mini Arena1.0, commit
`a6927e66ff8dd8e173660ce4825abe773c65f683`. Somente arte/licença: 22 GLB,
textura e documento original, 558.803 bytes. Cada arquivo tem tamanho, Git blob
SHA-1 e SHA-256 conferidos. Modelos conservam a textura relativa, e o personagem
conserva 32 nomes/clips originais. Catálogo/manifestações e blobs são fixados;
`library.copy` preserva notices completos, autoria e citação, e produz candidato
sem modificar o projeto. Alterar seleção, omitir dependências, substituir blobs,
symlinks/hardlinks, colisões e metadados de sidecar são recusados. Origem e
licença continuam declaradas, não recebem aprovação jurídica/artística.

Qualificação: **562 testes passaram, um opt-in ignorado, 30 verificações do
repositório**. Seis testes novos cobrem catálogo/bytes/animações, declarações
forjadas, corrupção/links, reinício/aplicação/idempotência/namespace, conferência
independente das saídas e recusa Core. Typecheck, builds extensão/Mac/motor e
roteamento Chat Completions simulado passaram. O smoke real somente de leitura
com Qwen3-coder:30b retornou MOTOR_OK em Standard/Deep.

A fixture de navegador usa serviço e SDK reais, pacote fechado, reinício antes
de aplicar, candidato idempotente e build Babylon com loader offline. Capturas
mostram personagem/material original e movimento por teclado. A primeira espera
de animação falhou: o segundo cenário enviava a tecla antes do carregamento na
sua nova página. Falhas foram mantidas, e a fixture passou ao aguardar a mesma
carga inicial, sem reduzir os limiares de comparação. O último ensaio do artefato
atual está em
`output/playwright/game-library/runs/2026-11-11T15-54-35-675Z-d1412110/`.
A caminhada foi observada; os outros 31 clips têm preservação de bytes/metadados,
sem alegação de que todos foram reproduzidos ou aceitos artisticamente.

Motor qualificado nesta frente:
`56dc4834cce6edfc5b9c6d02188fa0e52b85c5d3dc194b9f77b9dd0b352b7575`.
Fontes, manifestos, logs e hashes:
`output/game-generation/licensed-library-20261111-a1/report.json`.
O build inclui os dados e notices legíveis no manifesto. Não houve nova release,
instalação, provedor ou capacidade KidOS: o worker Core recusa `library.copy`.
Não é aceite de interface instalada, humano, dispositivo físico ou jogo completo.

Naquela qualificação, o seletor visual ainda estava pendente; a integração
posterior é registrada na seção seguinte. Continuam no plano mais estilos e
formatos, produção original ampliada, revisão dirigida, adaptação Unity/Godot e
Core, cadeia completa de jogos, matriz física/humana e distribuição. O controle
visual ainda reportou Mac bloqueado após o aviso de desbloqueio; a licença
Unity continua não verificada, sem inferir que esteja ausente ou ampliar acesso.

## Bibliotecas nas interfaces e recuperação de pedido — 2026-11-11

[Contrato e qualificação](GAME_STUDIO_UI.md#qualificação-de-bibliotecas--2026-11-11).
A fonte Mac/VS Code ganhou busca paginada, detalhes de arquivos/créditos/licença,
nomes de animações e preparação de candidato pelo mesmo serviço. Nova confirmação
aplica o candidato; não há importação automática, inferência ou loop no renderer.
O catálogo admite filtro exato `entryId`; a UI não pode substituir arquivos ou
metadados da seleção instalada. Revisão, modo, seleção, conflitos e disponibilidade
são conferidos antes e depois do consentimento.

O pedido é preservado antes do despacho, com campos bloqueados após resposta
perdida. Recarga restaura os dados sem enviar; retomada usa o mesmo ID/conteúdo.
Recusa da retomada mantém o efeito anterior desconhecido. A licença original é
lida como texto integral com bytes conferidos, sem markup. O uso de
`getState`/`setState` no editor e `sessionStorage` na janela Mac não promete
restauração do rascunho após destruir painel/app; os jobs já admitidos continuam
no serviço. Foi removida a validação duplicada da ponte VS Code: o controlador
canônico mantém as recusas conhecidas distintas de erro de comunicação.

Passaram **563 testes, um opt-in ignorado, 30 verificações e 15 direcionados**,
tipagem, builds de extensão/Mac/motor, roteamento simulado e smoke real somente
de leitura Standard/Deep com Qwen3-coder:30b. Composição:
`557c49389fb5b7d06a378f33357203d1717f4b8a25ae8bca05c7120605e979cf`.
Relatório: `output/game-generation/library-studio-20261111-a1/report.json`.

Ensaios próprios:

- `output/playwright/game-library-studio/runs/2026-11-11T16-26-58-229Z-966742a2/`:
  bridges emuladas, serviço/SDK reais; paginação dos 22 recursos, leitura de
  licença, perda de resposta/recarga/recusa de retomada, exatamente um job,
  exportação, revisão explícita, modo/seleção e viewports 1200/740/400 sem overflow.
- `output/playwright/game-studio/native-mac/runs/2026-11-11T16-19-28-767Z/`:
  janela/preload/IPC reais, diálogos emulados; recuperação do mesmo job após
  recarga, licença lida, aplicação revisão3 e serviço preservado ao fechar a UI.
- `output/playwright/game-studio/native-vscode/runs/2026-11-11T16-28-20-880Z/`:
  VS Code/classes/webview reais, perfil/conexão temporários e diálogos do editor;
  **Reload Webviews** com estado recuperado, mesmo job, licença visível, aplicação
  revisão4 e encerramento confirmado dos processos próprios da fixture.
- `output/playwright/game-studio/runs/2026-11-11T16-27-12-106Z-f09a9204/`:
  regressão geral dos demais controles, com bridges emuladas.
- `output/playwright/game-library/runs/2026-11-11T16-27-59-404Z-740386fe/`:
  cópia/recuperação/build Babylon, textura e caminhada reais pela composição atual.

Capturas foram lidas; os fracassos de observação/fixture anteriores permanecem
nos seus diretórios, sem reutilizá-los como passes ou diminuir critérios. Não
houve instalação, release, provedor ou capacidade KidOS nova. Não é portfólio
completo, geração autônoma, aceite físico/humano ou garantia da licença Unity.
Continuam no escopo integral: rascunhos duráveis do host, edição artística/viewport
3D, originais/bibliotecas adicionais, quatro adaptadores, Core/Navi instalado,
seis jogos, pedidos inéditos, matriz física/humana, distribuição e rollback.

## Contexto persistente de jogo e contratos de formato — 2026-11-11

A [avaliação real](GAME_GENERATION_EVALUATION.md#formatos-e-referência-persistente-na-classificação--2026-11-11)
conserva a sétima continuação, encerrada incompleta antes de ferramentas por
falta de contexto no classificador. O serviço agora fornece à interpretação
semântica a referência mínima do jogo vinculado à sessão autenticada. Não
transfere título/código ou autoridade, não aceita contexto de cliente e não
força `game_delivery`. Mac/VS Code compartilham o middleware, mantendo Plano,
ambiguidade, qualidade independente e separação de namespace/produto/perfil.

Também foram esclarecidos os formatos de cores RGBA, controles de curva e
proveniência obrigatória, a substituição explícita do catálogo de assets e o
canvas fornecido pelo compilador web. Schemas permanecem estritos; o produto
não corrige argumentos por coerção, transforma formatos ou inventa arquivos.

**569 testes, um opt-in ignorado, 30 verificações, 46 direcionados**, tipagem e
builds de extensão/Mac/motor passaram. O smoke real somente de leitura devolveu
`MOTOR_OK` em Standard/Deep. Manifesto
`31cec5208d94a3927d0aeeea15fe4dedcc36a27a11569597a53959084002692c`;
fontes/logs em `output/game-generation/project-context-20261111-a1/report.json`.
A oitava continuação real reconheceu o projeto e iniciou leituras pelo serviço;
continua em andamento no registro inicial, sem aceite de geração ou jogo.

Após o novo aviso de desbloqueio, o controle visual ainda reportou Mac bloqueado
ao selecionar Unity Hub. Licença continua não verificada, sem inferir ausência
ou ativar o adaptador. Não houve instalação, publicação ou ampliação de acesso.
O plano integral, incluindo quatro engines, seis jogos, pedidos inéditos,
avaliações físicas/humanas, Core/Navi e distribuição/rollback, permanece aberto.

## Arte vetorial com saída PNG e uso em sprites/atlas — 2026-11-11

`image.vector` agora produz SVG ou **PNG real**, preservando a receita editável,
geometria, curvas, gradientes e alfa. O worker existente usa resvg Wasm 2.6.2
fixado por bytes; não recebe XML, fontes, imagens ou código do projeto. Não há
outro executor, provider ou download em runtime. O Studio pode escolher o formato
da variante; nome-base/pasta, alvo, processador e consentimentos permanecem
vinculados ao candidato original. Produção e aplicação continuam separadas.

Foram comprovados pixels/alfa/transformações, determinismo, recusa de codec
alterado/ausente, imutabilidade do SVG anterior, resposta perdida com mesma
identidade e uso do PNG aplicado em composição e atlas. O Core continua recusando
`image.vector`, inclusive PNG: o formato não foi habilitado no Navi/Root.

Composição: `d2eff1c0caf27b8b4df345cf745fbcc9d932bada231883d07d2a511730795ca2`.
Passaram **573 testes, um opt-in ignorado, 31 verificações e 21 direcionados**,
tipagem, builds de extensão/Mac/motor e roteamento Chat Completions simulado.
A suíte TypeScript foi compilada/executada em saída independente, sem limpar
`dist-tests`, pois o harness original de geração permanecia ativo. `npm test`
com a saída padrão fica para um ponto seguro. O smoke Ollama adicional de leitura
excedeu a janela de 180s enquanto aquela geração estava ativa; sua causa não foi
estabelecida nem seu resultado contado como sucesso. Repetir após o run original
terminar, sem cancelar/reiniciar a geração ou mudar seus limites.

Evidências:

- `output/game-generation/vector-raster-20261111-a1/report.json`: fontes,
  manifesto e logs, inclusive os erros intermediários corrigidos e o timeout.
- `output/playwright/game-vector-png/runs/2026-11-11T17-23-41-805Z-7d342914/`:
  serviço empacotado, candidato recuperado após reinício, aplicação explícita,
  PNG real em Phaser e Babylon, cores e resposta a teclado, qualidade integral
  conservada como pendente.
- `output/playwright/game-studio/runs/2026-11-11T17-24-03-508Z-3ed5c902/`:
  renderer/SDK/serviço reais com pontes Mac/VS Code emuladas; escolha PNG,
  campos de geometria, consentimento/recusa, resposta perdida, mesmo job e
  aplicação explícita. Não é aceite das instalações nativas. Capturas lidas.

O pacote inclui Wasm e fontes upstream declaradas, glue, MPL integral e notice;
a exceção do inventário é restrita à versão/hash/fontes exatos, sem aprovar MPL
genericamente. Isso não comprova reprodução Rust ou revisão jurídica independente.
Não houve publicação/instalação. Bibliotecas adicionais, criação e edição artística
completas, animação/personagens, adaptadores Unity/Godot/Core, jogos completos,
pedidos inéditos, avaliação física/humana e distribuição/rollback continuam no
plano integral. A oitava continuação real é separada dessas fixtures: permanece
no motor anterior congelado, com revisão26/build concluído na última inspeção,
sem aceite de jogo. Preservar seu handle e verificar o resultado original.

## Edição dirigida de áudio e interação do Studio — 2026-11-11

O Studio agora edita candidatos WAV por `adjust-audio`: duração, taxa/canais,
normalização opcional, ganho/panorama/corte/fades das faixas já referenciadas,
notas e seus parâmetros. Pode duplicar/remover faixas e acrescentar/duplicar/
remover notas, preservando dados ainda não abertos. Usa o mesmo contrato
canônico e worker; fontes, saída, processador, modo e revisão são conferidos,
com confirmação nativa e aplicação separada. Não há DSP ou loop no renderer.
Nova origem arbitrária não entra por esse formulário. O resultado conserva
proveniência, candidato anterior e identidade após uma resposta perdida.

Uma falha visual anterior à edição de áudio motivou um ensaio de leitura lenta.
Ele provou que o botão de revisão ficava habilitado enquanto seu clique era
ignorado. O estado dos botões agora acompanha a barreira de ocupação e é liberado
antes de renderizar novas permissões. O editor já aberto desabilita sua ação de
abertura. Atualização automática pausa em formulários visíveis com edição local,
evitando interrupção da digitação; retoma após fechar e continua disponível em
pedidos congelados/jobs. Atualização explícita e validação no serviço permanecem.
Falhas anteriores e a reprodução controlada foram conservadas, sem reduzir o teste.

Composição `1af89f640f0d4f445c2aab4736e7f815127c1b5571479f9a6ca1a707b3fb5c8c`:
**574 testes, um opt-in ignorado, 31 verificações e 22 direcionados**, `npm test`
padrão após o término do harness original, tipagem, builds de extensão/Mac/motor,
roteamento simulado e smoke real de leitura Qwen3-coder:30b Standard/Deep com
`MOTOR_OK`. O timeout do smoke anterior permanece como falha histórica; não foi
reescrito como aprovação daquele artefato. Relatório final desta frente:
`output/game-generation/audio-editor-20261111-a2/report.json`.

Ensaios:

- `output/playwright/game-studio/runs/2026-11-11T18-09-25-482Z-b82affaf/`:
  ambas as pontes emuladas, renderer/SDK/serviço/codecs reais; 27 notas, incluindo
  dados não abertos, duplicação/mixagem/cortes, PCM decodificado 48kHz estéreo,
  600ms e pico normalizado, recusa, resposta perdida com mesmo job, aplicação
  explícita revisão3 e áudio sem autoplay. Leitura lenta, pausa durante formulário
  visível e retomada de polling após fechar também verificadas. Capturas lidas.
- `output/playwright/game-library-studio/runs/2026-11-11T18-09-30-014Z-2f33e21f/`:
  regressão de catálogo, licença, rascunho/recarga, consentimento e retomada nas
  duas pontes após os ajustes dos controles compartilhados.

São provas de desenvolvimento no Mac ARM64, sem instalação, release, aceite
auditivo/humano ou extensão do Core/Navi. Timeline/waveform, seleção de novas
fontes, restauração completa do rascunho após fechar o host, cadeia artística e
musical completa, quatro engines, seis jogos, inéditos, matriz física/humana,
distribuição e rollback continuam no escopo integral.

A [oitava continuação real](GAME_GENERATION_EVALUATION.md#oitava-continuação-terminal-e-prévia-de-leitura--2026-11-11)
encerrou `failed/Request timed out.`. O build26 foi preservado; a validação
**do observador após o término** falhou pela receita salva com espera acima de
2.000ms, sem relatório atual publicado. Uma prévia de leitura dos bytes exportados
registrou boot vazio e 14 erros de recursos ausentes. Nenhuma fonte/receita foi
corrigida pelo operador e nenhum aceite foi concedido. O próximo passo de produção
é antecipar a validação canônica da receita antes da coleta e fazer o executor
resolver seus recursos/contrato de canvas, conservando falhas, identidade e limites.

## Receita web conferida antes de consentimento e admissão — 2026-11-11

Implementada a correção decorrente da receita inválida da oitava continuação.
O decoder canônico foi extraído para os contratos e é reutilizado por
`game_check_tests`, serviço e worker. O coletor web declara o formato privado
`testSuiteFormat: "browser-v1"`; declarações desconhecidas são recusadas no
registro/loader assinado, e o campo não existe no pedido público. Coletores
legados ou de outro formato continuam com seu contrato. Não habilita Navi v2.

Antes de consentimento ou admissão, o serviço confere os bytes imutáveis e o
design **da revisão do build**. Não usa a fonte atual como substituta. JSON/UTF-8,
limites, teclas, baseline e referências inválidos produzem diagnóstico limitado,
sem echo de chaves extras, probe, reserva, débito de etapa ou novo job. Suíte
explícita ausente é recusada; default implícito ausente permite só boot, sem
cobertura de testes ou qualidade. Reconfere após consentimento e conserva a
barreira no worker. Replay precede a nova conferência, sem repetir efeitos ou
alterar jobs/recibos antigos.

Composição `3073742de7459dd20d6262320af6c589906f59d49ebb4f17ee6135c04e918038`:
**577 testes, um opt-in ignorado, 31 verificações e 22 direcionados**, tipagem,
builds extensão/Mac/motor, roteamento simulado e smoke Ollama real de leitura
Qwen3-coder:30b Standard/Deep com `MOTOR_OK`. O SDK antigo da release recusou o
primeiro smoke antes do serviço; preservado como falha de composição do driver.
O ensaio qualificado usa o SDK corrente, sem relaxar o verificador. Fontes,
manifesto e logs em `output/game-generation/recipe-preflight-20261111-a1/`.

A [nona continuação](GAME_GENERATION_EVALUATION.md#conferência-canônica-antes-da-coleta--2026-11-11)
retomou o estado salvo com o motor corrigido, mantendo corpus, modelos, recibos,
projeto e limites. O feedback é diagnóstico, sem código/arte fornecido. No
momento deste registro permanece em andamento, sem prova de jogo completo ou
aceite; conferir seu controle/handle original antes de prosseguir. As falhas do
build26 continuam preservadas. Nenhuma instalação/release foi feita.

Após o aviso do usuário de que desbloqueou o Mac, `getApp("Unity Hub")` e uma
conferência posterior de estado continuaram retornando **Mac bloqueado** pela
ferramenta. A licença Unity permanece **não verificada**, não declarada ausente.
Não houve ativação, aceite de termos ou execução de projeto Unity sem isolamento.
As demais obrigações do plano integral continuam pendentes; esta correção é uma
barreira de produção, não aceite artístico, humano, físico ou das instalações.

## Rascunhos duráveis e retomada do Studio — 2026-11-11

Implementado no SDK/hosts/renderer o armazenamento local de design, importações
e ajustes de imagem/vetor/áudio. Escopo vem do cliente autenticado e da sessão,
sem credenciais, seleção de namespace ou autoridade no envelope. JSON até2 MiB,
limites estruturais, CAS ordenado e recuperação de uma confirmação de gravação
perdida mantêm o pedido original. Outra janela não sobrescreve conteúdo divergente.
Mac usa arquivo privado, sincronizado e substituído atomicamente; VS Code usa
`workspaceState/Memento.update`. Navegador antigo é apenas origem de migração.

O rodapé distingue salvar, confirmação e recuperação necessária. Não envia um
pedido sem confirmar sua preservação. Restaurar mostra os campos/ID e congela
pedidos sem resposta; não reprocessa nem aplica automaticamente. Recusar uma
retomada não resolve um efeito anterior. Design agora conserva identidade e
recebe recusa conhecida de schema/modo/seleção/revisão antes do despacho, com nova
conferência após consentimento. Resultado perdido após commit não é convertido
em recusa conhecida. Se a revisão já mudou, o pedido fica conservado para conferir
as revisões; sua recuperação automática no formulário continua pendente.

Fechamento normal do Mac aguarda a gravação; erro permite voltar para conferir
os ajustes, conservando o arquivo anterior. Corrupção/versão incompatível, links
ou permissões abertas não provocam limpeza automática. Gravação ainda não
confirmada não é prometida diante de encerramento forçado/falha física.
A implementação continua sem agente, codecs ou permissões do sistema nas UIs.

Qualificação atual: **583 testes, um opt-in ignorado e 31 verificações**, tipagem,
builds extensão/Mac/motor e roteamento simulado. A suíte foi compilada/executada
em `.cache/studio-drafts-tests-a6`, preservando o `dist-tests` usado pela geração
original; não é uma nova execução do `npm test` padrão. O build headless isolado
ficou **byte a byte idêntico**, inclusive o manifesto, à composição
`3073742de7459dd20d6262320af6c589906f59d49ebb4f17ee6135c04e918038`
usada nas UIs. O smoke Ollama real prévio pertence a esse mesmo artefato; não foi
repetido competindo com a geração ativa. Evidência:
`output/game-generation/studio-drafts-20261111-a1/report.json`.

Percursos verificados e capturas lidas:

- [Rascunhos compartilhados](GAME_STUDIO_UI.md#qualificação-de-rascunhos-do-host--2026-11-11):
  dois produtos, destruição/recriação do contexto/controlador/store, design e áudio
  preservados, resposta perdida, recusa/retomada exatas, um único job, sem autoplay,
  gravação falha impedindo envio e original inválido conservado.
- Mac Electron real de desenvolvimento: processo inteiro fechado/relançado, nova
  partição e nenhum singleton/browser storage sobrevivente; arquivo privado
  restaura pedido de biblioteca congelado, contador prova ausência de despacho
  automático e retomada mantém mesmo pedido/job. Confirmações são simuladas
  somente nesse harness temporário; não é o app instalado/notarizado.
- VS Code/webview/contexto/Memento reais em perfil de desenvolvimento: edição,
  restauração, preview, exportação, biblioteca/licença e recarga preservados.
  Relançamento completo do processo do editor ainda não foi demonstrado.
- Regressões biblioteca e Studio com PNG/áudio passaram. Seus handles terminaram0
  e os serviços temporários encerraram normalmente, sem intervenção. A espera
  de limpeza foi conferida, sem interpretar silêncio como término ou relançar.

O primeiro ensaio preserva um timeout na mensagem de corrupção: a atualização
inicial apagava o aviso. Corrigido e requalificado sem descartar o arquivo ou
relaxar o teste. Nenhuma instalação, publicação ou ativação Navi v2 foi feita.
Demais plataformas, recibos de design, arte completa, Unity/Core, seis jogos,
inéditos, matriz física/humana e distribuição/rollback continuam no plano integral.

A nona continuação real segue no handle original. Evidência pública/consulta de
metadados somente de leitura confirma que criou outro projeto, apesar de pedido
de continuidade, e começou arquivos nele. O original permanece na revisão26,
intacto. Isso é falha observada de fidelidade, sem aceite de novo jogo. Há uma
contradição a corrigir no guia comum: a etapa2 manda abrir projeto sem condicionar
a criação, enquanto o roteamento pede preservar o jogo vinculado. A etapa11
também conserva orientação SVG anterior ao PNG real. Corrigir no módulo comum,
sem colocar inteligência/guardas por palavras nas interfaces ou alterar o caso
em avaliação. Não reiniciar a execução ativa para aplicar uma nova fonte.


## Recibos de design e correção do guia comum — 2026-11-11

Implementação em fonte, sem instalação/publicação ou liberação do Navi v2.
`games.mutations.inspect`, anunciado por `game-mutation-inspection-v1`, fornece
projeção somente de leitura do ledger transacional ao namespace autenticado.
Contratos e SDKs TypeScript/Python validam identidades, campos fechados e hashes.
Não é reconciliação de ferramentas, prova de cancelamento ou aprovação.

O Studio preserva o pedido congelado e oferece retomada explícita. Compara o
vínculo do commit completo original e a revisão imutável confirmada; reconhece a
alteração salva sem repeti-la, inclusive em modo de planejamento com revisão mais
nova. Mantém trabalho posterior e rascunhos diante de incompatibilidade/resultado
incerto. Sem recibo, só o pedido original pode passar por consentimento e CAS.
A [referência do Studio](GAME_STUDIO_UI.md#recuperação-do-recibo-de-design--2026-11-11)
detalha os percursos e suas limitações.

A suíte compilada isoladamente passou com 585 testes, um opt-in não executado,
e 31 verificações de repositório. Typecheck, builds Mac/extensão/headless e
roteamento local simulado Chat Completions passaram. A execução isolada sem a
permissão de criar sockets preserva 44 falhas EPERM; a repetição autorizada passou,
sem ampliar permissões do produto. Não limpar/recompilar `dist-tests` enquanto o
runner de geração original o utiliza. A compilação alternativa preservou esse
runner e qualificou a mesma fonte. Motor de desenvolvimento: manifesto
`668c7ef5b152a634f9acecd50569a96c1757a885a57a679164a4b159ec58c283`.

A recuperação pelo renderer nas duas pontes e pelo processo Electron relançado
passou. O ensaio nativo VS Code anterior permanece sem encerramento confirmado;
não inferir aprovação das capturas parciais. Instalação, reinício integral do
editor e aceite das demais plataformas continuam pendentes. Fontes/logs/hashes:
`output/game-generation/design-receipt-20261111-a1/report.json`.

O guia de produção foi corrigido: criação agora é condicional ao pedido de jogo
novo, continuação preserva o projeto vinculado, e SVG/PNG/WAV seguem os formatos
reais. Não foi acrescentado detector por palavras, loop ou autoridade na UI.
A nona continuação continua no artefato congelado 3073, sem aplicar a correção
retroativamente. A consulta somente de leitura registra o original na revisão 26
e o novo projeto indevido na revisão 6; ambos preservados. Esse desvio é falha de
fidelidade, não um jogo aceito. O efeito da orientação corrigida ainda requer
avaliação real após o término do original, sem concorrer pela inferência.

A ferramenta de controle ainda informou Mac bloqueado ao selecionar Unity Hub.
Licença segue não verificada, sem inferir ausência nem aceitar termos. Unity,
composição Root/Navi, jogos completos/inéditos, arte, matriz física/humana,
distribuição assinada e rollback permanecem no plano integral.


## Visor 3D e hosts nativos requalificados — 2026-11-11

O [visor de candidatos](GAME_MODEL_VIEWER.md) é funcional em fonte: GLB e
texturas reais, câmera orbital/enquadramento, 32 clips reais e controles de
reprodução/pausa sem autoplay. O Studio confirma o candidato pelo serviço e o
host pede consentimento, inclusive em planejamento. Inspeção não aplica o asset,
não cria build/job e não concede QA ou aprovação parental. O pacote de design
permanece conhecimento; o renderer não incorpora inteligência nem parser 3D.

O visor fixo e Babylon/glTF2 9.35.0 usam arquivos locais com hashes e notices
integrais. Coleção privada de recursos não fabrica um GameArtifact. Dependências
precisam pertencer ao candidato; código do projeto, rede externa, decodificadores,
áudio/interatividade e bridge do produto não entram no visor. O limite de recursos
não é uma quota rígida da memória/GPU ou isolamento Core. O primeiro quadro pronto
precede a confirmação de abertura, corrigindo a falha visual inicialmente observada.

`npm test` passou: 589 testes, um opt-in não executado e 31 verificações de repositório.
Também passaram typecheck, builds Mac/extensão/headless, roteamento simulado e
smoke real somente de leitura com qwen3-coder:30b nos dois modos. Motor exato:
`edab54c82c1f329c40abc07a6b42db968ead017dcd3f9dec64331f937483559f`.
O teste visual compara quadros estáticos, em reprodução e pausados; não só rótulos
ou flags do próprio modelo. Não é aprovação artística, física ou de um jogo.

As duas pontes do Studio passaram em
`output/playwright/game-library-studio/runs/2026-11-11T20-30-32-150Z-dc9b7c53/`.
Os hosts nativos temporários passaram em `20-30-31-405Z` (Mac) e `20-30-33-107Z`
(VS Code), sob `output/playwright/game-studio/native-*/runs/2026-11-11T...`.
Ambos abriram o visor com primeiro quadro, preservaram revisão até aplicação
explícita e confirmaram encerramento 0. O Mac também relançou o processo inteiro;
o editor recriou o painel/Memento e manteve o serviço depois de terminar seu
processo. Relançamento integral do editor, instalação e outras plataformas seguem
pendentes. O anterior VS Code terminou no último atalho com target fechado; a
fixture final encerra/verifica somente seu processo. O produto não mudou o atalho.
Fontes, logs, falhas preservadas e hashes:
`output/game-generation/model-preview-20261111-a1/report.json`.

A nona continuação real terminou: run failed por Request timed out, observações
reais falharam, original preservado na revisão 26 e cópia indevida na revisão 6.
Resultado/handle originais foram confirmados antes de outra continuação. A
seguinte usa o guia corrigido e qwen3.6:latest já instalado, cuja capacidade tools
foi consultada no Ollama. Mantém sessão, projetos, recibos, corpus e orçamento;
a seleção do original cabe ao próprio grafo pelo pedido de feedback, sem relink
operacional ou reparo manual. Não é pedido inédito nem jogo aceito. Seu observador
original e o estado corrente estão no relatório; não reiniciar por silêncio.

Nada foi instalado/publicado ou liberado ao Navi v2. Licença Unity, composição
Root/Navi, portfólio completo/inéditos, arte final, matriz física/humana,
distribuição assinada e rollback permanecem no escopo integral, sem redução.


## Recuperação do Studio após reiniciar o editor inteiro — 2026-11-11

A qualificação nativa agora encerra/recria Code e Extension Host com o mesmo
perfil privado/workspace/Memento, mantendo a sessão e reabrindo por comando.
Dois percursos completos passaram, incluindo pedido de design já confirmado com
resposta perdida e edição confirmada localmente mas ainda não enviada. Novos
PIDs são observados; abertura não repete commit ou aprovação. O serviço conserva
histórico/revisões e permanece disponível após terminar a interface. Não há
serializer, cópia de banco, instalação ou modificação de executor nessa mudança.

Provas: `output/playwright/game-studio/native-vscode/runs/2026-11-11T20-59-01-069Z/`
e `output/playwright/game-studio/native-vscode/runs/2026-11-11T21-02-57-031Z/`.
Ambos confirmaram saída 0 e limpeza. Também passaram typecheck, build da extensão
e novamente 589 testes/um opt-in não executado, mais 31 verificações do repositório.
O artefato do motor segue `edab54c82c1f329c40abc07a6b42db968ead017dcd3f9dec64331f937483559f`.

Os dois ensaios iniciais falharam depois da recuperação de dados, ao atingir o
limite de 5 segundos da navegação do preview. Permanecem como falhas, com capturas
e diagnóstico. A causa ainda não foi comprovada; leituras rápidas nas execuções
posteriores não a demonstram. Não houve aumento de timeout, enfraquecimento de
QA ou mudança de permissões. A intermitência exige investigação própria.

[Detalhes e limites](GAME_STUDIO_UI.md#reinício-integral-do-vs-code--2026-11-11).
Fontes, logs e hashes: `output/game-generation/editor-restart-20261111-a1/report.json`.
Instalações, outras plataformas, recuperação de credenciais/trabalho ativo,
qualidade dos jogos, matriz física/humana e distribuição continuam no plano.
A geração real foi acompanhada no handle original 2232 até sua saída 1: run failed
com erro terminated, dez rejeições canônicas e runtime-observed-failed. O projeto
original chegou à revisão 31; a cópia anterior ficou na revisão 6. Não há jogo
aprovado ou causa comprovada da interrupção; investigar antes de nova tentativa.
Ativação da licença Unity aguarda confirmação específica do usuário; não assumir
aprovação pelo tempo decorrido.
