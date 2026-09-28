#!/usr/bin/env node
/**
 * scroll-forensics :: Caminho B - pipeline completo headless
 *
 * Roda as Fases 0 a 5 sozinho e cospe um JSON. E o caminho PRIMARIO em
 * Codex, CI e qualquer sessao sem browser interativo.
 *
 * Uso (sem instalar nada no projeto):
 *   npx --yes --package=playwright node playwright_runner.mjs https://exemplo.com --out laudo.json
 *
 * Ou, com playwright ja no projeto:
 *   node playwright_runner.mjs https://exemplo.com --steps 60 --headed
 *
 * Primeira execucao pode precisar do binario do Chromium:
 *   npx --yes playwright install chromium
 *
 * Depois, alimente o ajuste de curva:
 *   python3 ajustar_easing.py laudo.json --md
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const lerScript = (nome) => readFileSync(join(AQUI, nome), 'utf8');

// --- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--'));
const flag = (nome, padrao) => {
  const i = argv.indexOf('--' + nome);
  return i === -1 ? padrao : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true);
};

if (!url) {
  console.error('uso: node playwright_runner.mjs <url> [--out laudo.json] [--steps 48] [--headed]');
  process.exit(1);
}

const OUT = flag('out', null);
const STEPS = parseInt(flag('steps', '48'), 10);
const HEADED = argv.includes('--headed');
const VP = { width: 1440, height: 900 };

// --- playwright ------------------------------------------------------------
// `npx --package=playwright node script.mjs` NAO torna o pacote importavel:
// o Node resolve modulos a partir da pasta do SCRIPT, e este script mora em
// na pasta da skill, fora do projeto. Entao procuramos em varios lugares plausiveis, na ordem
// do mais especifico para o mais global.
async function carregarPlaywright() {
  const tentativas = [];

  // 1. resolucao normal (script dentro de um projeto que tem playwright)
  for (const nome of ['playwright', 'playwright-core']) {
    try { return { mod: await import(nome), origem: nome }; }
    catch (e) { tentativas.push(nome + ': ' + e.code); }
  }

  // 2..N. caminhos de node_modules candidatos
  const candidatos = [];
  candidatos.push(join(process.cwd(), 'node_modules'));
  if (process.env.NODE_PATH) candidatos.push(...process.env.NODE_PATH.split(':').filter(Boolean));
  try {
    const { execSync } = await import('node:child_process');
    const g = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (g) candidatos.push(g);
    const cache = execSync('npm config get cache', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (cache) {
      const { readdirSync } = await import('node:fs');
      const npxDir = join(cache, '_npx');
      try {
        for (const h of readdirSync(npxDir)) candidatos.push(join(npxDir, h, 'node_modules'));
      } catch (e) { /* sem cache _npx */ }
    }
  } catch (e) { /* npm indisponivel */ }

  const { existsSync } = await import('node:fs');
  for (const base of candidatos) {
    for (const nome of ['playwright', 'playwright-core']) {
      const alvo = join(base, nome, 'index.js');
      if (!existsSync(alvo)) continue;
      try { return { mod: await import(pathToFileURL(alvo).href), origem: alvo }; }
      catch (e) { tentativas.push(alvo + ': ' + e.message); }
    }
  }
  return { mod: null, tentativas };
}

const pw = await carregarPlaywright();
if (!pw.mod) {
  console.error(
    'Playwright nao encontrado.\n' +
    'Instale numa pasta de trabalho e rode a partir dela:\n' +
    '  npm i playwright && npx playwright install chromium\n' +
    '  node ' + process.argv[1] + ' ' + url + '\n' +
    'Ou uma vez, global:  npm i -g playwright && npx playwright install chromium\n' +
    (pw.tentativas ? '\ntentativas:\n  ' + pw.tentativas.join('\n  ') : '')
  );
  process.exit(3);
}
// Playwright e CommonJS: importado por file:// URL, os exports vem em .default
const chromium = pw.mod.chromium || (pw.mod.default && pw.mod.default.chromium);
if (!chromium) {
  console.error('modulo carregado de ' + pw.origem + ' mas sem export `chromium` - versao incompativel?');
  process.exit(3);
}

// --- robots.txt: verificar antes de automatizar ----------------------------
async function robotsPermite(alvo) {
  let u;
  try { u = new URL(alvo); } catch (e) { return { ok: false, motivo: 'URL invalida' }; }
  const robotsUrl = u.origin + '/robots.txt';
  let texto;
  try {
    const r = await fetch(robotsUrl, { redirect: 'follow' });
    if (!r.ok) return { ok: true, motivo: 'robots.txt ausente (' + r.status + ')' };
    texto = await r.text();
  } catch (e) {
    return { ok: true, motivo: 'robots.txt inacessivel: ' + e.message };
  }

  // regras do grupo User-agent: *
  const linhas = texto.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  let dentro = false;
  const disallow = [], allow = [];
  for (const l of linhas) {
    const m = l.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const chave = m[1].toLowerCase(), val = m[2].trim();
    if (chave === 'user-agent') { dentro = val === '*'; continue; }
    if (!dentro) continue;
    if (chave === 'disallow' && val) disallow.push(val);
    if (chave === 'allow' && val) allow.push(val);
  }
  const path = u.pathname + (u.search || '');
  const bate = (regra) => path.startsWith(regra.replace(/\*$/, ''));
  const permitido = allow.filter(bate).sort((a, b) => b.length - a.length)[0];
  const negado = disallow.filter(bate).sort((a, b) => b.length - a.length)[0];
  if (negado && (!permitido || permitido.length < negado.length)) {
    return { ok: false, motivo: 'robots.txt nega este caminho (Disallow: ' + negado + ')' };
  }
  return { ok: true, motivo: 'robots.txt permite' };
}

const robots = await robotsPermite(url);
if (!robots.ok) {
  console.error('PARADO: ' + robots.motivo + '\nA skill nao contorna robots.txt. Escolha outra URL ou peca autorizacao ao dono.');
  process.exit(4);
}

// --- deteccao de bloqueio --------------------------------------------------
function bloqueio(status, titulo, corpo) {
  if (status === 403 || status === 429 || status === 503) return 'HTTP ' + status;
  const t = (titulo || '').toLowerCase();
  const c = (corpo || '').slice(0, 4000).toLowerCase();
  if (t.includes('just a moment') || c.includes('cf-challenge') || c.includes('challenge-platform')) return 'desafio Cloudflare';
  if (t.includes('access denied') || t.includes('attention required')) return 'pagina de bloqueio';
  if (c.includes('captcha') && c.includes('verify')) return 'captcha';
  return null;
}

// --- pipeline --------------------------------------------------------------
const INSTRUMENTAR = lerScript('instrumentar.js');
const SONDA = lerScript('sonda.js');
const AMOSTRAR = lerScript('amostrar.js');

const navegador = await chromium.launch({ headless: !HEADED });
const resultado = { url, robots: robots.motivo, playwright: pw.origem, geradoEm: new Date().toISOString() };

async function abrir(contextOpts, viewport) {
  const ctx = await navegador.newContext({ viewport, ...contextOpts });
  const page = await ctx.newPage();
  await page.addInitScript(INSTRUMENTAR);   // Fase 0: pre-load de verdade
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (e) {}
  await page.waitForTimeout(1200);
  return { ctx, page, status: resp ? resp.status() : null };
}

try {
  // ---- passada principal
  const { ctx, page, status } = await abrir({}, VP);
  const titulo = await page.title().catch(() => '');
  const corpo = await page.content().catch(() => '');
  const b = bloqueio(status, titulo, corpo);
  if (b) {
    resultado.bloqueado = b;
    resultado.nota = 'A pagina bloqueou a automacao (' + b + '). A skill para aqui por principio: nao trocar user-agent, nao insistir. Use o caminho A (browser real logado) ou o caminho C (analise estatica, marcada como inferencia).';
    await ctx.close();
    throw new Error('__BLOQUEADO__');
  }

  resultado.sonda = await page.evaluate(SONDA);
  await page.evaluate(AMOSTRAR);
  const alvos = (resultado.sonda.elements || []).slice(0, 8).map((e) => e.selector).filter(Boolean);
  resultado.alvos = alvos;
  resultado.amostragem = alvos.length
    ? await page.evaluate(([sels, steps]) => window.__SF_amostrar(sels, { steps }), [alvos, STEPS])
    : { ok: false, nota: 'nenhum elemento-alvo identificado pela sonda' };
  resultado.fps = await page.evaluate(() => window.__SF_fps(2000));
  resultado.rafSobScroll = await page.evaluate(async () => {
    if (!window.__SF__ || !window.__SF__.rafRate) return null;
    const p = window.__SF__.rafRate(1000);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    // Passo por setTimeout, nao por rAF: a sonda nao pode contar as proprias
    // chamadas, senao mede a si mesma e todo site parece pilotado por JS.
    for (let i = 0; i < 50; i++) { window.scrollTo(0, (max * i) / 50); await new Promise((r) => setTimeout(r, 18)); }
    return p;
  });
  await ctx.close();

  // ---- Fase 5: prefers-reduced-motion
  try {
    const r = await abrir({ reducedMotion: 'reduce' }, VP);
    const s = await r.page.evaluate(SONDA);
    resultado.reducedMotion = {
      elementosComTransform: (s.elements || []).filter((e) => e.style.transform !== 'none').length,
      elementosComTransition: (s.elements || []).filter((e) => e.style.transitionDuration && e.style.transitionDuration !== '0s').length,
      libsAindaAtivas: (s.libs || []).map((l) => l.name),
      rafTotal: (s.instrumentation || {}).rafTotal,
    };
    await r.ctx.close();
  } catch (e) { resultado.reducedMotion = { erro: e.message }; }

  // ---- Fase 5: mobile
  try {
    const r = await abrir({ isMobile: true, hasTouch: true, deviceScaleFactor: 3 }, { width: 390, height: 844 });
    const s = await r.page.evaluate(SONDA);
    resultado.mobile = {
      viewport: '390x844',
      libs: (s.libs || []).map((l) => ({ name: l.name, confidence: l.confidence })),
      sticky: (s.elements || []).filter((e) => e.style.position === 'sticky').length,
      pins: (s.elements || []).filter((e) => e.pinDurationVh).map((e) => ({ desc: e.desc, vh: e.pinDurationVh })),
      scrollableVh: s.page.scrollableVh,
    };
    await r.ctx.close();
  } catch (e) { resultado.mobile = { erro: e.message }; }

  // comparacao desktop x mobile: o pin sobreviveu ao breakpoint?
  try {
    const pinsDesktop = (resultado.sonda.elements || []).filter((e) => e.pinDurationVh).length;
    const pinsMobile = (resultado.mobile.pins || []).length;
    resultado.pinSobreviveMobile = pinsMobile > 0
      ? true
      : (pinsDesktop > 0 ? false : null);
  } catch (e) {}
} catch (e) {
  if (e.message !== '__BLOQUEADO__') resultado.erro = e.message;
} finally {
  await navegador.close();
}

const json = JSON.stringify(resultado, null, 2);
if (OUT && typeof OUT === 'string') {
  writeFileSync(OUT, json);
  console.error('escrito em ' + OUT);
  console.error('proximo passo: python3 ' + join(AQUI, 'ajustar_easing.py') + ' ' + OUT + ' --md');
} else {
  console.log(json);
}
process.exit(resultado.bloqueado ? 5 : 0);
