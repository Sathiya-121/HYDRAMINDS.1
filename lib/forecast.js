// Simplified forecasting — a linear-trend model, not Prophet/statsmodels.
// Swap this module for a small Python service (Prophet or statsmodels) in production;
// this keeps the demo to a single deployable Node service and is honest about the trade-off.

function linearTrend(series) {
  const n = series.length;
  const xs = series.map((_, i) => i);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = series.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - xMean) * (series[i] - yMean); den += (xs[i] - xMean) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  return x => intercept + slope * x;
}

function forecast(series, periodsAhead = 4) {
  if (series.length < 2) return { points: Array(periodsAhead).fill(series[0] || 0), method: 'flat (not enough history for a trend)' };
  const predict = linearTrend(series);
  const points = [];
  for (let i = 0; i < periodsAhead; i++) points.push(Math.max(0, Math.round(predict(series.length + i))));
  return { points, method: 'linear trend (simplified — not Prophet/statsmodels)' };
}

function backtest(series, holdout = 2) {
  if (series.length < holdout + 2) return { mae: null, mape: null, note: 'Not enough history for a meaningful backtest.' };
  const train = series.slice(0, -holdout);
  const test = series.slice(-holdout);
  const predict = linearTrend(train);
  const errs = [], pctErrs = [];
  test.forEach((actual, i) => {
    const pred = Math.max(0, predict(train.length + i));
    errs.push(Math.abs(pred - actual));
    if (actual !== 0) pctErrs.push(Math.abs(pred - actual) / actual);
  });
  const mae = errs.reduce((a, b) => a + b, 0) / errs.length;
  const mape = pctErrs.length ? (pctErrs.reduce((a, b) => a + b, 0) / pctErrs.length) * 100 : null;
  return {
    mae: +mae.toFixed(2),
    mape: mape !== null ? +mape.toFixed(1) : null,
    note: series.length < 8 ? 'Small sample — treat this error estimate as illustrative, not reliable.' : null,
  };
}

// reorderQty = forecast demand over the window × BOM ratio − stock on hand − open POs
function reorderSuggestion(demandOverWindow, bom, stockByIngredient, openPOs = {}) {
  return bom.map(({ ingredient, qtyPerUnit }) => {
    const needed = +(demandOverWindow * qtyPerUnit).toFixed(2);
    const stock = stockByIngredient[ingredient] || 0;
    const openPO = openPOs[ingredient] || 0;
    return { ingredient, needed, stock, openPO, reorderQty: Math.max(0, +(needed - stock - openPO).toFixed(2)) };
  });
}

module.exports = { forecast, backtest, reorderSuggestion, linearTrend };
