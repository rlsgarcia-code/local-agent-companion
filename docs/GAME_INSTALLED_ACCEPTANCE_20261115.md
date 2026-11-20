# Instalação Mac e VS Code — 15/11/2026

O candidato foi instalado, mas o aceite completo permanece **pendente** por uma
falha real de delegação. Esta referência complementa o [estado atual](GAME_DESIGN_IMPLEMENTATION_STATUS.md)
e o [rollback](GAME_DOMAIN_ROLLBACK.md); não aprova o produto integral nem promove release.

## Identidade e preservação

- Mac e extensão OpenAI: **0.13.0**; motor e SDK **1.1.0**, Node **22.23.4**.
- Commit de produção: `58a361264146fca15342b964a01b973c9d978715`.
- Manifesto comum aos pacotes independente/Mac/VS Code:
  `b06b858cd732911c3548a20b728f78ba9ebcccd3561e324a4303b9a01ce7bf43`.
- Assinaturas Ed25519 e todos os payloads instalados conferidos. O VSIX inteiro
  corresponde ao índice assinado; os arquivos instalados correspondem ao VSIX,
  admitindo somente os metadados que o próprio editor acrescenta ao package.json.
- App Apple com assinatura ad hoc, sem notarização. Não houve alteração da confiança.

O usuário confirmou preservar os recursos atuais, inclusive a seleção explícita
Ollama/OpenAI. As configurações do editor permaneceram byte a byte iguais, assim
como o arquivo de credenciais criptografadas do Mac. A tabela autoritativa de
configurações do motor também permaneceu byte a byte igual na comparação de suas
linhas ordenadas. O arquivo legado da interface Mac passou a refletir essa
configuração já persistida; não é uma comparação igual de arquivos legados.
Não se deve retornar aos valores legados apagando a configuração do serviço.

Antes da ativação, o motor anterior aceitou `shutdownIfIdle`, com todos os
bloqueadores em zero; o encerramento de seu PID foi confirmado. Foi preservada
uma cópia privada e conferida de todo o estado do motor, dados Mac, storage global
e de workspaces do editor, configurações, registro de extensões e LaunchAgent.
Os aplicativos anteriores também continuam preservados. Nenhum backup privado,
credencial, conversa pessoal ou captura foi enviado ao repositório.

## Percursos observados nas instalações reais

Foi importada uma **fixture técnica identificada**, por SDK autenticado, em
conversas separadas e namespaces próprios. Isso não foi geração de IA nem um jogo
completo, e não substitui os seis jogos/avaliações do plano.

| Percurso | Observação |
|---|---|
| Histórico/configuração Mac | Histórico anterior visível; provedor/modelos recuperados do serviço |
| Game Studio Mac | Projeto técnico listado, build disponível e preview isolado aberto |
| Exportação Mac | Diálogo nativo concluiu fonte + histórico; 14 arquivos preservados |
| Game Studio VS Code | Comando da extensão instalada abriu o webview real, separado do namespace Mac |
| Build VS Code | Confirmação nativa seguida de build Phaser concluído pelo serviço |
| Preview VS Code | Confirmação nativa, janela de navegador privada em outra origem local e estado “Preview aberto” |
| Exportação VS Code | Diálogo nativo concluiu build; 9 arquivos exportados |
| Fechar os clientes | Ausência dos dois executáveis confirmada; o motor continuou no mesmo PID |
| Reabrir VS Code | Comando explícito reabriu o Studio com o mesmo projeto, revisão 1 e build disponível |
| Reabrir Mac | Lista do projeto preservada; seleção na conversa restaurada foi recusada pela execução pendente abaixo |

O Mac descarta conversas vazias ao recuperar estado. A conversa técnica vazia não
deve ser apresentada como prova de recuperação de sua associação; a lista de
projetos persistiu. Capturas intermitentes falharam na ferramenta de controle.
Não há prova de FPS, entrada física, áudio, qualidade artística ou aceite humano.
Um aviso de outra extensão do editor encobriu inicialmente os controles; ele foi
dispensado, sem alterar essa extensão ou suas configurações.

## Falha real que bloqueia o aceite

Depois da instalação apareceu uma nova execução do Mac, distinta da fixture.
Seu evento público de falha registra:

```text
You have modified a tool in "wrapModelCall" hook of middleware
"FilesystemMiddleware": read_file. This is not supported.
```

O run está em `awaiting_reconciliation`, com um recibo `task` iniciado e sem
resultado reconhecido; **não há aprovação pendente**. O erro do grafo interrompido
não é evidência de que a ferramenta não teve efeito. Nada foi cancelado,
reexecutado, reconciliado com resultado inventado ou apagado para forçar ativação.
`engine.updateStatus` recusa a troca de versão com esse run pendente. Portanto,
rollback do perfil instalado e reinício do motor **não foram demonstrados**.
Os ensaios assinados anteriores em bancos temporários mantêm seu escopo próprio.

## Correção no núcleo e próxima condição

A reprodução determinística usa o grafo Deep oficial, supervisor e especialistas
reais do perfil Game Design, com modelos simulados. Antes da correção, o supervisor
recusou `TOOL_NAME_COLLISION`; o especialista reproduziu exatamente a falha acima.
Isso não consome provedores reais nem fornece uma prova de efeito do run antigo.

O ajuste em `packages/agent-core/src/graph.ts` separa ferramentas de host dos nomes
reservados do filesystem DeepAgents com `companion_host_*`. Cada alias encaminha
para a ferramenta original, conservando schema, argumentos, ID, runtime,
callbacks/sinal e validações do adaptador. Não troca backend, remove permissão,
concede filesystem ao KidOS ou introduz outro loop. Conflito com um alias já
existente é recusado antes da execução; o objeto original não é renomeado.
Standard preserva seus nomes. A retomada de checkpoint concluído não repete a leitura.

A [documentação oficial](https://docs.langchain.com/oss/javascript/deepagents/overview)
identifica as ferramentas de filesystem do DeepAgents; o código instalado e fixado
recusa a substituição de sua identidade por outra ferramenta de mesmo nome.
O teste está em [engine-deep-host-tools.test.ts](../test/engine-deep-host-tools.test.ts).

Essa correção precisa de **outro candidato imutável**, verificação e ativação em
ponto seguro. O 1.1.0 assinado instalado não foi modificado. A execução antiga
continua exigindo inspeção/reconciliação comprovada; autorização para atualizar
software não autoriza inventar seu resultado nem cancelar esse trabalho.

Versões corretivas em fonte: motor/SDK **1.1.1**, interfaces **0.13.1**, mesmo
protocolo e Node. Verificação local: **823 testes de execução + 42 de repositório
aprovados**, um skip explícito, tipos/build aprovados. A primeira rodada integral
teve recusas do ambiente ao abrir IPC/servidores temporários e navegadores; seu
log foi preservado e a rodada com esses recursos locais autorizados passou sem
alterar asserts ou a proteção contra inferência real. Produção assinada e
instalação dessa revisão permanecem separadas desses resultados.

### Corretivo assinado preparado

A [produção oficial](https://github.com/rlsgarcia-code/local-agent-companion/actions/runs/43754802917)
concluiu as cinco plataformas e o rascunho com **37 arquivos**, no commit
`ea2db23a44db9984ad32ade260616f6b1f5415a8`. Motor/SDK **1.1.1**, clientes
**0.13.1**, Node **22.23.4**, protocolo **1.0**. O
[rascunho](https://github.com/rlsgarcia-code/local-agent-companion/releases/tag/untagged-950b300827cf84844e19)
não foi promovido nem integrado ao main.

Oito arquivos selecionados foram conferidos contra o índice original assinado,
incluindo o VSIX inteiro e os dois manifestos Mac. SDK e motores tiveram assinatura
e todos os payloads conferidos antes de importar código. Extração limitada recusou
caminhos/tipos inválidos e gravação por links; os 14 links internos do app e seu
selo Apple foram conferidos. App, VSIX e pacote independente contêm o mesmo motor:

| Metadado | SHA-256 |
|---|---|
| Motor 1.1.1 | `141d5cdca78f050b6175851a6aefe2ee4dea0a946aac935e11d90c5dc9558039` |
| SDK 1.1.1 | `b698659846abe205e5469a79195ec352bf31b1c607ce8ce357bf1bd94defbfdc` |
| Índice da release | `8d111cbac5b4645b258c7822fcab059c7d12fec7ea335aa764af3b291a9f67e9` |

Os percursos assinados **1.1.1 → 1.0.6/1.0.7 → 1.1.1** passaram para
configurações e histórico dos dois produtos em bancos temporários. Nenhum modelo
ou ferramenta foi chamado. Esses passes não substituem rollback do perfil
instalado, checkpoint ou aceite visual do corretivo, que **não foi ativado**.
Recibos locais: `.cache/game-design-candidate-1.1.1-ea2db23/`.

A inspeção consistente e somente de leitura do checkpoint original encontrou
um pai com mensagem humana e chamada `task` para `game-design-director`; o filho
contém somente a mensagem humana, nenhum arquivo e um `__error__` com o erro
nativo exato de `read_file`. A interrupção pai está vinculada ao mesmo recibo.
Foi preparado um procedimento restrito a essa estrutura/identidade/versão, que
recusa qualquer divergência e não retoma o grafo. Registrar o erro observado e
encerrar somente esse pedido depende da confirmação solicitada ao usuário;
**somente a inspeção foi executada**. Não houve cancelamento nem reconciliação
automática para liberar a atualização.

Recibos privados locais: `.cache/game-design-install-20261115/`, incluindo
`personal-backup.json`, `installed-engines.json`, `extension-installed.json`,
`model-storage-comparison.json`, inventário de exportação e a reprodução negativa.
Esses arquivos locais não são dependências para compilar ou usar o repositório.
