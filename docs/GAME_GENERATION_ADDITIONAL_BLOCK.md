# Continuação Luna com um bloco adicional autorizado

Desenvolvimento em **2026-11-13**. O [dossiê verificado](../output/game-generation/luna-additional-block-20261113-a1/report.json)
reúne autorização, fonte, contadores, quatro builds, 60 arquivos de evidência e
o diagnóstico externo. O usuário respondeu à solicitação
`call_d0816a9c4f7f412cbb3f7f07ad58208d`, autorizando mais um bloco de até
128 chamadas e 4.194.304 tokens, sem renovação automática. A escolha de modelo
anterior não foi interpretada como autorização; a nova resposta explícita é a
origem desta operação.

Leia os [limites do proprietário](OWNER_INFERENCE_LIMITS.md), a
[avaliação de geração](GAME_GENERATION_EVALUATION.md) e os
[orçamentos compartilhados](INFERENCE_BUDGETS.md). Esta é uma avaliação privada
de desenvolvimento, sem mudar instalações, provedores dos produtos ou autoridade
parental. Mac continua Ollama-only e KidOS mantém seu gateway protegido.

## Estado anterior e teto conservador

A inspeção somente de leitura confirmou o run Luna anterior `failed`, nenhum
run/job pendente e ausência dos processos/endpoint anteriores. O mesmo namespace
mantém 75 chamadas, 4.143.367 tokens cobrados/reservados e duas chamadas com uso
desconhecido. Nenhuma reserva foi devolvida, registro reiniciado ou identidade
recriada. O projeto segue sendo `5006ab22-93d5-4991-b29f-dbd1f8e60bf7`, com
fonte fornecida por recuperação; não é teste cego.

Somar simplesmente outro bloco de 128 à autorização antiga deixaria disponíveis
também as 53 chamadas antigas não usadas. O preparador limita o total para que
o teto de admissão novo não inclua esse saldo, usando a política existente
de dois blocos iguais e arredondamento para baixo:

| Limite no namespace | Valor |
|---|---:|
| Chamadas por bloco × dois blocos | 101 × 2 = 202 |
| Novas admissões disponíveis após a concessão exata | 202 − 75 = 127 |
| Tokens por bloco × dois blocos | 4.168.835 × 2 = 8.337.670 |
| Nova alocação disponível após a concessão exata | 8.337.670 − 4.143.367 = 4.194.303 |

Os limites efetivos ficam uma chamada e um token abaixo dos máximos autorizados.
As etapas mantêm 128/4.194.304 por bloco e máximo de dois; todas as chamadas,
inclusive especialistas e compactação, continuam submetidas também ao teto do
namespace. Uma mudança de etapa não cria outra alocação global. Uso informado
ou desconhecido segue o ledger original. Isso mede admissão/alocação, não fatura
ou um limite rígido de resposta imposto ao provedor.

## Preparação e execução

`scripts/prepare-generation-additional-block.mjs` verifica a avaliação original,
PID original/último PID, endpoint ausente, política privada exata, runs/jobs
terminais e budgets sem pendência, usando SQLite somente de leitura. Produz
intenção pública, backup privado da política e prova privada exclusiva. Só então
ativa atomicamente a política restritiva, confere os bytes e prova que as linhas
do ledger não mudaram. Não lê credencial de inferência, inicia serviço/modelo,
concede budget ou reenrola um cliente. Repetição da preparação é recusada.

`test/game-generation-allocation.ts` calcula o teto e verifica a prova pública/
privada, recibo final da preparação, política e identidade da continuação. Sem
essa prova, o guard anterior continua exigindo o único bloco original.

O driver de geração usa `--additional-allocation` e engine explícita verificada.
Mantém sessão/produto/workspace/provedor, checkpoints e os recibos existentes;
congela uma cópia da engine. Antes de iniciar outro run, reconfirma pela API os
contadores anteriores, fonte e ausência de trabalho desconhecido. Credencial
é lease temporário em memória e não entra no ambiente do serviço/worker.

A aprovação especial aceita somente um pedido de budget do run original atual,
idêntico ao snapshot bloqueado consultado novamente pela API, sob a política
verificada, no namespace ou etapa de projeto autorizado e ainda no primeiro
bloco. Não aprova ferramentas, credenciais, instalação, outro modelo ou terceiro
bloco. A política normal de ferramentas do ensaio permanece separada. Decisões
posteriores de etapa continuam subordinadas ao limite global e ao máximo de dois.

Preparação real:
[`luna-additional-block-20261113-a1`](../output/game-generation/luna-additional-block-20261113-a1/prepared.json).
Continuação iniciada:
`output/game-generation/windmail/2026-11-13T18-33-51-287Z-1271772d`, run
`ebed52c9-760d-4b29-9322-842b1b3e8ade`, serviço próprio 91456, engine
`e14ce1b4253e25416c37e627fdf1dd3102ac61c0ca728a7058cf05f683f2168f`.
GPT Luna é usado em todos os papéis, pela mesma rota OpenAI Chat Completions e
`reasoning_effort:none`. Esta seção registra início, não conclusão ou qualidade.
Inspeções autenticadas e relatório terminal devem ser consultados no diretório
da tentativa; um processo ainda ativo nunca deve ser reiniciado por timeout.

## Testes e limites

Passaram 759 testes, um opt-in ignorado e 40 verificações, incluindo a fronteira
anterior da continuação. O meter real preservou 75 chamadas e duas reservas
sintéticas anteriores, concedeu uma única continuação e recusou o terceiro bloco:
127 chamadas novas com uso mínimo informado, ou 63 reservas de uso desconhecido
antes do bloqueio por tokens. São testes determinísticos, sem inferência real.
A prova incompleta, pública, alterada, ligada a outro run ou com política divergente
foi recusada. Não é nova API pública, interface instalada ou permissão parental.

### Resultado terminal da continuação

O run terminou `failed` por orçamento, sem renovação, na revisão 51, fonte
`5ca8fa058fed726192bd7388a5184ec370ad3bc6e487ab3a7537cbe3b3e3f921`.
Foram 58 chamadas novas com uso informado. O namespace conserva 133 chamadas
totais e as duas reservas desconhecidas anteriores, nenhuma pendência, e
8.343.431 tokens cobrados/reservados. O consumo novo informado soma 4.200.064:
**5.760 acima dos 4.194.304 autorizados**, porque a última resposta já admitida
superou a reserva. A política recusou a chamada seguinte; não limita o tamanho
real de uma resposta em andamento no provedor. Esse excesso permanece registrado,
sem desconto, outra concessão ou promessa de teto financeiro. A reserva fixa é
uma limitação relevante a corrigir antes de novas avaliações com teto estrito.

A [reserva por tamanho do pedido](INFERENCE_REQUEST_RESERVATIONS.md) foi
acrescentada depois, em fonte/pacote de desenvolvimento, e qualificada com
respostas simuladas. Reduz a limitação da reserva fixa, mas não garante teto
rígido de tokens/faturamento nem altera estes registros. Não houve outro bloco
real ou instalação por causa dessa correção.

Luna alterou quatro revisões e produziu/coletou quatro builds. No último, boot
e console passaram, dois de três cenários passaram e `pause-resume` falhou.
Os PNGs “paused”/“resumed” mostram a tela introdutória; o trace envia Enter/P
antes da primeira captura nesse cenário. Isso sugere uma questão de prontidão
da entrada; o diagnóstico pareado descrito abaixo não reclassifica o relatório
nem apagar seus checks. Os cenários de navegação/toque têm observações limitadas,
sem comprovação semântica do jogo completo. Placeholders e os demais gates
continuam pendentes; `quality.ready` e `fullProductAcceptance` são falsos.

O observador terminou com código 1 após gravar o relatório. Uma auditoria local
somente de leitura confirmou o PID 91456 ausente, endpoint ausente e zero runs/
jobs pendentes, sem reiniciar o serviço. O driver não gravou o exit code específico
do filho: não o inventar a partir da ausência. Estado/identidade/ledger privados
permanecem preservados. Consulte `report.json`, `run.json`, `closure-audit.json`,
builds/relatórios/exportações da tentativa e o dossiê da alocação. Não houve
instalação ou publicação, terceiro bloco, aceitação humana ou física.

### Diagnóstico posterior de entrada, sem IA

`scripts/diagnose-game-input-startup.mjs` conferiu o mesmo artefato final
`ad5929167ea4fb0623c118e5d6a34cc053a9cbd405bc688ddcc94244fce56b0f`
e executou três pares de contextos novos. Cada par usa a sequência Enter/P,
captura, espera de 500 ms, comparação inalterada, P e comparação alterada. Um
grupo começa imediatamente após load; o outro acrescenta uma captura normal
do canvas antes da primeira tecla. Não edita fonte, receita, clocks, storage,
objetos do jogo ou relatórios antigos.

Nas três entradas imediatas, a comparação final permaneceu zero e as imagens
continuam na introdução. Nas três entradas após a captura inicial (129–137 ms
observados), a pausa ficou visualmente estável e a retomada mudou 29,04% dos
pixels segundo o comparador existente. As imagens conferidas mostram “VIAGEM
EM PAUSA” e depois a cena navegável. Nenhum erro/recurso bloqueado. Isso demonstra
a dependência desse resultado do momento de entrada, sem inferir prontidão de
todo jogo pela mera existência de um canvas. Não certifica todos os controles
ou reclassifica a coleta anterior. O roteiro de pausa precisa explicitar sua
precondição de apresentação; testes de entrada precoce devem continuar distintos.

Resultados em `input-startup-diagnostic/` dentro da preparação pública. O
navegador próprio 93324 terminou com código 0, desconectado e HOME removido.
Fonte/build/relatório originais foram conferidos novamente e ficaram intactos;
nenhum serviço, inferência ou novo coletor foi usado.

### Rota e recarregamento observados depois

As [observações externas da revisão51](GAME_WINDMAIL_ROUTE_OBSERVATIONS.md)
alcançaram 5/5 em dois percursos, mas o mesmo replay também ficou em4/5. Um
ensaio separado mostrou 3/5 e898 pontos antes do reload, depois0/5 e zero,
contrariando a estratégia de save do design. Fonte/build/relatórios anteriores
continuam intactos; sem IA, correção de fonte ou outra renovação. O encerramento
do jogo foi observado, mas qualidade e recuperação continuam pendentes.
