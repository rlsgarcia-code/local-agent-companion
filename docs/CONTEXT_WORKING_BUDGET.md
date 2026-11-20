# Contexto de trabalho do motor

Fonte de desenvolvimento qualificada em **2026-11-13 UTC**. Leia a
[arquitetura](SUITE_ARCHITECTURE.md), a [janela efetiva do modelo](MODEL_CONTEXT_WINDOWS.md)
e os [limites de inferência](OWNER_INFERENCE_LIMITS.md). São três controles
distintos: capacidade informada do modelo, alvo de compactação e alocação de IA.
Este trabalho não altera instalações nem a autorização de uma avaliação real.

## Configuração opcional do proprietário

O serviço lê `context-working-budget.json` no seu diretório privado de estado,
antes de abrir os bancos e aceitar clientes. Exemplo de configuração de teste:

```json
{
  "schemaVersion": 1,
  "policy": {"triggerTokens": 4096, "keepTokens": 1024}
}
```

O gatilho deve ser inteiro de 2.048 a 131.072; a retenção, de 512 a 32.768 e
no máximo metade do gatilho. Esses intervalos são validação, não recomendação
universal de qualidade. O arquivo é estrito, UTF-8, limitado a 16 KiB e lido pelo
handle verificado. Recusa links, tipo inesperado, alterações durante a leitura
e, em POSIX, dono diferente do UID do serviço ou permissões de grupo/outros.
No Windows permanecem as verificações de arquivo e a fronteira do diretório
privado; o ensaio em macOS não certifica ACLs Windows.

Ausência mantém os defaults anteriores. Arquivo presente inválido impede o
bootstrap, preserva os dados e não expõe seu conteúdo no diagnóstico. Não há
recarga automática nem RPC ou formulário de UI para editar esse arquivo. Uma
mudança requer próxima ativação segura pelo proprietário, sem cancelar trabalho
automaticamente. Nenhuma configuração foi escrita nos serviços pessoais ou
na avaliação Luna para executar esta qualificação.

`engine.info` informa a política carregada (ou `null`) e a capacidade
`context-working-budget-v1` aos clientes Companion comuns. O campo não entra
em `RunSpec`, na declaração de janela, nas opções HTTP ou nas ferramentas do
modelo. Entradas forjadas pelo cliente são recusadas pelo schema existente.
KidOS não recebe essa capacidade/política e não a aplica às execuções protegidas;
configuração administrativa própria continua pendente. Não concede autoridade
parental, ferramentas, modelos ou provedores adicionais.

## Execução e retenção

Os grafos Standard e Deep continuam usando os middlewares oficiais LangChain/
DeepAgents. Cada pilha Deep tem sua própria instância; o mesmo alvo opcional
chega ao supervisor e aos especialistas sem compartilhar o estado da closure.
Não há segundo agente, contador de quota, algoritmo de resumo ou checkpoint.

Quando existe `model.profile.maxInputTokens` válido, o gatilho é o menor valor
entre o alvo e 85% dessa capacidade. A retenção é limitada pelo alvo, metade do
gatilho e 10% da capacidade conhecida. Sem perfil conhecido, usam-se os alvos
explícitos, sem inventar capacidade por nome do modelo. O perfil permanece
inalterado. A biblioteca estima o contexto pelos seus mecanismos nativos;
o alvo não é um teto rígido para todos os tokens de system prompt, ferramentas,
anexos, resumo e resposta. A política também não garante que todo pedido caiba.

O resumo mantém a marca oficial `nostream`, os callbacks herdados e a
contabilização/reserva comuns. Toda chamada de compactação consome a alocação
de IA; maior frequência pode aumentar o número de chamadas. A fonte não acrescenta
truncamento de argumentos, corte de relatórios ou descarte de arquivos para
atingir o alvo. O middleware nativo conserva seu tratamento próprio de overflow.
Deep mantém seu histórico virtual e o saver oficial conserva checkpoints;
arquivos de domínio não são apagados ou filtrados por prefixos inventados.
Resumo privado e estado interno não viram mensagens ou resultados públicos.

O serviço captura a política em recibo privado, na mesma transação de admissão,
para `runs.start` e `desktop.start`. Retomada após reinício usa esse valor original.
Trocar a política do proprietário não retargeta um run existente. Runs legados
sem recibo permanecem sem política, mesmo após sua ativação para runs novos.
O recibo não faz parte de snapshots públicos nem da importação de autoridade.

## Evidências e limites

`test/context-working-budget.test.ts` confere o leitor seguro, recusa de valores
e permissões, captura transacional, isolamento KidOS e retomada Mac em espera
por host após mudança da política, incluindo runs legados. A fixture Mac usa
runtime de gravação, não uma janela gráfica nem inferência real.

`test/graph-working-context.test.ts` usa os grafos e SQLite oficiais. SSE local
simula os dois modos sem perfil e com janela declarada menor que o alvo. Confere
resumo privado no snapshot inteiro, corpo HTTP, contabilização e replay concluído
sem outra inferência. Os checkpoints históricos conservam os marcadores originais.
Uma reprodução Deep com especialista sem perfil observou:

| Observação simulada | Defaults anteriores | Alvo de teste 4.096/1.024 |
|---|---:|---:|
| Maior histórico de mensagens em caracteres | 41.959 | 8.291 |
| Chamadas normais | 19 | 19 |
| Chamadas de resumo | 0 | 5 |
| Admissões/liquidações | 19/19 | 24/24 |
| Leituras originais, sem repetição | 16 | 16 |

Caracteres são a projeção JSON do conteúdo das mensagens, não o prompt completo,
tokens faturados, custo ou qualidade. Esse ensaio não mede Luna real.

`scripts/qualify-working-context-engine.mjs --engine=<bundle-exato>` executa um
bundle de desenvolvimento explícito e verificado, com Node empacotado, SDK/TLS,
Standard/Deep e SSE local. Passou em
`output/game-generation/working-context-engine/2026-11-13T07-16-20-421Z-f30de991/`:
cinco pedidos sintéticos, resumos fora do snapshot inteiro, recibos antigos
preservados após mudança/reinício, repetição concluída sem inferência e política
nova só para run novo. Um arquivo malformado recusou o bootstrap, sem ecoar o
conteúdo nem apagar recibos. Bundle íntegro e processos próprios encerrados.

Manifesto desse bundle de desenvolvimento:
`b92b94f355c434e4e780ea1c2b21dca010b17db43366d8010f943e59dd8d646c`,
Node22.23.4, darwin-arm64. Passaram typecheck, builds Mac/extensão/motor,
682 testes, um opt-in ignorado, 31 verificações de repositório e roteamento
Chat Completions local simulado. Não é uma release assinada ou aceite de outra
plataforma. O aviso de empacotamento `require.resolve` do resvg permanece no log;
não foi convertido em afirmação de falha de execução nem omitido das evidências.

Dossiê: [fontes, hashes e logs](../output/game-generation/working-context-20261113-a1/report.json).
As tentativas iniciais EPERM sem permissão de sockets locais e uma leitura de
recibo pela fixture com o objeto de credencial em vez do registro estão preservadas;
o produto não teve seus controles relaxados para corrigi-las.

A avaliação real **Correio das Correntes** permanece na revisão 47 e no limite
do bloco previamente autorizado, com GPT-6 Luna selecionado. Não houve chamada
real, alteração de ledger, nova identidade, instalação ou publicação neste trabalho.
Nova inferência, qualidade do jogo, interfaces nativas instaladas, KidOS protegido,
outras plataformas e economia com o provedor exigem suas próprias provas.

Referências: [middleware Standard oficial](https://reference.langchain.com/javascript/langchain/index/summarizationMiddleware)
e [fonte oficial Deep](https://github.com/langchain-ai/deepagentsjs/blob/main/libs/deepagents/src/middleware/summarization.ts),
comparadas à versão `deepagents` 1.15.0 e às dependências resolvidas do lock.
