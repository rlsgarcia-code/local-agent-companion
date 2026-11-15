# Lume — Jardim Suspenso

Jogo de referência original de plataforma para a qualificação de Game Design.
Fonte editável para Phaser 4.2.1, sem dependências ou recursos externos em runtime.
O build é produzido pelo Agent Service, não por outro executor de inteligência.

**Direção visual:** um jardim noturno ilustrado, com folhas de jade, ilhas de
pedra e sementes douradas; luz e movimento conduzem o olhar.
**Conteúdo:** abertura → doze jardins em três capítulos → jardim restaurado,
com seleção de fases, progresso salvo e sementes opcionais para rejogar.
**Interação:** saltos com antecipação e aterrissagem expressiva, profundidade
suave da vegetação e transições curtas. Movimento reduzido é respeitado.

## Jogar

Setas ou A/D para andar. Espaço, W ou seta para cima para saltar; soltar cedo
encurta o salto. Botões de toque permitem andar e saltar simultaneamente.
P/Escape pausa, R retorna ao último ponto seguro. Recolha uma semente para
acender a saída; as outras duas são desafios opcionais. Não há vidas limitadas.
Ventos e plataformas móveis aparecem progressivamente. Pausa por perda de foco,
reinício, áudio/mute e armazenamento indisponível não dependem de IA.

O arquivo de design, o roteiro de QA e o percurso de build/observação são
mantidos junto desta fonte. Arte vetorial/procedural, música e efeitos são
originais deste exemplo e seguem a licença MIT do repositório. As licenças do
runtime Phaser são empacotadas pelo adaptador; declarações não substituem a
verificação de proveniência exigida pelo plano.

## Construir e verificar

No diretório raiz do Companion:

```bash
npm run qualify:game-lume
```

O comando constrói os testes e o motor e importa esta fonte num namespace
temporário. Preenche as referências de arquivos do design, registra as
declarações de `data/asset-origins.json`, produz build Phaser e usa o coletor
real para ações e evidências. Exporta também fonte/histórico pelo SDK e verifica
recuperação após reiniciar o serviço. Não usa IA ou a instalação pessoal.

Resultados de cada tentativa, inclusive falhas, permanecem em
`output/playwright/lume/runs/`. `latest.json` aponta para o último ensaio
concluído, sem apagar os anteriores. O diretório `build/` desse ensaio é
autocontido; sirva-o por HTTP local para jogar. `source-export/` inclui a fonte
editável e o histórico. Isso não instala o jogo no KidOS nem publica uma release.

Testes puros verificam um percurso pelas doze fases, física/altura variável,
checkpoint e save incompatível/indisponível. A observação do navegador cobre
movimento com tecla mantida, pausa, semente/reload, toque e redimensionamento.
Nenhuma dessas provas substitui jogar todas as fases nos dispositivos-alvo,
revisar arte/áudio ou colher feedback humano consentido.

Este jogo foi escrito como referência pelo mantenedor/agente de desenvolvimento.
Sua existência não comprova que o produto gere jogos equivalentes a partir de
qualquer pedido. Aceite físico, playtests consentidos e generalização por pedidos
inéditos continuam obrigatórios; o acompanhamento registra as evidências reais.
