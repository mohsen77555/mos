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
      settings: {
        company: 'شركتي',
        currency: 'ر.س',
        taxRate: 15,
        seq: { SO: 0, PO: 0 },
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
    return this.data;
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

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

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

/* ---------------------------------------------------------------------
   3) القوائم الثابتة
   --------------------------------------------------------------------- */
const PARTNER_KIND = { customer: 'عميل', vendor: 'مورد', both: 'عميل ومورد' };
const PRODUCT_TYPE = { stock: 'منتج مخزني', service: 'خدمة' };
const DOC_STATUS = { draft: 'مسودة', confirmed: 'مؤكد', paid: 'مدفوع', cancel: 'ملغي' };
const PAY_METHOD = { cash: 'نقدي', bank: 'تحويل بنكي', card: 'بطاقة', cheque: 'شيك' };
const PRODUCT_CATS = ['عام', 'مواد خام', 'منتج تام', 'خدمات', 'مكتبية', 'إلكترونيات', 'أخرى'];
const DEPARTMENTS = ['الإدارة', 'المبيعات', 'المشتريات', 'المحاسبة', 'المخزون', 'الإنتاج', 'الموارد البشرية', 'تقنية المعلومات', 'أخرى'];

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
};

function kv(obj) { return Object.entries(obj).map(([v, l]) => ({ v, l })); }

/* ---------------------------------------------------------------------
   5) قائمة التطبيقات (الـ Drawer + شاشة التطبيقات)
   --------------------------------------------------------------------- */
const APPS = [
  { route: 'dashboard', label: 'لوحة التحكم', icon: '📊', color: '#714B67' },
  { route: 'partners', label: 'جهات الاتصال', icon: '👥', color: '#0d6efd' },
  { route: 'products', label: 'المنتجات', icon: '📦', color: '#6610f2' },
  { route: 'sales', label: 'المبيعات', icon: '🧾', color: '#198754' },
  { route: 'purchases', label: 'المشتريات', icon: '🛒', color: '#d63384' },
  { route: 'inventory', label: 'المخزون', icon: '🏭', color: '#0dcaf0' },
  { route: 'invoicing', label: 'الفوترة والمدفوعات', icon: '💳', color: '#20c997' },
  { route: 'employees', label: 'الموظفون', icon: '🧑‍💼', color: '#fd7e14' },
  { route: 'reports', label: 'التقارير', icon: '📈', color: '#6f42c1' },
  { route: 'settings', label: 'الإعدادات', icon: '⚙️', color: '#6c757d' },
];

/* ---------------------------------------------------------------------
   6) التطبيق + التوجيه
   --------------------------------------------------------------------- */
const App = {
  route: 'dashboard',
  search: '',

  // التطبيقات التي يظهر فيها زر الإضافة العائم
  fabRoutes: { partners: 1, products: 1, sales: 1, purchases: 1, employees: 1 },

  go(route) {
    if (!APPS.find(a => a.route === route) && route !== 'apps') route = 'dashboard';
    this.route = route;
    this.search = '';
    const app = APPS.find(a => a.route === route);
    document.getElementById('pageTitle').textContent =
      route === 'apps' ? 'التطبيقات' : (app ? app.label : 'MOS ERP');
    document.getElementById('fab').classList.toggle('hidden', !this.fabRoutes[route]);
    closeDrawer();
    this.render();
    window.scrollTo(0, 0);
  },

  render() {
    document.getElementById('view').innerHTML = Views[this.route]();
    bindViewEvents();
  },
};

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
  const isSale = coll === 'sales';
  const sign = isSale ? -1 : +1;            // البيع يُنقص المخزون، الشراء يزيده
  (doc.lines || []).forEach(l => {
    const p = DB.get('products', l.productId);
    if (p && p.type !== 'service') {
      p.qty = num(p.qty) + sign * num(l.qty);
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
  DB.upsert(coll, doc);
  toast('تم تأكيد المستند وترحيل المخزون ✅');
}

/* إلغاء مستند: عكس حركات المخزون إن كان مؤكداً */
function cancelDoc(coll, id) {
  const doc = DB.get(coll, id);
  if (!doc || doc.status === 'cancel') return;
  if (doc.status === 'confirmed' || doc.status === 'paid') {
    const isSale = coll === 'sales';
    const sign = isSale ? +1 : -1;          // عكس الترحيل
    (doc.lines || []).forEach(l => {
      const p = DB.get('products', l.productId);
      if (p && p.type !== 'service') {
        p.qty = num(p.qty) + sign * num(l.qty);
        DB.upsert('products', p);
      }
    });
    DB.data.moves = DB.data.moves.filter(m => m.docId !== id);
  }
  doc.status = 'cancel';
  DB.upsert(coll, doc);
  toast('تم إلغاء المستند');
}

/* تسجيل دفعة على مستند */
function registerPayment(coll, id, amount, method) {
  const doc = DB.get(coll, id);
  if (!doc) return;
  const t = docTotals(doc);
  const amt = Math.min(num(amount), t.due);
  if (amt <= 0) { toast('لا يوجد مبلغ مستحق'); return; }
  doc.paid = num(doc.paid) + amt;
  const nt = docTotals(doc);
  if (nt.due <= 0.001) doc.status = 'paid';
  DB.upsert(coll, doc);
  DB.upsert('payments', {
    date: todayISO(),
    partnerId: doc.partnerId,
    kind: coll === 'sales' ? 'in' : 'out',   // قبض من عميل / صرف لمورد
    amount: amt,
    method: method || 'cash',
    ref: doc.ref,
    doc: coll,
    docId: id,
  });
  toast('تم تسجيل الدفعة ✅');
}

/* ---------------------------------------------------------------------
   8) العروض (Views)
   --------------------------------------------------------------------- */
const Views = {

  /* ===== شاشة التطبيقات (مثل Odoo Apps) ===== */
  apps() {
    let html = '<div class="apps-grid">';
    APPS.forEach(a => {
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
    const salesTotal = sales.filter(valid).reduce((s, d) => s + docTotals(d).total, 0);
    const purchTotal = purchases.filter(valid).reduce((s, d) => s + docTotals(d).total, 0);
    const receivable = sales.filter(valid).reduce((s, d) => s + docTotals(d).due, 0);
    const payable = purchases.filter(valid).reduce((s, d) => s + docTotals(d).due, 0);
    const lowStock = products.filter(p => p.type !== 'service' && num(p.qty) <= num(p.minQty));
    const stockValue = products.reduce((s, p) => s + num(p.qty) * num(p.cost), 0);

    const stat = (num_, lbl, ico, color) => `
      <div class="stat-card" style="--c:${color}">
        <span class="ico">${ico}</span>
        <div class="num">${num_}</div><div class="lbl">${lbl}</div></div>`;

    let html = `<div class="stat-grid">
      ${stat(fmtMoney(salesTotal), 'إجمالي المبيعات', '🧾', '#198754')}
      ${stat(fmtMoney(purchTotal), 'إجمالي المشتريات', '🛒', '#d63384')}
      ${stat(fmtMoney(receivable), 'ذمم مدينة (لنا)', '📥', '#0d6efd')}
      ${stat(fmtMoney(payable), 'ذمم دائنة (علينا)', '📤', '#dc3545')}
      ${stat(fmtMoney(salesTotal - purchTotal), 'صافي الربح التقديري', '💰', '#714B67')}
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

    items.forEach(p => {
      const low = num(p.qty) <= num(p.minQty);
      html += `<div class="card"><div class="row"><div>
        <div class="title">${esc(p.name)}</div>
        <div class="meta">${p.code ? 'الرمز: <b>' + esc(p.code) + '</b> • ' : ''}قيمة: <b>${fmtMoney(num(p.qty) * num(p.cost))}</b></div>
      </div><div style="text-align:left">
        <div class="qty-big ${low ? 'low' : ''}">${fmtQty(p.qty)} <small>${esc(p.uom || '')}</small></div>
      </div></div>
      <div class="card-actions">
        <button data-move="${p.id}:-1">➖</button>
        <button data-move="${p.id}:1">➕</button>
        <button data-adjust="${p.id}">⚖️ تسوية</button>
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

    const totalIn = payments.filter(p => p.kind === 'in').reduce((s, p) => s + num(p.amount), 0);
    const totalOut = payments.filter(p => p.kind === 'out').reduce((s, p) => s + num(p.amount), 0);

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
      </div><span class="badge ${inn ? 'ok' : 'danger'}">${inn ? '+' : '−'} ${fmtMoney(p.amount)}</span></div></div>`;
    });
    return html;
  },

  /* ===== التقارير ===== */
  reports() {
    const sales = DB.list('sales').filter(d => d.status === 'confirmed' || d.status === 'paid');
    const purchases = DB.list('purchases').filter(d => d.status === 'confirmed' || d.status === 'paid');

    const salesTotal = sales.reduce((s, d) => s + docTotals(d).total, 0);
    const purchTotal = purchases.reduce((s, d) => s + docTotals(d).total, 0);
    const cogs = sales.reduce((s, d) => s + (d.lines || []).reduce((a, l) => {
      const p = DB.get('products', l.productId); return a + num(l.qty) * (p ? num(p.cost) : 0);
    }, 0), 0);

    let html = `<div class="section-title">📊 قائمة الدخل المبسطة</div>`;
    html += `<div class="card report-table">
      ${reportRow('إجمالي المبيعات', fmtMoney(salesTotal))}
      ${reportRow('تكلفة البضاعة المباعة', '(' + fmtMoney(cogs) + ')')}
      ${reportRow('مجمل الربح', fmtMoney(salesTotal - cogs), true)}
      ${reportRow('إجمالي المشتريات', fmtMoney(purchTotal))}
      ${reportRow('صافي الربح التقديري', fmtMoney(salesTotal - purchTotal), true)}
    </div>`;

    /* أفضل المنتجات مبيعاً */
    const prodMap = {};
    sales.forEach(d => (d.lines || []).forEach(l => {
      prodMap[l.productId] = prodMap[l.productId] || { qty: 0, total: 0 };
      prodMap[l.productId].qty += num(l.qty);
      prodMap[l.productId].total += num(l.qty) * num(l.price);
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
    sales.forEach(d => { const t = docTotals(d); if (t.due > 0.001) balances[d.partnerId] = (balances[d.partnerId] || 0) + t.due; });
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
    const counts = ['partners', 'products', 'sales', 'purchases', 'employees', 'payments', 'moves']
      .map(c => `<li>${esc(Models[c] ? Models[c].plural : c)}: <b>${DB.list(c).length}</b></li>`).join('');
    return `
      <div class="section-title">🏢 بيانات الشركة</div>
      <form id="settingsForm" class="card">
        <div class="field"><label>اسم الشركة</label><input name="company" value="${esc(s.company)}" /></div>
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
          <button class="del" data-action="reset">🗑️ تصفير كل البيانات</button>
        </div>
        <div class="divider"></div>
        <div class="meta"><b>محتوى قاعدة البيانات:</b><ul class="counts">${counts}</ul></div>
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
   9) مكوّنات العرض القابلة لإعادة الاستخدام
   --------------------------------------------------------------------- */
function modelList(coll) {
  const M = Models[coll];
  const items = filterBySearch(DB.list(coll), M.searchFields);
  let html = searchBar(`ابحث في ${M.plural}...`);
  if (!items.length) return html + emptyState(M.icon, `لا توجد ${M.plural}`, 'اضغط زر «＋» للإضافة.');
  items.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach(r => {
    const b = M.badge ? M.badge(r) : null;
    html += `<div class="card"><div class="row"><div>
        <div class="title">${esc(M.title(r))}</div>
        <div class="meta">${esc(M.subtitle(r))}</div>
      </div>${b ? `<span class="badge ${b.cls}">${esc(b.text)}</span>` : ''}</div>
      <div class="card-actions">
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
    `<div class="line-row"><span>${esc(productName(l.productId))} × ${fmtQty(l.qty)}</span><span>${fmtMoney(num(l.qty) * num(l.price))}</span></div>`
  ).join('');
  let actions = '';
  if (d.status === 'draft') {
    actions = `<button data-confirm="${coll}:${d.id}">✅ تأكيد</button>
      <button data-edit="${coll}:${d.id}">✏️ تعديل</button>
      <button class="del" data-del="${coll}:${d.id}">🗑️</button>`;
  } else if (d.status === 'confirmed' || d.status === 'paid') {
    if (t.due > 0.001) actions += `<button data-pay="${coll}:${d.id}">💵 تسجيل دفعة</button>`;
    actions += `<button data-print="${coll}:${d.id}">🖨️ طباعة</button>`;
    if (d.status !== 'paid') actions += `<button class="del" data-cancel="${coll}:${d.id}">✖️ إلغاء</button>`;
  } else {
    actions = `<button class="del" data-del="${coll}:${d.id}">🗑️ حذف</button>`;
  }
  return `<div class="card"><div class="row"><div>
      <div class="title">${esc(d.ref || '—')} • ${esc(partnerName(d.partnerId))}</div>
      <div class="meta">${partyLabel} • ${fmtDate(d.date)} • ${(d.lines || []).length} بند</div>
    </div><div style="text-align:left">
      <span class="badge ${st}">${esc(DOC_STATUS[d.status] || d.status)}</span>
      <div class="title" style="margin-top:6px">${fmtMoney(t.total)}</div>
      ${t.due > 0.001 && d.status !== 'draft' && d.status !== 'cancel' ? `<div class="meta">المتبقي: <b>${fmtMoney(t.due)}</b></div>` : ''}
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
    <div class="title" style="margin-top:4px">${fmtMoney(t.total)}</div></div></div></div>`;
}

function invoiceRow(coll, d) {
  const t = docTotals(d);
  const isSale = coll === 'sales';
  return `<div class="card"><div class="row"><div>
    <div class="title">${esc(d.ref)} • ${esc(partnerName(d.partnerId))}</div>
    <div class="meta">الإجمالي: ${fmtMoney(t.total)} • مدفوع: ${fmtMoney(t.paid)}</div>
  </div><span class="badge ${isSale ? 'warn' : 'danger'}">متبقٍ ${fmtMoney(t.due)}</span></div>
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

function monthlySeries(docs) {
  const out = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString('ar-EG', { month: 'short' });
    let value = 0;
    docs.forEach(doc => { if ((doc.date || '').slice(0, 7) === key) value += docTotals(doc).total; });
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
}

function submitForm(e) {
  e.preventDefault();
  const { coll, id, kind } = currentForm;
  if (!coll) return;
  const fd = new FormData(e.target);
  const obj = {};
  for (const [k, v] of fd.entries()) obj[k] = typeof v === 'string' ? v.trim() : v;
  if (id) obj.id = id;

  if (kind === 'doc') {
    obj.lines = lineDraft
      .filter(l => l.productId && num(l.qty) > 0)
      .map(l => ({ productId: l.productId, name: productName(l.productId), qty: num(l.qty), price: num(l.price) }));
    if (!obj.lines.length) { toast('أضِف بنداً واحداً على الأقل'); return; }
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
      ${reportRow('الإجمالي', fmtMoney(t.total))}
      ${reportRow('المدفوع', fmtMoney(t.paid))}
      ${reportRow('المتبقي', fmtMoney(t.due), true)}
    </div>
    <div class="field"><label>المبلغ</label><input name="amount" type="number" inputmode="decimal" step="any" min="0" value="${t.due}" required /></div>
    <div class="field"><label>طريقة الدفع</label><select name="method">${kv(PAY_METHOD).map(o => `<option value="${o.v}">${o.l}</option>`).join('')}</select></div>
    <button type="submit" class="btn-primary">تأكيد الدفعة</button>`;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modalForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    registerPayment(coll, id, fd.get('amount'), fd.get('method'));
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
    <td>${fmtQty(l.qty)}</td><td>${fmtMoney(l.price)}</td>
    <td>${fmtMoney(num(l.qty) * num(l.price))}</td></tr>`).join('');
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
    </style></head><body>
    <div class="head">
      <div><h1>${esc(s.company)}</h1><div class="muted">${isSale ? 'فاتورة مبيعات' : 'فاتورة مشتريات'}</div></div>
      <div style="text-align:left"><div><b>${esc(doc.ref)}</b></div><div class="muted">${fmtDate(doc.date)}</div></div>
    </div>
    <div><b>${isSale ? 'العميل' : 'المورد'}:</b> ${esc(partnerName(doc.partnerId))}</div>
    <table><thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="totals">
      <div class="r"><span>المجموع الفرعي</span><span>${fmtMoney(t.subtotal)}</span></div>
      <div class="r"><span>الضريبة (${s.taxRate}%)</span><span>${fmtMoney(t.tax)}</span></div>
      <div class="r s"><span>الإجمالي</span><span>${fmtMoney(t.total)}</span></div>
      <div class="r"><span>المدفوع</span><span>${fmtMoney(t.paid)}</span></div>
      <div class="r"><span>المتبقي</span><span>${fmtMoney(t.due)}</span></div>
    </div>
    <script>window.onload=function(){window.print()}<\/script>
    </body></html>`);
  w.document.close();
}

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

  // إعدادات
  const sf = document.getElementById('settingsForm');
  if (sf) sf.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    DB.data.settings.company = (fd.get('company') || 'شركتي').trim();
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
  });
}

function on(sel, ev, fn) {
  document.querySelectorAll(sel).forEach(el => { el['on' + ev] = () => fn(el); });
}

/* ---------------------------------------------------------------------
   16) القائمة الجانبية (Drawer)
   --------------------------------------------------------------------- */
function buildDrawer() {
  document.getElementById('drawerNav').innerHTML = APPS.map(a =>
    `<button class="drawer-item ${App.route === a.route ? 'active' : ''}" data-go="${a.route}">
      <span class="d-ico" style="color:${a.color}">${a.icon}</span><span>${esc(a.label)}</span></button>`
  ).join('');
  document.querySelectorAll('#drawerNav .drawer-item').forEach(b => {
    b.onclick = () => App.go(b.dataset.go);
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
        updateBrand();
        toast('تم استيراد البيانات بنجاح ✅');
        App.go('dashboard');
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
  updateBrand();
  toast('تم تصفير البيانات');
  App.go('dashboard');
}

/* ---------------------------------------------------------------------
   18) التشغيل
   --------------------------------------------------------------------- */
function init() {
  DB.load();
  updateBrand();

  document.getElementById('menuBtn').onclick = openDrawer;
  document.getElementById('drawerOverlay').onclick = closeDrawer;
  document.getElementById('homeBtn').onclick = () => App.go('apps');
  document.getElementById('exportBtn').onclick = () => App.go('settings');
  document.getElementById('fab').onclick = () => { if (App.fabRoutes[App.route]) openForm(App.route); };
  document.getElementById('modalClose').onclick = closeForm;
  document.getElementById('modal').onclick = (e) => { if (e.target.id === 'modal') closeForm(); };
  document.getElementById('modalForm').onsubmit = submitForm;

  App.go('dashboard');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
