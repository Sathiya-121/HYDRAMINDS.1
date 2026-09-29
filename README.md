# FoodTrace — "The ERP that fills itself"

Cloud-based food manufacturing ERP & traceability platform. Node.js + Express backend,
plain HTML/CSS/JS frontend, all files in the repo root (no `public` folder, so Render
deploys with no extra config).

## Run locally
```
npm install
npm start   -> http://localhost:3000
```

## Deploy on Render
Language: Node · Build: `npm install` · Start: `npm start` · Root Directory: blank

## What's genuinely real in this demo

- **Event-sourced ledger** (`lib/ledger.js`) — every stock change is a logged event
  with source, confidence and approver. Lots, batches and shipments are derived state;
  trace, recall and the audit trail (see any Trace page) come from replaying the same log.
- **FEFO auto-picking** — Production creates a batch by product + quantity; the ledger
  auto-selects released stock soonest-expiry-first across as many lots as needed.
- **CSV import with column mapping** (`lib/mapping.js`) — a rule-based header matcher
  proposes a mapping (ingredient/supplier/qty/unit/expiry), converts g→kg and ml→L, and
  remembers a confirmed mapping by header signature so a file with the same columns
  auto-matches next time. This is heuristic pattern matching, not a live LLM call —
  swap in a real model call for genuinely ambiguous spreadsheets.
- **Barcode/QR scanning** — uses the browser's native `BarcodeDetector` API to scan a
  label with the camera and jump straight to its trace record. Falls back to manual
  entry on browsers that don't support it (Safari, Firefox).
- **Forecast & reorder** (`lib/forecast.js`) — a simplified linear-trend model (not
  Prophet/statsmodels — that would mean a second Python service; this keeps the demo
  to one deployable app) feeds `reorder = forecast × BOM ratio − stock − open POs`.
  The backtest error (MAE/MAPE) is shown honestly, including a note when the sample
  is too small to trust the number.

## What's simulated or stubbed, and clearly labeled as such in the UI

- **Photo → vision extraction** (Ingest → Photo tab) — no vision API is wired up.
  It returns a placeholder JSON extraction, in the shape a real one would return, for
  you to review and correct before it's saved. Swap in a real vision API call in
  `POST /api/ingest/photo`.
- **Scale weighing** (Ingest → Scale tab) — no hardware is connected. The UI shows a
  simulated drifting live reading. `POST /api/scale/reading` is the exact endpoint a
  real ESP32 (reading a scale over serial/Bluetooth and posting over HTTP or MQTT)
  would call — wire real hardware to that same endpoint and the rest of the app
  doesn't change. Photographing the scale display with OCR as a fallback is not built.

## Not built yet (explicitly out of scope for this pass)

- **Tally XML export/import** — most Indian SMEs use Tally, but the exact XML schema
  needs to be verified against your Tally version before building it; nothing here
  claims to support it.
- **Watched folder / Drive sync** for automatic CSV ingestion — the CSV tab requires
  a manual file pick each time.
- **Persistence** — the ledger lives in memory and resets on every restart. The next
  real step is PostgreSQL (Render has a free tier); the ledger's event-log shape maps
  onto a single append-only table quite directly.
- **Open purchase orders** — the reorder formula treats open POs as 0 since there's
  no PO entity yet.
