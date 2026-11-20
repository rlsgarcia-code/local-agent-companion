# Compilador web para execução isolada

Estado em 2026-11-10: **componente em desenvolvimento; não é um broker instalado**.
Leia [arquitetura](SUITE_ARCHITECTURE.md), [produção](GAME_PRODUCTION_API.md) e
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md). Não registrar uma capacidade
KidOS só porque o compilador existe no pacote.

Em 2026-11-13, o perfil workspace passou a oferecer o
[módulo opcional de áudio](GAME_AUDIO_RUNTIME.md), com identidade de adaptador2.
O worker fixo deste documento chama `createWebGameAdapters` explicitamente com
`audioRuntime:false`: conserva o perfil/binding de adaptador1 e recusa o import
comum, sem ler o lock de áudio ou aumentar capacidades Core. A presença dos
arquivos no pacote não muda isso. Builds workspace sem import explícito não
acrescentam áudio ao HTML nem reescrevem projetos existentes.

## Contrato e arquivos

O guia dos adaptadores Phaser/Babylon descreve o contrato do HTML gerado:
`canvas#game` já é um `HTMLCanvasElement`. Phaser recebe esse elemento em
`config.canvas`; usar seu ID como `parent` cria outro canvas dentro dele e pode
produzir uma página vazia. Babylon também utiliza o canvas existente.
Dependências locais de GLB, como texturas, precisam ser empacotadas e manter os
caminhos relativos. O guia não autoriza CDN, decodificador remoto ou download.
Essas orientações não reescrevem nem aprovam automaticamente código do projeto.

`packages/adapter-game-web/src/worker.ts`, empacotado como `game-web-worker.cjs`,
reutiliza o compilador Phaser/Babylon offline. Não cria agente, coordenador,
inferência ou novo serviço. Exige Node empacotado 22.23.4 e recebe somente os
diretórios de input/output/runtime definidos pelo broker e o hash da composição.
O contrato privado `packages/contracts/src/game-web-compiler.ts` não é uma rota
RPC nem aceita comandos ou permissões declarados pelo modelo.

O input contém `request.json` e `blobs/<sha256>`, com limites de 16 MiB no pedido,
20 mil arquivos e 256 MiB de fonte. Todos os blobs declarados são conferidos;
referências de transferência e caminhos do projeto nunca viram caminhos do
host. Links, arquivos especiais, hashes, tamanhos, fonte e ferramentas divergentes
são recusados. Código do projeto e plugins não são executados durante o build.

O output precisa estar vazio. Uma reserva exclusiva antes do build impede nova
compilação ou substituição no mesmo diretório. Saídas são candidatos privados
`candidate/<sha256>`. Após gravar e sincronizar os blobs, o resultado tipado é
movido para `result.json`, fixando pedido, fonte, ferramenta, entrada e arquivos.
Isso não é publicação, recibo do serviço, aprovação parental ou relatório de QA.

Falha pode deixar arquivos parciais. O broker deve preservar a reserva,
inspecionar a unidade original e verificar o candidato antes de decidir o
resultado. Ausência do arquivo não prova ausência de efeito; não repetir nem
apagar um candidato desconhecido automaticamente.

## Fronteira KidOS

No repositório KidOS, `game_web_compiler.py` verifica uma composição fixada pelo
administrador e monta exclusivamente o comando do compilador:

- Manifesto e arquivos por hash, ownership protegido, sem links ou módulos
  adicionais; Node/Linux e esbuild completos.
- Unidade systemd de usuário com token privado, sem shell; limites de memória,
  CPU, processos e duração, encerramento de todo o grupo e sem novos privilégios.
- `bwrap` sem rede, namespaces separados, sem home ou sockets do host; runtime
  e input somente leitura, output privado e `/tmp` descartável.
- Ambiente limpo, sem segredos ou configuração de provedor herdados.
- Candidato vinculado ao pedido/fonte/ferramenta originais, caminhos portáveis,
  entrada HTML, hashes e limite agregado verificados.

O KidOS tem agora admissão na autoridade, uploads, diário e operações Core de
build/cancelamento/conferência em fonte, com ensaio IPC/Linux e reinício abrupto.
Consulte `docs/GAME_PRODUCTION_BROKER.md` no seu repositório. A
[porta do adaptador assinado](GAME_CORE_PRODUCTION_PORTS.md) liga o broker ao
serviço em fonte, com ensaio SDK/IPC/Linux e recuperação; perfil v2 protegido e
instalação continuam pendentes. Não usar porta
workspace, `sandbox.run` genérico ou execução direta no Ubuntu para contornar
essa integração. Os adaptadores Unity/Godot completos continuam obrigatórios.

## Verificação

`test/game-web-worker.test.ts` compila os dois runtimes sem executar o jogo e
cobre saída verificada, import do host, adulteração, links, hashes, cancelamento,
pedido extra e repetição sem sobrescrita. O teste KidOS
`tests/test_game_web_compiler.py` cobre instalação, isolamento e resultados.
`integrations/agent-engine/test_game_web_compiler.py` é o ensaio Linux temporário;
não instala capacidades, usa modelo ou modifica contas. Overrides de ownership
pertencem somente à composição de teste; produção exige arquivos protegidos por root.

Build isolado não comprova jogo completo, qualidade, desempenho físico, testes
humanos ou instalação. A presença do worker no build local não promove a versão
instalada 1.0.2. Registrar evidências e lacunas no
[acompanhamento](GAME_DESIGN_IMPLEMENTATION_STATUS.md).
