# Receitas de reimplementação

Leia nos **Passos 8 e 9**, para escrever o plano e o protótipo. Cada receita é um mecanismo descrito — escreva o código a partir da descrição, com nomes seus. Os nomes de classe aqui são propositalmente genéricos: troque todos.

Regra que atravessa tudo: **anime apenas `transform` e `opacity`.** Qualquer outra propriedade (`top`, `left`, `width`, `height`, `margin`) força layout a cada frame e o efeito custa de 5 a 20× mais. `filter` e `clip-path` custam paint — use com parcimônia e sempre com `will-change`.

---

## 1. Pin (elemento que gruda)

**Mecanismo:** um wrapper mais alto que a viewport, com um filho `position: sticky; top: 0`. A diferença entre as alturas é a duração do pin em pixels.

```
altura do wrapper − altura do filho = quanto tempo fica grudado
```

Wrapper `250vh` com filho `100vh` → pin de `150vh`, ou 1.5 viewports.

**DOM mínimo:** wrapper > filho. Só isso.

**Parâmetros de partida:** duração de pin entre 1 e 2 viewports. Abaixo de 1, mal se percebe; acima de 2.5, o usuário acha que travou.

**Armadilhas:**
- `overflow: hidden` em qualquer ancestral **mata o sticky**, silenciosamente. É a causa nº 1 de "meu sticky não funciona".
- Ancestral com `transform` cria um containing block novo e quebra `position: fixed` dentro dele.
- `height: 100vh` no filho estoura em mobile por causa da barra de endereço. Use `100dvh`, com `100vh` como fallback.
- Sem biblioteca é a melhor opção quando o pin é só "gruda e solta". GSAP só compensa se houver timeline durante o pin.

---

## 2. Parallax

**Mecanismo:** deslocar uma camada por uma fração do scroll. Fator 0.3 = a camada anda 30% do que o scroll anda; a diferença cria profundidade.

```
translateY = −scrollY × fator
```

**DOM mínimo:** container com `overflow: hidden`, camada interna maior que ele (`inset: -20%` cobre o excedente).

**Parâmetros:** fator entre 0.15 e 0.45. Acima de 0.5 vira deslizamento óbvio e enjoa. Fundo mais lento que a frente, sempre.

**Implementação:** listener de scroll `{ passive: true }` que só agenda um `requestAnimationFrame`, com um flag para não empilhar chamadas. Nunca escreva estilo direto dentro do handler de scroll.

**Armadilhas:**
- A camada precisa ser maior que o container, senão aparece borda vazia nas pontas.
- `background-attachment: fixed` parece a solução fácil e é armadilha: quebra em iOS e custa paint caro.
- Desligue abaixo de 768px. Em mobile o ganho é nulo e o custo de frame é real.

---

## 3. Scrub (timeline amarrada ao scroll)

**Mecanismo:** o progresso da animação é função direta da posição de scroll dentro de uma faixa. Sem duração própria: o usuário controla o tempo.

```
p = (scrollY − inicio) / (fim − inicio)   // limitado a [0,1]
valor = de + (para − de) × p
```

**Curva:** normalmente **linear**. Aplicar easing por cima de um scrub quebra a sensação de controle direto — o elemento deixa de acompanhar o dedo. Só use curva se a medição mostrar uma.

**Sem biblioteca:** `IntersectionObserver` para saber quando a seção está em cena, e um listener de scroll com rAF que atualiza uma variável CSS (`--p`) usada pelo CSS. Mantém o JS mínimo.

**Com biblioteca:** ScrollTrigger com `scrub: true` (travado ao scroll) ou `scrub: 0.5` (com meio segundo de atraso — mais macio, e é o que a maioria dos sites "caros" usa).

**Armadilhas:**
- Recalcular offsets a cada frame é o erro clássico. Meça uma vez, recalcule só em `resize`.
- Limite o progresso a [0,1] ou o efeito continua depois da faixa.
- `scrub: true` com lag de scroll suave dá duplo atraso. Escolha um dos dois.

---

## 4. Scroll snap

**Mecanismo:** CSS puro, sem JS.

- Container: `scroll-snap-type: y mandatory`
- Filhos: `scroll-snap-align: start`

**Armadilhas:**
- `mandatory` prende o usuário quando a seção é mais alta que a viewport. Use `proximity` nesse caso.
- Combinar snap com scroll suave por JS gera briga entre os dois. Escolha um.
- Sempre respeite `prefers-reduced-motion`.

---

## 5. Reveal (elemento que entra)

**Mecanismo:** `IntersectionObserver` adiciona uma classe; o CSS faz a transição. **É transição no tempo, não scrub** — não confunda os dois na reimplementação.

**Parâmetros:** `threshold` entre 0.15 e 0.3. `rootMargin` com valor negativo no bottom (`0px 0px -15% 0px`) para o elemento só disparar quando já entrou de verdade, não colado na borda.

**Estado inicial:** `opacity: 0; transform: translateY(40px)`. Transição de 500–700ms com uma curva `.out`.

**Stagger:** 60–120ms entre itens. É o parâmetro que mais separa reimplementação boa de ruim — sem ele a lista pisca junto e parece barata. Implemente com `transition-delay` calculado pelo índice.

**Armadilhas:**
- `unobserve` depois do primeiro disparo, senão reanima ao subir e descer.
- `opacity: 0` esconde de leitor de tela? Não, mas garanta que o conteúdo exista no HTML — sem JS, tem que aparecer.
- Sob `prefers-reduced-motion`, entregue o estado final sem transição.

---

## 6. Scroll suave (lerp)

**Mecanismo:** interceptar a roda, manter uma posição alvo e uma atual, e interpolar por frame.

```
atual += (alvo − atual) × k
```

**Parâmetro:** `k` entre 0.08 e 0.12. Ver `easing-catalogo.md`.

**Recomendação honesta:** use Lenis em vez de escrever isto. É pequeno, resolve `wheel`, `touch`, teclado e âncoras, e não quebra acessibilidade. Scroll virtual feito à mão quase sempre estraga navegação por teclado e `scroll-into-view`.

**Armadilhas:**
- Scroll virtual + `position: sticky` brigam. Lenis mantém o scroll nativo justamente para não brigar; Locomotive v4 usa transform e quebra sticky.
- Desligue sob `prefers-reduced-motion`.
- Teste `Tab` e `Home/End` — é onde essas implementações falham.

---

## 7. Clip-path que abre

**Mecanismo:** animar `clip-path: inset()` ou `circle()` em função do progresso.

```
inset(calc(50% - 50% × p) 0)   // abre de dentro para fora
```

**Armadilhas:**
- `clip-path` custa paint. Use `will-change: clip-path` e limite a poucos elementos simultâneos.
- Safari é inconsistente com `clip-path` animado em elementos com filtro. Teste.
- Alternativa mais barata: máscara com um pseudo-elemento em `transform: scaleY()`.

---

## 8. Sequência de frames (canvas)

**Mecanismo:** N imagens pré-renderizadas; o scroll escolhe o índice e desenha no canvas.

**Este é o caso em que a implementação depende do conteúdo do site.** A sequência é asset produzido por eles. Aponte isso e proponha o equivalente estrutural com material próprio: um vídeo do usuário fatiado, um render 3D próprio, ou uma animação CSS que dê a mesma leitura.

**Parâmetros:** 60–120 frames para 1.5 viewports de scroll. Menos que 60 mostra o serrilhado.

**Armadilhas:**
- Peso: 120 frames em WebP a 1600px passa fácil de 8MB. Pré-carregue com prioridade e mostre o primeiro frame como poster.
- Decodificação é o gargalo real, não o download. Use `createImageBitmap`.
- Em mobile, entregue um frame estático. Não vale o custo.
