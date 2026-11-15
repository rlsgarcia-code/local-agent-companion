# Metas numéricas proporcionais de playtest

Correção de fonte e evidência local de **2026-11-13**, GD-10 do
[plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md). Complementa
[playtests locais](GAME_PLAYTESTS.md) e
[qualidade e comprovação](GAME_PRODUCTION_API.md#qualidade-e-comprovação).

## Defeito e regra compartilhada

O resumo de estudos já considerava todos os registros ativos e exigia 80% de
compreensão e 70% de notas positivas, arredondados para pessoas inteiras acima.
A avaliação de relatórios de qualidade ainda usava os números fixos oito e sete,
mesmo se o relatório declarasse um grupo maior. Uma regressão com 11 participantes
e oito/sete resultados positivos foi indevidamente aprovada antes da correção.
`regression-before.log` conserva essa falha. São relatórios sintéticos de teste,
não um jogo real aprovado indevidamente.

Agora [a política pura](../packages/game-design/src/playtest-targets.ts) é usada
pela avaliação de qualidade e pelo resumo dos estudos no serviço:

| Participantes ativos | Compreensão em até 30 s | Nota de pelo menos 4 |
|---|---:|---:|
| 10 | 8 | 7 |
| 11 | 9 | 8 |
| 19 | 16 | 14 |
| 20 | 16 | 14 |
| 21 | 17 | 15 |

O mínimo permanece dez. Contagens precisam ser inteiros seguros, não negativos
e não superiores ao grupo. A aritmética usa décimos inteiros para arredondar para
cima sem perder precisão. Os testes com `Number.MAX_SAFE_INTEGER` conferem só
essa propriedade matemática: não ampliam o limite de mil registros por estudo
ou comprovam a plausibilidade de um grupo declarado.

O pacote `game-design` continua sem IO, agentes ou autoridade. A política recebe
números e devolve limites/resultados numéricos. O serviço conta os registros;
interfaces continuam lendo o resumo existente, sem outra regra na UI. Não há
novo RPC, formato de banco, migração de respostas ou alteração de permissões.
Leituras da avaliação passam a recusar grupos maiores abaixo das proporções.
Históricos, recibos e versões anteriores não são reescritos para mudar resultados
já registrados.

## Fronteira de qualidade preservada

Compartilhar o cálculo não compartilha evidência ou autoridade:

- Estudos continuam `operator-attested` e `qualityApproved:false`; não entram
  em relatórios de coletor, eventos de inferência ou ferramentas do agente.
- A avaliação de qualidade continua exigindo coletor autorizado, build/revisão/
  hashes exatos, escopo humano, consentimento declarado e as demais categorias,
  cobertura e medidas físicas. A regra numérica sozinha não produz `ready`.
- Retirada mantém tombstone e exclui a resposta da contagem ativa. Replay do
  pedido original não restaura respostas ou pontuação.
- Não se selecionam os dez melhores registros para ignorar os desfavoráveis.
  Confirmação de pessoas distintas, consentimento e revisão humana permanecem
  verificações próprias; o software não as demonstra com contadores.
- O KidOS continua recusando coleta infantil sem a integração qualificada dos
  responsáveis. Nenhuma capacidade Navi ou autorização parental foi acrescentada.

## Qualificação

Passaram **750 testes de aplicação e 40 verificações do repositório**, com um
opt-in ignorado, além dos dois typechecks. Os testes puros cobrem os grupos da
tabela, notas/compreensão abaixo da proporção e contagens inválidas. Uma referência
independente com `BigInt` confere os limites de zero a mil e no inteiro seguro
máximo. O teste do serviço conserva vinte observações, inclusive as desfavoráveis,
sem gerar relatório de qualidade.

Foi construído um novo motor independente, sem reescrever o anterior:
`1.0.2` de desenvolvimento, Node `22.23.4`, `darwin-arm64`, 481 payloads,
manifesto `56d62877afecf704e90d916930ecfca54cd3a45788c8ec4dd08caa66211207c2`.
Seu inventário de dependências inclui a política compartilhada, sem framework UI.

O [runner por API](../scripts/qualify-playtest-targets.mjs) usa esse Node/serviço,
TLS/IPC/SDK reais e dois namespaces autenticados Mac/VS Code, em estado privado.
Cada namespace importa a fixture pública existente, produz um build Phaser real
e cria duas rodadas inteiramente sintéticas de vinte registros:

1. Oito/sete positivos não atingem as metas de 16/14.
2. Dezesseis/quatorze atingem apenas as metas numéricas. `ready` continua falso,
   sem relatórios de qualidade criados.
3. Retirar um registro positivo deixa 19 ativos, 15/13 positivos; as metas
   continuam 16/14 e deixam de ser atingidas.
4. Após reiniciar o serviço, resumos/tombstones permanecem iguais. Replay do
   registro original retorna a retirada, sem duplicação ou ressurreição.

Os processos `65846` e `65849` encerraram com código zero, e só depois o estado
privado foi removido. O bundle foi reverificado. Fonte, hashes, falha anterior,
resultados e encerramentos estão no
[dossiê](../output/game-generation/playtest-targets-20261113-a1/report.json).

Esta prova não inclui pessoas, consentimento real, janelas ou clientes instalados,
hardware, qualidade artística, licença Unity ou execução Root/Navi. Não houve
inferência ou renovação de orçamento. Assinatura/distribuição oficiais e todo o
aceite integral do plano continuam pendentes.
