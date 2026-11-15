# Assinatura e empacotamento sem alterar a entrada

Fonte e qualificação de **2026-11-13**, parte de GD-11 do
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md). Leia também
[arquitetura](SUITE_ARCHITECTURE.md) e
[qualificação dos hosts](GAME_DELIVERY_NATIVE_HOSTS.md). Esta mudança não publica,
instala ou promove uma versão; o aceite completo continua pendente.

## Problema e responsabilidade

O antigo `scripts/package-engine.mjs` retirava `development`, acrescentava commit
e gravava assinatura no próprio `engine-dist` de entrada. Esse diretório pode
estar sendo usado por uma qualificação/serviço. A identidade assinada da versão
passava a mudar no lugar, antes de clientes e aceitação consumirem o resultado.

O entrypoint agora delega a `scripts/engine-package.mjs`: somente uma cópia nova
recebe assinatura. Produção, SDK, serviço e instalador não ganham permissão nem
outro loop. O bootstrap/verificador existente continua sendo a autoridade para
versão/protocolo/plataforma/assinatura/arquivos do pacote.

## Fluxo

O CLI `npm run engine:package` exige Node22.23.4, checkout limpo e commit Git
exatamente igual a `GITHUB_SHA` quando presente. Mudanças não commitadas não são
apagadas ou escondidas; a assinatura é recusada. Prepare o commit revisável em
checkout separado, preservando o trabalho, em vez de limpar dados para passar.

```text
engine-dist/                                      # entrada preservada
release/engine/
  companion-engine-<versão>-<target>/
    engine-dist/                                 # cópia assinada nova
  companion-engine-<versão>-<target>.tar.gz
  companion-engine-<versão>-<target>.tar.gz.sha256
```

`--input=<bundle>` e `--output=<raiz>` selecionam caminhos explícitos. São
recusados input/output sobrepostos, inclusive aliases por symlink, candidatos,
arquivos finais/parciais ou checksums já existentes. Não há opção de sobrescrita.
Um pacote já assinado não vira entrada para reassinatura como outra release.

O empacotador:

1. Confere chave privada em memória contra a chave pública Companion fixada pelo
   CLI. Ausência/divergência não gera chave substituta ou pacote de produção.
2. Verifica a entrada de desenvolvimento pelo bootstrap real, copia para pasta
   nova, verifica a cópia e confere o manifesto original capturado.
3. Altera manifesto e grava assinatura somente na cópia; verifica a assinatura
   novamente e reconfere a entrada sem escrever nela.
4. Gera TAR/gzip em arquivo `.partial`. Confere o inventário exato de arquivos
   e diretórios reais, inclusive diretórios vazios válidos. Recusa omissões,
   duplicatas e entradas extras; manifesto/assinatura dentro do TAR precisam
   coincidir byte a byte com a cópia. Verifica a cópia novamente após arquivar.
5. Calcula SHA-256 por streaming e publica o nome final por link exclusivo,
   sem rename que substitua um arquivo existente. Só depois escreve checksum.

`manifest.sig` é metadado público, gravado/chmod0644 independentemente da umask
privada de quem publica. Isso preserva a leitura em instalações compartilhadas;
não grava nem torna legível uma chave privada. Os modos dos payloads copiados
permanecem os da entrada. Aceite de instalação/UIDs ainda precisa de prova própria.

A geração/compressão/hash do payload é por streams. O inventário textual do TAR
tem limite de32 MiB; os dois metadados extraídos têm limite de8 MiB, e diretórios
da cópia têm teto100000. Esses são limites do empacotador, não autorização para
ampliar limites de atualização KidOS ou memória/transporte Agent API.

Git, compilação do verificador e TAR/gzip recebem ambiente fechado. Chaves de
publicação, tokens GitHub e opções de TAR não são herdados por esses filhos.
O verificador é compilado em subprocesso sem esses segredos; não há outra
implementação de verificação ou fallback de confiança. `COPYFILE_DISABLE=1`
evita metadados adicionais do arquivador macOS, e o inventário continua fechado.

Falhas conservam a entrada, cópia/parcial e seu diagnóstico; não anunciam pacote
pronto. Imutabilidade aqui é identidade e regra do fluxo, não proteção contra o
dono do filesystem. Consumidores continuam verificando assinatura e bytes antes
de executar; o índice assinado de release ainda cobre o arquivo final.

## Integração com CI e consumidores

O candidato 1.1.0 fixa também o checkout: `.gitattributes` preserva os bytes dos
runtimes, arquivos de catálogo, blobs e fontes de terceiros. A conversão automática
de LF para CRLF no Windows não pode alterar esses bytes; os hashes existentes
continuam sendo verificados, sem recálculo para aceitar uma instalação alterada.

Os produtores e rascunhos continuam sincronizando os arquivos antes da publicação
atômica. `platform-files/flushPublishedDirectory` exige identidade de diretório e
propaga falhas; apenas `EPERM` de `fsync` em um descritor de diretório Windows
retorna o modo explícito `unsupported-on-windows`. A limitação aparece em
`engine.info.build.filesystem`. A [API Windows exige acesso de escrita para
FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers);
um descritor de diretório aberto para leitura pelo Node não satisfaz esse requisito.
Erros ao abrir, sincronizar arquivos, falta de espaço, I/O e falhas POSIX permanecem
falhas. Isso não comprova persistência do namespace após perda de energia no Windows;
o estado autoritativo transacional continua em SQLite e o aceite físico permanece separado.

O passo `package` do workflow fornece `bundle` e `archive` em `GITHUB_OUTPUT`.
Os quatro consumidores — executor Linux, executor Mac/Windows, variantes VSIX e
aplicativo Mac — usam `steps.package.outputs.bundle`. O ensaio
`test-editor-service.mjs` aceita essa variável, mantendo override explícito por
`--bundle-dir`. Nenhum deles pressupõe que a entrada virou assinada no lugar.

O upload inclui somente `.tar.gz` e `.tar.gz.sha256`, não a árvore de staging,
parciais, chaves ou registros internos. Formato do arquivo continua com uma
raiz `engine-dist/`, preservando os consumidores atuais. Não muda o trust root,
metadados públicos de versão/protocolo ou contratos do adaptador KidOS.

A matriz remota de cinco plataformas, produção do `.app`/VSIX, fontes commitadas,
versões novas revisadas e promoção ainda exigem sua execução real. O workflow foi
validado localmente; isso não comprova que Actions executou ou publicou artefatos.
Mesmo número de versão com outro hash não recebe downgrade/reparo silencioso:
a ativação existente mantém sua verificação de release imutável.

## Evidência local e seus limites

`test/engine-package.test.mjs` usa chaves Ed25519 efêmeras, TAR real e um engine
mínimo sintético que nunca é executado. Cobre preservação da entrada/saída,
assinatura e bytes do manifesto, colisões, key/commit inválidos, fonte corrompida,
paths sobrepostos, checkout alterado, ambiente sem segredos e perda injetada de
diretório vazio. Os probes de executável são POSIX; sua ausência em Windows é
registrada como skip explícito, sem anunciar qualificação equivalente.

`scripts/qualify-immutable-engine-package.mjs` aplica a função de build ao
**motor completo real** com uma chave somente de fixture. Sua chave pública não
é instalada no produto; a chave privada não é gravada. `commit` todo zero é
sentinela de fixture, não um commit revisado. O CLI de release não fornece opção
para aceitar essa chave ou pular a verificação de checkout.

O pacote de fixture deve ser recusado pela chave oficial. Apenas o próprio ensaio
confere sua assinatura temporária antes de abrir uma instância descartável do
serviço. Não passa por `ensureEngine`, instalador, LaunchAgent ou ativação pessoal.
Não pode ser usado como candidato distribuível ou evidência de assinatura real.

A qualificação mantém um serviço da entrada ativo durante a cópia/assinatura,
confere a mesma identidade/sessão depois e inicia outro serviço pela cópia. Não
faz inferência, build de jogo ou teste de interrupção de um job ativo. O pacote
original, chaves de produção, perfis instalados e orçamentos permanecem intactos.

O [dossiê](../output/game-generation/immutable-engine-package-20261113-a1/report.json)
liga fontes, assinatura de fixture, verificações, falhas preservadas e encerramentos.
O plano integral continua incluindo distribuição real, instalações, rollback,
Unity, Navi/Core protegido, jogos completos, matriz física e playtests humanos.

### Resultado observado

O ensaio final `full-engine-private-umask`, no dossiê acima, usou a entrada
`291efabf…` de481 payloads. Sob umask077, produziu arquivo de92723200 bytes,
483 arquivos de TAR e74 diretórios, conservando245020044 bytes de payload,
seus modos originais e os dois diretórios vazios do SQLite. Node manteve0755 e a
assinatura pública ficou0644. Hash do arquivo:
`2cb76795110a474706b60eb313c75ddd5130d4343a3f88a147c7b0e5b9f4ad11`.

O processo51516 continuou respondendo com a identidade original e a mesma sessão
durante a assinatura. O processo51591 iniciou pelo pacote de fixture com
Node22.23.4. Ambos encerraram com código0 e estado privado removido. A chave
oficial recusou a assinatura de fixture; nenhum trust root foi alterado.

A primeira composição completa recusou os diretórios vazios `better-sqlite3/deps`
e `src`, permitidos pelo verificador original. Ficou com `.partial`, sem arquivo
final publicado, original preservado e serviço encerrado. O inventário foi
corrigido para conservar a árvore válida, com regressão que injeta a perda de
diretório e exige recusa. Positivos intermediários permanecem associados às
respectivas versões, anteriores à guarda de metadados públicos/umask.

A primeira suíte geral também conservou sua falha: a expectativa literal do
comando `test:repository` ainda não incluía a nova suíte. Ela foi atualizada
mantendo todas as verificações anteriores. O CLI real no checkout atual recusou
fonte não commitada antes de criar saída ou usar chave oficial. Não se transformou
essa árvore alterada em uma release assinada.
