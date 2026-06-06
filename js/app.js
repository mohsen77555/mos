/* =====================================================================
   تطبيق صيانة مطحنة الدقيق  —  Flour Mill Maintenance App
   تطبيق ويب تقدمي (PWA) يعمل دون اتصال ويحفظ البيانات محلياً
   ===================================================================== */

'use strict';

/* ---------------------------------------------------------------------
   1) طبقة التخزين (Local Storage)
   --------------------------------------------------------------------- */
const DB = {
  key: 'mill_maint_db_v1',
  data: null,

  defaults() {
    return { equipment: [], maintenance: [], workorders: [], parts: [] };
  },

  load() {
    try {
      const raw = localStorage.getItem(this.key);
      this.data = raw ? JSON.parse(raw) : this.defaults();
    } catch (e) {
      this.data = this.defaults();
    }
    // ضمان وجود كل المجموعات
    for (const k of Object.keys(this.defaults())) {
      if (!Array.isArray(this.data[k])) this.data[k] = [];
    }
    return this.data;
  },

  save() {
    localStorage.setItem(this.key, JSON.stringify(this.data));
  },

  list(coll) { return this.data[coll]; },

  get(coll, id) { return this.data[coll].find(x => x.id === id); },

  upsert(coll, item) {
    if (item.id) {
      const i = this.data[coll].findIndex(x => x.id === item.id);
      if (i >= 0) this.data[coll][i] = { ...this.data[coll][i], ...item };
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
};

/* ---------------------------------------------------------------------
   2) أدوات مساعدة
   --------------------------------------------------------------------- */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

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

function daysBetween(aISO, bISO) {
  const a = new Date(aISO + 'T00:00:00');
  const b = new Date(bISO + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}

function equipmentName(id) {
  const e = DB.get('equipment', id);
  return e ? e.name : 'غير محدد';
}

/* قوائم ثابتة */
const EQUIP_TYPES = ['مطحنة', 'منخل/غربال', 'محرك', 'ناقل/سير', 'مصعد حبوب', 'مروحة شفط', 'منظف حبوب', 'خلاط', 'معبّأة', 'مضخة', 'ضاغط هواء', 'لوحة كهرباء', 'أخرى'];
const EQUIP_STATUS = { running: 'تعمل', stopped: 'متوقفة', maintenance: 'تحت الصيانة' };
const WO_STATUS = { open: 'مفتوح', progress: 'قيد التنفيذ', done: 'مكتمل' };
const WO_PRIORITY = { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', urgent: 'عاجلة' };
const MAINT_TYPES = ['تشحيم', 'تنظيف', 'فحص دوري', 'تغيير قطعة', 'معايرة', 'شد أحزمة', 'فحص كهربائي', 'أخرى'];

/* ---------------------------------------------------------------------
   3) التوجيه (Routing) + التطبيق
   --------------------------------------------------------------------- */
const App = {
  route: 'dashboard',
  search: '',

  routes: {
    dashboard:   { title: 'لوحة التحكم', fab: false },
    equipment:   { title: 'سجل المعدات', fab: true },
    maintenance: { title: 'جدول الصيانة', fab: true },
    workorders:  { title: 'أوامر العمل', fab: true },
    parts:       { title: 'قطع الغيار', fab: true },
  },

  go(route) {
    this.route = route;
    this.search = '';
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.route === route));
    document.getElementById('pageTitle').textContent = this.routes[route].title;
    document.getElementById('fab').classList.toggle('hidden', !this.routes[route].fab);
    this.render();
    document.getElementById('view').scrollTop = 0;
    window.scrollTo(0, 0);
  },

  render() {
    const el = document.getElementById('view');
    el.innerHTML = Views[this.route]();
    bindViewEvents();
  },
};

/* ---------------------------------------------------------------------
   4) العروض (Views)
   --------------------------------------------------------------------- */
const Views = {

  /* ---- لوحة التحكم ---- */
  dashboard() {
    const eq = DB.list('equipment');
    const wo = DB.list('workorders');
    const parts = DB.list('parts');

    const running = eq.filter(e => e.status === 'running').length;
    const down = eq.filter(e => e.status !== 'running').length;
    const openWO = wo.filter(w => w.status !== 'done').length;
    const lowStock = parts.filter(p => Number(p.qty) <= Number(p.minQty || 0));

    const due = maintenanceDue();
    const overdue = due.filter(d => d.daysLeft < 0);
    const soon = due.filter(d => d.daysLeft >= 0 && d.daysLeft <= 7);

    const stat = (num, lbl, ico) => `
      <div class="stat-card"><span class="ico">${ico}</span>
        <div class="num">${num}</div><div class="lbl">${lbl}</div></div>`;

    let html = `
      <div class="stat-grid">
        ${stat(eq.length, 'إجمالي المعدات', '⚙️')}
        ${stat(running, 'معدات تعمل', '✅')}
        ${stat(down, 'متوقفة / صيانة', '⛔')}
        ${stat(openWO, 'أوامر عمل مفتوحة', '🔧')}
      </div>`;

    /* تنبيهات الصيانة */
    if (overdue.length || soon.length) {
      html += `<div class="section-title">🗓️ صيانة مستحقة</div>`;
      [...overdue, ...soon].slice(0, 6).forEach(d => {
        const late = d.daysLeft < 0;
        const cls = late ? 'danger' : 'warn';
        const txt = late ? `متأخرة ${Math.abs(d.daysLeft)} يوم` : (d.daysLeft === 0 ? 'مستحقة اليوم' : `بعد ${d.daysLeft} يوم`);
        html += `
          <div class="card" data-open="maintenance:${d.id}">
            <div class="row">
              <div><div class="title">${esc(d.title)}</div>
              <div class="meta">${esc(equipmentName(d.equipmentId))} • ${esc(d.typeLabel)}</div></div>
              <span class="badge ${cls}">${txt}</span>
            </div></div>`;
      });
    }

    /* تنبيهات المخزون */
    if (lowStock.length) {
      html += `<div class="section-title">📦 قطع غيار منخفضة</div>`;
      lowStock.slice(0, 6).forEach(p => {
        html += `
          <div class="card" data-open="parts:${p.id}">
            <div class="row">
              <div><div class="title">${esc(p.name)}</div>
              <div class="meta">المتوفر: <b>${esc(p.qty)}</b> ${esc(p.unit || '')} • الحد الأدنى: ${esc(p.minQty || 0)}</div></div>
              <span class="badge danger">نفاد قريب</span>
            </div></div>`;
      });
    }

    if (!eq.length && !wo.length && !parts.length) {
      html += `
        <div class="empty">
          <div class="big">🌾</div>
          <p>مرحباً بك في تطبيق صيانة المطحنة.<br>ابدأ بإضافة المعدات من تبويب «المعدات».</p>
        </div>`;
    } else if (!overdue.length && !soon.length && !lowStock.length) {
      html += `
        <div class="empty">
          <div class="big">👌</div>
          <p>لا توجد تنبيهات حالياً.<br>كل شيء على ما يرام.</p>
        </div>`;
    }

    return html;
  },

  /* ---- المعدات ---- */
  equipment() {
    const items = filterBySearch(DB.list('equipment'), ['name', 'type', 'location', 'serial']);
    let html = searchBar('ابحث عن معدة...');
    if (!items.length) return html + emptyState('⚙️', 'لا توجد معدات بعد', 'اضغط زر «＋» لإضافة معدة جديدة.');

    items.forEach(e => {
      const st = statusBadge(e.status);
      html += `
        <div class="card">
          <div class="row">
            <div>
              <div class="title">${esc(e.name)}</div>
              <div class="meta">
                النوع: <b>${esc(e.type || '—')}</b> • الموقع: <b>${esc(e.location || '—')}</b><br>
                ${e.serial ? 'الرقم التسلسلي: <b>' + esc(e.serial) + '</b><br>' : ''}
                ${e.installDate ? 'تاريخ التركيب: ' + fmtDate(e.installDate) : ''}
              </div>
            </div>
            ${st}
          </div>
          ${e.notes ? `<div class="meta">📝 ${esc(e.notes)}</div>` : ''}
          <div class="card-actions">
            <button data-edit="equipment:${e.id}">✏️ تعديل</button>
            <button class="del" data-del="equipment:${e.id}">🗑️ حذف</button>
          </div>
        </div>`;
    });
    return html;
  },

  /* ---- الصيانة ---- */
  maintenance() {
    const due = maintenanceDue();
    const items = filterBySearch(due, ['title', 'typeLabel'], d => equipmentName(d.equipmentId));
    let html = searchBar('ابحث في جدول الصيانة...');
    if (!DB.list('equipment').length)
      return html + emptyState('🗓️', 'أضِف معدات أولاً', 'لا يمكن جدولة الصيانة دون وجود معدات.');
    if (!items.length) return html + emptyState('🗓️', 'لا توجد مهام صيانة', 'اضغط «＋» لإضافة مهمة صيانة دورية.');

    items.forEach(d => {
      let cls = 'ok', txt = `بعد ${d.daysLeft} يوم`;
      if (d.daysLeft < 0) { cls = 'danger'; txt = `متأخرة ${Math.abs(d.daysLeft)} يوم`; }
      else if (d.daysLeft === 0) { cls = 'warn'; txt = 'مستحقة اليوم'; }
      else if (d.daysLeft <= 7) { cls = 'warn'; txt = `بعد ${d.daysLeft} يوم`; }

      html += `
        <div class="card">
          <div class="row">
            <div>
              <div class="title">${esc(d.title)}</div>
              <div class="meta">
                المعدة: <b>${esc(equipmentName(d.equipmentId))}</b> • النوع: ${esc(d.typeLabel)}<br>
                كل <b>${esc(d.intervalDays)}</b> يوم • آخر صيانة: ${fmtDate(d.lastDone)}<br>
                الاستحقاق القادم: <b>${fmtDate(d.nextDue)}</b>
              </div>
            </div>
            <span class="badge ${cls}">${txt}</span>
          </div>
          <div class="card-actions">
            <button data-done="${d.id}">✅ تمت الصيانة</button>
            <button data-edit="maintenance:${d.id}">✏️ تعديل</button>
            <button class="del" data-del="maintenance:${d.id}">🗑️</button>
          </div>
        </div>`;
    });
    return html;
  },

  /* ---- أوامر العمل ---- */
  workorders() {
    let list = DB.list('workorders').slice().sort((a, b) => {
      const order = { open: 0, progress: 1, done: 2 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return (b.date || '').localeCompare(a.date || '');
    });
    const items = filterBySearch(list, ['title', 'description', 'technician'], w => equipmentName(w.equipmentId));
    let html = searchBar('ابحث في أوامر العمل...');
    if (!items.length) return html + emptyState('🔧', 'لا توجد أوامر عمل', 'سجّل أعطال وإصلاحات المعدات بالضغط على «＋».');

    items.forEach(w => {
      const stCls = w.status === 'done' ? 'ok' : (w.status === 'progress' ? 'info' : 'warn');
      const prCls = { low: 'muted', medium: 'info', high: 'warn', urgent: 'danger' }[w.priority] || 'muted';
      html += `
        <div class="card">
          <div class="row">
            <div>
              <div class="title">${esc(w.title)}</div>
              <div class="meta">
                المعدة: <b>${esc(equipmentName(w.equipmentId))}</b><br>
                التاريخ: ${fmtDate(w.date)} ${w.technician ? '• الفني: <b>' + esc(w.technician) + '</b>' : ''}<br>
                ${w.parts ? 'القطع المستخدمة: ' + esc(w.parts) + '<br>' : ''}
                ${w.cost ? 'التكلفة: <b>' + esc(w.cost) + '</b><br>' : ''}
              </div>
            </div>
            <div style="text-align:left">
              <span class="badge ${stCls}">${esc(WO_STATUS[w.status] || w.status)}</span><br>
              <span class="badge ${prCls}" style="margin-top:6px">${esc(WO_PRIORITY[w.priority] || '')}</span>
            </div>
          </div>
          ${w.description ? `<div class="meta">📝 ${esc(w.description)}</div>` : ''}
          <div class="card-actions">
            ${w.status !== 'done' ? `<button data-close-wo="${w.id}">✅ إغلاق</button>` : ''}
            <button data-edit="workorders:${w.id}">✏️ تعديل</button>
            <button class="del" data-del="workorders:${w.id}">🗑️</button>
          </div>
        </div>`;
    });
    return html;
  },

  /* ---- قطع الغيار ---- */
  parts() {
    const items = filterBySearch(DB.list('parts'), ['name', 'partNo', 'location']);
    let html = searchBar('ابحث عن قطعة غيار...');
    if (!items.length) return html + emptyState('📦', 'لا توجد قطع غيار', 'أضِف مخزون قطع الغيار بالضغط على «＋».');

    items.forEach(p => {
      const low = Number(p.qty) <= Number(p.minQty || 0);
      html += `
        <div class="card">
          <div class="row">
            <div>
              <div class="title">${esc(p.name)}</div>
              <div class="meta">
                ${p.partNo ? 'رقم القطعة: <b>' + esc(p.partNo) + '</b><br>' : ''}
                المتوفر: <b>${esc(p.qty)}</b> ${esc(p.unit || 'قطعة')} • الحد الأدنى: ${esc(p.minQty || 0)}<br>
                ${p.location ? 'الموقع: ' + esc(p.location) + '<br>' : ''}
                ${p.price ? 'سعر الوحدة: ' + esc(p.price) : ''}
              </div>
            </div>
            ${low ? '<span class="badge danger">نفاد قريب</span>' : '<span class="badge ok">متوفرة</span>'}
          </div>
          <div class="card-actions">
            <button data-qty="${p.id}:-1">➖</button>
            <button data-qty="${p.id}:1">➕</button>
            <button data-edit="parts:${p.id}">✏️</button>
            <button class="del" data-del="parts:${p.id}">🗑️</button>
          </div>
        </div>`;
    });
    return html;
  },
};

/* ---------------------------------------------------------------------
   5) منطق الصيانة (حساب الاستحقاق)
   --------------------------------------------------------------------- */
function maintenanceDue() {
  const today = todayISO();
  return DB.list('maintenance').map(m => {
    const last = m.lastDone || m.createdAtDate || today;
    const nextDue = m.nextDue || addDays(last, Number(m.intervalDays || 30));
    return {
      ...m,
      lastDone: last,
      nextDue,
      daysLeft: daysBetween(today, nextDue),
      typeLabel: m.type || 'صيانة',
    };
  }).sort((a, b) => a.daysLeft - b.daysLeft);
}

/* ---------------------------------------------------------------------
   6) عناصر واجهة مساعدة
   --------------------------------------------------------------------- */
function searchBar(placeholder) {
  return `<input class="search" id="searchInput" type="search"
            placeholder="${placeholder}" value="${esc(App.search)}" />`;
}

function emptyState(ico, title, sub) {
  return `<div class="empty"><div class="big">${ico}</div>
            <p><b>${esc(title)}</b><br><span class="muted-text">${esc(sub)}</span></p></div>`;
}

function statusBadge(status) {
  const map = { running: ['ok', 'تعمل'], stopped: ['danger', 'متوقفة'], maintenance: ['warn', 'تحت الصيانة'] };
  const [cls, label] = map[status] || ['muted', status || '—'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function filterBySearch(arr, fields, extraFn) {
  const q = App.search.trim().toLowerCase();
  if (!q) return arr;
  return arr.filter(item => {
    const hay = fields.map(f => item[f]).concat(extraFn ? [extraFn(item)] : [])
      .join(' ').toLowerCase();
    return hay.includes(q);
  });
}

/* ---------------------------------------------------------------------
   7) النماذج (Forms) داخل النافذة المنبثقة
   --------------------------------------------------------------------- */
const Forms = {
  equipment(item = {}) {
    return [
      ['name', 'اسم المعدة *', 'text', true],
      ['type', 'النوع', 'select', false, EQUIP_TYPES],
      ['location', 'الموقع / الطابق', 'text'],
      ['serial', 'الرقم التسلسلي', 'text'],
      ['installDate', 'تاريخ التركيب', 'date'],
      ['status', 'الحالة', 'select', false, Object.entries(EQUIP_STATUS).map(([v, l]) => ({ v, l }))],
      ['notes', 'ملاحظات', 'textarea'],
    ].map(f => fieldHTML(f, item)).join('') + submitBtn('حفظ المعدة');
  },

  maintenance(item = {}) {
    const eqOptions = DB.list('equipment').map(e => ({ v: e.id, l: e.name }));
    return [
      ['equipmentId', 'المعدة *', 'select', true, eqOptions],
      ['title', 'عنوان المهمة *', 'text', true],
      ['type', 'نوع الصيانة', 'select', false, MAINT_TYPES],
      ['intervalDays', 'التكرار (بالأيام) *', 'number', true],
      ['lastDone', 'تاريخ آخر صيانة', 'date'],
      ['notes', 'ملاحظات', 'textarea'],
    ].map(f => fieldHTML(f, { intervalDays: 30, lastDone: todayISO(), ...item })).join('')
      + submitBtn('حفظ المهمة');
  },

  workorders(item = {}) {
    const eqOptions = DB.list('equipment').map(e => ({ v: e.id, l: e.name }));
    return [
      ['equipmentId', 'المعدة *', 'select', true, eqOptions],
      ['title', 'عنوان العطل / العمل *', 'text', true],
      ['priority', 'الأولوية', 'select', false, Object.entries(WO_PRIORITY).map(([v, l]) => ({ v, l }))],
      ['status', 'الحالة', 'select', false, Object.entries(WO_STATUS).map(([v, l]) => ({ v, l }))],
      ['date', 'التاريخ', 'date'],
      ['technician', 'الفني المسؤول', 'text'],
      ['parts', 'القطع المستخدمة', 'text'],
      ['cost', 'التكلفة', 'text'],
      ['description', 'الوصف / التفاصيل', 'textarea'],
    ].map(f => fieldHTML(f, { date: todayISO(), status: 'open', priority: 'medium', ...item })).join('')
      + submitBtn('حفظ أمر العمل');
  },

  parts(item = {}) {
    return [
      ['name', 'اسم القطعة *', 'text', true],
      ['partNo', 'رقم القطعة', 'text'],
      ['qty', 'الكمية المتوفرة *', 'number', true],
      ['unit', 'الوحدة', 'text'],
      ['minQty', 'الحد الأدنى للتنبيه', 'number'],
      ['location', 'موقع التخزين', 'text'],
      ['price', 'سعر الوحدة', 'text'],
    ].map(f => fieldHTML(f, { qty: 0, minQty: 1, unit: 'قطعة', ...item })).join('')
      + submitBtn('حفظ القطعة');
  },
};

function fieldHTML([name, label, type, required, options], item) {
  const val = item[name] != null ? item[name] : '';
  const req = required ? 'required' : '';
  let input;
  if (type === 'select') {
    const opts = (options || []).map(o => {
      const v = typeof o === 'object' ? o.v : o;
      const l = typeof o === 'object' ? o.l : o;
      const sel = String(val) === String(v) ? 'selected' : '';
      return `<option value="${esc(v)}" ${sel}>${esc(l)}</option>`;
    }).join('');
    const placeholder = required ? `<option value="" disabled ${val ? '' : 'selected'}>— اختر —</option>` : '';
    input = `<select name="${name}" ${req}>${placeholder}${opts}</select>`;
  } else if (type === 'textarea') {
    input = `<textarea name="${name}" ${req}>${esc(val)}</textarea>`;
  } else {
    input = `<input name="${name}" type="${type}" value="${esc(val)}" ${req}
               ${type === 'number' ? 'inputmode="numeric" min="0"' : ''} />`;
  }
  return `<div class="field"><label>${esc(label)}</label>${input}</div>`;
}

function submitBtn(label) {
  return `<button type="submit" class="btn-primary">${esc(label)}</button>`;
}

/* ---------------------------------------------------------------------
   8) فتح/إغلاق النافذة المنبثقة
   --------------------------------------------------------------------- */
let currentForm = { coll: null, id: null };

function openForm(coll, id = null) {
  const item = id ? DB.get(coll, id) : {};
  const titles = {
    equipment: id ? 'تعديل معدة' : 'إضافة معدة',
    maintenance: id ? 'تعديل مهمة صيانة' : 'إضافة مهمة صيانة',
    workorders: id ? 'تعديل أمر عمل' : 'أمر عمل جديد',
    parts: id ? 'تعديل قطعة غيار' : 'إضافة قطعة غيار',
  };
  // منع إضافة صيانة/أمر عمل دون معدات
  if ((coll === 'maintenance' || coll === 'workorders') && !DB.list('equipment').length) {
    toast('أضِف معدة واحدة على الأقل أولاً');
    App.go('equipment');
    return;
  }
  currentForm = { coll, id };
  document.getElementById('modalTitle').textContent = titles[coll];
  document.getElementById('modalForm').innerHTML = Forms[coll](item || {});
  document.getElementById('modal').classList.remove('hidden');
}

function closeForm() {
  document.getElementById('modal').classList.add('hidden');
  currentForm = { coll: null, id: null };
}

function submitForm(e) {
  e.preventDefault();
  const { coll, id } = currentForm;
  if (!coll) return;
  const fd = new FormData(e.target);
  const obj = {};
  for (const [k, v] of fd.entries()) obj[k] = typeof v === 'string' ? v.trim() : v;
  if (id) obj.id = id;

  // تحويل الحقول الرقمية
  ['intervalDays', 'qty', 'minQty'].forEach(k => { if (obj[k] !== undefined && obj[k] !== '') obj[k] = Number(obj[k]); });

  // إعادة حساب موعد الصيانة القادم عند الحفظ
  if (coll === 'maintenance') {
    const last = obj.lastDone || todayISO();
    obj.nextDue = addDays(last, Number(obj.intervalDays || 30));
  }

  DB.upsert(coll, obj);
  closeForm();
  toast(id ? 'تم التحديث' : 'تمت الإضافة');
  App.render();
}

/* ---------------------------------------------------------------------
   9) ربط الأحداث
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

  document.querySelectorAll('[data-edit]').forEach(b => {
    b.onclick = () => { const [coll, id] = b.dataset.edit.split(':'); openForm(coll, id); };
  });

  document.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = () => {
      const [coll, id] = b.dataset.del.split(':');
      if (confirm('هل تريد الحذف نهائياً؟')) {
        DB.remove(coll, id);
        toast('تم الحذف');
        App.render();
      }
    };
  });

  // فتح عنصر من بطاقات لوحة التحكم
  document.querySelectorAll('[data-open]').forEach(c => {
    c.onclick = () => {
      const [route, id] = c.dataset.open.split(':');
      App.go(route);
      setTimeout(() => openForm(route, id), 50);
    };
  });

  // تمت الصيانة → تحديث آخر تاريخ والموعد القادم
  document.querySelectorAll('[data-done]').forEach(b => {
    b.onclick = () => {
      const m = DB.get('maintenance', b.dataset.done);
      if (!m) return;
      m.lastDone = todayISO();
      m.nextDue = addDays(m.lastDone, Number(m.intervalDays || 30));
      DB.upsert('maintenance', m);
      toast('تم تسجيل الصيانة ✅');
      App.render();
    };
  });

  // إغلاق أمر عمل
  document.querySelectorAll('[data-close-wo]').forEach(b => {
    b.onclick = () => {
      const w = DB.get('workorders', b.dataset.closeWo);
      if (!w) return;
      w.status = 'done';
      DB.upsert('workorders', w);
      toast('تم إغلاق أمر العمل ✅');
      App.render();
    };
  });

  // تعديل كمية قطعة الغيار سريعاً
  document.querySelectorAll('[data-qty]').forEach(b => {
    b.onclick = () => {
      const [id, delta] = b.dataset.qty.split(':');
      const p = DB.get('parts', id);
      if (!p) return;
      p.qty = Math.max(0, Number(p.qty || 0) + Number(delta));
      DB.upsert('parts', p);
      App.render();
    };
  });
}

/* ---------------------------------------------------------------------
   10) النسخ الاحتياطي / الاسترجاع
   --------------------------------------------------------------------- */
function backupMenu() {
  const choice = prompt(
    'النسخ الاحتياطي للبيانات:\n' +
    '1 = تصدير (تنزيل ملف)\n' +
    '2 = استيراد (لصق نص)\n' +
    'اكتب الرقم ثم موافق',
    '1'
  );
  if (choice === '1') exportData();
  else if (choice === '2') importData();
}

function exportData() {
  const blob = new Blob([JSON.stringify(DB.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `نسخة-صيانة-المطحنة-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('تم تصدير النسخة الاحتياطية');
}

function importData() {
  const txt = prompt('الصق محتوى ملف النسخة الاحتياطية (JSON):');
  if (!txt) return;
  try {
    const parsed = JSON.parse(txt);
    for (const k of Object.keys(DB.defaults())) {
      if (!Array.isArray(parsed[k])) throw new Error('ملف غير صالح');
    }
    DB.data = parsed;
    DB.save();
    toast('تم استيراد البيانات بنجاح');
    App.render();
  } catch (e) {
    alert('تعذّر استيراد البيانات: الملف غير صالح.');
  }
}

/* ---------------------------------------------------------------------
   11) التشغيل
   --------------------------------------------------------------------- */
function init() {
  DB.load();

  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => App.go(t.dataset.route);
  });
  document.getElementById('fab').onclick = () => {
    if (App.routes[App.route].fab) openForm(App.route);
  };
  document.getElementById('modalClose').onclick = closeForm;
  document.getElementById('modal').onclick = (e) => {
    if (e.target.id === 'modal') closeForm();
  };
  document.getElementById('modalForm').onsubmit = submitForm;
  document.getElementById('exportBtn').onclick = backupMenu;
  document.getElementById('menuBtn').onclick = () => App.go('dashboard');

  App.go('dashboard');

  // عامل الخدمة:
  // - داخل تطبيق أندرويد (WebView) كل الملفات محلية أصلاً، فلا حاجة له،
  //   بل قد يتعارض مع التحميل ويسبب خطأ ERR_CACHE_MISS → نلغيه ونزيل أي تسجيل سابق.
  // - في المتصفح/نسخة الويب نسجّله ليعمل التطبيق دون اتصال.
  if ('serviceWorker' in navigator) {
    const inAndroidApp = /MillMaintApp/.test(navigator.userAgent);
    if (inAndroidApp) {
      navigator.serviceWorker.getRegistrations()
        .then(rs => rs.forEach(r => r.unregister()))
        .catch(() => {});
      if (window.caches && caches.keys) {
        caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
      }
    } else {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
