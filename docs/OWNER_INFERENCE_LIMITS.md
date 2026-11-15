# Limite restritivo de inferência no serviço

Fonte e qualificação de desenvolvimento em **2026-11-13 UTC**. Leia os
[orçamentos compartilhados](INFERENCE_BUDGETS.md) e a
[arquitetura da suíte](SUITE_ARCHITECTURE.md). Não é configuração de provedor,
permissão de ferramenta, autoridade parental ou mudança em instalações existentes.

## Provisionamento

O processo do serviço pode ler `inference-limits.json` no seu diretório privado
de estado, antes de abrir bancos, aceitar clientes ou executar modelos.
A configuração é do proprietário do serviço, não de `RunSpec`, parâmetros de
ferramentas, prompts ou valores enviados pela interface.

```json
{
  "schemaVersion": 1,
  "policy": {
    "namespace": {"callsPerBlock": 128, "tokensPerBlock": 4194304, "maxBlocks": 1},
    "stage": {"callsPerBlock": 128, "tokensPerBlock": 4194304, "maxBlocks": 1},
    "unknownTokensPerCall": 65536
  }
}
```

Essa configuração restringe cada namespace a um bloco, inclusive quando o agente
abre outra sessão, troca de projeto ou avança uma etapa. Subagentes e chamadas
de compactação continuam usando a admissão comum existente. Não há outra
contabilidade nem um loop de execução no leitor da configuração.

Cada campo de chamadas, tokens por bloco e blocos precisa ser menor ou igual ao
default compilado; a reserva de uso desconhecido não pode ser reduzida. O schema
é estrito, com no máximo 16 KiB, leitura UTF-8 e pelo handle verificado. Arquivo
público, symlink/hardlink, tipo inesperado, conteúdo alterado durante a leitura ou
configuração inválida recusam o bootstrap. O diagnóstico não inclui o conteúdo.
Em POSIX, o arquivo pertence ao UID real do serviço e não tem permissões de grupo/
outros. Windows conserva a fronteira do diretório privado e as verificações de
arquivo; não se apresenta uma simulação de bits Unix como prova de ACL Windows.

Ausência mantém o comportamento anterior. Uma configuração presente inválida
nunca produz fallback para defaults. O processo captura a política no bootstrap;
não há recarga automática nem RPC para editar esse arquivo. Mudança ou remoção
exige operação explícita do proprietário e próxima ativação segura. Os ledgers
continuam persistidos: alterar configuração não apaga chamadas ou devolve consumo.

`owner-inference-limits-v1` identifica o suporte para clientes comuns. O valor
efetivo aparece em `inference.budgets.get`, no namespace autenticado. A capacidade
não é anunciada ao KidOS; Core, gateway e políticas protegidas continuam sendo
as autoridades dos limites infantis. Um arquivo da sessão não concede aprovação
parental nem amplia essas decisões.

## O que o limite mede

`callsPerBlock` limita admissões de invocações do motor pelo mecanismo comum.
Não é uma promessa de número de pacotes HTTP ou uma mudança nos retries oficiais
do SDK. O consumo de tokens mantém a reserva por chamada e os recibos existentes:
com o [cálculo por pedido](INFERENCE_REQUEST_RESERVATIONS.md), a reserva pode
ser maior que o piso provisionado, sem ampliar os limites autorizados;
uso real informado é contabilizado integralmente, e uso desconhecido conserva
reserva. Uma resposta já admitida pode ultrapassar sua reserva/alocação; chamadas
seguintes são bloqueadas. Não descrever a alocação como medição de fatura ou como
um limite rígido imposto ao provedor.

`maxBlocks:1` não autoriza renovação. Também não permite recuperar como zero o
saldo de uma avaliação antiga perdida. Uma nova avaliação de recuperação exige
autorização explícita e mantém origem/resultado/saldo legados como desconhecidos.

## Evidências e limites

A [continuação Luna explicitamente autorizada](GAME_GENERATION_ADDITIONAL_BLOCK.md)
prepara uma política privada de no máximo dois blocos, preservando o ledger e
reduzindo o total para não somar saldo antigo à autorização nova. Prova incompleta
não autoriza execução; a confirmação do budget usa a API existente. Não muda
defaults compilados, política instalada dos produtos ou autoridade KidOS.

`test/inference-limits.test.ts` verifica ausência, schema, recusa de ampliação,
privacidade do diagnóstico, arquivo inseguro/grande, admissão por namespace,
concorrência, reinício, uso desconhecido e impossibilidade de renovação.
Os testes existentes de grafo/orçamento continuam aplicáveis.

`scripts/qualify-owner-inference-limits.mjs` executou o Node/serviço empacotados,
SDK/TLS e os grafos oficiais Standard/Deep com SSE local simulado:

- Duas respostas por namespace, em sessões distintas.
- Reinício do serviço com o mesmo estado/identidade.
- Terceira invocação bloqueada antes do provedor, sem mais pedidos HTTP,
  sem devolução de chamadas/tokens e sem aprovação de outro bloco.
- Configuração inválida recusada antes de alterar o banco; conteúdo não exposto.

O ensaio está em
`output/game-generation/owner-limit-native/2026-11-13T02-21-44-127Z-d58916cd/`.
Não é inferência real, composição KidOS, instalação de aplicativo ou prova nas
cinco plataformas. O pacote de desenvolvimento permanece separado das releases.
