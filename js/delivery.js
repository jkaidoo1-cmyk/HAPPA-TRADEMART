/* ============================================================
   HAPPA TRADEMART — Delivery Module (page rendering)
   ============================================================ */

// renderDeliveryPage is defined in app.js
// This file handles delivery calculation helpers and display

function getDeliveryEstimate(origin, dest, weight = 0.5) {
  const result = calcDelivery(origin, dest, weight);
  const sat = getNextSaturday();
  return {
    ...result,
    saturdayDate: sat,
    displayDate: sat.toLocaleDateString('en-GH', { weekday: 'long', day: 'numeric', month: 'long' }),
    message: result.intercity
      ? `Intercity delivery: GHS ${result.rate.toFixed(0)} (via Bolt Send / Ghana Post)`
      : `Local delivery: GHS ${result.rate.toFixed(0)}`
  };
}

function renderDeliveryEstimate(origin, dest, weight = 0.5, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const est = getDeliveryEstimate(origin, dest, weight);
  el.innerHTML = `
<div style="font-size:.85rem">
  <div style="display:flex;justify-content:space-between;margin-bottom:6px">
    <span><i class="fas fa-truck" style="color:var(--primary)"></i> ${est.intercity ? 'Intercity' : 'Local'} Delivery</span>
    <strong>GHS ${est.rate.toFixed(0)}</strong>
  </div>
  <div style="display:flex;justify-content:space-between">
    <span><i class="fas fa-calendar" style="color:var(--primary)"></i> Ships on</span>
    <strong>${est.displayDate}</strong>
  </div>
  ${est.intercity ? `<div style="font-size:.75rem;color:var(--text-muted);margin-top:6px"><i class="fas fa-info-circle"></i> Weight: ${weight}kg · Route: ${origin} → ${dest}</div>` : ''}
</div>`;
}
