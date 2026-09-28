# 🔬 scroll-forensics

**Forense de movimento: descobre como o scroll daquela página foi construído — e devolve o plano para você refazer com código próprio.**

`laudo com números medidos` · `não copia código` · `respeita robots.txt` · `Python 3.9+` · `Node + Playwright`

**Dois jeitos de usar:** 🟠 **no Claude Code** · 🟢 **no Codex** (OpenAI / ChatGPT).

---

## 💛 Uma palavra de gratidão

Todo mundo que faz web já passou por isso: o cliente manda um link e diz *"quero
que o meu fique assim"*. E aí vem a parte difícil — não é a vontade que falta, é
saber **exatamente** o que faz aquela página parecer cara. O que separa o
acabamento bom do amador quase nunca é segredo: é um número. Um `rootMargin`
negativo, um fator de parallax de 0.35, uma curva `expo.out` em vez de `ease`.

Esta skill nasceu para transformar "parece mais caro" em **parâmetro** — para
que designers e desenvolvedores possam aprender com o que já existe e construir
o seu, do zero, com as próprias mãos.

Ela foi feita com uma regra no centro: **estudar não é copiar.** Mecanismo e
número são conhecimento — se aprendem, se ensinam, se reaproveitam. Código,
texto, imagem e marca são de quem fez — e ficam com quem fez.

A quem constrói a web com capricho: **obrigado pelo cuidado com cada detalhe.**

— **Murilo Ferreira** ([@agro_muriloferreira](https://instagram.com/agro_muriloferreira)) · **Sophismart.ai** ([@sophismart.ai](https://instagram.com/sophismart.ai))

---

## 🎯 O que é

Você dá uma URL de referência. A skill **abre a página de verdade**, observa o
comportamento ao vivo, **mede** e devolve um laudo com a mecânica de movimento:
scroll, parallax, pin/sticky, reveals, easings e micro-interações.

A diferença entre isto e um palpite bem escrito é a **Fase 4**: a série
`scrollY → propriedade` amostrada de fato. Sem ela sai um texto plausível e
inútil. Com ela saem números que alguém consegue implementar.

---

## 🔍 O que ela entrega

**Laudo estruturado**, com:

| Seção | Conteúdo |
|---|---|
| Veredito em uma linha | *"Lenis + GSAP ScrollTrigger com scrub pinando o hero por 1.4 viewports."* |
| Stack detectada | GSAP, Lenis, Locomotive, Framer Motion ou **CSS puro** — com nível de confiança e evidência |
| Mecânica por seção | técnica, faixa de scroll, propriedades animadas, curva, trigger |
| Números extraídos | início → fim, amplitude, easing estimado, por elemento e propriedade |
| Detalhes que fazem parecer caro | o que a reimplementação ingênua erra — cada item é um número ou uma decisão concreta |
| Custo e acessibilidade | fps sob scroll, `prefers-reduced-motion`, comportamento mobile |
| Plano de reimplementação | estrutura de DOM, parâmetros de partida, ordem de construção, armadilhas |
| Limitações da análise | o que não deu para medir, e por quê |

**Os números que ela deriva da série amostrada:**

- **faixa ativa** — em que trecho de scroll o efeito realmente acontece (quase nunca é a página toda)
- **amplitude** — parallax que move 180px enquanto o scroll anda 600px é **fator 0.30**
- **curva** — ajuste contra um catálogo de cubic-beziers, com erro médio: `≈ cubic-bezier(0.16, 1, 0.3, 1)` (expo.out), erro 2.1%
- **linearidade** — R² do ajuste linear; scrub puro dá ≈ 1.0, abaixo de 0.98 tem easing por cima
- **lerp/damping** — se o valor continua se movendo depois que o scroll para (típico 0.075–0.12 por frame)
- **duração do pin** — wrapper de 240vh com filho de 100vh dá 1.4 viewports de scroll pinado

Ela também separa duas armadilhas que produzem laudo plausível **e errado**:
transição no tempo disfarçada de scrub (`transition: opacity .6s` não é scrub de
1700px), e o fator 1:1 que é só a página rolando, não um efeito.

---

## ⚖️ O que ela NÃO faz — e por quê

Este limite é o que torna a análise legítima **e** o que a torna útil.

**Extrai:** a técnica, os parâmetros, a sequência. `position: sticky` num wrapper
de 240vh, parallax com fator 0.35, `IntersectionObserver` com `threshold: 0.25`.
Mecanismo e número são conhecimento funcional — e é exatamente o que se
reaproveita.

**Não extrai:** código-fonte da página (nem JS, nem CSS, nem markup), textos,
imagens, vídeos, fontes, ícones, a paleta como identidade de marca, nome ou logo.

**O plano de reimplementação sai do zero** — escrito a partir da *descrição do
mecanismo*, com nomes de classe e estrutura de DOM próprios. Nunca a partir do
código lido.

**Respeita bloqueios.** Verifica `robots.txt` antes de automatizar. Não contorna
login, paywall, captcha ou proteção anti-bot. Se a página bloquear, diz qual foi
o bloqueio e para.

> Não é uma ferramenta de clonagem. Se o que você quer é baixar os arquivos de
> uma página, esta skill não serve — e não vai tentar.

---

## 📦 Instalação no Claude Code

```bash
git clone https://github.com/sophismartai-sudo/scroll-forensics-sophismart.git \
  ~/.claude/skills/scroll-forensics-sophismart
```

Para o laudo completo (caminho recomendado), a partir da sua pasta de trabalho:

```bash
npm i playwright && npx playwright install chromium
```

---

## 🤖 Instalação no Codex (OpenAI / ChatGPT)

```bash
git clone https://github.com/sophismartai-sudo/scroll-forensics-sophismart.git \
  ~/.agents/skills/scroll-forensics-sophismart
```

---

## 🚀 Como usar

No Claude Code ou no Codex, basta o link e o pedido:

```
/scroll-forensics-sophismart https://site-de-referencia.com
```

ou, em linguagem natural: *"por que o site deles parece mais caro que o meu?"*,
*"o cliente mandou este link como padrão — como fazem esse scroll?"*.

**Direto no terminal**, sem assistente — o pipeline inteiro headless:

```bash
node <skill>/scripts/playwright_runner.mjs "https://alvo.com" --out laudo.json --steps 48
python3 <skill>/scripts/ajustar_easing.py laudo.json --md
```

`<skill>` é a pasta onde a skill foi clonada. O runner faz sozinho: `robots.txt`,
detecção de bloqueio, instrumentação pré-load, as fases 1–4, fps, uma passada com
`prefers-reduced-motion` e uma passada mobile 390×844.

---

## 🧪 Requisitos

| Para | Precisa |
|---|---|
| Laudo completo (headless) | **Node** + `playwright` + Chromium |
| Ajuste de curva (`ajustar_easing.py`) | **Python 3.9+** — só biblioteca padrão, nada a instalar |
| Análise numa aba logada | um browser controlável pelo assistente (opcional) |

Sem shell e sem browser, a skill ainda funciona em modo estático — mas aí ela
**infere** em vez de observar, e diz isso no laudo.

---

## 📁 O que tem dentro

```
SKILL.md                      # o método: 9 passos, 5 fases, formato do laudo
references/deteccao-libs.md   # assinaturas das bibliotecas e os falsos-positivos que enganam
references/easing-catalogo.md # cubic-bezier → nome (GSAP, CSS, Framer) e intenção
references/reimplementacao.md # receita por técnica: pin, parallax, scrub, snap, reveal, wipe
scripts/instrumentar.js       # Fase 0 — instrumenta ANTES de a página carregar
scripts/sonda.js              # Fases 1–2 — libs + computed styles + métricas de pin
scripts/amostrar.js           # Fase 4 — varredura scrollY → propriedades
scripts/ajustar_easing.py     # Fase 4 — série → cubic-bezier + erro + damping
scripts/playwright_runner.mjs # pipeline inteiro headless, um JSON de saída
```

---

## ⚖️ Licença e proibições

Uso **público, gratuito e não comercial**. É permitido usar, executar e
**redistribuir a cópia íntegra**. É proibido vender, embutir em produto pago,
modificar, criar versões derivadas ou remover os créditos.

Leia [LICENSE](LICENSE) — os termos correspondem, em espírito, à
**CC BY-NC-ND 4.0**.

---

## 👤 Autoria

**Murilo Ferreira** ([@agro_muriloferreira](https://instagram.com/agro_muriloferreira)) ·
**Sophismart.ai** ([@sophismart.ai](https://instagram.com/sophismart.ai))

Ver [AUTORIA.md](AUTORIA.md).
