/* =====================================================================
   اختبارات MOS ERP — تعمل في نفس نطاق js/app.js (DB, Acct, Views, ...).
   تُحمَّل عبر tests/run.js. لا تستخدم require هنا.
   ===================================================================== */
(function () {
  let pass = 0, fail = 0;
  const fails = [];
  function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
  function eq(a, b, msg) { ok(Math.abs(Number(a) - Number(b)) < 0.01, `${msg} — متوقع ${b} وجاء ${a}`); }
  function trialBalanced() {
    let dr = 0, cr = 0;
    DB.list('accounts').forEach(a => {
      const b = Acct.balance(a), dn = !!DEBIT_NORMAL[a.type];
      if (dn) { if (b >= 0) dr += b; else cr += -b; } else { if (b >= 0) cr += b; else dr += -b; }
    });
    return Math.abs(dr - cr) < 0.01;
  }
  const bal = role => { const a = DB.get('accounts', Acct.id(role)); return a ? +Acct.balance(a).toFixed(2) : NaN; };

  /* تهيئة قاعدة بيانات نظيفة */
  localStorage.removeItem('mos_erp_db_v1');
  DB.load(); Acct.seed(); seedCurrencies(); Auth.seed();
  Auth.user = Auth.users()[0];

  /* 1) الزرع الأساسي */
  ok(DB.list('accounts').length >= 16, 'زرع شجرة الحسابات');
  ok(!!Acct.id('fxGain') && !!Acct.id('fxLoss'), 'وجود حسابات فروقات الصرف');
  ok(Auth.users().length === 1 && Auth.users()[0].role === 'admin', 'زرع مستخدم المدير');

  /* 2) دورة بيع كاملة + قيد مزدوج */
  const cust = DB.upsert('partners', { name: 'عميل اختبار', kind: 'customer' });
  const prod = DB.upsert('products', { name: 'منتج اختبار', type: 'stock', salePrice: 100, cost: 60, qty: 50, minQty: 5 });
  const svc = DB.upsert('products', { name: 'خدمة اختبار', type: 'service', salePrice: 200, cost: 0 });
  const so = DB.upsert('sales', { ref: DB.nextRef('SO'), partnerId: cust.id, date: todayISO(), status: 'draft', paid: 0, currency: 'BASE', rate: 1, lines: [{ productId: prod.id, qty: 3, price: 100 }, { productId: svc.id, qty: 1, price: 200 }] });
  const t = docTotals(so);
  eq(t.subtotal, 500, 'المجموع الفرعي'); eq(t.tax, 75, 'الضريبة 15%'); eq(t.total, 575, 'الإجمالي');
  confirmDoc('sales', so.id);
  eq(DB.get('products', prod.id).qty, 47, 'خصم المخزون عند البيع');
  eq(bal('ar'), 575, 'مدين العملاء'); eq(bal('sales'), 500, 'إيراد المبيعات'); eq(bal('vatOut'), 75, 'ضريبة المخرجات');
  eq(bal('cogs'), 180, 'تكلفة البضاعة (3×60)');
  ok(trialBalanced(), 'الميزان متوازن بعد البيع');
  registerPayment('sales', so.id, 575, 'cash');
  ok(DB.get('sales', so.id).status === 'paid', 'تحول المستند إلى مدفوع');
  eq(bal('ar'), 0, 'تسوية العملاء'); eq(bal('cash'), 575, 'الصندوق');
  ok(trialBalanced(), 'الميزان متوازن بعد الدفع');

  /* 3) المتوسط المرجّح */
  const sup = DB.upsert('partners', { name: 'مورد اختبار', kind: 'vendor' });
  const wp = DB.upsert('products', { name: 'سلعة متوسط', type: 'stock', salePrice: 0, cost: 0, qty: 0 });
  let po = DB.upsert('purchases', { ref: DB.nextRef('PO'), partnerId: sup.id, date: todayISO(), status: 'draft', paid: 0, currency: 'BASE', rate: 1, lines: [{ productId: wp.id, qty: 10, price: 10 }] });
  confirmDoc('purchases', po.id);
  eq(DB.get('products', wp.id).cost, 10, 'متوسط بعد شراء 10@10');
  po = DB.upsert('purchases', { ref: DB.nextRef('PO'), partnerId: sup.id, date: todayISO(), status: 'draft', paid: 0, currency: 'BASE', rate: 1, lines: [{ productId: wp.id, qty: 10, price: 20 }] });
  confirmDoc('purchases', po.id);
  eq(DB.get('products', wp.id).cost, 15, 'متوسط مرجّح بعد شراء 10@20');
  ok(trialBalanced(), 'الميزان متوازن بعد المشتريات');

  /* 4) فروقات أسعار الصرف */
  DB.data.settings.currencies.push({ code: 'USD', symbol: '$', rate: 3.70 });
  const fxBefore = bal('fxGain');
  const usd = DB.upsert('sales', { ref: DB.nextRef('SO'), partnerId: cust.id, date: todayISO(), status: 'draft', paid: 0, currency: 'USD', rate: 3.70, lines: [{ productId: svc.id, qty: 1, price: 100 }] });
  confirmDoc('sales', usd.id);                 // AR = 115 × 3.70 = 425.50
  registerPayment('sales', usd.id, 115, 'bank', 3.80);   // نقدية = 115×3.80=437، فرق 11.50 ربح
  eq(bal('fxGain') - fxBefore, 11.5, 'ربح فرق صرف عند القبض');
  ok(trialBalanced(), 'الميزان متوازن بعد فرق الصرف');

  /* 5) الرواتب */
  const emp = DB.upsert('employees', { name: 'موظف اختبار', salary: 5000 });
  runPayroll('2026-05');
  const slip = DB.list('payslips').find(p => p.employeeId === emp.id);
  ok(!!slip, 'توليد قسيمة راتب');
  postPayslip(slip.id); eq(bal('salaries'), 5000, 'مصروف الرواتب'); eq(bal('salaryPayable'), 5000, 'رواتب مستحقة');
  payPayslip(slip.id, 'bank'); eq(bal('salaryPayable'), 0, 'تسوية الرواتب المستحقة');
  ok(DB.get('payslips', slip.id).status === 'paid', 'صرف الراتب');
  ok(trialBalanced(), 'الميزان متوازن بعد الرواتب');

  /* 6) التصنيع */
  const comp = DB.upsert('products', { name: 'مكوّن', type: 'stock', cost: 30, qty: 100 });
  const fin = DB.upsert('products', { name: 'منتج تام', type: 'stock', cost: 0, qty: 0 });
  const bom = DB.upsert('boms', { productId: fin.id, components: [{ productId: comp.id, qty: 2 }] });
  eq(bomCost(bom), 60, 'تكلفة قائمة المكوّنات');
  produce(bom.id, 5);
  eq(DB.get('products', fin.id).qty, 5, 'إنتاج المنتج التام');
  eq(DB.get('products', fin.id).cost, 60, 'تكلفة المنتج التام');
  eq(DB.get('products', comp.id).qty, 90, 'استهلاك المكوّنات (100−10)');

  /* 7) CRM */
  const lead = DB.upsert('leads', { name: 'فرصة', stage: 'new', value: 1000 });
  moveLeadStage(lead.id, 'qualified');
  ok(DB.get('leads', lead.id).stage === 'qualified', 'نقل مرحلة الفرصة');

  /* 8) إقفال الفترة والقفل */
  closePeriod('2099-12-31');
  eq(Acct.sumType('income'), 0, 'تصفير الإيرادات عند الإقفال');
  eq(Acct.sumType('expense'), 0, 'تصفير المصروفات عند الإقفال');
  ok(trialBalanced(), 'الميزان متوازن بعد الإقفال');
  const blocked = DB.upsert('sales', { ref: DB.nextRef('SO'), partnerId: cust.id, date: '2099-01-01', status: 'draft', paid: 0, currency: 'BASE', rate: 1, lines: [{ productId: svc.id, qty: 1, price: 10 }] });
  confirmDoc('sales', blocked.id);
  ok(DB.get('sales', blocked.id).status === 'draft', 'منع التعديل ضمن فترة مقفلة');
  DB.data.settings.lockDate = '';

  /* 9) الصلاحيات */
  Auth.user = { id: 'z', name: 'بائع', role: 'sales' };
  ok(Auth.can('pos') && Auth.can('crm') && !Auth.can('accounting') && !Auth.can('settings'), 'صلاحيات دور البائع');
  Auth.user = Auth.users()[0];

  /* 10) الفاتورة الإلكترونية ZATCA + مولّد QR */
  const z = zatcaBase64(so);
  ok(typeof z === 'string' && z.length > 10, 'توليد Base64 لـ ZATCA');
  const dec = Buffer.from(z, 'base64');
  ok(dec[0] === 1, 'وسم TLV الأول = اسم البائع');
  const m = window.QR.matrix(z);
  ok(m.size >= 21 && m.modules.length === m.size, 'مصفوفة QR مربّعة');
  ok(m.modules[0][0] && m.modules[0][6] && m.modules[6][6] && !m.modules[1][1], 'نمط الكاشف في رمز QR');
  ok(window.QR.svg('TEST').includes('<path'), 'توليد SVG لرمز QR');

  /* 11) تعدد العملات في التقارير (تحويل للأساسية) */
  ok(toBase(100, { rate: 3.7 }) === 370, 'تحويل المبلغ للعملة الأساسية');

  /* 12) تشفير الـ PIN والترقية */
  ok(hashPin('1234') === hashPin('1234') && hashPin('1234') !== hashPin('1235'), 'تجزئة الـ PIN ثابتة ومميِّزة');
  (function () {
    const u = { id: 'p1', name: 'م', role: 'sales', pin: '4321' };
    DB.data.settings.users.push(u); DB.data.settings.dbVersion = 0; DB.migrate();
    const mu = Auth.users().find(x => x.id === 'p1');
    ok(!mu.pin && mu.pinHash === hashPin('4321'), 'ترقية: تحويل PIN نصّي إلى تجزئة');
    Auth.user = null;
    ok(Auth.login('p1', '4321') && !Auth.login('p1', '0000'), 'تسجيل الدخول بالرمز المجزّأ');
    DB.data.settings.users = DB.data.settings.users.filter(x => x.id !== 'p1');
    Auth.user = Auth.users()[0];
  })();

  /* 13) تحليل CSV */
  (function () {
    const rows = parseCSV('name,phone\n"علي, محمد",055\nسارة,066');
    ok(rows.length === 3 && rows[1][0] === 'علي, محمد' && rows[2][1] === '066', 'تحليل CSV مع اقتباس وفواصل');
  })();

  /* 14) المرتجعات */
  (function () {
    const c2 = DB.upsert('partners', { name: 'عميل مرتجع', kind: 'customer' });
    const p2 = DB.upsert('products', { name: 'منتج مرتجع', type: 'stock', salePrice: 50, cost: 30, qty: 20 });
    const s2 = DB.upsert('sales', { ref: DB.nextRef('SO'), partnerId: c2.id, date: todayISO(), status: 'draft', paid: 0, currency: 'BASE', rate: 1, lines: [{ productId: p2.id, qty: 4, price: 50 }] });
    confirmDoc('sales', s2.id);
    const arBefore = bal('ar'), outBefore = bal('vatOut');
    const qtyAfterSale = DB.get('products', p2.id).qty;          // 16
    createReturn('sales', s2.id);
    ok(DB.get('sales', s2.id).returned === true, 'وسم المستند كمُرتجع');
    eq(DB.get('products', p2.id).qty, qtyAfterSale + 4, 'استرجاع المخزون عند المرتجع');
    eq(bal('ar'), arBefore - 230, 'تخفيض الذمم بالمرتجع (200+30 ضريبة)');
    eq(bal('vatOut'), outBefore - 30, 'تخفيض ضريبة المخرجات بالمرتجع');
    ok(trialBalanced(), 'الميزان متوازن بعد المرتجع');
  })();

  /* 15) تقرير ضريبة VAT */
  (function () {
    const out = accountRangeBalance(DB.get('accounts', Acct.id('vatOut')), '', '');
    const inp = accountRangeBalance(DB.get('accounts', Acct.id('vatIn')), '', '');
    ok(typeof out === 'number' && typeof inp === 'number' && out >= 0, 'حساب صافي ضريبة VAT');
  })();

  /* 16) الخزينة — سندات وتحويلات */
  (function () {
    const cashBefore = bal('cash'), bankBefore = bal('bank');
    postVoucher({ type: 'receipt', date: todayISO(), amount: 1000, method: 'cash', counterAccount: Acct.id('otherIncome') });
    eq(bal('cash'), cashBefore + 1000, 'سند قبض يزيد الصندوق');
    eq(bal('otherIncome'), 1000, 'سند قبض يقيّد الإيراد');
    postVoucher({ type: 'payment', date: todayISO(), amount: 300, method: 'cash', counterAccount: Acct.id('expense') });
    eq(bal('cash'), cashBefore + 700, 'سند صرف ينقص الصندوق');
    eq(bal('expense'), 300, 'سند صرف يقيّد المصروف');
    postVoucher({ type: 'transfer', date: todayISO(), amount: 200, fromRole: 'cash', toRole: 'bank' });
    eq(bal('cash'), cashBefore + 500, 'التحويل ينقص الصندوق');
    eq(bal('bank'), bankBefore + 200, 'التحويل يزيد البنك');
    ok(trialBalanced(), 'الميزان متوازن بعد سندات الخزينة');
    const v = DB.list('vouchers')[0]; const before = bal('cash');
    deleteVoucher(DB.list('vouchers').find(x => x.type === 'receipt').id);
    ok(trialBalanced(), 'الميزان متوازن بعد حذف سند');
  })();

  /* 17) المخازن والتحويل المخزني */
  (function () {
    seedWarehouses();
    const main = mainWh();
    DB.data.settings.warehouses.push({ id: 'wh2', name: 'فرع' });
    const p = DB.upsert('products', { name: 'سلعة مخزن', type: 'stock', cost: 10, qty: 30 });
    eq(whQty(p, main), 30, 'الرصيد الافتتاحي في المخزن الرئيسي');
    eq(whQty(p, 'wh2'), 0, 'لا رصيد في الفرع بعد');
    createTransfer(p.id, main, 'wh2', 12);
    eq(whQty(p, main), 18, 'نقص الرئيسي بعد التحويل');
    eq(whQty(p, 'wh2'), 12, 'زيادة الفرع بعد التحويل');
    eq(whQty(p, main) + whQty(p, 'wh2'), DB.get('products', p.id).qty, 'مجموع المخازن = الإجمالي');
  })();

  /* 18) ورديات نقطة البيع */
  (function () {
    posSessionOpen(500);
    const s = currentPosSession();
    ok(!!s && s.openingFloat === 500, 'فتح وردية بعهدة');
    App.posCart = []; App.posPartner = '';
    const pp = DB.upsert('products', { name: 'سلعة POS', type: 'stock', salePrice: 100, cost: 50, qty: 10 });
    App.posCart = [{ productId: pp.id, qty: 1, price: 100 }];
    posCheckout('cash');
    posSessionClose(615);   // متوقع = 500 + 115 = 615
    const closed = DB.list('posSessions').find(x => x.closedAt);
    eq(closed.expected, 615, 'النقد المتوقع عند الإغلاق');
    eq(closed.diff, 0, 'لا فرق في الصندوق');
  })();

  /* 19) إجازات الموظفين */
  (function () {
    const e = DB.upsert('employees', { name: 'موظف إجازة', salary: 4000 });
    DB.upsert('leaves', { employeeId: e.id, from: '2026-05-01', to: '2026-05-05', type: 'annual' });
    ok(DB.list('leaves').filter(l => l.employeeId === e.id).length === 1, 'تسجيل إجازة');
  })();

  /* 20) تصيير كل الشاشات بلا أخطاء */
  let viewErr = '';
  for (const r of Object.keys(Views)) { try { if (typeof Views[r]() !== 'string') throw new Error('ليست نصاً'); } catch (e) { viewErr += `${r} `; } }
  ok(!viewErr, 'تصيير كل الشاشات: ' + viewErr);
  for (const tab of ['accounts', 'journal', 'trial', 'ledger', 'pl', 'bs', 'vat', 'close']) {
    App.acctTab = tab; try { Views.accounting(); } catch (e) { ok(false, 'تبويب محاسبة ' + tab); }
  }

  /* 21) الحوكمة: الصلاحيات الدقيقة */
  (function () {
    const adm = Perm.caps('admin'), vw = Perm.caps('viewer'), sl = Perm.caps('sales');
    ok(adm.create && adm.edit && adm.delete && adm.approve, 'المدير يملك كل الصلاحيات');
    ok(!vw.create && !vw.edit && !vw.delete && !vw.approve, 'المستعرض بلا صلاحيات تعديل');
    ok(sl.create && sl.edit && !sl.delete && !sl.approve, 'البائع: إضافة/تعديل بلا حذف/اعتماد');
    DB.data.settings.perms = { sales: Object.assign({}, ROLE_CAPS.sales, { delete: 1 }) };
    ok(Perm.caps('sales').delete === 1, 'تخصيص الصلاحيات يتجاوز الافتراضي');
    DB.data.settings.perms = {};
  })();

  /* 22) الحوكمة: سجل التدقيق */
  (function () {
    const before = DB.list('audit').length;
    Audit.log('create', 'partners', 'اختبار تدقيق', 'تفاصيل');
    ok(DB.list('audit').length === before + 1, 'إضافة سجل تدقيق');
    const last = Audit.list()[0];
    ok(last.action === 'create' && last.entity === 'partners' && !!last.at, 'محتوى سجل التدقيق صحيح');
  })();

  /* 23) الحوكمة: دورة الاعتماد */
  (function () {
    DB.data.settings.approval = { enabled: true, threshold: 1000 };
    const big = DB.upsert('sales', { ref: DB.nextRef('SO'), partnerId: cust.id, date: todayISO(), status: 'draft', paid: 0, currency: 'BASE', rate: 1, lines: [{ productId: prod.id, qty: 10, price: 500 }] });
    confirmDoc('sales', big.id);
    let d = DB.get('sales', big.id);
    ok(d.status === 'draft' && d.approval === 'pending', 'المستند فوق الحدّ يُعلَّق للاعتماد');
    ok(govPendingDocs().some(x => x.d.id === big.id), 'ظهوره في طابور الاعتمادات');
    approveDoc('sales', big.id);
    d = DB.get('sales', big.id);
    ok(d.approval === 'approved' && d.status === 'confirmed', 'الاعتماد يؤكّد المستند');
    const small = DB.upsert('sales', { ref: DB.nextRef('SO'), partnerId: cust.id, date: todayISO(), status: 'draft', paid: 0, currency: 'BASE', rate: 1, lines: [{ productId: svc.id, qty: 1, price: 100 }] });
    confirmDoc('sales', small.id);
    ok(DB.get('sales', small.id).status === 'confirmed', 'المستند تحت الحدّ يُؤكَّد دون اعتماد');
    DB.data.settings.approval = { enabled: false, threshold: 5000 };
  })();

  /* 24) تصيير تبويبات الحوكمة بلا أخطاء */
  for (const tab of ['compliance', 'approvals', 'audit', 'perms']) {
    App.govTab = tab; try { ok(typeof Views.governance() === 'string', 'تبويب حوكمة ' + tab); } catch (e) { ok(false, 'تبويب حوكمة ' + tab + ': ' + e.message); }
  }

  /* 25) الأصول الثابتة والإهلاك */
  (function () {
    const acqMonth = '2099-01';
    const a = DB.upsert('assets', { name: 'سيارة اختبار', cost: 12000, salvage: 0, life: 12, date: acqMonth + '-01' });
    eq(assetMonthlyDep(a), 1000, 'القسط الشهري بالقسط الثابت');
    const beforeJE = DB.list('journal').length;
    runDepreciation(acqMonth);
    ok(DB.list('journal').length === beforeJE + 1, 'ترحيل قيد إهلاك');
    eq(assetAccumulated(DB.get('assets', a.id)), 1000, 'مجمع الإهلاك بعد شهر');
    eq(assetNBV(DB.get('assets', a.id)), 11000, 'صافي القيمة الدفترية');
    runDepreciation(acqMonth);   // نفس الشهر مجدداً
    ok(DB.get('assets', a.id).deps.length === 1, 'لا تكرار إهلاك لنفس الشهر');
    // تشغيل أشهر كافية: لا يتجاوز الإهلاك القيمة القابلة
    let y = 2099, mo = 2;
    for (let i = 0; i < 18; i++) { runDepreciation(`${y}-${String(mo).padStart(2, '0')}`); if (++mo > 12) { mo = 1; y++; } }
    const af = DB.get('assets', a.id);
    eq(assetAccumulated(af), 12000, 'الإهلاك يتوقف عند القيمة القابلة');
    eq(assetNBV(af), 0, 'صافي القيمة الدفترية = صفر بعد الاكتمال');
    ok(af.deps.length === 12 && assetFullyDepreciated(af), 'العمر الإنتاجي 12 شهراً بالضبط');
  })();

  /* 26) تخطيط إعادة الطلب */
  (function () {
    const lp = DB.upsert('products', { name: 'صنف منخفض', type: 'stock', cost: 10, qty: 1, minQty: 5 });
    const items = reorderItems();
    const it = items.find(x => x.p.id === lp.id);
    ok(!!it, 'المنتج تحت الحدّ يظهر في إعادة الطلب');
    eq(it.suggest, 9, 'الكمية المقترحة = (٢×الحدّ) − المتوفر');
    DB.upsert('partners', { name: 'مورد إعادة طلب', kind: 'vendor' });
    const beforePO = DB.list('purchases').length;
    createReorderPO();
    ok(DB.list('purchases').length === beforePO + 1, 'إنشاء أمر شراء إعادة الطلب');
    const po = DB.list('purchases').slice().sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0))[0];
    ok(po.status === 'draft' && po.lines.length >= 1, 'أمر الشراء مسودة وبه بنود');
  })();

  /* 27) أعمار الذمم */
  (function () {
    App.acctTab = 'aging';
    const html = Views.accounting();
    ok(typeof html === 'string' && html.indexOf('ذمم مدينة') >= 0, 'تصيير تقرير أعمار الذمم');
  })();

  /* 28) الموازنات التقديرية */
  (function () {
    const inc = DB.get('accounts', Acct.id('sales'));
    DB.data.settings.budgets = DB.data.settings.budgets || {};
    DB.data.settings.budgets[inc.id] = 1000;
    App.acctTab = 'budget';
    const html = Views.accounting();
    ok(typeof html === 'string' && html.indexOf('الموازنات') >= 0, 'تصيير تقرير الموازنات');
    ok(typeof Views.assets() === 'string', 'تصيير شاشة الأصول');
  })();

  /* --- النتيجة --- */
  console.log(`\nنتيجة الاختبارات: ${pass} ناجح، ${fail} فاشل`);
  if (fail) { fails.forEach(f => console.log('  ❌ ' + f)); process.exitCode = 1; }
  else console.log('✅ كل الاختبارات ناجحة');
})();
