/**
 * scroll-forensics :: Fases 1-2 - deteccao de stack + tecnica de posicionamento
 *
 * Rodar DEPOIS da pagina carregar e assentar. Retorna um objeto JSON.
 * Nao depende de instrumentar.js, mas incorpora o relatorio dele se existir.
 *
 * Uso:
 *   - browser MCP: avaliar este arquivo na pagina, o valor de retorno e o JSON
 *   - playwright:  page.evaluate(fs.readFileSync('sonda.js','utf8'))
 */
(() => {
  // Guarda de viewport. Uma aba em background ou de tamanho zero entrega
  // innerHeight 0 e todos os getBoundingClientRect zerados - as medidas sairiam
  // 0/NaN sem nenhum erro, e o laudo ficaria vazio ou plausivel-e-errado.
  // Falhar alto aqui e melhor que medir o nada.
  if (!window.innerHeight || !window.innerWidth) {
    return { erro: 'VIEWPORT_ZERO',
             innerWidth: window.innerWidth, innerHeight: window.innerHeight,
             visibilityState: document.visibilityState,
             comoResolver: 'traga a aba para a frente (tabs_select) ou defina um viewport (resize_window / newContext({viewport})) e rode de novo' };
  }

  const round = (n, d = 2) => (typeof n === 'number' && isFinite(n) ? +n.toFixed(d) : n);
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // id e class sao escritos pela pagina analisada: dados nao confiaveis.
  // Truncamos para limitar o tamanho de um comando plantado ai. O seletor
  // funcional (selectorOf) nao e truncado, pois precisa continuar valido.
  const CORTE_ID = 40;
  const corta = (s) => (s && s.length > CORTE_ID ? s.slice(0, CORTE_ID) + '\u2026' : s);

  const desc = (el) => {
    if (!el || el.nodeType !== 1) return String(el);
    const id = el.id ? '#' + corta(el.id) : '';
    let cls = '';
    const cn = el.getAttribute('class');
    if (cn) cls = '.' + cn.trim().split(/\s+/).slice(0, 3).map(corta).join('.');
    return el.tagName.toLowerCase() + id + cls;
  };

  /** Seletor unico e estavel, para a fase de amostragem reencontrar o elemento. */
  const selectorOf = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const path = [];
    let node = el;
    while (node && node.nodeType === 1 && path.length < 5) {
      let part = node.tagName.toLowerCase();
      const cn = node.getAttribute('class');
      if (cn) {
        const c = cn.trim().split(/\s+/).filter((x) => x && !/^\d/.test(x))[0];
        if (c) part += '.' + CSS.escape(c);
      }
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((s) => s.tagName === node.tagName);
        if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
      }
      path.unshift(part);
      if (node.id) { path[0] = '#' + CSS.escape(node.id); break; }
      node = parent;
    }
    return path.join(' > ');
  };

  // ==========================================================================
  // FASE 1 - deteccao de bibliotecas
  // ==========================================================================
  const has = (sel) => { try { return document.querySelector(sel) !== null; } catch (e) { return false; } };
  const count = (sel) => { try { return document.querySelectorAll(sel).length; } catch (e) { return 0; } };
  const glob = (k) => { try { return typeof window[k] !== 'undefined'; } catch (e) { return false; } };

  const libs = [];
  const add = (name, confidence, evidence) => {
    if (!evidence.length) return;
    libs.push({ name, confidence, evidence });
  };

  // --- GSAP / ScrollTrigger
  {
    const ev = [];
    if (glob('gsap')) ev.push('window.gsap presente');
    if (glob('ScrollTrigger')) ev.push('window.ScrollTrigger presente');
    if (count('.pin-spacer')) ev.push(count('.pin-spacer') + ' elemento(s) .pin-spacer');
    if (has('[id^="gsap-"]')) ev.push('nodes gerados com id gsap-*');
    try {
      if (window.gsap && window.ScrollTrigger && window.ScrollTrigger.getAll) {
        const all = window.ScrollTrigger.getAll();
        ev.push(all.length + ' ScrollTrigger(s) registrados');
      }
    } catch (e) {}
    const conf = glob('gsap') || glob('ScrollTrigger') ? 'alta' : (count('.pin-spacer') ? 'media' : 'baixa');
    add('GSAP + ScrollTrigger', conf, ev);
  }

  // --- Lenis
  {
    const ev = [];
    if (glob('Lenis')) ev.push('window.Lenis presente');
    if (document.documentElement.classList.contains('lenis')) ev.push('classe .lenis no <html>');
    if (has('.lenis-smooth, html.lenis-smooth')) ev.push('classe .lenis-smooth');
    if (count('[data-lenis-prevent]')) ev.push('[data-lenis-prevent] no DOM');
    add('Lenis (smooth scroll)', glob('Lenis') || document.documentElement.classList.contains('lenis') ? 'alta' : 'media', ev);
  }

  // --- Locomotive Scroll
  {
    const ev = [];
    if (glob('LocomotiveScroll')) ev.push('window.LocomotiveScroll presente');
    if (has('[data-scroll-container]')) ev.push('[data-scroll-container]');
    if (count('[data-scroll-section]')) ev.push(count('[data-scroll-section]') + ' [data-scroll-section]');
    if (count('[data-scroll]')) ev.push(count('[data-scroll]') + ' [data-scroll]');
    if (has('.has-scroll-smooth')) ev.push('classe .has-scroll-smooth');
    if (count('.is-inview')) ev.push(count('.is-inview') + ' .is-inview');
    add('Locomotive Scroll', has('[data-scroll-container]') || glob('LocomotiveScroll') ? 'alta' : 'media', ev);
  }

  // --- Framer Motion
  {
    const ev = [];
    if (count('[data-projection-id]')) ev.push(count('[data-projection-id]') + ' [data-projection-id]');
    if (has('[data-framer-name]')) ev.push('[data-framer-name] (Framer site)');
    if (glob('__FRAMER_FEATURES__')) ev.push('__FRAMER_FEATURES__');
    add('Framer Motion', count('[data-projection-id]') ? 'alta' : 'baixa', ev);
  }

  // --- AOS
  { const ev = []; if (count('[data-aos]')) ev.push(count('[data-aos]') + ' [data-aos]'); if (glob('AOS')) ev.push('window.AOS'); add('AOS', ev.length ? 'alta' : 'baixa', ev); }

  // --- ScrollMagic
  { const ev = []; if (glob('ScrollMagic')) ev.push('window.ScrollMagic'); if (count('.scrollmagic-pin-spacer')) ev.push('.scrollmagic-pin-spacer'); add('ScrollMagic', ev.length ? 'alta' : 'baixa', ev); }

  // --- Swiper
  { const ev = []; if (glob('Swiper')) ev.push('window.Swiper'); if (count('.swiper-slide')) ev.push(count('.swiper-slide') + ' .swiper-slide'); if (count('swiper-container, swiper-slide')) ev.push('web components do Swiper'); add('Swiper', ev.length ? 'alta' : 'baixa', ev); }

  // --- ScrollReveal / Motion One / anime.js / Rellax
  { const ev = []; if (glob('ScrollReveal')) ev.push('window.ScrollReveal'); add('ScrollReveal', 'alta', ev); }
  { const ev = []; if (glob('Motion')) ev.push('window.Motion (Motion One)'); add('Motion One', 'media', ev); }
  { const ev = []; if (glob('anime')) ev.push('window.anime'); add('anime.js', 'alta', ev); }
  { const ev = []; if (glob('Rellax')) ev.push('window.Rellax'); add('Rellax (parallax)', 'alta', ev); }

  // --- Scroll-driven animations nativas (CSS)
  {
    const ev = [];
    const supports = window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()');
    let found = 0;
    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length && i < 3000; i++) {
      const cs = getComputedStyle(all[i]);
      const at = cs.animationTimeline || cs.getPropertyValue('animation-timeline');
      const vt = cs.viewTimelineName || cs.getPropertyValue('view-timeline-name');
      if ((at && at !== 'auto' && at !== 'none' && at !== '') || (vt && vt !== 'none' && vt !== '')) found++;
    }
    if (found) ev.push(found + ' elemento(s) com animation-timeline/view-timeline');
    if (found && supports) ev.push('navegador suporta scroll()/view() timelines');
    add('Scroll-driven animations nativas (CSS)', found ? 'alta' : 'baixa', ev);
  }

  // --- WebGL / Three
  {
    const ev = [];
    const canvases = Array.from(document.querySelectorAll('canvas'));
    let webgl = 0;
    for (const c of canvases) {
      try {
        if (c.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) || c.getContext('webgl')) webgl++;
      } catch (e) {}
    }
    if (webgl) ev.push(webgl + ' canvas com contexto WebGL');
    if (glob('THREE')) ev.push('window.THREE');
    add('Three.js / WebGL', glob('THREE') ? 'alta' : (webgl ? 'media' : 'baixa'), ev);
  }

  // --- Lottie / Rive
  { const ev = []; if (glob('lottie') || glob('bodymovin')) ev.push('window.lottie/bodymovin'); if (count('lottie-player, dotlottie-player')) ev.push('elemento <lottie-player>'); add('Lottie', ev.length ? 'alta' : 'baixa', ev); }
  { const ev = []; if (glob('rive')) ev.push('window.rive'); if (count('canvas[data-rive], .rive')) ev.push('canvas marcado como rive'); add('Rive', ev.length ? 'alta' : 'baixa', ev); }

  const detected = libs.filter((l) => l.evidence.length > 0);

  // ==========================================================================
  // FASE 2 - elementos-chave e tecnica de posicionamento
  // ==========================================================================
  const candidates = new Map();
  const push = (el, motivo) => {
    if (!el || el.nodeType !== 1) return;
    if (!candidates.has(el)) candidates.set(el, new Set());
    candidates.get(el).add(motivo);
  };

  // hero: primeiro bloco de conteudo com altura relevante
  const heroSel = 'header, main > section:first-of-type, main > div:first-of-type, body > section:first-of-type, [class*="hero" i], [id*="hero" i]';
  document.querySelectorAll(heroSel).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.height > vh * 0.45) push(el, 'hero');
  });

  // varredura por assinaturas de posicionamento
  const scan = document.querySelectorAll('body *');
  const LIMIT = 4000;
  for (let i = 0; i < scan.length && i < LIMIT; i++) {
    const el = scan[i];
    const r = el.getBoundingClientRect();
    if (r.width < 24 && r.height < 24) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'sticky') push(el, 'sticky');
    if (cs.position === 'fixed' && r.height > vh * 0.3) push(el, 'fixed grande');
    if (cs.willChange && cs.willChange !== 'auto') push(el, 'will-change: ' + cs.willChange);
    if (cs.scrollSnapType && cs.scrollSnapType !== 'none') push(el, 'scroll-snap container');
    if (cs.clipPath && cs.clipPath !== 'none') push(el, 'clip-path');
    if (cs.maskImage && cs.maskImage !== 'none') push(el, 'mask-image');
    if (cs.perspective && cs.perspective !== 'none') push(el, 'perspective');
    if (cs.transform && cs.transform !== 'none' && r.height > vh * 0.2) push(el, 'transform grande');
    // Estilo INLINE = alguem esta escrevendo nesse elemento por JS a cada frame.
    // Sinal muito mais forte que tamanho: o filtro por altura descartava
    // justamente os alvos pequenos que a biblioteca anima (um titulo de 80px
    // sendo escalado pelo ScrollTrigger nao passa em `height > 20% da viewport`).
    if (el.style && el.style.transform) push(el, 'transform inline (escrito por JS)');
    if (el.style && el.style.opacity !== '') push(el, 'opacity inline (escrito por JS)');
    if (el.style && el.style.clipPath) push(el, 'clip-path inline (escrito por JS)');
  }
  // filhos diretos de um pin-spacer sao sempre relevantes: e o conteudo pinado
  document.querySelectorAll('.pin-spacer > *, .scrollmagic-pin-spacer > *')
    .forEach((el) => push(el, 'conteudo pinado'));
  document.querySelectorAll('.pin-spacer, .scrollmagic-pin-spacer, [data-scroll], [data-aos], [data-projection-id]')
    .forEach((el) => push(el, 'marcado por biblioteca'));

  const elements = [];
  let idx = 0;
  for (const [el, motivos] of candidates) {
    if (elements.length >= 14) break;
    idx++;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const parent = el.parentElement;
    const pr = parent ? parent.getBoundingClientRect() : null;

    // Duracao do pin. Ha dois padroes e eles nao se parecem:
    //  a) CSS puro  - filho `position: sticky` num wrapper mais alto
    //  b) GSAP / ScrollMagic - filho `position: fixed` dentro de um .pin-spacer,
    //     que e o elemento que segura o espaco. Sem tratar (b), todo site com
    //     ScrollTrigger sai do laudo com "pin: nao medido".
    let pinDurationPx = null, pinDurationVh = null, pinPadrao = null;
    if (cs.position === 'sticky' && pr && pr.height > r.height + 8) {
      pinDurationPx = round(pr.height - r.height, 0);
      pinDurationVh = round((pr.height - r.height) / vh, 2);
      pinPadrao = 'sticky';
    } else {
      const SPACER = '.pin-spacer, .scrollmagic-pin-spacer';
      let spacer = null, fixo = null;
      if (el.matches && el.matches(SPACER)) {
        spacer = el;
        fixo = Array.from(el.children).find((c) => {
          const p = getComputedStyle(c).position;
          return p === 'fixed' || p === 'absolute';
        }) || null;
      } else if (cs.position === 'fixed' && el.closest) {
        spacer = el.closest(SPACER);
        fixo = el;
      }
      if (spacer && fixo) {
        const sr = spacer.getBoundingClientRect();
        const fr = fixo.getBoundingClientRect();
        if (sr.height > fr.height + 8) {
          pinDurationPx = round(sr.height - fr.height, 0);
          pinDurationVh = round((sr.height - fr.height) / vh, 2);
          pinPadrao = 'pin-spacer (GSAP/ScrollMagic)';
        }
      }
    }

    // container com altura artificial (compra scroll)
    const contentH = el.scrollHeight;
    const boxH = r.height;
    const alturaArtificial = boxH > vh * 1.5 && contentH < boxH * 0.7;

    elements.push({
      i: idx,
      desc: desc(el),
      selector: selectorOf(el),
      motivos: Array.from(motivos),
      rect: { top: round(r.top, 1), height: round(r.height, 1), width: round(r.width, 1) },
      docTop: round(r.top + window.scrollY, 1),
      style: {
        position: cs.position,
        transform: cs.transform === 'none' ? 'none' : cs.transform,
        willChange: cs.willChange,
        contain: cs.contain,
        backfaceVisibility: cs.backfaceVisibility,
        perspective: cs.perspective,
        scrollSnapType: cs.scrollSnapType,
        scrollSnapAlign: cs.scrollSnapAlign,
        clipPath: cs.clipPath,
        maskImage: cs.maskImage === 'none' ? 'none' : '(presente)',
        filter: cs.filter,
        overflow: cs.overflow,
        opacity: cs.opacity,
        transitionProperty: cs.transitionProperty,
        transitionDuration: cs.transitionDuration,
        transitionTimingFunction: cs.transitionTimingFunction,
        transitionDelay: cs.transitionDelay,
        animationName: cs.animationName,
        animationDuration: cs.animationDuration,
        animationTimingFunction: cs.animationTimingFunction,
        animationTimeline: cs.animationTimeline || cs.getPropertyValue('animation-timeline') || '',
      },
      parent: parent ? {
        desc: desc(parent),
        height: round(pr.height, 1),
        heightVh: round(pr.height / vh, 2),
        overflow: getComputedStyle(parent).overflow,
      } : null,
      pinDurationPx,
      pinDurationVh,
      pinPadrao,
      alturaArtificial,
    });
  }

  // ==========================================================================
  // metricas de pagina + instrumentacao
  // ==========================================================================
  const doc = document.documentElement;
  const page = {
    href: location.href,
    host: location.host,
    title: document.title ? '(presente)' : '(vazio)',
    viewport: { w: vw, h: vh, dpr: window.devicePixelRatio },
    scrollHeight: doc.scrollHeight,
    scrollableY: Math.max(0, doc.scrollHeight - vh),
    scrollableVh: round(Math.max(0, doc.scrollHeight - vh) / vh, 2),
    htmlScrollBehavior: getComputedStyle(doc).scrollBehavior,
    bodyOverflow: getComputedStyle(document.body).overflow,
    bodyTransform: getComputedStyle(document.body).transform,
    htmlClasses: doc.className ? doc.className.split(/\s+/).slice(0, 12) : [],
    prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    // wrapper com transform + body overflow hidden = scroll virtual
    virtualScrollHint:
      getComputedStyle(document.body).overflow === 'hidden' ||
      (getComputedStyle(document.body).transform || 'none') !== 'none',
  };

  // Aviso, nao bloqueio: computed style e layout funcionam numa aba nao pintada.
  // Quem nao funciona e a Fase 4, que depende de rAF - por isso o alerta viaja
  // junto no resultado, para o laudo registrar a limitacao.
  const avisos = [];
  if (document.visibilityState === 'hidden') {
    avisos.push('aba nao esta sendo pintada (visibilityState=hidden): rAF suspenso, animacoes congeladas. Fases 1-2 valem; Fase 4 exige playwright_runner.mjs');
  }
  if (page.prefersReducedMotion) {
    avisos.push('o ambiente esta com prefers-reduced-motion: reduce - o site pode estar servindo a versao sem animacao');
  }

  const instrumentation = (window.__SF__ && window.__SF__.report)
    ? window.__SF__.report()
    : { preloadInstrumented: false, nota: 'instrumentar.js nao rodou antes do load; IO/listeners do boot nao capturados' };

  return {
    fase: '1-2',
    avisos,
    page,
    libs: detected,
    libsSemEvidencia: libs.filter((l) => !l.evidence.length).map((l) => l.name),
    elements,
    instrumentation,
  };
})();
