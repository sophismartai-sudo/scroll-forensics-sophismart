/**
 * scroll-forensics :: Fase 4 - varredura scrollY -> propriedades
 *
 * Instala window.__SF_amostrar(seletores, opcoes) -> Promise<serie>
 *
 * Esta e a fase que separa laudo de chute. Percorre a pagina em passos,
 * espera os frames assentarem, e grava o estado visual de cada alvo.
 *
 * Trata tres casos que quebram a amostragem ingenua:
 *   1. scroll virtual  - window.scrollTo nao move nada (Locomotive/Lenis)
 *   2. lazy-load       - alvos que so existem depois de rolar
 *   3. lerp/damping    - valor continua se movendo depois que o scroll para
 *
 * Uso:
 *   await window.__SF_amostrar(['#hero', '.card'], { steps: 48 })
 */
(() => {
  if (window.__SF_amostrar) return 'already-loaded';

  const round = (n, d = 2) => (typeof n === 'number' && isFinite(n) ? +n.toFixed(d) : null);
  // rAF com escape por timeout. Numa aba que nao esta sendo pintada (Browser
  // pane em background, aba oculta) o requestAnimationFrame NAO dispara - e um
  // `await frame()` puro travaria a amostragem para sempre, sem erro.
  const frame = () => new Promise((r) => {
    let feito = false;
    const fim = () => { if (!feito) { feito = true; r(); } };
    requestAnimationFrame(fim);
    setTimeout(fim, 60);
  });

  /** Prova se o rAF esta realmente vivo. Sem isso, a Fase 4 mede estado congelado. */
  window.__SF_rafVivo = (ms = 250) => new Promise((res) => {
    let n = 0;
    const t0 = performance.now();
    const passo = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(passo); };
    requestAnimationFrame(passo);
    setTimeout(() => res({ frames: n, ms, vivo: n > 3, vis: document.visibilityState }), ms + 80);
  });
  const frames = async (n) => { for (let i = 0; i < n; i++) await frame(); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Matriz CSS -> translate / scale / rotate legiveis. */
  function decompose(transform) {
    if (!transform || transform === 'none') {
      return { tx: 0, ty: 0, tz: 0, scaleX: 1, scaleY: 1, rotate: 0, identity: true };
    }
    try {
      const m = new DOMMatrixReadOnly(transform);
      return {
        tx: round(m.m41), ty: round(m.m42), tz: round(m.m43),
        scaleX: round(Math.hypot(m.m11, m.m12), 4),
        scaleY: round(Math.hypot(m.m21, m.m22), 4),
        rotate: round((Math.atan2(m.m12, m.m11) * 180) / Math.PI, 2),
        identity: false,
      };
    } catch (e) {
      return { raw: transform, parseError: true };
    }
  }

  function snapshot(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      top: round(r.top, 1),
      left: round(r.left, 1),
      width: round(r.width, 1),
      height: round(r.height, 1),
      opacity: round(parseFloat(cs.opacity), 4),
      transform: decompose(cs.transform),
      clipPath: cs.clipPath === 'none' ? null : cs.clipPath,
      filter: cs.filter === 'none' ? null : cs.filter,
      visibility: cs.visibility,
    };
  }

  /** Descobre por qual eixo a pagina "progride". */
  async function detectAxis() {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    if (max <= 0) return { mode: 'none', max: 0, nota: 'pagina nao rola' };

    const y0 = window.scrollY;
    const alvo = Math.min(400, max);
    window.scrollTo(0, alvo);
    await frames(3);
    if (Math.abs(window.scrollY - alvo) < 40) {
      window.scrollTo(0, y0);
      await frames(2);
      return { mode: 'window', max };
    }

    // scrollTo nao pegou: tenta wheel sintetico
    document.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }));
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }));
    await sleep(300);
    if (window.scrollY > 40) {
      window.scrollTo(0, y0);
      await frames(2);
      return { mode: 'wheel', max };
    }

    // scroll virtual: procura container transformado
    const cands = document.querySelectorAll('[data-scroll-container], body > div:first-child, main');
    for (const c of cands) {
      const t = getComputedStyle(c).transform;
      if (t && t !== 'none') {
        return { mode: 'transform', max, container: c.tagName.toLowerCase(), nota: 'scroll virtual - progresso lido do transform do container' };
      }
    }
    return { mode: 'bloqueado', max, nota: 'scrollTo e wheel nao moveram a pagina e nenhum container transformado foi encontrado' };
  }

  /**
   * @param {string[]} seletores  alvos (use os `selector` devolvidos por sonda.js)
   * @param {object}   opts       { steps=48, settleFrames=3, probeDamping=true }
   */
  window.__SF_amostrar = async function (seletores, opts) {
    opts = opts || {};
    // mesma guarda da sonda: sem layout, a serie inteira sai zerada
    if (!window.innerHeight || !window.innerWidth) {
      return { ok: false, erro: 'VIEWPORT_ZERO', innerWidth: window.innerWidth, innerHeight: window.innerHeight,
               comoResolver: 'traga a aba para a frente ou defina um viewport antes de amostrar' };
    }
    // Checa o rAF de fato, nao o visibilityState: o que quebra a amostragem e a
    // aba nao estar sendo PINTADA. Medido: o Browser pane reporta hidden e
    // suspende o rAF mesmo com a aba em foco - a serie sairia congelada.
    const vivo = await window.__SF_rafVivo(250);
    if (!vivo.vivo) {
      return { ok: false, erro: 'RAF_SUSPENSO', rafProbe: vivo,
               nota: 'a aba nao esta sendo pintada: rAF parado, animacoes congeladas, a serie mediria um estado morto',
               comoResolver: 'use o playwright_runner.mjs (headless pinta normalmente) - a Fase 4 nao e confiavel neste transporte' };
    }
    const steps = Math.max(8, Math.min(120, opts.steps || 48));
    const settleFrames = opts.settleFrames == null ? 3 : opts.settleFrames;

    const yInicial = window.scrollY;
    const axis = await detectAxis();

    if (axis.mode === 'none' || axis.mode === 'bloqueado') {
      window.scrollTo(0, yInicial);
      return { ok: false, axis, nota: axis.nota, amostras: [] };
    }

    const max = axis.max;
    const amostras = [];
    const apareceramDepois = [];
    const vistos = new Set();

    for (let i = 0; i <= steps; i++) {
      const pedido = Math.round((max * i) / steps);

      if (axis.mode === 'wheel') {
        const delta = pedido - window.scrollY;
        if (Math.abs(delta) > 1) {
          window.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true, cancelable: true }));
          await sleep(120);
        }
      } else {
        window.scrollTo(0, pedido);
      }
      await frames(settleFrames);

      const real = window.scrollY;
      const linha = { i, pedido, scrollY: round(real, 1), alvos: {} };

      // re-resolve a cada passo: conteudo lazy-loaded so existe depois de rolar
      for (const sel of seletores) {
        let el = null;
        try { el = document.querySelector(sel); } catch (e) {}
        if (!el) { linha.alvos[sel] = null; continue; }
        if (!vistos.has(sel)) {
          vistos.add(sel);
          if (i > 0) apareceramDepois.push({ selector: sel, apareceuEmScrollY: round(real, 0), passo: i });
        }
        linha.alvos[sel] = snapshot(el);
      }

      // progresso do scroll virtual, quando aplicavel
      if (axis.mode === 'transform' && axis.container) {
        const c = document.querySelector('[data-scroll-container]') || document.querySelector(axis.container);
        if (c) linha.containerTy = decompose(getComputedStyle(c).transform).ty;
      }

      amostras.push(linha);
    }

    // ---- sonda de damping/lerp: para o scroll e ve se o valor continua andando
    let damping = null;
    if (opts.probeDamping !== false && seletores.length) {
      const alvo = Math.round(max * 0.5);
      if (axis.mode !== 'wheel') window.scrollTo(0, alvo);
      await sleep(500);
      // pulo brusco, depois observa o assentamento frame a frame
      const salto = Math.round(max * 0.62);
      if (axis.mode === 'wheel') {
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: salto - window.scrollY, bubbles: true, cancelable: true }));
      } else {
        window.scrollTo(0, salto);
      }
      const trilha = [];
      for (let f = 0; f < 40; f++) {
        await frame();
        const linha = { f, scrollY: round(window.scrollY, 1), alvos: {} };
        for (const sel of seletores.slice(0, 3)) {
          let el = null;
          try { el = document.querySelector(sel); } catch (e) {}
          if (el) {
            const cs = getComputedStyle(el);
            linha.alvos[sel] = { top: round(el.getBoundingClientRect().top, 2), ty: decompose(cs.transform).ty, opacity: round(parseFloat(cs.opacity), 4) };
          }
        }
        trilha.push(linha);
      }
      damping = { descricao: 'salto de scroll seguido de 40 frames parados; valores que continuam mudando indicam lerp', trilha };
    }

    window.scrollTo(0, yInicial);
    await frames(2);

    return {
      ok: true,
      axis,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      scrollMax: max,
      steps,
      seletores,
      apareceramDepois,
      amostras,
      damping,
      instrumentation: window.__SF__ && window.__SF__.report ? window.__SF__.report() : null,
    };
  };

  /** Mede fps durante um scroll continuo (Fase 5 - custo). */
  window.__SF_fps = async function (durMs) {
    durMs = durMs || 2000;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max <= 0) return { fps: null, nota: 'pagina nao rola' };
    const y0 = window.scrollY;
    let count = 0, rodando = true;
    const t0 = performance.now();
    const tick = () => { count++; if (rodando) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const passos = Math.max(1, Math.round(durMs / 16));
    for (let i = 0; i < passos; i++) {
      window.scrollTo(0, Math.round((max * i) / passos));
      await frame();
    }
    rodando = false;
    const dt = performance.now() - t0;
    window.scrollTo(0, y0);
    return { fps: round((count / dt) * 1000, 1), frames: count, ms: round(dt, 0) };
  };

  return 'loaded';
})();
