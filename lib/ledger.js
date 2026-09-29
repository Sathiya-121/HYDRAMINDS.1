// Event-sourced stock ledger.
// Every change to stock is recorded as an event (type, source, confidence, approver).
// Lots, batches and shipments are the current state derived from replaying those events,
// so trace, recall and audit are just reads over the same event log.

const events = [];
const lots = [];
const batches = [];
const shipments = [];
const nextNum = { LOT: 1001, BAT: 2001, SHP: 3001 };

const newId = prefix => `${prefix}-${nextNum[prefix]++}`;
const today = () => new Date().toISOString().slice(0, 10);

function record(type, source, confidence, approver, payload) {
  const ev = { id: `EVT-${events.length + 1}`, type, ts: new Date().toISOString(), source, confidence, approver, payload };
  events.push(ev);
  return ev;
}

function intake({ ingredient, supplier, qty, unit, expiry, source = 'manual', confidence = 1, approver = '—' }) {
  const lot = { id: newId('LOT'), ingredient, supplier, qty: +qty, unit, received: today(), expiry, status: 'Quarantine' };
  lots.push(lot);
  record('intake', source, confidence, approver, { lotId: lot.id, ingredient, supplier, qty: +qty, unit, expiry });
  return lot;
}

function setLotStatus(id, status, approver = '—') {
  const lot = lots.find(l => l.id === id);
  if (!lot) throw new Error('Lot not found');
  if (!['Released', 'Quarantine', 'Rejected'].includes(status)) throw new Error('Invalid status');
  lot.status = status;
  record('lot_status', 'manual', 1, approver, { lotId: id, status });
  return lot;
}

// First-expiry-first-out: pick across released lots of one ingredient, soonest expiry first.
function fefoPick(ingredient, qtyNeeded) {
  const pool = lots
    .filter(l => l.ingredient === ingredient && l.status === 'Released' && l.qty > 0)
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
  const picks = [];
  let remaining = qtyNeeded;
  for (const l of pool) {
    if (remaining <= 0) break;
    const take = Math.min(l.qty, remaining);
    picks.push({ lotId: l.id, qty: +take.toFixed(3), expiry: l.expiry });
    remaining -= take;
  }
  if (remaining > 1e-6) throw new Error(`Not enough released stock of ${ingredient} — short by ${remaining.toFixed(2)}`);
  return picks;
}

function produceBatch({ product, qty, ingredients, approver = '—' }) {
  // ingredients: [{ ingredient, qty }] — the quantities actually needed (already scaled by the caller)
  const inputs = [];
  const applied = [];
  try {
    for (const req of ingredients) {
      const picks = fefoPick(req.ingredient, req.qty);
      picks.forEach(p => applied.push({ ...p, ingredient: req.ingredient }));
    }
  } catch (e) {
    throw e; // nothing deducted yet, safe to abort
  }
  applied.forEach(p => {
    const lot = lots.find(l => l.id === p.lotId);
    lot.qty = +(lot.qty - p.qty).toFixed(3);
    inputs.push({ lotId: p.lotId, ingredient: p.ingredient, qty: p.qty });
  });
  const batch = { id: newId('BAT'), product, qty: +qty, date: today(), qc: 'Pending', inputs };
  batches.push(batch);
  record('produce', 'manual', 1, approver, { batchId: batch.id, product, qty: +qty, inputs });
  return batch;
}

function setQc(id, qc, approver = '—') {
  const b = batches.find(x => x.id === id);
  if (!b) throw new Error('Batch not found');
  if (!['Pass', 'Fail', 'Pending'].includes(qc)) throw new Error('Invalid QC result');
  b.qc = qc;
  record('qc', 'manual', 1, approver, { batchId: id, qc });
  return b;
}

function ship({ batchId, customer, qty, approver = '—' }) {
  const b = batches.find(x => x.id === batchId);
  if (!b) throw new Error('Batch not found');
  if (b.qc !== 'Pass') throw new Error(`${b.id} QC is ${b.qc}; only passed batches can ship`);
  const shipped = shipments.filter(s => s.batchId === b.id).reduce((a, s) => a + s.qty, 0);
  if (shipped + +qty > b.qty) throw new Error(`Only ${b.qty - shipped} units left in ${b.id}`);
  const s = { id: newId('SHP'), batchId, customer, qty: +qty, date: today() };
  shipments.push(s);
  record('ship', 'manual', 1, approver, { shipmentId: s.id, batchId, customer, qty: +qty });
  return s;
}

function trace(rawId) {
  const id = rawId.trim().toUpperCase();
  const evs = events.filter(e => JSON.stringify(e.payload).includes(id));
  const lot = lots.find(l => l.id === id);
  if (lot) {
    const bs = batches.filter(b => b.inputs.some(i => i.lotId === id));
    const ss = shipments.filter(s => bs.some(b => b.id === s.batchId));
    return { type: 'lot', lot, batches: bs, shipments: ss, events: evs };
  }
  const batch = batches.find(b => b.id === id);
  if (batch) {
    const usedLots = batch.inputs.map(i => ({ ...lots.find(l => l.id === i.lotId), used: i.qty }));
    const ss = shipments.filter(s => s.batchId === id);
    return { type: 'batch', batch, lots: usedLots, shipments: ss, events: evs };
  }
  return null;
}

function stockByIngredient() {
  const map = {};
  lots.forEach(l => { if (l.status !== 'Rejected') map[l.ingredient] = +((map[l.ingredient] || 0) + l.qty).toFixed(3); });
  return map;
}

function seed() {
  const l1 = intake({ ingredient: 'Wheat Flour', supplier: 'Sri Mills', qty: 380, unit: 'kg', expiry: '2027-03-20', approver: 'seed' });
  setLotStatus(l1.id, 'Released', 'seed');
  const l2 = intake({ ingredient: 'Sugar', supplier: 'Annapoorna Traders', qty: 260, unit: 'kg', expiry: '2027-06-01', approver: 'seed' });
  setLotStatus(l2.id, 'Released', 'seed');
  intake({ ingredient: 'Palm Oil', supplier: 'Coastal Agro', qty: 200, unit: 'L', expiry: '2027-01-15', approver: 'seed' });

  const b1 = produceBatch({ product: 'Butter Biscuits', qty: 400, ingredients: [{ ingredient: 'Wheat Flour', qty: 120 }, { ingredient: 'Sugar', qty: 40 }], approver: 'seed' });
  setQc(b1.id, 'Pass', 'seed');
  ship({ batchId: b1.id, customer: 'FreshMart Chennai', qty: 200, approver: 'seed' });
}
seed();

module.exports = {
  intake, setLotStatus, fefoPick, produceBatch, setQc, ship, trace, stockByIngredient,
  get lots() { return lots; },
  get batches() { return batches; },
  get shipments() { return shipments; },
  get events() { return events; },
};
