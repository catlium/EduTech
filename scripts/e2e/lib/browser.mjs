/*
 * Zero-dependency CDP browser driver for real-Chrome e2e journeys.
 * Uses Node built-ins (fetch, WebSocket, child_process) and the system
 * Chrome binary via --headless=new. No playwright/puppeteer dependency.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const WEB_URL = process.env.WEB_URL || 'http://localhost:3001';
export const CHROME_BIN = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const CDP_PORT = 9222;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let chromeProc = null;

export async function launchChrome() {
  const profile = `/tmp/opencode/browser/prof-${Date.now()}`;
  chromeProc = spawn(
    CHROME_BIN,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,1000',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  // wait for the debugging endpoint
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (r.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome did not expose the debugging endpoint');
}

export async function stopChrome() {
  if (chromeProc) {
    chromeProc.kill('SIGKILL');
    chromeProc = null;
  }
}

let clientId = 0;
class Cdp {
  constructor(ws) { this.ws = ws; this.pending = new Map(); this.handlers = new Map(); this.id = 0; }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    const c = new Cdp(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const h of c.handlers.get(msg.method) || []) h(msg.params);
      }
    };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
}

export class Page {
  constructor(cdp) {
    this.cdp = cdp;
    this.consoleErrors = [];
    this.exceptions = [];
    cdp.on('Runtime.exceptionThrown', (p) => this.exceptions.push(p.exceptionDetails?.text || 'exception'));
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error' && p.args && p.args.some((a) => a.value?.toLowerCase().includes('failed')))
        this.consoleErrors.push(p);
    });
    cdp.on('Page.loadEventFired', () => { this.loadedAt = Date.now(); });
    void this.cdp.send('Runtime.enable');
    void this.cdp.send('Page.enable');
    void this.cdp.send('Network.enable');
  }

  async eval(expr) {
    const r = await this.cdp.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) throw new Error(`eval error: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}`);
    return r.result?.value;
  }

  async navigate(url) {
    await this.cdp.send('Page.navigate', { url });
    await this.waitFor(`document.readyState === 'complete'`);
  }

  // waitFor(jsExpr, { timeout, expect }) — polls an expression until truthy.
  async waitFor(expr, { timeout = 15000, interval = 300 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await this.eval(`(() => { try { return Boolean(${expr}); } catch { return false; } })()`)) return;
      await sleep(interval);
    }
    throw new Error(`timed out waiting for: ${expr}`);
  }

  async waitForText(text, opts) {
    await this.waitFor(
      `document.body.innerText.split(/\\n+/).some(l => l.trim() === ${JSON.stringify(text)})`,
      opts,
    );
  }

  async clickText(text, { exact = true } = {}) {
    const sel = exact
      ? `(() => { const els=[...document.querySelectorAll('button, a, [role="menuitem"], [role="button"], [role="option"], [tabindex]')]; return els.find(e => { const t=e.textContent.trim(); const r=e.getBoundingClientRect(); return t === ${JSON.stringify(text)} && r.width>0 && r.height>0 && e.offsetParent !== null; }); })()`
      : `(() => { const els=[...document.querySelectorAll('button, a, [role="menuitem"], [role="button"], [role="option"]')]; const el=els.find(e => { const r=e.getBoundingClientRect(); return e.textContent.includes(${JSON.stringify(text)}) && r.width>0 && r.height>0; }); return el || null; })()`;
    const found = await this.eval(`Boolean(${sel})`);
    if (!found) throw new Error(`clickText: no visible element with text "${text}"`);
    await this.eval(`${sel}.click()`);
  }

  // Select a Radix/shadcn Select option by visible labels (open + pick).
  async selectRadix(triggerText, optionText) {
    await this.clickText(triggerText);
    await sleep(300);
    await this.clickText(optionText);
  }

  // React-safe fill for controlled inputs.
  async fill(selector, value) {
    const ok = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`fill: no element matching ${selector}`);
  }

  async selectOption(selector, label) {
    const ok = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const opt = [...el.options].find(o => o.textContent.trim() === ${JSON.stringify(label)});
      if (!opt) return false;
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`selectOption: no matching option "${label}" on ${selector}`);
  }

  async url() { return this.eval('location.href'); }
  async text() { return this.eval('document.body.innerText'); }
  async visible(selector) {
    return this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const r = el.getBoundingClientRect(); return r.width>0 && r.height>0; })()`);
  }
  async screenshot(filename) {
    mkdirSync('/tmp/opencode/browser', { recursive: true });
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join('/tmp/opencode/browser', filename), Buffer.from(data, 'base64'));
    return join('/tmp/opencode/browser', filename);
  }

  // Vary the viewport, then go back.
  async atWidth(w, fn) {
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await fn();
    await this.cdp.send('Emulation.clearDeviceMetricsOverride');
  }

  assert(cond, msg) {
    if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

export async function newPage() {
  const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  return new Page(cdp);
}

export async function freshContext(loginUrl = '/login') {
  // new browser + page in one go for an isolated journey
  await launchChrome();
  const page = await newPage();
  await page.navigate(WEB_URL + loginUrl);
  return page;
}

export async function login(page, email, password) {
  await page.waitForText('Sign in');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.clickText('Sign in');
}

export async function logout(page) {
  await page.clickText('Log out');
}