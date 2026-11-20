# Correio das Correntes: rota e recuperação observadas

Uma [integração manual posterior](GAME_WINDMAIL_SAVE_INTEGRATION.md) repetiu a
recuperação em revisão52 numa cópia. Este documento e os resultados do Luna51
original continuam históricos e inalterados no seu escopo.

Evidência de desenvolvimento em **2026-11-13**, sem nova inferência, instalação
ou release. Parte de GD-10 no [plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md).
Leia a [avaliação real](GAME_GENERATION_EVALUATION.md), o
[bloco Luna encerrado](GAME_GENERATION_ADDITIONAL_BLOCK.md) e as
[fronteiras da observação](GAME_BROWSER_OBSERVATIONS.md).

## Build preservado

Projeto `5006ab22-93d5-4991-b29f-dbd1f8e60bf7`, revisão **51**, fonte
`5ca8fa058fed726192bd7388a5184ec370ad3bc6e487ab3a7537cbe3b3e3f921`.
Build `dddaa502-8619-43f4-930c-4c64231cd2a5`, artefato
`ad5929167ea4fb0623c118e5d6a34cc053a9cbd405bc688ddcc94244fce56b0f`.
O run de geração original continua terminal por orçamento. Nada foi escrito em
seus arquivos, design, ledger, checkpoint, testes ou relatórios antigos.

O observador conferiu cada arquivo empacotado por tamanho/SHA-256 antes e depois,
além dos bytes do relatório original. Os diretórios são exclusivos; cada
observação conserva o script que corresponde ao hash registrado no controle.
As fontes auxiliares atuais são snapshots de reprodução, não um novo manifesto
assinado ou prova de todos os módulos carregados no início das observações.

## Método e limites

`scripts/observe-windmail-route.mjs` abre Chrome qualificado em perfil/HOME
descartáveis, sandbox habilitado e ambiente explícito sem credenciais de modelo.
Recursos, origens e dispositivos usam as mesmas barreiras do adaptador. A
observação usa teclado e PNGs compostos pelo navegador, sem `evaluate`, leitura
de variáveis de jogo, alteração de storage/clock, teleporte ou reparo da fonte.
O script não é ferramenta do modelo, novo executor ou coletor registrado.

O primeiro percurso enviava P e supunha a pausa. Capturas mostraram overlay e
movimento incompatíveis com essa suposição; ele foi encerrado e preservado. A
revisão seguinte usa Enter/P normais, mantidos por 40 ms, e captura a borda
visível do overlay antes/depois. A aparência da borda **não identifica sozinha**
introdução, pausa ou encerramento; as imagens foram revistas separadamente.

As manobras usam apenas setas, por no máximo 2 s de cada vez, liberando as teclas
antes da captura. Pausas entre quadros inspecionados são ações da interface do
jogo, sem mudar o relógio do simulador. Isso afeta o percurso; não é jogo
contínuo de uma pessoa nem teste de tempo/desempenho físico. Os 26/28 s exibidos
no final são valores da tela, não medição independente.

O observador guarda todas as entradas/imagens e exige `finish` explícito para
encerrar. EOF, deadline ou falta de confirmação não provam conclusão do jogo.
O resultado `OBSERVED` indica fim da observação e fechamento, nunca vitória,
qualidade ou aceite de uma receita. Replay é uma sequência limitada de JSON,
sem script dentro do jogo. O leitor de replay só é ligado após o bootstrap,
evitando perder entradas recebidas enquanto o navegador inicia.

## Resultados revistos nas imagens

Base: `output/playwright/windmail-route/`.

| Observação | Resultado visto | Interpretação |
|---|---|---|
| `20261113-a1` | 0/5; pausas não confirmadas e avanço entre quadros | Observador inicial insuficiente; não usar como falha de gameplay isolada |
| `20261113-a2` | 5/5, “Viagem concluída”, 1.463 pontos, duas colisões | Um ciclo completo alcançado por entradas normais |
| `20261113-a3` | Replay: 5/5, “Viagem concluída”, 1.693 pontos, zero colisões | O mesmo roteiro pode alcançar o encerramento, com trajetória diferente |
| `20261113-a4` | Mesmo roteiro: 4/5, 1.101 pontos, cinco colisões; depois R e reload voltaram ao início | Roteiro ainda não confiável; esta repetição não terminou e não prova persistência de recorde |
| `20261113-a5` | Rota parcial: 3/5, 898 pontos; reload/Enter: 0/5, zero pontos | Falha de recuperação do progresso prometido pelo design |

Nos três percursos completos planejados, dois alcançaram o fim. É uma amostra
pequena com pausas de observação; não estimar taxa de sucesso/diversão. A entrada
depende de tempo/colisão, por isso o roteiro falho permanece tão visível quanto
os resultados favoráveis. Não foi reexecutado até obter apenas vitórias.

As cinco observações não registraram console/recurso bloqueado. Browsers próprios
6008, 6397, 7119, 7447 e 7728 encerraram com código 0, desconectaram e tiveram
seus perfis/HOMEs removidos. Isso comprova o fechamento desses processos, sem
instalação de cliente, coleta física, inferência ou nova aprovação de qualidade.

## Divergência de save que exige correção

O design salvo declara versão 1, modo `persistent` e estratégia:
“Save current delivery progress, bonuses earned, and unlocked routes”. A revisão
da fonte pública mostra leitura/gravação apenas do recorde
`correio-correntes-best-v1`, sem snapshot/restauração de entregas, bônus ou rotas.

O teste de recarregamento não usou R antes de reload e não alterou o storage.
Sua imagem `36-route.png` mostra **3/5, destino Baía das Garças, 898 pontos**.
Após reload e a ação normal de iniciar, `38-reload-active.png` mostra **0/5,
Farol do Norte, zero pontos**. As imagens e seus hashes estão no dossiê. O design
não é atendido por conservar apenas um recorde. O ensaio a4 não concluiu a rota,
portanto seu recorde zero também não serve como teste de persistência após vitória.

Próxima correção necessária no jogo: preservar/restaurar o estado de domínio
prometido, com versão, validação, tratamento de storage indisponível/corrompido
e decisão explícita de reinício. Depois, repetir reload/fechar/retomar por ações
normais, além dos controles e do caminho completo, num novo build. Não diminuir
o design para esconder a divergência, substituir os relatórios antigos ou
creditar uma correção manual como geração autônoma.

Esta frente **não corrigiu a fonte** nem renovou o bloco Luna. O feedback de
continuação está preparado como arquivo, sem iniciar outra execução.

Uma frente posterior implementou o [runtime opcional de save](GAME_SAVE_RUNTIME.md)
e qualificou fixtures nas duas engines web. Isso fornece uma ferramenta de
implementação; a integração/correção neste jogo e a repetição desta regressão
continuam pendentes. O build observado aqui não foi substituído.

## O que ainda não está provado

- A falha anterior de `pause-resume` continua falha; estes percursos têm outra
  precondição de apresentação e não reclassificam aquele relatório.
- Os percursos concluídos não exercitaram uma mudança de vento visível; não
  comprovam os desafios de vento prometidos em todas as etapas.
- O asset `boat-art` continua marcado como placeholder; os demais flags não
  equivalem a arte/licença independentemente aprovada.
- Não há validação física de áudio/FPS/toque, consumidores de todos os browsers,
  dez pessoas, aprovação artística/humana, instalação, Unity ou integração Root.
- Esta é revisão externa do build exportado, sem registrar um relatório confiável
  no serviço ou mudar `quality.ready`. O produto integral continua pendente.

O [dossiê](../output/game-generation/windmail-route-20261113-a1/report.json)
reúne hashes de PNGs, controles/scripts, replay, revisão do design/fonte,
fechamento dos processos e verificações. As provas de comportamento do jogo são
as observações; testes determinísticos do repositório não as substituem.
