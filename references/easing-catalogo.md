# Catálogo de easings

Leia na **Fase 4**, depois que `ajustar_easing.py` devolver o cubic-bezier vencedor. Serve para traduzir o número em nome, e o nome em intenção.

## Tabela

| Nome (GSAP) | cubic-bezier CSS | Como se sente | Onde cabe |
|---|---|---|---|
| `none` / linear | `cubic-bezier(0, 0, 1, 1)` | mecânico, sem peso | **scrub amarrado ao scroll** — aqui linear é o certo, não preguiça |
| `power1.out` | `cubic-bezier(0.33, 1, 0.68, 1)` | suave discreto | microinterações, hover |
| `power2.out` | `cubic-bezier(0.33, 1, 0.68, 1)` | o "padrão bom" | entrada de elemento, fade |
| `power3.out` | `cubic-bezier(0.22, 1, 0.36, 1)` | decidido | reveal de card, título |
| `power4.out` | `cubic-bezier(0.19, 1, 0.22, 1)` | rápido e assenta | modal, drawer |
| `expo.out` | `cubic-bezier(0.16, 1, 0.3, 1)` | **caro** — parte forte e pousa | hero, transição de página |
| `circ.out` | `cubic-bezier(0, 0.55, 0.45, 1)` | mecânico-preciso | barra de progresso, contador |
| `back.out` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | passa do ponto e volta | botão, badge, ícone |
| `sine.inOut` | `cubic-bezier(0.445, 0.05, 0.55, 0.95)` | respiração | loop, flutuação |
| `power2.inOut` | `cubic-bezier(0.65, 0.05, 0.36, 1)` | simétrico | A → B onde os dois lados importam |
| `expo.inOut` | `cubic-bezier(0.87, 0, 0.13, 1)` | dramático | troca de tela cheia |
| `power2.in` | `cubic-bezier(0.55, 0.055, 0.68, 0.19)` | acelera e some | **saída**, nunca entrada |

## Como ler o ajuste

**Erro médio < 3%** — identificação confiável.
**3% a 8%** — provável, mas cite a alternativa que o script devolve.
**> 8%** — não é uma curva padrão. Pode ser spring, lerp, ou composição de duas animações. Diga isso em vez de forçar um nome.

**Curvas vizinhas são indistinguíveis na prática.** `quart.out`, `expo.out` e `power4.out` ficam a menos de meio ponto percentual uma da outra numa série amostrada — validado. Quando o script devolve alternativa, reporte as duas: "≈ `quart.out`, possivelmente `expo.out`". Fingir precisão que a medição não tem é pior que a imprecisão.

**R² linear > 0.985** — é scrub puro, sem easing por cima. Não procure curva onde não há: o valor é função linear do scroll, e reimplementar com easing quebraria a sincronia.

**Cauda longa sinalizada** — a curva é fortemente ease-out: 95%+ do efeito acontece nos primeiros 70% do percurso. A faixa detectada tende a subestimar o fim em alguns por cento, porque a cauda se confunde com o platô. Some uma margem ao reimplementar.

## Damping / lerp

Scroll suave (Lenis, Locomotive, ou implementação própria) é interpolação por frame:

```
atual += (alvo − atual) × k
```

| k | Sensação | Uso |
|---|---|---|
| 0.20 – 0.30 | quase direto | pouco perceptível |
| 0.10 – 0.15 | **suave sem enjoar** | o intervalo mais usado |
| 0.06 – 0.09 | pesado, "caro" | sites de portfólio |
| < 0.05 | flutuante, arrasta | costuma irritar |

O script estima `k` a partir do assentamento pós-salto — validado com erro < 6%. Se ele disser "sem inércia mensurável", o scroll é nativo, e é isso que você reporta.

**Traduzindo k para a API do Lenis:** `lerp: k` é direto. `duration` é a outra forma de configurar a mesma coisa; `duration ≈ 1.2` fica perto de `lerp ≈ 0.1`.

## Duração, quando não é scrub

Vem de `transition-duration` ou `animation-duration` — leitura exata, não estimativa. Faixas típicas:

| Duração | Uso |
|---|---|
| 120–200ms | hover, foco, estado de botão |
| 300–450ms | entrada de elemento, fade |
| 500–700ms | reveal de seção, hero |
| 800–1200ms | transição de página |
| > 1500ms | quase sempre erro, exceto loop ambiente |

**Stagger** é o detalhe que mais separa reimplementação boa de ruim: 60–120ms entre itens de uma lista. Sem stagger, a lista inteira pisca junto e parece barata. O valor sai da Fase 4, comparando o `scrollY` (ou o instante) de disparo de cada item.
