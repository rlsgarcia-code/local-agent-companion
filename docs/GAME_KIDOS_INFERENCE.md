# Integração de inferência protegida no KidOS

A alocação Root também recebe admissões de build por etapa como opção separada,
descrita em [portas Core](GAME_CORE_PRODUCTION_PORTS.md) e no documento KidOS
`docs/PROTECTED_PROJECT_BUILDS.md`. `requests_per_block` começa em zero:
inferência não concede builds automaticamente. Política de produção é independente
de `enabled` de inferência, e nenhum consumo de build é contabilizado como token.
Fila antecipada, testes/mídia, workflow técnico e instalação continuam pendentes.

Revisão posterior: o consumidor opcional já resolve alocações Root por projeto
e etapa, além da cota global. O contrato operacional é
`docs/PROTECTED_PROJECT_INFERENCE.md` no KidOS. A composição atual tem nove
cenários, SHA-256 de relatório
`af84725616c1b47ef1805b631423e94703aa66d66571fc5676aeca089dd4cb88`;
as evidências anteriores abaixo permanecem históricas para suas respectivas fontes.

O serviço fixa o projeto no recibo privado ao admitir o run. O adaptador assinado
usa `inferenceProjectId` desse contexto, resolve o ref pela autoridade e mantém o
vínculo na retomada. A UI não fornece esse campo no RunSpec. Conversas comuns
usam `navi-conversations`, também com alocação administrativa. O catálogo exige
opção adicional `--protected-inference-projects` e ABI de projeto 1; não muda o
perfil instalado ou o padrão de build. `require_project` é política Root que
recusa omissão de referência no Unix; o HTTP legado continua exigindo corte próprio.

`production: { ref, stage }` no recibo é conferido pelo transporte, incluindo
imutabilidade durante o stream. A cota por etapa e a global são debitadas na
mesma admissão; chamadas desconhecidas retêm ambas. Somente root/responsável
autorizado cria, concede blocos ou muda etapa de orçamento. Isso não certifica
qualidade, avança o workflow técnico ou habilita produção KidOS v2. A política
tem de manter sua revisão mínima de implementação durante eventual rollback.

Passaram 715 testes KidOS (dois ignorados), 474 testes Companion e 30 verificações
do repositório, dezesseis cenários de transporte e nove de composição Linux.
O cenário de projeto bloqueou a etapa esgotada antes do provedor, preservou o
projeto após reinício e registrou duas chamadas em Design e duas em Core após
decisão Root e continuação explícita. Sem modelo real, instalação ou nova release.

Estado em 2026-11-10: **autoridade, gateway e consumidor opcional do adaptador
ligados em fonte; perfil Navi v2 e implantação protegida ainda não habilitados**.
Leia [arquitetura](SUITE_ARCHITECTURE.md), [orçamento compartilhado](INFERENCE_BUDGETS.md),
[portas Core](GAME_CORE_PRODUCTION_PORTS.md) e o
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md).

## Responsabilidades e estado

No KidOS, `guardian_inference.py` mantém a cota por UID/dia em armazenamento
da autoridade. `protected_model_gateway.py` recebe uma chamada por conexão Unix,
identifica o peer pelo Linux e encaminha somente admissão e consumo pela conta
de serviço `kidos-model`. O gateway não recebe autoridade administrativa,
ferramentas de host ou loop de agente. Configuração continua com root/responsável
pareado; confirmação comum de plano não concede orçamento parental.

O backend soma todos os papéis na conta. O serviço comum mantém separadamente
os namespaces de produto/perfil/workspace e orçamentos por etapa. Compartilhar
contabilização administrativa não compartilha conversas, memória ou credenciais.
Não importar contadores declarados pelo cliente como prova de consumo.

A referência operacional completa é `docs/PROTECTED_INFERENCE.md` no checkout
KidOS. A política começa desabilitada; o instalador atual não ativa a unidade.
O HTTP legado permanece separado e ainda não aplica essa cota. Este backend
não comprova proteção global da inferência instalada.

## Consumidor opcional e contrato privado

`packages/contracts/src/kidos-inference.ts` define recibos e eventos estritos;
`installedCoreInferenceABI: 1` no manifesto e `installedCoreInferenceVersion: 1`
no kit identificam a compatibilidade privada. Isso não permite à UI cadastrar
outro provedor ou transporte. O builder KidOS aceita `--protected-inference`
somente com motor/SDK exatos, kit verificado, Node 22.23.4 e alvo Linux x64/ARM64.
O catálogo resultante contém `protectedInference: { schema: 1 }`. O padrão legado
permanece inalterado e o fluxo de candidatos ainda não liga essa opção.

No KidOS, `inference.cjs` usa exclusivamente
`/run/kidos-model-gateway/inference.sock`. A identidade dedicada vem do arquivo
root `/etc/kidos/agent-inference.json`, não de parâmetros RPC. Diretórios,
propriedade, links, configuração e eventos são verificados. O provisionamento
opcional inclui esse metadado em backup/rollback; não instala/ativa a unidade,
não habilita política nem impede por si só o HTTP legado.

A fábrica LangChain do adaptador envia os papéis pelo mesmo canal e desabilita
retentativas internas (`maxRetries: 0`). Planejamento, supervisor, especialistas,
compactação e revisão continuam no grafo existente. Não há fallback HTTP.
IDs derivados de UID, thread do run e contador persistido são gravados antes do
envio. O memo conserva papel, SHA-256 dos bytes do pedido e vínculo confirmado
pela autoridade. Chamadas paralelas ativas não são tratadas como órfãs. A inspeção
mescla o estado atual para não apagar tentativas concorrentes.

O recibo acrescenta `request_sha256`: hash do frame original sem newline. Recibos
legados preservam `null`, histórico e débito; não autorizam repetição nem permitem
inferir outro conteúdo por normalização JSON. `done` só confirma sucesso após
settlement persistido, com identidade e vínculo correspondentes e fim do canal.

## Espera, inspeção e continuação

O adaptador fornece juntos `hasPendingInference` e `reconcileInference`. O serviço
oferece `inference.inspect({ runId })` somente ao produto KidOS e quando o run
está parado aguardando host/reconciliação. A capacidade é
`installed-inference-inspection-v1`; os SDKs expõem `inspectInference` e
`inspect_inference`. A UI não envia resultado, consumo ou um ID substituto.
O adaptador lê o recibo original pelo Core/autoridade, sem chamar outro modelo.

Pedido ausente, pendente, desconhecido, legado sem vínculo ou consulta indisponível
conserva `awaiting_reconciliation`. Com confirmação terminal válida, o serviço
libera apenas a continuação explícita; não repete a chamada original. Recusa
conhecida antes do envio produz `awaiting_host`. `waitingFor: protected-inference`
permite ao Navi explicar a espera por IA/responsável, sem confundir com sessão
gráfica ausente. Motor antigo sem capacidade não recebe fallback.

Cancelar conserva a intenção e a reserva enquanto o resultado for desconhecido.
Após inspeção confiável, finaliza como cancelado sem nova inferência. Uma chamada
conferida não libera ferramentas de sistema de resultado desconhecido. Inspeções
participam do ciclo de vida/ativação segura do serviço.

## Evidências e limites

Passaram **697 testes KidOS, com dois ignorados do legado**: identidade dedicada,
idempotência/CAS, limites, concorrência, reinício, dia UTC, consumo ausente/forjado,
stream incompleto e perda de confirmação antes/depois do commit.

No Alien Linux x64/UID 1000, nove casos usaram `SO_PEERCRED`, sockets reais,
banco privado e provedor simulado. Recusaram impersonação administrativa e da
conta de modelos, recuperaram recibos após SIGKILL e conservaram a reserva durante
SIGKILL de uma chamada ativa, sem repetir o provedor. O cliente Node 22.23.4 usou
o kit real contra o gateway Python em sucesso, resposta interrompida e recusa
de cota. Foram cinco chamadas simuladas e oito inicializações do gateway, com
uma reserva pendente preservada. A identidade dedicada na
chamada gateway→autoridade é simulada em processo, não uma execução instalada
como `kidos-model`; isso não qualifica proteção root do banco, Isaac ou Navi.

Relatório SHA-256:
`38486007e1d2df5948f9d40f838756a50894542591dd7bbfa1c0aea9eba48dd4`.
Arquivo KidOS: `build/protected-inference-client/native-u8glo3o0/evidence/report.json`;
doze fontes e o kit são vinculados por hash e conferidos em `verification.json`.
Nenhuma inferência real, credencial, conta, unidade permanente ou instalação mudou.

O kit empacotado passou em onze cenários de transporte; Standard/Deep, orçamento,
delegação e retomada de arquivos passaram com transporte simulado. O Companion
passou em 473 testes e 30 verificações do repositório, incluindo inspeção, intenção
de cancelamento e isolamento. Esses percursos separados foram seguidos por uma
qualificação conjunta, descrita abaixo; nenhum comprova instalação no Navi.

## Qualificação conjunta com UIDs reais

O harness `test/kidos-inference-harness.ts` e os helpers de qualificação do KidOS
compõem SDK TLS/IPC, serviço, grafo oficial, loader/assinatura de teste, adaptador,
gateway e autoridade no mesmo contêiner Linux. Root mantém banco, política e
arquivos assinados; gateway roda como UID 555 e cliente/serviço como UID 1000.
Os dois saltos usam `SO_PEERCRED` real, sem facade de identidade/autoridade.
O transporte preserva os caminhos fixos de produção.

Passaram **oito cenários**, incluindo Standard/Deep, chave idempotente, cliente
desconectado, política desligada, SIGKILL do serviço durante chamada ativa,
stream incompleto, inspeção/cancelamento após reinício e recusa de impersonação
ou edição dos arquivos root. Doze chamadas simuladas geraram doze débitos;
inspecionar/cancelar/reiniciar não repetiu o provedor. Intervenções root da fixture
fecharam as duas respostas desconhecidas sem devolver as reservas.

Evidência KidOS: `build/inference-composition/attempt-6/evidence/report.json`,
SHA-256 `c03f387159a54258c852e977795eaf84846e4958c8fc4168090fd8dba488b6c8`.
O manifesto verifica 52 entradas, 1.637 inputs atuais do bundle e os artefatos
públicos da assinatura. O contrato de reprodução fica em
`docs/PROTECTED_INFERENCE_COMPOSITION.md` no KidOS.

O Linux x64 roda sob emulação no Mac ARM64, com rede desligada. O provedor e o
contexto/apresentação final do desktop são simulados por wrapper assinado de teste;
ações de sistema são recusadas. O helper usa o código corrente do serviço e
Node/SQLite fixados, não um novo motor completo assinado de release. Nenhum
token, chave privada, banco ou checkpoint sai do contêiner. Não há aceite de
systemd instalado, modelo real, GTK, conta Isaac, desempenho físico ou release.

Ainda faltam qualificação da composição de release, workflow técnico protegido, decisão operacional,
corte do HTTP legado, instalação/rollback e aceite Navi/GTK/terminal. As guardas
KidOS de workflows, orçamento genérico e perfil v2 permanecem. Contabilização
reservada não é teto financeiro ou limite rígido de saída. O plano integral de
engines, assets, seis jogos, pedidos inéditos, dispositivos, playtests e
distribuição continua obrigatório.
