# Unity: preparação da LTS e qualificação pendente

Estado em 2026-11-13 UTC: **ferramenta preparada, adaptador de produção ainda não
qualificado**. Não há registro de adaptador Unity disponível no serviço.
O [plano completo](GAME_DESIGN_IMPLEMENTATION_PLAN.md) continua exigindo criação,
edição, importação, build web e testes 2D/3D reais em Unity na mesma entrega.
Não substituir esse aceite por consulta de versão ou por uma operação vazia.

O [formato de projeto e exportador controlado](GAME_UNITY_PROJECTS.md) agora
existem em fonte, com catálogo de módulos e C# compilado contra a LTS exata.
Há também inspeção independente de candidatos TAR/UnityWebData, sem executar
HTML/JS/WASM ou produzir recibo. O [candidato de player](GAME_UNITY_PLAYER.md)
é separado, com protocolo simulado; testes sintéticos não são builds Unity.
O motor pode empacotar esses dados sem registrar a engine; o SDK/serviço confere
indisponibilidade e ausência de fallback. Não houve importação/build real de
projeto Unity nessa prova; licença, broker e aceite completo permanecem pendentes.

## Versão e insumos exatos

O catálogo oficial da Unity consultado nesta frente identifica **6000.3.28f1**,
revisão **8f082d2fe476**, como LTS. O editor 6000.6.0f1 encontrado anteriormente
no Mac permanece uma instalação distinta, sem servir de aceite desta LTS.

`packages/adapter-game-unity/toolchain.lock.json` fixa as URLs oficiais, tamanhos
e SHA-256 do editor Mac ARM64 e módulo Web Build Support. A preparação conferiu
também a integridade fornecida pelo catálogo e a assinatura Apple dos dois PKGs:
Unity Technologies SF, Team ID `9QW8UQUTAA`. O aplicativo extraído passou por
`codesign --verify --deep --strict` com o mesmo Team ID.

`scripts/prepare-game-unity.mjs` implementa a preparação administrativa offline:

```sh
npm run toolchain:unity -- --inputs /pasta/dos/insumos --output /pasta/privada/unity-prepared.json
```

O script exige os PKGs já baixados e confere arquivo regular, tamanho, SHA-256,
assinatura válida e certificado exato do publisher **antes** da extração.
Falha no serviço de confiança do Mac é erro; não autoriza ignorar a assinatura.
`pkgutil --expand-full` apenas extrai dados na pasta de ferramentas, sem executar
scripts dos instaladores nem alterar `/Applications`. O módulo web fica ao lado
do editor separado. Não há download, ativação, login ou aceitação de termos pelo
script; não recebe senha, serial ou credencial como argumento.

Depois de conferir a assinatura do app e sua versão, gera inventário
determinístico de arquivos, hashes e links, recusando entradas especiais ou
links fora da ferramenta/bibliotecas do sistema. O inventário tem limites de
24 GiB e 150 mil entradas. O registro resultante conserva `available: false` e
`status: prepared-unqualified`. **Esse arquivo não é um registro de produção** e
não é consumido pelo motor como autorização para executar Unity.

Os PKGs, editor e inventário local ficam em `.cache`, fora do código distribuído.
Assinatura do fornecedor e versão não comprovam disponibilidade de licença de
uso, isolamento do projeto ou qualidade de um build.

## Evidências e limites atuais

A ferramenta foi preparada no Mac ARM64 e retornou `6000.3.28f1`. O inventário
registrou 71.280 arquivos/links e 14.892.879.100 bytes de arquivos regulares.
Esses números descrevem a ferramenta, não um pacote de atualização do motor.

Um ensaio controlado do isolamento nativo negou leitura e escrita de um arquivo
canário fora da pasta de trabalho e conexão de rede local. O Node usou somente
seu runtime e arquivos temporários. O carregador do Mac exigiu as regras
`dyld-support.sb` fornecidas pelo próprio sistema. São interfaces privadas do
sistema: precisam de qualificação por versão do macOS, sem fallback permissivo.

O editor também respondeu à consulta de versão sob o perfil restrito. A tentativa
de criar **um projeto vazio controlado**, sem código gerado ou Package Manager,
não concluiu a consulta de licença dentro do tempo de observação. A licença
**não foi classificada como ausente**: o perfil/IPC do cliente de licenças ainda
precisa ser integrado e verificado. O processo auxiliar dessa tentativa foi
inspecionado por caminho exato e encerrado; nenhum build foi anunciado como
concluído. Não executar projetos gerados fora do isolamento para contornar isso.

A inspeção do Hub por interface ficou pendente porque o Mac estava bloqueado.
O desbloqueio foi solicitado ao usuário. Não ler nem copiar tokens, arquivos de
licença ou senhas para o chat, projeto, checkpoint, recibo ou conta infantil.

Em 2026-11-11, após o aviso de desbloqueio, a nova seleção do Unity Hub pelo
controle visual ainda respondeu que o Mac estava bloqueado. A licença não pôde
ser conferida; foi solicitado deixar o Hub aberto e visível. O trabalho Godot
continuou independentemente. Isso não confirma licença ausente e não altera o
estado `prepared-unqualified` ou habilita execução de projetos Unity.

Na conferência seguinte, após novo aviso do usuário de que o Mac estava
desbloqueado, a seleção do Hub novamente retornou sessão bloqueada. Não foi
possível observar o tipo/estado da licença. A pergunta sobre a licença ativa
permanece pendente; não tratar a falha do controle visual como licença ausente,
aceitar termos ou ampliar o isolamento para avançar.

## Trabalho necessário para ativar o adaptador

### Conferência do Hub — 2026-11-11

Após o usuário informar que entrou na conta e não tem licença ativa, o controle
visual conseguiu acessar o Unity Hub **3.22.2**. A conta está conectada; a tela
de licenças não apresentou item ativo. Foi percorrido **Settings → Licenses →
Add license → Get a free personal license**, sem ativar licença ou abrir projeto.

A etapa seguinte mostra **Agree and get personal edition license**, com link
aos [termos do editor](https://unity.com/legal/editor-terms-of-service/software).
O botão aceita esses termos e declara elegibilidade. O Hub também informa a
restrição a membros de organizações Pro/Enterprise/Industry. A decisão completa
de elegibilidade cabe ao usuário; login ou autorização para desenvolver o
adaptador não substituem essa declaração. A confirmação específica foi solicitada
e o botão permanece sem clique enquanto não houver resposta.

O [percurso oficial de ativação](https://docs.unity.com/en-us/hub/manage-license)
prevê esse passo quando o login não ativou Personal. Não foram lidos/copiados
arquivos de licença, tokens, e-mail ou identificadores da conta para a evidência.
A presença dessa etapa não altera o registro `prepared-unqualified`. Mesmo após
ativação, ainda é necessário qualificar IPC/licenciamento, isolamento, builds e
recuperação antes de anunciar o adaptador como disponível.

Registro sem dados de conta:
`output/game-generation/unity-license-20261111-a1/status.json`.

### Implementação e aceite ainda necessários

- Verificar a licença no Hub e integrar um broker restrito, mantendo as
  credenciais no armazenamento existente, fora do alcance dos scripts do jogo.
- Qualificar a barreira completa, inclusive herança por subprocessos, saída de
  processos, disco e recursos. O canário básico não comprova esses requisitos.
- Integrar o preflight/preset de build em fonte ao broker qualificado e demonstrar
  importação/build real, cenas, dependências e diagnóstico. Scripts C#/Editor são código
  executável de terceiros e não ganham autoridade no host.
- Demonstrar projetos 2D/3D editáveis, assets, build web, abertura e observações
  independentes; integrar ao mesmo contrato de jobs/recibos do serviço.
- Comprovar cancelamento e reconciliação sem repetir efeitos desconhecidos.
- Qualificar plataformas suportadas e distribuição opcional verificada, antes
  de expor disponibilidade nas interfaces. KidOS exige broker/Core próprios;
  não recebe shell, filesystem ou Docker genéricos por esta preparação.

Referências oficiais: [release 6000.3.28f1](https://unity.com/releases/editor/whats-new/6000.3.28f1),
[argumentos do editor](https://docs.unity.com/en-us/engine/6000.3/manual/unity-editor/command-line-arguments/editor),
[build por linha de comando](https://docs.unity.com/en-us/engine/6000.3/manual/building-and-publishing/build-command-line).
