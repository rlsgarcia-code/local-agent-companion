# Correio das Correntes: recuperação da viagem

Uma [observação posterior da campanha completa](GAME_WINDMAIL_CAMPAIGN_OBSERVATIONS.md)
exercitou conclusão, recorde, mute e vento no mesmo build. Seus percursos e limites
são separados do teste inicial de3/5 descrito aqui; não alteram o Luna51 original.

Integração manual em fonte de **2026-11-13**, posterior ao ensaio Luna. O bloco
autorizado terminou; esta alteração usa **zero inferência adicional**. Não é nova
geração autônoma, instalação ou aprovação de qualidade.

O [dossiê](../output/game-generation/windmail-save-integration-20261113-a4/report.json)
vincula o mesmo projeto à revisão52 **somente numa cópia privada de teste**.
A revisão51 original, builds, relatórios e ledger continuam intactos. A
[regressão original](GAME_WINDMAIL_ROUTE_OBSERVATIONS.md), que perdeu3/5 cartas
ao recarregar, continua registrada no artefato antigo.

## Implementação e fronteiras

[Fontes](../examples/game-integrations/windmail-save/README.md): codec de domínio,
coordenador de checkpoints e interface dentro do jogo exportado. Usam o
[runtime opcional fixado](GAME_SAVE_RUNTIME.md), sem agente ou ponte do host.
Game Design continua conhecimento/perfis; SDK/serviço constroem e exportam;
o navegador guarda o estado de gameplay.

Estado: barco/velocidade/vela, vento/ciclo, tempo, cartas, pontos, sequência,
colisões, término, recorde e mute. Checkpoints: cinco segundos ativos, entrega,
pausa, vela e mute. Escritas serializadas/coalescidas usam snapshot atual e último
stamp confirmado. “Salva” só aparece após confirmação. Conflito não autoriza
sobrescrever; retry exige o mesmo stamp.

Ao abrir: carregamento, resumo e decisão de continuar. Nova viagem pede confirmação
e mantém o recorde. Erros oferecem retry ou jogar sem salvar; descarte de dados
inválidos exige decisão explícita e stamp conhecido. Recorde antigo válido em
localStorage é preservado, sem inventar progresso antigo. Restaurar mute não abre
áudio; iniciar/reiniciar por gesto o libera. DOM usa foco visível, Tab, contraste,
botões grandes e reduced-motion. Física, mapa e arte não foram ajustados para
fazer o percurso passar.

## Construção isolada, sem novo orçamento

`scripts/qualify-windmail-save.mjs` exige processo/endpoint originais ausentes e
runs/jobs terminais. SQLite readonly backup copia só metadados; checkpoints e
chaves TLS originais não são copiados/lidos. Nova identidade TLS e credencial com
**providers/ferramentas vazios** mantêm o namespace produto/perfil/workspace.
Política de inferência igual, sem conceder blocos ou iniciar runs.

Patch exige SHA exato do main original. SDK confere arquivos51, faz commit52 e
build pelo pacote imutável de desenvolvimento `d9f826dd…`. Antes/depois compara
todas as linhas dos três ledgers, na origem e cópia. Serviço encerra antes do
navegador. Não publicar bancos/credenciais/chaves privados preservados. Não é
novo namespace, recomeço do ensaio, importação completa ou rollback instalado.

Construções a1/a2 preservam falhas de startup; a2 confirmou exit1. Diagnóstico na
cópia encerrada identificou `listen EPERM` do ambiente. Alterou somente o catch
em memória, sem alterar o pacote, e não conta como qualificação. a3 construiu e
encerrou exit0; a4 inclui apresentação melhor e áudio no reinício, serviço22075
exit0. Não atribuir automaticamente a causa de a2 à falha sem diagnóstico de a1.

## Observação por entrada normal

[Percurso final](../output/playwright/windmail-save-20261113-a2/report.json),
`scripts/observe-windmail-save.mjs`: Chrome qualificado/perfil privado, recursos
conferidos e isolamento existente. Somente teclas, botões, texto visível, PNGs e
reload. Sem variáveis de engine, storage/relógios alterados, coletores ou qualidade.

- Onze movimentos chegaram a **3/5 cartas,898 pontos**. Pausa/save confirmado
  antecederam reload. Menu, continuar e pausar mantiveram os valores; PNGs mostram
  o barco na mesma área.
- Cancelar reinício manteve progresso. Confirmar salvou0/5,0pontos; outro reload
  ofereceu essa nova viagem.
- Zero erros de console/recursos. Browser22326 exit0/desconectado, perfil removido.
  PNGs de recuperação/confirmar/cancelar/reinício revisados por Codex, não pessoas.

Primeiro percurso `windmail-save-20261113-a1`: recuperou3/5,898, mas não observou
pausa após reinício imediato; browser21656 exit0. Final reconhece frame ativo e
save antes da próxima tecla. Captura de diálogo aguarda180ms da animação160ms,
evitando texto ainda transparente. Não muda relógios nem reclassifica a falha.

## Limites de aceitação

Percurso com pausas entre frames não exercita conclusão inteira, recorde não zero,
vento mudando, falha física, duas abas no jogo real ou UI de retry/corrupção.
Testes puros do coordenador e fixtures nativas do runtime são provas distintas.
Storage continua por origem/perfil; previews temporários são temporários. Reload
não comprova browser restart, backup ou queda de energia. Arte placeholder,
pessoas/dispositivos, Unity, KidOS protegido, instalações e distribuição continuam
pendentes. Não promover a cópia a projeto original ou portfólio aprovado.
