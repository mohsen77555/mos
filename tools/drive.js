/* محرّك قيادة تفاعلي لـ MOS ERP: يستعيد الحالة، ينفّذ خطوات، يحفظ الحالة، ويلتقط لقطة */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8097;
const STATE = '/tmp/mos-state.json';
const SHOT = '/tmp/mos-view.png';
const KEYS = ['mos_erp_db_v1', 'mos_erp_user'];

const steps = JSON.parse(process.env.STEPS || '[]');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 860, deviceScaleFactor: 2 } });

  // استعادة الحالة المحفوظة (localStorage) قبل تحميل الصفحة
  let saved = {};
  if (fs.existsSync(STATE)) { try { saved = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) {} }
  await ctx.addInitScript(s => { for (const k in s) localStorage.setItem(k, s[k]); }, saved);

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const out = [];
  for (const st of steps) {
    try {
      if (st.demo)        { await page.evaluate(() => loadDemoData()); }
      else if (st.shot)   { await page.screenshot({ path: '/tmp/mos-' + st.shot + '.png' }); continue; }
      else if (st.goto)   { await page.evaluate(r => App.go(r), st.goto); }
      else if (st.click)  { await page.click(st.click); }
      else if (st.fill)   { await page.fill(st.fill, String(st.value)); }
      else if (st.select) { await page.selectOption(st.select, String(st.value)); }
      else if (st.eval)   { const r = await page.evaluate(st.eval); if (r !== undefined) out.push(JSON.stringify(r)); }
      else if (st.wait)   { await page.waitForTimeout(st.wait); continue; }
      await page.waitForTimeout(st.after || 250);
    } catch (e) { out.push('STEP_ERROR: ' + e.message); }
  }

  // معلومات سياق للعرض
  const ctxInfo = await page.evaluate(() => ({
    title: (document.getElementById('pageTitle') || {}).textContent || '',
    toast: (document.querySelector('.toast') || {}).textContent || '',
  }));

  await page.screenshot({ path: SHOT });

  // حفظ الحالة
  const dump = await page.evaluate(ks => { const o = {}; ks.forEach(k => { const v = localStorage.getItem(k); if (v != null) o[k] = v; }); return o; }, KEYS);
  fs.writeFileSync(STATE, JSON.stringify(dump));

  await browser.close();
  server.kill();

  console.log('TITLE: ' + ctxInfo.title);
  if (ctxInfo.toast) console.log('TOAST: ' + ctxInfo.toast);
  out.forEach(o => console.log('OUT: ' + o));
  if (errors.length) errors.forEach(e => console.log('ERR: ' + e));
  else console.log('ERR: none');
})();
