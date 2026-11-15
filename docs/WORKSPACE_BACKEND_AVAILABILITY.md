# Disponibilidade do backend do editor no Deep Agent

Estado em **2026-11-11**: correção em desenvolvimento no motor comum; sem nova
instalação ou release. Leia a [arquitetura](SUITE_ARCHITECTURE.md), o
[guia dos agentes](../AGENTS.md) e a [avaliação de jogos](GAME_GENERATION_EVALUATION.md).

## Falha observada e responsabilidade

A quinta continuação de `windmail`, run `0e4cd4ed…`, terminou com
`The editor backend is not registered.` Não alterou a revisão23 nem iniciou
produção. O perfil tinha workspace e Deep, mas nenhum método do editor registrado:
era um ensaio do SDK/serviço, sem uma janela do VS Code fornecendo ferramentas.

`packages/agent-core/src/workspace-backend.ts` reservava `/workspace/` no backend
Composite, mas lançava uma exceção se um método não estivesse no catálogo.
Uma chamada indisponível encerrava o grafo inteiro, inclusive quando ferramentas
de projeto de jogo estavam disponíveis. A correção pertence ao motor, sem novo
loop ou ferramenta de filesystem dentro das interfaces ou do SDK.

## Tratamento atual

| Condição | Comportamento |
|---|---|
| Método sem definição canônica de nome/host/efeito | Resultado V2 `{error}` antes de qualquer despacho; o grafo recebe a indisponibilidade |
| Escrita/edição/exclusão em modo Plano | Recusa antes do despacho, além das permissões oficiais do filesystem |
| Método registrado, host ausente | Fluxo existente de `awaiting_host`; a operação mantém sua identidade |
| Resultado de operação registrada desconhecido | Interrupção/reconciliação existente; não converter em erro repetível |

Os métodos retornam o formato de erro previsto pelo protocolo oficial. Não
aplicamos um `catch` geral sobre chamadas de host. A validação ocorre antes de
`context.invokeTool` somente para registro ausente ou escrita em Plano;
erros e recibos de operações registradas conservam seu tratamento anterior.
[Protocolo de backend](https://docs.langchain.com/oss/javascript/deepagents/backends#protocol-reference).

O mount `/workspace/` continua reservado, inclusive quando está indisponível.
Não cai no StateBackend, no disco local, no shell, em outro cliente ou no Core.
Arquivos de scratch fora do mount permanecem no estado/checkpoint do grafo e
não equivalem a arquivos do workspace, revisões de jogo ou provas de entrega.
Jogos persistentes usam as ferramentas `game_*` autorizadas do serviço.
[Backends e roteamento](https://docs.langchain.com/oss/javascript/deepagents/backends),
[permissões](https://docs.langchain.com/oss/javascript/deepagents/permissions).

`packages/agent-core/src/index.ts` acrescenta um aviso com os métodos realmente
registrados para esse run. Não descobre ferramentas, cadastra permissões nem
deriva autoridade de texto do modelo. A lista não substitui o registro
autenticado, as checagens do serviço e as decisões do host.

## Verificação

`test/workspace-backend.test.ts` exercita o grafo oficial e os backends reais:
leituras, listas, busca, escrita, edição e exclusão indisponíveis, scratch
preservado, leitura autorizada de projeto de jogo após a recusa, canário real no
disco intacto, registro parcial, Plano e leitor delegado. Com operação registrada,
verifica interrupção de resultado desconhecido, espera pelo host, reconexão da
leitura e um único recibo persistente no serviço. Inferência e host são simulados;
isso não demonstra editor instalado ou produção autônoma de um jogo completo.

Uma continuação real usa um novo motor congelado depois da qualificação e mantém
projeto, recibos, histórico, orçamento e relatórios falhos. Não reescrever o run
anterior como sucesso nem repetir efeitos desconhecidos para testar a correção.
