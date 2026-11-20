# Lume: carregamento com perfil de rede e cache HTTP frio

Ensaio de desenvolvimento em **2026-11-13**, complementar à
[prontidão gráfica](GAME_BROWSER_HARDWARE_READINESS.md), à
[campanha de Lume](GAME_LUME_QUALIFICATION.md) e ao
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md). Não aprova qualidade,
FPS físico, latência de uma rede real ou a matriz de dispositivos.

## Fronteira e método

`packages/adapter-game-browser/src/loading.ts` fornece instrumentação
administrativa do protocolo nativo do Chrome. O hook opcional de
`openGameArtifactPage` executa depois das barreiras existentes e antes da
navegação. Não é parâmetro de receita/RPC, coletor registrado, permissão do
projeto ou mudança no supervisor durável. Ausência do hook preserva o caminho
atual e o prazo de navegação de cinco segundos. Falha fecha o contexto sem navegar.

O perfil fixa 20 Mb/s (2.500.000 bytes/s), latência mínima por requisição de 100 ms,
cache HTTP desabilitado e bypass de service worker. Usa
`Network.emulateNetworkConditionsByRule`, conferindo o identificador aplicado
em `requestWillBeSentExtraInfo`. Essa latência configurada não mede RTT físico.
O método indisponível recusa a medição, sem fallback para outro protocolo ou
mudança artificial do estado de `navigator`.

O rastreador guarda apenas caminhos dos arquivos registrados e campos nativos
fechados: tempos, tipo, status, bytes codificados, content-encoding e indicadores
de cache/regra. Não grava cookies, cabeçalhos brutos, corpos, query strings,
URLs ou caminhos desconhecidos. Há limite de 24.000 requisições; excedê-lo
invalida o diagnóstico. Demais requisições conservam `file:null` e seus flags,
sem inventar uma origem nem apagá-las para melhorar o resultado.

O roteiro externo `scripts/qualify-lume-loading.mjs`:

1. Confere os nove arquivos originais do build por hash/tamanho e recusa links.
2. Abre Chrome instalado com janela, sandbox, ambiente fechado e perfil novo
   privado; não conecta a um navegador pessoal.
3. Calibra uma transferência aleatória de 4 MiB em recursos separados, sem
   fabricar GameArtifact ou recibo de produção. O protocolo deve confirmar a
   regra; transferência instantânea, erro ou cache de disco/SW recusam o ensaio.
4. Aplica o mesmo perfil ao build exato antes da navegação; usa botão Jogar,
   HUD normal, PNGs externos e tecla ArrowRight. Não lê objetos Phaser, injeta
   save, muda o relógio ou altera o jogo.
5. Registra GPU informada pelo browser, confere novamente arquivos/componentes,
   aguarda o processo próprio e comprova remoção do perfil temporário.

Os tempos começam no relógio monotônico do observador imediatamente antes da
navegação, após configurar a rede. Incluem automação, clique e captura; são
limites observados desses marcos, não o instante mínimo de interatividade,
frame rate, latência do controle físico ou média estatística de carregamento.

## Resultado do ensaio final

Artefato original `93be1ac1d3ff2ee8a6d56cb2764fe60fd6d4c8ebc0b746a83e7381e774ea5300`,
fonte `fc68696f319ac876a0ee8c6b29d2651306af46c04cfa20978b099c23d44c9292`.
Chrome 157.0.8103.78 em darwin-arm64; viewport 960×540. O browser informou
Apple M3 Max/ANGLE Metal e WebGL/composição habilitados. Foram conferidos os
dois componentes do qualificador, não toda a distribuição do fornecedor.

| Marco externo | Tempo observado desde a navegação |
|---|---:|
| Evento load | 694,91 ms |
| Botão Jogar visível | 712,26 ms |
| HUD visível após clique | 1.582,49 ms |
| Primeira captura com personagem localizado | 1.646,17 ms |
| Captura com movimento confirmado após tecla normal | 1.990,60 ms |

A calibração de 4 MiB levou 1.789,42 ms e registrou 4.195.048 bytes codificados,
incluindo overhead HTTP. Os cinco recursos HTTP registrados receberam 200 e a
regra esperada, sem cache de disco/SW ou `requestServedFromCache`; três usaram
gzip. Outros cinco eventos de imagem, sem caminho registrado, têm flag de
cache e continuam no trace: a ausência de cache declarada restringe-se aos
recursos HTTP registrados. Sem erros de página ou pedidos bloqueados.

O personagem moveu-se nos PNGs e o indicador normal de progresso aumentou.
O processo 77519 terminou com código 0; browser desconectado, perfil e HOME
descartáveis removidos. Todos os arquivos originais mantiveram seus bytes.
Nenhum Agent Service, modelo, instalador ou publicação foi acionado.

## Evidência, correção e repetição

O [dossiê](../output/game-generation/cold-network-20261113-a1/report.json) contém
fontes, logs, hashes, calibração, trace, duas imagens e encerramentos.
`lume-observation-1` permanece intacto: os marcos foram semelhantes, mas o campo
amplo `cacheHitsObserved:false` descrevia apenas arquivos registrados, enquanto
o trace preservava os cinco demais flags. O observador passou a nomear o escopo
explicitamente; `lume-observation-2` é o registro final. Não se alterou o jogo,
o perfil, o timeout ou as barreiras para repetir. Fontes de ambas as versões
do observador são vinculadas aos seus hashes originais no dossiê.

Depois de compilar os testes, sem outro roteiro lendo `dist-tests`:

```sh
node scripts/qualify-lume-loading.mjs \
  --attempt=output/playwright/lume/runs/2026-11-13T10-52-23-459Z-567e07f8 \
  --output=/caminho/novo/para/o/ensaio
```

Não limpar/recompilar `dist-tests` durante a execução, sobrescrever tentativas
ou conectar ao perfil pessoal. Falha conserva diagnóstico e estado privado;
confirmar encerramento do processo próprio antes de qualquer nova tentativa.

Passaram 752 testes, um opt-in ignorado, 40 verificações, tipos, build da extensão,
build independente em destino novo e roteamento local com inferência simulada.
A rodada inicial teve 85 falhas por EPERM nos sockets locais; a mesma suíte
passou com esse acesso permitido, sem afrouxamento dos testes. Os dois testes
novos cobrem calibração real, privacidade, barreiras antes do hook, fechamento
antes de navegar e recusa de protocolo sem fallback.

O novo pacote de desenvolvimento tem 481 payloads e manifesto
`c94766b41efcaf435799e2821194bd4ea1a744315eaabf1dc6c4641c8540687e`.
Ele comprova construção independente, não execução deste diagnóstico pelo
serviço, instalação ou release assinada. Não recebe relatório GameQuality,
`playableSeconds`, aprovação física ou um coletor a partir do CLI.

Continuam pendentes medições completas/repetidas nos jogos e dispositivos da
matriz, FPS físico, áudio/controles, aceite artístico/humano, Unity funcional,
composição protegida instalada, distribuição e rollback integral. A seleção
GPT Luna e o bloco anterior esgotado permanecem inalterados; zero inferência
real foi consumida por esta frente.
