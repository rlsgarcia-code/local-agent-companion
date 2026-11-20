# Candidato fixo de observação web para o Core

Estado em **2026-11-11**: contrato, worker e verificador KidOS em fonte, com
observação real no Mac ARM64. **Não é um coletor Navi disponível ou instalado.**
O [broker Core e seu protocolo](GAME_CORE_VALIDATION_PROTOCOL.md) foram conectados
em fonte na etapa posterior. A [porta](GAME_CORE_VALIDATION_PORT.md) tem factory
assinada de teste; release e qualificação Linux ainda faltam.
Leia [a admissão](GAME_VALIDATION_ADMISSION.md), [as observações existentes](GAME_BROWSER_OBSERVATIONS.md)
e [o plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md).

## Responsabilidade e contrato

`packages/adapter-game-browser/src/candidate.ts` reutiliza `collect.ts`, com as
mesmas restrições de recursos, CSP, contextos separados, Playwright e sandbox
Chromium. Não cria outro coletor de gameplay, executor de agente ou loop de IA.
O supervisor IPC Companion `game-browser-worker.cjs` continua separado.

O novo `game-browser-candidate.cjs` é uma entrada de um único job. Exige Linux,
Node empacotado 22.23.4 e os argumentos fixos
`/input /output <implementationSHA> <componentSHA>`. A composição protegida usa
ABI de componente 1 e inclui o SHA do manifesto externo do browser na toolchain;
o instalador/rollback em fonte está documentado em
`docs/PROTECTED_BROWSER_DISTRIBUTION.md` no KidOS. Fixtures isoladas da função
podem omitir esse pin; o CLI e a configuração administrativa não podem.
Lê o navegador somente do mount `/browser`; não recebe executável, URL, flags,
perfil pessoal, credenciais ou comandos da interface/jogo. A toolchain fixa ABI,
Node, Playwright, implementação e hash dos bytes originais do manifesto browser.
O manifesto de desenvolvimento do motor agora inclui o worker e a versão exata
de `playwright-core`; isso não constitui publicação ou instalação.

O schema privado `packages/contracts/src/game-browser-worker.ts` define:

- `request.json`: versão, identidade do pedido, toolchain, artefato fixado,
  cenários de design e caminho opcional da suíte **já presente no build**.
- `blobs/<sha256>`: somente arquivos declarados no artefato, até 256 MiB no total.
  Confere fingerprint do artefato, entrada HTML, bytes/hash/tamanho de cada blob,
  ausência de extras e novamente cada recurso servido. Metadados têm até 16 MiB;
  suíte tem até 1 MiB. Cenários não são instruções de código do host.
- `result.json`/`candidate/<sha256>`: vínculos originais, observações runtime
  automatizadas, checks e evidências PNG/JSON. Até 51 observações, 2.000 arquivos,
  64 MiB de evidências e 4 MiB de metadados. Não aceita escopo físico/humano nem
  cobertura semântica de conteúdo/cenários.

Entrada e saída são diretórios privados distintos. Um lock exclusivo impede
duas coletas sobre a mesma saída. Commit é criar sem sobrescrever, com fsync;
cancelamento, corrupção ou repetição conservam os originais e candidatos.
O pedido é vinculado pelo hash de seus **bytes originais**, sem reserialização
em Python. O consumidor deverá fixar esse hash antes de disparar o worker.

## Browser, encerramento e fronteira KidOS

O manifesto `/browser/manifest.json` enumera plataforma Linux, versão, executável relativo e todos
os arquivos por hash/tamanho: até 25.000, 1 GiB total e 512 MiB por arquivo.
Não aceita links, arquivos extras, diretórios não declarados, conflitos portáveis
ou árvore gravável por outros usuários. Não baixa navegador automaticamente.

No KidOS, `game_browser_worker.py` verifica a propriedade Root e o manifesto exato
**antes** de montar a árvore somente para leitura. Dentro do user namespace, o
worker verifica a árvore e proprietário consistente; UID Root pode aparecer como
UID não mapeado. A conferência interna não substitui a autoridade externa.
O plano de comando fixo reutiliza systemd/bwrap: rede/mounts isolados, ambiente
limpo, entrada/runtime/browser somente leitura e saída privada. Limites:
1.536 MiB, 192 tarefas, CPU 200%, duração 150 s e KillMode control-group.
O Node usa coleta de até 120 s. **Construir esse comando não comprova isolamento.**

`runtime.json` registra PID observado via CDP e origem efêmera, sem o cookie.
`stopped.json` só é criado após fechamento do navegador/transporte e ausência
do PID principal. Só então o resultado pode ser commitado. O verificador Python
confere os vínculos, parada, escopo, limites, árvore exata e evidências por hash,
sem abrir outro navegador ou aceitar resultado substituto do cliente.

Esses arquivos **não** comprovam encerramento de toda a árvore de processos.
O futuro broker deve confirmar a unidade/cgroup original e preservar reserva
desconhecida até a inspeção. Não inferir parada por ausência de PID/relatório,
matar PIDs de um arquivo ou repetir coleta durante reconciliação.

## Evidência e trabalho restante

Os testes determinísticos cobrem pedido/build/toolchain trocados, bytes alterados,
arquivos extras/links, concorrência, cancelamento e relatório sem confirmação de
parada. O teste opcional usa Chrome real descartável no Mac ARM64 e confirma
pixels renderizados, evidência e fechamento. O verificador KidOS leu esse mesmo
candidato duas vezes, rejeitou bytes alterados e aceitou a restauração original.

Evidência final local: `output/core-browser-candidate/attempt-3/`; a tentativa 2
também permanece. A primeira gravação
falhou porque faltava a pasta-pai de destino; seu log foi conservado e a repetição
usou novo registro. Não houve desativação de checks nem uso de perfil pessoal.
Essa composição verifica bytes entre linguagens no Mac; não é systemd/bwrap
Linux, autoridade Root/UID via IPC, instalação Navi, jogo aprovado ou playtest humano.
Os testes POSIX desta fronteira Core não qualificam Windows; o cliente Windows
continua consumindo o serviço e o coletor Companion próprio.

A regressão final passou em 506 de 507 testes Companion; o teste real opt-in
ficou explicitamente ignorado nessa execução. As 30 verificações de repositório,
tipos, build da extensão, build headless e smoke de leitura Chat Completions com
provedor simulado passaram. No ensaio real explícito passaram os oito testes,
incluindo o manifesto completo e a inspeção Python. KidOS: 896 passaram, dois
legados ignorados, incluindo 38 casos novos do verificador. O motor construído
é `darwin-arm64`, de desenvolvimento; não certifica CLI/isolamento Linux.

O broker/diário e sua ligação de admissão/inspeção/cancelamento ao orçamento Root
agora existem em fonte; leia o protocolo acima e suas provas separadas. Faltam a
composição assinada de release, composição única Root/Linux real e aceite instalado.
Provisão/rollback já existem em fonte no KidOS; a [prova nativa posterior](GAME_BROWSER_LINUX_QUALIFICATION.md)
qualificou oito cenários do CLI/isolamento com runtime do UID. As guardas Navi v2 e
workflow continuam. O plano completo também conserva quatro engines, produção
de assets, três interfaces, seis jogos, pedidos inéditos e aceite físico/humano.
