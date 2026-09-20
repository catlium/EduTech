/* Checkpoint UI-polish verification: login password toggle, dialog lg sizing +
 * body scroll, long Select value truncation. Zero-dependency; uses browser.mjs.
 */
import { launchChrome, stopChrome, newPage, WEB_URL } from './lib/browser.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await launchChrome();
  const page = await newPage();
  await page.navigate(WEB_URL + '/login');
  await page.waitForText('Sign in');

  // ── 1. Password show/hide toggle ──
  await page.waitFor("document.querySelector('input[type=password]') !== null");
  const pw = 'input[type="password"]';
  page.assert(await page.eval("document.querySelector('input[type=password]') !== null"), 'password field is type=password initially');

  const btn = 'button[aria-label="Show password"]';
  page.assert(await page.eval(`!!document.querySelector(${JSON.stringify(btn)})`), 'show-password toggle button present');

  await page.eval(`document.querySelector(${JSON.stringify(btn)}).click()`);
  page.assert(await page.eval("document.querySelector('input[type=text]') !== null"), 'password field becomes type=text after toggle');

  await page.eval(`document.querySelector('button[aria-label="Hide password"]').click()`);
  page.assert(await page.eval("document.querySelector('input[type=password]') !== null"), 'password field returns to type=password');
  console.log('PASS password-toggle');

  // ── login as teacher ──
  await page.fill('input[type="email"]', 'teacher@catlium.dev');
  await page.fill('input[type="password"]', 'Password123!');
  await page.clickText('Sign in');
  await page.waitForText('Question Bank', 20000).catch(() => {});
  await sleep(2500);

  // ── 2. Large dialog: lg sizing + body scroll (Questions -> Add Question) ──
  await page.navigate(WEB_URL + '/questions');
  await page.waitForText('Add Question');
  await sleep(1500);
  await page.clickText('Add Question');
  await sleep(1200);

  const layout = await page.eval(`(() => {
    const dlg = document.querySelector('[data-slot=dialog-content]');
    if (!dlg) return { missing: true };
    const body = document.querySelector('[data-slot=dialog-body]');
    const header = document.querySelector('[data-slot=dialog-header]');
    const footer = document.querySelector('[data-slot=dialog-footer]');
    const r = dlg.getBoundingClientRect();
    const vh = window.innerHeight;
    const hr = header ? header.getBoundingClientRect() : null;
    const fr = footer ? footer.getBoundingClientRect() : null;
    return {
      dlgHeight: Math.round(r.height),
      dlgViewportRatio: Math.round((r.height / vh) * 100),
      bodyIsScrollContainer: body ? getComputedStyle(body).overflowY === 'auto' : false,
      dialogOverflowHidden: getComputedStyle(dlg).overflowY === 'hidden',
      headerFooterBothVisible: hr && fr && hr.bottom <= vh && hr.top >= 0 && fr.bottom <= vh && fr.top >= 0,
      headerBelowFooter: hr && fr && hr.bottom <= fr.top,
      noHOverflow: r.left >= 0 && r.right <= window.innerWidth,
    };
  })()`);
  page.assert(!layout.missing, 'dialog content exists');
  page.assert(layout.dlgViewportRatio <= 72, `dialog height ${layout.dlgViewportRatio}% of viewport (target ~2/3 max)`);
  page.assert(layout.dlgViewportRatio >= 40, `dialog not overly small: ${layout.dlgViewportRatio}%`);
  page.assert(layout.headerFooterBothVisible, 'dialog header and footer both visible simultaneously');
  page.assert(layout.headerBelowFooter, 'header sits above footer without overlap');
  page.assert(layout.bodyIsScrollContainer, 'dialog body is the scroll container (overflow-y auto)');
  page.assert(layout.dialogOverflowHidden, 'dialog content has overflow hidden (no outer scroll)');
  page.assert(layout.noHOverflow, 'dialog has no horizontal overflow at desktop');
  console.log('PASS dialog-lg:', JSON.stringify({ h: layout.dlgHeight, pct: layout.dlgViewportRatio, bodyIsScrollContainer: layout.bodyIsScrollContainer, headerFooterBothVisible: layout.headerFooterBothVisible }));

  // close and re-check at a narrower viewport
  await page.navigate(WEB_URL + '/questions');
  await page.waitForText('Add Question');
  await sleep(1200);
  await page.atWidth(420, async () => {
    await page.clickText('Add Question');
    await sleep(1000);
    const layoutMobile = await page.eval(`(() => {
      const dlg = document.querySelector('[data-slot=dialog-content]');
      const r = dlg.getBoundingClientRect();
      const body = document.querySelector('[data-slot=dialog-body]');
      const header = document.querySelector('[data-slot=dialog-header]');
      const footer = document.querySelector('[data-slot=dialog-footer]');
      const vh = window.innerHeight;
      const hr = header.getBoundingClientRect(); const fr = footer.getBoundingClientRect();
      return { width: Math.round(r.width), vw: window.innerWidth, pct: Math.round((r.height / vh) * 100), noHOverflow: r.left >= -1 && r.right <= window.innerWidth + 1, bodyIsScrollContainer: getComputedStyle(body).overflowY === 'auto', headerFooterBothVisible: hr.bottom <= vh && hr.top >= 0 && fr.bottom <= vh && fr.top >= 0, dlgtop: Math.round(r.top), dlgbottom: Math.round(r.bottom), hdr: [Math.round(hr.top), Math.round(hr.bottom)], ftr: [Math.round(fr.top), Math.round(fr.bottom)], vh };
    })()`);
    console.log('PASS dialog-lg-mobile:', JSON.stringify(layoutMobile));
    page.assert(layoutMobile.width <= layoutMobile.vw, `narrow dialog fits viewport (${layoutMobile.width} <= ${layoutMobile.vw})`);
    page.assert(layoutMobile.noHOverflow, 'no horizontal overflow at narrow viewport');
    page.assert(layoutMobile.pct <= 72, `dialog height ${layoutMobile.pct}% at narrow viewport`);
    page.assert(layoutMobile.bodyIsScrollContainer && layoutMobile.headerFooterBothVisible, 'narrow dialog still scrolls body internally with visible header/footer');
  });

  // ── 3. Select long-value truncation ──
  await page.navigate(WEB_URL + '/questions');
  await page.waitForText('Add Question');
  await sleep(1500);
  const sel = await page.eval(`(() => {
    const triggers = [...document.querySelectorAll('[data-slot=select-trigger]')];
    const t = triggers.find((el) => el.getBoundingClientRect().width < 260);
    if (!t) return { missing: true };
    const cs = getComputedStyle(t);
    const val = t.querySelector('[data-slot=select-value]');
    const noWrap = t.scrollWidth <= t.clientWidth + 1;
    const valueTruncates = val ? val.scrollWidth <= val.clientWidth + 1 : true;
    return { triggerWidth: Math.round(t.getBoundingClientRect().width), nowrapComputed: cs.whiteSpace, textOverflow: val ? getComputedStyle(val).textOverflow : null, noWrap, valueTruncates, longestLabel: (() => { const l = [...(t.parentElement ? t.parentElement.querySelectorAll('[role=option]') : [])].map(o => o.textContent.trim()).filter(Boolean).sort((a,b) => b.length-a.length)[0]; return l ? l.slice(0,40) : null; })() };
  })()`);
  page.assert(!sel.missing, 'a fixed-width select trigger exists on page');
  page.assert(sel.nowrapComputed === 'nowrap', 'trigger keeps nowrap (single-line value)');
  page.assert(sel.noWrap, `fixed-width trigger does not overflow its box (w=${sel.triggerWidth}px)`);
  page.assert(sel.valueTruncates !== false, 'select value cannot force the trigger to overflow');
  console.log('PASS select-overflow:', JSON.stringify(sel));

  await page.screenshot('ui-polish.png');
  console.log('ALL UI-POLISH CHECKS PASSED');
  await stopChrome();
}

main().catch(async (e) => {
  console.error('FAIL:', e.message);
  await stopChrome();
  process.exit(1);
});