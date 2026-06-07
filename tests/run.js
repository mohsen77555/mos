/* =====================================================================
   مشغّل اختبارات MOS ERP — Node خالص بلا أي تبعيات.
   يهيّئ بيئة متصفّح وهمية، يحمّل js/qr.js و js/app.js، ثم يشغّل التحقّقات.
   التشغيل:  node tests/run.js     (يخرج برمز ≠ 0 عند أي فشل)
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* --- بيئة متصفّح وهمية --- */
const store = {};
const noop = () => {};
const classBag = () => { const s = new Set(); return { add: c => s.add(c), remove: c => s.delete(c), toggle: (c, f) => (f ? s.add(c) : s.delete(c)), contains: c => s.has(c) }; };
function makeEl() {
  return {
    classList: classBag(), style: {}, textContent: '', innerHTML: '', value: '', href: '', download: '',
    onclick: null, onsubmit: null, oninput: null, onchange: null, onkeydown: null,
    setAttribute: noop, getAttribute: () => null, setSelectionRange: noop, focus: noop,
    appendChild: noop, remove: noop, click: noop, querySelector: () => makeEl(), querySelectorAll: () => [],
  };
}
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
globalThis.document = { body: { classList: classBag() }, getElementById: () => makeEl(), querySelector: () => makeEl(), querySelectorAll: () => [], addEventListener: noop, createElement: () => makeEl() };
function setGlobal(name, val) { try { globalThis[name] = val; } catch (e) { Object.defineProperty(globalThis, name, { value: val, configurable: true, writable: true }); } }
setGlobal('window', { open: () => ({ document: { write: noop, close: noop } }), scrollTo: noop });
setGlobal('navigator', {});
setGlobal('requestAnimationFrame', noop);
globalThis.confirm = () => true;
globalThis.alert = noop;
globalThis.prompt = () => '';
globalThis.Blob = function (parts) { this.parts = parts; };
globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: noop };

/* --- تحميل ملفات التطبيق كنص واحد ضمن نطاق مشترك --- */
const root = path.join(__dirname, '..');
const qr = fs.readFileSync(path.join(root, 'js', 'qr.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const assertions = fs.readFileSync(path.join(__dirname, 'assertions.js'), 'utf8');

vm.runInThisContext(qr + '\n;\n' + app + '\n;\n' + assertions, { filename: 'mos-erp-combined.js' });
