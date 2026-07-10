/* ============================================================
   HAPPA TRADEMART — Wallet Module
   Handles deposits (all users) and withdrawal requests (vendors)
   ============================================================ */

const DEPOSIT_METHODS = [
  { id: 'mobile_money', icon: '📱', label: 'Mobile Money',    desc: 'MTN, Vodafone, AirtelTigo' },
  { id: 'card',         icon: '💳', label: 'Bank / Debit Card', desc: 'Visa, Mastercard, GhIPSS' },
];

const WITHDRAW_METHODS = [
  { id: 'mobile_money',  icon: '📱', label: 'Mobile Money',  desc: 'MTN, Vodafone, AirtelTigo' },
  { id: 'bank_transfer', icon: '🏦', label: 'Bank Transfer', desc: 'GCB, Ecobank, Fidelity, etc.' },
];

const MOMO_NETWORKS  = ['MTN Mobile Money', 'Vodafone Cash', 'AirtelTigo Money'];
const BANKS_GH       = ['GCB Bank', 'Ecobank Ghana', 'Fidelity Bank', 'Standard Chartered', 'Absa Ghana', 'Cal Bank', 'Stanbic Bank', 'Access Bank'];
const MIN_DEPOSIT    = 1;
const MIN_WITHDRAWAL = 10;
const MAX_WITHDRAWAL_PENDING = 1; // max simultaneous pending withdrawals

// ─────────────────────────────────────────────────────────────
// DEPOSIT MODAL (buyers & vendors)
// ─────────────────────────────────────────────────────────────
function showDepositModal() {
  if (!App.currentUser) { showPage('auth'); return; }
  const u = App.currentUser;

  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">💰 Top Up Wallet</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">

  <!-- Current Balance -->
  <div style="background:linear-gradient(135deg,var(--secondary),#16213e);border-radius:var(--radius-md);padding:14px 16px;color:#fff;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="font-size:.75rem;opacity:.75">Current Balance</div>
      <div style="font-size:1.4rem;font-weight:800">GHS ${(u.wallet_balance||0).toFixed(2)}</div>
    </div>
    <i class="fas fa-wallet" style="font-size:1.8rem;opacity:.5"></i>
  </div>

  <!-- Amount -->
  <div class="form-group">
    <label class="form-label">Amount (GHS) *</label>
    <div class="input-group">
      <span class="input-icon" style="font-weight:700;color:var(--primary);font-size:.9rem">GHS</span>
      <input class="form-control" id="dep-amount" type="number" min="${MIN_DEPOSIT}" step="0.01"
             placeholder="e.g. 50.00" oninput="updateDepositPreview()" style="padding-left:48px">
    </div>
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap" id="dep-quick-btns">
      ${[20,50,100,200,500].map(a => `
        <button class="btn btn-outline btn-sm" onclick="setDepositAmount(${a})">GHS ${a}</button>
      `).join('')}
    </div>
  </div>

  <!-- Payment Method -->
  <div class="form-group">
    <label class="form-label">Payment Method *</label>
    <div id="dep-method-list">
      ${DEPOSIT_METHODS.map((m, i) => `
      <div class="payment-option${i===0?' selected':''}" id="dep-method-${m.id}" onclick="selectDepositMethod('${m.id}')">
        <span class="payment-icon">${m.icon}</span>
        <div><div class="payment-name">${m.label}</div><div class="payment-desc">${m.desc}</div></div>
        <i id="dep-check-${m.id}" class="fas fa-${i===0?'check-circle':'circle'}"
           style="margin-left:auto;color:${i===0?'var(--primary)':'var(--border)'}"></i>
      </div>`).join('')}
    </div>
  </div>

  <!-- Dynamic Fields -->
  <div id="dep-dynamic-fields">
    ${buildMoMoFields('dep')}
  </div>

  <!-- Preview -->
  <div id="dep-preview" style="display:none;background:var(--primary-light);border:1px solid rgba(232,93,4,.25);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:14px;font-size:.85rem">
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span>Amount</span><strong id="dep-prev-amount">GHS 0.00</strong>
    </div>
    <div style="display:flex;justify-content:space-between">
      <span>New Balance</span><strong id="dep-prev-balance" style="color:var(--primary)">GHS 0.00</strong>
    </div>
  </div>

  <input type="hidden" id="dep-selected-method" value="mobile_money">
  <button class="btn btn-primary btn-block btn-lg" onclick="submitDeposit()">
    <i class="fas fa-arrow-down"></i> Deposit to Wallet
  </button>
  <p style="text-align:center;font-size:.72rem;color:var(--text-muted);margin-top:8px">
    🔒 Payments processed securely via Paystack
  </p>
</div>`);
}

function selectDepositMethod(methodId) {
  document.getElementById('dep-selected-method').value = methodId;
  DEPOSIT_METHODS.forEach(m => {
    const opt = document.getElementById(`dep-method-${m.id}`);
    const chk = document.getElementById(`dep-check-${m.id}`);
    if (!opt || !chk) return;
    const active = m.id === methodId;
    opt.classList.toggle('selected', active);
    chk.className = `fas fa-${active ? 'check-circle' : 'circle'}`;
    chk.style.color = active ? 'var(--primary)' : 'var(--border)';
  });
  const dynFields = document.getElementById('dep-dynamic-fields');
  if (dynFields) dynFields.innerHTML = methodId === 'mobile_money' ? buildMoMoFields('dep') : buildCardFields('dep');
}

function setDepositAmount(amount) {
  const inp = document.getElementById('dep-amount');
  if (inp) { inp.value = amount; updateDepositPreview(); }
}

function updateDepositPreview() {
  const amount = parseFloat(document.getElementById('dep-amount')?.value) || 0;
  const preview = document.getElementById('dep-preview');
  const prevAmount  = document.getElementById('dep-prev-amount');
  const prevBalance = document.getElementById('dep-prev-balance');
  if (!preview) return;
  if (amount >= MIN_DEPOSIT) {
    preview.style.display = 'block';
    if (prevAmount)  prevAmount.textContent  = `GHS ${amount.toFixed(2)}`;
    if (prevBalance) prevBalance.textContent = `GHS ${((App.currentUser?.wallet_balance||0) + amount).toFixed(2)}`;
  } else {
    preview.style.display = 'none';
  }
}

async function submitDeposit() {
  const amount = parseFloat(document.getElementById('dep-amount')?.value);
  const method = document.getElementById('dep-selected-method')?.value;

  if (!amount || amount < MIN_DEPOSIT) {
    showToast(`Minimum deposit is GHS ${MIN_DEPOSIT}`, 'warning'); return;
  }

  // Validate method-specific fields
  if (method === 'mobile_money') {
    const network = document.getElementById('dep-network')?.value;
    const num     = document.getElementById('dep-momo-num')?.value.trim();
    if (!num) { showToast('Enter your MoMo number', 'warning'); return; }
    await processDeposit(amount, method, network, num, `MOMO${Date.now()}`);
  } else {
    // Card – in real app Paystack popup would appear
    await processDeposit(amount, method, 'Card', '****', `CARD${Date.now()}`);
  }
}

async function processDeposit(amount, method, network, accountNum, ref) {
  const u = App.currentUser;
  const balBefore = u.wallet_balance || 0;
  const balAfter  = balBefore + amount;

  // 1. Record transaction
  const txn = await apiPost('wallet_transactions', {
    user_id: u.id, type: 'deposit', amount,
    balance_before: balBefore, balance_after: balAfter,
    payment_method: method, payment_ref: ref,
    network, account_number: accountNum,
    status: 'completed', note: 'Wallet top-up', reviewed_by: ''
  });

  if (!txn) { showToast('Transaction failed. Please try again.', 'error'); return; }

  // 2. Update user wallet balance
  await apiPatch('users', u.id, { wallet_balance: balAfter });
  App.currentUser.wallet_balance = balAfter;
  saveSessions();

  // 3. Notify
  addNotification(u.id, 'system', '💰 Deposit Successful!',
    `GHS ${amount.toFixed(2)} added to your wallet. New balance: GHS ${balAfter.toFixed(2)}`);

  closeModalForce();
  showToast(`GHS ${amount.toFixed(2)} deposited successfully! 🎉`, 'success');

  // Refresh current dashboard
  if (u.role === 'vendor') renderVendorDashboard();
  else renderBuyerDashboard();
}


// ─────────────────────────────────────────────────────────────
// WITHDRAWAL MODAL (vendors only)
// ─────────────────────────────────────────────────────────────
async function showWithdrawalModal() {
  if (!App.currentUser) { showPage('auth'); return; }
  const u = App.currentUser;

  if (u.role !== 'vendor') {
    showToast('Only vendors can request withdrawals', 'warning'); return;
  }
  if (!u.is_verified || !u.id_verified) {
    showToast('Complete phone & ID verification before withdrawing', 'warning'); return;
  }

  const balance = u.wallet_balance || 0;

  // Check for existing pending withdrawals
  const txnRes = await apiGet('wallet_transactions', `search=${u.id}&limit=50`);
  const myTxns = (txnRes?.data || []).filter(t => t.user_id === u.id);
  const pendingWithdrawals = myTxns.filter(t => t.type === 'withdrawal' && t.status === 'pending');

  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">🏧 Withdraw Earnings</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">

  <!-- Balance Card -->
  <div style="background:linear-gradient(135deg,var(--success),#16a34a);border-radius:var(--radius-md);padding:14px 16px;color:#fff;margin-bottom:18px">
    <div style="font-size:.75rem;opacity:.8;margin-bottom:2px">Available Balance</div>
    <div style="font-size:1.6rem;font-weight:800">GHS ${balance.toFixed(2)}</div>
    <div style="font-size:.75rem;opacity:.75;margin-top:4px">Balance releases after delivery confirmation</div>
  </div>

  ${pendingWithdrawals.length >= MAX_WITHDRAWAL_PENDING ? `
  <div class="verify-banner" style="background:#fff7ed;border-color:#fb923c;margin-bottom:14px">
    <i class="fas fa-clock" style="color:#ea580c"></i>
    <p>You have a pending withdrawal request. Wait for it to be processed before submitting another.</p>
  </div>
  <button class="btn btn-ghost btn-block" onclick="closeModalForce()">Close</button>
  ` : balance < MIN_WITHDRAWAL ? `
  <div class="empty-state" style="padding:20px 0">
    <i class="fas fa-coins"></i>
    <h3>Insufficient Balance</h3>
    <p>Minimum withdrawal is GHS ${MIN_WITHDRAWAL}. Your balance is GHS ${balance.toFixed(2)}.</p>
  </div>
  <button class="btn btn-ghost btn-block" onclick="closeModalForce()">Close</button>
  ` : `
  <!-- Amount -->
  <div class="form-group">
    <label class="form-label">Amount to Withdraw (GHS) *</label>
    <div class="input-group">
      <span class="input-icon" style="font-weight:700;color:var(--success);font-size:.9rem">GHS</span>
      <input class="form-control" id="wd-amount" type="number" min="${MIN_WITHDRAWAL}"
             max="${balance.toFixed(2)}" step="0.01"
             placeholder="Min GHS ${MIN_WITHDRAWAL}" oninput="updateWithdrawPreview(${balance})" style="padding-left:48px">
    </div>
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
      ${[50, 100, 200, 500].filter(a => a <= balance).map(a =>
        `<button class="btn btn-outline btn-sm" onclick="setWithdrawAmount(${a},${balance})">GHS ${a}</button>`
      ).join('')}
      <button class="btn btn-outline btn-sm" onclick="setWithdrawAmount(${balance.toFixed(2)},${balance})">All</button>
    </div>
  </div>

  <!-- Withdrawal Method -->
  <div class="form-group">
    <label class="form-label">Withdrawal Method *</label>
    <div id="wd-method-list">
      ${WITHDRAW_METHODS.map((m, i) => `
      <div class="payment-option${i===0?' selected':''}" id="wd-method-${m.id}" onclick="selectWithdrawMethod('${m.id}')">
        <span class="payment-icon">${m.icon}</span>
        <div><div class="payment-name">${m.label}</div><div class="payment-desc">${m.desc}</div></div>
        <i id="wd-check-${m.id}" class="fas fa-${i===0?'check-circle':'circle'}"
           style="margin-left:auto;color:${i===0?'var(--primary)':'var(--border)'}"></i>
      </div>`).join('')}
    </div>
  </div>

  <!-- Dynamic Account Fields -->
  <div id="wd-dynamic-fields">
    ${buildMoMoFields('wd')}
  </div>

  <!-- Preview -->
  <div id="wd-preview" style="display:none;background:#f0fdf4;border:1px solid #86efac;border-radius:var(--radius-md);padding:12px 14px;margin-bottom:14px;font-size:.85rem">
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span>Withdrawal Amount</span><strong id="wd-prev-amount">GHS 0.00</strong>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px">
      <span>Remaining Balance</span><strong id="wd-prev-balance" style="color:var(--success)">GHS 0.00</strong>
    </div>
    <div style="font-size:.75rem;color:var(--text-muted);margin-top:4px">
      <i class="fas fa-info-circle"></i> Processed within 1–2 business days
    </div>
  </div>

  <input type="hidden" id="wd-selected-method" value="mobile_money">
  <button class="btn btn-success btn-block btn-lg" onclick="submitWithdrawal(${balance})">
    <i class="fas fa-paper-plane"></i> Submit Withdrawal Request
  </button>
  <p style="text-align:center;font-size:.72rem;color:var(--text-muted);margin-top:8px">
    Requests are reviewed and paid within 1–2 business days
  </p>`}
</div>`);
}

function selectWithdrawMethod(methodId) {
  document.getElementById('wd-selected-method').value = methodId;
  WITHDRAW_METHODS.forEach(m => {
    const opt = document.getElementById(`wd-method-${m.id}`);
    const chk = document.getElementById(`wd-check-${m.id}`);
    if (!opt || !chk) return;
    const active = m.id === methodId;
    opt.classList.toggle('selected', active);
    chk.className = `fas fa-${active ? 'check-circle' : 'circle'}`;
    chk.style.color = active ? 'var(--primary)' : 'var(--border)';
  });
  const dynFields = document.getElementById('wd-dynamic-fields');
  if (dynFields) dynFields.innerHTML = methodId === 'mobile_money' ? buildMoMoFields('wd') : buildBankFields('wd');
}

function setWithdrawAmount(amount, max) {
  const inp = document.getElementById('wd-amount');
  if (inp) { inp.value = Math.min(amount, max); updateWithdrawPreview(max); }
}

function updateWithdrawPreview(balance) {
  const amount  = parseFloat(document.getElementById('wd-amount')?.value) || 0;
  const preview = document.getElementById('wd-preview');
  const prevAmt = document.getElementById('wd-prev-amount');
  const prevBal = document.getElementById('wd-prev-balance');
  if (!preview) return;
  if (amount >= MIN_WITHDRAWAL && amount <= balance) {
    preview.style.display = 'block';
    if (prevAmt) prevAmt.textContent = `GHS ${amount.toFixed(2)}`;
    if (prevBal) prevBal.textContent = `GHS ${(balance - amount).toFixed(2)}`;
  } else {
    preview.style.display = 'none';
  }
}

async function submitWithdrawal(balance) {
  const amount = parseFloat(document.getElementById('wd-amount')?.value);
  const method = document.getElementById('wd-selected-method')?.value;
  const u = App.currentUser;

  if (!amount || amount < MIN_WITHDRAWAL) {
    showToast(`Minimum withdrawal is GHS ${MIN_WITHDRAWAL}`, 'warning'); return;
  }
  if (amount > balance) {
    showToast('Amount exceeds available balance', 'error'); return;
  }

  let network = '', accountNum = '', note = '';

  if (method === 'mobile_money') {
    network    = document.getElementById('wd-network')?.value || '';
    accountNum = document.getElementById('wd-momo-num')?.value.trim();
    if (!accountNum) { showToast('Enter your MoMo number', 'warning'); return; }
    note = `MoMo withdrawal to ${network} – ${accountNum}`;
  } else {
    network    = document.getElementById('wd-bank')?.value || '';
    accountNum = document.getElementById('wd-acc-num')?.value.trim();
    const accName = document.getElementById('wd-acc-name')?.value.trim();
    if (!accountNum || !accName) { showToast('Enter bank account details', 'warning'); return; }
    note = `Bank transfer to ${network} – ${accName} (${accountNum})`;
  }

  const balBefore = balance;
  const balAfter  = balance - amount;

  // Create pending transaction
  const txn = await apiPost('wallet_transactions', {
    user_id: u.id, type: 'withdrawal', amount,
    balance_before: balBefore, balance_after: balAfter,
    payment_method: method, payment_ref: 'WD' + Date.now(),
    network, account_number: accountNum,
    status: 'pending', note, reviewed_by: ''
  });

  if (!txn) { showToast('Failed to submit request. Try again.', 'error'); return; }

  // Hold balance (deduct immediately, show as pending)
  await apiPatch('users', u.id, { wallet_balance: balAfter });
  App.currentUser.wallet_balance = balAfter;
  saveSessions();

  // Notify vendor
  addNotification(u.id, 'system', '🏧 Withdrawal Requested',
    `GHS ${amount.toFixed(2)} withdrawal request submitted. Processed within 1–2 business days.`);

  // Notify admin
  addNotification('u-admin-001', 'system', '💸 New Withdrawal Request',
    `Vendor ${u.name} requested GHS ${amount.toFixed(2)} via ${method === 'mobile_money' ? network : 'Bank Transfer'}.`);

  closeModalForce();
  showToast(`Withdrawal request for GHS ${amount.toFixed(2)} submitted! ✅`, 'success');
  renderVendorDashboard();
}


// ─────────────────────────────────────────────────────────────
// WALLET HISTORY (shared)
// ─────────────────────────────────────────────────────────────
async function renderWalletHistory(containerId) {
  const c = document.getElementById(containerId);
  if (!c || !App.currentUser) return;

  c.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i></div>';

  const res  = await apiGet('wallet_transactions', `search=${App.currentUser.id}&limit=50`);
  const txns = (res?.data || []).filter(t => t.user_id === App.currentUser.id)
                                .sort((a, b) => new Date(b.created_at||0) - new Date(a.created_at||0));

  if (!txns.length) {
    c.innerHTML = '<div class="empty-state" style="padding:30px"><i class="fas fa-history"></i><h3>No transactions yet</h3></div>';
    return;
  }

  c.innerHTML = txns.map(t => walletTxnRowHTML(t)).join('');
}

function walletTxnRowHTML(t) {
  const isCredit = ['deposit', 'earning', 'refund', 'referral_reward'].includes(t.type);
  const icon = {
    deposit: 'fas fa-arrow-down', withdrawal: 'fas fa-arrow-up',
    earning: 'fas fa-coins', refund: 'fas fa-undo', referral_reward: 'fas fa-gift'
  }[t.type] || 'fas fa-exchange-alt';
  const color     = isCredit ? 'var(--success)' : 'var(--danger)';
  const bgColor   = isCredit ? '#d1fae5' : '#fee2e2';
  const sign      = isCredit ? '+' : '-';
  const typeLabel = { deposit: 'Deposit', withdrawal: 'Withdrawal', earning: 'Earning',
                      refund: 'Refund', referral_reward: 'Referral Reward' }[t.type] || t.type;

  return `
<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
  <div style="width:38px;height:38px;border-radius:50%;background:${bgColor};display:flex;align-items:center;justify-content:center;flex-shrink:0">
    <i class="${icon}" style="color:${color};font-size:.85rem"></i>
  </div>
  <div style="flex:1;min-width:0">
    <div style="font-weight:600;font-size:.875rem">${typeLabel}</div>
    <div style="font-size:.75rem;color:var(--text-muted)">${t.note || (t.network || '') + (t.account_number ? ' · ' + maskAccount(t.account_number) : '')}</div>
    <div style="font-size:.7rem;color:var(--text-muted);margin-top:2px">${formatDateTime(t.created_at)}</div>
  </div>
  <div style="text-align:right;flex-shrink:0">
    <div style="font-weight:700;color:${color}">${sign} GHS ${(t.amount||0).toFixed(2)}</div>
    <span class="status-badge status-${t.status}" style="font-size:.62rem">${t.status}</span>
  </div>
</div>`;
}

function maskAccount(num) {
  if (!num || num.length < 4) return num;
  return num.slice(0, 3) + '****' + num.slice(-3);
}


// ─────────────────────────────────────────────────────────────
// REUSABLE FIELD BUILDERS
// ─────────────────────────────────────────────────────────────
function buildMoMoFields(prefix) {
  return `
<div class="form-group">
  <label class="form-label">Network *</label>
  <select class="form-control form-select" id="${prefix}-network">
    ${MOMO_NETWORKS.map(n => `<option value="${n}">${n}</option>`).join('')}
  </select>
</div>
<div class="form-group">
  <label class="form-label">Mobile Money Number *</label>
  <div class="input-group">
    <i class="fas fa-phone input-icon"></i>
    <input class="form-control" id="${prefix}-momo-num" type="tel"
           placeholder="024 000 0000" value="${App.currentUser?.phone || ''}">
  </div>
</div>`;
}

function buildCardFields(prefix) {
  return `
<div class="form-group">
  <label class="form-label">Card Number *</label>
  <div class="input-group">
    <i class="fas fa-credit-card input-icon"></i>
    <input class="form-control" id="${prefix}-card-num" type="text"
           placeholder="0000 0000 0000 0000" maxlength="19">
  </div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
  <div class="form-group">
    <label class="form-label">Expiry *</label>
    <input class="form-control" id="${prefix}-expiry" placeholder="MM/YY" maxlength="5">
  </div>
  <div class="form-group">
    <label class="form-label">CVV *</label>
    <input class="form-control" id="${prefix}-cvv" placeholder="•••" maxlength="3" type="password">
  </div>
</div>`;
}

function buildBankFields(prefix) {
  return `
<div class="form-group">
  <label class="form-label">Bank *</label>
  <select class="form-control form-select" id="${prefix}-bank">
    ${BANKS_GH.map(b => `<option value="${b}">${b}</option>`).join('')}
  </select>
</div>
<div class="form-group">
  <label class="form-label">Account Number *</label>
  <div class="input-group">
    <i class="fas fa-hashtag input-icon"></i>
    <input class="form-control" id="${prefix}-acc-num" type="text" placeholder="Enter account number">
  </div>
</div>
<div class="form-group">
  <label class="form-label">Account Name *</label>
  <div class="input-group">
    <i class="fas fa-user input-icon"></i>
    <input class="form-control" id="${prefix}-acc-name" type="text"
           placeholder="Name on account" value="${App.currentUser?.name || ''}">
  </div>
</div>`;
}


// ─────────────────────────────────────────────────────────────
// ADMIN: All Transactions View
// ─────────────────────────────────────────────────────────────
async function renderAdminTransactions(containerId) {
  const c = document.getElementById(containerId);
  if (!c) return;

  c.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i></div>';

  const res  = await apiGet('wallet_transactions', 'limit=200&sort=created_at');
  const txns = (res?.data || []).sort((a, b) => new Date(b.created_at||0) - new Date(a.created_at||0));

  const pending = txns.filter(t => t.type === 'withdrawal' && t.status === 'pending');

  c.innerHTML = `
${pending.length ? `
<div class="verify-banner" style="margin-bottom:14px">
  <i class="fas fa-exclamation-triangle"></i>
  <p><strong>${pending.length}</strong> pending withdrawal request${pending.length>1?'s':''} awaiting approval</p>
</div>` : ''}

<div class="tab-nav" style="margin-bottom:14px">
  <div class="tab-btn active" onclick="filterAdminTxns('all',this,'${containerId}')">All</div>
  <div class="tab-btn" onclick="filterAdminTxns('withdrawal',this,'${containerId}')">Withdrawals</div>
  <div class="tab-btn" onclick="filterAdminTxns('deposit',this,'${containerId}')">Deposits</div>
  <div class="tab-btn" onclick="filterAdminTxns('pending',this,'${containerId}')">⏳ Pending</div>
</div>

<div id="admin-txn-list">
  ${txns.length ? txns.map(t => adminTxnRowHTML(t)).join('') :
    '<div class="empty-state" style="padding:30px"><i class="fas fa-receipt"></i><h3>No transactions yet</h3></div>'}
</div>`;
}

async function filterAdminTxns(filter, el, containerId) {
  const parent = el.closest('.tab-nav');
  if (parent) parent.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
  el.classList.add('active');

  const res  = await apiGet('wallet_transactions', 'limit=200');
  let txns   = (res?.data || []).sort((a, b) => new Date(b.created_at||0) - new Date(a.created_at||0));
  if (filter === 'withdrawal') txns = txns.filter(t => t.type === 'withdrawal');
  if (filter === 'deposit')    txns = txns.filter(t => t.type === 'deposit');
  if (filter === 'pending')    txns = txns.filter(t => t.status === 'pending');

  const list = document.getElementById('admin-txn-list');
  if (list) list.innerHTML = txns.length
    ? txns.map(t => adminTxnRowHTML(t)).join('')
    : '<div class="empty-state" style="padding:24px"><i class="fas fa-inbox"></i><h3>No results</h3></div>';
}

function adminTxnRowHTML(t) {
  const isCredit  = ['deposit','earning','refund','referral_reward'].includes(t.type);
  const color     = isCredit ? 'var(--success)' : 'var(--danger)';
  const sign      = isCredit ? '+' : '-';
  const typeLabel = { deposit:'Deposit', withdrawal:'Withdrawal', earning:'Earning',
                      refund:'Refund', referral_reward:'Referral Reward' }[t.type] || t.type;
  return `
<div style="display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid var(--border)">
  <div style="flex:1;min-width:0">
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span style="font-weight:700;font-size:.875rem">${typeLabel}</span>
      <span class="status-badge status-${t.status}">${t.status}</span>
    </div>
    <div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">${t.note || ''}</div>
    <div style="font-size:.7rem;color:var(--text-muted)">${formatDateTime(t.created_at)} · ${t.network||''} ${t.account_number ? '· '+maskAccount(t.account_number) : ''}</div>
  </div>
  <div style="text-align:right;flex-shrink:0">
    <div style="font-weight:700;color:${color}">${sign} GHS ${(t.amount||0).toFixed(2)}</div>
    ${t.type === 'withdrawal' && t.status === 'pending' ? `
    <div style="display:flex;gap:4px;margin-top:4px;justify-content:flex-end">
      <button class="btn btn-success btn-sm" style="padding:3px 8px;font-size:.7rem" onclick="approveWithdrawal('${t.id}','${t.user_id}',${t.amount})">
        <i class="fas fa-check"></i> Approve
      </button>
      <button class="btn btn-danger btn-sm" style="padding:3px 8px;font-size:.7rem" onclick="rejectWithdrawal('${t.id}','${t.user_id}',${t.amount},${t.balance_before})">
        <i class="fas fa-times"></i> Reject
      </button>
    </div>` : ''}
  </div>
</div>`;
}

async function approveWithdrawal(txnId, userId, amount) {
  if (!confirm(`Approve withdrawal of GHS ${amount.toFixed ? amount.toFixed(2) : amount}?`)) return;

  await apiPatch('wallet_transactions', txnId, {
    status: 'completed', reviewed_by: App.currentUser?.id || ''
  });

  addNotification(userId, 'system', '✅ Withdrawal Approved',
    `Your withdrawal of GHS ${parseFloat(amount).toFixed(2)} has been processed and sent to your account.`);

  showToast('Withdrawal approved and marked as completed ✅', 'success');
  renderAdminDashboard();
}

async function rejectWithdrawal(txnId, userId, amount, balanceBefore) {
  if (!confirm(`Reject this withdrawal? The GHS ${parseFloat(amount).toFixed(2)} will be returned to the vendor's wallet.`)) return;

  // Refund balance
  const userRes = await apiGet(`users/${userId}`);
  const user    = userRes || null;
  if (user) {
    const newBal = (user.wallet_balance || 0) + parseFloat(amount);
    await apiPatch('users', userId, { wallet_balance: newBal });
    if (App.currentUser?.id === userId) {
      App.currentUser.wallet_balance = newBal;
      saveSessions();
    }
  }

  await apiPatch('wallet_transactions', txnId, {
    status: 'failed', reviewed_by: App.currentUser?.id || '',
    note: 'Rejected by admin — amount refunded to wallet'
  });

  // Refund transaction record
  if (user) {
    await apiPost('wallet_transactions', {
      user_id: userId, type: 'refund', amount: parseFloat(amount),
      balance_before: user.wallet_balance || 0,
      balance_after: (user.wallet_balance || 0) + parseFloat(amount),
      payment_method: 'platform', payment_ref: 'REFUND' + Date.now(),
      network: '', account_number: '', status: 'completed',
      note: 'Withdrawal rejected — refunded to wallet', reviewed_by: App.currentUser?.id || ''
    });
  }

  addNotification(userId, 'system', '❌ Withdrawal Rejected',
    `Your withdrawal of GHS ${parseFloat(amount).toFixed(2)} was not processed. Amount returned to your wallet.`);

  showToast('Withdrawal rejected. Balance refunded to vendor.', 'warning');
  renderAdminDashboard();
}
