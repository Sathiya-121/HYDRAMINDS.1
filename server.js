const express = require('express');
const path = require('path');
const ledger = require('./lib/ledger');
const mapping = require('./lib/mapping');
const forecastLib = require('./lib/forecast');

const app = express();
app.use(express.json({ limit: '2mb' }));

// All frontend files live in the repo root — no `public` folder to go missing on deploy.
['index.html', 'style.css', 'app.js'].forEach(f =>
  app.get(f === 'index.html' ? ['/', '/index.html'] : '/' + f, (_, res) => res.sendFile(path.join(__dirname, f))));

app.get('/healthz', (_, res) => res.send('ok'));

// Bill of materials — what one unit of a finished product consumes. Minimal, in-memory.
const BOM = {
  'Butter Biscuits': [{ ingredient: 'Wheat Flour', qtyPerUnit: 0.3 }, { ingredient: 'Sugar', qtyPerUnit: 0.1 }],
};
app.get('/api/bom', (_, res) => res.json(BOM));

// ---------- Summary ----------
app.get('/api/summary', (_, res) => {
  const soon = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  res.json({
    lots: ledger.lots.length,
    quarantined: ledger.lots.filter(l => l.status === 'Quarantine').length,
    expiringSoon: ledger.lots.filter(l => l.expiry <= soon && l.status !== 'Rejected').length,
    batches: ledger.batches.length,
    qcPending: ledger.batches.filter(b => b.qc === 'Pending').length,
    qcFailed: ledger.batches.filter(b => b.qc === 'Fail').length,
    shipments: ledger.shipments.length,
    events: ledger.events.length,
  });
});

// ---------- Lots (manual intake) ----------
app.get('/api/lots', (_, res) => res.json(ledger.lots));
app.post('/api/lots', (req, res) => {
  const { ingredient, supplier, qty, unit, expiry } = req.body;
  if (!ingredient || !supplier || !(qty > 0) || !expiry) return res.status(400).json({ error: 'ingredient, supplier, qty and expiry are required' });
  try { res.status(201).json(ledger.intake({ ingredient, supplier, qty, unit: unit || 'kg', expiry, source: 'manual', confidence: 1, approver: 'operator' })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.patch('/api/lots/:id/status', (req, res) => {
  try { res.json(ledger.setLotStatus(req.params.id, req.body.status, 'operator')); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- CSV ingestion ----------
app.post('/api/import/preview', (req, res) => {
  const { headers, rows } = req.body;
  if (!Array.isArray(headers) || !headers.length) return res.status(400).json({ error: 'headers are required' });
  const existing = mapping.findProfile(headers);
  const proposal = existing ? existing.mapping.map(m => ({ ...m, confidence: 100 })) : mapping.proposeMapping(headers);
  res.json({ mapping: proposal, matchedSavedProfile: !!existing, profileName: existing ? existing.name : null, preview: (rows || []).slice(0, 5) });
});
app.post('/api/import/confirm', (req, res) => {
  const { headers, rows, mapping: confirmedMapping, saveAs } = req.body;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows to import' });
  const idx = {};
  confirmedMapping.forEach(m => { if (m.field) idx[m.field] = headers.indexOf(m.column); });
  for (const f of ['ingredient', 'supplier', 'qty', 'expiry']) {
    if (idx[f] === undefined || idx[f] < 0) return res.status(400).json({ error: `Map a column to "${f}" before importing` });
  }
  const created = [];
  try {
    rows.forEach(r => {
      const rawUnit = idx.unit !== undefined && idx.unit >= 0 ? r[idx.unit] : 'kg';
      const { qty, unit } = mapping.convertUnit(+r[idx.qty], rawUnit);
      created.push(ledger.intake({ ingredient: r[idx.ingredient], supplier: r[idx.supplier], qty, unit, expiry: r[idx.expiry], source: 'csv', confidence: 1, approver: 'import-confirmed' }));
    });
  } catch (e) { return res.status(400).json({ error: e.message }); }
  if (saveAs) mapping.saveProfile(headers, confirmedMapping, saveAs);
  res.json({ imported: created.length, lots: created });
});

// ---------- Photo ingestion (SIMULATED — no vision model wired up in this demo) ----------
app.post('/api/ingest/photo', (req, res) => {
  const { filename, kind } = req.body;
  const guesses = {
    invoice: { ingredient: 'Wheat Flour', supplier: 'Sri Mills', qty: 250, unit: 'kg', expiry: '2027-04-01' },
    grn: { ingredient: 'Sugar', supplier: 'Annapoorna Traders', qty: 150, unit: 'kg', expiry: '2027-05-10' },
  };
  const extracted = guesses[kind] || guesses.invoice;
  res.json({
    simulated: true,
    note: 'Placeholder extraction — no vision model is connected in this demo. In production this call sends the photo to a vision API and returns real field values for you to review before saving.',
    filename, kind, extracted, confidence: 0.62,
  });
});
app.post('/api/ingest/photo/confirm', (req, res) => {
  const { ingredient, supplier, qty, unit, expiry } = req.body;
  if (!ingredient || !supplier || !(qty > 0) || !expiry) return res.status(400).json({ error: 'ingredient, supplier, qty and expiry are required' });
  res.status(201).json(ledger.intake({ ingredient, supplier, qty, unit: unit || 'kg', expiry, source: 'photo-vision', confidence: 0.62, approver: 'reviewer' }));
});

// ---------- Scale (SIMULATED — no hardware connected in this demo) ----------
app.get('/api/scale/live', (_, res) => {
  const t = Date.now() / 1000;
  const weight = +(40 + 3 * Math.sin(t / 5) + (Math.random() - 0.5) * 0.8).toFixed(2);
  res.json({ simulated: true, weight, unit: 'kg', note: 'No scale hardware is connected in this demo. A real deployment reads this from an ESP32 (serial/Bluetooth to HTTP or MQTT) posting to POST /api/scale/reading.' });
});
app.post('/api/scale/reading', (req, res) => {
  const { ingredient, supplier, weight, unit, expiry, deviceId } = req.body;
  if (!ingredient || !supplier || !(weight > 0) || !expiry) return res.status(400).json({ error: 'ingredient, supplier, weight and expiry are required' });
  res.status(201).json(ledger.intake({ ingredient, supplier, qty: weight, unit: unit || 'kg', expiry, source: 'scale', confidence: 0.9, approver: deviceId || 'scale-device' }));
});

// ---------- Production (FEFO auto-pick against the BOM) ----------
app.get('/api/batches', (_, res) => res.json(ledger.batches));
app.post('/api/batches/auto', (req, res) => {
  const { product, qty } = req.body;
  const bom = BOM[product];
  if (!bom) return res.status(400).json({ error: `No recipe (BOM) on file for "${product}"` });
  if (!(qty > 0)) return res.status(400).json({ error: 'qty must be greater than 0' });
  try {
    const ingredients = bom.map(b => ({ ingredient: b.ingredient, qty: +(b.qtyPerUnit * qty).toFixed(3) }));
    res.status(201).json(ledger.produceBatch({ product, qty, ingredients, approver: 'operator' }));
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.patch('/api/batches/:id/qc', (req, res) => {
  try { res.json(ledger.setQc(req.params.id, req.body.qc, 'qc-inspector')); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Dispatch ----------
app.get('/api/shipments', (_, res) => res.json(ledger.shipments));
app.post('/api/shipments', (req, res) => {
  try { res.status(201).json(ledger.ship({ ...req.body, approver: 'dispatch' })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- Trace, recall and audit ----------
app.get('/api/trace/:id', (req, res) => {
  const r = ledger.trace(req.params.id);
  if (!r) return res.status(404).json({ error: `No lot or batch found for ${req.params.id}` });
  res.json(r);
});
app.get('/api/events', (_, res) => res.json(ledger.events.slice(-100).reverse()));

// ---------- Forecast & reorder ----------
function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - onejan) / 864e5 + onejan.getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
function demandSeries(product) {
  const rows = ledger.shipments.filter(s => { const b = ledger.batches.find(x => x.id === s.batchId); return b && b.product === product; });
  if (rows.length < 4) return { series: [8, 10, 9, 13, 11, 15], real: false, note: `Not enough real shipment history for ${product} yet — this uses an illustrative synthetic series so the calculation can be demoed. Connect real order history for a meaningful forecast.` };
  const byWeek = {};
  rows.forEach(s => { const wk = isoWeek(s.date); byWeek[wk] = (byWeek[wk] || 0) + s.qty; });
  return { series: Object.keys(byWeek).sort().map(k => byWeek[k]), real: true, note: null };
}
app.get('/api/forecast/:product', (req, res) => {
  const product = decodeURIComponent(req.params.product);
  const bom = BOM[product];
  if (!bom) return res.status(404).json({ error: `No recipe (BOM) on file for ${product}` });
  const { series, real, note } = demandSeries(product);
  const fc = forecastLib.forecast(series, 4);
  const bt = forecastLib.backtest(series, Math.max(1, Math.min(2, Math.floor(series.length / 3))));
  const demandOverWindow = fc.points.reduce((a, b) => a + b, 0);
  const suggestion = forecastLib.reorderSuggestion(demandOverWindow, bom, ledger.stockByIngredient());
  res.json({ product, series, real, note, forecast: fc, backtest: bt, leadTimeDays: 7, reorder: suggestion });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FoodTrace ERP running on port ${PORT}`));
