# Maré a Dois

Referência autoral de cooperação local em Godot, em desenvolvimento. Dois
jogadores controlam remos diferentes do mesmo barco: remar juntos avança;
remos opostos giram; remar para trás freia ou recua. O sucesso depende da
coordenação, sem servidor, contas online, IA ou controle remoto.

**Tese visual:** uma carta de marés ilustrada em azul profundo, papel claro e
cobre; o barco e os dois remadores são o foco, com portos luminosos legíveis.
**Conteúdo:** abertura e papéis dos jogadores → doze travessias em três
arquipélagos → três entregas por travessia → final, mapa e novos melhores tempos.
**Interação:** remos animados independentemente, esteira que revela a física
e luz de porto que acolhe uma chegada; efeitos reduzidos não alteram a navegação.

As fontes de regras, apresentação, persistência e QA permanecem separadas.
Scripts Godot, inclusive testes, só podem ser executados na imagem isolada
provisionada, sem home, credenciais, rede ou socket Docker montados. Rotas e
controladores de QA não entram no jogo ou na fonte importada para o build.

Esta referência não conta como entregue antes da qualificação da campanha,
controles simultâneos, pausa/save, build e exportação pelo serviço. Não é jogo
gerado autonomamente pelo modelo, teste com pessoas ou aceite físico/artístico.
O plano continua exigindo os quatro adaptadores e os seis jogos aprovados.


## Qualificação de desenvolvimento em 2026-11-13 UTC

A imagem Godot 4.7.2 previamente provisionada executou as regras das doze rotas:
controle externo dos remos completou todas, com zero colisões. Passaram os casos
de cadência fixa, remos opostos e entrada inválida. Isso é teste de regras, sem
pessoas, renderização física ou driver de QA dentro do jogo.

A cena nativa isolada exerceu botão inicial, dois pares de teclas, dois contatos
simultâneos em coordenadas locais, liberação, pausa/foco, save/reload e geração
da partitura PCM. O primeiro roundtrip falhou: o JSON mudou um número em poucas
unidades de precisão; o save usa precisão completa e o teste exige diferenças
absolutas abaixo de 1e-9, conservando flags e campos obrigatórios. Falhas anteriores,
a correção da indentação do teste e o ajuste das coordenadas do viewport estão
preservados. O ambiente nativo headless informa ausência de fontconfig; não é
prova do áudio ou das fontes no hardware físico.

Build web, receitas canônicas de boot/controle/pausa, exportação editável e
reinício do serviço passaram em
`output/playwright/mare/runs/2026-11-13T03-27-00-513Z-68999ae4/`.
Capturas desktop/retrato foram inspecionadas; símbolos ausentes na fonte fallback
foram substituídos por rótulos legíveis e marca de chegada desenhada em código.
O build anterior com quadrados permanece na tentativa anterior. Os testes
independentes são operados pelos scripts `scripts/qualify-mare-rules.mjs`
(`--suite=rules|scene`) e `scripts/qualify-game-mare.mjs`, após compilar os testes
e o motor com Node 22.23.4. Não há download ou instalação automática de Godot.

A campanha completa foi observada por teclas usuais, com final e mapa de doze
rotas recuperado após reload. Dois contatos emulados, liberação parcial,
cancelamento, pausa, mute e checkpoint também passaram. O observador permaneceu
fora do jogo; as falhas de leitura de pixels/protocolo foram preservadas.
Scripts: `scripts/qualify-mare-campaign.mjs --attempt=<ensaio>` e
`scripts/qualify-mare-touch.mjs --attempt=<ensaio>`. Leia o
[método e as evidências](../../../docs/GAME_MARE_QUALIFICATION.md).

**Ainda falta:** gamepads físicos, duas pessoas reais, audição/mix e desempenho
físicos, carregamento no perfil do plano, matriz de browsers/dispositivos e
aceite artístico/humano. A campanha observada é evidência técnica, não aceite
Poki ou geração autônoma. O jogo não está distribuído/instalado como release.
