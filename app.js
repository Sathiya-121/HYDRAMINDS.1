const $ = s => document.querySelector(s);
const view = $('#view'), msg = $('#msg');
const api = async (url, method = 'GET', body) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
};
const say = (t, good) => { msg.textContent = t; msg.className = good ? 'good' : ''; };
const stamp = v => `<span class="stamp ${v}">${v.toUpperCase()}</span>`;
const code = v => `<span class="code">${v}</span>`;
const table = (heads, rows) => `<table><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr>${rows.join('') || `<tr><td colspan="${heads.length}">No entries logged yet.</td></tr>`}</table>`;
const field = (n, l, t = 'text', extra = '') => `<label>${l}<input name="${n}" type="${t}" ${extra} required></label>`;
const bind = (sel, fn) => $(sel).addEventListener('submit', async e => {
  e.preventDefault();
  try { await fn(Object.fromEntries(new FormData(e.target))); } catch (err) { say(err.message); }
});
const clock = () => { $('#clock').textContent = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); };
clock(); setInterval(clock, 30000);

// ---------- Dashboard ----------
async function vDashboard() {
  const s = await api('/api/summary');
  const st = (n, l, cls) => `<div class="stat ${cls || ''}"><b>${n}</b><span>${l}</span></div>`;
  view.innerHTML = `<h2>Floor summary</h2><p class="sub">Live counts across intake, production and dispatch</p>
  <div class="grid">
    ${st(s.lots, 'Ingredient lots on record')}
    ${st(s.quarantined, 'Lots held in quarantine', s.quarantined ? 'warn' : '')}
    ${st(s.expiringSoon, 'Lots expiring within 90 days', s.expiringSoon ? 'warn' : '')}
    ${st(s.batches, 'Batches produced')}
    ${st(s.qcPending, 'Batches awaiting QC', s.qcPending ? 'warn' : '')}
    ${st(s.qcFailed, 'Batches failed QC', s.qcFailed ? 'bad' : '')}
    ${st(s.shipments, 'Shipments dispatched')}
    ${st(s.events, 'Events in the audit ledger')}
  </div>
  <div class="note">Everything here is derived from one event ledger — every intake, release, batch, QC result and shipment is logged with its source and confidence. Open <b>Trace &amp; recall</b> on any lot or batch to see that audit trail.</div>`;
}

// ---------- Ingest (tabs: manual / CSV / photo / scale) ----------
let ingestTab = 'manual';
let lastPreview = null; // { headers, rows }
async function vIngest() {
  view.innerHTML = `<h2>Ingest</h2><p class="sub">Four ways stock enters the ledger — pick the one that matches how the data actually arrives</p>
  <div class="tabs" id="itabs">
    <button data-t="manual" class="${ingestTab === 'manual' ? 'on' : ''}">Manual entry</button>
    <button data-t="csv" class="${ingestTab === 'csv' ? 'on' : ''}">Excel / CSV</button>
    <button data-t="photo" class="${ingestTab === 'photo' ? 'on' : ''}">Photo (invoice/GRN)</button>
    <button data-t="scale" class="${ingestTab === 'scale' ? 'on' : ''}">Scale</button>
  </div>
  <div id="itab-body"></div>`;
  $('#itabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { ingestTab = b.dataset.t; vIngest(); } });
  const body = $('#itab-body');
  if (ingestTab === 'manual') {
    body.innerHTML = `<div class="ticket"><h3>Log a lot by hand</h3><form id="f">${field('ingredient', 'Ingredient')}${field('supplier', 'Supplier')}${field('qty', 'Quantity', 'number', 'min="1" step="any"')}<label>Unit<select name="unit"><option>kg</option><option>L</option><option>units</option></select></label>${field('expiry', 'Expiry date', 'date')}<button class="submit">Receive lot</button></form></div>`;
    bind('#f', async d => { await api('/api/lots', 'POST', d); say('Lot logged and held in quarantine pending release.', 1); });
  } else if (ingestTab === 'csv') renderCsvTab(body);
  else if (ingestTab === 'photo') renderPhotoTab(body);
  else renderScaleTab(body);
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(l => l.split(',').map(c => c.trim()));
  return { headers, rows };
}

function renderCsvTab(body) {
  body.innerHTML = `<div class="ticket"><h3>Import a CSV of received stock</h3><p class="sub">Columns are matched automatically — confirm the mapping once and it's remembered for files with the same headers.</p>
  <label style="max-width:320px">Choose a .csv file<input type="file" id="csvfile" accept=".csv,text/csv"></label>
  <div id="csvout" style="margin-top:16px"></div></div>`;
  $('#csvfile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text();
    const { headers, rows } = parseCsv(text);
    lastPreview = { headers, rows };
    const res = await api('/api/import/preview', 'POST', { headers, rows });
    renderMapping(res, headers, rows);
  });
}

function renderMapping(res, headers, rows) {
  const FIELDS = ['', 'ingredient', 'supplier', 'qty', 'unit', 'expiry'];
  const out = $('#csvout');
  const matched = res.matchedSavedProfile ? `<div class="note">Matched a saved mapping (“${res.profileName}”) — reused automatically.</div>` : '';
  out.innerHTML = `${matched}
  <h3 style="font-size:14px;margin:14px 0 8px">Column mapping</h3>
  ${res.mapping.map((m, i) => `<div class="map-row" data-i="${i}"><span class="col-name">${m.column}</span><select data-role="field">${FIELDS.map(f => `<option value="${f}" ${f === m.field ? 'selected' : ''}>${f || '— skip —'}</option>`).join('')}</select><span class="conf">${m.confidence}%</span><span class="sub">${m.detectedUnit ? 'unit detected: ' + m.detectedUnit : ''}</span></div>`).join('')}
  <h3 style="font-size:14px;margin:18px 0 8px">Preview (first ${res.preview.length} rows)</h3>
  ${table(headers, res.preview.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`))}
  <form id="fconfirm" style="margin-top:16px"><label style="max-width:220px">Save this mapping as<input name="saveAs" placeholder="e.g. Supplier X format"></label><button class="submit">Confirm &amp; import ${rows.length} rows</button></form>`;
  bind('#fconfirm', async d => {
    const mapp = [...out.querySelectorAll('.map-row')].map(row => ({ column: headers[+row.dataset.i], field: row.querySelector('[data-role="field"]').value || null }));
    const r = await api('/api/import/confirm', 'POST', { headers, rows, mapping: mapp, saveAs: d.saveAs || null });
    say(`Imported ${r.imported} lots into quarantine.`, 1);
    out.innerHTML = '';
  });
}

function renderPhotoTab(body) {
  body.innerHTML = `<div class="ticket"><h3>Capture an invoice, GRN or batch sheet</h3>
  <div class="note sim">No vision model is connected in this demo — a photo returns a placeholder extraction for you to review and correct, matching the format a real vision API would return.</div>
  <form id="fkind"><label>Document type<select name="kind"><option value="invoice">Invoice</option><option value="grn">Goods received note</option></select></label><label style="max-width:220px">Photo<input type="file" name="photo" accept="image/*" capture="environment"></label><button class="submit">Extract fields</button></form>
  <div id="photoout" style="margin-top:16px"></div></div>`;
  bind('#fkind', async d => {
    const filename = d.photo instanceof File ? d.photo.name : 'capture.jpg';
    const r = await api('/api/ingest/photo', 'POST', { filename, kind: d.kind });
    $('#photoout').innerHTML = `<div class="note sim">${r.note} (confidence ${Math.round(r.confidence * 100)}%)</div>
    <form id="fverify">${field('ingredient', 'Ingredient')}${field('supplier', 'Supplier')}${field('qty', 'Quantity', 'number', 'min="1" step="any"')}<label>Unit<select name="unit"><option>kg</option><option>L</option><option>units</option></select></label>${field('expiry', 'Expiry date', 'date')}<button class="submit">Confirm &amp; log lot</button></form>`;
    const f = $('#fverify');
    f.ingredient.value = r.extracted.ingredient; f.supplier.value = r.extracted.supplier;
    f.qty.value = r.extracted.qty; f.unit.value = r.extracted.unit; f.expiry.value = r.extracted.expiry;
    bind('#fverify', async d2 => { await api('/api/ingest/photo/confirm', 'POST', d2); say('Reviewed extraction logged as a lot.', 1); });
  });
}

let scaleTimer = null;
function renderScaleTab(body) {
  body.innerHTML = `<div class="ticket"><h3>Live scale reading</h3>
  <div class="note sim">No scale hardware is connected in this demo. A real deployment reads this from an ESP32 over serial/Bluetooth, posting to <span class="code">POST /api/scale/reading</span> — the form below calls that same endpoint.</div>
  <div class="weight-display" id="wd">— <span>kg</span></div>
  <form id="f">${field('ingredient', 'Ingredient')}${field('supplier', 'Supplier')}${field('expiry', 'Expiry date', 'date')}<button class="submit">Log current reading as intake</button></form></div>`;
  const poll = async () => { try { const r = await api('/api/scale/live'); $('#wd').innerHTML = `${r.weight} <span>${r.unit}</span>`; } catch {} };
  poll(); scaleTimer = setInterval(poll, 1000);
  bind('#f', async d => {
    const r = await api('/api/scale/live');
    await api('/api/scale/reading', 'POST', { ...d, weight: r.weight, unit: r.unit, deviceId: 'demo-scale-01' });
    say(`Logged ${r.weight} ${r.unit} of ${d.ingredient} from the scale.`, 1);
  });
}

// ---------- Production (FEFO auto-pick) ----------
async function vBatches() {
  const [batches, bom] = await Promise.all([api('/api/batches'), api('/api/bom')]);
  const products = Object.keys(bom);
  view.innerHTML = `<h2>Production</h2><p class="sub">Pick a product and quantity — ingredients are auto-picked first-expiry-first-out from released stock</p>
  <div class="ticket"><h3>Log a batch</h3><form id="f"><label>Product<select name="product">${products.map(p => `<option>${p}</option>`).join('')}</select></label>${field('qty', 'Units to produce', 'number', 'min="1"')}<button class="submit">Produce (FEFO auto-pick)</button></form>
  <p class="sub" style="margin-top:10px">Recipe: ${products.map(p => `${p} — ${bom[p].map(i => `${i.qtyPerUnit} ${i.ingredient}/unit`).join(', ')}`).join(' · ')}</p></div>
  <div class="ticket"><h3>Batch register</h3>${table(['Batch', 'Product', 'Units', 'Date', 'Input lots (FEFO)', 'QC', ''], batches.map(b => `<tr><td>${code(b.id)}</td><td>${b.product}</td><td>${b.qty}</td><td>${b.date}</td><td>${b.inputs.map(i => `${code(i.lotId)} ${i.qty}`).join(', ')}</td><td>${stamp(b.qc)}</td><td>${['Pass', 'Fail'].filter(x => x !== b.qc).map(x => `<button class="mini" data-id="${b.id}" data-s="${x}">Mark ${x}</button>`).join('')}</td></tr>`))}</div>`;
  bind('#f', async d => { await api('/api/batches/auto', 'POST', d); say('Batch produced — ingredients auto-picked FEFO from released lots.', 1); vBatches(); });
  view.querySelectorAll('.mini').forEach(b => b.onclick = async () => { await api(`/api/batches/${b.dataset.id}/qc`, 'PATCH', { qc: b.dataset.s }); vBatches(); });
}

// ---------- Dispatch ----------
async function vShipments() {
  const [ships, batches] = await Promise.all([api('/api/shipments'), api('/api/batches')]);
  const passed = batches.filter(b => b.qc === 'Pass');
  view.innerHTML = `<h2>Dispatch</h2><p class="sub">Only batches that passed QC can be shipped</p>
  <div class="ticket"><h3>Log a shipment</h3><form id="f"><label>Batch<select name="batchId">${passed.map(b => `<option value="${b.id}">${b.id} · ${b.product}</option>`).join('') || '<option disabled>No QC-passed batches available</option>'}</select></label>${field('customer', 'Customer')}${field('qty', 'Units', 'number', 'min="1"')}<button class="submit">Ship batch</button></form></div>
  <div class="ticket"><h3>Dispatch register</h3>${table(['Shipment', 'Batch', 'Customer', 'Units', 'Date'], ships.map(s => `<tr><td>${code(s.id)}</td><td>${code(s.batchId)}</td><td>${s.customer}</td><td>${s.qty}</td><td>${s.date}</td></tr>`))}</div>`;
  bind('#f', async d => { await api('/api/shipments', 'POST', d); say('Shipment logged.', 1); vShipments(); });
}

// ---------- Trace, recall & audit (with barcode scanner) ----------
let scanStream = null;
async function vTrace() {
  view.innerHTML = `<h2>Trace &amp; recall</h2><p class="sub">Enter a lot or batch ID, or scan a barcode/QR label</p>
  <div class="ticket"><form id="f">${field('id', 'Lot or batch ID', 'text', 'placeholder="LOT-1001 or BAT-2001"')}<button class="submit">Trace</button><button type="button" class="submit ghost" id="scanBtn">Scan a label</button></form>
  <div id="scanArea" style="margin-top:14px"></div></div>
  <div id="out"></div>`;
  bind('#f', async d => { await runTrace(d.id); });
  $('#scanBtn').addEventListener('click', startScan);
}
async function runTrace(id) {
  const r = await api(`/api/trace/${encodeURIComponent(id)}`);
  const node = (a, b) => `<div class="node"><b>${a}</b><br>${b}</div>`;
  const ships = r.shipments.map(s => node(s.customer, `${s.id} · ${s.qty} units from ${s.batchId}`)).join('') || '<span class="sub">No shipments yet.</span>';
  const evRows = r.events.map(e => `<tr><td>${e.ts.replace('T', ' ').slice(0, 19)}</td><td>${e.type}</td><td><span class="src">${e.source}</span></td><td>${Math.round(e.confidence * 100)}%</td><td>${e.approver}</td></tr>`);
  const head = r.type === 'lot'
    ? `<div class="ticket"><h3>Lot ${r.lot.id} — ${r.lot.ingredient} from ${r.lot.supplier}</h3><p class="sub">Used in these batches</p><div class="chain">${r.batches.map(b => node(b.id, `${b.product} · QC ${b.qc}`)).join('') || '<span class="sub">Not used in production yet.</span>'}</div><p class="sub">Customers to notify</p><div class="chain">${ships}</div></div>`
    : `<div class="ticket"><h3>Batch ${r.batch.id} — ${r.batch.product} · QC ${r.batch.qc}</h3><p class="sub">Made from these ingredient lots</p><div class="chain">${r.lots.map(l => node(l.id, `${l.ingredient} · ${l.supplier}<br>${l.used} ${l.unit} used`)).join('')}</div><p class="sub">Shipped to</p><div class="chain">${ships}</div></div>`;
  $('#out').innerHTML = head + `<div class="ticket"><h3>Audit trail</h3>${table(['When', 'Event', 'Source', 'Confidence', 'Approver'], evRows)}</div>`;
  msg.textContent = '';
}
async function startScan() {
  const area = $('#scanArea');
  if (!('BarcodeDetector' in window)) { area.innerHTML = '<div class="note">Live scanning needs a supported browser (Chrome, Edge or Android) — enter the code manually above instead.</div>'; return; }
  area.innerHTML = '<video class="scan" autoplay playsinline muted></video>';
  const vid = area.querySelector('video');
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    vid.srcObject = scanStream;
    const detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13', 'code_39'] });
    const tick = async () => {
      if (!scanStream) return;
      try {
        const codes = await detector.detect(vid);
        if (codes.length) { stopScan(); await runTrace(codes[0].rawValue); return; }
      } catch {}
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (e) { area.innerHTML = `<div class="note">Camera access failed: ${e.message}</div>`; }
}
function stopScan() { if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; } $('#scanArea').innerHTML = ''; }

// ---------- Forecast & reorder ----------
async function vForecast() {
  const bom = await api('/api/bom');
  const products = Object.keys(bom);
  view.innerHTML = `<h2>Forecast &amp; reorder</h2><p class="sub">Simplified linear-trend forecast feeding a BOM-based reorder suggestion</p>
  <div class="ticket"><form id="f"><label>Product<select name="product">${products.map(p => `<option>${p}</option>`).join('')}</select></label><button class="submit">Forecast</button></form></div>
  <div id="fout"></div>`;
  bind('#f', async d => {
    const r = await api(`/api/forecast/${encodeURIComponent(d.product)}`);
    renderForecast(r);
  });
}
function renderForecast(r) {
  const max = Math.max(...r.series, ...r.forecast.points, 1);
  const histBars = r.series.map(v => `<div class="bar" style="height:${(v / max) * 100}%"><span>${v}</span></div>`).join('');
  const futBars = r.forecast.points.map(v => `<div class="bar future" style="height:${(v / max) * 100}%"><span>${v}</span></div>`).join('');
  const rows = r.reorder.map(x => `<tr><td>${x.ingredient}</td><td>${x.needed}</td><td>${x.stock}</td><td>${x.openPO}</td><td><b>${x.reorderQty}</b></td></tr>`);
  $('#fout').innerHTML = `
  ${!r.real ? `<div class="note">${r.note}</div>` : ''}
  <div class="ticket"><h3>Weekly demand: history and next 4 weeks</h3>
  <div class="legend"><span><i style="background:color-mix(in srgb, var(--accent) 55%, transparent)"></i>actual</span><span><i style="background:color-mix(in srgb, var(--amber) 55%, transparent)"></i>forecast</span></div>
  <div class="bars">${histBars}${futBars}</div>
  <p class="sub">Method: ${r.forecast.method}</p>
  <p class="sub">Backtest: ${r.backtest.mae !== null ? `MAE ${r.backtest.mae}, MAPE ${r.backtest.mape ?? '—'}%` : 'not enough history to backtest'}${r.backtest.note ? ' — ' + r.backtest.note : ''}</p>
  </div>
  <div class="ticket"><h3>Reorder suggestion (lead time ${r.leadTimeDays} days)</h3>${table(['Ingredient', 'Forecast need', 'On hand', 'Open POs', 'Suggested reorder'], rows)}
  <p class="sub">reorder qty = forecast demand × recipe ratio − stock on hand − open POs. Open POs aren't modeled yet, so they're treated as 0.</p></div>`;
}

// ---------- Nav ----------
const VIEWS = { dashboard: vDashboard, ingest: vIngest, batches: vBatches, shipments: vShipments, trace: vTrace, forecast: vForecast };
const go = v => {
  if (scaleTimer) { clearInterval(scaleTimer); scaleTimer = null; }
  stopScan();
  msg.textContent = '';
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  VIEWS[v]();
};
$('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.v) go(b.dataset.v); });
go('dashboard');
