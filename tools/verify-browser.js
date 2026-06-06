/* تشغيل MOS ERP في متصفّح حقيقي (headless) والتحقق من غياب أخطاء وقت التشغيل */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8099;

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));

  const errors = [];
  const launchOpts = { args: ['--no-sandbox'] };
  if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  const log = [];
  try {
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // 1) الإقلاع: لوحة التحكم ظهرت (دخول تلقائي للمدير)
    const title = await page.textContent('#pageTitle');
    log.push(`إقلاع: العنوان = "${title}"`);

    // 2) تحميل بيانات تجريبية برمجياً
    await page.evaluate(() => loadDemoData());
    await page.waitForTimeout(300);
    const counts = await page.evaluate(() => ({ sales: DB.list('sales').length, products: DB.list('products').length, partners: DB.list('partners').length }));
    log.push(`بيانات تجريبية: ${JSON.stringify(counts)}`);

    // 3) المرور على كل التطبيقات (تصيير حقيقي + ربط أحداث)
    const routes = await page.evaluate(() => APPS.map(a => a.route));
    for (const r of routes) {
      await page.evaluate(rt => App.go(rt), r);
      await page.waitForTimeout(120);
      const len = await page.evaluate(() => document.getElementById('view').innerHTML.length);
      if (len < 20) log.push(`⚠️ شاشة فارغة: ${r}`);
    }
    log.push(`تم تصيير ${routes.length} تطبيقاً`);

    // 4) تبويبات المحاسبة والخزينة
    for (const t of ['accounts', 'journal', 'trial', 'ledger', 'pl', 'bs', 'vat', 'close']) {
      await page.evaluate(tab => { App.go('accounting'); App.acctTab = tab; App.render(); }, t);
      await page.waitForTimeout(60);
    }
    for (const t of ['vouchers', 'reconcile']) {
      await page.evaluate(tab => { App.go('treasury'); App.treasTab = tab; App.render(); }, t);
      await page.waitForTimeout(60);
    }
    log.push('تبويبات المحاسبة والخزينة: تم');

    // 5) تدفّق حقيقي بالنقر: إضافة منتج عبر زر + والنموذج
    await page.evaluate(() => App.go('products'));
    await page.waitForTimeout(150);
    await page.click('#fab');
    await page.waitForTimeout(200);
    const modalOpen = await page.isVisible('#modal .modal');
    log.push(`فتح نموذج المنتج بالنقر: ${modalOpen}`);
    await page.fill('input[name="name"]', 'منتج تحقّق آلي');
    await page.fill('input[name="salePrice"]', '123');
    await page.click('#modalForm button[type="submit"]');
    await page.waitForTimeout(250);
    const found = await page.evaluate(() => DB.list('products').some(p => p.name === 'منتج تحقّق آلي' && Number(p.salePrice) === 123));
    log.push(`حفظ المنتج من الواجهة: ${found}`);

    // 6) تدفّق POS بالنقر: فتح وردية ثم إضافة منتج للسلة
    await page.evaluate(() => App.go('pos'));
    await page.waitForTimeout(150);
    const posTiles = await page.$$('.pos-prod:not([disabled])');
    if (posTiles.length) { await posTiles[0].click(); await page.waitForTimeout(150); }
    const cartCount = await page.evaluate(() => App.posCart.length);
    log.push(`POS: إضافة منتج للسلة بالنقر → عناصر السلة = ${cartCount}`);

    // 7) فتح القائمة الجانبية بالنقر
    await page.click('#menuBtn');
    await page.waitForTimeout(200);
    const drawerOpen = await page.isVisible('.drawer-panel');
    log.push(`القائمة الجانبية تُفتح: ${drawerOpen}`);

  } catch (e) {
    errors.push('script: ' + e.message);
  }

  await browser.close();
  server.kill();

  console.log('\n=== سجل التحقّق ===');
  log.forEach(l => console.log('• ' + l));
  console.log(`\n=== أخطاء وقت التشغيل: ${errors.length} ===`);
  errors.forEach(e => console.log('  ❌ ' + e));
  process.exit(errors.length ? 1 : 0);
})();
