# Parecer visual sobre imagens de jogos

Fonte de desenvolvimento, **2026-11-13**. `game_review_image` conecta uma PNG
salva ao papel de visão configurado no motor comum. O resultado é texto de
orientação, não aprovação de qualidade, teste de jogabilidade ou nova captura.
Leia a [integração do executor](GAME_AGENT_PRODUCTION.md), os
[relatórios](GAME_REPORT_READS.md) e os [limites de inferência](OWNER_INFERENCE_LIMITS.md).

## Contrato e fronteiras

`packages/contracts/src/game-image-review.ts` recebe `focus` (1–2.000 caracteres)
e uma referência estrita:

- Projeto: `kind: project`, `projectId`, `revision` positiva e `path` relativo.
- Relatório: `kind: report`, `reportId` e `path` registrado naquele relatório.

Não aceita bytes, URL, caminho do host, alias de modelo ou provedor nos argumentos.
O serviço resolve namespace e revisão imutável. Relatórios preservam revisão/hash
de fonte e build/artifact originais, mesmo quando o projeto já mudou. O vínculo
devolvido contém essas identidades, caminho, MIME, tamanho, SHA-256 e dimensões;
não expõe o identificador privado de transferência.

O preparador exige PNG de 8 bits, até **2 MiB**, dimensões máximas de **4.096 ×
4.096** e até **4.194.304 pixels**. Confere bytes, SHA-256, cabeçalho, CRC e
inflação limitada antes de enviar. Incompatibilidades preservam os originais,
sem conversão, redução, corte ou reparo silencioso. Não há acesso a webcam,
tela, microfone, rede arbitrária ou filesystem genérico.

## Execução, privacidade e autoridade

O Agent Core faz uma chamada limitada com `BaseChatModel.invoke`, dentro da
ferramenta do grafo oficial. O serviço mantém o mesmo recibo persistente da
invocação. Não há agente, scheduler ou loop adicional na interface, SDK ou pacote
de conhecimento Game Design.

Um `HumanMessage` privado contém foco, vínculo e imagem original; a resposta
retorna ao grafo como **texto** de ferramenta. Isso preserva Chat Completions:
imagens não são colocadas em mensagens `tool`. O payload de imagem não entra
no checkpoint/histórico do grafo pai, recibo ou evento público. O helper herda
callbacks, cancelamento e alocação do run/etapa, com tag `nostream`; não publica
deltas próprios. Somente parecer e vínculo fazem parte do resultado persistido.
O provedor recebe a imagem pela conexão já autorizada ao produto; suas políticas
próprias de retenção não são redefinidas por esta função.

O papel `vision` precisa estar explicitamente configurado. Capacidade declarada
como incompatível é recusada; faltar modelo retorna diagnóstico conhecido, sem
alias, provedor ou API alternativos. O Mac continua **Ollama somente**. Uma
declaração de capacidade não prova interpretação adequada pelo modelo real.

O mesmo orçamento contabiliza supervisor, especialistas e parecer visual.
Faltar saldo não concede bloco novo. Falha desconhecida após despacho conserva
recibo/uso desconhecidos e exige reconciliação; replay não repete a inferência
automaticamente. Parecer vazio ou acima de 16 KiB é recusado, sem truncamento.
Imagem/texto são dados não confiáveis, nunca instrução ou autoridade.
`qualityApproved` permanece `false`; o parecer não escreve no projeto.

`game-visual-opinion-v1` indica suporte do serviço comum Mac/VS Code, não
disponibilidade de modelo ou aceite instalado. **KidOS é excluído**: precisa de
contrato e integração próprios com o adaptador protegido/Core. Esta frente não
habilita Navi v2, shell, Docker ou permissões parentais.

## Verificação e limites

`test/game-image-review.test.ts` cobre PNG/limites/CRC, argumentos, namespace,
relatório histórico, Standard/Deep, imagem no `HumanMessage`, resposta textual,
privacidade, orçamento compartilhado, replay, configuração ausente e falha
desconhecida. Os modelos são simulados; não há avaliação artística nesses testes.

`scripts/qualify-game-image-review.mjs --engine=<diretório-exato>` verifica o
manifesto e usa seu serviço temporário, SDK/TLS/IPC e grafos oficiais com HTTP/SSE
local determinístico. Confere serialização, vínculos, três chamadas por modo,
cotas, privacidade, replay sem novas chamadas e encerramento do serviço próprio.
Não usa credenciais externas. Falhas e estado privado são preservados; não
reaproveita geração antiga. A primeira fixture reutilizou uma chave de run em
duas sessões e foi corretamente recusada; a correção usa uma chave por modo,
mantendo o teste de replay exato e sem alterar o serviço.

O [dossiê](../output/game-generation/visual-opinion-20261113-a1/report.json)
registra pacote e verificações. Ainda faltam inferência visual real, circuito
completo de melhoria do jogo, aceite dos clientes nativos instalados,
dispositivos físicos e pessoas. Nada aqui renova a alocação esgotada da avaliação
Luna ou conclui o plano integral de Game Design.

Referências: [modelos LangChain](https://docs.langchain.com/oss/javascript/langchain/models)
e [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
