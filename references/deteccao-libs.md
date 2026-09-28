# Detecção de bibliotecas — assinaturas e falsos-positivos

Leia na **Fase 1**. `sonda.js` já testa tudo isto e devolve candidatos com confiança; este arquivo é para você *interpretar* o resultado.

## Regra de ouro

Nenhuma assinatura bateu → o veredito é **"CSS puro / scroll nativo"**. Isso é uma descoberta legítima e frequentemente a mais útil do laudo: significa que o efeito é reproduzível sem dependência nenhuma. Nunca invente biblioteca para o laudo parecer completo.

## Tabela de assinaturas

| Indício | Provável | Confiança |
|---|---|---|
| `window.gsap`, `window.ScrollTrigger`, `ScrollTrigger.getAll()` | GSAP + ScrollTrigger | alta |
| `.pin-spacer` no DOM, sem global `gsap` | GSAP com build modular (o global não é exposto) | média |
| `window.Lenis`, `html.lenis`, `html.lenis-smooth`, `[data-lenis-prevent]` | Lenis | alta |
| `[data-scroll-container]`, `[data-scroll-section]`, `[data-scroll]`, `.has-scroll-smooth`, `.is-inview` | Locomotive Scroll | alta |
| `[data-projection-id]` em vários nós | Framer Motion | alta |
| `[data-framer-name]`, `__FRAMER_FEATURES__` | site publicado pelo Framer | alta |
| `[data-aos]`, `window.AOS` | AOS | alta |
| `window.ScrollMagic`, `.scrollmagic-pin-spacer` | ScrollMagic (legado) | alta |
| `.swiper-slide`, `.swiper-wrapper`, `<swiper-container>` | Swiper | alta |
| `window.ScrollReveal` | ScrollReveal | alta |
| `window.Motion` | Motion One | média |
| `window.anime` | anime.js | alta |
| `window.Rellax` | Rellax (parallax simples) | alta |
| `animation-timeline` / `view-timeline-name` no computed style | scroll-driven animations nativas (CSS) | alta |
| `<canvas>` com contexto WebGL; `window.THREE` | Three.js / WebGL | alta com o global, média só com o canvas |
| `<lottie-player>`, `window.lottie`, `window.bodymovin` | Lottie | alta |
| `window.rive`, `canvas[data-rive]` | Rive | alta |
| nenhum global + `position: sticky` + `transition` | **CSS puro** | alta |

## Falsos-positivos que mais enganam

**`.pin-spacer` sem `window.gsap`.** O bundler não expôs o global. É GSAP, não ausência de GSAP. Confirme pelo nome do chunk na rede.

**Global ausente ≠ biblioteca ausente.** Builds modernos (ESM, tree-shaking, code-splitting) quase nunca colocam nada em `window`. A ausência de global é fraca como evidência negativa; a presença é forte como positiva.

**`transform` em elemento grande não é animação.** Centralização por `translate(-50%,-50%)` é layout, não movimento. Só conta se o valor **mudar** durante a Fase 4.

**`will-change` é dica de intenção, não prova de efeito.** Muito site marca `will-change: transform` em coisa que nunca anima. Serve para escolher candidatos, não para concluir.

**Framer Motion vs site Framer.** `[data-projection-id]` é a biblioteca. `[data-framer-name]` é o construtor de sites. Aparecem juntos com frequência, mas não são a mesma coisa.

**Múltiplas bibliotecas é o normal.** Lenis para o scroll suave + GSAP ScrollTrigger para as timelines é a combinação mais comum em site "caro" hoje. Não pare no primeiro acerto.

## Confirmação pela rede

Olhe os nomes de arquivo nas requisições: `gsap.min.js`, `ScrollTrigger.min.js`, `lenis.mjs`, chunk com `framer-motion` no nome, `locomotive-scroll.js`, `three.module.js`.

Duas regras:

1. Isso é **confirmação de sinal que você já tem**, nunca evidência única. Bundlers renomeiam e concatenam tudo.
2. É leitura de **nome de arquivo**, não de conteúdo. Não abra o bundle para ler código — isso sai do escopo da skill e entra em cópia.

## Lendo a instrumentação

| Observação | Leitura |
|---|---|
| `wheelPrevented > 3` | scroll virtual: a lib intercepta a roda e move um wrapper. Lenis/Locomotive. |
| `rafTotal` alto e `perSecond` ~60 sob scroll | animação pilotada por JS a cada frame |
| `rafTotal` ~0 sob scroll | CSS puro: sticky, transition, ou scroll-timeline nativa |
| listener de `scroll` com `passive: false` | a página pode estar bloqueando a rolagem — custo de responsividade |
| muitos `IntersectionObserver` com `threshold` alto | reveals encadeados; olhe o `rootMargin` para achar o offset de disparo |
| `bodyOverflow: hidden` + `transform` no wrapper | confirmação forte de scroll virtual |
