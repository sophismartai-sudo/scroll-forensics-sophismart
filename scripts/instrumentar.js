/**
 * scroll-forensics :: Fase 0 - instrumentacao pre-load
 *
 * Injetar em about:blank ANTES de navegar para a URL alvo (ou via
 * page.addInitScript no Playwright). Captura registros que so existem
 * no momento em que a pagina se inicializa.
 *
 * Instala window.__SF__ e monkey-patcha, sem quebrar a pagina:
 *   - IntersectionObserver  -> root, rootMargin, threshold, alvos observados
 *   - addEventListener      -> scroll / wheel / touchmove (alvo, passive, capture)
 *   - requestAnimationFrame -> contagem (proxy de animacao pilotada por JS)
 *   - preventDefault        -> em wheel/touchmove = smooth-scroll virtual
 *
 * Idempotente: rodar duas vezes nao duplica patch.
 */
(() => {
  if (window.__SF__) return 'already-instrumented';

  const S = {
    version: 1,
    startedAt: Date.now(),
    href: location.href,
    io: [],
    listeners: [],
    raf: { total: 0 },
    wheelPrevented: 0,
    touchPrevented: 0,
    scrollToCalls: 0,
    errors: [],
  };
  window.__SF__ = S;

  const t = () => Date.now() - S.startedAt;

  /** Descricao curta e estavel de um alvo de evento. */
  const desc = (el) => {
    try {
      if (el === window || el === undefined || el === null) return 'window';
      if (el === document) return 'document';
      if (el === document.documentElement) return 'html';
      if (el === document.body) return 'body';
      if (el.nodeType === 1) {
        // id/class sao dados da pagina: trunca (ver sonda.js)
        var corta = function (s) { return s && s.length > 40 ? s.slice(0, 40) + '\u2026' : s; };
        const id = el.id ? '#' + corta(el.id) : '';
        let cls = '';
        const cn = el.getAttribute && el.getAttribute('class');
        if (cn) cls = '.' + cn.trim().split(/\s+/).slice(0, 3).map(corta).join('.');
        return el.tagName.toLowerCase() + id + cls;
      }
      return String(el);
    } catch (e) {
      return '?';
    }
  };

  // --- IntersectionObserver -------------------------------------------------
  try {
    const Native = window.IntersectionObserver;
    if (Native) {
      const Patched = function (cb, opts) {
        opts = opts || {};
        const rec = {
          root: opts.root ? desc(opts.root) : 'viewport',
          rootMargin: opts.rootMargin || '0px',
          threshold: opts.threshold === undefined ? 0 : opts.threshold,
          targets: [],
          firedOn: [],
          at: t(),
        };
        S.io.push(rec);

        const wrapped = function (entries, observer) {
          try {
            for (const e of entries) {
              if (e.isIntersecting) {
                const d = desc(e.target);
                if (rec.firedOn.length < 40 && !rec.firedOn.includes(d)) rec.firedOn.push(d);
              }
            }
          } catch (err) { /* nunca atrapalhar a pagina */ }
          return cb.call(this, entries, observer);
        };

        const inst = new Native(wrapped, opts);
        const origObserve = inst.observe.bind(inst);
        inst.observe = (el) => {
          try { if (rec.targets.length < 60) rec.targets.push(desc(el)); } catch (e) {}
          return origObserve(el);
        };
        return inst;
      };
      Patched.prototype = Native.prototype;
      Patched.__sfNative = Native;
      window.IntersectionObserver = Patched;
    }
  } catch (e) { S.errors.push('io: ' + e.message); }

  // --- addEventListener -----------------------------------------------------
  try {
    const TRACKED = ['scroll', 'wheel', 'mousewheel', 'DOMMouseScroll', 'touchmove', 'touchstart'];
    const origAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      try {
        if (TRACKED.indexOf(type) !== -1 && S.listeners.length < 200) {
          let passive = null, capture = false;
          if (opts && typeof opts === 'object') {
            passive = opts.passive === undefined ? null : !!opts.passive;
            capture = !!opts.capture;
          } else if (typeof opts === 'boolean') {
            capture = opts;
          }
          S.listeners.push({ type, target: desc(this), passive, capture, at: t() });
        }
      } catch (e) {}
      return origAdd.call(this, type, fn, opts);
    };
    EventTarget.prototype.addEventListener.__sfOrig = origAdd;
  } catch (e) { S.errors.push('addEventListener: ' + e.message); }

  // --- preventDefault (assinatura de scroll virtual) ------------------------
  try {
    const origPD = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function () {
      try {
        const ty = this.type;
        if (ty === 'wheel' || ty === 'mousewheel' || ty === 'DOMMouseScroll') S.wheelPrevented++;
        else if (ty === 'touchmove') S.touchPrevented++;
      } catch (e) {}
      return origPD.call(this);
    };
  } catch (e) { S.errors.push('preventDefault: ' + e.message); }

  // --- requestAnimationFrame ------------------------------------------------
  try {
    const origRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = function (cb) {
      S.raf.total++;
      return origRaf.call(window, cb);
    };
  } catch (e) { S.errors.push('raf: ' + e.message); }

  // --- scrollTo programatico (libs de smooth-scroll costumam chamar) --------
  try {
    const origScrollTo = window.scrollTo;
    window.scrollTo = function () {
      S.scrollToCalls++;
      return origScrollTo.apply(window, arguments);
    };
    window.scrollTo.__sfOrig = origScrollTo;
  } catch (e) { S.errors.push('scrollTo: ' + e.message); }

  /**
   * Mede a taxa de rAF durante `ms`. Chame enquanto rola a pagina.
   * rAF alto sob scroll => animacao pilotada por JS a cada frame.
   * rAF ~0 sob scroll   => CSS puro (sticky/transition/scroll-timeline).
   */
  S.rafRate = (ms = 1000) => new Promise((res) => {
    const a = S.raf.total, t0 = performance.now();
    setTimeout(() => {
      const dt = performance.now() - t0;
      res({ calls: S.raf.total - a, ms: Math.round(dt), perSecond: +(((S.raf.total - a) / dt) * 1000).toFixed(1) });
    }, ms);
  });

  /** Resumo consolidado para o laudo. */
  S.report = () => {
    const byType = {};
    for (const l of S.listeners) {
      byType[l.type] = byType[l.type] || { count: 0, targets: [], nonPassive: 0 };
      byType[l.type].count++;
      if (l.passive === false) byType[l.type].nonPassive++;
      if (byType[l.type].targets.indexOf(l.target) === -1 && byType[l.type].targets.length < 8) {
        byType[l.type].targets.push(l.target);
      }
    }
    return {
      href: S.href,
      preloadInstrumented: true,
      intersectionObservers: S.io.map((o) => ({
        root: o.root,
        rootMargin: o.rootMargin,
        threshold: o.threshold,
        targetCount: o.targets.length,
        targetsSample: o.targets.slice(0, 10),
        firedOnSample: o.firedOn.slice(0, 10),
      })),
      listeners: byType,
      rafTotal: S.raf.total,
      wheelPrevented: S.wheelPrevented,
      touchPrevented: S.touchPrevented,
      scrollToCalls: S.scrollToCalls,
      virtualScrollSuspected: S.wheelPrevented > 3 || S.touchPrevented > 3,
      errors: S.errors,
    };
  };

  return 'instrumented';
})();
