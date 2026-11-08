# Batalha Urbana 3D

Remaster web do **BU3D**, a versão 3D do Batalha Urbana feita em C++/OpenGL (GLUT) para a disciplina de Computação Gráfica da UFGD. Segue a mesma linha da [versão 2D remasterizada](https://github.com/fabio-ag-silveira/batalha-urbana-v2): `HTML + CSS + JavaScript modular`, agora com [three.js](https://threejs.org/) para o 3D.

O código C++ original continua em [`legacy/main.cpp`](legacy/main.cpp).

## Como executar

Precisa apenas do Node.js (sem `npm install`: o three.js já vem em `vendor/`).

```bash
node server.js
```

Depois abra `http://127.0.0.1:8000`. Para parar, `Ctrl + C`.

Versão publicada (também no celular): <https://batalha3d.fabiosilveira.dev>

### Publicar no Cloudflare Workers

```bash
npm run deploy
```

O script `scripts/build-worker.mjs` gera `dist-worker/worker.js` com os arquivos do jogo embutidos e o `wrangler` publica no domínio configurado em `wrangler.jsonc`. Para uma pasta estática comum, `npm run build:web` gera `dist/`.

## Como jogar

Cada jogador começa a rodada com 100 HP. Vence a rodada quem sobrar de pé, e a partida vai para quem vencer 3 rodadas. Dá para jogar com 2, 3 ou 4 carrinhos, todos contra todos (no modo Versus IA, todos menos o Player 1 são IA).

| | Elevação do cano | Girar | Andar (ré/frente) | Atirar | Arma |
|---|---|---|---|---|---|
| Player 1 | W/S | A/D | Q/E | segure F e solte | R |
| Player 2 | I/K | J/L | U/O | segure H e solte | P |
| Jogador da vez | ↑/↓ | ←/→ | `,`/`.` ou PgDn/PgUp | segure Espaço e solte | Tab |

No celular/tablet aparece uma barra de botões embaixo da tela, como na versão 2D: girar, ré, frente, câmera, arma, elevação do cano e Atirar (segure e solte). O botão de menu abre o painel em gaveta e o do canto direito põe em tela cheia. Em pé, o jogo sugere girar o celular. Arrastar na tela gira a câmera livre.

- **Força:** segurar o disparo enche a barra em vai-e-vem; soltar atira. A marca branca mostra a força do tiro anterior.
- **Mira:** a linha pontilhada mostra a trajetória (sem vento) com a força do último tiro, ou a força atual enquanto carrega. A **Ajuda de mira** no painel escolhe quanto aparece: Curta (só o começo), Longa (padrão, mais da metade) ou Completa (o arco inteiro e um marcador onde vai cair; a etiqueta do inimigo avisa "NA MIRA").
- **Mirar no inimigo:** `T` ou o botão ALVO gira o carrinho para o inimigo mais próximo; apertar de novo passa para o próximo. Etiquetas mostram nome e distância de cada inimigo (através dos prédios), com seta na borda da tela quando ele está fora de vista.
- **Retorno do tiro:** um X marca onde caiu o seu último tiro, e um aviso rápido diz quanto faltou ("18 m antes e 6 m à esquerda de Player 2") logo depois do tiro e no começo da sua próxima vez. Na parte de baixo fica uma linha só: arma, barra de força e ângulo (vira a % de força enquanto carrega).
- **Armas:** Canhão (infinito), Fragmentação (abre em 4 no alto da trajetória), Quicante (ricocheteia 2 vezes na face do voxel atingido) e Pesado (explosão e cratera enormes). As especiais têm munição por rodada.
- **Vento:** muda a cada turno e sopra em qualquer direção do plano. A bússola no topo mostra o vento *relativo à câmera* (seta para cima = vento para onde você está olhando).
- **Explosões:** dano em área (acerto direto dá bônus), inclusive em quem atirou, e empurram o carrinho — dá para derrubar alguém do telhado.
- **Cidade destrutível:** os prédios são voxels; cada explosão abre uma cratera. O que perde apoio desaba, com quem estiver em cima. Destruir o núcleo de uma ilha flutuante derruba a ilha.
- **Movimento:** cada turno tem combustível limitado (barra amarela sob o HP). O carrinho sobe degraus de um voxel e cai de beiradas, com dano em quedas altas.
- **Caixas de suprimento:** a partir do 3º turno caem caixas de paraquedas (Vida, Combustível, Munição). Pegue dirigindo até elas; um feixe de luz mostra onde estão.
- **Condições da rodada** (a partir da 2ª): Tempestade (vento em dobro e chuva), Gravidade baixa, Neblina (visão curta e vento escondido) ou Arsenal (munição em dobro).
- **Mapa:** no modo Dinâmico a cidade é sorteada a cada rodada (prédios, densidade, morros, ilhas flutuantes e passarelas entre telhados); em 1 de cada 4 cidades, um bloco de 2×2 quarteirões no meio vira um **parque** aberto, com morrinhos e árvores destrutíveis. Os carrinhos nascem quase sempre em pontos altos (telhados, ilhas, passarelas) e, na maioria das rodadas, com o adversário à vista. O Clássico é a planta do BU3D original.
- **Cenário em volta:** a arena fica entre bairros (casinhas, prédios baixos, praças e ruas que continuam as da cidade) e uma baía com barcos, calçadão e o skyline da outra margem. Janelas e postes acendem no entardecer e à noite. Tiros que saem do mapa seguem voando e caem no mar (respingo) ou nos bairros (poeira). É só visual: o cenário de fora não tem colisão.
- **Replay:** o tiro que decide a rodada é reprisado em câmera lenta (atirar pula).
- **Dificuldade da IA:** as três calculam o tiro certo; o que muda é o "erro humano" no ângulo e na força, quanto do vento a IA considera e o quão rápido ela corrige a mira a cada tiro contra o mesmo alvo. Contra um alvo parado, a IA precisa em média de ~11 tiros no fácil, ~8 no médio e ~5 no difícil, e o difícil erra o primeiro tiro cerca de metade das vezes.
- **Timer:** 25 s por turno. Se acabar durante a carga, o tiro sai com a força atual; senão, a vez passa.
- **Minimapa:** radar que gira com a câmera, com alturas dos prédios, crateras, carrinhos, caixas e a direção da mira (pode ser desligado no painel).

### Câmeras

`C` troca de câmera (`Shift + C` volta). Também dá para escolher no painel lateral ou no botão CÂM do celular.

| Câmera | Comportamento |
|---|---|
| Perseguição | Atrás do carrinho da vez (como as câmeras dos carrinhos do original), acompanha o projétil e depois olha a explosão. |
| Tática | Do alto, atrás do jogador da vez, enquadrando os dois carrinhos. |
| Visão geral | A câmera "do canto" do original. |
| Topo | A visão de cima do original. |
| Livre | Arraste para girar, botão direito ou `Shift` + arrastar para mover, roda do mouse para zoom. Arrastar ou rolar em qualquer câmera entra nela. |

As câmeras evitam atravessar prédios: se houver um na frente, a câmera se aproxima ou sobe.

### Atalhos

`B` reinicia, `M` alterna IA/local, `N` muda a dificuldade da IA, `X` liga/desliga o som, `C` câmera. Número de jogadores, mapa e minimapa ficam no painel.

## O que mudou em relação ao BU3D original

| BU3D (C++/GLUT) | Remaster |
|---|---|
| Velocidade ajustada com W/S, tiro instantâneo | Barra de força: segure e solte |
| Ângulo do cano de −5° a 26°, giro da torre em passos | Elevação contínua de −10° a 85°, giro livre do carrinho |
| Carrinho parado no spawn | Movimento com combustível, quedas com dano |
| 3 acertos ganham a rodada; carrinho escurece a cada acerto | 100 HP, dano em área, acerto direto, fogo amigo; o carrinho escurece e solta fumaça conforme o dano |
| Prédios indestrutíveis | Prédios de voxels com crateras e destroços |
| Sem vento | Vento 3D por turno |
| Colisão por faixas de x **ou** z (acertava sem passar perto) | Hitbox orientada do carrinho e explosão esférica |
| Fundo verde, roxo ou amarelo (caixa fechada) | Temas dia, entardecer e noite com céu, sol/lua, estrelas, nuvens, neblina, sombras e janelas acesas |
| Câmeras fixas trocadas com `c`/`C` | Câmeras suaves, acompanhamento do projétil, câmera livre com mouse, anti-oclusão |
| Só 2 jogadores locais | 2 a 4 jogadores, versus IA (3 dificuldades) e versus local, com controles de toque no celular |
| Uma arma | Canhão, Fragmentação, Quicante e Pesado |
| Cidade fixa | Mapa dinâmico com relevo, ilhas flutuantes, passarelas e desabamentos (o clássico continua disponível) |
| — | Caixas de suprimento, condições de rodada, empurrão das explosões e replay do tiro final |
| Sem som | Efeitos sintetizados com WebAudio |
| Texto em bitmap no canto | Painel lateral, placar sobre o jogo, bússola de vento, barra de força, banners, dano flutuante e minimapa |

No mapa Clássico, a planta da cidade (21 prédios de 20, 30 e 50 de altura) e os spawns são os mesmos do original; foram acrescentados alguns spawns na rua.

## Estrutura

- [src/game.js](src/game.js): estado da partida, fases do turno, entrada, dano e quedas. Não usa DOM.
- [src/ai.js](src/ai.js): IA que busca (giro, elevação, força) simulando trajetórias com vento, gravidade, prédios e crateras, escolhe arma e alvo; a dificuldade é o erro de mira (que diminui a cada tiro contra o mesmo alvo) e quanto do vento ela considera.
- [src/world.js](src/world.js): grade de voxels, crateras e desabamento (tudo derivado do mapa + lista de crateras).
- [src/map.js](src/map.js): gerador do mapa dinâmico (prédios, morros, ilhas, passarelas, spawns) e o mapa clássico.
- [src/physics.js](src/physics.js): trajetória com vento, cano, hitbox, apoio e bloqueio dos carrinhos.
- [src/config.js](src/config.js): constantes de gameplay, planta da cidade, spawns, temas e presets da IA.
- [src/render/](src/render): cena three.js — céu e skyline (`sky.js`), cidade e ruas (`city.js`), carrinhos (`tank.js`), partículas/destroços/explosões (`effects.js`), câmeras (`camera.js`), replay (`replay.js`), bairros e baía em volta da arena (`surroundings.js`) e a montagem de tudo, com chuva, caixas e blocos desabando (`stage.js`).
- [src/overlay.js](src/overlay.js): camada HTML sobre o canvas (placar, timer, vento, força, banners, dano e minimapa).
- [src/hud.js](src/hud.js), [src/input.js](src/input.js), [src/audio.js](src/audio.js): painel lateral, teclado/toque e som.
- [server.js](server.js): servidor HTTP estático para jogar localmente.

O modo LAN da primeira versão foi retirado por enquanto (fica no histórico do git, commit `e3e6223`).

### Coordenadas

O jogo usa as mesmas unidades do BU3D: `y` para cima, chão em `y = 0`, prédios com base 16 × 16 nas posições de `desenha_cidade()`. A convenção de giro é a do three.js: `yaw = 0` aponta para `+z` e `yaw = 90` para `+x`.

## Legado

Para compilar o original no Linux:

```bash
g++ legacy/main.cpp -o BU3D -lGL -lGLU -lglut -lm && ./BU3D
```

Tutorial OpenGL usado na época: <http://www.univasf.edu.br/~jorge.cavalcanti/Tutorial_OpenGL.PDF>

Bianca Andreia e Fabio Amaral Godoy da Silveira — UFGD.
