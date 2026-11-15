# Histórico do aceite Companion 1.0.2 / interfaces 0.12.4

O trecho abaixo é a fotografia anterior à publicação. O PR #15 já foi integrado;
a indicação de revisão pendente abaixo é histórica. Não confundir estes testes
com o código-fonte posterior de Game Design.

A [arquitetura vigente](../SUITE_ARCHITECTURE.md) é a entrada para desenvolvimento.
O [relatório original](../desktop-final-acceptance.json) preserva as provas e
limites daquele aceite, sem reescrever seu estado de revisão original.

> **Motor 1.0.2 + clientes Mac/VS Code 0.12.4 instalados e validados**, com Ollama local.
> A entrega aguarda revisão para merge e publicação no
> [PR #15](https://github.com/rlsgarcia-code/local-agent-companion/pull/15).
> KidOS permanece em espera e não condiciona esta entrega.
>
> A [matriz assinada](https://github.com/rlsgarcia-code/local-agent-companion/actions/runs/42606762627)
> passou nas cinco plataformas. Motor independente, aplicativo Mac e extensão
> instalados compartilham o mesmo artefato, com Node 22.23.4 empacotado.
> Passaram 325 testes da aplicação, 27 verificações, inferência real Ollama e
> recuperação após desconexão do cliente e reinício do serviço.
>
> As duas interfaces foram exercitadas em Standard e Deep. O VS Code manteve
> um único indicador durante 40 segundos de inferência; a resposta apareceu
> uma vez após fechar e reabrir o editor. O Mac também recuperou os resultados.
> O rollback conjunto 0.12.4/1.0.2 → 0.12.3/1.0.1 → 0.12.4/1.0.2 preservou
> os históricos e exibiu as respostas novas nas interfaces anteriores.
> O [relatório de aceite](../desktop-final-acceptance.json) distingue as provas
> visuais da conferência dos arquivos e dados após a última reativação.
>
> LangChain/DeepAgents e o saver SQLite oficial controlam execução/checkpoints.
> O serviço mantém planejamento, evidências, memória, objetivos, recomendações e
> diagnósticos; interfaces mantêm apresentação, contexto e ferramentas autorizadas.
> Recursos dependentes do editor aguardam sua reconexão. Provedores e históricos
> continuam separados por produto, e as versões anteriores permanecem para rollback.

