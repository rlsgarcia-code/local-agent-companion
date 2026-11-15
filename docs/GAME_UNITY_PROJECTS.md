# Unity: formato de projeto e exportador controlado

Fonte em **2026-11-13 UTC**, ainda sem adaptador de produção registrado. Leia a
[preparação/licença Unity](GAME_UNITY_QUALIFICATION.md), a
[arquitetura](SUITE_ARCHITECTURE.md) e o [plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md).
Este avanço não substitui criar, editar, importar, construir e jogar projetos
Unity2D/3D reais, nem a corrida de referência exigida no plano.

## Responsabilidades e estado

`packages/adapter-game-unity` agora contém preflight somente de leitura e código
C# do exportador e inspeção independente de candidatos. Não contém um agente, interface, endpoint de modelo ou launcher
autorizado de projetos. O serviço continua sem fábrica/registro Unity. O kit não
expõe esse preflight como permissão ou operação administrativa.

| Parte | Estado comprovado |
|---|---|
| `src/project.ts` | Validação de formato, bytes/hashes, versão, cenas e dependências por testes determinísticos; não invoca editor |
| `editor/CompanionWebBuild.cs` | Compilou com Roslyn/.NET e referências exatas da LTS6000.3.28f1, sem executar a DLL ou Unity |
| `project-modules.lock.json` | Metadados de40 módulos integrados, conferidos contra hashes do inventário preparado; analytics explicitamente excluído |
| `src/output.ts` | Leitor puro de TAR, diagnóstico e tabela UnityWebData, com hashes dos bytes originais; não executa arquivos ou produz player/recibo |
| Bundle do motor | Inclui fonte/locks e módulo `unity-output-inspector.cjs`; não inclui editor, compilador, bibliotecas do fornecedor ou licença |
| Disponibilidade | SDK/serviço reais recusam build Unity antes de criar job, sem migrar projeto para outra engine; duas identidades Companion testadas |
| Produção Unity | Pendente: licença/broker, isolamento completo, import/build reais, runtime web, recuperação, interfaces, plataformas e distribuição |

## Projeto editável

O futuro broker deverá chamar `readUnityProject` **antes de iniciar o editor**,
usando o documento/revisão autenticados e sua leitura de blobs. O preflight não
copia, renomeia, migra ou corrige arquivos incompatíveis. Exemplo de dados:

```json
{
  "schemaVersion": 1,
  "engineVersion": "6000.3.28f1",
  "dimension": "3d",
  "scenes": ["Assets/Scenes/Opening.unity", "Assets/Scenes/Game.unity"]
}
```

O arquivo `game.unity.json` é estrito, com até16KiB. A dimensão deve corresponder
ao briefing; as1–128 cenas são caminhos portáveis, distintos e já presentes.
A primeira é a entrada. Não há fallback para cena aberta no editor.
Não aceita método/flags de execução, caminhos do host, licença, provedor ou
declarações de disponibilidade enviadas pelo cliente.

`ProjectSettings/ProjectVersion.txt` mantém as duas linhas nativas exatas:

```text
m_EditorVersion: 6000.3.28f1
m_EditorVersionWithRevision: 6000.3.28f1 (8f082d2fe476)
```

Requer também `Packages/manifest.json` e `Packages/packages-lock.json`.
O perfil atual aceita os módulos integrados fixados no catálogo, versão1.0.0,
com dependências transitivas, profundidades e conjunto alcançável exatos.
Recusa registro/Git/`file:`, registries personalizados, pacotes embutidos,
resoluções inventadas e `com.unity.modules.unityanalytics`. Esses dados não
certificam compatibilidade WebGL de cada módulo nem concedem rede, dispositivos
ou telemetria. Pacotes adicionais precisam de catálogo offline próprio, fixação
e qualificação; não serão baixados silenciosamente.

As leituras conferem tamanho declarado/real, SHA-256 e UTF-8. Limites adicionais:
versão1KiB, manifest16KiB e lock64KiB. Erros JSON/schema não ecoam o conteúdo.
Caches `Library`, `Temp`, `Logs`, `UserSettings`, `obj` e builds não entram no
working copy. O namespace `Assets/Editor/CompanionProduction` é reservado ao
driver fixado, incluindo seu `.meta`; conflito preserva o original e recusa.
Plugins binários/nativos e arquivos de resposta do compilador requerem outro
perfil verificado. Essas recusas de formato **não tornam C# seguro no host**.

## Exportador C#

A entrada fixa é `Companion.GameProduction.WebBuild.Run`. Exige batch mode,
versão exata e alvo WebGL selecionado antes da importação. Seleciona somente
as cenas declaradas e importadas como `SceneAsset`, usando
[`BuildPipeline.BuildPlayer(BuildPlayerOptions)`](https://docs.unity.com/en-us/engine/6000.3/script-reference/unityeditor/buildpipeline/buildplayer).

O preset desativa threads, compressão interna/decompression fallback, data
caching e nomes por hash; usa o template integrado Minimal. Exporta para
`project/../output` e escreve um diagnóstico limitado em
`project/../candidate/unity-build.json`, por arquivo novo/flush/move, recusando
substituir candidato anterior. Não recebe saída arbitrária no JSON. Confere
resultado da API, `index.html` e os quatro arquivos esperados `.loader.js`,
`.framework.js`, `.wasm`, `.data`. Falhas produzem códigos fixos, sem exception,
conteúdo de projeto, caminho, licença ou credencial no diagnóstico.

O diagnóstico do editor **não é recibo do supervisor nem QA**. Código `Editor`
de projeto já pode executar durante a importação, antes dessa entrada. O futuro
broker precisa estabelecer a barreira do sistema antes de abrir Unity, manter
editor/licença fora do alcance do projeto e validar independentemente arquivos,
links, bytes e identidade de processo/candidato. Nunca usar esse driver direto
no home pessoal como alternativa ao isolamento, nem fornecer shell/Docker ao Navi.

Ainda é necessário adaptar o shell/runtime exportado à política de recursos e
CSP do jogador, sem relaxá-la apenas para abrir HTML Unity. Licenças/notices,
assets, controles, renderização e save precisam de observação real. Sem prova
disso, esse código não é um adaptador funcional ou um jogo distribuível.

## Qualificação realizada

`scripts/qualify-unity-build-driver.mjs --prepared=<inventário-privado>` verifica
o inventário proprietário e cada arquivo do compilador/runtime/referências
utilizado. Executa somente o compilador de código de manutenção sob perfil
macOS próprio com default deny, sem rede e escrita limitada ao diretório de
trabalho. Não inicia Unity/Hub, executa o driver ou acessa arquivos de licença.
O ensaio passou em
`output/game-generation/unity-driver-compile/2026-11-13T08-06-20-840Z-7335ce43/`.
Essa prova do compilador não certifica a barreira de processos do editor, quotas,
herança por IL2CPP ou licenciamento. Não reutilizar o loader dessa fixture como
autoridade de instalação: um inventário privado do usuário não é provisão Root.

A primeira tentativa preserva `sandbox_apply: Operation not permitted` na
execução restrita do ambiente de trabalho; a repetição autorizada aplicou o
mesmo perfil local. O compilador então encontrou o tipo real `int` para
contadores de erro/aviso, corrigido antes do passe. As duas falhas permanecem
no dossiê; não houve execução fora do perfil nem substituição de versão.

`test/game-unity-project.test.ts` cobre2D/3D, ordem de cenas, dados intactos,
versão/dimensão/cenas divergentes, opções forjadas, pacotes remotos, exclusão de
telemetria, transitivos/profundidades, arquivos reservados/plugins/caches,
limites, hash, UTF-8 e privacidade dos diagnósticos.

`scripts/qualify-unity-source-engine.mjs --engine=<bundle-exato> --prepared=<inventário>`
testa o Node/serviço/SDK/TLS reais com ambiente explícito sem credenciais herdadas.
Mesmo com cópia do registro `prepared-unqualified`, Mac e VS Code continuam sem
adaptador Unity: pedido de build recebe indisponibilidade, não cria job e
preserva o projeto. O processo próprio é encerrado com código0. Não usa modelo,
editor ou credenciais do usuário.

O candidato final foi conferido em
`output/game-generation/unity-source-engine/2026-11-13T08-24-55-393Z-84947fb3/`,
manifesto `0bf6ec370f53447b8e6d45d55daace1e03a68900f50cabc0ae9be2ba862478bc`.
Seus470 arquivos anteriores continuam idênticos ao bundle de contexto; somente
três arquivos Unity de fonte/locks foram acrescentados. Passaram typecheck,
checagem headless, build da extensão,689 testes e31 verificações, com um opt-in
não executado. O ensaio do compilador conferiu243 arquivos de ferramenta e emitiu
uma DLL de9.216bytes; a DLL não foi executada nem incluída no pacote.

Fontes, hashes e logs: [dossiê desta etapa](../output/game-generation/unity-driver-20261113-a1/report.json).
Nenhuma instalação, assinatura de release, aceitação de termos ou ativação de
licença ocorreu. O aceite integral Unity e os demais critérios do plano permanecem
obrigatórios; não converter preparação/compilação em disponibilidade.

## Inspeção independente da saída — fonte de 2026-11-13

[`src/output.ts`](../packages/adapter-game-unity/src/output.ts) acrescenta a
fronteira de leitura que o futuro broker deverá usar após confirmar o encerramento
de seus próprios processos. Não é um launcher, RPC, adaptador registrado,
coordenador de produção, certificado de licença ou avaliação de qualidade.
O motor empacota `unity-output-inspector.cjs` como módulo de manutenção sem
entrada de execução automática. Ele não é importado como capacidade do serviço.

O leitor recebe somente bytes do TAR, diagnóstico do driver e configuração
Unity já fixada pelo chamador. O TAR usa o parser comum limitado (256 MiB de
conteúdo, 288 MiB de transporte e 20.000 arquivos), sem extração no host. Recusa
links, dispositivos, colisões de caminhos, truncamento e checksum inválido.
Os nomes UTF-8 são exatos, inclusive uma marca BOM que faça parte do nome: não
promover `BOM + index.html` a `index.html`. Essa preservação também foi corrigida
no parser compartilhado usado pelos demais adaptadores.

O diagnóstico de até16KiB tem campos fechados, versão LTS/target exatos, resultado,
código de falha, contagem de cenas/erros/avisos e bytes declarados pelo editor.
O driver agora grava **string vazia** como `failureCode` do sucesso, em vez de
depender da serialização de uma string nula pela Unity. Candidatos antigos
incompatíveis são preservados e recusados; não convertidos silenciosamente.
Sucesso exige zero erros e contagem de cenas correspondente à configuração.
Isso não comprova quais cenas foram realmente compiladas ou funcionam.

A inspeção exige `index.html` e um único conjunto coerente de arquivos
`.loader.js`, `.framework.js`, `.wasm` e `.data` em `Build/`, com o mesmo nome-base.
O preset controlado não aceita representação comprimida, worker, `.mem` ou
outros arquivos desconhecidos em `Build/`; `.symbols.json` e `.jpg` do mesmo
nome-base são mantidos quando presentes. Essa estrutura segue a
[documentação Web da LTS6000.3](https://docs.unity.com/en-us/engine/6000.3/manual/platform-specific/webgl/building-distribution/building).
O HTML precisa ser UTF-8 de até2MiB; loader/framework, UTF-8 de até16MiB cada.
Nunca avaliar scripts, analisar HTML como UI, descomprimir automaticamente ou
renomear um arquivo para fazê-lo caber nesse perfil.

O WASM passa somente por identificação do cabeçalho/versão, **sem validação ou
execução do módulo**. A tabela `.data` usa `UnityWebData1.0`, inteiros little-endian,
offset final do cabeçalho e registros de offset/tamanho/nome UTF-8. O formato foi
conferido no loader da ferramenta exata, inventário preparado:
`PlaybackEngines/WebGLSupport/BuildTools/UnityLoader/UnityLoader.js`, SHA-256
`d3b9b408e4b336685e9ee0f08c876a9157f96b95a251121e6e77b0bc619fc558`.
Não foi copiado código do fornecedor para o leitor.

O perfil limita a tabela a16MiB/20.000 entradas e nomes portáveis; recusa limites
fora do pacote, aliases/colisões, sobreposição de payload e UTF-8 inválido. As
entradas continuam **virtuais** e nunca viram destinos no filesystem. O hash de
cada payload é calculado em intervalos disjuntos, limitando o trabalho ao tamanho
real do pacote. Compatibilidade com projetos Unity reais continua pendente;
formatos fora desse perfil não serão truncados ou declarados compatíveis por
suposição.

O resultado guarda todos os bytes originais, inventário ordenado com hashes,
hash do mapa de arquivos, hash do TAR e do diagnóstico, além dos números realmente
medidos. `BuildSummary.totalSize` não substitui esse inventário. Todo erro público
usa um código limitado, sem repetir corpo, nome privado, licença ou stack do editor.

A fonte/HTML originais continuam sendo **dados de candidato privado**, não um
`ProducedGameArtifact` ou player publicável. Há agora um [candidato de player/shell em fonte](GAME_UNITY_PLAYER.md), com
protocolo simulado; ainda faltam compatibilidade Unity real/CSP,
licenças/notices verificados de distribuição, broker com identidade/fechamento completo,
licenciamento e builds/jogos reais. O futuro recibo deverá vincular job, revisão,
toolchain e bytes sob autoridade do supervisor; o diagnóstico do projeto não
poderá fabricar isso. A inspeção nunca relança Unity para resolver uma falha.

Os [testes de saída](../test/game-unity-output.test.ts) usam pacotes sintéticos
claramente identificados: HTML/JS que falhariam caso fossem executados e um
cabeçalho WASM mínimo, não um jogo Unity. Conferem preservação, inventários,
recusas, metadados contraditórios, caminhos e ranges internos. O
[ensaio do módulo empacotado](../scripts/qualify-unity-output-inspection.mjs)
usa o Node exato e ambiente sem credenciais herdadas. O guard SDK/TLS separado
continua exigindo indisponibilidade e nenhum job Unity criado.
Evidências e limites estão no
[dossiê](../output/game-generation/unity-output-20261113-a1/report.json).
Nenhuma prova de parser equivale a importação/build, renderização, barreira do
editor, licença, instalação, corrida de referência ou aceite final GD-07.
