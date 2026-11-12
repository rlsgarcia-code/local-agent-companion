# Contribuindo

Obrigado por ajudar a melhorar o Local Agent Companion. Alterações devem preservar o contrato local e auditável da extensão.

## Ambiente

- Node.js 22 ou superior.
- Visual Studio Code 1.106 ou superior.
- Dependências instaladas a partir do lockfile, sem scripts de lifecycle.

```bash
npm ci --ignore-scripts
npm run check
npm run build
npm test
npm run audit:prod
npm run test:extension-host
npm run smoke:litellm
npm run smoke:chroma
```

`test:extension-host` usa a infraestrutura oficial do VS Code, baixa a versão mínima suportada na primeira execução e abre um perfil isolado do Extension Development Host. Ele confirma ativação, registro de comandos e os fluxos de abrir a sidebar, criar thread e abrir a configuração sem chave ou chamada ao gateway. Defina `VSCODE_EXECUTABLE_PATH` para reutilizar um executável de teste específico ou `VSCODE_TEST_VERSION` para validar outra versão.

Depois de `npm run package`, execute `npm run test:vsix-install -- ./local-agent-companion-<versão>-<plataforma>.vsix`. Esse segundo teste instala o artefato em um perfil vazio e confirma que a extensão carregada veio desse diretório de instalação, evitando que o código-fonte do Extension Development Host mascare um VSIX incompleto. O CI e o workflow de release executam esse gate nos pacotes Linux x64 e Windows x64.

Os smoke tests criam somente serviços temporários em `127.0.0.1`. O teste de Chat Completions usa prompts de diagnóstico que não alteram arquivos; o teste do Chroma grava apenas em um diretório temporário, valida heartbeat/versão e confirma o encerramento do processo nativo.

`audit:prod` consulta o registro npm e falha fechado se o relatório estiver indisponível ou incompleto. Achados altos ou críticos exigem correção ou uma exceção documentada, com vencimento e teste de mitigação; uma exceção que deixou de corresponder a um achado também bloqueia o gate até ser removida.

O build gera o inventário de terceiros em `dist/licenses/` a partir do metafile do esbuild. Uma dependência nova só pode ser empacotada depois que sua expressão SPDX e seu texto de licença forem reconhecidos. Não edite os arquivos gerados manualmente; documente uma exceção em `licenses/overrides/` e no gerador quando o pacote npm declarar a licença, mas omitir o texto.

## Contrato arquitetural

Qualquer mudança pública em contratos, SDK, métodos RPC, capacidades, bootstrap, credenciais ou ciclo de vida precisa atualizar [o contrato de adaptadores de aplicação](docs/APPLICATION_ADAPTERS.md) e `docs/application-adapter-contract.json`. O teste `adapter-documentation.test.mjs` bloqueia versões ou listas de capacidades divergentes.

- O runtime do agente deve continuar construído com primitivas LangChain e LangGraph.
- `MemorySaver` é o único checkpointer do grafo; não crie um loop de mensagens ou checkpoint paralelo.
- Contexto do editor, memória durável, runtime e UI permanecem separados em `ContextCollector`, `ProjectMemory`, `DevelopmentAgent` e `AgentViewProvider`.
- Arquivos e comandos ficam limitados ao workspace aberto por padrão.
- A única chave fica no Secret Storage do VS Code.
- A extensão não deve adicionar telemetria, login, ferramentas hospedadas, web search, MCP externo ou atualização automática.
- Chamadas externas ficam limitadas às rotas LiteLLM configuradas pelo usuário e ao catálogo opcional solicitado pelas configurações.

Consulte `AGENTS.md` antes de alterar agente, modelo, ferramentas, middleware, callbacks, memória ou checkpoint. Para mudanças nessas áreas, use a documentação oficial do LangChain como referência.

## Segurança e privacidade

- Nunca inclua chaves, certificados corporativos, endpoints privados ou transcrições reais em commits, fixtures ou logs.
- Não grave conversas ou segredos em `.local-agent/memory.md`.
- Novos caminhos de arquivo precisam validar caminho real e links simbólicos.
- Novos comandos precisam passar pela política local, executar sem shell e exigir aprovação explícita.
- Mudanças que afetam dados do workspace devem incluir testes de negação, limites e recuperação segura.
- Mudanças no formato exportável de conexão devem incrementar sua versão, manter rejeição estrita de campos desconhecidos e incluir testes comprovando que nenhum segredo ou certificado é serializado.

## Pull requests

1. Mantenha a mudança pequena e explique seu efeito para o usuário.
2. Atualize testes, README e CHANGELOG quando o comportamento público mudar.
3. Execute os checks obrigatórios localmente.
4. Não inclua `dist/`, `dist-tests/`, certificados, banco Chroma local ou arquivos `.vsix` no commit.
5. Use o centro **Review run** e o Source Control para conferir todas as alterações antes do commit.

O CI repete type-check, testes, smoke local e empacotamento em macOS arm64/x64, Linux arm64/x64 e Windows x64. As matrizes Linux x64 e Windows x64 também executam a extensão dentro de um Extension Host real do VS Code e instalam/ativam o VSIX final em um segundo perfil isolado.

Referências de GitHub Actions devem permanecer fixadas por SHA completo e conservar um comentário de versão revisável, como `# v6` ou `# v7.0.1`. O Dependabot abre pull requests semanais para npm e Actions; atualizações `minor` e `patch` de cada grupo são combinadas, mas majors permanecem isoladas para exigir uma migração explícita. Revise changelog, release upstream, licenças, auditoria e toda a matriz antes de aceitar uma atualização.

## Issues

Use os formulários estruturados para falhas e melhorias; issues em branco ficam desabilitadas. Antes de publicar, revise o bundle de suporte e remova qualquer dado que a política da empresa trate como interno. Vulnerabilidades, provas de conceito sensíveis e suspeitas de exposição devem seguir o canal privado indicado em [SECURITY.md](SECURITY.md), nunca uma issue pública.

## Releases

1. Atualize a versão em `package.json` e `package-lock.json` e crie a seção correspondente em `CHANGELOG.md`.
2. Execute `npm run audit:prod` e `npm run package`; confira o VSIX local com sufixo de plataforma. Pacotes que contêm o Chroma nativo nunca devem ser distribuídos como universais.
3. Execute `docs/CORPORATE-PILOT.md` na máquina e rede de destino e registre somente o retorno sanitizado.
4. Faça commit e envie `main` somente depois que o CI estiver verde e o piloto não tiver bloqueadores.
5. Crie e envie uma tag anotada com a mesma versão, por exemplo `git tag -a v0.12.0 -m "Local Agent Companion 0.12.0"` e `git push origin v0.12.0`.
6. Confira a release e seus cinco VSIX nativos mais `SHA256SUMS.txt`.

O workflow de release recusa tags diferentes da versão do pacote, versões ausentes no changelog, conjuntos incompletos de plataformas e qualquer tentativa de sobrescrever uma release já publicada. Uma execução interrompida pode continuar enquanto a release ainda for rascunho.
