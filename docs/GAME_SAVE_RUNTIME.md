# Estado persistente dos jogos web

A [integração manual no Correio](GAME_WINDMAIL_SAVE_INTEGRATION.md) demonstrou
reload de uma viagem real numa cópia do projeto, sem alterar o Luna51 original.
Essa evidência posterior não promove as fixtures abaixo a aceite integral.

Fonte e pacote de desenvolvimento em **2026-11-13**, sem instalação/release.
O import opcional `@companion/game-save` **1.0.0** armazena estado JSON versionado
de jogos Phaser e Babylon. Responde à
[regressão real de reload](GAME_WINDMAIL_ROUTE_OBSERVATIONS.md), mas não modifica
o build original do Correio das Correntes. Leia a
[arquitetura](SUITE_ARCHITECTURE.md), o [plano](GAME_DESIGN_IMPLEMENTATION_PLAN.md)
e o [perfil de produção](GAME_AGENT_PRODUCTION.md).

## Responsabilidades e distribuição

O módulo roda **dentro do jogo exportado**. Não importa Agent Core, LangChain,
Electron, editor, filesystem ou KidOS. Não usa rede, modelos, telemetria, host
bridge ou outro serviço. Conversas/checkpoints continuam no Agent Service;
rascunhos continuam nos hosts; gameplay pertence ao jogo e ao navegador.

O compilador aceita apenas o import exato dos bytes locais fixados em
`packages/adapter-game-web/save.lock.json`. Confere implementação/licença antes
de construir, inclui código/comentário legal em `game.js` e a licença MIT integral
em `engine/GAME-SAVE-LICENSE.txt`. Sem import, não adiciona helper/licença ou abre
banco. Adulteração recusa disponibilidade e compilação.

Workspace usa adaptador **4**, com lock na identidade. `saveRuntime:false` conserva
o perfil 3; o Core fixo continua adaptador 1 com `audioRuntime:false`, sem resolver,
carregar ou anunciar esse import. Bytes no pacote não concedem capacidades ao
Navi. Não é integração JavaScript para Godot ou Unity.

## Uso

```js
import {createGameSave} from '@companion/game-save';
const save = createGameSave({
  gameId: 'correio-das-correntes', slot: 'campaign', version: 2,
  validate: value => Boolean(value &&
    Number.isInteger(value.deliveries) && value.deliveries >= 0 &&
    value.deliveries <= 5 && Number.isInteger(value.score) && value.score >= 0),
  migrations: {1: old => ({deliveries: old.letters, score: old.score})}
});

const current = await save.load();
// loaded: restaurar current.data; empty: oferecer partida nova.
// Outros estados exigem diagnóstico/escolha; não resetar automaticamente.
const result = await save.save(gameplayState, {expected: current.stamp});
// Atualizar o stamp conhecido somente após saved/unchanged.
// Conflito exige nova leitura/reconciliação.

// Operações distintas, após a escolha pertinente na UI do jogo:
await save.migrate({expected: current.stamp});
await save.discard({expected: current.stamp, confirm: true});
await save.close();
```

O exemplo não deve continuar cegamente após load inválido/incompatível; uma
falha pode não fornecer stamp. O jogo decide estado, checkpoints e UI de
“continuar”/“nova partida”. Recorde não substitui progresso prometido. Salvar em
transições como entrega/pausa, sem depender só de unload. Não repetir uma escrita
antiga depois de conflito.

`gameId`/`slot`: identificadores estáveis de 1–64 caracteres, letras minúsculas,
números, ponto, hífen ou underscore, começando por letra/número. Não usar hash do
build como gameId. Não é identidade/autorização de produto, usuário ou serviço.
`expected:null` significa slot ausente na leitura; não autoriza sobrescrever
registro existente. `empty` é ausência atual, não prova de que nunca houve save.

## Transação e limites

Backend **IndexedDB**, banco `companion-game-saves-v1`, store `slots`, chave
gameId/slot. Dados são preparados fora da transação e os bytes originais são
conferidos novamente dentro de uma única transação `readwrite`. Duas conexões
com a mesma leitura não sobrescrevem uma à outra silenciosamente.

`saved`/`migrated`/`discarded` só vêm após o evento `complete`, não após sucesso
de put. Aborto preserva o registro anterior. Durabilidade `strict` é solicitada
ao navegador; não é prova de flush físico, retenção garantida ou queda de energia.
[Contrato oficial de IndexedDB](https://www.w3.org/TR/IndexedDB/).

Stamp é SHA-256 dos bytes JSON, identidade para comparação, **não assinatura,
anti-cheat ou barreira entre contas/UIDs**. Registros carregados são cópias.
O validador é puro/síncrono e recebe uma cópia congelada; Promise não vale como
validação. Dados não invocam getters/toJSON. Objetos de engine, Date, binários,
funções, undefined, ciclos, números não finitos, chaves perigosas e acessores
são recusados; texto Unicode/CRLF permanece no JSON.

Registro inteiro: padrão 64 KiB, configurável de 1 KiB a 256 KiB; profundidade 32,
até 20.000 valores e chaves até 128 unidades de texto. Não guardar código/mídia.
Abertura/transação têm deadline de 5 s; abortos são aguardados. `close` impede commits
ainda não despachados, aborta transações pendentes, aguarda operações e fecha a
conexão. Não fecha abas alheias ou força atualização de banco ocupado.

## Versões, falhas e descarte

| Resultado | Significado |
|---|---|
| `loaded`, `empty` | Estado validado ou slot atualmente ausente |
| `saved`, `unchanged` | Gravação confirmada ou mesmos dados da leitura |
| `conflict` | Registro mudou; carregar/reconciliar |
| `migration-required`, `migrated` | Versão antiga preservada ou migração explícita confirmada |
| `invalid`, `incompatible` | Preservar corrupção/formato/versão futura |
| `invalid-input`, `blocked` | Dados/operação recusados sem substituir o save |
| `unavailable` | Conferir código de storage/crypto, aborto, quota, deadline, close ou expected ausente |
| `discarded` | Exclusão apenas do slot/stamp confirmados |

Migrações são funções explícitas, síncronas e consecutivas, no máximo 16 passos;
load não as executa. Falha, dados inválidos, conflito ou versão futura não
reescrevem o registro. Diagnósticos não repetem a exceção/carga corrompida.
`discard` exige stamp e `confirm:true`: escolha de reset do jogo, **não aprovação
parental/administrativa**. Tipos externos inesperados ou registros acima do teto
global ficam preservados sem stamp utilizável, sem limpeza ampla.

Não há clear do banco inteiro, retry automático, fallback para memória ou
localStorage, download ou troca silenciosa de backend. A factory `indexedDB`
opcional serve a integração/fault injection do jogo, sem acesso ao host. O jogo
deve explicar indisponibilidade e sua política de jogar sem save, sem anunciar
persistência falsa.

## Origem e retenção

Saves pertencem à origem e ao perfil do navegador; não se sincronizam entre
computadores/produtos/contas. Navegador/usuário podem removê-los. Mudar origem,
porta ou perfil muda o storage. **Previews temporários continuam temporários.**
Não há novo backup, permissão de storage persistente ou persistência de preview
após fechar/reabrir. Um save antigo em localStorage exige migração específica;
o módulo não o descobre ou converte automaticamente.

## Evidências

O [dossiê](../output/game-generation/game-save-runtime-20261113-a1/report.json)
fixa fontes, lock, exports e pacote de desenvolvimento
`d9f826ddfefb20e6c922a30dfcdc5d9e83e8396aeec2e6b26112f12265335d7b`.

- 773 testes, um opt-in ignorado e mais 40 verificações; tipos, builds de
  extensão/Mac/motor e roteamento simulado passaram. Regressão inicial recusava
  o import ainda não implementado. Fault injection testa put sucedido seguido
  de aborto/quota, sem sucesso antecipado ou perda do registro; não é quota ou
  falha física real de disco.
- Serviço/SDK/Node empacotados construíram fixtures Phaser/Babylon. O serviço
  encerrou **antes** da reprodução. Botões visíveis/reload exercitaram IndexedDB
  nativo em seis combinações: Chrome e Firefox/WebKit Playwright existentes,
  nas duas engines. Progresso após reload, duas conexões, close/reopen do
  controller, migração, versão futura/corrompida, descarte e indisponibilidade.
  Fault data são semeados pela própria fixture, não pelo observador num jogo real.
- Preflight recusou a variável de codificação adicionada pelo macOS; depois,
  HOME privado não encontrou Firefox. Resultados preservados. Ensaio final usa
  ambiente fechado e caminho exato das distribuições, sem download/perfil
  pessoal. Serviço 14265 exit0; seis páginas/fechamentos confirmados e estado
  privado removido. Firefox/WebKit tiveram inventários conferidos antes/depois.
  Wrappers não registram exit code dos browsers; page close não é essa medição.

Não é reparo do Luna51, geração autônoma, UI instalada, browser restart com perfil
persistente, Safari/Firefox comerciais, disco físico, cinco plataformas, UID
infantil ou qualidade humana. A aceitação completa da integração no jogo, Navi,
Unity/Godot e distribuição continua com gates próprios.
