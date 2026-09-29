// Heuristic column mapper for CSV intake.
// This is rule-based pattern matching, not a call to an LLM — swap in a real
// model call here for genuinely ambiguous spreadsheets; this covers the common cases.

const TARGET_FIELDS = ['ingredient', 'supplier', 'qty', 'unit', 'expiry'];
const SYNONYMS = {
  ingredient: ['ingredient', 'item', 'material', 'product', 'description', 'itemname'],
  supplier: ['supplier', 'vendor', 'party', 'source', 'suppliername'],
  qty: ['qty', 'quantity', 'amount', 'weight', 'received'],
  unit: ['unit', 'uom', 'units', 'measure'],
  expiry: ['expiry', 'expirydate', 'exp', 'bestbefore', 'useby', 'usebydate', 'bbd'],
};
const UNIT_WORDS = ['kg', 'g', 'gm', 'l', 'ltr', 'ml', 'litre', 'litres', 'liters', 'units', 'pcs'];

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

function proposeMapping(headers) {
  return headers.map(h => {
    const n = norm(h);
    let field = null, confidence = 0;
    for (const f of TARGET_FIELDS) {
      for (const syn of SYNONYMS[f]) {
        const sn = norm(syn);
        if (n === sn) { field = f; confidence = 1; break; }
        if (n.includes(sn)) {
          const score = sn.length / n.length;
          if (score > confidence) { field = f; confidence = score; }
        }
      }
      if (confidence === 1) break;
    }
    const bracket = String(h).match(/\(([a-zA-Z]+)\)/);
    const detectedUnit = bracket && UNIT_WORDS.includes(bracket[1].toLowerCase()) ? bracket[1].toLowerCase() : null;
    return { column: h, field, confidence: Math.round(confidence * 100), detectedUnit };
  });
}

function convertUnit(qty, rawUnit) {
  const u = String(rawUnit || '').toLowerCase();
  if (['g', 'gm', 'gms', 'grams'].includes(u)) return { qty: +(qty / 1000).toFixed(3), unit: 'kg' };
  if (['ml', 'milliliter', 'milliliters'].includes(u)) return { qty: +(qty / 1000).toFixed(3), unit: 'L' };
  if (['kg', 'kgs'].includes(u)) return { qty, unit: 'kg' };
  if (['l', 'ltr', 'litre', 'liters', 'litres'].includes(u)) return { qty, unit: 'L' };
  if (['units', 'unit', 'pcs', 'pieces'].includes(u)) return { qty, unit: 'units' };
  return { qty, unit: rawUnit || 'units' };
}

// Saved mapping profiles, keyed by a signature of the normalized header row —
// this is what lets "later files import automatically" once a format is confirmed once.
const profiles = new Map();
const signatureOf = headers => headers.map(norm).join('|');
function saveProfile(headers, mapping, name) { profiles.set(signatureOf(headers), { name, mapping, headers }); }
function findProfile(headers) { return profiles.get(signatureOf(headers)) || null; }

module.exports = { proposeMapping, convertUnit, saveProfile, findProfile, signatureOf };
