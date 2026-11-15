# Coletor browser: prova nativa Linux

Em **2026-11-11**, o CLI `game-browser-candidate.cjs` executou em Linux x86_64
real no Alien, com o comando do broker KidOS, systemd/bubblewrap, Node 22.23.4 e
Chrome for Testing 145.0.7632.6/Playwright 1.58.2. **Oito cenários passaram**.
Leia [o candidato](GAME_BROWSER_CORE_CANDIDATE.md), [porta protegida](GAME_CORE_VALIDATION_PORT.md)
e [o plano integral](GAME_DESIGN_IMPLEMENTATION_PLAN.md).

O harness público em `test/game-browser-native-harness.ts` prepara somente
requests, artefatos/suítes sintéticos e inspeção PNG. Não coordena inteligência,
registra capacidade ou muda o runtime do produto. No repositório KidOS,
`integrations/agent-engine/prepare_native_browser.py` e
`test_game_browser_native.py` preparam/executam a prova explicitamente temporária;
`docs/GAME_BROWSER_NATIVE_QUALIFICATION.md` é sua referência completa.

Foram observados desenho não uniforme, `ArrowRight`, pixels vermelho→azul,
recusa de bytes/componente trocados, repetição sem sobrescrever candidato,
barreira de arquivos/ambiente/loopback e cancelamento/timeout com navegador real.
Todas as oito unidades confirmaram PIDs zerados e cgroup vazio. Limites foram
consultados durante execução, sem inferi-los dos defaults de uma unidade coletada.
O canvas uniforme da tentativa falha continua com check `boots` reprovado no
ensaio final. Um candidato válido com checks reprovados não é qualidade aprovada.

O executável de 269.778.136 bytes foi transferido por cinco partes, autenticado
por chave efêmera de fixture, remontado e reverificado por helpers do instalador.
O runtime é do UID 1000, não uma instalação Root do novo componente. A versão
browser é um insumo fixado de teste, não recomendação de produção ou comprovação
de direitos de redistribuição. Não há acesso a conversas/credenciais/projetos reais.

Evidência local: `output/native-browser/attempt-5/`. Relatório original SHA-256
`152360902b98d7c9b9c3c9878b3bf8b91a2ab2b46565a133d83b2cbd199ae487`;
payload SHA-256 `2c0af07042a2dc258ed42ff97e07bec4fba3314e65fbe6e9b9c7764748f64606`.
`verification.json` conserva hashes/fontes e distingue regressão geral das últimas
correções da fixture. No KidOS a árvore completa fica em `build/native-browser/attempt-5/`.

Esta prova não certifica serviço/SDK/porta/Core/autoridade Root/processos em uma
única composição instalada, nem Navi v2, GPU/áudio/toque físicos, gameplay ou
aceite humano. As fixtures Root anteriores e esta prova nativa não se somam para
anunciar instalação. Sem release, atualização ou remoção de guardas.
O próximo aceite deve compor essas fronteiras; Unity/Godot, assets, três clientes,
seis jogos, pedidos inéditos e playtests continuam obrigatórios no plano.
