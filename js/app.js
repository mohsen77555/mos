/* =====================================================================
   MOS ERP  —  نظام تخطيط موارد المؤسسات (شبيه Odoo)
   تطبيق ويب تقدمي (PWA) عربي بالكامل، يعمل دون اتصال، ويحفظ البيانات محلياً.

   الوحدات: لوحة التحكم • جهات الاتصال • المنتجات • المبيعات • المشتريات
            • المخزون • الفوترة والمدفوعات • الموظفون • التقارير • الإعدادات
   ===================================================================== */

'use strict';

/* ---------------------------------------------------------------------
   1) طبقة التخزين المحلية (Local Storage)
   --------------------------------------------------------------------- */
const DB = {
  key: 'mos_erp_db_v1',
  data: null,

  defaults() {
    return {
      partners: [],
      products: [],
      sales: [],
      purchases: [],
      moves: [],      // حركات المخزون
      payments: [],   // المدفوعات (سجل القيود النقدية)
      employees: [],
      accounts: [],   // شجرة الحسابات
      journal: [],    // قيود اليومية (القيد المزدوج)
      payslips: [],   // مسيّر الرواتب
      leads: [],      // CRM — الفرص البيعية
      boms: [],       // قوائم مكوّنات التصنيع
      mos: [],        // أوامر التصنيع
      returns: [],    // المرتجعات (إشعارات دائن/مدين)
      vouchers: [],   // سندات القبض/الصرف والتحويلات
      posSessions: [],// ورديات نقطة البيع
      leaves: [],     // إجازات الموظفين
      settings: {
        company: 'شركتي',
        currency: 'ر.س',        // رمز العملة الأساسية
        vatNo: '',              // الرقم الضريبي (للفاتورة الإلكترونية)
        taxRate: 15,
        seq: { SO: 0, PO: 0, JE: 0, PR: 0, MO: 0, RT: 0, CV: 0 },
        acc: {},                 // ربط الأدوار بالحسابات (cash, ar, ...)
        accountsSeeded: false,
        lockDate: '',            // تاريخ إقفال الفترة (يمنع التعديل قبله)
        currencies: [],          // العملات [{code, symbol, rate}] (BASE = الأساسية)
        users: [],               // المستخدمون [{id, name, role, pin}]
        usersSeeded: false,
        theme: 'light',          // السمة: فاتح / داكن
        dbVersion: 0,            // نسخة قاعدة البيانات (للترقيات)
        warehouses: [],          // المخازن
        reconciled: {},          // أسطر القيود المسوّاة بنكياً { journalId: true }
      },
    };
  },

  load() {
    try {
      const raw = localStorage.getItem(this.key);
      this.data = raw ? JSON.parse(raw) : this.defaults();
    } catch (e) {
      this.data = this.defaults();
    }
    const d = this.defaults();
    for (const k of Object.keys(d)) {
      if (k === 'settings') {
        this.data.settings = Object.assign({}, d.settings, this.data.settings || {});
        this.data.settings.seq = Object.assign({}, d.settings.seq, this.data.settings.seq || {});
      } else if (!Array.isArray(this.data[k])) {
        this.data[k] = [];
      }
    }
    this.migrate();
    return this.data;
  },

  /* ترقيات قاعدة البيانات حسب النسخة */
  migrate() {
    const s = this.data.settings;
    if (s.dbVersion == null) s.dbVersion = 0;
    if (s.dbVersion < 2) {
      // ترقية 2: تحويل رموز PIN النصّية إلى تجزئة (hash)
      (s.users || []).forEach(u => { if (u.pin) { u.pinHash = hashPin(u.pin); delete u.pin; } });
      s.dbVersion = 2;
    }
    this.save();
  },

  save() { localStorage.setItem(this.key, JSON.stringify(this.data)); },

  list(coll) { return this.data[coll] || []; },
  get(coll, id) { return (this.data[coll] || []).find(x => x.id === id); },

  upsert(coll, item) {
    if (item.id) {
      const i = this.data[coll].findIndex(x => x.id === item.id);
      if (i >= 0) this.data[coll][i] = { ...this.data[coll][i], ...item };
      else this.data[coll].push(item);
    } else {
      item.id = uid();
      item.createdAt = Date.now();
      this.data[coll].push(item);
    }
    this.save();
    return item;
  },

  remove(coll, id) {
    this.data[coll] = this.data[coll].filter(x => x.id !== id);
    this.save();
  },

  /* تسلسل أرقام المستندات: SO00001 / PO00001 */
  nextRef(prefix) {
    const s = this.data.settings;
    s.seq[prefix] = (s.seq[prefix] || 0) + 1;
    this.save();
    return prefix + String(s.seq[prefix]).padStart(5, '0');
  },
};

/* ---------------------------------------------------------------------
   2) أدوات مساعدة
   --------------------------------------------------------------------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* تجزئة رمز الدخول (cyrb53) — لإخفاء الـ PIN بدل تخزينه نصّاً */
function hashPin(str) {
  str = String(str);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function todayISO() { return new Date().toISOString().slice(0, 10); }
function inRange(date, from, to) { return (!from || date >= from) && (!to || date <= to); }

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

function num(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

function fmtMoney(v) {
  const n = num(v);
  const s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s + ' ' + DB.data.settings.currency;
}

function fmtQty(v) {
  const n = num(v);
  return Number.isInteger(n) ? String(n) : n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}

function partnerName(id) { const p = DB.get('partners', id); return p ? p.name : '—'; }
function productName(id) { const p = DB.get('products', id); return p ? p.name : '—'; }
function employeeName(id) { const e = DB.get('employees', id); return e ? e.name : '—'; }

/* إقفال الفترة: منع أي عملية بتاريخ ضمن فترة مقفلة */
function isLocked(date) {
  const lock = DB.data.settings.lockDate;
  return lock && date && date <= lock;
}
function lockedToast(date) {
  if (isLocked(date)) { toast('الفترة مقفلة — التاريخ ضمن فترة محاسبية مغلقة'); return true; }
  return false;
}

/* ---------------------------------------------------------------------
   العملات (تعدد العملات وأسعار الصرف)
   --------------------------------------------------------------------- */
function baseSymbol() { return DB.data.settings.currency || 'ر.س'; }

function currencies() {
  const list = DB.data.settings.currencies || [];
  const base = list.find(c => c.code === 'BASE');
  if (base) base.symbol = baseSymbol();   // يبقى رمز الأساسية متزامناً
  return list;
}
function getCurrency(code) {
  return currencies().find(c => c.code === code) || { code: 'BASE', symbol: baseSymbol(), rate: 1 };
}
function curSymbol(code) { return getCurrency(code).symbol; }
function docRate(doc) { return num(doc && doc.rate) || 1; }
function docCurCode(doc) { return (doc && doc.currency) || 'BASE'; }
/* تنسيق مبلغ بعملة محددة */
function fmtCur(v, code) {
  const n = num(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + curSymbol(code);
}
/* مبلغ المستند بعملته */
function fmtDoc(v, doc) { return fmtCur(v, docCurCode(doc)); }
/* تحويل مبلغ المستند إلى العملة الأساسية */
function toBase(v, doc) { return +(num(v) * docRate(doc)).toFixed(2); }

function seedCurrencies() {
  const s = DB.data.settings;
  if (!Array.isArray(s.currencies)) s.currencies = [];
  if (!s.currencies.find(c => c.code === 'BASE')) {
    s.currencies.unshift({ code: 'BASE', symbol: baseSymbol(), rate: 1 });
    DB.save();
  }
}

/* ---------------------------------------------------------------------
   المخازن (مواقع المخزون) والتحويلات
   --------------------------------------------------------------------- */
function seedWarehouses() {
  const s = DB.data.settings;
  if (!Array.isArray(s.warehouses)) s.warehouses = [];
  if (!s.warehouses.length) { s.warehouses.push({ id: uid(), name: 'المخزن الرئيسي' }); DB.save(); }
}
function mainWh() { return (DB.data.settings.warehouses[0] || {}).id; }
function whName(id) { const w = (DB.data.settings.warehouses || []).find(x => x.id === id); return w ? w.name : '—'; }
/* مجموع حركات منتج في مخزن (wh=null لكل المخازن) */
function moveSum(pid, wh) {
  return DB.list('moves').filter(m => m.productId === pid && (wh == null || (m.wh || mainWh()) === wh))
    .reduce((s, m) => s + num(m.qty), 0);
}
/* الرصيد الافتتاحي غير المُفسَّر بالحركات (يُنسب للمخزن الرئيسي) */
function whBaseline(p) { return num(p.qty) - moveSum(p.id, null); }
/* كمية منتج في مخزن معيّن */
function whQty(p, wh) { return moveSum(p.id, wh) + (wh === mainWh() ? whBaseline(p) : 0); }

/* تحويل مخزني بين موقعين (لا أثر محاسبي — نفس حساب المخزون) */
function createTransfer(productId, fromWh, toWh, qty) {
  qty = num(qty);
  const p = DB.get('products', productId);
  if (!p || qty <= 0 || fromWh === toWh) { toast('بيانات التحويل غير صحيحة'); return; }
  if (whQty(p, fromWh) < qty) { toast('الكمية غير متوفرة في مخزن المصدر'); return; }
  const date = todayISO();
  DB.upsert('moves', { date, productId, qty: -qty, type: 'transfer', wh: fromWh, ref: 'تحويل → ' + whName(toWh), doc: 'transfer' });
  DB.upsert('moves', { date, productId, qty: qty, type: 'transfer', wh: toWh, ref: 'تحويل ← ' + whName(fromWh), doc: 'transfer' });
  toast('تم التحويل المخزني ✅');
}

/* ---------------------------------------------------------------------
   المستخدمون والصلاحيات
   --------------------------------------------------------------------- */
const ROLES = { admin: 'مدير النظام', accountant: 'محاسب', sales: 'بائع', viewer: 'مستعرض' };
/* التطبيقات المسموحة لكل دور */
const ROLE_APPS = {
  admin: '*',
  accountant: ['dashboard', 'partners', 'products', 'sales', 'purchases', 'inventory', 'manufacturing', 'invoicing', 'treasury', 'accounting', 'payroll', 'reports', 'guide'],
  sales: ['dashboard', 'crm', 'pos', 'partners', 'products', 'sales', 'inventory', 'invoicing', 'guide'],
  viewer: ['dashboard', 'reports', 'guide'],
};

const Auth = {
  user: null,

  seed() {
    const s = DB.data.settings;
    if (!Array.isArray(s.users)) s.users = [];
    if (!s.usersSeeded || !s.users.length) {
      if (!s.users.find(u => u.role === 'admin')) {
        s.users.push({ id: uid(), name: 'المدير', role: 'admin', pin: '' });
      }
      s.usersSeeded = true;
      DB.save();
    }
  },

  users() { return DB.data.settings.users || []; },
  role() { return this.user ? this.user.role : 'admin'; },

  can(route) {
    const allowed = ROLE_APPS[this.role()];
    return allowed === '*' || (allowed && allowed.includes(route));
  },
  isAdmin() { return this.role() === 'admin'; },

  hasPin(u) { return !!(u && (u.pinHash || u.pin)); },

  login(id, pin) {
    const u = this.users().find(x => x.id === id);
    if (!u) return false;
    if (u.pinHash) { if (hashPin(pin) !== u.pinHash) return false; }
    else if (u.pin && String(u.pin) !== String(pin)) return false;   // توافق قديم
    this.user = u;
    try { localStorage.setItem('mos_erp_user', id); } catch (e) {}
    return true;
  },
  logout() {
    this.user = null;
    try { localStorage.removeItem('mos_erp_user'); } catch (e) {}
  },
  restore() {
    let id = null;
    try { id = localStorage.getItem('mos_erp_user'); } catch (e) {}
    const u = id && this.users().find(x => x.id === id);
    if (u && !this.hasPin(u)) { this.user = u; return true; }   // استعادة فقط إن لم يكن هناك رمز
    // إن وُجد مستخدم واحد بلا رمز → دخول تلقائي
    if (this.users().length === 1 && !this.hasPin(this.users()[0])) { this.user = this.users()[0]; return true; }
    return false;
  },
};

/* ---------------------------------------------------------------------
   3) القوائم الثابتة
   --------------------------------------------------------------------- */
const PARTNER_KIND = { customer: 'عميل', vendor: 'مورد', both: 'عميل ومورد' };
const PRODUCT_TYPE = { stock: 'منتج مخزني', service: 'خدمة' };
const DOC_STATUS = { draft: 'مسودة', confirmed: 'مؤكد', paid: 'مدفوع', cancel: 'ملغي' };
const PAY_METHOD = { cash: 'نقدي', bank: 'تحويل بنكي', card: 'بطاقة', cheque: 'شيك' };
const PRODUCT_CATS = ['عام', 'مواد خام', 'منتج تام', 'خدمات', 'مكتبية', 'إلكترونيات', 'أخرى'];
const DEPARTMENTS = ['الإدارة', 'المبيعات', 'المشتريات', 'المحاسبة', 'المخزون', 'الإنتاج', 'الموارد البشرية', 'تقنية المعلومات', 'أخرى'];
const LEAD_STAGES = { new: 'جديد', qualified: 'مؤهَّل', proposal: 'عرض سعر', won: 'مكسوب', lost: 'خاسر' };
const STAGE_ORDER = ['new', 'qualified', 'proposal', 'won', 'lost'];

/* أنواع الحسابات المحاسبية */
const ACCOUNT_TYPES = {
  asset: 'أصول',
  liability: 'التزامات',
  equity: 'حقوق ملكية',
  income: 'إيرادات',
  expense: 'مصروفات',
};
/* الحسابات ذات الطبيعة المدينة (الرصيد = مدين − دائن) */
const DEBIT_NORMAL = { asset: 1, expense: 1 };

/* شجرة الحسابات الافتراضية (تُزرع تلقائياً عند أول تشغيل) */
const DEFAULT_ACCOUNTS = [
  { code: '1010', name: 'الصندوق (نقدية)', type: 'asset', role: 'cash' },
  { code: '1020', name: 'البنك', type: 'asset', role: 'bank' },
  { code: '1100', name: 'العملاء (ذمم مدينة)', type: 'asset', role: 'ar' },
  { code: '1200', name: 'المخزون', type: 'asset', role: 'inventory' },
  { code: '1300', name: 'ضريبة القيمة المضافة — مدخلات', type: 'asset', role: 'vatIn' },
  { code: '2010', name: 'الموردون (ذمم دائنة)', type: 'liability', role: 'ap' },
  { code: '2020', name: 'رواتب مستحقة الدفع', type: 'liability', role: 'salaryPayable' },
  { code: '2100', name: 'ضريبة القيمة المضافة — مخرجات', type: 'liability', role: 'vatOut' },
  { code: '3010', name: 'رأس المال', type: 'equity', role: 'capital' },
  { code: '3020', name: 'الأرباح المحتجزة', type: 'equity', role: 'retained' },
  { code: '4010', name: 'إيرادات المبيعات', type: 'income', role: 'sales' },
  { code: '4900', name: 'إيرادات أخرى', type: 'income', role: 'otherIncome' },
  { code: '4910', name: 'أرباح فروقات أسعار الصرف', type: 'income', role: 'fxGain' },
  { code: '5010', name: 'تكلفة البضاعة المباعة', type: 'expense', role: 'cogs' },
  { code: '5020', name: 'مصروف المشتريات والخدمات', type: 'expense', role: 'purchases' },
  { code: '5030', name: 'الرواتب والأجور', type: 'expense', role: 'salaries' },
  { code: '5900', name: 'مصروفات عامة', type: 'expense', role: 'expense' },
  { code: '5950', name: 'خسائر فروقات أسعار الصرف', type: 'expense', role: 'fxLoss' },
];

/* ---------------------------------------------------------------------
   محرّك المحاسبة (القيد المزدوج)
   --------------------------------------------------------------------- */
const Acct = {
  /* زرع شجرة الحسابات وربط الأدوار — مرة واحدة */
  seed() {
    const s = DB.data.settings;
    s.acc = s.acc || {};
    // يضمن وجود كل حساب نظامي (يضيف الناقص حتى للبيانات القديمة)
    DEFAULT_ACCOUNTS.forEach(a => {
      if (s.acc[a.role] && DB.get('accounts', s.acc[a.role])) return;
      const existing = DB.list('accounts').find(x => x.code === a.code);
      if (existing) { existing.role = a.role; s.acc[a.role] = existing.id; DB.save(); return; }
      const acc = DB.upsert('accounts', { code: a.code, name: a.name, type: a.type, role: a.role, opening: 0 });
      s.acc[a.role] = acc.id;
    });
    s.accountsSeeded = true;
    DB.save();
  },

  id(role) { return DB.data.settings.acc[role]; },

  /* ترحيل قيد متوازن. lines: [{accountId, debit, credit}] */
  post(entry) {
    const lines = (entry.lines || []).filter(l => l.accountId && (num(l.debit) || num(l.credit)));
    const dr = lines.reduce((s, l) => s + num(l.debit), 0);
    const cr = lines.reduce((s, l) => s + num(l.credit), 0);
    if (!lines.length || Math.abs(dr - cr) > 0.01) return false;
    DB.upsert('journal', {
      date: entry.date || todayISO(),
      ref: entry.ref || DB.nextRef('JE'),
      narration: entry.narration || '',
      source: entry.source || 'manual',
      sourceId: entry.sourceId,
      docId: entry.docId,
      lines: lines.map(l => ({ accountId: l.accountId, debit: num(l.debit), credit: num(l.credit) })),
    });
    return true;
  },

  /* حذف القيود المرتبطة بمستند (عند الإلغاء) */
  removeByDoc(docId) {
    DB.data.journal = DB.data.journal.filter(j => j.docId !== docId);
    DB.save();
  },

  movements(accId) {
    let debit = 0, credit = 0;
    DB.list('journal').forEach(j => (j.lines || []).forEach(l => {
      if (l.accountId === accId) { debit += num(l.debit); credit += num(l.credit); }
    }));
    return { debit, credit };
  },

  /* رصيد الحساب حسب طبيعته */
  balance(acc) {
    const m = this.movements(acc.id);
    const opening = num(acc.opening);
    return DEBIT_NORMAL[acc.type]
      ? opening + m.debit - m.credit
      : opening + m.credit - m.debit;
  },

  sumType(type) {
    return DB.list('accounts').filter(a => a.type === type)
      .reduce((s, a) => s + this.balance(a), 0);
  },

  /* صافي الربح للفترة = الإيرادات − المصروفات */
  netProfit() { return this.sumType('income') - this.sumType('expense'); },
};

/* رصيد حساب من القيود ضمن مدى تاريخي (لا يشمل الرصيد الافتتاحي) */
function accountRangeBalance(acc, from, to) {
  let debit = 0, credit = 0;
  DB.list('journal').forEach(j => {
    if (!inRange(j.date, from, to)) return;
    (j.lines || []).forEach(l => {
      if (l.accountId === acc.id) { debit += num(l.debit); credit += num(l.credit); }
    });
  });
  return DEBIT_NORMAL[acc.type] ? debit - credit : credit - debit;
}

/* ترحيل قيد تأكيد مستند (مبيعات/مشتريات) */
function postDocConfirm(coll, doc) {
  const t = docTotals(doc);
  const lines = [];
  if (coll === 'sales') {
    lines.push({ accountId: Acct.id('ar'), debit: toBase(t.total, doc), credit: 0 });
    lines.push({ accountId: Acct.id('sales'), debit: 0, credit: toBase(t.subtotal, doc) });
    if (t.tax) lines.push({ accountId: Acct.id('vatOut'), debit: 0, credit: toBase(t.tax, doc) });
    // تكلفة البضاعة المباعة تُحسب بسعر التكلفة (العملة الأساسية)
    const cogs = (doc.lines || []).reduce((s, l) => {
      const p = DB.get('products', l.productId);
      return s + (p && p.type !== 'service' ? num(l.qty) * num(p.cost) : 0);
    }, 0);
    if (cogs > 0) {
      lines.push({ accountId: Acct.id('cogs'), debit: cogs, credit: 0 });
      lines.push({ accountId: Acct.id('inventory'), debit: 0, credit: cogs });
    }
  } else {
    let stockSub = 0, svcSub = 0;
    (doc.lines || []).forEach(l => {
      const p = DB.get('products', l.productId);
      const amt = toBase(num(l.qty) * num(l.price), doc);
      if (p && p.type !== 'service') stockSub += amt; else svcSub += amt;
    });
    if (stockSub > 0) lines.push({ accountId: Acct.id('inventory'), debit: +stockSub.toFixed(2), credit: 0 });
    if (svcSub > 0) lines.push({ accountId: Acct.id('purchases'), debit: +svcSub.toFixed(2), credit: 0 });
    if (t.tax) lines.push({ accountId: Acct.id('vatIn'), debit: toBase(t.tax, doc), credit: 0 });
    lines.push({ accountId: Acct.id('ap'), debit: 0, credit: toBase(t.total, doc) });
  }
  Acct.post({
    date: doc.date, ref: doc.ref,
    narration: (coll === 'sales' ? 'فاتورة مبيعات ' : 'فاتورة مشتريات ') + doc.ref,
    source: coll, sourceId: doc.id, docId: doc.id, lines,
  });
}

/* ترحيل قيد دفعة */
function postPayment(coll, doc, amt, method, paymentId, payRate) {
  const cashRole = method === 'cash' ? 'cash' : 'bank';
  const invRate = docRate(doc);
  const pr = num(payRate) || invRate;
  const cashB = +(num(amt) * pr).toFixed(2);       // النقدية المقبوضة/المدفوعة فعلاً (سعر الدفع)
  const partyB = +(num(amt) * invRate).toFixed(2);  // الذمم المسجَّلة (سعر الفاتورة)
  const lines = [];
  if (coll === 'sales') {
    // قبض: مدين النقدية بالمقبوض، دائن العملاء بالمسجَّل، والفرق ربح/خسارة صرف
    lines.push({ accountId: Acct.id(cashRole), debit: cashB, credit: 0 });
    lines.push({ accountId: Acct.id('ar'), debit: 0, credit: partyB });
    const diff = +(cashB - partyB).toFixed(2);      // قبضنا أكثر = ربح
    if (diff > 0.001) lines.push({ accountId: Acct.id('fxGain'), debit: 0, credit: diff });
    else if (diff < -0.001) lines.push({ accountId: Acct.id('fxLoss'), debit: -diff, credit: 0 });
  } else {
    // سداد: مدين الموردين بالمسجَّل، دائن النقدية بالمدفوع، والفرق ربح/خسارة صرف
    lines.push({ accountId: Acct.id('ap'), debit: partyB, credit: 0 });
    lines.push({ accountId: Acct.id(cashRole), debit: 0, credit: cashB });
    const diff = +(cashB - partyB).toFixed(2);      // دفعنا أكثر = خسارة
    if (diff > 0.001) lines.push({ accountId: Acct.id('fxLoss'), debit: diff, credit: 0 });
    else if (diff < -0.001) lines.push({ accountId: Acct.id('fxGain'), debit: 0, credit: -diff });
  }
  Acct.post({
    date: todayISO(), ref: doc.ref,
    narration: (coll === 'sales' ? 'تحصيل من عميل ' : 'سداد لمورد ') + doc.ref,
    source: 'payment', sourceId: paymentId, docId: doc.id, lines,
  });
}

/* ---------------------------------------------------------------------
   مسيّر الرواتب (Payroll)
   --------------------------------------------------------------------- */
function payslipNet(p) { return num(p.basic) + num(p.allowances) - num(p.deductions); }

/* توليد قسائم رواتب لكل الموظفين عن شهر معيّن */
function runPayroll(month) {
  let created = 0;
  DB.list('employees').forEach(e => {
    if (DB.list('payslips').find(p => p.employeeId === e.id && p.month === month)) return;
    DB.upsert('payslips', {
      ref: DB.nextRef('PR'),
      employeeId: e.id, month,
      basic: num(e.salary), allowances: 0, deductions: 0,
      status: 'draft', date: month + '-28',
    });
    created++;
  });
  return created;
}

/* اعتماد القسيمة: إثبات استحقاق الراتب */
function postPayslip(id) {
  const p = DB.get('payslips', id);
  if (!p || p.status !== 'draft') return;
  if (lockedToast(p.date)) return;
  const net = payslipNet(p);
  if (net <= 0) { toast('صافي الراتب صفر'); return; }
  Acct.post({
    date: p.date, ref: p.ref,
    narration: 'استحقاق راتب ' + employeeName(p.employeeId) + ' — ' + p.month,
    source: 'payroll', sourceId: id, docId: id,
    lines: [
      { accountId: Acct.id('salaries'), debit: net, credit: 0 },
      { accountId: Acct.id('salaryPayable'), debit: 0, credit: net },
    ],
  });
  p.status = 'posted';
  DB.upsert('payslips', p);
  toast('تم اعتماد القسيمة وإثبات الاستحقاق ✅');
}

/* صرف الراتب */
function payPayslip(id, method) {
  const p = DB.get('payslips', id);
  if (!p || p.status !== 'posted') return;
  if (lockedToast(todayISO())) return;
  const net = payslipNet(p);
  const cashRole = method === 'cash' ? 'cash' : 'bank';
  Acct.post({
    date: todayISO(), ref: p.ref,
    narration: 'صرف راتب ' + employeeName(p.employeeId) + ' — ' + p.month,
    source: 'payroll', sourceId: id, docId: id,
    lines: [
      { accountId: Acct.id('salaryPayable'), debit: net, credit: 0 },
      { accountId: Acct.id(cashRole), debit: 0, credit: net },
    ],
  });
  p.status = 'paid'; p.payMethod = method;
  DB.upsert('payslips', p);
  toast('تم صرف الراتب ✅');
}

/* حذف قسيمة (يعكس قيودها) */
function deletePayslip(id) {
  Acct.removeByDoc(id);
  DB.remove('payslips', id);
}

/* ---------------------------------------------------------------------
   إقفال الفترة المالية (قيد الإقفال + قفل التواريخ)
   --------------------------------------------------------------------- */
function closePeriod(date) {
  if (!date) { toast('اختر تاريخ الإقفال'); return false; }
  if (lockedToast(date)) return false;
  const lines = [];
  DB.list('accounts').filter(a => a.type === 'income').forEach(a => {
    const b = Acct.balance(a);
    if (Math.abs(b) > 0.005) lines.push({ accountId: a.id, debit: b > 0 ? b : 0, credit: b < 0 ? -b : 0 });
  });
  DB.list('accounts').filter(a => a.type === 'expense').forEach(a => {
    const b = Acct.balance(a);
    if (Math.abs(b) > 0.005) lines.push({ accountId: a.id, debit: b < 0 ? -b : 0, credit: b > 0 ? b : 0 });
  });
  const net = Acct.sumType('income') - Acct.sumType('expense');
  if (Math.abs(net) > 0.005) {
    lines.push({ accountId: Acct.id('retained'), debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0 });
  }
  if (lines.length) {
    Acct.post({ date, narration: 'قيد إقفال الفترة المالية حتى ' + date, source: 'closing', lines });
  }
  DB.data.settings.lockDate = date;
  DB.save();
  toast('تم الإقفال وترحيل النتيجة للأرباح المحتجزة ✅');
  return true;
}

/* ---------------------------------------------------------------------
   4) تعريف النماذج (Models) — قيادة بالبيانات على طريقة Odoo
   --------------------------------------------------------------------- */
const Models = {
  partners: {
    label: 'جهة اتصال', plural: 'جهات الاتصال', icon: '👥', color: '#0d6efd', menu: true,
    title: r => r.name,
    subtitle: r => [PARTNER_KIND[r.kind] || '', r.phone || '', r.city || ''].filter(Boolean).join(' • '),
    badge: r => ({ text: PARTNER_KIND[r.kind] || '—', cls: r.kind === 'vendor' ? 'info' : 'ok' }),
    searchFields: ['name', 'phone', 'email', 'city', 'vat'],
    rowActions: r => `<button data-statement="${r.id}">📄 كشف حساب</button>`,
    fields: [
      { name: 'name', label: 'الاسم *', type: 'text', required: true },
      { name: 'kind', label: 'النوع', type: 'select', options: kv(PARTNER_KIND), default: 'customer' },
      { name: 'phone', label: 'الهاتف', type: 'tel' },
      { name: 'email', label: 'البريد الإلكتروني', type: 'email' },
      { name: 'vat', label: 'الرقم الضريبي', type: 'text' },
      { name: 'city', label: 'المدينة', type: 'text' },
      { name: 'address', label: 'العنوان', type: 'textarea' },
      { name: 'note', label: 'ملاحظات', type: 'textarea' },
    ],
  },

  products: {
    label: 'منتج', plural: 'المنتجات', icon: '📦', color: '#6610f2', menu: true,
    title: r => r.name,
    subtitle: r => `${r.code ? '[' + r.code + '] ' : ''}${r.category || ''} • سعر البيع: ${fmtMoney(r.salePrice)}`,
    badge: r => r.type === 'service'
      ? { text: 'خدمة', cls: 'muted' }
      : { text: 'المخزون: ' + fmtQty(r.qty), cls: num(r.qty) <= num(r.minQty) ? 'danger' : 'ok' },
    searchFields: ['name', 'code', 'category'],
    fields: [
      { name: 'name', label: 'اسم المنتج *', type: 'text', required: true },
      { name: 'code', label: 'الرمز / الباركود', type: 'text' },
      { name: 'type', label: 'النوع', type: 'select', options: kv(PRODUCT_TYPE), default: 'stock' },
      { name: 'category', label: 'الفئة', type: 'select', options: PRODUCT_CATS, default: 'عام' },
      { name: 'salePrice', label: 'سعر البيع', type: 'number', default: 0 },
      { name: 'cost', label: 'سعر التكلفة', type: 'number', default: 0 },
      { name: 'qty', label: 'الكمية الافتتاحية', type: 'number', default: 0 },
      { name: 'uom', label: 'وحدة القياس', type: 'text', default: 'قطعة' },
      { name: 'minQty', label: 'حد إعادة الطلب', type: 'number', default: 0 },
      { name: 'note', label: 'وصف', type: 'textarea' },
    ],
  },

  employees: {
    label: 'موظف', plural: 'الموظفون', icon: '🧑‍💼', color: '#fd7e14', menu: true,
    title: r => r.name,
    subtitle: r => [r.job || '', r.department || '', r.phone || ''].filter(Boolean).join(' • '),
    badge: r => r.salary ? { text: fmtMoney(r.salary), cls: 'info' } : { text: '—', cls: 'muted' },
    searchFields: ['name', 'job', 'department', 'phone', 'email'],
    rowActions: r => `<button data-leave="${r.id}">📅 إجازة</button><button data-leaves="${r.id}">📋 الإجازات</button>`,
    fields: [
      { name: 'name', label: 'اسم الموظف *', type: 'text', required: true },
      { name: 'job', label: 'المسمى الوظيفي', type: 'text' },
      { name: 'department', label: 'القسم', type: 'select', options: DEPARTMENTS, default: 'الإدارة' },
      { name: 'phone', label: 'الهاتف', type: 'tel' },
      { name: 'email', label: 'البريد الإلكتروني', type: 'email' },
      { name: 'salary', label: 'الراتب الشهري', type: 'number', default: 0 },
      { name: 'hireDate', label: 'تاريخ التعيين', type: 'date', default: () => todayISO() },
      { name: 'note', label: 'ملاحظات', type: 'textarea' },
    ],
  },

  leads: {
    label: 'فرصة', plural: 'الفرص البيعية', icon: '🎯', menu: false,
    title: r => r.name,
    searchFields: ['name', 'contact', 'phone'],
    fields: [
      { name: 'name', label: 'عنوان الفرصة *', type: 'text', required: true },
      { name: 'contact', label: 'جهة الاتصال', type: 'text' },
      { name: 'phone', label: 'الهاتف', type: 'tel' },
      { name: 'value', label: 'القيمة المتوقعة', type: 'number', default: 0 },
      { name: 'stage', label: 'المرحلة', type: 'select', options: kv(LEAD_STAGES), default: 'new' },
      { name: 'note', label: 'ملاحظات', type: 'textarea' },
    ],
  },

  accounts: {
    label: 'حساب', plural: 'الحسابات', icon: '🧮', menu: false,
    title: r => `${r.code} — ${r.name}`,
    fields: [
      { name: 'code', label: 'رقم الحساب *', type: 'text', required: true },
      { name: 'name', label: 'اسم الحساب *', type: 'text', required: true },
      { name: 'type', label: 'النوع *', type: 'select', required: true, options: kv(ACCOUNT_TYPES) },
      { name: 'opening', label: 'الرصيد الافتتاحي', type: 'number', default: 0 },
    ],
  },
};

function kv(obj) { return Object.entries(obj).map(([v, l]) => ({ v, l })); }

/* ---------------------------------------------------------------------
   5) قائمة التطبيقات (الـ Drawer + شاشة التطبيقات)
   --------------------------------------------------------------------- */
const APPS = [
  { route: 'dashboard', label: 'لوحة التحكم', icon: '📊', color: '#714B67' },
  { route: 'partners', label: 'جهات الاتصال', icon: '👥', color: '#0d6efd' },
  { route: 'products', label: 'المنتجات', icon: '📦', color: '#6610f2' },
  { route: 'crm', label: 'إدارة العلاقات (CRM)', icon: '🎯', color: '#e83e8c' },
  { route: 'pos', label: 'نقطة البيع', icon: '🛍️', color: '#fd7e14' },
  { route: 'sales', label: 'المبيعات', icon: '🧾', color: '#198754' },
  { route: 'purchases', label: 'المشتريات', icon: '🛒', color: '#d63384' },
  { route: 'inventory', label: 'المخزون', icon: '🏭', color: '#0dcaf0' },
  { route: 'manufacturing', label: 'التصنيع', icon: '🏗️', color: '#795548' },
  { route: 'invoicing', label: 'الفوترة والمدفوعات', icon: '💳', color: '#20c997' },
  { route: 'treasury', label: 'الخزينة', icon: '🏦', color: '#0d9488' },
  { route: 'accounting', label: 'المحاسبة', icon: '🧮', color: '#dc3545' },
  { route: 'employees', label: 'الموظفون', icon: '🧑‍💼', color: '#fd7e14' },
  { route: 'payroll', label: 'الرواتب', icon: '💵', color: '#e83e8c' },
  { route: 'reports', label: 'التقارير', icon: '📈', color: '#6f42c1' },
  { route: 'guide', label: 'دليل الاستخدام', icon: '❓', color: '#607d8b' },
  { route: 'settings', label: 'الإعدادات', icon: '⚙️', color: '#6c757d' },
];

/* ---------------------------------------------------------------------
   6) التطبيق + التوجيه
   --------------------------------------------------------------------- */
const App = {
  route: 'dashboard',
  search: '',
  acctTab: 'accounts',   // التبويب النشط داخل المحاسبة
  ledgerAcc: '',         // الحساب المختار في دفتر الأستاذ
  payMonth: '',          // الشهر المختار في الرواتب
  posCart: [],           // سلة نقطة البيع
  posPartner: '',        // العميل المختار في نقطة البيع
  repFrom: '',           // مدى تواريخ التقارير: من
  repTo: '',             // مدى تواريخ التقارير: إلى
  vatFrom: '',           // مدى تقرير الضريبة
  vatTo: '',
  treasTab: 'vouchers',  // تبويب الخزينة
  recAcc: '',            // حساب التسوية البنكية

  // التطبيقات التي يظهر فيها زر الإضافة العائم
  fabRoutes: { partners: 1, products: 1, sales: 1, purchases: 1, employees: 1, accounting: 1, crm: 1 },

  go(route) {
    if (!Auth.user) { showLogin(); return; }
    if (!APPS.find(a => a.route === route) && route !== 'apps') route = 'dashboard';
    if (route !== 'apps' && !Auth.can(route)) { toast('لا تملك صلاحية لهذا التطبيق'); route = 'dashboard'; }
    this.route = route;
    this.search = '';
    const app = APPS.find(a => a.route === route);
    document.getElementById('pageTitle').textContent =
      route === 'apps' ? 'التطبيقات' : (app ? app.label : 'MOS ERP');
    closeDrawer();
    this.render();
    updateFab();
    window.scrollTo(0, 0);
  },

  render() {
    document.getElementById('view').innerHTML = Views[this.route]();
    bindViewEvents();
  },
};

/* إظهار/إخفاء زر الإضافة حسب السياق */
function updateFab() {
  let show = !!App.fabRoutes[App.route];
  if (App.route === 'accounting') show = (App.acctTab === 'accounts' || App.acctTab === 'journal');
  document.getElementById('fab').classList.toggle('hidden', !show);
}

/* ---------------------------------------------------------------------
   7) منطق المستندات (المبيعات والمشتريات)
   --------------------------------------------------------------------- */
function docTotals(doc) {
  const taxRate = num(DB.data.settings.taxRate) / 100;
  let subtotal = 0;
  (doc.lines || []).forEach(l => { subtotal += num(l.qty) * num(l.price); });
  const tax = +(subtotal * taxRate).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);
  const paid = num(doc.paid);
  return { subtotal: +subtotal.toFixed(2), tax, total, paid, due: +(total - paid).toFixed(2) };
}

/* تأكيد مستند: ترحيل حركات المخزون وتحديث الكميات */
function confirmDoc(coll, id) {
  const doc = DB.get(coll, id);
  if (!doc || doc.status !== 'draft') return;
  if (!(doc.lines || []).length) { toast('أضِف بنوداً أولاً'); return; }
  if (lockedToast(doc.date || todayISO())) return;
  const isSale = coll === 'sales';
  const sign = isSale ? -1 : +1;            // البيع يُنقص المخزون، الشراء يزيده
  const costSnap = [];                       // لقطة التكلفة قبل التغيير (للإلغاء)
  (doc.lines || []).forEach(l => {
    const p = DB.get('products', l.productId);
    if (p && p.type !== 'service') {
      costSnap.push({ productId: p.id, cost: num(p.cost) });
      if (!isSale) {
        // تقييم المخزون بالمتوسط المرجّح عند الشراء
        const oldQty = num(p.qty), oldCost = num(p.cost);
        const addQty = num(l.qty);
        const unitBase = toBase(num(l.price), doc);     // سعر الشراء للوحدة بالعملة الأساسية
        const newQty = oldQty + addQty;
        p.cost = newQty > 0 ? +(((oldQty * oldCost) + (addQty * unitBase)) / newQty).toFixed(4) : unitBase;
        p.qty = newQty;
      } else {
        p.qty = num(p.qty) + sign * num(l.qty);         // البيع: التكلفة المتوسطة ثابتة
      }
      DB.upsert('products', p);
      DB.upsert('moves', {
        date: doc.date || todayISO(),
        productId: l.productId,
        qty: sign * num(l.qty),
        type: isSale ? 'out' : 'in',
        ref: doc.ref,
        doc: coll,
        docId: doc.id,
      });
    }
  });
  doc.status = 'confirmed';
  doc.costSnap = costSnap;
  DB.upsert(coll, doc);
  postDocConfirm(coll, doc);
  toast('تم التأكيد وترحيل المخزون والقيد المحاسبي ✅');
}

/* إلغاء مستند: عكس حركات المخزون إن كان مؤكداً */
function cancelDoc(coll, id) {
  const doc = DB.get(coll, id);
  if (!doc || doc.status === 'cancel') return;
  if (lockedToast(doc.date || todayISO())) return;
  if (doc.status === 'confirmed' || doc.status === 'paid') {
    const isSale = coll === 'sales';
    const sign = isSale ? +1 : -1;          // عكس الترحيل
    const snap = {};
    (doc.costSnap || []).forEach(s => { snap[s.productId] = s.cost; });
    (doc.lines || []).forEach(l => {
      const p = DB.get('products', l.productId);
      if (p && p.type !== 'service') {
        p.qty = num(p.qty) + sign * num(l.qty);
        if (snap[p.id] != null) p.cost = snap[p.id];   // استعادة التكلفة المتوسطة قبل العملية
        DB.upsert('products', p);
      }
    });
    DB.data.moves = DB.data.moves.filter(m => m.docId !== id);
    DB.data.payments = DB.data.payments.filter(p => p.docId !== id);
    Acct.removeByDoc(id);
    doc.paid = 0;
  }
  doc.status = 'cancel';
  DB.upsert(coll, doc);
  toast('تم إلغاء المستند وعكس القيود');
}

/* إنشاء مرتجع كامل لمستند مؤكد/مدفوع (إشعار دائن للمبيعات / مدين للمشتريات) */
function createReturn(coll, id) {
  const doc = DB.get(coll, id);
  if (!doc || (doc.status !== 'confirmed' && doc.status !== 'paid')) return;
  if (doc.returned) { toast('سبق إرجاع هذا المستند'); return; }
  const date = todayISO();
  if (lockedToast(date)) return;
  const isSale = coll === 'sales';
  const t = docTotals(doc);
  const ret = DB.upsert('returns', {
    ref: DB.nextRef('RT'), srcColl: coll, srcId: id, partnerId: doc.partnerId, date,
    kind: isSale ? 'sale' : 'purchase', currency: docCurCode(doc), rate: docRate(doc),
    total: t.total, lines: (doc.lines || []).map(l => ({ ...l })),
  });
  // عكس المخزون
  const sign = isSale ? +1 : -1;       // مرتجع بيع يزيد المخزون، مرتجع شراء ينقصه
  let cogs = 0;
  (doc.lines || []).forEach(l => {
    const p = DB.get('products', l.productId);
    if (p && p.type !== 'service') {
      cogs += num(l.qty) * num(p.cost);
      p.qty = num(p.qty) + sign * num(l.qty);
      DB.upsert('products', p);
      DB.upsert('moves', { date, productId: l.productId, qty: sign * num(l.qty), type: isSale ? 'in' : 'out', ref: ret.ref, doc: 'return', docId: ret.id });
    }
  });
  // قيد عكسي
  const lines = [];
  if (isSale) {
    lines.push({ accountId: Acct.id('sales'), debit: toBase(t.subtotal, doc), credit: 0 });
    if (t.tax) lines.push({ accountId: Acct.id('vatOut'), debit: toBase(t.tax, doc), credit: 0 });
    lines.push({ accountId: Acct.id('ar'), debit: 0, credit: toBase(t.total, doc) });
    if (cogs > 0) {
      lines.push({ accountId: Acct.id('inventory'), debit: +cogs.toFixed(2), credit: 0 });
      lines.push({ accountId: Acct.id('cogs'), debit: 0, credit: +cogs.toFixed(2) });
    }
  } else {
    let stockSub = 0, svcSub = 0;
    (doc.lines || []).forEach(l => {
      const p = DB.get('products', l.productId);
      const amt = toBase(num(l.qty) * num(l.price), doc);
      if (p && p.type !== 'service') stockSub += amt; else svcSub += amt;
    });
    lines.push({ accountId: Acct.id('ap'), debit: toBase(t.total, doc), credit: 0 });
    if (stockSub > 0) lines.push({ accountId: Acct.id('inventory'), debit: 0, credit: +stockSub.toFixed(2) });
    if (svcSub > 0) lines.push({ accountId: Acct.id('purchases'), debit: 0, credit: +svcSub.toFixed(2) });
    if (t.tax) lines.push({ accountId: Acct.id('vatIn'), debit: 0, credit: toBase(t.tax, doc) });
  }
  Acct.post({ date, ref: ret.ref, narration: (isSale ? 'مرتجع مبيعات ' : 'مرتجع مشتريات ') + doc.ref, source: 'return', sourceId: ret.id, docId: ret.id, lines });
  doc.returned = true; doc.returnRef = ret.ref;
  DB.upsert(coll, doc);
  toast('تم إنشاء المرتجع وعكس أثره ✅');
}

/* ---------------------------------------------------------------------
   الخزينة — سندات قبض/صرف وتحويلات بين الصناديق والبنوك
   --------------------------------------------------------------------- */
const VOUCHER_LABEL = { receipt: 'سند قبض', payment: 'سند صرف', transfer: 'تحويل خزينة' };

function postVoucher(v) {
  if (lockedToast(v.date)) return null;
  const amt = num(v.amount);
  if (amt <= 0) { toast('أدخل مبلغاً صحيحاً'); return null; }
  const lines = [];
  if (v.type === 'transfer') {
    if (v.fromRole === v.toRole) { toast('اختر حسابين مختلفين'); return null; }
    lines.push({ accountId: Acct.id(v.toRole), debit: amt, credit: 0 });
    lines.push({ accountId: Acct.id(v.fromRole), debit: 0, credit: amt });
  } else {
    if (!v.counterAccount) { toast('اختر الحساب المقابل'); return null; }
    const cashRole = v.method === 'cash' ? 'cash' : 'bank';
    if (v.type === 'receipt') {
      lines.push({ accountId: Acct.id(cashRole), debit: amt, credit: 0 });
      lines.push({ accountId: v.counterAccount, debit: 0, credit: amt });
    } else {
      lines.push({ accountId: v.counterAccount, debit: amt, credit: 0 });
      lines.push({ accountId: Acct.id(cashRole), debit: 0, credit: amt });
    }
  }
  const rec = DB.upsert('vouchers', { ref: DB.nextRef('CV'), ...v, amount: amt });
  Acct.post({ date: v.date, ref: rec.ref, narration: v.note || VOUCHER_LABEL[v.type], source: 'voucher', sourceId: rec.id, docId: rec.id, lines });
  toast('تم ترحيل ' + VOUCHER_LABEL[v.type] + ' ✅');
  return rec;
}

function deleteVoucher(id) {
  Acct.removeByDoc(id);
  DB.remove('vouchers', id);
}

function openVoucherDialog(type) {
  const isTransfer = type === 'transfer';
  const accs = DB.list('accounts').slice().sort(byCode);
  // اقتراح الحساب المقابل: إيراد للقبض، مصروف للصرف
  const accOpts = accs.map(a => `<option value="${a.id}">${esc(a.code)} — ${esc(a.name)}</option>`).join('');
  document.getElementById('modalTitle').textContent = VOUCHER_LABEL[type];
  let body = `<div class="field"><label>التاريخ</label><input name="date" type="date" value="${todayISO()}" required /></div>
    <div class="field"><label>المبلغ</label><input name="amount" type="number" inputmode="decimal" step="any" min="0" required /></div>`;
  if (isTransfer) {
    body += `<div class="field"><label>من</label><select name="fromRole"><option value="cash">الصندوق</option><option value="bank">البنك</option></select></div>
      <div class="field"><label>إلى</label><select name="toRole"><option value="bank">البنك</option><option value="cash">الصندوق</option></select></div>`;
  } else {
    body += `<div class="field"><label>عبر</label><select name="method"><option value="cash">الصندوق (نقدي)</option><option value="bank">البنك</option></select></div>
      <div class="field"><label>الحساب المقابل (${type === 'receipt' ? 'مصدر القبض' : 'وجهة الصرف'})</label><select name="counterAccount" required><option value="">— اختر —</option>${accOpts}</select></div>`;
  }
  body += `<div class="field"><label>ملاحظة</label><input name="note" placeholder="بيان السند" /></div>
    <button type="submit" class="btn-primary">ترحيل</button>`;
  document.getElementById('modalForm').innerHTML = body;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modalForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const v = { type, date: fd.get('date'), amount: fd.get('amount'), note: (fd.get('note') || '').trim() };
    if (isTransfer) { v.fromRole = fd.get('fromRole'); v.toRole = fd.get('toRole'); }
    else { v.method = fd.get('method'); v.counterAccount = fd.get('counterAccount'); }
    if (postVoucher(v)) { closeForm(); document.getElementById('modalForm').onsubmit = submitForm; App.render(); }
  };
}

function toggleReconcile(journalId) {
  const r = DB.data.settings.reconciled || (DB.data.settings.reconciled = {});
  if (r[journalId]) delete r[journalId]; else r[journalId] = true;
  DB.save();
}

/* ---------------------------------------------------------------------
   ورديات نقطة البيع
   --------------------------------------------------------------------- */
function currentPosSession() { return DB.list('posSessions').find(s => !s.closedAt); }
function posSessionOpen(float) {
  if (currentPosSession()) { toast('توجد وردية مفتوحة بالفعل'); return; }
  DB.upsert('posSessions', { openedAt: new Date().toISOString(), openingFloat: num(float), openedBy: Auth.user ? Auth.user.name : '', closedAt: '' });
  toast('تم فتح الوردية ✅');
}
function posSessionClose(counted) {
  const s = currentPosSession();
  if (!s) return;
  const sales = DB.list('sales').filter(x => x.sessionId === s.id && x.status !== 'cancel');
  const cashSales = sales.filter(x => x.posMethod === 'cash').reduce((a, x) => a + docTotals(x).total, 0);
  const cardSales = sales.filter(x => x.posMethod !== 'cash').reduce((a, x) => a + docTotals(x).total, 0);
  s.closedAt = new Date().toISOString();
  s.cashSales = cashSales; s.cardSales = cardSales; s.count = sales.length;
  s.expected = num(s.openingFloat) + cashSales;
  s.counted = num(counted); s.diff = +(s.counted - s.expected).toFixed(2);
  DB.upsert('posSessions', s);
  toast('تم إغلاق الوردية ✅');
}

/* ---------------------------------------------------------------------
   إجازات الموظفين
   --------------------------------------------------------------------- */
const LEAVE_TYPES = { annual: 'سنوية', sick: 'مرضية', unpaid: 'بدون راتب', other: 'أخرى' };
function openLeaveDialog(empId) {
  document.getElementById('modalTitle').textContent = 'تسجيل إجازة — ' + employeeName(empId);
  document.getElementById('modalForm').innerHTML = `
    <div class="field"><label>من تاريخ</label><input name="from" type="date" value="${todayISO()}" required /></div>
    <div class="field"><label>إلى تاريخ</label><input name="to" type="date" value="${todayISO()}" required /></div>
    <div class="field"><label>النوع</label><select name="type">${kv(LEAVE_TYPES).map(o => `<option value="${o.v}">${o.l}</option>`).join('')}</select></div>
    <div class="field"><label>ملاحظة</label><input name="note" /></div>
    <button type="submit" class="btn-primary">حفظ الإجازة</button>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modalForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    DB.upsert('leaves', { employeeId: empId, from: fd.get('from'), to: fd.get('to'), type: fd.get('type'), note: (fd.get('note') || '').trim() });
    closeForm();
    document.getElementById('modalForm').onsubmit = submitForm;
    toast('تم تسجيل الإجازة ✅');
    App.render();
  };
}
function openLeavesList(empId) {
  const list = DB.list('leaves').filter(l => l.employeeId === empId).sort((a, b) => (b.from || '').localeCompare(a.from || ''));
  document.getElementById('modalTitle').textContent = 'إجازات ' + employeeName(empId);
  const body = list.length ? list.map(l => `<div class="card" style="margin-bottom:8px"><div class="row"><div>
      <div class="title">${esc(LEAVE_TYPES[l.type] || l.type)}</div>
      <div class="meta">${fmtDate(l.from)} ← ${fmtDate(l.to)}${l.note ? ' • ' + esc(l.note) : ''}</div>
    </div><button class="del" data-leave-del="${l.id}" style="border:none;background:none;cursor:pointer">🗑️</button></div></div>`).join('')
    : emptyState('🏖️', 'لا توجد إجازات', 'سجّل إجازة من زر «إجازة».');
  document.getElementById('modalForm').innerHTML = body + `<button type="button" class="btn-primary" id="closeLeaves">إغلاق</button>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('closeLeaves').onclick = closeForm;
  document.querySelectorAll('[data-leave-del]').forEach(b => { b.onclick = () => { DB.remove('leaves', b.dataset.leaveDel); openLeavesList(empId); }; });
}

/* تحويل مخزني */
function openTransferDialog(productId) {
  const whs = DB.data.settings.warehouses || [];
  if (whs.length < 2) { toast('أضِف مخزناً آخر من الإعدادات أولاً'); return; }
  const p = DB.get('products', productId);
  const opt = sel => whs.map(w => `<option value="${w.id}" ${w.id === sel ? 'selected' : ''}>${esc(w.name)} (${fmtQty(whQty(p, w.id))})</option>`).join('');
  document.getElementById('modalTitle').textContent = 'تحويل مخزني — ' + esc(p.name);
  document.getElementById('modalForm').innerHTML = `
    <div class="field"><label>من مخزن</label><select name="from">${opt(whs[0].id)}</select></div>
    <div class="field"><label>إلى مخزن</label><select name="to">${opt(whs[1].id)}</select></div>
    <div class="field"><label>الكمية</label><input name="qty" type="number" inputmode="decimal" step="any" min="0" required /></div>
    <button type="submit" class="btn-primary">تحويل</button>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modalForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    createTransfer(productId, fd.get('from'), fd.get('to'), fd.get('qty'));
    closeForm();
    document.getElementById('modalForm').onsubmit = submitForm;
    App.render();
  };
}

/* تسجيل دفعة على مستند (payRate = سعر الصرف يوم الدفع، اختياري) */
function registerPayment(coll, id, amount, method, payRate) {
  const doc = DB.get(coll, id);
  if (!doc) return;
  if (lockedToast(todayISO())) return;
  const t = docTotals(doc);
  const amt = Math.min(num(amount), t.due);
  if (amt <= 0) { toast('لا يوجد مبلغ مستحق'); return; }
  const pr = num(payRate) || docRate(doc);
  doc.paid = num(doc.paid) + amt;
  const nt = docTotals(doc);
  if (nt.due <= 0.001) doc.status = 'paid';
  DB.upsert(coll, doc);
  const pay = DB.upsert('payments', {
    date: todayISO(),
    partnerId: doc.partnerId,
    kind: coll === 'sales' ? 'in' : 'out',   // قبض من عميل / صرف لمورد
    amount: amt,
    method: method || 'cash',
    ref: doc.ref,
    doc: coll,
    docId: id,
    currency: docCurCode(doc),
    rate: docRate(doc),     // سعر الفاتورة (لمطابقة الذمم)
    payRate: pr,            // سعر يوم الدفع (للنقدية وفرق الصرف)
  });
  postPayment(coll, doc, amt, method || 'cash', pay.id, pr);
  const fxNote = Math.abs(pr - docRate(doc)) > 0.0001 ? ' (مع فرق صرف)' : '';
  toast('تم تسجيل الدفعة وترحيل القيد ✅' + fxNote);
}

/* ---------------------------------------------------------------------
   8) العروض (Views)
   --------------------------------------------------------------------- */
const Views = {

  /* ===== شاشة التطبيقات (مثل Odoo Apps) ===== */
  apps() {
    let html = '<div class="apps-grid">';
    allowedApps().forEach(a => {
      html += `<button class="app-tile" data-go="${a.route}" style="--c:${a.color}">
        <span class="app-ico">${a.icon}</span><span class="app-name">${esc(a.label)}</span></button>`;
    });
    return html + '</div>';
  },

  /* ===== لوحة التحكم ===== */
  dashboard() {
    const sales = DB.list('sales');
    const purchases = DB.list('purchases');
    const products = DB.list('products');

    const valid = d => d.status === 'confirmed' || d.status === 'paid';
    const salesTotal = sales.filter(valid).reduce((s, d) => s + toBase(docTotals(d).total, d), 0);
    const purchTotal = purchases.filter(valid).reduce((s, d) => s + toBase(docTotals(d).total, d), 0);
    const receivable = sales.filter(valid).reduce((s, d) => s + toBase(docTotals(d).due, d), 0);
    const payable = purchases.filter(valid).reduce((s, d) => s + toBase(docTotals(d).due, d), 0);
    const lowStock = products.filter(p => p.type !== 'service' && num(p.qty) <= num(p.minQty));
    const stockValue = products.reduce((s, p) => s + num(p.qty) * num(p.cost), 0);
    const cashAcc = DB.get('accounts', Acct.id('cash'));
    const bankAcc = DB.get('accounts', Acct.id('bank'));
    const cash = (cashAcc ? Acct.balance(cashAcc) : 0) + (bankAcc ? Acct.balance(bankAcc) : 0);

    const stat = (num_, lbl, ico, color) => `
      <div class="stat-card" style="--c:${color}">
        <span class="ico">${ico}</span>
        <div class="num">${num_}</div><div class="lbl">${lbl}</div></div>`;

    let html = `<div class="stat-grid">
      ${stat(fmtMoney(salesTotal), 'إجمالي المبيعات', '🧾', '#198754')}
      ${stat(fmtMoney(purchTotal), 'إجمالي المشتريات', '🛒', '#d63384')}
      ${stat(fmtMoney(receivable), 'ذمم مدينة (لنا)', '📥', '#0d6efd')}
      ${stat(fmtMoney(payable), 'ذمم دائنة (علينا)', '📤', '#dc3545')}
      ${stat(fmtMoney(Acct.netProfit()), 'صافي الربح (محاسبي)', '💰', '#714B67')}
      ${stat(fmtMoney(cash), 'النقدية والبنك', '🏦', '#198754')}
      ${stat(fmtMoney(stockValue), 'قيمة المخزون', '🏭', '#0dcaf0')}
    </div>`;

    /* مخطط المبيعات الشهرية */
    const monthly = monthlySeries(sales.filter(valid));
    if (monthly.some(m => m.value > 0)) {
      html += `<div class="section-title">📈 المبيعات آخر 6 أشهر</div>`;
      html += barChart(monthly);
    }

    /* تنبيه المخزون المنخفض */
    if (lowStock.length) {
      html += `<div class="section-title">⚠️ منتجات تحت حد إعادة الطلب</div>`;
      lowStock.slice(0, 6).forEach(p => {
        html += `<div class="card" data-edit="products:${p.id}">
          <div class="row"><div>
            <div class="title">${esc(p.name)}</div>
            <div class="meta">المتوفر: <b>${fmtQty(p.qty)}</b> ${esc(p.uom || '')} • حد الطلب: ${fmtQty(p.minQty)}</div>
          </div><span class="badge danger">نفاد قريب</span></div></div>`;
      });
    }

    /* أحدث المبيعات */
    const recent = sales.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);
    if (recent.length) {
      html += `<div class="section-title">🧾 أحدث أوامر البيع</div>`;
      recent.forEach(d => { html += docCardMini('sales', d); });
    }

    if (!sales.length && !purchases.length && !products.length) {
      html += `<div class="empty"><div class="big">🚀</div>
        <p>مرحباً بك في <b>MOS ERP</b>.<br>ابدأ بإضافة المنتجات وجهات الاتصال،<br>ثم أنشئ أول أمر بيع.</p>
        <button class="btn-primary" style="max-width:240px;margin:14px auto 0" data-go="apps">استعراض التطبيقات</button></div>`;
    }
    return html;
  },

  /* ===== العروض العامة للنماذج (قيادة بالبيانات) ===== */
  partners() { return modelList('partners'); },
  products() { return modelList('products'); },
  employees() { return modelList('employees'); },

  /* ===== المبيعات ===== */
  sales() { return docList('sales'); },
  /* ===== المشتريات ===== */
  purchases() { return docList('purchases'); },

  /* ===== المخزون ===== */
  inventory() {
    const products = DB.list('products').filter(p => p.type !== 'service');
    const items = filterBySearch(products, ['name', 'code', 'category']);
    let html = searchBar('ابحث عن منتج في المخزون...');
    html += `<div class="card" style="display:flex;gap:8px;justify-content:space-between;align-items:center">
      <div class="meta">إجمالي المنتجات المخزنية: <b>${products.length}</b></div>
      <button class="mini-btn" data-adjust="new">＋ تسوية مخزون</button></div>`;
    if (!items.length) return html + emptyState('🏭', 'لا توجد منتجات مخزنية', 'أضِف منتجات من تطبيق «المنتجات».');

    const whs = DB.data.settings.warehouses || [];
    const multi = whs.length > 1;
    items.forEach(p => {
      const low = num(p.qty) <= num(p.minQty);
      const breakdown = multi ? `<div class="meta">${whs.map(w => `${esc(w.name)}: <b>${fmtQty(whQty(p, w.id))}</b>`).join(' • ')}</div>` : '';
      html += `<div class="card"><div class="row"><div>
        <div class="title">${esc(p.name)}</div>
        <div class="meta">${p.code ? 'الرمز: <b>' + esc(p.code) + '</b> • ' : ''}قيمة: <b>${fmtMoney(num(p.qty) * num(p.cost))}</b></div>
        ${breakdown}
      </div><div style="text-align:left">
        <div class="qty-big ${low ? 'low' : ''}">${fmtQty(p.qty)} <small>${esc(p.uom || '')}</small></div>
      </div></div>
      <div class="card-actions">
        <button data-move="${p.id}:-1">➖</button>
        <button data-move="${p.id}:1">➕</button>
        <button data-adjust="${p.id}">⚖️ تسوية</button>
        ${multi ? `<button data-transfer="${p.id}">🔄 تحويل</button>` : ''}
        <button data-history="${p.id}">📜 الحركات</button>
      </div></div>`;
    });
    return html;
  },

  /* ===== الفوترة والمدفوعات ===== */
  invoicing() {
    const sales = DB.list('sales').filter(d => d.status === 'confirmed' || d.status === 'paid');
    const purchases = DB.list('purchases').filter(d => d.status === 'confirmed' || d.status === 'paid');
    const payments = DB.list('payments').slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const payBase = p => num(p.amount) * (num(p.rate) || 1);
    const totalIn = payments.filter(p => p.kind === 'in').reduce((s, p) => s + payBase(p), 0);
    const totalOut = payments.filter(p => p.kind === 'out').reduce((s, p) => s + payBase(p), 0);

    let html = `<div class="stat-grid">
      <div class="stat-card" style="--c:#198754"><span class="ico">📥</span><div class="num">${fmtMoney(totalIn)}</div><div class="lbl">إجمالي المقبوضات</div></div>
      <div class="stat-card" style="--c:#dc3545"><span class="ico">📤</span><div class="num">${fmtMoney(totalOut)}</div><div class="lbl">إجمالي المدفوعات</div></div>
    </div>`;

    const unpaidSales = sales.filter(d => docTotals(d).due > 0.001);
    const unpaidPurch = purchases.filter(d => docTotals(d).due > 0.001);

    if (unpaidSales.length) {
      html += `<div class="section-title">🧾 فواتير عملاء غير محصّلة</div>`;
      unpaidSales.forEach(d => { html += invoiceRow('sales', d); });
    }
    if (unpaidPurch.length) {
      html += `<div class="section-title">🛒 فواتير موردين غير مسددة</div>`;
      unpaidPurch.forEach(d => { html += invoiceRow('purchases', d); });
    }

    html += `<div class="section-title">💳 سجل المدفوعات</div>`;
    if (!payments.length) html += emptyState('💳', 'لا توجد مدفوعات', 'سجّل دفعة من أي فاتورة مؤكدة.');
    payments.slice(0, 40).forEach(p => {
      const inn = p.kind === 'in';
      html += `<div class="card"><div class="row"><div>
        <div class="title">${inn ? 'قبض من' : 'صرف إلى'}: ${esc(partnerName(p.partnerId))}</div>
        <div class="meta">${fmtDate(p.date)} • ${esc(PAY_METHOD[p.method] || p.method)} • مرجع: ${esc(p.ref || '—')}</div>
      </div><span class="badge ${inn ? 'ok' : 'danger'}">${inn ? '+' : '−'} ${fmtCur(p.amount, p.currency || 'BASE')}</span></div></div>`;
    });
    return html;
  },

  /* ===== المحاسبة (لوحة بتبويبات) ===== */
  accounting() {
    const tabs = [
      ['accounts', 'شجرة الحسابات'], ['journal', 'القيود'], ['trial', 'ميزان المراجعة'],
      ['ledger', 'دفتر الأستاذ'], ['pl', 'قائمة الدخل'], ['bs', 'الميزانية'], ['vat', 'ضريبة VAT'], ['close', 'الإقفال'],
    ];
    let html = `<div class="acct-tabs">` + tabs.map(([k, l]) =>
      `<button class="acct-tab ${App.acctTab === k ? 'active' : ''}" data-actab="${k}">${l}</button>`).join('') + `</div>`;
    html += (AcctViews[App.acctTab] || AcctViews.accounts)();
    return html;
  },

  /* ===== الرواتب ===== */
  payroll() {
    if (!App.payMonth) App.payMonth = todayISO().slice(0, 7);
    const month = App.payMonth;
    if (!DB.list('employees').length)
      return emptyState('💵', 'لا يوجد موظفون', 'أضِف موظفين من تطبيق «الموظفون» أولاً.');

    let html = `<div class="card">
      <div class="field" style="margin-bottom:8px"><label>شهر الرواتب</label>
        <input id="payMonthInput" type="month" value="${esc(month)}" /></div>
      <button class="btn-primary" id="runPayrollBtn">▶️ تشغيل رواتب ${esc(month)}</button>
    </div>`;

    const slips = DB.list('payslips').filter(p => p.month === month)
      .sort((a, b) => employeeName(a.employeeId).localeCompare(employeeName(b.employeeId)));

    const totalNet = slips.reduce((s, p) => s + payslipNet(p), 0);
    const paidCount = slips.filter(p => p.status === 'paid').length;

    if (!slips.length) return html + emptyState('🧾', 'لا توجد قسائم لهذا الشهر', 'اضغط «تشغيل الرواتب» لتوليدها.');

    html += `<div class="stat-grid">
      <div class="stat-card" style="--c:#e83e8c"><span class="ico">💵</span><div class="num">${fmtMoney(totalNet)}</div><div class="lbl">إجمالي صافي الرواتب</div></div>
      <div class="stat-card" style="--c:#198754"><span class="ico">✅</span><div class="num">${paidCount}/${slips.length}</div><div class="lbl">المصروفة</div></div>
    </div>`;

    slips.forEach(p => {
      const st = { draft: 'muted', posted: 'info', paid: 'ok' }[p.status] || 'muted';
      const stLbl = { draft: 'مسودة', posted: 'معتمدة', paid: 'مصروفة' }[p.status] || p.status;
      let actions = '';
      if (p.status === 'draft') actions = `<button data-pslip-post="${p.id}">✅ اعتماد</button><button data-pslip-edit="${p.id}">✏️ تعديل</button><button class="del" data-pslip-del="${p.id}">🗑️</button>`;
      else if (p.status === 'posted') actions = `<button data-pslip-pay="${p.id}">💵 صرف</button><button data-pslip-print="${p.id}">🖨️ قسيمة</button>`;
      else actions = `<button data-pslip-print="${p.id}">🖨️ قسيمة</button>`;
      html += `<div class="card"><div class="row"><div>
          <div class="title">${esc(employeeName(p.employeeId))}</div>
          <div class="meta">أساسي: ${fmtMoney(p.basic)} • بدلات: ${fmtMoney(p.allowances)} • استقطاع: ${fmtMoney(p.deductions)}</div>
        </div><div style="text-align:left">
          <span class="badge ${st}">${stLbl}</span>
          <div class="title" style="margin-top:6px">${fmtMoney(payslipNet(p))}</div>
        </div></div>
        <div class="card-actions">${actions}</div></div>`;
    });
    return html;
  },

  /* ===== نقطة البيع (POS) ===== */
  pos() {
    const products = DB.list('products');
    if (!products.length)
      return emptyState('🛍️', 'لا توجد منتجات', 'أضِف منتجات من تطبيق «المنتجات» للبيع السريع.');

    const grid = filterBySearch(products, ['name', 'code']).map(p => {
      const out = p.type !== 'service' && num(p.qty) <= 0;
      return `<button class="pos-prod ${out ? 'out' : ''}" data-pos-add="${p.id}" ${out ? 'disabled' : ''}>
        <span class="pp-name">${esc(p.name)}</span>
        <span class="pp-price">${fmtMoney(p.salePrice)}</span>
        ${p.type !== 'service' ? `<span class="pp-stock">${fmtQty(p.qty)}</span>` : ''}
      </button>`;
    }).join('');

    let subtotal = 0;
    App.posCart.forEach(l => subtotal += num(l.qty) * num(l.price));
    const tax = subtotal * num(DB.data.settings.taxRate) / 100;
    const total = subtotal + tax;

    const cart = App.posCart.length ? App.posCart.map((l, i) => `
      <div class="pos-line">
        <span class="pl-name">${esc(productName(l.productId))}</span>
        <button class="pl-btn" data-pos-dec="${i}">−</button>
        <span class="pl-qty">${fmtQty(l.qty)}</span>
        <button class="pl-btn" data-pos-inc="${i}">+</button>
        <span class="pl-sum">${fmtMoney(num(l.qty) * num(l.price))}</span>
        <button class="pl-del" data-pos-del="${i}">✕</button>
      </div>`).join('') : `<div class="muted-text" style="padding:16px;text-align:center">السلة فارغة — اضغط على منتج لإضافته.</div>`;

    const custOpts = DB.list('partners').filter(p => p.kind !== 'vendor')
      .map(p => `<option value="${p.id}" ${App.posPartner === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

    const sess = currentPosSession();
    const sessBar = sess
      ? `<div class="card" style="display:flex;justify-content:space-between;align-items:center;background:#e9f7ef">
          <div class="meta">🟢 وردية مفتوحة • عهدة: <b>${fmtMoney(sess.openingFloat)}</b> • بدأت ${fmtDate((sess.openedAt || '').slice(0, 10))}</div>
          <button class="mini-btn" id="posCloseSess">إغلاق الوردية</button></div>`
      : `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
          <div class="meta">🔴 لا توجد وردية مفتوحة</div>
          <button class="mini-btn" id="posOpenSess">فتح وردية</button></div>`;
    return sessBar + `
      <div class="pos-scan">
        <input id="posBarcode" type="text" inputmode="text" placeholder="📷 امسح أو أدخل الباركود ثم Enter" autocomplete="off" />
        <button id="posCamBtn" class="mini-btn" title="مسح بالكاميرا">📷</button>
      </div>
      <input class="search" id="searchInput" type="search" placeholder="ابحث عن منتج بالاسم..." value="${esc(App.search)}" />
      <div class="pos-wrap">
        <div class="pos-grid">${grid}</div>
        <div class="pos-cart">
          <div class="field" style="margin-bottom:8px"><label>العميل</label>
            <select id="posCust"><option value="">عميل نقدي</option>${custOpts}</select></div>
          <div class="pos-lines">${cart}</div>
          <div class="pos-totals">
            <div class="rep-row"><span>المجموع الفرعي</span><span>${fmtMoney(subtotal)}</span></div>
            <div class="rep-row"><span>الضريبة (${num(DB.data.settings.taxRate)}%)</span><span>${fmtMoney(tax)}</span></div>
            <div class="rep-row strong"><span>الإجمالي</span><span>${fmtMoney(total)}</span></div>
          </div>
          <div class="card-actions" style="margin-top:10px">
            <button class="pos-pay" data-pos-checkout="cash" ${App.posCart.length ? '' : 'disabled'}>💵 دفع نقدي</button>
            <button class="pos-pay bank" data-pos-checkout="bank" ${App.posCart.length ? '' : 'disabled'}>💳 بطاقة/بنك</button>
          </div>
          ${App.posCart.length ? `<button class="del" id="posClear" style="width:100%;margin-top:8px;padding:8px;border:1px solid var(--border);border-radius:9px;background:#faf9fb;cursor:pointer">🗑️ تفريغ السلة</button>` : ''}
        </div>
      </div>`;
  },

  /* ===== CRM — لوحة الفرص حسب المرحلة ===== */
  crm() {
    const leads = DB.list('leads');
    const totalOpen = leads.filter(l => l.stage !== 'won' && l.stage !== 'lost').reduce((s, l) => s + num(l.value), 0);
    const won = leads.filter(l => l.stage === 'won').reduce((s, l) => s + num(l.value), 0);
    let html = `<div class="stat-grid">
      <div class="stat-card" style="--c:#e83e8c"><span class="ico">🎯</span><div class="num">${fmtMoney(totalOpen)}</div><div class="lbl">فرص مفتوحة</div></div>
      <div class="stat-card" style="--c:#198754"><span class="ico">🏆</span><div class="num">${fmtMoney(won)}</div><div class="lbl">صفقات مكسوبة</div></div>
    </div>`;
    if (!leads.length) return html + emptyState('🎯', 'لا توجد فرص', 'اضغط «＋» لإضافة فرصة بيعية.');
    STAGE_ORDER.forEach(stage => {
      const group = leads.filter(l => l.stage === stage);
      if (!group.length) return;
      const sum = group.reduce((s, l) => s + num(l.value), 0);
      const cls = stage === 'won' ? 'ok' : stage === 'lost' ? 'danger' : 'info';
      html += `<div class="section-title">${esc(LEAD_STAGES[stage])} <span class="muted-text">(${group.length} — ${fmtMoney(sum)})</span></div>`;
      group.forEach(l => {
        const idx = STAGE_ORDER.indexOf(stage);
        const next = idx < 3 ? STAGE_ORDER[idx + 1] : null;   // التالي حتى «مكسوب»
        html += `<div class="card"><div class="row"><div>
            <div class="title">${esc(l.name)}</div>
            <div class="meta">${esc(l.contact || '')}${l.phone ? ' • ' + esc(l.phone) : ''}</div>
          </div><span class="badge ${cls}">${fmtMoney(l.value)}</span></div>
          <div class="card-actions">
            ${next && stage !== 'won' ? `<button data-lead-move="${l.id}:${next}">▶️ ${esc(LEAD_STAGES[next])}</button>` : ''}
            ${stage !== 'won' && stage !== 'lost' ? `<button data-lead-win="${l.id}">🏆 تحويل لعميل</button>` : ''}
            ${stage !== 'lost' && stage !== 'won' ? `<button class="del" data-lead-move="${l.id}:lost">✖️ خاسر</button>` : ''}
            <button data-edit="leads:${l.id}">✏️</button>
            <button class="del" data-del="leads:${l.id}">🗑️</button>
          </div></div>`;
      });
    });
    return html;
  },

  /* ===== التصنيع — قوائم المكوّنات وأوامر التصنيع ===== */
  manufacturing() {
    const boms = DB.list('boms');
    let html = `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
      <div class="meta">قوائم المكوّنات: <b>${boms.length}</b> • أوامر التصنيع: <b>${DB.list('mos').length}</b></div>
      <button class="mini-btn" id="addBomBtnTop">＋ قائمة مكوّنات</button></div>`;
    if (!DB.list('products').length) return html + emptyState('🏗️', 'لا توجد منتجات', 'أضِف منتجات أولاً لتعريف قوائم المكوّنات.');
    if (!boms.length) html += emptyState('🏗️', 'لا توجد قوائم مكوّنات', 'عرّف منتجاً تاماً ومكوّناته ثم نفّذ أمر تصنيع.');
    boms.forEach(b => {
      const comps = (b.components || []).map(c => `${esc(productName(c.productId))} ×${fmtQty(c.qty)}`).join('، ');
      html += `<div class="card"><div class="row"><div>
          <div class="title">🏗️ ${esc(productName(b.productId))}</div>
          <div class="meta">${esc(comps)}</div>
        </div><span class="badge info">${fmtMoney(bomCost(b))}</span></div>
        <div class="card-actions">
          <button data-produce="${b.id}">⚙️ تصنيع</button>
          <button data-bom-edit="${b.id}">✏️ تعديل</button>
          <button class="del" data-bom-del="${b.id}">🗑️</button>
        </div></div>`;
    });
    const orders = DB.list('mos').slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 15);
    if (orders.length) {
      html += `<div class="section-title">📋 أحدث أوامر التصنيع</div>`;
      orders.forEach(o => {
        html += `<div class="card"><div class="row"><div>
          <div class="title">${esc(o.ref)} • ${esc(productName(o.productId))}</div>
          <div class="meta">${fmtDate(o.date)} • تكلفة الوحدة: ${fmtMoney(o.unitCost)}</div>
        </div><span class="badge ok">${fmtQty(o.qty)}</span></div></div>`;
      });
    }
    return html;
  },

  /* ===== دليل الاستخدام ===== */
  guide() {
    const step = (n, t, d) => `<div class="card"><div class="row"><div>
      <div class="title">${n}. ${esc(t)}</div><div class="meta">${d}</div></div></div></div>`;
    return `
      <div class="section-title">🚀 البدء السريع</div>
      ${step(1, 'الإعدادات', 'حدّد اسم الشركة، العملة، نسبة الضريبة، والرقم الضريبي. أضِف المستخدمين وأدوارهم. يمكنك تحميل <b>بيانات تجريبية</b> للتجربة.')}
      ${step(2, 'جهات الاتصال والمنتجات', 'أضِف العملاء والموردين، ثم المنتجات بأسعار البيع والتكلفة والكمية ووحدة القياس.')}
      ${step(3, 'المشتريات', 'أنشئ أمر شراء ← <b>تأكيد</b> (يزيد المخزون ويحدّث التكلفة بالمتوسط المرجّح ويرحّل القيد) ← <b>تسجيل دفعة</b>.')}
      ${step(4, 'المبيعات / نقطة البيع', 'أنشئ أمر بيع أو استخدم <b>نقطة البيع</b> بالباركود. التأكيد يخصم المخزون ويرحّل الإيراد وتكلفة البضاعة، ثم سجّل الدفعة واطبع الفاتورة (مع <b>رمز ZATCA</b>).')}
      ${step(5, 'المحاسبة', 'كل العمليات تُرحَّل تلقائياً بقيد مزدوج. راجع ميزان المراجعة ودفتر الأستاذ وقائمة الدخل والميزانية، وسجّل قيوداً يدوية عند الحاجة، وأقفل الفترة دورياً.')}
      ${step(6, 'CRM والتصنيع والرواتب', 'تابع الفرص البيعية ومراحلها، عرّف قوائم مكوّنات التصنيع ونفّذ أوامر الإنتاج، وشغّل مسيّر الرواتب الشهري.')}
      ${step(7, 'التقارير والنسخ الاحتياطي', 'صفِّ التقارير بمدى تواريخ وصدّرها PDF/Excel. صدّر نسخة احتياطية (JSON) بانتظام من الإعدادات.')}
      <div class="section-title">💡 ملاحظات</div>
      <div class="card"><div class="meta">
        • كل البيانات محفوظة محلياً على جهازك فقط (لا خادم).<br>
        • المستندات المؤكدة لا تُعدَّل؛ ألغِها لعكس أثرها بالكامل.<br>
        • استخدم زر السمة 🌙 للتبديل بين الوضع الفاتح والداكن.
      </div></div>`;
  },

  /* ===== الخزينة ===== */
  treasury() {
    const cashB = bal => { const a = DB.get('accounts', Acct.id(bal)); return a ? Acct.balance(a) : 0; };
    let html = `<div class="stat-grid">
      <div class="stat-card" style="--c:#198754"><span class="ico">💵</span><div class="num">${fmtMoney(cashB('cash'))}</div><div class="lbl">رصيد الصندوق</div></div>
      <div class="stat-card" style="--c:#0d6efd"><span class="ico">🏦</span><div class="num">${fmtMoney(cashB('bank'))}</div><div class="lbl">رصيد البنك</div></div>
    </div>`;
    html += `<div class="acct-tabs">
      <button class="acct-tab ${App.treasTab === 'vouchers' ? 'active' : ''}" data-treastab="vouchers">السندات</button>
      <button class="acct-tab ${App.treasTab === 'reconcile' ? 'active' : ''}" data-treastab="reconcile">التسوية البنكية</button>
    </div>`;

    if (App.treasTab === 'reconcile') {
      const accs = DB.list('accounts').filter(a => a.role === 'cash' || a.role === 'bank');
      if (!App.recAcc || !DB.get('accounts', App.recAcc)) App.recAcc = (DB.get('accounts', Acct.id('bank')) || {}).id || '';
      const opts = accs.map(a => `<option value="${a.id}" ${a.id === App.recAcc ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
      html += `<div class="field"><label>الحساب</label><select id="recSel">${opts}</select></div>`;
      const acc = DB.get('accounts', App.recAcc);
      const rmap = DB.data.settings.reconciled || {};
      let book = num(acc ? acc.opening : 0), recon = num(acc ? acc.opening : 0);
      const entries = [];
      DB.list('journal').forEach(j => (j.lines || []).forEach(l => {
        if (l.accountId === App.recAcc) entries.push({ j, amt: num(l.debit) - num(l.credit) });
      }));
      entries.sort((a, b) => (a.j.date || '').localeCompare(b.j.date || ''));
      entries.forEach(e => { book += e.amt; if (rmap[e.j.id]) recon += e.amt; });
      html += `<div class="card report-table">
        ${reportRow('الرصيد الدفتري', fmtMoney(book))}
        ${reportRow('الرصيد المُسوّى', fmtMoney(recon))}
        ${reportRow('الفرق غير المُسوّى', fmtMoney(book - recon), true)}</div>`;
      if (!entries.length) html += emptyState('🏦', 'لا توجد حركات', 'لا حركات على هذا الحساب بعد.');
      entries.slice().reverse().forEach(e => {
        const done = !!rmap[e.j.id];
        html += `<div class="card"><div class="row"><div>
            <div class="title">${esc(e.j.ref)} ${done ? '<span class="badge ok">مُسوّى</span>' : ''}</div>
            <div class="meta">${fmtDate(e.j.date)} • ${esc(e.j.narration || '')}</div>
          </div><span class="badge ${e.amt >= 0 ? 'ok' : 'danger'}">${e.amt >= 0 ? '+' : ''}${fmtMoney(e.amt)}</span></div>
          <div class="card-actions"><button data-reconcile="${e.j.id}">${done ? '↩️ تراجع' : '✅ تسوية'}</button></div></div>`;
      });
      return html;
    }

    // تبويب السندات
    html += `<div class="card-actions" style="margin-top:0">
      <button data-voucher="receipt">📥 سند قبض</button>
      <button data-voucher="payment">📤 سند صرف</button>
      <button data-voucher="transfer">🔄 تحويل</button></div>`;
    const vs = DB.list('vouchers').slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (!vs.length) html += emptyState('🧾', 'لا توجد سندات', 'أنشئ سند قبض أو صرف أو تحويل.');
    vs.slice(0, 40).forEach(v => {
      const inn = v.type === 'receipt';
      const cls = inn ? 'ok' : v.type === 'transfer' ? 'info' : 'danger';
      let desc = v.type === 'transfer'
        ? `من ${v.fromRole === 'cash' ? 'الصندوق' : 'البنك'} إلى ${v.toRole === 'cash' ? 'الصندوق' : 'البنك'}`
        : `${esc((DB.get('accounts', v.counterAccount) || {}).name || '')} • ${v.method === 'cash' ? 'الصندوق' : 'البنك'}`;
      html += `<div class="card"><div class="row"><div>
          <div class="title">${esc(v.ref)} • ${esc(VOUCHER_LABEL[v.type])}</div>
          <div class="meta">${fmtDate(v.date)} • ${desc}${v.note ? ' • ' + esc(v.note) : ''}</div>
        </div><span class="badge ${cls}">${fmtMoney(v.amount)}</span></div>
        <div class="card-actions"><button class="del" data-voucher-del="${v.id}">🗑️ حذف</button></div></div>`;
    });
    return html;
  },

  /* ===== التقارير ===== */
  reports() {
    const from = App.repFrom, to = App.repTo;
    const sales = DB.list('sales').filter(d => (d.status === 'confirmed' || d.status === 'paid') && inRange(d.date, from, to));
    const purchases = DB.list('purchases').filter(d => (d.status === 'confirmed' || d.status === 'paid') && inRange(d.date, from, to));

    const salesTotal = sales.reduce((s, d) => s + toBase(docTotals(d).total, d), 0);
    const purchTotal = purchases.reduce((s, d) => s + toBase(docTotals(d).total, d), 0);
    const cogs = sales.reduce((s, d) => s + (d.lines || []).reduce((a, l) => {
      const p = DB.get('products', l.productId); return a + num(l.qty) * (p ? num(p.cost) : 0);
    }, 0), 0);

    let html = `<div class="card">
      <div class="date-range">
        <div class="field" style="margin:0"><label>من تاريخ</label><input id="repFrom" type="date" value="${esc(from)}" /></div>
        <div class="field" style="margin:0"><label>إلى تاريخ</label><input id="repTo" type="date" value="${esc(to)}" /></div>
      </div>
      <div class="card-actions" style="margin-top:8px">
        <button data-rep-preset="month">هذا الشهر</button>
        <button data-rep-preset="year">هذا العام</button>
        <button data-rep-preset="all">الكل</button>
      </div>
      ${(from || to) ? `<div class="muted-text" style="margin-top:6px">الفترة: ${esc(from || '—')} ← ${esc(to || '—')}</div>` : ''}
    </div>`;
    html += `<div class="card-actions" style="margin-top:0">
      <button data-export="report-pdf">🖨️ تصدير PDF</button>
      <button data-export="report-csv">⬇️ تصدير Excel</button>
    </div>`;
    html += `<div class="section-title">📊 قائمة الدخل المبسطة</div>`;
    html += `<div class="card report-table">
      ${reportRow('إجمالي المبيعات', fmtMoney(salesTotal))}
      ${reportRow('تكلفة البضاعة المباعة', '(' + fmtMoney(cogs) + ')')}
      ${reportRow('مجمل الربح', fmtMoney(salesTotal - cogs), true)}
      ${reportRow('إجمالي المشتريات', fmtMoney(purchTotal))}
      ${reportRow('صافي الربح التقديري', fmtMoney(salesTotal - purchTotal), true)}
    </div>`;

    /* مخطط المبيعات مقابل المشتريات (آخر 6 أشهر) */
    const sSeries = monthlySeries(sales);
    const pSeries = monthlySeries(purchases);
    const combined = sSeries.map((s, i) => ({ label: s.label, a: s.value, b: pSeries[i].value }));
    if (combined.some(c => c.a || c.b)) {
      html += `<div class="section-title">📊 المبيعات مقابل المشتريات</div>`;
      html += groupedBar(combined, 'مبيعات', 'مشتريات', '#198754', '#d63384');
    }

    /* تطور صافي الربح الشهري */
    const profitSeries = combined.map(c => ({ label: c.label, value: Math.round(c.a - c.b) }));
    if (profitSeries.some(p => p.value)) {
      html += `<div class="section-title">📈 صافي الربح الشهري</div>`;
      html += barChart(profitSeries.map(p => ({ label: p.label, value: Math.max(0, p.value) })));
    }

    /* توزيع المصروفات (ضمن المدى) */
    const expItems = DB.list('accounts').filter(a => a.type === 'expense')
      .map(a => ({ label: a.name, value: +accountRangeBalance(a, from, to).toFixed(2) }))
      .filter(i => i.value > 0.005).sort((a, b) => b.value - a.value);
    if (expItems.length) {
      html += `<div class="section-title">💸 توزيع المصروفات</div>`;
      html += hbar(expItems, '#dc3545');
    }

    /* أفضل العملاء */
    const custMap = {};
    sales.forEach(d => { custMap[d.partnerId] = (custMap[d.partnerId] || 0) + toBase(docTotals(d).total, d); });
    const topCust = Object.entries(custMap).map(([id, v]) => ({ label: partnerName(id), value: +v.toFixed(2) }))
      .sort((a, b) => b.value - a.value).slice(0, 6);
    if (topCust.length) {
      html += `<div class="section-title">👤 أفضل العملاء</div>`;
      html += hbar(topCust, '#0d6efd');
    }

    /* أفضل المنتجات مبيعاً */
    const prodMap = {};
    sales.forEach(d => (d.lines || []).forEach(l => {
      prodMap[l.productId] = prodMap[l.productId] || { qty: 0, total: 0 };
      prodMap[l.productId].qty += num(l.qty);
      prodMap[l.productId].total += toBase(num(l.qty) * num(l.price), d);
    }));
    const top = Object.entries(prodMap).map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.total - a.total).slice(0, 8);

    html += `<div class="section-title">🏆 أفضل المنتجات مبيعاً</div>`;
    if (!top.length) html += emptyState('🏆', 'لا توجد مبيعات بعد', 'أكّد بعض أوامر البيع لتظهر التقارير.');
    top.forEach((t, i) => {
      html += `<div class="card"><div class="row"><div>
        <div class="title">${i + 1}. ${esc(productName(t.id))}</div>
        <div class="meta">الكمية المباعة: <b>${fmtQty(t.qty)}</b></div>
      </div><span class="badge ok">${fmtMoney(t.total)}</span></div></div>`;
    });

    /* أرصدة جهات الاتصال */
    html += `<div class="section-title">👥 أرصدة العملاء (ذمم مدينة)</div>`;
    const balances = {};
    sales.forEach(d => { const t = docTotals(d); if (t.due > 0.001) balances[d.partnerId] = (balances[d.partnerId] || 0) + toBase(t.due, d); });
    const balRows = Object.entries(balances).sort((a, b) => b[1] - a[1]);
    if (!balRows.length) html += emptyState('✅', 'لا توجد ذمم مدينة', 'كل الفواتير محصّلة.');
    balRows.forEach(([pid, due]) => {
      html += `<div class="card"><div class="row">
        <div class="title">${esc(partnerName(pid))}</div>
        <span class="badge danger">${fmtMoney(due)}</span></div></div>`;
    });
    return html;
  },

  /* ===== الإعدادات ===== */
  settings() {
    const s = DB.data.settings;
    const labels = { partners: 'جهات الاتصال', products: 'المنتجات', sales: 'المبيعات', purchases: 'المشتريات', returns: 'المرتجعات', vouchers: 'سندات الخزينة', posSessions: 'ورديات البيع', leads: 'الفرص', boms: 'قوائم التصنيع', mos: 'أوامر التصنيع', employees: 'الموظفون', leaves: 'الإجازات', payslips: 'قسائم الرواتب', payments: 'المدفوعات', moves: 'حركات المخزون', accounts: 'الحسابات', journal: 'قيود اليومية' };
    const counts = Object.keys(labels)
      .map(c => `<li>${esc(labels[c])}: <b>${DB.list(c).length}</b></li>`).join('');
    return `
      <div class="section-title">🏢 بيانات الشركة</div>
      <form id="settingsForm" class="card">
        <div class="field"><label>اسم الشركة</label><input name="company" value="${esc(s.company)}" /></div>
        <div class="field"><label>الرقم الضريبي (للفاتورة الإلكترونية)</label><input name="vatNo" value="${esc(s.vatNo || '')}" inputmode="numeric" /></div>
        <div class="field"><label>رمز العملة</label><input name="currency" value="${esc(s.currency)}" /></div>
        <div class="field"><label>نسبة الضريبة (%)</label><input name="taxRate" type="number" min="0" value="${esc(s.taxRate)}" /></div>
        <button type="submit" class="btn-primary">حفظ الإعدادات</button>
      </form>

      <div class="section-title">💾 البيانات</div>
      <div class="card">
        <div class="card-actions" style="margin-top:0">
          <button data-action="export">⬇️ تصدير نسخة</button>
          <button data-action="import">⬆️ استيراد نسخة</button>
        </div>
        <div class="card-actions">
          <button data-action="demo">🧪 تحميل بيانات تجريبية</button>
          <button class="del" data-action="reset">🗑️ تصفير كل البيانات</button>
        </div>
        <div class="divider"></div>
        <div class="meta"><b>محتوى قاعدة البيانات:</b><ul class="counts">${counts}</ul></div>
      </div>

      <div class="section-title">💱 العملات وأسعار الصرف</div>
      <div class="card">
        ${currencies().map(c => `<div class="rep-row">
          <span><b>${esc(c.code === 'BASE' ? 'الأساسية' : c.code)}</b> — ${esc(c.symbol)} ${c.code === 'BASE' ? '' : `<span class="muted-text">(${c.rate})</span>`}</span>
          <span>${c.code === 'BASE'
            ? '<span class="badge muted">أساسية</span>'
            : `<button class="mini-btn" data-cur-edit="${esc(c.code)}">تعديل</button> <button class="del" data-cur-del="${esc(c.code)}" style="border:none;background:none;cursor:pointer">🗑️</button>`}</span>
        </div>`).join('')}
        <button class="mini-btn" id="addCurBtn" style="margin-top:10px">＋ إضافة عملة</button>
      </div>

      <div class="section-title">🏬 المخازن</div>
      <div class="card">
        ${(s.warehouses || []).map((w, i) => `<div class="rep-row">
          <span><b>${esc(w.name)}</b>${i === 0 ? ' <span class="badge muted">رئيسي</span>' : ''}</span>
          <span>${i === 0 ? '' : `<button class="del" data-wh-del="${w.id}" style="border:none;background:none;cursor:pointer">🗑️</button>`}</span>
        </div>`).join('')}
        <button class="mini-btn" id="addWhBtn" style="margin-top:10px">＋ إضافة مخزن</button>
      </div>

      <div class="section-title">👤 المستخدمون والصلاحيات</div>
      <div class="card">
        ${Auth.users().map(u => `<div class="rep-row">
          <span><b>${esc(u.name)}</b> <span class="muted-text">${esc(ROLES[u.role] || '')}</span>${Auth.hasPin(u) ? ' 🔒' : ''}</span>
          <span><button class="mini-btn" data-user-edit="${u.id}">تعديل</button>
          ${Auth.users().length > 1 ? `<button class="del" data-user-del="${u.id}" style="border:none;background:none;cursor:pointer">🗑️</button>` : ''}</span>
        </div>`).join('')}
        <button class="mini-btn" id="addUserBtn" style="margin-top:10px">＋ إضافة مستخدم</button>
      </div>

      <div class="section-title">ℹ️ عن النظام</div>
      <div class="card"><div class="meta">
        <b>MOS ERP</b> — نظام تخطيط موارد المؤسسات.<br>
        يعمل دون اتصال بالإنترنت ويحفظ بياناتك على جهازك فقط (لا تُرسل لأي خادم).<br>
        استخدم زر «تصدير نسخة» بانتظام لحماية بياناتك.
      </div></div>`;
  },
};

/* ---------------------------------------------------------------------
   8ب) عروض المحاسبة الفرعية
   --------------------------------------------------------------------- */
function byCode(a, b) { return String(a.code).localeCompare(String(b.code), 'en'); }

const AcctViews = {
  /* شجرة الحسابات */
  accounts() {
    const accs = DB.list('accounts').slice().sort(byCode);
    let html = searchBar('ابحث في الحسابات...');
    if (!accs.length) return html + emptyState('🧮', 'لا توجد حسابات', 'اضغط «＋» لإضافة حساب.');
    const filtered = filterBySearch(accs, ['code', 'name']);
    Object.keys(ACCOUNT_TYPES).forEach(type => {
      const group = filtered.filter(a => a.type === type);
      if (!group.length) return;
      const total = group.reduce((s, a) => s + Acct.balance(a), 0);
      html += `<div class="section-title">${esc(ACCOUNT_TYPES[type])} <span class="muted-text">(${fmtMoney(total)})</span></div>`;
      group.forEach(a => {
        const bal = Acct.balance(a);
        html += `<div class="card"><div class="row"><div>
            <div class="title">${esc(a.code)} — ${esc(a.name)}</div>
            <div class="meta">${esc(ACCOUNT_TYPES[a.type])}${a.role ? ' • حساب نظامي' : ''}</div>
          </div><span class="badge ${bal < 0 ? 'danger' : 'info'}">${fmtMoney(bal)}</span></div>
          <div class="card-actions">
            <button data-edit="accounts:${a.id}">✏️ تعديل</button>
            ${a.role ? '' : `<button class="del" data-del="accounts:${a.id}">🗑️ حذف</button>`}
          </div></div>`;
      });
    });
    return html;
  },

  /* قيود اليومية */
  journal() {
    const entries = DB.list('journal').slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    let html = `<div class="muted-text" style="margin-bottom:10px">إجمالي القيود: <b>${entries.length}</b> — تُرحَّل قيود المبيعات/المشتريات/المدفوعات تلقائياً.</div>`;
    if (!entries.length) return html + emptyState('📒', 'لا توجد قيود', 'اضغط «＋» لإضافة قيد يدوي.');
    entries.slice(0, 60).forEach(j => {
      const dr = (j.lines || []).reduce((s, l) => s + num(l.debit), 0);
      const srcLbl = { manual: 'يدوي', sales: 'مبيعات', purchases: 'مشتريات', payment: 'دفعة' }[j.source] || j.source;
      const linesHtml = (j.lines || []).map(l => {
        const a = DB.get('accounts', l.accountId);
        const nm = a ? `${a.code} ${a.name}` : '—';
        return `<div class="je-line"><span>${esc(nm)}</span>
          <span class="je-dr">${num(l.debit) ? fmtMoney(l.debit) : ''}</span>
          <span class="je-cr">${num(l.credit) ? fmtMoney(l.credit) : ''}</span></div>`;
      }).join('');
      html += `<div class="card"><div class="row"><div>
          <div class="title">${esc(j.ref)} <span class="badge muted">${esc(srcLbl)}</span></div>
          <div class="meta">${fmtDate(j.date)} • ${esc(j.narration || '')}</div>
        </div><div class="title">${fmtMoney(dr)}</div></div>
        <div class="je-lines"><div class="je-line je-head"><span>الحساب</span><span>مدين</span><span>دائن</span></div>${linesHtml}</div>
        ${j.source === 'manual' ? `<div class="card-actions">
          <button data-je-edit="${j.id}">✏️ تعديل</button>
          <button class="del" data-je-del="${j.id}">🗑️ حذف</button></div>` : ''}
      </div>`;
    });
    return html;
  },

  /* ميزان المراجعة */
  trial() {
    const accs = DB.list('accounts').slice().sort(byCode);
    let totalDr = 0, totalCr = 0, rows = '';
    accs.forEach(a => {
      const bal = Acct.balance(a);
      const debitNormal = !!DEBIT_NORMAL[a.type];
      let dr = 0, cr = 0;
      if (debitNormal) { if (bal >= 0) dr = bal; else cr = -bal; }
      else { if (bal >= 0) cr = bal; else dr = -bal; }
      if (Math.abs(dr) < 0.005 && Math.abs(cr) < 0.005) return;
      totalDr += dr; totalCr += cr;
      rows += `<tr><td>${esc(a.code)}</td><td>${esc(a.name)}</td>
        <td>${dr ? fmtMoney(dr) : '—'}</td><td>${cr ? fmtMoney(cr) : '—'}</td></tr>`;
    });
    const balanced = Math.abs(totalDr - totalCr) < 0.01;
    if (!rows) return emptyState('⚖️', 'لا توجد أرصدة', 'لم تُرحَّل أي قيود بعد.');
    return `<div class="card-actions" style="margin-top:0"><button data-export="trial-csv">⬇️ تصدير Excel</button></div>
    <div class="card acct-table-wrap"><table class="acct-table">
      <thead><tr><th>الرمز</th><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="2">الإجمالي</td><td>${fmtMoney(totalDr)}</td><td>${fmtMoney(totalCr)}</td></tr></tfoot>
    </table></div>
    <div class="card ${balanced ? 'warn-card' : 'warn-card'}" style="${balanced ? 'background:#e9f7ef;border-color:#bfe3cd;color:#1e7e4d' : ''}">
      ${balanced ? '✅ الميزان متوازن (مدين = دائن).' : '⚠️ الميزان غير متوازن — راجع القيود اليدوية.'}
    </div>`;
  },

  /* دفتر الأستاذ */
  ledger() {
    const accs = DB.list('accounts').slice().sort(byCode);
    if (!accs.length) return emptyState('📕', 'لا توجد حسابات', 'أضِف حسابات أولاً.');
    if (!App.ledgerAcc || !DB.get('accounts', App.ledgerAcc)) App.ledgerAcc = accs[0].id;
    const opts = accs.map(a => `<option value="${a.id}" ${a.id === App.ledgerAcc ? 'selected' : ''}>${esc(a.code)} — ${esc(a.name)}</option>`).join('');
    let html = `<div class="field"><label>اختر الحساب</label><select id="ledgerSel">${opts}</select></div>`;

    const acc = DB.get('accounts', App.ledgerAcc);
    const debitNormal = !!DEBIT_NORMAL[acc.type];
    // جمع كل أسطر القيود لهذا الحساب مرتبة بالتاريخ
    const entries = [];
    DB.list('journal').forEach(j => (j.lines || []).forEach(l => {
      if (l.accountId === acc.id) entries.push({ date: j.date, ref: j.ref, narration: j.narration, debit: num(l.debit), credit: num(l.credit), createdAt: j.createdAt });
    }));
    entries.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));

    let running = num(acc.opening);
    let rows = `<tr><td colspan="4">رصيد افتتاحي</td><td>${fmtMoney(running)}</td></tr>`;
    entries.forEach(e => {
      running += debitNormal ? (e.debit - e.credit) : (e.credit - e.debit);
      rows += `<tr><td>${fmtDate(e.date)}</td><td>${esc(e.ref)}</td>
        <td>${e.debit ? fmtMoney(e.debit) : '—'}</td><td>${e.credit ? fmtMoney(e.credit) : '—'}</td>
        <td>${fmtMoney(running)}</td></tr>`;
    });
    html += `<div class="card acct-table-wrap"><table class="acct-table">
      <thead><tr><th>التاريخ</th><th>المرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <div class="card report-table">${reportRow('الرصيد الحالي', fmtMoney(running), true)}</div>`;
    return html;
  },

  /* قائمة الدخل */
  pl() {
    const incomeAccs = DB.list('accounts').filter(a => a.type === 'income').sort(byCode);
    const expenseAccs = DB.list('accounts').filter(a => a.type === 'expense').sort(byCode);
    const incTotal = Acct.sumType('income');
    const expTotal = Acct.sumType('expense');
    const net = incTotal - expTotal;
    const rowsOf = list => list.map(a => {
      const b = Acct.balance(a);
      if (Math.abs(b) < 0.005) return '';
      return reportRow(a.name, fmtMoney(b));
    }).join('');
    return `<div class="section-title">الإيرادات</div>
      <div class="card report-table">${rowsOf(incomeAccs) || reportRow('—', fmtMoney(0))}${reportRow('إجمالي الإيرادات', fmtMoney(incTotal), true)}</div>
      <div class="section-title">المصروفات</div>
      <div class="card report-table">${rowsOf(expenseAccs) || reportRow('—', fmtMoney(0))}${reportRow('إجمالي المصروفات', fmtMoney(expTotal), true)}</div>
      <div class="card report-table" style="border:2px solid var(--primary)">
        ${reportRow(net >= 0 ? 'صافي الربح' : 'صافي الخسارة', fmtMoney(Math.abs(net)), true)}</div>`;
  },

  /* الميزانية العمومية */
  bs() {
    const assets = Acct.sumType('asset');
    const liabilities = Acct.sumType('liability');
    const equity = Acct.sumType('equity');
    const net = Acct.netProfit();
    const equityWithProfit = equity + net;
    const rhs = liabilities + equityWithProfit;
    const accRows = type => DB.list('accounts').filter(a => a.type === type).sort(byCode)
      .map(a => { const b = Acct.balance(a); return Math.abs(b) < 0.005 ? '' : reportRow(a.name, fmtMoney(b)); }).join('');
    const balanced = Math.abs(assets - rhs) < 0.01;
    return `<div class="section-title">الأصول</div>
      <div class="card report-table">${accRows('asset') || reportRow('—', fmtMoney(0))}${reportRow('إجمالي الأصول', fmtMoney(assets), true)}</div>
      <div class="section-title">الالتزامات</div>
      <div class="card report-table">${accRows('liability') || reportRow('—', fmtMoney(0))}${reportRow('إجمالي الالتزامات', fmtMoney(liabilities), true)}</div>
      <div class="section-title">حقوق الملكية</div>
      <div class="card report-table">${accRows('equity')}${reportRow('صافي ربح الفترة', fmtMoney(net))}${reportRow('إجمالي حقوق الملكية', fmtMoney(equityWithProfit), true)}</div>
      <div class="card report-table" style="border:2px solid var(--primary)">
        ${reportRow('الأصول', fmtMoney(assets))}
        ${reportRow('الالتزامات + حقوق الملكية', fmtMoney(rhs))}
      </div>
      <div class="card warn-card" style="${balanced ? 'background:#e9f7ef;border-color:#bfe3cd;color:#1e7e4d' : ''}">
        ${balanced ? '✅ الميزانية متوازنة.' : '⚠️ غير متوازنة — تحقق من الأرصدة الافتتاحية والقيود اليدوية.'}</div>`;
  },

  /* تقرير ضريبة القيمة المضافة (إقرار VAT) */
  vat() {
    const from = App.vatFrom, to = App.vatTo;
    const out = accountRangeBalance(DB.get('accounts', Acct.id('vatOut')), from, to);  // ضريبة المخرجات (مستحقة)
    const inp = accountRangeBalance(DB.get('accounts', Acct.id('vatIn')), from, to);    // ضريبة المدخلات (قابلة للخصم)
    const net = out - inp;
    return `
      <div class="card">
        <div class="date-range">
          <div class="field" style="margin:0"><label>من تاريخ</label><input id="vatFrom" type="date" value="${esc(from)}" /></div>
          <div class="field" style="margin:0"><label>إلى تاريخ</label><input id="vatTo" type="date" value="${esc(to)}" /></div>
        </div>
        <div class="card-actions" style="margin-top:8px">
          <button data-vat-preset="month">هذا الشهر</button>
          <button data-vat-preset="quarter">هذا الربع</button>
          <button data-vat-preset="year">هذا العام</button>
        </div>
      </div>
      <div class="section-title">📋 إقرار ضريبة القيمة المضافة</div>
      <div class="card report-table">
        ${reportRow('ضريبة المخرجات (على المبيعات)', fmtMoney(out))}
        ${reportRow('ضريبة المدخلات (على المشتريات)', '(' + fmtMoney(inp) + ')')}
        ${reportRow(net >= 0 ? 'صافي الضريبة المستحقة للدفع' : 'صافي ضريبة قابلة للاسترداد', fmtMoney(Math.abs(net)), true)}
      </div>
      <div class="card warn-card" style="${net >= 0 ? '' : 'background:#e9f7ef;border-color:#bfe3cd;color:#1e7e4d'}">
        ${net >= 0 ? `💰 يجب سداد <b>${fmtMoney(net)}</b> للجهة الضريبية عن هذه الفترة.` : `↩️ لديك رصيد ضريبي قابل للاسترداد بقيمة <b>${fmtMoney(-net)}</b>.`}
      </div>`;
  },

  /* إقفال الفترة المالية */
  close() {
    const lock = DB.data.settings.lockDate;
    const net = Acct.netProfit();
    return `
      <div class="section-title">🔒 قفل الفترة</div>
      <div class="card">
        <div class="meta">يمنع القفل أي تعديل (تأكيد/إلغاء/دفع/قيد) بتاريخ يسبق أو يساوي التاريخ المحدد.</div>
        <div class="rep-row strong" style="margin-top:8px"><span>تاريخ الإقفال الحالي</span>
          <span>${lock ? esc(lock) : 'غير مقفل'}</span></div>
        <form id="lockForm">
          <div class="field" style="margin-top:12px"><label>قفل حتى تاريخ</label>
            <input name="lockDate" type="date" value="${esc(lock || '')}" /></div>
          <div class="card-actions" style="margin-top:0">
            <button type="submit" class="mini-btn">🔒 تطبيق القفل</button>
            ${lock ? `<button type="button" class="del" id="unlockBtn">🔓 فتح القفل</button>` : ''}
          </div>
        </form>
      </div>

      <div class="section-title">📕 قيد الإقفال السنوي</div>
      <div class="card">
        <div class="meta">يصفّر حسابات الإيرادات والمصروفات ويرحّل النتيجة إلى «الأرباح المحتجزة»، ثم يقفل الفترة حتى التاريخ المحدد.</div>
        <div class="rep-row strong" style="margin-top:8px">
          <span>${net >= 0 ? 'صافي ربح الفترة' : 'صافي خسارة الفترة'}</span>
          <span>${fmtMoney(Math.abs(net))}</span></div>
        <form id="closeForm">
          <div class="field" style="margin-top:12px"><label>تاريخ الإقفال</label>
            <input name="closeDate" type="date" value="${todayISO()}" required /></div>
          <button type="submit" class="btn-primary">تنفيذ قيد الإقفال وقفل الفترة</button>
        </form>
      </div>`;
  },
};

/* ---------------------------------------------------------------------
   9) مكوّنات العرض القابلة لإعادة الاستخدام
   --------------------------------------------------------------------- */
function modelList(coll) {
  const M = Models[coll];
  const items = filterBySearch(DB.list(coll), M.searchFields);
  let html = searchBar(`ابحث في ${M.plural}...`);
  if (coll === 'partners' || coll === 'products') {
    html += `<div class="card-actions" style="margin-top:0">
      <button data-csv-export="${coll}">⬇️ تصدير CSV</button>
      <button data-csv-import="${coll}">⬆️ استيراد CSV</button></div>`;
  }
  if (!items.length) return html + emptyState(M.icon, `لا توجد ${M.plural}`, 'اضغط زر «＋» للإضافة.');
  items.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach(r => {
    const b = M.badge ? M.badge(r) : null;
    html += `<div class="card"><div class="row"><div>
        <div class="title">${esc(M.title(r))}</div>
        <div class="meta">${esc(M.subtitle(r))}</div>
      </div>${b ? `<span class="badge ${b.cls}">${esc(b.text)}</span>` : ''}</div>
      <div class="card-actions">
        ${M.rowActions ? M.rowActions(r) : ''}
        <button data-edit="${coll}:${r.id}">✏️ تعديل</button>
        <button class="del" data-del="${coll}:${r.id}">🗑️ حذف</button>
      </div></div>`;
  });
  return html;
}

function docList(coll) {
  const isSale = coll === 'sales';
  const ico = isSale ? '🧾' : '🛒';
  const label = isSale ? 'أمر بيع' : 'أمر شراء';
  let list = DB.list(coll).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const items = filterBySearch(list, ['ref', 'note'], d => partnerName(d.partnerId));
  let html = searchBar(`ابحث في ${isSale ? 'المبيعات' : 'المشتريات'}...`);
  if (!DB.list('partners').length || !DB.list('products').length)
    html += `<div class="card warn-card">⚠️ يلزم وجود جهة اتصال ومنتج واحد على الأقل لإنشاء ${label}.</div>`;
  if (!items.length) return html + emptyState(ico, `لا توجد ${isSale ? 'مبيعات' : 'مشتريات'}`, `اضغط «＋» لإنشاء ${label}.`);
  items.forEach(d => { html += docCard(coll, d); });
  return html;
}

function docCard(coll, d) {
  const t = docTotals(d);
  const st = { draft: 'muted', confirmed: 'info', paid: 'ok', cancel: 'danger' }[d.status] || 'muted';
  const isSale = coll === 'sales';
  const partyLabel = isSale ? 'العميل' : 'المورد';
  const linesHtml = (d.lines || []).map(l =>
    `<div class="line-row"><span>${esc(productName(l.productId))} × ${fmtQty(l.qty)}</span><span>${fmtDoc(num(l.qty) * num(l.price), d)}</span></div>`
  ).join('');
  const curTag = docCurCode(d) !== 'BASE' ? ` <span class="badge muted">${esc(docCurCode(d))}</span>` : '';
  let actions = '';
  if (d.status === 'draft') {
    actions = `<button data-confirm="${coll}:${d.id}">✅ تأكيد</button>
      <button data-edit="${coll}:${d.id}">✏️ تعديل</button>
      <button class="del" data-del="${coll}:${d.id}">🗑️</button>`;
  } else if (d.status === 'confirmed' || d.status === 'paid') {
    if (t.due > 0.001) actions += `<button data-pay="${coll}:${d.id}">💵 تسجيل دفعة</button>`;
    actions += `<button data-print="${coll}:${d.id}">🖨️ طباعة</button>`;
    if (!d.returned) actions += `<button data-return="${coll}:${d.id}">↩️ مرتجع</button>`;
    if (d.status !== 'paid') actions += `<button class="del" data-cancel="${coll}:${d.id}">✖️ إلغاء</button>`;
  } else {
    actions = `<button class="del" data-del="${coll}:${d.id}">🗑️ حذف</button>`;
  }
  return `<div class="card"><div class="row"><div>
      <div class="title">${esc(d.ref || '—')} • ${esc(partnerName(d.partnerId))}${curTag}</div>
      <div class="meta">${partyLabel} • ${fmtDate(d.date)} • ${(d.lines || []).length} بند</div>
    </div><div style="text-align:left">
      <span class="badge ${st}">${esc(DOC_STATUS[d.status] || d.status)}</span>
      ${d.returned ? '<span class="badge danger">مُرتجع</span>' : ''}
      <div class="title" style="margin-top:6px">${fmtDoc(t.total, d)}</div>
      ${t.due > 0.001 && d.status !== 'draft' && d.status !== 'cancel' ? `<div class="meta">المتبقي: <b>${fmtDoc(t.due, d)}</b></div>` : ''}
    </div></div>
    ${linesHtml ? `<div class="lines">${linesHtml}</div>` : ''}
    ${d.note ? `<div class="meta">📝 ${esc(d.note)}</div>` : ''}
    <div class="card-actions">${actions}</div></div>`;
}

function docCardMini(coll, d) {
  const t = docTotals(d);
  const st = { draft: 'muted', confirmed: 'info', paid: 'ok', cancel: 'danger' }[d.status] || 'muted';
  return `<div class="card" data-go="sales"><div class="row"><div>
    <div class="title">${esc(d.ref || '—')} • ${esc(partnerName(d.partnerId))}</div>
    <div class="meta">${fmtDate(d.date)}</div></div>
    <div style="text-align:left"><span class="badge ${st}">${esc(DOC_STATUS[d.status])}</span>
    <div class="title" style="margin-top:4px">${fmtDoc(t.total, d)}</div></div></div></div>`;
}

function invoiceRow(coll, d) {
  const t = docTotals(d);
  const isSale = coll === 'sales';
  return `<div class="card"><div class="row"><div>
    <div class="title">${esc(d.ref)} • ${esc(partnerName(d.partnerId))}</div>
    <div class="meta">الإجمالي: ${fmtDoc(t.total, d)} • مدفوع: ${fmtDoc(t.paid, d)}</div>
  </div><span class="badge ${isSale ? 'warn' : 'danger'}">متبقٍ ${fmtDoc(t.due, d)}</span></div>
  <div class="card-actions"><button data-pay="${coll}:${d.id}">💵 تسجيل دفعة</button>
    <button data-print="${coll}:${d.id}">🖨️ طباعة</button></div></div>`;
}

function reportRow(label, value, strong) {
  return `<div class="rep-row ${strong ? 'strong' : ''}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
}

/* مخطط أعمدة بسيط (SVG) */
function barChart(series) {
  const max = Math.max(1, ...series.map(s => s.value));
  const bars = series.map(s => {
    const h = Math.round((s.value / max) * 100);
    return `<div class="bar-col">
      <div class="bar-val">${s.value ? shortMoney(s.value) : ''}</div>
      <div class="bar" style="height:${Math.max(h, 2)}%"></div>
      <div class="bar-lbl">${esc(s.label)}</div></div>`;
  }).join('');
  return `<div class="card"><div class="bar-chart">${bars}</div></div>`;
}

function shortMoney(v) {
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'م';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'ك';
  return Math.round(v);
}

/* مخطط أعمدة مزدوج (سلسلتان) */
function groupedBar(series, labelA, labelB, colorA, colorB) {
  const max = Math.max(1, ...series.map(s => Math.max(s.a, s.b)));
  const cols = series.map(s => `<div class="bar-col">
      <div class="bar-pair">
        <div class="bar" style="height:${Math.max((s.a / max) * 100, 2)}%;background:${colorA}"></div>
        <div class="bar" style="height:${Math.max((s.b / max) * 100, 2)}%;background:${colorB}"></div>
      </div><div class="bar-lbl">${esc(s.label)}</div></div>`).join('');
  return `<div class="card">
    <div class="chart-legend"><span><i style="background:${colorA}"></i>${esc(labelA)}</span><span><i style="background:${colorB}"></i>${esc(labelB)}</span></div>
    <div class="bar-chart">${cols}</div></div>`;
}

/* أشرطة أفقية (نِسَب) */
function hbar(items, color) {
  const max = Math.max(1, ...items.map(i => i.value));
  if (!items.length) return '';
  return `<div class="card">` + items.map(i => `
    <div class="hbar-row"><div class="hbar-lbl">${esc(i.label)}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max((i.value / max) * 100, 3)}%;background:${color || 'var(--primary)'}"></div></div>
      <div class="hbar-val">${fmtMoney(i.value)}</div></div>`).join('') + `</div>`;
}

function monthlySeries(docs) {
  const out = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString('ar-EG', { month: 'short' });
    let value = 0;
    docs.forEach(doc => { if ((doc.date || '').slice(0, 7) === key) value += toBase(docTotals(doc).total, doc); });
    out.push({ label, value: Math.round(value) });
  }
  return out;
}

/* ---------------------------------------------------------------------
   10) عناصر واجهة مساعدة
   --------------------------------------------------------------------- */
function searchBar(placeholder) {
  return `<input class="search" id="searchInput" type="search"
            placeholder="${esc(placeholder)}" value="${esc(App.search)}" />`;
}

function emptyState(ico, title, sub) {
  return `<div class="empty"><div class="big">${ico}</div>
            <p><b>${esc(title)}</b><br><span class="muted-text">${esc(sub)}</span></p></div>`;
}

function filterBySearch(arr, fields, extraFn) {
  const q = App.search.trim().toLowerCase();
  if (!q) return arr;
  return arr.filter(item => {
    const hay = (fields || []).map(f => item[f]).concat(extraFn ? [extraFn(item)] : []).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/* ---------------------------------------------------------------------
   11) النماذج (Forms)
   --------------------------------------------------------------------- */
function fieldHTML(f, item) {
  let val = item[f.name];
  if (val == null || val === '') {
    val = typeof f.default === 'function' ? f.default() : (f.default != null ? f.default : '');
  }
  const req = f.required ? 'required' : '';
  let input;
  if (f.type === 'select') {
    const opts = (f.options || []).map(o => {
      const v = typeof o === 'object' ? o.v : o;
      const l = typeof o === 'object' ? o.l : o;
      const sel = String(val) === String(v) ? 'selected' : '';
      return `<option value="${esc(v)}" ${sel}>${esc(l)}</option>`;
    }).join('');
    const ph = f.required ? `<option value="" disabled ${val ? '' : 'selected'}>— اختر —</option>` : '';
    input = `<select name="${f.name}" ${req}>${ph}${opts}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea name="${f.name}" ${req}>${esc(val)}</textarea>`;
  } else {
    const extra = f.type === 'number' ? 'inputmode="decimal" step="any"' : '';
    input = `<input name="${f.name}" type="${f.type}" value="${esc(val)}" ${req} ${extra} />`;
  }
  return `<div class="field"><label>${esc(f.label)}</label>${input}</div>`;
}

function modelForm(coll, item) {
  return Models[coll].fields.map(f => fieldHTML(f, item)).join('') +
    `<button type="submit" class="btn-primary">حفظ</button>`;
}

/* نموذج المستندات (مبيعات/مشتريات) مع محرّر البنود */
let lineDraft = [];

function docForm(coll, item) {
  const isSale = coll === 'sales';
  const partners = DB.list('partners')
    .filter(p => isSale ? (p.kind !== 'vendor') : (p.kind !== 'customer'))
    .map(p => ({ v: p.id, l: p.name }));
  const fallback = DB.list('partners').map(p => ({ v: p.id, l: p.name }));
  const pOpts = partners.length ? partners : fallback;

  lineDraft = (item.lines || []).map(l => ({ ...l }));

  let html = fieldHTML({ name: 'partnerId', label: (isSale ? 'العميل' : 'المورد') + ' *', type: 'select', required: true, options: pOpts }, item);
  html += fieldHTML({ name: 'date', label: 'التاريخ', type: 'date', default: () => todayISO() }, item);
  if (currencies().length > 1) {
    const curOpts = currencies().map(c => ({ v: c.code, l: c.code === 'BASE' ? `الأساسية (${c.symbol})` : `${c.code} (${c.symbol})` }));
    html += fieldHTML({ name: 'currency', label: 'العملة', type: 'select', options: curOpts, default: 'BASE' }, item);
    html += fieldHTML({ name: 'rate', label: 'سعر الصرف (مقابل الأساسية)', type: 'number', default: 1 }, item);
  }
  html += `<div class="lines-editor">
      <div class="lines-head"><span>البنود</span><button type="button" class="mini-btn" id="addLineBtn">＋ بند</button></div>
      <div id="lineList"></div>
      <div id="lineTotals" class="line-totals"></div>
    </div>`;
  html += fieldHTML({ name: 'note', label: 'ملاحظات', type: 'textarea' }, item);
  html += `<button type="submit" class="btn-primary">حفظ المستند</button>`;
  return html;
}

function renderLines() {
  const wrap = document.getElementById('lineList');
  if (!wrap) return;
  const prodOpts = DB.list('products');
  if (!lineDraft.length) {
    wrap.innerHTML = `<div class="muted-text" style="padding:8px 0">لا توجد بنود — اضغط «＋ بند».</div>`;
  } else {
    wrap.innerHTML = lineDraft.map((l, i) => {
      const opts = prodOpts.map(p => `<option value="${p.id}" ${l.productId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
      return `<div class="line-edit" data-i="${i}">
        <select class="ln-prod">${'<option value="">— منتج —</option>' + opts}</select>
        <input class="ln-qty" type="number" inputmode="decimal" step="any" min="0" value="${esc(l.qty)}" placeholder="كمية" />
        <input class="ln-price" type="number" inputmode="decimal" step="any" min="0" value="${esc(l.price)}" placeholder="سعر" />
        <button type="button" class="ln-del" data-i="${i}">✕</button>
      </div>`;
    }).join('');
  }
  // الإجماليات
  const taxRate = num(DB.data.settings.taxRate);
  let subtotal = 0;
  lineDraft.forEach(l => subtotal += num(l.qty) * num(l.price));
  const tax = subtotal * taxRate / 100;
  document.getElementById('lineTotals').innerHTML =
    `<div class="rep-row"><span>المجموع الفرعي</span><span>${fmtMoney(subtotal)}</span></div>
     <div class="rep-row"><span>الضريبة (${taxRate}%)</span><span>${fmtMoney(tax)}</span></div>
     <div class="rep-row strong"><span>الإجمالي</span><span>${fmtMoney(subtotal + tax)}</span></div>`;
  bindLineEvents();
}

function bindLineEvents() {
  document.querySelectorAll('.line-edit').forEach(row => {
    const i = +row.dataset.i;
    const prod = row.querySelector('.ln-prod');
    const qty = row.querySelector('.ln-qty');
    const price = row.querySelector('.ln-price');
    prod.onchange = () => {
      lineDraft[i].productId = prod.value;
      const p = DB.get('products', prod.value);
      if (p && !num(lineDraft[i].price)) { lineDraft[i].price = num(p.salePrice); renderLines(); }
      else lineDraft[i].name = p ? p.name : '';
    };
    qty.oninput = () => { lineDraft[i].qty = qty.value; updateTotalsOnly(); };
    price.oninput = () => { lineDraft[i].price = price.value; updateTotalsOnly(); };
  });
  document.querySelectorAll('.ln-del').forEach(b => {
    b.onclick = () => { lineDraft.splice(+b.dataset.i, 1); renderLines(); };
  });
}

function updateTotalsOnly() {
  const taxRate = num(DB.data.settings.taxRate);
  let subtotal = 0;
  lineDraft.forEach(l => subtotal += num(l.qty) * num(l.price));
  const tax = subtotal * taxRate / 100;
  const el = document.getElementById('lineTotals');
  if (el) el.innerHTML =
    `<div class="rep-row"><span>المجموع الفرعي</span><span>${fmtMoney(subtotal)}</span></div>
     <div class="rep-row"><span>الضريبة (${taxRate}%)</span><span>${fmtMoney(tax)}</span></div>
     <div class="rep-row strong"><span>الإجمالي</span><span>${fmtMoney(subtotal + tax)}</span></div>`;
}

/* ---------------------------------------------------------------------
   12) النافذة المنبثقة
   --------------------------------------------------------------------- */
let currentForm = { coll: null, id: null, kind: null };

function openForm(coll, id = null) {
  const isDoc = coll === 'sales' || coll === 'purchases';
  if (isDoc && (!DB.list('partners').length || !DB.list('products').length)) {
    toast('أضِف جهة اتصال ومنتجاً أولاً');
    return;
  }
  const item = id ? DB.get(coll, id) : {};
  if (id && isDoc && item.status !== 'draft') { toast('لا يمكن تعديل مستند مؤكد'); return; }

  const titles = {
    partners: id ? 'تعديل جهة اتصال' : 'جهة اتصال جديدة',
    products: id ? 'تعديل منتج' : 'منتج جديد',
    employees: id ? 'تعديل موظف' : 'موظف جديد',
    sales: id ? 'تعديل أمر بيع' : 'أمر بيع جديد',
    purchases: id ? 'تعديل أمر شراء' : 'أمر شراء جديد',
    accounts: id ? 'تعديل حساب' : 'حساب جديد',
    leads: id ? 'تعديل فرصة' : 'فرصة بيعية جديدة',
  };
  currentForm = { coll, id, kind: isDoc ? 'doc' : 'model' };
  document.getElementById('modalTitle').textContent = titles[coll] || 'نموذج';
  document.getElementById('modalForm').innerHTML = isDoc ? docForm(coll, item || {}) : modelForm(coll, item || {});
  document.getElementById('modal').classList.remove('hidden');
  if (isDoc) {
    renderLines();
    document.getElementById('addLineBtn').onclick = () => { lineDraft.push({ productId: '', qty: 1, price: 0 }); renderLines(); };
  }
}

function closeForm() {
  document.getElementById('modal').classList.add('hidden');
  currentForm = { coll: null, id: null, kind: null };
  lineDraft = [];
  jeDraft = [];
  jeEditId = null;
  bomDraft = [];
  bomEditId = null;
}

function submitForm(e) {
  e.preventDefault();
  const { coll, id, kind } = currentForm;
  if (!coll) return;
  const fd = new FormData(e.target);
  const obj = {};
  for (const [k, v] of fd.entries()) obj[k] = typeof v === 'string' ? v.trim() : v;
  if (id) obj.id = id;

  if (kind === 'payslip') {
    ['basic', 'allowances', 'deductions'].forEach(k => { obj[k] = num(obj[k]); });
    DB.upsert('payslips', obj);
    closeForm();
    toast('تم حفظ القسيمة ✅');
    App.render();
    return;
  }

  if (kind === 'doc') {
    obj.lines = lineDraft
      .filter(l => l.productId && num(l.qty) > 0)
      .map(l => ({ productId: l.productId, name: productName(l.productId), qty: num(l.qty), price: num(l.price) }));
    if (!obj.lines.length) { toast('أضِف بنداً واحداً على الأقل'); return; }
    obj.currency = obj.currency || 'BASE';
    obj.rate = obj.currency === 'BASE' ? 1 : (num(obj.rate) || 1);
    if (!id) {
      obj.status = 'draft';
      obj.paid = 0;
      obj.ref = DB.nextRef(coll === 'sales' ? 'SO' : 'PO');
    }
  } else {
    // تحويل الحقول الرقمية للنماذج العادية
    Models[coll].fields.forEach(f => {
      if (f.type === 'number' && obj[f.name] !== undefined && obj[f.name] !== '') obj[f.name] = num(obj[f.name]);
    });
  }

  DB.upsert(coll, obj);
  closeForm();
  toast(id ? 'تم التحديث ✅' : 'تمت الإضافة ✅');
  App.render();
}

/* ---------------------------------------------------------------------
   13) نوافذ منبثقة صغيرة (الدفع / التسوية / الحركات)
   --------------------------------------------------------------------- */
function openPayDialog(coll, id) {
  const doc = DB.get(coll, id);
  if (!doc) return;
  const t = docTotals(doc);
  currentForm = { coll, id, kind: 'pay' };
  document.getElementById('modalTitle').textContent = 'تسجيل دفعة — ' + (doc.ref || '');
  document.getElementById('modalForm').innerHTML = `
    <div class="card report-table" style="margin:0 0 12px">
      ${reportRow('الإجمالي', fmtDoc(t.total, doc))}
      ${reportRow('المدفوع', fmtDoc(t.paid, doc))}
      ${reportRow('المتبقي', fmtDoc(t.due, doc), true)}
      ${docCurCode(doc) !== 'BASE' ? reportRow('سعر الصرف', docRate(doc) + ' / ' + baseSymbol()) : ''}
    </div>
    <div class="field"><label>المبلغ (${esc(curSymbol(docCurCode(doc)))})</label><input name="amount" type="number" inputmode="decimal" step="any" min="0" value="${t.due}" required /></div>
    ${docCurCode(doc) !== 'BASE' ? `<div class="field"><label>سعر الصرف يوم الدفع (مقابل ${esc(baseSymbol())})</label>
      <input name="payRate" type="number" inputmode="decimal" step="any" min="0" value="${getCurrency(docCurCode(doc)).rate}" />
      <div class="muted-text" style="margin-top:4px">سعر الفاتورة: ${docRate(doc)} — أي فرق يُرحَّل لحساب فروقات الصرف.</div></div>` : ''}
    <div class="field"><label>طريقة الدفع</label><select name="method">${kv(PAY_METHOD).map(o => `<option value="${o.v}">${o.l}</option>`).join('')}</select></div>
    <button type="submit" class="btn-primary">تأكيد الدفعة</button>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modalForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    registerPayment(coll, id, fd.get('amount'), fd.get('method'), fd.get('payRate'));
    closeForm();
    document.getElementById('modalForm').onsubmit = submitForm;
    App.render();
  };
}

function openAdjustDialog(productId) {
  const isNew = productId === 'new';
  const prodOpts = DB.list('products').filter(p => p.type !== 'service');
  document.getElementById('modalTitle').textContent = 'تسوية مخزون';
  const sel = isNew
    ? `<div class="field"><label>المنتج</label><select name="productId" required><option value="">— اختر —</option>${prodOpts.map(p => `<option value="${p.id}">${esc(p.name)} (${fmtQty(p.qty)})</option>`).join('')}</select></div>`
    : `<input type="hidden" name="productId" value="${productId}" />`;
  document.getElementById('modalForm').innerHTML = sel + `
    <div class="field"><label>الكمية الفعلية الجديدة</label><input name="newQty" type="number" inputmode="decimal" step="any" required /></div>
    <div class="field"><label>السبب</label><input name="reason" placeholder="جرد / تالف / فرق..." /></div>
    <button type="submit" class="btn-primary">تطبيق التسوية</button>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modalForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const pid = fd.get('productId');
    const p = DB.get('products', pid);
    if (!p) { toast('اختر منتجاً'); return; }
    const newQty = num(fd.get('newQty'));
    const delta = newQty - num(p.qty);
    p.qty = newQty;
    DB.upsert('products', p);
    DB.upsert('moves', { date: todayISO(), productId: pid, qty: delta, type: 'adjust', ref: fd.get('reason') || 'تسوية', doc: 'adjust' });
    closeForm();
    document.getElementById('modalForm').onsubmit = submitForm;
    toast('تمت التسوية ✅');
    App.render();
  };
}

function openHistory(productId) {
  const moves = DB.list('moves').filter(m => m.productId === productId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  document.getElementById('modalTitle').textContent = 'حركات: ' + productName(productId);
  let body = moves.length ? moves.map(m => {
    const pos = num(m.qty) >= 0;
    const typeLbl = { in: 'وارد', out: 'صادر', adjust: 'تسوية' }[m.type] || m.type;
    return `<div class="card" style="margin-bottom:8px"><div class="row"><div>
      <div class="title">${typeLbl} ${m.ref ? '• ' + esc(m.ref) : ''}</div>
      <div class="meta">${fmtDate(m.date)}</div></div>
      <span class="badge ${pos ? 'ok' : 'danger'}">${pos ? '+' : ''}${fmtQty(m.qty)}</span></div></div>`;
  }).join('') : emptyState('📜', 'لا توجد حركات', 'لم تُسجَّل أي حركة لهذا المنتج بعد.');
  document.getElementById('modalForm').innerHTML = body + `<button type="button" class="btn-primary" id="closeHist">إغلاق</button>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('closeHist').onclick = closeForm;
}

/* محرّر القيود اليدوية */
let jeDraft = [];
let jeEditId = null;

function openJournalDialog(id = null) {
  if (!DB.list('accounts').length) { toast('أضِف حسابات أولاً'); return; }
  const entry = id ? DB.get('journal', id) : null;
  if (id && entry && entry.source !== 'manual') { toast('لا يمكن تعديل قيد تلقائي'); return; }
  jeEditId = id;
  jeDraft = entry ? (entry.lines || []).map(l => ({ ...l })) : [{ accountId: '', debit: 0, credit: 0 }, { accountId: '', debit: 0, credit: 0 }];
  document.getElementById('modalTitle').textContent = id ? 'تعديل قيد يومية' : 'قيد يومية جديد';
  document.getElementById('modalForm').innerHTML =
    fieldHTML({ name: 'date', label: 'التاريخ', type: 'date', default: () => todayISO() }, entry || {}) +
    fieldHTML({ name: 'narration', label: 'البيان', type: 'text' }, entry || {}) +
    `<div class="lines-editor">
      <div class="lines-head"><span>سطور القيد</span><button type="button" class="mini-btn" id="addJeBtn">＋ سطر</button></div>
      <div id="jeList"></div>
      <div id="jeTotals" class="line-totals"></div>
    </div>
    <button type="submit" class="btn-primary">حفظ القيد</button>`;
  document.getElementById('modal').classList.remove('hidden');
  renderJELines();
  document.getElementById('addJeBtn').onclick = () => { jeDraft.push({ accountId: '', debit: 0, credit: 0 }); renderJELines(); };
  document.getElementById('modalForm').onsubmit = submitJournal;
}

function renderJELines() {
  const wrap = document.getElementById('jeList');
  if (!wrap) return;
  const accs = DB.list('accounts').slice().sort(byCode);
  wrap.innerHTML = jeDraft.map((l, i) => {
    const opts = accs.map(a => `<option value="${a.id}" ${l.accountId === a.id ? 'selected' : ''}>${esc(a.code)} ${esc(a.name)}</option>`).join('');
    return `<div class="je-edit" data-i="${i}">
      <select class="je-acc"><option value="">— حساب —</option>${opts}</select>
      <input class="je-d" type="number" inputmode="decimal" step="any" min="0" value="${esc(l.debit || '')}" placeholder="مدين" />
      <input class="je-c" type="number" inputmode="decimal" step="any" min="0" value="${esc(l.credit || '')}" placeholder="دائن" />
      <button type="button" class="ln-del" data-i="${i}">✕</button>
    </div>`;
  }).join('');
  updateJETotals();
  document.querySelectorAll('.je-edit').forEach(row => {
    const i = +row.dataset.i;
    row.querySelector('.je-acc').onchange = e => { jeDraft[i].accountId = e.target.value; };
    row.querySelector('.je-d').oninput = e => { jeDraft[i].debit = e.target.value; if (num(e.target.value)) { jeDraft[i].credit = 0; } updateJETotals(); };
    row.querySelector('.je-c').oninput = e => { jeDraft[i].credit = e.target.value; if (num(e.target.value)) { jeDraft[i].debit = 0; } updateJETotals(); };
  });
  document.querySelectorAll('#jeList .ln-del').forEach(b => {
    b.onclick = () => { jeDraft.splice(+b.dataset.i, 1); renderJELines(); };
  });
}

function updateJETotals() {
  const dr = jeDraft.reduce((s, l) => s + num(l.debit), 0);
  const cr = jeDraft.reduce((s, l) => s + num(l.credit), 0);
  const ok = Math.abs(dr - cr) < 0.01 && dr > 0;
  const el = document.getElementById('jeTotals');
  if (el) el.innerHTML =
    `<div class="rep-row"><span>إجمالي المدين</span><span>${fmtMoney(dr)}</span></div>
     <div class="rep-row"><span>إجمالي الدائن</span><span>${fmtMoney(cr)}</span></div>
     <div class="rep-row strong" style="color:${ok ? 'var(--ok)' : 'var(--danger)'}">
       <span>${ok ? '✅ متوازن' : '⚠️ الفرق'}</span><span>${fmtMoney(Math.abs(dr - cr))}</span></div>`;
}

function submitJournal(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const lines = jeDraft
    .filter(l => l.accountId && (num(l.debit) || num(l.credit)))
    .map(l => ({ accountId: l.accountId, debit: num(l.debit), credit: num(l.credit) }));
  const dr = lines.reduce((s, l) => s + num(l.debit), 0);
  const cr = lines.reduce((s, l) => s + num(l.credit), 0);
  if (lines.length < 2 || Math.abs(dr - cr) > 0.01 || dr <= 0) {
    toast('القيد غير متوازن أو ناقص');
    return;
  }
  if (lockedToast(fd.get('date'))) return;
  if (jeEditId) {
    DB.upsert('journal', { id: jeEditId, date: fd.get('date'), narration: (fd.get('narration') || '').trim(), lines, source: 'manual' });
  } else {
    Acct.post({ date: fd.get('date'), narration: (fd.get('narration') || '').trim(), source: 'manual', lines });
  }
  closeForm();
  document.getElementById('modalForm').onsubmit = submitForm;
  toast('تم حفظ القيد ✅');
  App.render();
}

/* ---------------------------------------------------------------------
   14) طباعة فاتورة
   --------------------------------------------------------------------- */
function printDoc(coll, id) {
  const doc = DB.get(coll, id);
  if (!doc) return;
  const t = docTotals(doc);
  const s = DB.data.settings;
  const isSale = coll === 'sales';
  const rows = (doc.lines || []).map((l, i) => `
    <tr><td>${i + 1}</td><td>${esc(productName(l.productId))}</td>
    <td>${fmtQty(l.qty)}</td><td>${fmtDoc(l.price, doc)}</td>
    <td>${fmtDoc(num(l.qty) * num(l.price), doc)}</td></tr>`).join('');
  // رمز ZATCA للفواتير الضريبية (مبيعات)
  let qrHtml = '';
  if (isSale && typeof QR !== 'undefined') {
    try {
      const b64 = zatcaBase64(doc);
      qrHtml = `<div class="qr"><div class="qr-img">${QR.svg(b64, 3, 2)}</div>
        <div class="muted" style="font-size:11px">فاتورة ضريبية — ZATCA${s.vatNo ? ' • الرقم الضريبي: ' + esc(s.vatNo) : ''}</div></div>`;
    } catch (e) { qrHtml = ''; }
  }
  const w = window.open('', '_blank');
  if (!w) { toast('فعّل النوافذ المنبثقة للطباعة'); return; }
  w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
    <title>${esc(doc.ref)}</title>
    <style>
      body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#222}
      h1{color:#714B67;margin:0} .muted{color:#777}
      .head{display:flex;justify-content:space-between;border-bottom:2px solid #714B67;padding-bottom:12px;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      th,td{border:1px solid #ddd;padding:8px;text-align:right;font-size:14px}
      th{background:#f3eef2} .totals{margin-top:14px;width:300px;margin-right:auto}
      .totals .r{display:flex;justify-content:space-between;padding:5px 0}
      .totals .s{font-weight:bold;border-top:2px solid #714B67;font-size:16px}
      .qr{margin-top:20px;text-align:center} .qr-img{display:inline-block}
      .foot{display:flex;justify-content:space-between;align-items:flex-end;margin-top:8px}
    </style></head><body>
    <div class="head">
      <div><h1>${esc(s.company)}</h1><div class="muted">${isSale ? 'فاتورة ضريبية' : 'فاتورة مشتريات'}</div>${s.vatNo ? `<div class="muted">الرقم الضريبي: ${esc(s.vatNo)}</div>` : ''}</div>
      <div style="text-align:left"><div><b>${esc(doc.ref)}</b></div><div class="muted">${fmtDate(doc.date)}</div></div>
    </div>
    <div><b>${isSale ? 'العميل' : 'المورد'}:</b> ${esc(partnerName(doc.partnerId))}</div>
    <table><thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="foot">
      ${qrHtml}
      <div class="totals">
        <div class="r"><span>المجموع الفرعي</span><span>${fmtDoc(t.subtotal, doc)}</span></div>
        <div class="r"><span>الضريبة (${s.taxRate}%)</span><span>${fmtDoc(t.tax, doc)}</span></div>
        <div class="r s"><span>الإجمالي</span><span>${fmtDoc(t.total, doc)}</span></div>
        <div class="r"><span>المدفوع</span><span>${fmtDoc(t.paid, doc)}</span></div>
        <div class="r"><span>المتبقي</span><span>${fmtDoc(t.due, doc)}</span></div>
      </div>
    </div>
    <script>window.onload=function(){window.print()}<\/script>
    </body></html>`);
  w.document.close();
}

/* تعديل قسيمة راتب */
function openPayslipForm(id) {
  const p = DB.get('payslips', id);
  if (!p) return;
  if (p.status !== 'draft') { toast('لا يمكن تعديل قسيمة معتمدة'); return; }
  currentForm = { coll: 'payslips', id, kind: 'payslip' };
  document.getElementById('modalTitle').textContent = 'تعديل قسيمة — ' + employeeName(p.employeeId);
  document.getElementById('modalForm').innerHTML =
    `<div class="meta" style="margin-bottom:12px">الموظف: <b>${esc(employeeName(p.employeeId))}</b> • الشهر: <b>${esc(p.month)}</b></div>` +
    fieldHTML({ name: 'basic', label: 'الراتب الأساسي', type: 'number', default: 0 }, p) +
    fieldHTML({ name: 'allowances', label: 'البدلات', type: 'number', default: 0 }, p) +
    fieldHTML({ name: 'deductions', label: 'الاستقطاعات', type: 'number', default: 0 }, p) +
    `<button type="submit" class="btn-primary">حفظ القسيمة</button>`;
  document.getElementById('modal').classList.remove('hidden');
}

/* صرف قسيمة راتب — اختيار الطريقة */
function openPayslipPayDialog(id) {
  const p = DB.get('payslips', id);
  if (!p) return;
  document.getElementById('modalTitle').textContent = 'صرف راتب — ' + employeeName(p.employeeId);
  document.getElementById('modalForm').innerHTML = `
    <div class="card report-table" style="margin:0 0 12px">${reportRow('صافي الراتب', fmtMoney(payslipNet(p)), true)}</div>
    <div class="field"><label>طريقة الصرف</label><select name="method">
      <option value="cash">نقدي</option><option value="bank">تحويل بنكي</option></select></div>
    <button type="submit" class="btn-primary">تأكيد الصرف</button>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modalForm').onsubmit = (e) => {
    e.preventDefault();
    payPayslip(id, new FormData(e.target).get('method'));
    closeForm();
    document.getElementById('modalForm').onsubmit = submitForm;
    App.render();
  };
}

/* طباعة قسيمة راتب */
function printPayslip(id) {
  const p = DB.get('payslips', id);
  if (!p) return;
  const s = DB.data.settings;
  const w = window.open('', '_blank');
  if (!w) { toast('فعّل النوافذ المنبثقة للطباعة'); return; }
  w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(p.ref)}</title>
    <style>body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#222}h1{color:#714B67;margin:0}
    .head{border-bottom:2px solid #714B67;padding-bottom:12px;margin-bottom:16px;display:flex;justify-content:space-between}
    table{width:100%;border-collapse:collapse;margin-top:12px}td{border:1px solid #ddd;padding:9px;font-size:14px}
    .r{text-align:left}.tot{font-weight:bold;background:#f3eef2}.muted{color:#777}</style></head><body>
    <div class="head"><div><h1>${esc(s.company)}</h1><div class="muted">قسيمة راتب</div></div>
    <div style="text-align:left"><b>${esc(p.ref)}</b><div class="muted">شهر ${esc(p.month)}</div></div></div>
    <div><b>الموظف:</b> ${esc(employeeName(p.employeeId))}</div>
    <table>
      <tr><td>الراتب الأساسي</td><td class="r">${fmtMoney(p.basic)}</td></tr>
      <tr><td>البدلات</td><td class="r">${fmtMoney(p.allowances)}</td></tr>
      <tr><td>الاستقطاعات</td><td class="r">(${fmtMoney(p.deductions)})</td></tr>
      <tr class="tot"><td>صافي الراتب</td><td class="r">${fmtMoney(payslipNet(p))}</td></tr>
    </table>
    <p class="muted" style="margin-top:30px">التوقيع: ............................</p>
    <script>window.onload=function(){window.print()}<\/script></body></html>`);
  w.document.close();
}

/* كشف حساب جهة اتصال (قابل للطباعة) */
function buildStatement(partnerId) {
  const rows = [];
  DB.list('sales').filter(d => d.partnerId === partnerId && d.status !== 'draft' && d.status !== 'cancel')
    .forEach(d => rows.push({ date: d.date, ref: d.ref, desc: 'فاتورة مبيعات', debit: toBase(docTotals(d).total, d), credit: 0 }));
  DB.list('purchases').filter(d => d.partnerId === partnerId && d.status !== 'draft' && d.status !== 'cancel')
    .forEach(d => rows.push({ date: d.date, ref: d.ref, desc: 'فاتورة مشتريات', debit: 0, credit: toBase(docTotals(d).total, d) }));
  DB.list('payments').filter(pm => pm.partnerId === partnerId).forEach(pm => {
    const amtB = num(pm.amount) * (num(pm.rate) || 1);
    if (pm.kind === 'in') rows.push({ date: pm.date, ref: pm.ref, desc: 'تحصيل (' + (PAY_METHOD[pm.method] || '') + ')', debit: 0, credit: amtB });
    else rows.push({ date: pm.date, ref: pm.ref, desc: 'سداد (' + (PAY_METHOD[pm.method] || '') + ')', debit: amtB, credit: 0 });
  });
  rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  let bal = 0;
  rows.forEach(r => { bal += num(r.debit) - num(r.credit); r.balance = bal; });
  return { rows, balance: bal };
}

function printStatement(partnerId) {
  const p = DB.get('partners', partnerId);
  if (!p) return;
  const s = DB.data.settings;
  const { rows, balance } = buildStatement(partnerId);
  const w = window.open('', '_blank');
  if (!w) { toast('فعّل النوافذ المنبثقة للطباعة'); return; }
  const body = rows.length ? rows.map(r => `<tr>
    <td>${fmtDate(r.date)}</td><td>${esc(r.ref || '')}</td><td>${esc(r.desc)}</td>
    <td>${r.debit ? fmtMoney(r.debit) : '—'}</td><td>${r.credit ? fmtMoney(r.credit) : '—'}</td>
    <td>${fmtMoney(r.balance)}</td></tr>`).join('') : '<tr><td colspan="6" style="text-align:center">لا توجد حركات</td></tr>';
  const sign = balance > 0 ? 'مدين لنا (له علينا تحصيله)' : (balance < 0 ? 'دائن (مستحق له علينا)' : 'مُسوّى');
  w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>كشف حساب ${esc(p.name)}</title>
    <style>body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#222}h1{color:#714B67;margin:0}
    .head{border-bottom:2px solid #714B67;padding-bottom:12px;margin-bottom:16px;display:flex;justify-content:space-between}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}th,td{border:1px solid #ddd;padding:8px;text-align:right}
    th{background:#f3eef2}.muted{color:#777}.tot{margin-top:14px;font-weight:bold;font-size:16px;text-align:left}</style></head><body>
    <div class="head"><div><h1>${esc(s.company)}</h1><div class="muted">كشف حساب</div></div>
    <div style="text-align:left"><b>${esc(p.name)}</b><div class="muted">${esc(PARTNER_KIND[p.kind] || '')}${p.phone ? ' • ' + esc(p.phone) : ''}</div>
    <div class="muted">${esc(todayISO())}</div></div></div>
    <table><thead><tr><th>التاريخ</th><th>المرجع</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
    <tbody>${body}</tbody></table>
    <div class="tot">الرصيد النهائي: ${fmtMoney(Math.abs(balance))} — ${sign}</div>
    <script>window.onload=function(){window.print()}<\/script></body></html>`);
  w.document.close();
}

/* ---------------------------------------------------------------------
   نقطة البيع (POS)
   --------------------------------------------------------------------- */
function posAdd(productId) {
  const p = DB.get('products', productId);
  if (!p) return;
  const line = App.posCart.find(l => l.productId === productId);
  if (line) line.qty = num(line.qty) + 1;
  else App.posCart.push({ productId, qty: 1, price: num(p.salePrice) });
  App.render();
}

function posWalkInPartner() {
  let p = DB.list('partners').find(x => x.name === 'عميل نقدي');
  if (!p) p = DB.upsert('partners', { name: 'عميل نقدي', kind: 'customer' });
  return p.id;
}

function posCheckout(method) {
  if (lockedToast(todayISO())) return;
  if (!App.posCart.length) return;
  const partnerId = App.posPartner || posWalkInPartner();
  const lines = App.posCart
    .filter(l => l.productId && num(l.qty) > 0)
    .map(l => ({ productId: l.productId, name: productName(l.productId), qty: num(l.qty), price: num(l.price) }));
  if (!lines.length) return;
  const sess = currentPosSession();
  const doc = DB.upsert('sales', {
    ref: DB.nextRef('SO'), partnerId, date: todayISO(),
    status: 'draft', paid: 0, currency: 'BASE', rate: 1, lines, note: 'بيع نقطة بيع',
    sessionId: sess ? sess.id : undefined, posMethod: method,
  });
  confirmDoc('sales', doc.id);
  const fresh = DB.get('sales', doc.id);
  if (fresh.status !== 'confirmed') return;   // مُنع (مثلاً فترة مقفلة)
  registerPayment('sales', doc.id, docTotals(fresh).total, method);
  const printId = doc.id;
  App.posCart = [];
  App.posPartner = '';
  toast('تم البيع بنجاح ✅');
  App.render();
  if (confirm('طباعة الإيصال؟')) printDoc('sales', printId);
}

/* البحث عن منتج بالباركود/الرمز وإضافته للسلة */
function posScan(code) {
  code = (code || '').trim();
  if (!code) return false;
  const p = DB.list('products').find(x =>
    (x.code && String(x.code).toLowerCase() === code.toLowerCase()) || x.id === code);
  if (!p) { toast('لا يوجد منتج بالرمز: ' + code); return false; }
  posAdd(p.id);
  return true;
}

/* مسح بالكاميرا باستخدام BarcodeDetector (إن توفّر) */
let posCamStream = null;
async function startPosCamera() {
  if (!('BarcodeDetector' in window)) { toast('المسح بالكاميرا غير مدعوم في هذا المتصفح — استخدم ماسحاً أو الإدخال اليدوي'); return; }
  try {
    const detector = new window.BarcodeDetector();
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    posCamStream = stream;
    const overlay = document.createElement('div');
    overlay.className = 'cam-overlay';
    overlay.innerHTML = `<div class="cam-box"><video autoplay playsinline></video>
      <div class="cam-hint">وجّه الكاميرا نحو الباركود</div>
      <button class="btn-primary" id="camClose">إغلاق</button></div>`;
    document.body.appendChild(overlay);
    const video = overlay.querySelector('video');
    video.srcObject = stream;
    const stop = () => { stream.getTracks().forEach(t => t.stop()); posCamStream = null; overlay.remove(); };
    overlay.querySelector('#camClose').onclick = stop;
    const tick = async () => {
      if (!posCamStream) return;
      try {
        const codes = await detector.detect(video);
        if (codes && codes.length) {
          const val = codes[0].rawValue;
          stop();
          if (posScan(val)) toast('تمت إضافة المنتج ✅');
          return;
        }
      } catch (e) {}
      requestAnimationFrame(tick);
    };
    video.onloadedmetadata = () => requestAnimationFrame(tick);
  } catch (e) {
    toast('تعذّر فتح الكاميرا');
  }
}

/* ---------------------------------------------------------------------
   حوارات العملات والمستخدمين (الإعدادات)
   --------------------------------------------------------------------- */
function openCurrencyDialog(code) {
  const cur = code ? getCurrency(code) : { code: '', symbol: '', rate: 1 };
  document.getElementById('modalTitle').textContent = code ? 'تعديل عملة' : 'إضافة عملة';
  document.getElementById('modalForm').innerHTML = `
    <div class="field"><label>رمز العملة (مثل USD) *</label><input name="code" value="${esc(cur.code)}" ${code ? 'readonly' : 'required'} /></div>
    <div class="field"><label>الرمز المعروض (مثل $) *</label><input name="symbol" value="${esc(cur.symbol)}" required /></div>
    <div class="field"><label>سعر الصرف (قيمة الوحدة بالعملة الأساسية) *</label><input name="rate" type="number" inputmode="decimal" step="any" min="0" value="${esc(cur.rate)}" required /></div>
    <button type="submit" class="btn-primary">حفظ</button>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modalForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const c = (fd.get('code') || '').trim().toUpperCase();
    if (!c || c === 'BASE') { toast('رمز غير صالح'); return; }
    const list = DB.data.settings.currencies;
    const ex = list.find(x => x.code === c);
    const obj = { code: c, symbol: (fd.get('symbol') || '').trim(), rate: num(fd.get('rate')) || 1 };
    if (ex) Object.assign(ex, obj); else list.push(obj);
    DB.save();
    closeForm();
    document.getElementById('modalForm').onsubmit = submitForm;
    toast('تم حفظ العملة ✅');
    App.render();
  };
}

function openUserDialog(id) {
  const u = id ? Auth.users().find(x => x.id === id) : { name: '', role: 'sales', pin: '' };
  document.getElementById('modalTitle').textContent = id ? 'تعديل مستخدم' : 'مستخدم جديد';
  const roleOpts = kv(ROLES).map(o => `<option value="${o.v}" ${u.role === o.v ? 'selected' : ''}>${o.l}</option>`).join('');
  document.getElementById('modalForm').innerHTML = `
    <div class="field"><label>الاسم *</label><input name="name" value="${esc(u.name)}" required /></div>
    <div class="field"><label>الدور</label><select name="role">${roleOpts}</select></div>
    <div class="field"><label>رمز الدخول PIN (اختياري)</label><input name="pin" type="text" inputmode="numeric" value="" placeholder="${id ? (Auth.hasPin(u) ? 'مضبوط — اكتب جديداً للتغيير أو - لإزالته' : 'اتركه فارغاً لدخول بلا رمز') : 'اتركه فارغاً لدخول بلا رمز'}" /></div>
    <button type="submit" class="btn-primary">حفظ</button>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modalForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const pinInput = (fd.get('pin') || '').trim();
    const obj = { name: (fd.get('name') || '').trim(), role: fd.get('role') };
    const users = DB.data.settings.users;
    if (id) {
      const ex = users.find(x => x.id === id);
      // منع إزالة آخر مدير
      if (ex.role === 'admin' && obj.role !== 'admin' && users.filter(x => x.role === 'admin').length === 1) { toast('يجب بقاء مدير واحد على الأقل'); return; }
      Object.assign(ex, obj);
      delete ex.pin;
      if (pinInput === '-') delete ex.pinHash;                 // إزالة الرمز
      else if (pinInput) ex.pinHash = hashPin(pinInput);       // تغيير الرمز
      if (Auth.user && Auth.user.id === id) Auth.user = ex;
    } else {
      const nu = { id: uid(), ...obj };
      if (pinInput && pinInput !== '-') nu.pinHash = hashPin(pinInput);
      users.push(nu);
    }
    DB.save();
    closeForm();
    document.getElementById('modalForm').onsubmit = submitForm;
    toast('تم حفظ المستخدم ✅');
    App.render();
  };
}

/* ---------------------------------------------------------------------
   CRM — نقل مراحل الفرص وتحويل المكسوبة إلى أمر بيع
   --------------------------------------------------------------------- */
function moveLeadStage(id, stage) {
  const l = DB.get('leads', id);
  if (!l) return;
  l.stage = stage;
  DB.upsert('leads', l);
  toast('تم نقل الفرصة إلى: ' + LEAD_STAGES[stage]);
}

function convertLead(id) {
  const l = DB.get('leads', id);
  if (!l) return;
  // إنشاء/إيجاد جهة اتصال بنفس الاسم
  let p = DB.list('partners').find(x => x.name === (l.contact || l.name));
  if (!p) p = DB.upsert('partners', { name: l.contact || l.name, kind: 'customer', phone: l.phone || '' });
  l.stage = 'won'; l.partnerId = p.id;
  DB.upsert('leads', l);
  toast('تم تحويل الفرصة إلى عميل — أنشئ أمر بيع له الآن');
  App.posPartner = '';
  App.go('sales');
  openForm('sales');
}

/* ---------------------------------------------------------------------
   التصنيع — قوائم المكوّنات (BOM) وأوامر التصنيع
   --------------------------------------------------------------------- */
function bomCost(bom) {
  return (bom.components || []).reduce((s, c) => {
    const p = DB.get('products', c.productId);
    return s + (p ? num(p.cost) * num(c.qty) : 0);
  }, 0);
}

/* تنفيذ أمر تصنيع: استهلاك المكوّنات وإنتاج المنتج التام */
function produce(bomId, qty) {
  const bom = DB.get('boms', bomId);
  if (!bom) return;
  qty = num(qty) || 1;
  const finished = DB.get('products', bom.productId);
  if (!finished) { toast('المنتج التام غير موجود'); return; }
  // تحقق من توفّر المكوّنات
  for (const c of bom.components || []) {
    const p = DB.get('products', c.productId);
    if (p && p.type !== 'service' && num(p.qty) < num(c.qty) * qty) {
      toast('كمية غير كافية من: ' + p.name); return;
    }
  }
  const date = todayISO();
  if (lockedToast(date)) return;
  let unitCost = 0;
  (bom.components || []).forEach(c => {
    const p = DB.get('products', c.productId);
    if (!p) return;
    const used = num(c.qty) * qty;
    unitCost += num(p.cost) * num(c.qty);
    if (p.type !== 'service') {
      p.qty = num(p.qty) - used;
      DB.upsert('products', p);
      DB.upsert('moves', { date, productId: p.id, qty: -used, type: 'out', ref: 'تصنيع', doc: 'mo' });
    }
  });
  // إضافة المنتج التام بتكلفة متوسطة مرجّحة
  const oldQty = num(finished.qty), oldCost = num(finished.cost);
  const newQty = oldQty + qty;
  finished.cost = newQty > 0 ? +(((oldQty * oldCost) + (qty * unitCost)) / newQty).toFixed(4) : unitCost;
  finished.qty = newQty;
  DB.upsert('products', finished);
  DB.upsert('moves', { date, productId: finished.id, qty: qty, type: 'in', ref: 'تصنيع', doc: 'mo' });
  DB.upsert('mos', { ref: DB.nextRef('MO'), bomId, productId: finished.id, qty, unitCost, date });
  toast(`تم تصنيع ${fmtQty(qty)} ${esc(finished.uom || '')} ✅`);
}

function openBomDialog(id) {
  const bom = id ? DB.get('boms', id) : { productId: '', components: [] };
  bomDraft = (bom.components || []).map(c => ({ ...c }));
  bomEditId = id;
  const stockProds = DB.list('products');
  const prodOpts = stockProds.map(p => `<option value="${p.id}" ${bom.productId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  document.getElementById('modalTitle').textContent = id ? 'تعديل قائمة مكوّنات' : 'قائمة مكوّنات جديدة';
  document.getElementById('modalForm').innerHTML = `
    <div class="field"><label>المنتج التام *</label><select name="productId" required><option value="">— اختر —</option>${prodOpts}</select></div>
    <div class="lines-editor">
      <div class="lines-head"><span>المكوّنات</span><button type="button" class="mini-btn" id="addBomBtn">＋ مكوّن</button></div>
      <div id="bomList"></div>
    </div>
    <button type="submit" class="btn-primary">حفظ القائمة</button>`;
  document.getElementById('modal').classList.remove('hidden');
  renderBomLines();
  document.getElementById('addBomBtn').onclick = () => { bomDraft.push({ productId: '', qty: 1 }); renderBomLines(); };
  document.getElementById('modalForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const pid = fd.get('productId');
    const comps = bomDraft.filter(c => c.productId && num(c.qty) > 0).map(c => ({ productId: c.productId, qty: num(c.qty) }));
    if (!pid || !comps.length) { toast('اختر المنتج وأضِف مكوّناً'); return; }
    DB.upsert('boms', { id: bomEditId || undefined, productId: pid, components: comps });
    closeForm();
    document.getElementById('modalForm').onsubmit = submitForm;
    toast('تم حفظ قائمة المكوّنات ✅');
    App.render();
  };
}

function renderBomLines() {
  const wrap = document.getElementById('bomList');
  if (!wrap) return;
  const prods = DB.list('products');
  wrap.innerHTML = bomDraft.length ? bomDraft.map((c, i) => {
    const opts = prods.map(p => `<option value="${p.id}" ${c.productId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    return `<div class="line-edit" data-i="${i}" style="grid-template-columns:1fr 70px 32px">
      <select class="bom-prod"><option value="">— مكوّن —</option>${opts}</select>
      <input class="bom-qty" type="number" inputmode="decimal" step="any" min="0" value="${esc(c.qty)}" placeholder="كمية" />
      <button type="button" class="ln-del" data-i="${i}">✕</button></div>`;
  }).join('') : '<div class="muted-text" style="padding:8px 0">أضِف مكوّناً واحداً على الأقل.</div>';
  document.querySelectorAll('#bomList .line-edit').forEach(row => {
    const i = +row.dataset.i;
    row.querySelector('.bom-prod').onchange = e => { bomDraft[i].productId = e.target.value; };
    row.querySelector('.bom-qty').oninput = e => { bomDraft[i].qty = e.target.value; };
  });
  document.querySelectorAll('#bomList .ln-del').forEach(b => { b.onclick = () => { bomDraft.splice(+b.dataset.i, 1); renderBomLines(); }; });
}

function openProduceDialog(bomId) {
  const bom = DB.get('boms', bomId);
  if (!bom) return;
  document.getElementById('modalTitle').textContent = 'تنفيذ أمر تصنيع';
  document.getElementById('modalForm').innerHTML = `
    <div class="meta" style="margin-bottom:12px">المنتج: <b>${esc(productName(bom.productId))}</b> • تكلفة الوحدة المقدّرة: <b>${fmtMoney(bomCost(bom))}</b></div>
    <div class="field"><label>الكمية المراد إنتاجها</label><input name="qty" type="number" inputmode="decimal" step="any" min="1" value="1" required /></div>
    <button type="submit" class="btn-primary">تصنيع</button>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modalForm').onsubmit = (e) => {
    e.preventDefault();
    produce(bomId, new FormData(e.target).get('qty'));
    closeForm();
    document.getElementById('modalForm').onsubmit = submitForm;
    App.render();
  };
}

let bomDraft = [];
let bomEditId = null;

/* ---------------------------------------------------------------------
   الفاتورة الإلكترونية — رمز ZATCA (TLV ثم Base64)
   --------------------------------------------------------------------- */
function tlvField(tag, valueStr) {
  const bytes = [];
  for (const ch of unescape(encodeURIComponent(valueStr))) bytes.push(ch.charCodeAt(0));
  return [tag, bytes.length, ...bytes];
}
function zatcaBase64(doc) {
  const s = DB.data.settings;
  const t = docTotals(doc);
  const ts = (doc.date || todayISO()) + 'T' + new Date().toTimeString().slice(0, 8) + 'Z';
  const bytes = [
    ...tlvField(1, s.company || ''),
    ...tlvField(2, s.vatNo || ''),
    ...tlvField(3, ts),
    ...tlvField(4, toBase(t.total, doc).toFixed(2)),
    ...tlvField(5, toBase(t.tax, doc).toFixed(2)),
  ];
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return (typeof btoa !== 'undefined') ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}

/* ---------------------------------------------------------------------
   البيانات التجريبية
   --------------------------------------------------------------------- */
function loadDemoData() {
  if (DB.list('sales').length || DB.list('products').length > 0) {
    if (!confirm('سيتم إضافة بيانات تجريبية فوق بياناتك الحالية. متابعة؟')) return;
  }
  // رأس مال افتتاحي (لتمويل الخزينة قبل المشتريات)
  Acct.post({ date: thisMonth('01'), narration: 'رأس المال الافتتاحي', source: 'manual', lines: [
    { accountId: Acct.id('bank'), debit: 100000, credit: 0 },
    { accountId: Acct.id('capital'), debit: 0, credit: 100000 },
  ] });
  const c1 = DB.upsert('partners', { name: 'مؤسسة النور التجارية', kind: 'customer', phone: '0551234567', city: 'الرياض' });
  const c2 = DB.upsert('partners', { name: 'شركة الأفق', kind: 'customer', phone: '0537654321', city: 'جدة' });
  const v1 = DB.upsert('partners', { name: 'موردون المتحدة', kind: 'vendor', phone: '0590001112', city: 'الدمام' });
  const p1 = DB.upsert('products', { name: 'لابتوب', code: '1001', type: 'stock', category: 'إلكترونيات', salePrice: 3500, cost: 2800, qty: 0, uom: 'قطعة', minQty: 3 });
  const p2 = DB.upsert('products', { name: 'طابعة', code: '1002', type: 'stock', category: 'إلكترونيات', salePrice: 800, cost: 600, qty: 0, uom: 'قطعة', minQty: 2 });
  const p3 = DB.upsert('products', { name: 'حبر طابعة', code: '1003', type: 'stock', category: 'مكتبية', salePrice: 120, cost: 70, qty: 0, uom: 'علبة', minQty: 10 });
  const p4 = DB.upsert('products', { name: 'صيانة سنوية', code: '2001', type: 'service', category: 'خدمات', salePrice: 500, cost: 0 });
  DB.upsert('employees', { name: 'خالد المحمد', job: 'محاسب', department: 'المحاسبة', salary: 6000, hireDate: '2024-01-15' });
  DB.upsert('employees', { name: 'سارة العتيبي', job: 'مندوب مبيعات', department: 'المبيعات', salary: 5000, hireDate: '2024-03-01' });
  DB.upsert('leads', { name: 'صفقة 20 لابتوب', contact: 'مؤسسة النور التجارية', phone: '0551234567', value: 70000, stage: 'proposal' });
  DB.upsert('leads', { name: 'عقد صيانة', contact: 'شركة الأفق', phone: '0537654321', value: 6000, stage: 'qualified' });
  // مشتريات (لتعبئة المخزون)
  const po = DB.upsert('purchases', { ref: DB.nextRef('PO'), partnerId: v1.id, date: thisMonth('05'), status: 'draft', paid: 0, currency: 'BASE', rate: 1, lines: [
    { productId: p1.id, qty: 10, price: 2800 }, { productId: p2.id, qty: 8, price: 600 }, { productId: p3.id, qty: 50, price: 70 },
  ] });
  confirmDoc('purchases', po.id);
  registerPayment('purchases', po.id, docTotals(DB.get('purchases', po.id)).total, 'bank');
  // مبيعات
  const so1 = DB.upsert('sales', { ref: DB.nextRef('SO'), partnerId: c1.id, date: thisMonth('10'), status: 'draft', paid: 0, currency: 'BASE', rate: 1, lines: [
    { productId: p1.id, qty: 3, price: 3500 }, { productId: p4.id, qty: 1, price: 500 },
  ] });
  confirmDoc('sales', so1.id);
  registerPayment('sales', so1.id, docTotals(DB.get('sales', so1.id)).total, 'cash');
  const so2 = DB.upsert('sales', { ref: DB.nextRef('SO'), partnerId: c2.id, date: thisMonth('15'), status: 'draft', paid: 0, currency: 'BASE', rate: 1, lines: [
    { productId: p2.id, qty: 2, price: 800 }, { productId: p3.id, qty: 10, price: 120 },
  ] });
  confirmDoc('sales', so2.id);   // غير مدفوعة (ذمم مدينة)
  toast('تم تحميل البيانات التجريبية ✅');
  App.go('dashboard');
}
function thisMonth(day) { return todayISO().slice(0, 7) + '-' + day; }

/* ---------------------------------------------------------------------
   15) ربط أحداث العرض
   --------------------------------------------------------------------- */
function bindViewEvents() {
  const search = document.getElementById('searchInput');
  if (search) {
    search.oninput = (e) => {
      App.search = e.target.value;
      App.render();
      const s = document.getElementById('searchInput');
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    };
  }

  on('[data-go]', 'click', b => App.go(b.dataset.go));
  on('[data-edit]', 'click', b => { const [c, i] = b.dataset.edit.split(':'); openForm(c, i); });
  on('[data-del]', 'click', b => {
    const [c, i] = b.dataset.del.split(':');
    if (confirm('هل تريد الحذف نهائياً؟')) { DB.remove(c, i); toast('تم الحذف'); App.render(); }
  });
  on('[data-confirm]', 'click', b => { const [c, i] = b.dataset.confirm.split(':'); confirmDoc(c, i); App.render(); });
  on('[data-cancel]', 'click', b => {
    const [c, i] = b.dataset.cancel.split(':');
    if (confirm('إلغاء المستند سيعكس حركات المخزون. متابعة؟')) { cancelDoc(c, i); App.render(); }
  });
  on('[data-pay]', 'click', b => { const [c, i] = b.dataset.pay.split(':'); openPayDialog(c, i); });
  on('[data-return]', 'click', b => {
    const [c, i] = b.dataset.return.split(':');
    if (confirm('إنشاء مرتجع كامل لهذا المستند؟ سيُعكس أثره على المخزون والمحاسبة.')) { createReturn(c, i); App.render(); }
  });
  on('[data-print]', 'click', b => { const [c, i] = b.dataset.print.split(':'); printDoc(c, i); });

  on('[data-adjust]', 'click', b => openAdjustDialog(b.dataset.adjust));
  on('[data-history]', 'click', b => openHistory(b.dataset.history));
  on('[data-move]', 'click', b => {
    const [id, delta] = b.dataset.move.split(':');
    const p = DB.get('products', id);
    if (!p) return;
    p.qty = num(p.qty) + Number(delta);
    DB.upsert('products', p);
    DB.upsert('moves', { date: todayISO(), productId: id, qty: Number(delta), type: 'adjust', ref: 'تعديل سريع', doc: 'adjust' });
    App.render();
  });

  // المحاسبة: تبديل التبويب
  on('[data-actab]', 'click', b => { App.acctTab = b.dataset.actab; App.render(); updateFab(); });
  const ledgerSel = document.getElementById('ledgerSel');
  if (ledgerSel) ledgerSel.onchange = () => { App.ledgerAcc = ledgerSel.value; App.render(); };
  // تقرير ضريبة VAT
  const vatFrom = document.getElementById('vatFrom');
  if (vatFrom) vatFrom.onchange = () => { App.vatFrom = vatFrom.value; App.render(); };
  const vatTo = document.getElementById('vatTo');
  if (vatTo) vatTo.onchange = () => { App.vatTo = vatTo.value; App.render(); };
  on('[data-vat-preset]', 'click', b => {
    const now = new Date(), y = now.getFullYear();
    if (b.dataset.vatPreset === 'month') { App.vatFrom = now.toISOString().slice(0, 7) + '-01'; App.vatTo = todayISO(); }
    else if (b.dataset.vatPreset === 'quarter') { const q = Math.floor(now.getMonth() / 3) * 3; App.vatFrom = `${y}-${String(q + 1).padStart(2, '0')}-01`; App.vatTo = todayISO(); }
    else { App.vatFrom = y + '-01-01'; App.vatTo = todayISO(); }
    App.render();
  });

  on('[data-je-edit]', 'click', b => openJournalDialog(b.dataset.jeEdit));
  on('[data-je-del]', 'click', b => {
    if (confirm('حذف هذا القيد نهائياً؟')) { DB.remove('journal', b.dataset.jeDel); toast('تم الحذف'); App.render(); }
  });

  // كشف الحساب
  on('[data-statement]', 'click', b => printStatement(b.dataset.statement));

  // استيراد/تصدير CSV بالجملة
  on('[data-csv-export]', 'click', b => exportModelCSV(b.dataset.csvExport));
  on('[data-csv-import]', 'click', b => importModelCSV(b.dataset.csvImport));

  // الإجازات والتحويل المخزني
  on('[data-leave]', 'click', b => openLeaveDialog(b.dataset.leave));
  on('[data-leaves]', 'click', b => openLeavesList(b.dataset.leaves));
  on('[data-transfer]', 'click', b => openTransferDialog(b.dataset.transfer));

  // الخزينة
  on('[data-treastab]', 'click', b => { App.treasTab = b.dataset.treastab; App.render(); });
  on('[data-voucher]', 'click', b => openVoucherDialog(b.dataset.voucher));
  on('[data-voucher-del]', 'click', b => { if (confirm('حذف السند وعكس قيده؟')) { deleteVoucher(b.dataset.voucherDel); toast('تم الحذف'); App.render(); } });
  on('[data-reconcile]', 'click', b => { toggleReconcile(b.dataset.reconcile); App.render(); });
  const recSel = document.getElementById('recSel');
  if (recSel) recSel.onchange = () => { App.recAcc = recSel.value; App.render(); };

  // تصدير التقارير
  on('[data-export]', 'click', b => {
    const k = b.dataset.export;
    if (k === 'report-pdf') printReport();
    else if (k === 'report-csv') exportReportCSV();
    else if (k === 'trial-csv') exportTrialCSV();
  });

  // مدى تواريخ التقارير
  const repFrom = document.getElementById('repFrom');
  if (repFrom) repFrom.onchange = () => { App.repFrom = repFrom.value; App.render(); };
  const repTo = document.getElementById('repTo');
  if (repTo) repTo.onchange = () => { App.repTo = repTo.value; App.render(); };
  on('[data-rep-preset]', 'click', b => {
    const now = new Date();
    if (b.dataset.repPreset === 'month') {
      App.repFrom = now.toISOString().slice(0, 7) + '-01';
      App.repTo = todayISO();
    } else if (b.dataset.repPreset === 'year') {
      App.repFrom = now.getFullYear() + '-01-01';
      App.repTo = todayISO();
    } else { App.repFrom = ''; App.repTo = ''; }
    App.render();
  });

  // الإقفال
  const lockForm = document.getElementById('lockForm');
  if (lockForm) lockForm.onsubmit = (e) => {
    e.preventDefault();
    DB.data.settings.lockDate = new FormData(e.target).get('lockDate') || '';
    DB.save(); toast('تم تحديث القفل ✅'); App.render();
  };
  const unlockBtn = document.getElementById('unlockBtn');
  if (unlockBtn) unlockBtn.onclick = () => {
    if (confirm('فتح قفل الفترة؟')) { DB.data.settings.lockDate = ''; DB.save(); toast('تم فتح القفل'); App.render(); }
  };
  const closeForm2 = document.getElementById('closeForm');
  if (closeForm2) closeForm2.onsubmit = (e) => {
    e.preventDefault();
    const date = new FormData(e.target).get('closeDate');
    if (confirm('تنفيذ قيد الإقفال وقفل الفترة حتى ' + date + '؟')) { closePeriod(date); App.render(); }
  };

  // الرواتب
  const payMonthInput = document.getElementById('payMonthInput');
  if (payMonthInput) payMonthInput.onchange = () => { App.payMonth = payMonthInput.value; App.render(); };
  const runBtn = document.getElementById('runPayrollBtn');
  if (runBtn) runBtn.onclick = () => {
    const n = runPayroll(App.payMonth);
    toast(n ? `تم توليد ${n} قسيمة` : 'كل القسائم موجودة مسبقاً');
    App.render();
  };
  on('[data-pslip-post]', 'click', b => { postPayslip(b.dataset.pslipPost); App.render(); });
  on('[data-pslip-pay]', 'click', b => openPayslipPayDialog(b.dataset.pslipPay));
  on('[data-pslip-edit]', 'click', b => openPayslipForm(b.dataset.pslipEdit));
  on('[data-pslip-print]', 'click', b => printPayslip(b.dataset.pslipPrint));
  on('[data-pslip-del]', 'click', b => {
    if (confirm('حذف القسيمة؟')) { deletePayslip(b.dataset.pslipDel); toast('تم الحذف'); App.render(); }
  });

  // نقطة البيع
  on('[data-pos-add]', 'click', b => posAdd(b.dataset.posAdd));
  on('[data-pos-inc]', 'click', b => { App.posCart[+b.dataset.posInc].qty++; App.render(); });
  on('[data-pos-dec]', 'click', b => { const l = App.posCart[+b.dataset.posDec]; l.qty = Math.max(1, num(l.qty) - 1); App.render(); });
  on('[data-pos-del]', 'click', b => { App.posCart.splice(+b.dataset.posDel, 1); App.render(); });
  on('[data-pos-checkout]', 'click', b => posCheckout(b.dataset.posCheckout));
  const posCust = document.getElementById('posCust');
  if (posCust) posCust.onchange = () => { App.posPartner = posCust.value; };
  const posClear = document.getElementById('posClear');
  if (posClear) posClear.onclick = () => { App.posCart = []; App.render(); };
  const posBarcode = document.getElementById('posBarcode');
  if (posBarcode) {
    posBarcode.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); posScan(posBarcode.value); posBarcode.value = ''; }
    };
    posBarcode.focus();
  }
  const posCamBtn = document.getElementById('posCamBtn');
  if (posCamBtn) posCamBtn.onclick = () => startPosCamera();
  const posOpenSess = document.getElementById('posOpenSess');
  if (posOpenSess) posOpenSess.onclick = () => {
    const f = prompt('عهدة افتتاح الصندوق (النقدية الابتدائية):', '0');
    if (f !== null) { posSessionOpen(f); App.render(); }
  };
  const posCloseSess = document.getElementById('posCloseSess');
  if (posCloseSess) posCloseSess.onclick = () => {
    const s = currentPosSession();
    const sales = DB.list('sales').filter(x => x.sessionId === s.id && x.status !== 'cancel');
    const cashSales = sales.filter(x => x.posMethod === 'cash').reduce((a, x) => a + docTotals(x).total, 0);
    const expected = num(s.openingFloat) + cashSales;
    const c = prompt(`النقد المتوقع في الصندوق: ${fmtMoney(expected)}\nأدخل النقد المعدود فعلياً:`, String(expected));
    if (c !== null) { posSessionClose(c); const ses = DB.list('posSessions').slice(-1)[0]; toast(`أُغلقت الوردية — الفرق: ${fmtMoney(ses.diff)}`); App.render(); }
  };

  // إعدادات
  const sf = document.getElementById('settingsForm');
  if (sf) sf.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    DB.data.settings.company = (fd.get('company') || 'شركتي').trim();
    DB.data.settings.vatNo = (fd.get('vatNo') || '').trim();
    DB.data.settings.currency = (fd.get('currency') || 'ر.س').trim();
    DB.data.settings.taxRate = num(fd.get('taxRate'));
    DB.save();
    updateBrand();
    toast('تم حفظ الإعدادات ✅');
    App.render();
  };
  on('[data-action]', 'click', b => {
    if (b.dataset.action === 'export') exportData();
    else if (b.dataset.action === 'import') importData();
    else if (b.dataset.action === 'reset') resetData();
    else if (b.dataset.action === 'demo') loadDemoData();
  });

  // CRM
  on('[data-lead-move]', 'click', b => { const [i, st] = b.dataset.leadMove.split(':'); moveLeadStage(i, st); App.render(); });
  on('[data-lead-win]', 'click', b => convertLead(b.dataset.leadWin));

  // التصنيع
  on('[data-produce]', 'click', b => openProduceDialog(b.dataset.produce));
  on('[data-bom-edit]', 'click', b => openBomDialog(b.dataset.bomEdit));
  on('[data-bom-del]', 'click', b => {
    if (confirm('حذف قائمة المكوّنات؟')) { DB.remove('boms', b.dataset.bomDel); toast('تم الحذف'); App.render(); }
  });
  const addBomTop = document.getElementById('addBomBtnTop');
  if (addBomTop) addBomTop.onclick = () => openBomDialog();

  // العملات
  const addCur = document.getElementById('addCurBtn');
  if (addCur) addCur.onclick = () => openCurrencyDialog();
  on('[data-cur-edit]', 'click', b => openCurrencyDialog(b.dataset.curEdit));
  on('[data-cur-del]', 'click', b => {
    if (confirm('حذف هذه العملة؟')) {
      DB.data.settings.currencies = DB.data.settings.currencies.filter(c => c.code !== b.dataset.curDel);
      DB.save(); toast('تم الحذف'); App.render();
    }
  });
  // المخازن
  const addWh = document.getElementById('addWhBtn');
  if (addWh) addWh.onclick = () => {
    const name = prompt('اسم المخزن الجديد:');
    if (name && name.trim()) { DB.data.settings.warehouses.push({ id: uid(), name: name.trim() }); DB.save(); toast('تمت الإضافة ✅'); App.render(); }
  };
  on('[data-wh-del]', 'click', b => {
    const id = b.dataset.whDel;
    const used = DB.list('moves').some(m => m.wh === id);
    if (used) { toast('لا يمكن حذف مخزن عليه حركات'); return; }
    if (confirm('حذف هذا المخزن؟')) { DB.data.settings.warehouses = DB.data.settings.warehouses.filter(w => w.id !== id); DB.save(); toast('تم الحذف'); App.render(); }
  });
  // المستخدمون
  const addUser = document.getElementById('addUserBtn');
  if (addUser) addUser.onclick = () => openUserDialog();
  on('[data-user-edit]', 'click', b => openUserDialog(b.dataset.userEdit));
  on('[data-user-del]', 'click', b => {
    const users = DB.data.settings.users;
    const u = users.find(x => x.id === b.dataset.userDel);
    if (u && u.role === 'admin' && users.filter(x => x.role === 'admin').length === 1) { toast('يجب بقاء مدير واحد'); return; }
    if (confirm('حذف هذا المستخدم؟')) {
      DB.data.settings.users = users.filter(x => x.id !== b.dataset.userDel);
      DB.save(); toast('تم الحذف'); App.render();
    }
  });
}

function on(sel, ev, fn) {
  document.querySelectorAll(sel).forEach(el => { el['on' + ev] = () => fn(el); });
}

/* ---------------------------------------------------------------------
   16) القائمة الجانبية (Drawer)
   --------------------------------------------------------------------- */
function allowedApps() { return APPS.filter(a => Auth.can(a.route)); }

function buildDrawer() {
  const apps = allowedApps().map(a =>
    `<button class="drawer-item ${App.route === a.route ? 'active' : ''}" data-go="${a.route}">
      <span class="d-ico" style="color:${a.color}">${a.icon}</span><span>${esc(a.label)}</span></button>`
  ).join('');
  const u = Auth.user;
  const footer = u ? `<div class="drawer-foot">
      <div class="du-info"><span class="du-name">${esc(u.name)}</span><span class="du-role">${esc(ROLES[u.role] || '')}</span></div>
      <button class="du-logout" id="logoutBtn">🚪 خروج</button>
    </div>` : '';
  document.getElementById('drawerNav').innerHTML = apps + footer;
  document.querySelectorAll('#drawerNav .drawer-item').forEach(b => {
    b.onclick = () => App.go(b.dataset.go);
  });
  const lo = document.getElementById('logoutBtn');
  if (lo) lo.onclick = () => { Auth.logout(); closeDrawer(); showLogin(); };
}

/* شاشة تسجيل الدخول */
function showLogin() {
  Auth.user = null;
  closeDrawer();
  document.getElementById('fab').classList.add('hidden');
  document.getElementById('pageTitle').textContent = 'تسجيل الدخول';
  const roleIco = { admin: '👑', accountant: '🧮', sales: '🛍️', viewer: '👁️' };
  const tiles = Auth.users().map(u => `<button class="login-tile" data-login="${u.id}">
      <span class="lt-ico">${roleIco[u.role] || '👤'}</span>
      <span class="lt-name">${esc(u.name)}</span>
      <span class="lt-role">${esc(ROLES[u.role] || '')}${Auth.hasPin(u) ? ' 🔒' : ''}</span>
    </button>`).join('');
  document.getElementById('view').innerHTML = `<div class="login-screen">
      <div class="login-brand">MOS&nbsp;<b>ERP</b></div>
      <div class="login-sub">اختر المستخدم للدخول</div>
      <div class="login-grid">${tiles}</div></div>`;
  document.querySelectorAll('[data-login]').forEach(b => {
    b.onclick = () => {
      const u = Auth.users().find(x => x.id === b.dataset.login);
      const pin = Auth.hasPin(u) ? (prompt('أدخل رمز الدخول (PIN):') || '') : '';
      if (Auth.login(u.id, pin)) App.go('dashboard');
      else toast('رمز الدخول غير صحيح');
    };
  });
}

function openDrawer() {
  buildDrawer();
  document.getElementById('drawer').classList.remove('hidden');
  requestAnimationFrame(() => document.getElementById('drawer').classList.add('open'));
}
function closeDrawer() {
  const d = document.getElementById('drawer');
  d.classList.remove('open');
  setTimeout(() => d.classList.add('hidden'), 200);
}

function updateBrand() {
  document.getElementById('brandCompany').textContent = DB.data.settings.company || 'شركتي';
}

/* ---------------------------------------------------------------------
   17) النسخ الاحتياطي / الاسترجاع / التصفير
   --------------------------------------------------------------------- */
/* ---------------------------------------------------------------------
   السمة (فاتح / داكن)
   --------------------------------------------------------------------- */
function applyTheme() {
  const dark = DB.data.settings.theme === 'dark';
  document.body.classList.toggle('dark', dark);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#1b1622' : '#714B67');
}
function toggleTheme() {
  DB.data.settings.theme = DB.data.settings.theme === 'dark' ? 'light' : 'dark';
  DB.save();
  applyTheme();
}

/* ---------------------------------------------------------------------
   تصدير CSV (يفتح في Excel) — مع BOM لدعم العربية
   --------------------------------------------------------------------- */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/* تحليل نص CSV إلى صفوف (يدعم الاقتباس والفواصل داخل الحقول) */
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

/* تصدير منتجات/جهات اتصال إلى CSV */
function exportModelCSV(coll) {
  const fields = Models[coll].fields.map(f => f.name);
  const headers = Models[coll].fields.map(f => f.label.replace(' *', ''));
  const rows = DB.list(coll).map(r => fields.map(f => r[f] == null ? '' : r[f]));
  exportCSV(Models[coll].plural, headers, rows);
}

/* استيراد منتجات/جهات اتصال من CSV (الترتيب حسب حقول النموذج) */
function importModelCSV(coll) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.csv,text/csv';
  inp.onchange = () => {
    const file = inp.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCSV(String(reader.result));
        if (rows.length < 2) { toast('الملف فارغ أو بلا بيانات'); return; }
        const fields = Models[coll].fields;
        let n = 0;
        for (let i = 1; i < rows.length; i++) {
          const obj = {};
          fields.forEach((f, j) => {
            let v = rows[i][j] != null ? String(rows[i][j]).trim() : '';
            if (f.type === 'number') v = num(v);
            obj[f.name] = v;
          });
          if (!obj.name) continue;
          DB.upsert(coll, obj); n++;
        }
        toast(`تم استيراد ${n} سجلاً ✅`);
        App.render();
      } catch (e) { alert('تعذّر قراءة الملف: ' + e.message); }
    };
    reader.readAsText(file);
  };
  inp.click();
}

function exportCSV(name, headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  rows.forEach(r => lines.push(r.map(csvCell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('تم تصدير ملف Excel (CSV) ✅');
}

/* طباعة/تصدير PDF للتقارير (عبر نافذة الطباعة) */
function printReport() {
  const from = App.repFrom, to = App.repTo;
  const sales = DB.list('sales').filter(d => (d.status === 'confirmed' || d.status === 'paid') && inRange(d.date, from, to));
  const purchases = DB.list('purchases').filter(d => (d.status === 'confirmed' || d.status === 'paid') && inRange(d.date, from, to));
  const salesTotal = sales.reduce((s, d) => s + toBase(docTotals(d).total, d), 0);
  const purchTotal = purchases.reduce((s, d) => s + toBase(docTotals(d).total, d), 0);
  const cogs = sales.reduce((s, d) => s + (d.lines || []).reduce((a, l) => {
    const p = DB.get('products', l.productId); return a + num(l.qty) * (p ? num(p.cost) : 0);
  }, 0), 0);
  const s = DB.data.settings;
  const acctRows = type => DB.list('accounts').filter(a => a.type === type)
    .map(a => ({ n: a.name, b: Acct.balance(a) })).filter(x => Math.abs(x.b) > 0.005);
  const sec = (title, items) => `<h3>${title}</h3><table>${items.map(i => `<tr><td>${esc(i.n)}</td><td class="r">${fmtMoney(i.b)}</td></tr>`).join('') || '<tr><td>—</td><td class="r">0</td></tr>'}</table>`;
  const w = window.open('', '_blank');
  if (!w) { toast('فعّل النوافذ المنبثقة'); return; }
  w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>تقرير مالي</title>
    <style>body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#222}h1{color:#714B67;margin:0}
    h3{color:#714B67;margin:18px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}
    table{width:100%;border-collapse:collapse}td{padding:6px 8px;border-bottom:1px solid #eee;font-size:14px}
    .r{text-align:left}.head{border-bottom:2px solid #714B67;padding-bottom:12px;margin-bottom:8px}
    .muted{color:#777}.big{font-weight:bold}</style></head><body>
    <div class="head"><h1>${esc(s.company)}</h1><div class="muted">التقرير المالي — ${esc(todayISO())}</div></div>
    <h3>قائمة الدخل المبسطة</h3>
    <table>
      <tr><td>إجمالي المبيعات</td><td class="r">${fmtMoney(salesTotal)}</td></tr>
      <tr><td>تكلفة البضاعة المباعة</td><td class="r">(${fmtMoney(cogs)})</td></tr>
      <tr class="big"><td>مجمل الربح</td><td class="r">${fmtMoney(salesTotal - cogs)}</td></tr>
      <tr><td>إجمالي المشتريات</td><td class="r">${fmtMoney(purchTotal)}</td></tr>
      <tr class="big"><td>صافي الربح التقديري</td><td class="r">${fmtMoney(salesTotal - purchTotal)}</td></tr>
    </table>
    ${sec('الأصول', acctRows('asset'))}
    ${sec('الالتزامات', acctRows('liability'))}
    ${sec('حقوق الملكية', acctRows('equity'))}
    <script>window.onload=function(){window.print()}<\/script></body></html>`);
  w.document.close();
}

/* تصدير ميزان المراجعة Excel */
function exportTrialCSV() {
  const rows = [];
  DB.list('accounts').slice().sort(byCode).forEach(a => {
    const bal = Acct.balance(a);
    const debitNormal = !!DEBIT_NORMAL[a.type];
    let dr = 0, cr = 0;
    if (debitNormal) { if (bal >= 0) dr = bal; else cr = -bal; }
    else { if (bal >= 0) cr = bal; else dr = -bal; }
    if (Math.abs(dr) < 0.005 && Math.abs(cr) < 0.005) return;
    rows.push([a.code, a.name, ACCOUNT_TYPES[a.type], dr.toFixed(2), cr.toFixed(2)]);
  });
  exportCSV('ميزان-المراجعة', ['الرمز', 'الحساب', 'النوع', 'مدين', 'دائن'], rows);
}

/* تصدير ملخص التقرير Excel */
function exportReportCSV() {
  const sales = DB.list('sales').filter(d => (d.status === 'confirmed' || d.status === 'paid') && inRange(d.date, App.repFrom, App.repTo));
  const rows = [];
  const prodMap = {};
  sales.forEach(d => (d.lines || []).forEach(l => {
    prodMap[l.productId] = prodMap[l.productId] || { qty: 0, total: 0 };
    prodMap[l.productId].qty += num(l.qty);
    prodMap[l.productId].total += toBase(num(l.qty) * num(l.price), d);
  }));
  Object.entries(prodMap).sort((a, b) => b[1].total - a[1].total)
    .forEach(([id, v]) => rows.push([productName(id), fmtQty(v.qty), v.total.toFixed(2)]));
  exportCSV('أفضل-المنتجات', ['المنتج', 'الكمية المباعة', 'إجمالي المبيعات (' + baseSymbol() + ')'], rows);
}

function exportData() {
  const blob = new Blob([JSON.stringify(DB.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mos-erp-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('تم تصدير النسخة الاحتياطية');
}

function importData() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json,.json';
  inp.onchange = () => {
    const file = inp.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== 'object') throw new Error('bad');
        const base = DB.defaults();
        DB.data = Object.assign(base, parsed);
        DB.data.settings = Object.assign(DB.defaults().settings, parsed.settings || {});
        DB.data.settings.seq = Object.assign(DB.defaults().settings.seq, (parsed.settings || {}).seq || {});
        DB.save();
        Acct.seed();
        seedCurrencies();
        seedWarehouses();
        Auth.seed();
        if (!Auth.user || !Auth.users().find(u => u.id === Auth.user.id)) {
          Auth.user = Auth.users().find(u => u.role === 'admin') || Auth.users()[0] || null;
        }
        updateBrand();
        applyTheme();
        toast('تم استيراد البيانات بنجاح ✅');
        if (Auth.user) App.go('dashboard'); else showLogin();
      } catch (e) {
        alert('تعذّر استيراد الملف: صيغة غير صالحة.');
      }
    };
    reader.readAsText(file);
  };
  inp.click();
}

function resetData() {
  if (!confirm('سيتم حذف جميع البيانات نهائياً. هل أنت متأكد؟')) return;
  if (!confirm('تأكيد أخير: لا يمكن التراجع. احذف كل شيء؟')) return;
  DB.data = DB.defaults();
  DB.save();
  Acct.seed();
  seedCurrencies();
  seedWarehouses();
  Auth.seed();
  Auth.user = Auth.users().find(u => u.role === 'admin') || Auth.users()[0] || null;
  updateBrand();
  applyTheme();
  toast('تم تصفير البيانات');
  if (Auth.user) App.go('dashboard'); else showLogin();
}

/* ---------------------------------------------------------------------
   18) التشغيل
   --------------------------------------------------------------------- */
function init() {
  DB.load();
  Acct.seed();
  seedCurrencies();
  seedWarehouses();
  Auth.seed();
  updateBrand();
  applyTheme();

  document.getElementById('themeBtn').onclick = toggleTheme;
  document.getElementById('menuBtn').onclick = openDrawer;
  document.getElementById('drawerOverlay').onclick = closeDrawer;
  document.getElementById('homeBtn').onclick = () => App.go('apps');
  document.getElementById('exportBtn').onclick = () => App.go('settings');
  document.getElementById('fab').onclick = () => {
    if (App.route === 'accounting') {
      if (App.acctTab === 'accounts') openForm('accounts');
      else if (App.acctTab === 'journal') openJournalDialog();
      return;
    }
    if (App.route === 'crm') { openForm('leads'); return; }
    if (App.fabRoutes[App.route]) openForm(App.route);
  };
  document.getElementById('modalClose').onclick = closeForm;
  document.getElementById('modal').onclick = (e) => { if (e.target.id === 'modal') closeForm(); };
  document.getElementById('modalForm').onsubmit = submitForm;

  if (Auth.restore()) App.go('dashboard');
  else showLogin();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
