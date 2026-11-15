# Arco — Oficina de Luz

Referência autoral de arcade/física em qualificação pelo caminho Phaser 4.2.1.
Não é geração autônoma por modelo nem jogo aceito. A fonte inclui as doze mesas,
interface, arte procedural, partitura/síntese, progressão, pontuação e checkpoints.
Builds e observações precisam ser comprovados pelo relatório de cada tentativa;
aceite físico, artístico, de áudio e humano continuam obrigatórios.

Direção: uma oficina de brinquedos cinéticos em papel marfim, cerâmica azul e
luz de latão. O tabuleiro é a imagem principal; as lanternas conduzem o olhar.
Composição prevista: título/mesa → objetivo e lançamentos → mira por arrasto ou
teclado → resultado curto com próximo desafio e acesso às mesas abertas.
Movimento: bolinha com rastro, discos que reagem ao impacto e lanternas que
florescem em combos; reduzir efeitos sem alterar a simulação.

Doze mesas autorais em três capítulos ensinam tabelas, colisões com discos e
brisa. Acender todas as lanternas antes de esgotar os lançamentos conclui uma
mesa; pontuação e estrelas recompensam combos e economia de lançamentos.
Tentativas são ilimitadas. A física não usa relógio, DOM ou APIs de engine.
Interface e simulação devem continuar desacopladas, sem endpoints ocultos de QA
ou alterações de estado para aprovar a campanha.

Arraste a mira sobre o tabuleiro e solte para lançar. Setas esquerda/direita
ajustam o ângulo; cima/baixo ou controle Força ajustam a velocidade. Espaço ou
Lançar dispara. P/Escape pausa e retoma, R recomeça a mesa e M alterna o som.
Pausa e perda de foco congelam física/efeitos e suspendem áudio. Arrasto cancelado
não lança. Há retorno explícito, seleção das mesas abertas, estrelas e final.

A simulação usa um acumulador de passos constantes de 1/240 s. Quadros longos
são limitados; a sobra fracionária é conservada no checkpoint. Isso mantém o
mesmo percurso entre diferentes cadências de frames. O primeiro ensaio nativo
concluiu três mesas e encontrou divergência na quarta com a antiga integração
de duração variável; screenshot e falha foram preservados. A regressão dirigida
comprova a equivalência depois da correção, sem declarar aquela tentativa aprovada.

`npm run qualify:game-arco` usa o serviço/SDK, engine congelado, compilador e
coletor reais. Um observador externo envia apenas teclado/foco e lê DOM/imagens;
não há endpoint oculto, injeção em localStorage ou mudança de estado para concluir
uma mesa. Tentativas e casos falhos ficam em `output/playwright/arco/runs/`.
O jogo exportado não depende do motor de IA para jogar.

Seis testes verificam campanha por lançamentos ordinários, colisões/derrota,
limites de frames, equivalência de passos, checkpoint de voo, armazenamento
incompatível/indisponível e contratos. Playtests e dispositivos físicos não são
substituídos pelo solver de entradas usado apenas nos testes/observador.
