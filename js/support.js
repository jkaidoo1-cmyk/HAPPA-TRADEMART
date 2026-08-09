/* ============================================================
   HAPPA TRADEMART — Customer Care / Support Module
   User-facing Support page (contact channels, FAQ, tickets)
   + Admin Support panel (ticket queue, replies, status flow)
   ============================================================ */

const SUPPORT_CATEGORIES = [
  'Order Issue', 'Payment & Wallet', 'Delivery', 'Store / Product',
  'Account & Login', 'Storefront', 'Withdrawal', 'Other'
];

const SUPPORT_PRIORITIES = [
  { id: 'normal', label: '🟢 Normal' },
  { id: 'high',   label: '🟠 High' },
  { id: 'urgent', label: '🔴 Urgent' }
];

const TICKET_STATUS_LABELS = {
  open:         { text: 'Open',        css: 'pending'     },
  in_progress:  { text: 'In Progress', css: 'on_delivery' },
  resolved:     { text: 'Resolved',    css: 'delivered'   },
  closed:       { text: 'Closed',      css: 'rejected'    }
};

const SUPPORT_FAQS = [
  {
    q: 'How do I place an order?',
    a: 'Browse the marketplace, add items to your cart, then go to checkout. Choose your payment method (Mobile Money, Cash on Delivery, or Wallet) and confirm your delivery details.'
  },
  {
    q: 'How does delivery work?',
    a: 'Delivery is arranged directly between you and the vendor. After you place your order, the vendor will contact you to agree on the delivery method and any delivery charges — delivery is not handled by the platform.'
  },
  {
    q: 'How do I pay with my wallet?',
    a: 'Top up your wallet from the Wallet page (deposits are instant), then select "Pay with Wallet" at checkout. Wallet payments also earn you referral rewards when you invite friends.'
  },
  {
    q: 'When do I get paid as a vendor?',
    a: 'Marketplace order earnings are released to your wallet once the order is delivered. Storefront payouts settle immediately at order placement. Withdrawals are processed within 1–2 business days.'
  },
  {
    q: 'How do I track my order?',
    a: 'Open your buyer dashboard → Orders. Each package shows its live status: Awaiting Vendor → Ready for Pickup → On Delivery → Delivered.'
  },
  {
    q: 'How do returns and refunds work?',
    a: 'If a vendor rejects your order, you get an automatic refund to your wallet. For other issues, open a support ticket and our team will help within 24 hours.'
  }
];

// ── Parse the message thread (stored as JSON string or array) ──
function _supportMessages(ticket) {
  let msgs = ticket?.messages;
  if (typeof msgs === 'string') {
    try { msgs = JSON.parse(msgs); } catch (e) { msgs = []; }
  }
  if (!Array.isArray(msgs)) msgs = [];
  return msgs;
}

function _ticketStatusBadge(status) {
  const s = TICKET_STATUS_LABELS[status] || TICKET_STATUS_LABELS.open;
  return `<span class="status-badge status-${s.css}">${s.text}</span>`;
}

function _priorityBadge(p) {
  const map = { urgent: '<span class="status-badge status-rejected">🔴 Urgent</span>',
                high: '<span class="status-badge status-pending">🟠 High</span>',
                normal: '<span class="status-badge status-active">🟢 Normal</span>' };
  return map[p] || map.normal;
}

// ── Contact channels (configurable via Admin → Settings → Customer Care) ──
async function _supportContactInfo() {
  const [whatsapp, email, phone] = await Promise.all([
    getSetting('support_whatsapp', '233240000000'),
    getSetting('support_email', 'support@happamart.com'),
    getSetting('support_phone', '+233 24 000 0000')
  ]);
  return { whatsapp, email, phone };
}

// ── USER-FACING SUPPORT PAGE ──────────────────────────────────
async function renderSupportPage() {
  const el = document.getElementById('support-page-content');
  if (!el) return;
  if (!App.currentUser) { showPage('auth'); return; }

  el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i></div>';

  const u = App.currentUser;
  const contact = await _supportContactInfo();

  // Load this user's tickets
  const res = await apiGet('support_tickets', `search=${encodeURIComponent(u.id)}&limit=50`);
  const myTickets = (res?.data || []).filter(t => String(t.user_id) === String(u.id))
                                      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const openCount = myTickets.filter(t => t.status === 'open' || t.status === 'in_progress').length;

  el.innerHTML = `
    <div style="display:grid;gap:14px">

      <!-- Hero + Contact -->
      <div style="background:linear-gradient(135deg,var(--secondary),#16213e);border-radius:18px;padding:22px 20px;color:#fff">
        <div style="font-size:1.25rem;font-weight:900;margin-bottom:4px">💬 How can we help you today?</div>
        <div style="font-size:.85rem;opacity:.8;margin-bottom:16px">Our customer care team is available Mon–Sat, 8am–8pm. Average response time: under 24 hours.</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <a class="btn" style="background:#25d366;border:none;color:#fff;display:inline-flex;align-items:center;gap:8px"
             href="${waMeHref(contact.whatsapp)}" target="_blank">
            <i class="fab fa-whatsapp"></i> WhatsApp Us
          </a>
          <a class="btn" style="background:#1d4ed8;border:none;color:#fff;display:inline-flex;align-items:center;gap:8px"
             href="mailto:${escHtml(contact.email)}">
            <i class="fas fa-envelope"></i> ${escHtml(contact.email)}
          </a>
          <a class="btn" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;display:inline-flex;align-items:center;gap:8px"
             href="tel:${escHtml(String(contact.phone).replace(/[^+\\d]/g, ''))}">
            <i class="fas fa-phone-alt"></i> ${escHtml(contact.phone)}
          </a>
        </div>
      </div>

      <!-- New ticket CTA -->
      <div class="card">
        <div class="card-body" style="padding:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-weight:800;font-size:.95rem">${openCount > 0 ? `You have <span style="color:var(--primary)">${openCount}</span> open ticket${openCount > 1 ? 's' : ''}` : 'Need help from our team?'}</div>
            <div style="font-size:.8rem;color:var(--text-muted);margin-top:2px">Create a ticket and we will respond by email and in-app notification.</div>
          </div>
          <button class="btn btn-primary" onclick="showNewSupportTicketModal()"><i class="fas fa-plus-circle"></i> Open a New Ticket</button>
        </div>
      </div>

      <!-- My Tickets -->
      <div class="card">
        <div class="card-header"><h3>🎫 My Support Tickets (${myTickets.length})</h3></div>
        <div id="support-my-tickets">
          ${myTickets.length ? myTickets.map(t => _userTicketCardHTML(t)).join('') :
            '<div class="empty-state" style="padding:26px"><i class="fas fa-ticket-alt"></i><h3>No tickets yet</h3><p>Open a ticket and track it right here.</p></div>'}
        </div>
      </div>

      <!-- FAQ -->
      <div class="card">
        <div class="card-header"><h3>❓ Frequently Asked Questions</h3></div>
        <div class="card-body" style="padding:6px 16px 16px">
          ${SUPPORT_FAQS.map((f, i) => `
          <div style="border-bottom:1px solid var(--border)">
            <button class="support-faq-q" onclick="toggleSupportFaq(${i})"
                    style="width:100%;background:none;border:none;padding:14px 2px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;text-align:left;font-weight:700;font-size:.88rem;color:var(--text)">
              <span>${escHtml(f.q)}</span>
              <i class="fas fa-chevron-down" id="support-faq-icon-${i}" style="color:var(--text-muted);font-size:.8rem;transition:transform .25s"></i>
            </button>
            <div id="support-faq-ans-${i}" style="display:none;font-size:.84rem;color:var(--text-light);line-height:1.6;padding:0 2px 14px">${escHtml(f.a)}</div>
          </div>`).join('')}
        </div>
      </div>

    </div>`;
}

function toggleSupportFaq(i) {
  const ans = document.getElementById('support-faq-ans-' + i);
  const icon = document.getElementById('support-faq-icon-' + i);
  if (!ans) return;
  const show = ans.style.display !== 'block';
  ans.style.display = show ? 'block' : 'none';
  if (icon) icon.style.transform = show ? 'rotate(180deg)' : '';
}

// ── NEW TICKET MODAL ──────────────────────────────────────────
function showNewSupportTicketModal() {
  if (!App.currentUser) { showPage('auth'); return; }
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">🎫 Open a Support Ticket</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <div class="form-group">
    <label class="form-label">Subject *</label>
    <input class="form-control" id="st-subject" placeholder="e.g. My order hasn't arrived" maxlength="120">
  </div>
  <div class="form-group">
    <label class="form-label">Category *</label>
    <select class="form-control form-select" id="st-category">
      ${SUPPORT_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
    </select>
  </div>
  <div class="form-group">
    <label class="form-label">Priority</label>
    <select class="form-control form-select" id="st-priority">
      ${SUPPORT_PRIORITIES.map(p => `<option value="${p.id}">${p.label}</option>`).join('')}
    </select>
  </div>
  <div class="form-group">
    <label class="form-label">Describe your issue *</label>
    <textarea class="form-control" id="st-message" rows="4"
      placeholder="Include order/package codes, what happened, and what you expected..."></textarea>
  </div>
  <button class="btn btn-primary btn-block" onclick="submitSupportTicket()"><i class="fas fa-paper-plane"></i> Submit Ticket</button>
</div>`);
}

async function submitSupportTicket() {
  const u = App.currentUser;
  if (!u) { showPage('auth'); return; }
  const subject = document.getElementById('st-subject')?.value.trim();
  const category = document.getElementById('st-category')?.value || 'Other';
  const priority = document.getElementById('st-priority')?.value || 'normal';
  const message = document.getElementById('st-message')?.value.trim();

  if (!subject) { showToast('Please enter a subject', 'warning'); return; }
  if (!message) { showToast('Please describe your issue', 'warning'); return; }

  const now = new Date().toISOString();
  const txn = await apiPost('support_tickets', {
    user_id: u.id,
    user_name: u.name || 'User',
    user_email: u.email || '',
    user_role: u.role || 'buyer',
    subject,
    category,
    priority,
    status: 'open',
    message,
    messages: JSON.stringify([{ from: 'user', name: u.name || 'You', role: u.role || 'buyer', text: message, at: now }]),
    created_at: now,
    updated_at: now
  });

  if (!txn) { showToast('Could not submit ticket. Please try again.', 'error'); return; }

  // Notify the support team
  try { addNotification('admin', 'support', '🆘 New Support Ticket', `${u.name} (${u.role}): ${subject} — ${category}`); } catch (e) {}

  closeModalForce();
  showToast('Ticket submitted! Our team will respond within 24 hours. 🎫', 'success');
  renderSupportPage();
}

// ── USER TICKET CARD (expandable thread + reply) ─────────────
function _userTicketCardHTML(t) {
  const msgs = _supportMessages(t);
  const lastMsg = msgs[msgs.length - 1] || {};
  return `
<div style="border-bottom:1px solid var(--border);padding:12px 16px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;cursor:pointer" onclick="toggleSupportTicket('${t.id}')">
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;font-size:.88rem">${escHtml(t.subject || 'Support ticket')}</div>
      <div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">${escHtml(t.category || 'Other')} · Opened ${formatDateTime(t.created_at)}</div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
      ${_priorityBadge(t.priority)}
      ${_ticketStatusBadge(t.status)}
      <i class="fas fa-chevron-down" style="color:var(--text-muted);font-size:.75rem"></i>
    </div>
  </div>
  <div id="support-ticket-${t.id}" style="display:none;margin-top:12px">
    ${_threadHTML(msgs)}
    <div style="display:flex;gap:8px;margin-top:10px">
      <input class="form-control" id="support-reply-${t.id}" placeholder="Type a reply...">
      <button class="btn btn-primary btn-sm" style="white-space:nowrap" onclick="replyToSupportTicket('${t.id}')"><i class="fas fa-paper-plane"></i> Reply</button>
      ${(t.status === 'open' || t.status === 'in_progress') ? `
      <button class="btn btn-outline btn-sm" style="white-space:nowrap" onclick="userCloseSupportTicket('${t.id}')">Mark Resolved</button>` : ''}
    </div>
    <div style="font-size:.7rem;color:var(--text-muted);margin-top:6px">Last update: ${formatDateTime(t.updated_at)}</div>
  </div>
</div>`;
}

function _threadHTML(msgs) {
  if (!msgs.length) return '<div style="font-size:.8rem;color:var(--text-muted)">No messages yet.</div>';
  return msgs.map(m => {
    const isAdmin = m.from === 'admin';
    const name = m.name || (isAdmin ? 'Support Team' : 'You');
    return `
  <div style="display:flex;justify-content:${isAdmin ? 'flex-start' : 'flex-end'};margin-bottom:8px">
    <div style="max-width:85%;background:${isAdmin ? 'var(--bg)' : 'var(--primary-light)'};border:1px solid ${isAdmin ? 'var(--border)' : 'rgba(232,93,4,.25)'};border-radius:12px;padding:10px 12px;font-size:.83rem">
      <div style="font-weight:700;font-size:.72rem;margin-bottom:3px">${isAdmin ? '👩‍💼 ' : ''}${escHtml(name)} <span style="color:var(--text-muted);font-weight:400">· ${formatDateTime(m.at)}</span></div>
      <div style="white-space:pre-wrap;word-break:break-word">${escHtml(m.text || '')}</div>
    </div>
  </div>`;
  }).join('');
}

function toggleSupportTicket(id) {
  const el = document.getElementById('support-ticket-' + id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function replyToSupportTicket(ticketId) {
  const u = App.currentUser;
  const inp = document.getElementById('support-reply-' + ticketId);
  const text = inp?.value?.trim();
  if (!text) { showToast('Write a message first', 'warning'); return; }

  const res = await apiGet('support_tickets/' + ticketId).catch(() => null);
  const t = res || null;
  if (!t) { showToast('Ticket not found', 'error'); return; }

  const msgs = _supportMessages(t);
  msgs.push({ from: 'user', name: u?.name || 'You', role: u?.role || 'buyer', text, at: new Date().toISOString() });

  const updated = await apiPatch('support_tickets', ticketId, {
    messages: JSON.stringify(msgs),
    status: t.status === 'closed' ? 'open' : t.status,
    updated_at: new Date().toISOString()
  }).catch(() => null);
  if (!updated) { showToast('Reply failed. Please try again.', 'error'); return; }

  try { addNotification('admin', 'support', '🆘 Ticket Reply', `${t.subject} — ${u?.name || 'User'} replied`); } catch (e) {}
  showToast('Reply sent! ✅', 'success');
  renderSupportPage();
}

async function userCloseSupportTicket(ticketId) {
  if (!confirm('Mark this ticket as resolved?')) return;
  const updated = await apiPatch('support_tickets', ticketId, { status: 'resolved', updated_at: new Date().toISOString() }).catch(() => null);
  if (!updated) { showToast('Could not update ticket', 'error'); return; }
  showToast('Ticket marked as resolved. Thank you! ✅', 'success');
  renderSupportPage();
}


// ═══════════════════════════════════════════════════════════
// ADMIN SUPPORT PANEL
// ═══════════════════════════════════════════════════════════
let _adminSupportFilter = 'all';

async function loadAdminSupport() {
  const container = document.getElementById('admin-support-content');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading tickets…</div>';

  const res = await apiGet('support_tickets', 'limit=200').catch(err => {
    console.error('loadAdminSupport failed:', err);
    return null;
  });
  if (!res || !Array.isArray(res.data)) {
    container.innerHTML = '<div class="empty-state" style="padding:30px"><i class="fas fa-exclamation-triangle"></i><h3>Could not load tickets</h3><p>The support service did not respond. Please try again in a moment.</p><button class="btn" style="margin-top:10px" onclick="loadAdminSupport()">Retry</button></div>';
    return;
  }
  const tickets = (res.data || []).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const counts = {
    open: tickets.filter(t => t.status === 'open').length,
    in_progress: tickets.filter(t => t.status === 'in_progress').length,
    resolved: tickets.filter(t => t.status === 'resolved').length,
    closed: tickets.filter(t => t.status === 'closed').length
  };

  let list = tickets;
  if (_adminSupportFilter === 'open') list = tickets.filter(t => t.status === 'open' || t.status === 'in_progress');
  else if (_adminSupportFilter !== 'all') list = tickets.filter(t => t.status === _adminSupportFilter);

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px">
      ${[['all', 'All', tickets.length], ['open', 'Open', counts.open + counts.in_progress], ['resolved', 'Resolved', counts.resolved], ['closed', 'Closed', counts.closed]]
        .map(([k, label, n]) => `
        <div style="background:${_adminSupportFilter === k ? 'var(--primary)' : '#fff'};color:${_adminSupportFilter === k ? '#fff' : 'var(--text)'};border:1px solid var(--border);border-radius:12px;padding:12px;text-align:center;cursor:pointer" onclick="_adminSupportFilter='${k}';loadAdminSupport()">
          <div style="font-size:1.3rem;font-weight:900">${n}</div>
          <div style="font-size:.72rem;opacity:.8">${label}</div>
        </div>`).join('')}
    </div>

    ${list.length ? list.map(t => _adminTicketCardHTML(t)).join('') :
      '<div class="empty-state" style="padding:30px"><i class="fas fa-inbox"></i><h3>No support tickets</h3><p>New tickets from users and vendors will appear here.</p></div>'}
  `;
}

function _adminTicketCardHTML(t) {
  const msgs = _supportMessages(t);
  return `
<div style="background:#fff;border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-bottom:12px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;cursor:pointer" onclick="toggleSupportTicket('${t.id}')">
    <div style="flex:1;min-width:0">
      <div style="font-weight:800;font-size:.9rem">${escHtml(t.subject || 'Untitled')}</div>
      <div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">
        👤 ${escHtml(t.user_name || 'Unknown')} (${escHtml(t.user_role || 'user')}) · ${escHtml(t.user_email || '')} · ${escHtml(t.category || 'Other')}
      </div>
      <div style="font-size:.72rem;color:var(--text-muted);margin-top:2px">Opened ${formatDateTime(t.created_at)} · Updated ${formatDateTime(t.updated_at)}</div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
      ${_priorityBadge(t.priority)}
      ${_ticketStatusBadge(t.status)}
      <i class="fas fa-chevron-down" style="color:var(--text-muted);font-size:.75rem"></i>
    </div>
  </div>

  <div id="support-ticket-${t.id}" style="display:none;margin-top:12px">
    ${_threadHTML(msgs)}

    <!-- Admin reply -->
    <div style="display:flex;gap:8px;margin-top:10px">
      <input class="form-control" id="admin-reply-${t.id}" placeholder="Reply as Support Team...">
      <button class="btn btn-primary btn-sm" style="white-space:nowrap" onclick="adminReplyTicket('${t.id}')"><i class="fas fa-paper-plane"></i> Reply</button>
    </div>

    <!-- Status controls -->
    <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
      ${t.status === 'open' ? `<button class="btn btn-outline btn-sm" onclick="adminSetTicketStatus('${t.id}','in_progress')">▶ In Progress</button>` : ''}
      ${(t.status === 'open' || t.status === 'in_progress') ? `<button class="btn btn-success btn-sm" style="background:#16a34a;border:none;color:#fff" onclick="adminSetTicketStatus('${t.id}','resolved')">✓ Mark Resolved</button>` : ''}
      ${(t.status !== 'closed') ? `<button class="btn btn-ghost btn-sm" onclick="adminSetTicketStatus('${t.id}','closed')">✕ Close</button>` : ''}
      ${(t.status === 'closed' || t.status === 'resolved') ? `<button class="btn btn-outline btn-sm" onclick="adminSetTicketStatus('${t.id}','open')">↺ Reopen</button>` : ''}
    </div>
  </div>
</div>`;
}

async function adminReplyTicket(ticketId) {
  const inp = document.getElementById('admin-reply-' + ticketId);
  const text = inp?.value?.trim();
  if (!text) { showToast('Write a reply first', 'warning'); return; }

  const res = await apiGet('support_tickets/' + ticketId).catch(() => null);
  const t = res || null;
  if (!t) { showToast('Ticket not found', 'error'); return; }

  const msgs = _supportMessages(t);
  msgs.push({ from: 'admin', name: 'Support Team', role: 'admin', text, at: new Date().toISOString() });

  const updated = await apiPatch('support_tickets', ticketId, {
    messages: JSON.stringify(msgs),
    status: t.status === 'closed' ? 'closed' : (t.status === 'resolved' ? 'resolved' : 'in_progress'),
    updated_at: new Date().toISOString()
  }).catch(() => null);
  if (!updated) { showToast('Reply failed. Please try again.', 'error'); return; }

  // Notify the ticket owner
  try {
    addNotification(t.user_id, 'support', '✅ Support Response',
      `Your ticket "${t.subject}" has a new reply from our team.`);
  } catch (e) {}

  showToast('Reply sent to ' + (t.user_name || 'user') + ' ✅', 'success');
  loadAdminSupport();
}

async function adminSetTicketStatus(ticketId, newStatus) {
  const res = await apiGet('support_tickets/' + ticketId).catch(() => null);
  const t = res || null;
  if (!t) { showToast('Ticket not found', 'error'); return; }

  const updated = await apiPatch('support_tickets', ticketId, { status: newStatus, updated_at: new Date().toISOString() }).catch(() => null);
  if (!updated) { showToast('Could not update ticket', 'error'); return; }

  // Notify the ticket owner on resolution/closure
  try {
    if (newStatus === 'resolved' || newStatus === 'closed') {
      addNotification(t.user_id, 'support', newStatus === 'resolved' ? '🎉 Ticket Resolved' : '🔒 Ticket Closed',
        `Your ticket "${t.subject}" was marked ${newStatus} by our team.`);
    }
  } catch (e) {}

  showToast(`Ticket marked ${newStatus} ✅`, 'success');
  loadAdminSupport();
}

// ── Exports ──────────────────────────────────────────────────
window.renderSupportPage = renderSupportPage;
window.toggleSupportFaq = toggleSupportFaq;
window.showNewSupportTicketModal = showNewSupportTicketModal;
window.submitSupportTicket = submitSupportTicket;
window.toggleSupportTicket = toggleSupportTicket;
window.replyToSupportTicket = replyToSupportTicket;
window.userCloseSupportTicket = userCloseSupportTicket;
window.loadAdminSupport = loadAdminSupport;
window.adminReplyTicket = adminReplyTicket;
window.adminSetTicketStatus = adminSetTicketStatus;
