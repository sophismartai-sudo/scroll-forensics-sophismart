#!/usr/bin/env python3
"""
scroll-forensics :: Fase 4 - serie scrollY->propriedade => cubic-bezier + erro

Le o JSON produzido por amostrar.js (ou pelo playwright_runner.mjs) e deriva,
por elemento e propriedade:

  - faixa ativa   : em que trecho de scroll o efeito realmente acontece
  - amplitude     : quanto a propriedade andou, e o fator vs o scroll
  - curva         : cubic-bezier mais proximo do catalogo, com erro medio
  - linearidade   : R^2 do ajuste linear (scrub puro fica ~1.0)
  - degraus       : poucos valores distintos = estado discreto, nao scrub
  - damping       : fator de lerp por frame, estimado do assentamento

Somente biblioteca padrao. Nao instala nada.

Uso:
    python3 ajustar_easing.py amostras.json --md
    cat amostras.json | python3 ajustar_easing.py - --json
"""

import argparse
import json
import math
import sys

# ---------------------------------------------------------------------------
# catalogo de curvas (ver references/easing-catalogo.md)
# ---------------------------------------------------------------------------
CATALOGO = [
    ("linear",            (0.0,  0.0,  1.0,  1.0),  "linear"),
    ("ease",              (0.25, 0.1,  0.25, 1.0),  "ease (padrao CSS)"),
    ("ease-in",           (0.42, 0.0,  1.0,  1.0),  "ease-in"),
    ("ease-out",          (0.0,  0.0,  0.58, 1.0),  "ease-out"),
    ("ease-in-out",       (0.42, 0.0,  0.58, 1.0),  "ease-in-out"),
    ("power1.out",        (0.33, 1.0,  0.68, 1.0),  "quad.out / power1.out"),
    ("power2.out",        (0.33, 1.0,  0.68, 1.0),  "cubic.out / power2.out"),
    ("power3.out",        (0.22, 1.0,  0.36, 1.0),  "quart.out / power3.out"),
    ("power4.out",        (0.19, 1.0,  0.22, 1.0),  "quint.out / power4.out"),
    ("expo.out",          (0.16, 1.0,  0.30, 1.0),  "expo.out - o 'caro' padrao"),
    ("circ.out",          (0.0,  0.55, 0.45, 1.0),  "circ.out"),
    ("back.out",          (0.34, 1.56, 0.64, 1.0),  "back.out (overshoot)"),
    ("power1.in",         (0.55, 0.085, 0.68, 0.53), "quad.in"),
    ("power2.in",         (0.55, 0.055, 0.68, 0.19), "cubic.in"),
    ("expo.in",           (0.95, 0.05, 0.795, 0.035), "expo.in"),
    ("power2.inOut",      (0.65, 0.05, 0.36, 1.0),  "cubic.inOut"),
    ("power3.inOut",      (0.77, 0.0,  0.175, 1.0), "quart.inOut"),
    ("expo.inOut",        (0.87, 0.0,  0.13, 1.0),  "expo.inOut"),
    ("sine.out",          (0.39, 0.575, 0.565, 1.0), "sine.out"),
    ("sine.inOut",        (0.445, 0.05, 0.55, 0.95), "sine.inOut"),
]


def bezier_y(x1, y1, x2, y2, x):
    """Valor Y de um cubic-bezier CSS para o progresso X (Newton + bissecao)."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0

    def cx(t):
        return 3 * t * (1 - t) ** 2 * x1 + 3 * t * t * (1 - t) * x2 + t ** 3

    def cy(t):
        return 3 * t * (1 - t) ** 2 * y1 + 3 * t * t * (1 - t) * y2 + t ** 3

    def dcx(t):
        return 3 * (1 - t) ** 2 * x1 + 6 * t * (1 - t) * (x2 - x1) + 3 * t * t * (1 - x2)

    t = x
    for _ in range(8):
        err = cx(t) - x
        if abs(err) < 1e-6:
            return cy(t)
        d = dcx(t)
        if abs(d) < 1e-6:
            break
        t -= err / d
    lo, hi, t = 0.0, 1.0, x
    for _ in range(30):
        t = (lo + hi) / 2
        if cx(t) < x:
            lo = t
        else:
            hi = t
    return cy(t)


def ajustar(ts, vs):
    """
    Curvas do catalogo ordenadas por erro medio. Devolve campea e vice.

    O vice importa: curvas vizinhas (quart.out vs expo.out) ficam a menos de
    meio ponto percentual uma da outra numa serie amostrada. Reportar so a
    campea da uma falsa precisao. Quando os erros sao proximos, o laudo deve
    dizer "≈ A, possivelmente B".
    """
    pontos = []
    for nome, (x1, y1, x2, y2), rotulo in CATALOGO:
        soma = 0.0
        for t, v in zip(ts, vs):
            soma += abs(bezier_y(x1, y1, x2, y2, t) - v)
        pontos.append({
            "nome": nome,
            "rotulo": rotulo,
            "css": "cubic-bezier(%g, %g, %g, %g)" % (x1, y1, x2, y2),
            "erro": soma / max(1, len(ts)),
        })
    pontos.sort(key=lambda p: p["erro"])
    campea = pontos[0]
    vice = pontos[1] if len(pontos) > 1 else None
    # so vale citar o vice se for uma curva distinta e realmente competitiva
    if vice and (vice["css"] == campea["css"] or vice["erro"] - campea["erro"] > 0.012):
        vice = None
    campea["vice"] = vice
    return campea


def r2_linear(ts, vs):
    """R^2 do ajuste linear. Perto de 1.0 = scrub puro, sem easing por cima."""
    n = len(ts)
    if n < 3:
        return None
    mt = sum(ts) / n
    mv = sum(vs) / n
    sxx = sum((t - mt) ** 2 for t in ts)
    sxy = sum((t - mt) * (v - mv) for t, v in zip(ts, vs))
    if sxx == 0:
        return None
    a = sxy / sxx
    b = mv - a * mt
    ss_res = sum((v - (a * t + b)) ** 2 for t, v in zip(ts, vs))
    ss_tot = sum((v - mv) ** 2 for v in vs)
    if ss_tot == 0:
        return 1.0
    return 1 - ss_res / ss_tot


# ---------------------------------------------------------------------------
# extracao de propriedades numericas de um snapshot
# ---------------------------------------------------------------------------
def props_de(snap):
    if not isinstance(snap, dict):
        return {}
    out = {}
    for k in ("top", "left", "width", "height", "opacity"):
        v = snap.get(k)
        if isinstance(v, (int, float)):
            out[k] = float(v)
    tr = snap.get("transform") or {}
    if isinstance(tr, dict):
        for k, alias in (("tx", "translateX"), ("ty", "translateY"),
                         ("scaleX", "scaleX"), ("scaleY", "scaleY"), ("rotate", "rotate")):
            v = tr.get(k)
            if isinstance(v, (int, float)):
                out["transform." + alias] = float(v)
    return out


# Limiar minimo de variacao, por tipo de propriedade. Com um limiar unico em px,
# opacity (0->1) e scale (1->1.08) sao descartados junto com o ruido.
LIMIARES = {
    "opacity": 0.02,
    "transform.scaleX": 0.008,
    "transform.scaleY": 0.008,
    "transform.rotate": 0.4,
}


def limiar_de(prop, min_delta):
    return LIMIARES.get(prop, min_delta)


def faixa_ativa(ys, min_amp):
    """
    Faixa em que a propriedade realmente se move, medida por delta entre
    amostras CONSECUTIVAS - nao por distancia ao valor final.

    A diferenca importa muito: numa curva ease-out o valor chega a 98% do
    destino bem antes do fim. Medir distancia-ao-final corta a cauda e faz
    um expo.out ser lido como quad.out, com o fator de amplitude errado
    junto. Delta consecutivo enxerga o plato de verdade.
    """
    amp = max(ys) - min(ys)
    if amp < min_amp:
        return None
    eps = max(amp * 0.0008, 0.004)
    deltas = [abs(ys[i + 1] - ys[i]) for i in range(len(ys) - 1)]
    ativos = [i for i, d in enumerate(deltas) if d > eps]
    if not ativos:
        return None
    ini, fim = ativos[0], ativos[-1] + 1
    if fim - ini < 3:
        return None
    return ini, fim


def cauda(ts, vs):
    """% do efeito que acontece nos ultimos 30% da faixa. Baixo = ease-out forte."""
    if not ts:
        return None
    total = vs[-1] - vs[0]
    if abs(total) < 1e-9:
        return None
    ref = None
    for t, v in zip(ts, vs):
        if t >= 0.7:
            ref = v
            break
    if ref is None:
        return None
    return round(abs((vs[-1] - ref) / total) * 100, 1)


def split_topo(txt):
    """Split por virgula ignorando o que esta dentro de parenteses.
    Necessario porque transition-timing-function traz
    'cubic-bezier(0.16, 1, 0.3, 1), cubic-bezier(...)' - um split ingenuo
    picotaria a propria curva."""
    partes, nivel, atual = [], 0, ""
    for ch in txt:
        if ch == "(":
            nivel += 1
        elif ch == ")":
            nivel -= 1
        if ch == "," and nivel == 0:
            partes.append(atual.strip())
            atual = ""
        else:
            atual += ch
    if atual.strip():
        partes.append(atual.strip())
    return partes


def segundos(txt):
    txt = (txt or "").strip()
    try:
        if txt.endswith("ms"):
            return float(txt[:-2]) / 1000.0
        if txt.endswith("s"):
            return float(txt[:-1])
    except ValueError:
        pass
    return 0.0


def transicoes_de(raiz):
    """
    selector -> { propriedade_css: {"dur": s, "tf": str, "delay": s} }

    Serve para desmascarar o falso scrub: uma transicao CSS de 600ms disparada
    por IntersectionObserver se espalha por varios passos de amostragem e imita
    uma curva amarrada ao scroll. Sem este cruzamento, o laudo reporta
    "easing ao longo de 1700px" quando a verdade e "0.6s no tempo".
    """
    sonda = raiz.get("sonda") or {}
    mapa = {}
    for e in sonda.get("elements", []) or []:
        sel = e.get("selector")
        st = e.get("style") or {}
        props = split_topo(st.get("transitionProperty") or "")
        durs = split_topo(st.get("transitionDuration") or "")
        tfs = split_topo(st.get("transitionTimingFunction") or "")
        delays = split_topo(st.get("transitionDelay") or "")
        if not sel or not props:
            continue
        entrada = {}
        for i, prop in enumerate(props):
            d = segundos(durs[i % len(durs)]) if durs else 0.0
            if d <= 0:
                continue
            entrada[prop.strip()] = {
                "dur": d,
                "tf": tfs[i % len(tfs)] if tfs else "",
                "delay": segundos(delays[i % len(delays)]) if delays else 0.0,
            }
        if entrada:
            mapa[sel] = entrada
    return mapa


def analisar(dados, min_delta, vh, trans=None):
    amostras = dados.get("amostras") or []
    seletores = dados.get("seletores") or []
    if not amostras:
        return []

    resultados = []
    for sel in seletores:
        serie = []
        for a in amostras:
            snap = (a.get("alvos") or {}).get(sel)
            if snap:
                serie.append((float(a.get("scrollY") or 0), props_de(snap)))
        if len(serie) < 6:
            resultados.append({"selector": sel, "erro": "amostras insuficientes (%d)" % len(serie)})
            continue

        chaves = set()
        for _, p in serie:
            chaves.update(p.keys())

        achados = []
        descartados = []
        for prop in sorted(chaves):
            pares = [(x, p[prop]) for x, p in serie if prop in p]
            if len(pares) < 6:
                continue
            xs = [p[0] for p in pares]
            ys = [p[1] for p in pares]

            distintos = len(set(round(y, 3) for y in ys))
            lim = limiar_de(prop, min_delta)
            fa = faixa_ativa(ys, lim)
            if not fa:
                # Degrau: o valor salta entre poucos estados - assinatura de
                # classe adicionada por IntersectionObserver, nao de scrub.
                # A duracao NAO esta na serie de scroll: esta em
                # transition-duration, que sonda.js ja coletou. Sem este ramo
                # o padrao de reveal mais comum da web sumiria do laudo.
                amp_tot = max(ys) - min(ys)
                if amp_tot >= lim and distintos <= 4:
                    ds = [abs(ys[i + 1] - ys[i]) for i in range(len(ys) - 1)]
                    k = ds.index(max(ds))
                    prop_css = "transform" if prop.startswith("transform.") else prop
                    t_css = (trans or {}).get(sel, {}).get(prop_css) or (trans or {}).get(sel, {}).get("all")
                    achados.append({
                        "propriedade": prop,
                        "tipo": "degrau",
                        "transicaoCss": t_css,
                        "gatilhoPx": round((xs[k] + xs[k + 1]) / 2),
                        "de": round(ys[0], 3),
                        "para": round(ys[-1], 3),
                        "amplitude": round(amp_tot, 3),
                        "valoresDistintos": distintos,
                        "nota": "estado discreto - duracao vem de transition-duration, nao da serie de scroll",
                    })
                continue
            ini, fim = fa
            xs_a, ys_a = xs[ini:fim + 1], ys[ini:fim + 1]

            x0, x1v = xs_a[0], xs_a[-1]
            y0, y1v = ys_a[0], ys_a[-1]
            span_x = x1v - x0
            span_y = y1v - y0
            if span_x == 0 or span_y == 0:
                continue

            ts = [(x - x0) / span_x for x in xs_a]
            vs = [(y - y0) / span_y for y in ys_a]

            melhor = ajustar(ts, vs)
            r2 = r2_linear(ts, vs)
            degraus = distintos <= max(3, len(ys) // 8)

            # Um elemento estatico tem `top` caindo 1:1 com o scroll - isso e a
            # pagina rolando, nao um efeito. Sem este filtro a tabela enche de
            # linhas com fator ~1.0 e o sinal real (parallax 0.4, pin) some no meio.
            fator = abs(span_y) / span_x if span_x else 0
            if (prop in ("top", "left")
                    and 0.93 <= fator <= 1.07
                    and r2 is not None and r2 > 0.995):
                descartados.append("%s/%s (fator %.2f, acompanha o scroll 1:1)" % (sel, prop, fator))
                continue

            prop_css = "transform" if prop.startswith("transform.") else prop
            t_css = (trans or {}).get(sel, {}).get(prop_css) or (trans or {}).get(sel, {}).get("all")
            achados.append({
                "propriedade": prop,
                "tipo": "transicao-temporal" if t_css else "continuo",
                "transicaoCss": t_css,
                "inicioPx": round(x0),
                "fimPx": round(x1v),
                "duracaoPx": round(span_x),
                "duracaoVh": round(span_x / vh, 2) if vh else None,
                "de": round(y0, 3),
                "para": round(y1v, 3),
                "amplitude": round(span_y, 3),
                "fatorVsScroll": round(abs(span_y) / span_x, 4) if span_x else None,
                "easing": melhor["nome"],
                "easingCss": melhor["css"],
                "easingRotulo": melhor["rotulo"],
                "erroMedioPct": round(melhor["erro"] * 100, 2),
                "alternativa": (melhor.get("vice") or {}).get("nome"),
                "alternativaCss": (melhor.get("vice") or {}).get("css"),
                "alternativaErroPct": round(melhor["vice"]["erro"] * 100, 2) if melhor.get("vice") else None,
                "r2Linear": round(r2, 4) if r2 is not None else None,
                "provavelScrubPuro": bool(r2 is not None and r2 > 0.985),
                "pctNosUltimos30": cauda(ts, vs),
                "estadoDiscreto": degraus,
                "valoresDistintos": distintos,
            })

        resultados.append({"selector": sel, "propriedades": achados, "descartados": descartados})
    return resultados


def analisar_damping(dados):
    """Estima o fator de lerp a partir do assentamento pos-salto."""
    d = dados.get("damping")
    if not d or not d.get("trilha"):
        return None
    trilha = d["trilha"]
    saida = {"scroll": None, "alvos": {}}

    def estimar(vals):
        vals = [v for v in vals if isinstance(v, (int, float))]
        if len(vals) < 8:
            return None
        final = vals[-1]
        res = [abs(v - final) for v in vals]
        if res[0] < 1e-6:
            return None
        razoes = []
        for i in range(len(res) - 1):
            if res[i] > 1e-4:
                razoes.append(res[i + 1] / res[i])
        razoes = [r for r in razoes if 0 < r < 1.0][:20]
        if len(razoes) < 4:
            return None
        media = sum(razoes) / len(razoes)
        k = 1 - media
        frames_ate_1pct = math.log(0.01) / math.log(media) if 0 < media < 1 else None
        return {
            "fatorLerpPorFrame": round(k, 4),
            "framesAte1pct": round(frames_ate_1pct, 1) if frames_ate_1pct else None,
            "temInercia": bool(k < 0.5),
        }

    saida["scroll"] = estimar([t.get("scrollY") for t in trilha])
    chaves = set()
    for t in trilha:
        chaves.update((t.get("alvos") or {}).keys())
    for sel in chaves:
        for prop in ("top", "ty", "opacity"):
            vals = [(t.get("alvos") or {}).get(sel, {}).get(prop) for t in trilha]
            est = estimar(vals)
            if est:
                saida["alvos"].setdefault(sel, {})[prop] = est
    return saida


def para_markdown(resultados, damping, dados):
    L = []
    ax = dados.get("axis") or {}
    L.append("## Números extraídos")
    L.append("")
    L.append("Eixo de progresso: `%s` · scroll útil: %s px · %s amostras"
             % (ax.get("mode", "?"), dados.get("scrollMax", "?"), len(dados.get("amostras") or [])))
    tardios = dados.get("apareceramDepois") or []
    if tardios:
        L.append("")
        L.append("**Lazy-load detectado** — apareceram só depois de rolar: "
                 + ", ".join("`%s` (scrollY %s)" % (t["selector"], t["apareceuEmScrollY"]) for t in tardios))
    L.append("")
    L.append("_Início e fim têm resolução de um passo de amostragem (%s px). Aumente `steps` para apertar._"
             % (round((dados.get("scrollMax") or 0) / max(1, dados.get("steps") or 1))))
    L.append("")
    if any(p.get("tipo") == "transicao-temporal" for r in resultados for p in r.get("propriedades", [])):
        L.append("")
        L.append("> Linhas marcadas **(transição no tempo)** não são scrub: a curva vem de `transition-*` "
                 "no CSS e roda em segundos, não em pixels de scroll. O intervalo em px mostra apenas "
                 "onde o gatilho caiu durante a varredura — reimplementar isso como scrub daria errado.")
    L.append("")
    L.append("| Elemento | Propriedade | Início → fim (px) | Duração | de → para | Amplitude | Fator | Easing estimado | Erro | R² lin |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    algum = False
    for r in resultados:
        if r.get("erro"):
            L.append("| `%s` | — | — | — | — | — | — | %s | — | — |" % (r["selector"], r["erro"]))
            continue
        for p in r.get("propriedades", []):
            algum = True
            if p.get("tipo") == "transicao-temporal":
                t = p["transicaoCss"]
                L.append("| `%s` | %s **(transição no tempo, não scrub)** | dispara entre %s e %s | **%ss** + %ss de delay | %s → %s | %s | — | `%s` (lido do CSS) | exato | — |"
                         % (r["selector"], p["propriedade"], p["inicioPx"], p["fimPx"],
                            t["dur"], t["delay"], p["de"], p["para"], p["amplitude"], t["tf"]))
                continue
            if p.get("tipo") == "degrau":
                t = p.get("transicaoCss")
                curva = ("`%s` em %ss (lido do CSS)" % (t["tf"], t["dur"])) if t else "sem transição no CSS — troca instantânea"
                L.append("| `%s` | %s *(degrau)* | salta em ~%s | — | %s → %s | %s | — | %s | — | — |"
                         % (r["selector"], p["propriedade"], p["gatilhoPx"], p["de"], p["para"], p["amplitude"], curva))
                continue
            if p["estadoDiscreto"]:
                marca = " *(discreto)*"
            elif p["provavelScrubPuro"]:
                marca = " *(scrub puro)*"
            elif p["pctNosUltimos30"] is not None and p["pctNosUltimos30"] < 6:
                marca = " *(cauda longa: só %s%% nos últimos 30%%)*" % p["pctNosUltimos30"]
            else:
                marca = ""
            easing = "`%s` (%s)" % (p["easingCss"], p["easingRotulo"])
            erro = "%s%%" % p["erroMedioPct"]
            if p.get("alternativa"):
                easing += "<br>ou `%s` (%s)" % (p["alternativaCss"], p["alternativa"])
                erro += "<br>%s%%" % p["alternativaErroPct"]
            L.append("| `%s` | %s%s | %s → %s | %s px (%sv) | %s → %s | %s | %s | %s | %s | %s |" % (
                r["selector"], p["propriedade"], marca, p["inicioPx"], p["fimPx"],
                p["duracaoPx"], p["duracaoVh"], p["de"], p["para"], p["amplitude"],
                p["fatorVsScroll"], easing, erro, p["r2Linear"]))
    if not algum:
        L.append("| — | — | — | — | — | — | — | nenhuma propriedade variou acima do limiar | — | — |")

    todos_desc = [d for r in resultados for d in r.get("descartados", [])]
    if todos_desc:
        L.append("")
        L.append("_%d série(s) descartada(s) por acompanharem o scroll 1:1, sem efeito próprio: %s_"
                 % (len(todos_desc), "; ".join(todos_desc[:6]) + ("; …" if len(todos_desc) > 6 else "")))

    if damping:
        L.append("")
        L.append("### Damping / lerp")
        s = damping.get("scroll")
        if s:
            L.append("- **Scroll**: fator ≈ `%s` por frame · %s frames até assentar · inércia: %s"
                     % (s["fatorLerpPorFrame"], s["framesAte1pct"], "sim" if s["temInercia"] else "não"))
        for sel, props in (damping.get("alvos") or {}).items():
            for prop, est in props.items():
                L.append("- `%s` / %s: fator ≈ `%s` por frame%s"
                         % (sel, prop, est["fatorLerpPorFrame"], " (com inércia)" if est["temInercia"] else ""))
        if not s and not damping.get("alvos"):
            L.append("- Sem inércia mensurável: os valores assentam no mesmo frame do scroll.")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description="Ajusta easings a partir da serie amostrada.")
    ap.add_argument("entrada", help="JSON de amostrar.js, ou '-' para stdin")
    ap.add_argument("--md", action="store_true", help="saida em markdown (padrao)")
    ap.add_argument("--json", action="store_true", help="saida em JSON")
    ap.add_argument("--min-delta", type=float, default=1.5,
                    help="variacao minima para considerar a propriedade animada (px ou unidades)")
    args = ap.parse_args()

    raw = sys.stdin.read() if args.entrada == "-" else open(args.entrada, "r", encoding="utf-8").read()
    raiz = json.loads(raw)
    trans = transicoes_de(raiz)
    dados = raiz
    if "amostras" not in dados and isinstance(dados.get("amostragem"), dict):
        dados = dados["amostragem"]

    if not dados.get("ok", True) or not dados.get("amostras"):
        print("Amostragem indisponivel: %s" % (dados.get("nota") or "sem amostras no JSON"), file=sys.stderr)
        sys.exit(2)

    vh = ((dados.get("viewport") or {}).get("h")) or 900
    resultados = analisar(dados, args.min_delta, vh, trans)
    damping = analisar_damping(dados)

    if args.json:
        print(json.dumps({"resultados": resultados, "damping": damping}, ensure_ascii=False, indent=2))
    else:
        print(para_markdown(resultados, damping, dados))


if __name__ == "__main__":
    main()
