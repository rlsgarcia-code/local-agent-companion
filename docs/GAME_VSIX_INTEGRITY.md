# Integridade do motor dentro do VSIX

Fonte e evidência local de **2026-11-13**, parte de GD-11 do
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md). Complementa o
[empacotamento imutável](IMMUTABLE_ENGINE_PACKAGING.md), sem substituir a
assinatura oficial, a matriz de plataformas ou o aceite instalado.

## Problema comprovado

O verificador anterior de `scripts/package-native.mjs` enumerava `manifest.json`
e `manifest.sig`, mas comparava hashes somente dos payloads listados em
`manifest.files`. Os metadados eram contados sem comparação de conteúdo.
Assim, até uma assinatura substituída ou o mesmo JSON reformatado eram aceitos
como pacote pronto. O bootstrap do produto ainda verificava a assinatura ao
instalar/iniciar: esta era uma lacuna na certificação do artefato produzido,
não evidência de que uma instalação adulterada tivesse sido aceita.

O teste de regressão preservado em `regression-before.log` comprova a aceitação
indevida antes da correção: `Missing expected rejection`. Não foi apagado ou
reinterpretado como sucesso.

## Implementação e fronteiras

O CLI continua verificando o bundle com o bootstrap e a chave Companion fixada,
antes e depois de copiá-lo. Agora captura os bytes exatos do manifesto e da
assinatura **antes de executar VSCE**; não os relê da árvore de staging depois
da execução para definir o resultado esperado.

`verifyPackagedEngine(archive, manifest, metadata)` recebe esses bytes e a chave
pública. Confere a assinatura, a correspondência do objeto com seus bytes e o
hash de cada arquivo dentro do ZIP, incluindo os dois metadados. Reformatar um
JSON equivalente não preserva sua identidade assinada. A verificação percorre
os streams, sem extrair ou executar o motor ou acumular o payload em memória.

Também recusa arquivos ausentes, extras, duplicados, aliases de caixa do caminho
do motor, entradas criptografadas, links/tipos não regulares e diretórios extras
declarados no ZIP. Diretórios opcionais no ZIP precisam ser ancestrais dos
payloads; VSCE representa os diretórios pelos próprios caminhos de arquivos.
Em bundles POSIX, o Node precisa conservar um bit de execução no ZIP. A validação
de paths do leitor opera em modo estrito, sem converter barras invertidas.

Metadados esperados têm limite de 8 MiB para manifesto e 64 bytes para assinatura
Ed25519. Isso não amplia limites de transporte ou do atualizador KidOS. O
bootstrap existente continua validando versão, protocolo, plataforma e bundle
de origem; a comparação pós-empacotamento não o substitui. A inspeção trata
somente o motor embutido; não é uma nova assinatura completa da extensão ou
verificação de toda a árvore instalada.

A alteração pertence à infraestrutura Companion. Não muda Agent API, loops,
permissões, seleção de provedores, ferramentas ou autoridades KidOS.

## Qualificação

[Testes](../test/native-package.test.mjs) criam ZIPs reais com assinatura
Ed25519 efêmera, payloads sintéticos nunca executados e casos negativos. Incluem
JSON equivalente reformatado, assinatura alterada, chave errada, manifesto
divergente, arquivos faltantes/duplicados/extras, alias de caminho, symlink,
Node sem execução e payload alterado. Os testes existentes de instalação
permanecem separados em `test/installed-vsix.test.mjs`.

O runner [de VSCE real](../scripts/qualify-vsix-engine-integrity.mjs) recebe
motor/chave pública de fixture e uma pasta nova. Recusa usar a chave oficial
nesse caminho de qualificação. Não gera ou grava chave privada, não modifica
o trust root e não instala extensões. Copia somente entradas explícitas para
staging; o filho VSCE recebe ambiente fechado e HOME privado, sem chaves de
publicação, tokens GitHub ou credenciais de modelos. Não relaxa a verificação
de segredos do empacotador.

O ensaio completo `real-vsce` usou:

- Motor real `1.0.2`, Node `22.23.4`, `darwin-arm64`, manifesto
  `3de9ad0c6f558b7b9c12b3683e535ff73a879470b29065f4835572f6566967df`, já
  assinado apenas pela chave efêmera do ensaio anterior.
- Cópia do cliente compilado `0.12.4`, variante LiteLLM, e VSCE `4.0.0` real.
- VSIX de 118.775.828 bytes e 848 arquivos no total. O verificador conferiu os
  483 arquivos do motor, totalizando 245.087.341 bytes com metadados.
- SHA-256 do VSIX:
  `3dc75e2b6e598991f7b81d721ba576dc04485d575a5c170e757abd9ceccd7dc1`.
- Inventários de hashes, tamanhos e modos das entradas do cliente e do motor
  iguais antes/depois. Chave oficial recusando o motor de fixture.

O arquivo chama-se `QUALIFICATION-ONLY.vsix`. A chave real compilada no cliente
não foi substituída: esse pacote não pode ser ativado como produto distribuível.
Prova serialização e conferência do ZIP real, não instalação, ativação, rollback,
assinatura oficial ou qualidade de jogo. Não houve inferência ou novo orçamento.

Fontes, controles, logs e falhas ficam vinculados no
[dossiê](../output/game-generation/vsix-engine-integrity-20261113-a1/report.json).
Passaram 748 testes de aplicação, um opt-in ignorado, 40 verificações do
repositório e os dois typechecks. A execução inicial em ambiente restrito
terminou com 84 falhas, incluindo `listen EPERM` nos sockets locais. Ficou
conservada; a repetição autorizada com IPC disponível passou sem alterar testes,
timeouts ou permissões do produto. Os cenários de inferência usam simulações;
não foram feitas chamadas reais ou renovação do bloco Luna.

Os critérios integrais de GD-11 continuam incluindo commit/versão revisados,
release remota assinada, cinco plataformas, instalações e migração/rollback dos
dados novos. Os demais marcos de Game Design também permanecem no escopo.
