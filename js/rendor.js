/* ============================================================
   HAPPA TRADEMART — Rendor Dashboard
   Rendors are service creators (writers, designers, tutors…)
   who advertise themselves on the platform. Clients discover
   their profiles / posts and follow up directly via the
   contact credentials the rendor publishes.
   Rendors pay a subscription fee to admin for platform access.
   There are NO in-app bookings or order flows.
   ============================================================ */

async function renderRendorDashboard() {
  const c = document.getElementById('rendor-dashboard-content');
  if (!c) return;
  if (!App.currentUser) { showPage('auth'); return; }

  const u = App.currentUser;
  if (u.role !== 'rendor') {
    c.innerHTML = '<div class="empty-state"><i class="fas fa-lock"></i><h3>Access Denied</h3><p>Rendor accounts only</p></div>';
    return;
  }

  // ── Pending approval ──────────────────────────────────────
  if (u.status === 'pending_approval') {
    c.innerHTML = `
<div class="dashboard-wrap" style="text-align:center;padding:40px 20px">
  <div style="font-size:3rem;margin-bottom:16px">🎨</div>
  <h2 style="font-weight:800;font-size:1.1rem;margin-bottom:8px">Profile Under Review</h2>
  <p style="font-size:.875rem;color:var(--text-light);margin-bottom:20px;line-height:1.7">
    Your rendor profile is <strong>awaiting admin approval</strong>.<br>
    You'll be notified once your profile goes live — usually within 24 hours.
  </p>
  <div style="background:linear-gradient(90deg,#ede9fe,#ddd6fe);border:1.5px solid #a78bfa;border-radius:var(--radius-sm);padding:12px 14px;text-align:left;margin-bottom:16px">
    <div style="font-weight:700;font-size:.83rem;margin-bottom:4px;color:#4c1d95">
      <i class="fas fa-briefcase"></i> Profile Submitted
    </div>
    <div style="font-size:.8rem;color:#4c1d95;line-height:1.6">
      Admin will review your profile — <strong>${escHtml(u.rendor_display_name || u.name)}</strong>.<br>
      Once approved, clients can discover you on HAPPA TRADEMART and contact you directly.
    </div>
  </div>
  <div style="background:#fef9c3;border:1.5px solid #fde047;border-radius:var(--radius-sm);padding:14px;text-align:left;margin-bottom:24px">
    <div style="font-weight:700;font-size:.85rem;margin-bottom:6px;color:#713f12"><i class="fas fa-info-circle"></i> What happens next?</div>
    <ol style="font-size:.82rem;color:#713f12;padding-left:16px;line-height:1.9;margin:0">
      <li>Admin reviews your profile &amp; bio</li>
      <li>You get an in-app notification when approved</li>
      <li>Your profile goes live — clients can find and contact you</li>
      <li>Subscribe to keep your profile active on the platform</li>
    </ol>
  </div>
  <button class="btn btn-block" onclick="showPage('marketplace')"
          style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border-color:#7c3aed;margin-bottom:10px">
    <i class="fas fa-store"></i> Browse Marketplace While You Wait
  </button>
  <button class="btn btn-ghost btn-sm" onclick="logout()" style="color:var(--text-muted)">Sign out</button>
</div>`;
    return;
  }

  // ── Load rendor's posts (services table re-used as posts) ──
  c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';

  const postsRes = await apiGet('services', 'limit=200');
  const myPosts  = (postsRes?.data || []).filter(s => s.rendor_id === u.id && !s.deleted);

  const activePosts  = myPosts.filter(s => s.status === 'active').length;
  const displayName  = u.rendor_display_name || u.name;
  const serviceCat   = u.rendor_service_cat  || '—';

  // ── Subscription status ───────────────────────────────────
  // rendor_sub_status: 'active' | 'expired' | null
  const subStatus  = u.rendor_sub_status || null;
  const subExpiry  = u.rendor_sub_expiry  ? new Date(Number(u.rendor_sub_expiry)) : null;
  const subActive  = subStatus === 'active' && subExpiry && subExpiry > new Date();
  const subLabel   = subActive
    ? `Active — expires ${subExpiry.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`
    : 'No active subscription';

  const activeTabId = (App.activeTab && App.activeTab['rendor-dashboard']) || 'rendor-overview';

  c.innerHTML = `
<!-- ── Profile banner ── -->
<div class="rendor-profile-banner">
  <div class="rendor-avatar">${displayName.charAt(0).toUpperCase()}</div>
  <div class="rendor-profile-info">
    <div class="rendor-profile-name">${escHtml(displayName)}</div>
    <div class="rendor-profile-cat"><i class="fas fa-briefcase"></i> ${escHtml(serviceCat)}</div>
    ${u.rendor_tags ? `<div style="font-size:.72rem;opacity:.8;margin-top:2px">${escHtml(u.rendor_tags)}</div>` : ''}
  </div>
  <div style="margin-left:auto;display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0">
    <button class="btn btn-sm" style="background:#7c3aed;color:#fff;border:none;padding:6px 14px;border-radius:8px;font-weight:600;box-shadow:0 2px 6px rgba(124,58,237,.3)"
            onclick="showEditRendorProfileModal()">
      <i class="fas fa-edit"></i> Edit
    </button>
  </div>
</div>

<!-- ── Subscription status strip ── -->
<div style="background:${subActive?'#ecfdf5':'#fef2f2'};border-bottom:1px solid ${subActive?'#a7f3d0':'#fecaca'};padding:8px 16px;display:flex;align-items:center;gap:8px;font-size:.8rem">
  <i class="fas fa-${subActive?'check-circle':'exclamation-circle'}" style="color:${subActive?'var(--success)':'var(--danger)'}"></i>
  <span style="flex:1;color:${subActive?'#065f46':'#991b1b'}">
    <strong>Subscription:</strong> ${subLabel}
  </span>
  ${!subActive ? `<button class="btn btn-sm" style="background:var(--primary);color:#fff;border-color:var(--primary);font-size:.73rem;padding:3px 10px"
    onclick="switchTab(document.querySelectorAll('#rendor-tabs .tab-btn')[3],'rendor-subscription');renderRendorSubscription()">
    Subscribe Now
  </button>` : ''}
</div>

<!-- ── Tabs ── -->
<div class="tab-nav" id="rendor-tabs">
  <div class="tab-btn ${activeTabId === 'rendor-overview' ? 'active' : ''}" onclick="switchTab(this,'rendor-overview')">Overview</div>
  <div class="tab-btn ${activeTabId === 'rendor-posts' ? 'active' : ''}" onclick="switchTab(this,'rendor-posts');loadRendorPosts()">My Posts</div>
  <div class="tab-btn ${activeTabId === 'rendor-contact' ? 'active' : ''}" onclick="switchTab(this,'rendor-contact')">Contact Info</div>
  <div class="tab-btn ${activeTabId === 'rendor-subscription' ? 'active' : ''}" onclick="switchTab(this,'rendor-subscription');renderRendorSubscription()">Subscription</div>
  <div class="tab-btn ${activeTabId === 'rendor-verify' ? 'active' : ''}" onclick="switchTab(this,'rendor-verify');renderRendorVerify()">Verify</div>
</div>

<!-- ══ OVERVIEW ══ -->
<div class="tab-content ${activeTabId === 'rendor-overview' ? 'active' : ''}" id="rendor-overview">
  <div class="dashboard-wrap">

    ${!u.id_verified ? `
    <div class="verify-banner" style="background:linear-gradient(90deg,#ede9fe,#ddd6fe);border-color:#a78bfa;margin-bottom:16px">
      <i class="fas fa-shield-alt" style="color:#7c3aed"></i>
      <div>
        <p style="color:#4c1d95;font-weight:700;font-size:.85rem">Get Verified for More Trust</p>
        <p style="color:#4c1d95;font-size:.78rem">Verified rendors get a badge and appear higher in searches.</p>
        <button class="btn btn-sm" onclick="switchTab(document.querySelector('#rendor-tabs .tab-btn:last-child'),'rendor-verify');renderRendorVerify()"
                style="background:#7c3aed;color:#fff;border-color:#7c3aed;margin-top:6px;font-size:.75rem">
          Get Verified
        </button>
      </div>
    </div>` : ''}

    <!-- Stats -->
    <div class="stats-grid" style="margin-bottom:20px">
      <div class="stat-card">
        <div class="stat-icon" style="background:#ede9fe"><i class="fas fa-newspaper" style="color:#7c3aed"></i></div>
        <div class="stat-value">${activePosts}</div>
        <div class="stat-label">Active Posts</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:${subActive?'#d1fae5':'#fee2e2'}">
          <i class="fas fa-${subActive?'check-circle':'times-circle'}" style="color:${subActive?'#059669':'#dc2626'}"></i>
        </div>
        <div class="stat-value" style="font-size:.9rem">${subActive?'Active':'Inactive'}</div>
        <div class="stat-label">Subscription</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:${u.is_verified?'#d1fae5':'#fef3c7'}">
          <i class="fas fa-${u.is_verified?'shield-alt':'clock'}" style="color:${u.is_verified?'#059669':'#d97706'}"></i>
        </div>
        <div class="stat-value" style="font-size:.9rem">${u.is_verified?'Verified':'Pending'}</div>
        <div class="stat-label">Verification</div>
      </div>
    </div>

    <!-- How it works -->
    <div class="card" style="margin-bottom:16px;border-left:4px solid #7c3aed">
      <div class="card-body">
        <div style="font-weight:700;font-size:.88rem;margin-bottom:8px;color:#4c1d95">
          <i class="fas fa-lightbulb"></i> How Rendors Work on HAPPA TRADEMART
        </div>
        <ol style="font-size:.8rem;color:var(--text-light);padding-left:16px;line-height:2;margin:0">
          <li>Set up your profile with your bio, category &amp; skills</li>
          <li>Add your <strong>contact credentials</strong> (WhatsApp, email, Instagram, etc.)</li>
          <li>Create <strong>posts</strong> showcasing your services &amp; sample work</li>
          <li>Clients browse your profile and <strong>contact you directly</strong></li>
          <li>Keep your <strong>subscription active</strong> so clients can contact you</li>
        </ol>
      </div>
    </div>

    <!-- Quick Actions -->
    <div style="margin-bottom:20px">
      <h3 style="font-size:.88rem;font-weight:700;margin-bottom:10px">Quick Actions</h3>
      <div class="admin-actions-grid rendor-quick-actions" style="--primary:#7c3aed;--primary-light:#ede9fe">
        <div class="admin-action-btn" onclick="switchTab(document.querySelectorAll('#rendor-tabs .tab-btn')[2],'rendor-contact')">
          <i class="fas fa-address-card"></i><span>Contact Info</span>
        </div>
        <div class="admin-action-btn" onclick="switchTab(document.querySelectorAll('#rendor-tabs .tab-btn')[1],'rendor-posts');loadRendorPosts()">
          <i class="fas fa-plus-circle"></i><span>My Posts</span>
        </div>
        <div class="admin-action-btn" onclick="switchTab(document.querySelectorAll('#rendor-tabs .tab-btn')[3],'rendor-subscription');renderRendorSubscription()">
          <i class="fas fa-star"></i><span>Subscription</span>
        </div>
      </div>
    </div>

    <!-- Recent posts preview -->
    <h3 style="font-size:.88rem;font-weight:700;margin-bottom:10px">Recent Posts</h3>
    ${myPosts.length === 0
      ? `<div class="empty-state" style="padding:24px 0">
           <i class="fas fa-newspaper"></i>
           <h3>No posts yet</h3>
           <p>Create your first post to start attracting clients</p>
           <button class="btn btn-primary btn-sm" style="margin-top:10px;background:linear-gradient(135deg,#7c3aed,#6d28d9);border-color:#7c3aed"
                   onclick="switchTab(document.querySelectorAll('#rendor-tabs .tab-btn')[1],'rendor-posts');loadRendorPosts()">
             <i class="fas fa-plus"></i> Create Post
           </button>
         </div>`
      : myPosts.slice(0,3).map(p => rendorPostCardHTML(p)).join('')
    }
  </div>
</div>

<!-- ══ MY POSTS ══ -->
<div class="tab-content" id="rendor-posts">
  <div class="dashboard-wrap">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <h3 style="font-weight:700;margin:0;font-size:.9rem">My Posts (${myPosts.length})</h3>
      <button class="btn btn-primary btn-sm" onclick="showAddPostModal()"
              style="background:linear-gradient(135deg,#7c3aed,#6d28d9);border-color:#7c3aed">
        <i class="fas fa-plus"></i> New Post
      </button>
    </div>
    <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:14px;line-height:1.6">
      <i class="fas fa-info-circle"></i> Posts are how clients discover what you offer. Include sample work, rates and how to reach you.
    </p>
    <div id="rendor-posts-list">
      ${myPosts.length === 0
        ? '<div class="empty-state" style="padding:24px 0"><i class="fas fa-newspaper"></i><h3>No posts yet</h3><p>Add your first post to start attracting clients</p></div>'
        : myPosts.map(p => rendorPostCardHTML(p)).join('')}
    </div>
  </div>
</div>

<!-- ══ CONTACT INFO ══ -->
<div class="tab-content" id="rendor-contact">
  <div class="dashboard-wrap" id="rendor-contact-content">
    ${_rendorContactHTML(u)}
  </div>
</div>

<!-- ══ SUBSCRIPTION ══ -->
<div class="tab-content" id="rendor-subscription">
  <div class="dashboard-wrap" id="rendor-sub-content">
    <div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i></div>
  </div>
</div>

<!-- ══ VERIFY ══ -->
<div class="tab-content" id="rendor-verify">
  <div class="dashboard-wrap" id="rendor-verify-content">
    <div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading…</div>
  </div>
</div>
`;
}

// ── Contact Info HTML (inline helper) ────────────────────
function _rendorContactHTML(u) {
  const contacts = [
    { key:'rendor_whatsapp',  icon:'fab fa-whatsapp',  label:'WhatsApp',  placeholder:'+233 24 000 0000' },
    { key:'rendor_email',     icon:'fas fa-envelope',  label:'Email',     placeholder:'you@example.com' },
    { key:'rendor_instagram', icon:'fab fa-instagram', label:'Instagram', placeholder:'@yourusername' },
    { key:'rendor_twitter',   icon:'fab fa-twitter',   label:'X / Twitter', placeholder:'@yourusername' },
    { key:'rendor_facebook',  icon:'fab fa-facebook',  label:'Facebook',  placeholder:'facebook.com/yourpage' },
    { key:'rendor_website',   icon:'fas fa-globe',     label:'Website / Portfolio', placeholder:'https://yoursite.com' },
  ];

  const rows = contacts.map(ct => `
<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
  <div style="width:36px;height:36px;border-radius:50%;background:#ede9fe;display:flex;align-items:center;justify-content:center;flex-shrink:0">
    <i class="${ct.icon}" style="color:#7c3aed;font-size:.95rem"></i>
  </div>
  <div style="flex:1;min-width:0">
    <div style="font-size:.75rem;font-weight:700;color:var(--text-muted);margin-bottom:2px">${ct.label}</div>
    <div style="font-size:.88rem;font-weight:600;color:var(--text)">
      ${escHtml(u[ct.key] || '—')}
    </div>
  </div>
</div>`).join('');

  return `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
  <div>
    <h3 style="font-size:.9rem;font-weight:700;margin:0">Contact Credentials</h3>
    <p style="font-size:.78rem;color:var(--text-muted);margin-top:2px">Clients will use these to reach you directly</p>
  </div>
  <button class="btn btn-sm" style="background:#7c3aed;color:#fff;border:none;padding:5px 12px;border-radius:8px;font-weight:600" onclick="showEditContactModal()">
    <i class="fas fa-edit"></i> Edit
  </button>
</div>
<div class="card">
  <div class="card-body" style="padding:4px 12px">
    ${rows}
    <div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:10px">
      <div style="width:36px;height:36px;border-radius:50%;background:#ede9fe;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px">
        <i class="fas fa-user-tag" style="color:#7c3aed;font-size:.95rem"></i>
      </div>
      <div style="flex:1">
        <div style="font-size:.75rem;font-weight:700;color:var(--text-muted);margin-bottom:2px">Other / Notes</div>
        <div style="font-size:.85rem;color:var(--text);white-space:pre-line;line-height:1.6">${escHtml(u.rendor_contact_other || '—')}</div>
      </div>
    </div>
  </div>
</div>
<p style="font-size:.75rem;color:var(--text-muted);margin-top:10px;line-height:1.6">
  <i class="fas fa-info-circle"></i> These credentials appear on your public profile posts so clients know how to reach you.
</p>`;
}

// ── Reload posts tab ──────────────────────────────────────
async function loadRendorPosts() {
  const el = document.getElementById('rendor-posts-list');
  if (!el || !App.currentUser) return;
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i></div>';
  const res  = await apiGet('services', 'limit=200');
  const list = (res?.data || []).filter(s => s.rendor_id === App.currentUser.id && !s.deleted);
  el.innerHTML = list.length === 0
    ? `<div class="empty-state" style="padding:24px 0">
         <i class="fas fa-newspaper"></i>
         <h3>No posts yet</h3>
         <p>Create your first post to start attracting clients</p>
       </div>`
    : list.map(p => rendorPostCardHTML(p)).join('');
}

// ── Post card HTML ────────────────────────────────────────
function rendorPostCardHTML(p) {
  const statusColor = { active:'var(--success)', paused:'var(--warning)', archived:'var(--text-muted)' };
  const col = statusColor[p.status] || 'var(--text-muted)';
  return `
<div class="card" style="margin-bottom:12px" id="rendor-post-${p.id}">
  <div class="card-body">
    ${p.image_url ? `
    <img src="${escHtml(p.image_url)}" alt=""
         style="width:100%;height:140px;object-fit:cover;border-radius:var(--radius-sm);margin-bottom:10px"
         onerror="this.style.display='none'">` : ''}
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.9rem">${escHtml(p.title)}</div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">
          <i class="fas fa-tag"></i> ${escHtml(p.category||'—')}
          &nbsp;·&nbsp;
          <span style="font-weight:700;color:${col};text-transform:uppercase">${p.status||'active'}</span>
        </div>
        ${p.description ? `<p style="font-size:.8rem;color:var(--text-light);margin-top:6px;line-height:1.6;-webkit-line-clamp:3;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden">${escHtml(p.description)}</p>` : ''}
        ${p.price ? `<div style="font-weight:700;color:var(--primary);font-size:.85rem;margin-top:6px">From GHS ${parseFloat(p.price).toFixed(2)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
        <button class="btn btn-ghost btn-sm" onclick="showEditPostModal('${p.id}')">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="archivePost('${p.id}')">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
    </div>
  </div>
</div>`;
}

// ── Subscription tab ──────────────────────────────────────
// Storefront-style rendor subscription page: plan cards (1 / 3 / 6 months)
// priced from admin settings (per-rendor quote wins if admin set one), pay
// in-app via MoMo, and the subscription activates IMMEDIATELY — no quote
// request round-trip, no admin verification step.
//   * active            → status bar with expiry; renew adds months on top
//   * inactive/expired  → same plan cards; subscribing restarts the cycle
// Get the subscription price for this rendor: per-rendor override wins, else global setting.
async function getRendorSubPrice(u) {
  const override = parseFloat(u.rendor_sub_price_override);
  if (Number.isFinite(override) && override > 0) return override;
  const s = parseFloat(await getSetting('rendor_sub_price', ''));
  return Number.isFinite(s) && s > 0 ? s : 30;
}
// Get subscription duration in months (from admin settings).
async function getRendorSubMonths() {
  const s = parseFloat(await getSetting('rendor_sub_months', ''));
  return Number.isFinite(s) && s > 0 ? Math.round(s) : 1;
}

async function renderRendorSubscription() {
  const el = document.getElementById('rendor-sub-content');
  if (!el) return;
  // Re-fetch fresh user data so subscription status is current.
  const fresh = await apiGet('users/' + App.currentUser.id).catch(() => null);
  if (fresh && !fresh.error) {
    Object.assign(App.currentUser, fresh);
    if (typeof saveSessions === 'function') saveSessions();
  }
  const u = App.currentUser;

  const subStatus = u.rendor_sub_status || null;
  const subExpiry = u.rendor_sub_expiry ? new Date(Number(u.rendor_sub_expiry)) : null;
  const subActive = subStatus === 'active' && subExpiry && subExpiry > new Date();

  // Single price: per-rendor override wins, else global setting.
  const price = await getRendorSubPrice(u);
  const duration = await getRendorSubMonths();
  const durationLabel = duration === 1 ? '1 Month' : duration + ' Months';

  // Status banner
  let statusTitle, statusSub, statusBg, statusIcon, statusColor;
  if (subActive) {
    statusBg = '#d1fae5'; statusColor = '#065f46'; statusIcon = '✅';
    statusTitle = 'Subscription Active';
    statusSub = `Expires ${subExpiry.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})} · Renew below to extend`;
  } else {
    statusBg = '#fee2e2'; statusColor = '#991b1b'; statusIcon = '⏰';
    statusTitle = 'No Active Subscription';
    statusSub = 'Subscribe to make your profile visible to clients.';
  }

  el.innerHTML = `
<!-- Current status -->
<div class="card" style="margin-bottom:20px;border-left:4px solid ${statusColor}">
  <div class="card-body">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="width:44px;height:44px;border-radius:50%;background:${statusBg};display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0">${statusIcon}</div>
      <div>
        <div style="font-weight:800;font-size:.95rem">${statusTitle}</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">${statusSub}</div>
      </div>
    </div>
  </div>
</div>

<!-- How it works -->
<div style="background:linear-gradient(90deg,#ede9fe,#ddd6fe);border:1.5px solid #a78bfa;border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:20px">
  <div style="font-weight:700;font-size:.83rem;color:#4c1d95;margin-bottom:6px"><i class="fas fa-info-circle"></i> How Subscriptions Work</div>
  <ol style="font-size:.8rem;color:#4c1d95;padding-left:16px;line-height:2;margin:0">
    <li>Pay the subscription fee via Mobile Money</li>
    <li>Your profile &amp; posts go live immediately</li>
    <li>Renew any time to extend your expiry date</li>
  </ol>
</div>

<!-- Subscribe / Renew card -->
<div style="flex:1;min-width:250px;background:linear-gradient(135deg,#ede9fe,#ddd6fe);border:2px solid #a78bfa;border-radius:12px;padding:20px;text-align:center;margin-bottom:16px">
  <div style="font-size:.72rem;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">${durationLabel} Subscription</div>
  <div style="font-size:2rem;font-weight:900;color:#4c1d95;margin:8px 0 4px">GHS ${price.toFixed(2)}</div>
  <div style="font-size:.68rem;color:var(--text-muted);margin-bottom:14px">GHS ${(price/duration).toFixed(2)}/month</div>
  <button class="btn" style="width:100%;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border-color:#7c3aed;font-size:.85rem;padding:10px;font-weight:700"
          onclick="requestRendorSubscription(${price},${duration})">
    <i class="fas fa-${subActive ? 'sync' : 'star'}"></i> ${subActive ? '🔄 Renew Now' : '⭐ Subscribe Now'}
  </button>
</div>
<p style="font-size:.74rem;color:var(--text-muted);margin:0 0 4px;line-height:1.6">
  <i class="fas fa-info-circle"></i> ${subActive ? 'Renewing adds ' + durationLabel.toLowerCase() + ' on top of your current expiry date.' : 'Your profile becomes visible to clients as soon as your payment is confirmed.'}
</p>

<!-- Contact admin -->
<div style="background:var(--bg);border-radius:var(--radius-sm);padding:14px;text-align:center;margin-top:12px">
  <div style="font-size:.82rem;font-weight:700;margin-bottom:6px">Need help? Contact Admin</div>
  <button class="btn btn-outline btn-sm" style="border-color:#7c3aed;color:#7c3aed" onclick="showRendorAdminContactModal()">
    <i class="fas fa-headset"></i> Contact Admin
  </button>
</div>`;
}

// ── Step: Rendor pays subscription (storefront-style) ──
async function requestRendorSubscription(total, months) {
  const u = App.currentUser;
  const planLabel = months === 1 ? '1 Month' : months + ' Months';

  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">📋 Subscription — Payment</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <div style="background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;border-radius:var(--radius-md);padding:18px;margin-bottom:18px;text-align:center">
    <div style="font-size:.75rem;opacity:.8">Amount to Pay</div>
    <div style="font-size:2rem;font-weight:900">GHS ${total.toFixed(2)}</div>
    <div style="font-size:.78rem;opacity:.8;margin-top:4px">${planLabel} — GHS ${(total/months).toFixed(2)}/month</div>
  </div>
  <div class="form-group">
    <label class="form-label">MoMo Phone Number *</label>
    <input class="form-control" id="sub-momo-phone-input" type="tel" placeholder="e.g. 024 000 0000"/>
    <div style="font-size:.72rem;color:var(--text-muted);margin-top:4px">MTN MoMo, Vodafone Cash, AirtelTigo accepted. You'll be prompted to authorise the payment.</div>
  </div>
  <button class="btn btn-block" id="sub-confirm-btn"
          style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border-color:#7c3aed"
          onclick="confirmRendorSubscription(${total},${months})">
    <i class="fas fa-lock"></i> Confirm &amp; Pay GHS ${total.toFixed(2)}
  </button>
  <button class="btn btn-ghost btn-block" onclick="closeModalForce()" style="margin-top:6px;color:var(--text-muted)">
    Cancel
  </button>
</div>`);
}

// ── Step: Confirm payment — activates instantly (server-side) ──
// The wallet engine validates the amount, records the payment + revenue, and
// sets rendor_sub_* itself — the client never touches those admin-only fields.
async function confirmRendorSubscription(total, months) {
  const phone = (document.getElementById('sub-momo-phone-input')?.value || '').trim();
  if (!phone || phone.replace(/\D/g, '').length < 9) {
    showToast('Please enter a valid MoMo phone number.', 'error');
    return;
  }
  const u = App.currentUser;
  const btn = document.getElementById('sub-confirm-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing payment…'; }
  const planLabel = months === 1 ? '1 Month' : months + ' Months';

  const res = await apiWallet('rendor-subscribe', {
    months,
    amount: Math.round(parseFloat(total) * 100) / 100,
    method: 'momo',
    payment_ref: 'RENDORSUB-' + u.id + '-' + Date.now(),
    note: `Rendor Subscription: ${planLabel} via MoMo (${phone})`
  }).catch(() => null);

  if (!res || res.error) {
    const msg = (res && res.error) || window.lastApiError || 'Payment could not be processed. Please try again.';
    showToast(String(msg).replace(/^HTTP \d+: /, ''), 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fas fa-lock"></i> Confirm &amp; Pay GHS ${total.toFixed(2)}`; }
    return;
  }

  // Update local user state from the server's activation.
  if (res.expiry) {
    App.currentUser.rendor_sub_status = 'active';
    App.currentUser.rendor_sub_plan = months + 'month';
    App.currentUser.rendor_sub_expiry = res.expiry;
    App.currentUser.sub_request_status = null;
    App.currentUser.sub_payment_status = null;
    App.currentUser.sub_payment_months = null;
    App.currentUser.sub_payment_amount = null;
    App.currentUser.sub_paid_at = null;
    App.currentUser.sub_payment_ref = null;
    if (typeof saveSessions === 'function') saveSessions();
  }

  // Re-fetch full user data from server to sync derived fields (rendor_sub_active, etc.)
  const freshUser = await apiGet('users/' + u.id).catch(() => null);
  if (freshUser && !freshUser.error) {
    Object.assign(App.currentUser, freshUser);
    if (typeof saveSessions === 'function') saveSessions();
  }

  // Notify admins so they can see the new subscription in their dashboard.
  const adminsRes = await apiGet('users', 'limit=200');
  const admins = (adminsRes?.data || []).filter(a => a.role === 'admin');
  for (const admin of admins) {
    addNotification(admin.id, 'system',
      `💳 Rendor Subscription Payment — ${planLabel}`,
      `${u.rendor_display_name || u.name} (${u.email}) subscribed to the ${planLabel} plan (GHS ${parseFloat(total).toFixed(2)}) via MoMo.`
    );
  }
  addNotification(u.id, 'system',
    '✅ Subscription Active!',
    `Your ${planLabel} subscription is now active${res.expiry ? ' until ' + new Date(Number(res.expiry)).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : ''}.`
  );

  showToast(`🎉 ${planLabel} plan activated! Your profile is now visible to clients.`, 'success');
  closeModalForce();
  renderRendorSubscription();
}

// ── Contact admin modal ────────────────────────────────────
async function showRendorAdminContactModal() {
  const u = App.currentUser;
  // Use the admin's configured support WhatsApp number (Admin → Settings → Customer Care)
  // so any update the admin makes is reflected here automatically.
  const adminWhatsApp = await getSetting('support_whatsapp', '233240000000');
  const waHref = waMeHref(adminWhatsApp);
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">🎧 Contact Admin</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <p style="font-size:.85rem;color:var(--text-light);margin-bottom:16px;line-height:1.7">
    Chat with admin regarding your subscription or account.
  </p>
  ${waHref ? `
  <a class="btn btn-block" href="${waHref}" target="_blank" rel="noopener"
     style="background:#25d366;color:#fff;border-color:#25d366;margin-bottom:14px;display:inline-flex;align-items:center;justify-content:center;gap:8px">
    <i class="fab fa-whatsapp"></i> Chat with Admin on WhatsApp
  </a>
  <div style="display:flex;align-items:center;gap:10px;margin:4px 0 14px;color:var(--text-muted);font-size:.75rem">
    <div style="flex:1;height:1px;background:var(--border)"></div>
    <span>or send an in-app message</span>
    <div style="flex:1;height:1px;background:var(--border)"></div>
  </div>` : ''}
  <div class="form-group">
    <label class="form-label">Message *</label>
    <textarea class="form-control" id="admin-msg-inp" rows="4"
              placeholder="e.g. I have paid GHS 30 for monthly subscription via MTN MoMo…"></textarea>
  </div>
  <button class="btn btn-block" id="admin-msg-btn"
          style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border-color:#7c3aed"
          onclick="sendAdminMessage()">
    <i class="fas fa-paper-plane"></i> Send Message
  </button>
</div>`);
}

async function sendAdminMessage() {
  const msg = document.getElementById('admin-msg-inp')?.value.trim();
  if (!msg) { showToast('Please enter a message', 'warning'); return; }

  const btn = document.getElementById('admin-msg-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…'; }

  try {
    const u = App.currentUser;
    const adminsRes = await apiGet('users', 'limit=200');
    const admins = (adminsRes?.data || []).filter(a => a.role === 'admin');
    for (const admin of admins) {
      addNotification(admin.id, 'system',
        `📩 Message from ${u.rendor_display_name||u.name}`,
        `${msg}\n\n— ${u.name} (${u.email}, ${u.phone||''})`
      );
    }
    showToast('Message sent to admin ✅', 'success');
    closeModalForce();
  } catch (e) {
    showToast('Failed to send message. Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Message'; }
  }
}

// ── Edit contact credentials modal ───────────────────────
function showEditContactModal() {
  const u = App.currentUser;
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">📇 Edit Contact Info</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:14px;line-height:1.6">
    These credentials are shown on your profile so clients can reach you directly.
  </p>
  <div class="form-group">
    <label class="form-label"><i class="fab fa-whatsapp" style="color:#25d366"></i> WhatsApp</label>
    <input class="form-control" id="ct-whatsapp" placeholder="+233 24 000 0000" value="${escHtml(u.rendor_whatsapp||'')}">
  </div>
  <div class="form-group">
    <label class="form-label"><i class="fas fa-envelope" style="color:var(--primary)"></i> Email</label>
    <input class="form-control" id="ct-email" type="email" placeholder="you@example.com" value="${escHtml(u.rendor_email||'')}">
  </div>
  <div class="form-group">
    <label class="form-label"><i class="fab fa-instagram" style="color:#e1306c"></i> Instagram</label>
    <input class="form-control" id="ct-instagram" placeholder="@yourusername" value="${escHtml(u.rendor_instagram||'')}">
  </div>
  <div class="form-group">
    <label class="form-label"><i class="fab fa-twitter" style="color:#1da1f2"></i> X / Twitter</label>
    <input class="form-control" id="ct-twitter" placeholder="@yourusername" value="${escHtml(u.rendor_twitter||'')}">
  </div>
  <div class="form-group">
    <label class="form-label"><i class="fab fa-facebook" style="color:#1877f2"></i> Facebook</label>
    <input class="form-control" id="ct-facebook" placeholder="facebook.com/yourpage" value="${escHtml(u.rendor_facebook||'')}">
  </div>
  <div class="form-group">
    <label class="form-label"><i class="fas fa-globe" style="color:var(--info)"></i> Website / Portfolio</label>
    <input class="form-control" id="ct-website" placeholder="https://yoursite.com" value="${escHtml(u.rendor_website||'')}">
  </div>
  <div class="form-group">
    <label class="form-label">Other / Notes</label>
    <textarea class="form-control" id="ct-other" rows="2"
              placeholder="Any other contact details or instructions…">${escHtml(u.rendor_contact_other||'')}</textarea>
  </div>
  <button class="btn btn-block" id="ct-save-btn" onclick="saveContactInfo()"
          style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border-color:#7c3aed;margin-top:4px">
    <i class="fas fa-save"></i> Save Contact Info
  </button>
</div>`);
}

async function saveContactInfo() {
  const btn = document.getElementById('ct-save-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }

  const patch = {
    rendor_whatsapp:       document.getElementById('ct-whatsapp')?.value.trim()  || '',
    rendor_email:          document.getElementById('ct-email')?.value.trim()     || '',
    rendor_instagram:      document.getElementById('ct-instagram')?.value.trim() || '',
    rendor_twitter:        document.getElementById('ct-twitter')?.value.trim()   || '',
    rendor_facebook:       document.getElementById('ct-facebook')?.value.trim()  || '',
    rendor_website:        document.getElementById('ct-website')?.value.trim()   || '',
    rendor_contact_other:  document.getElementById('ct-other')?.value.trim()     || '',
  };

  await apiPatch('users', App.currentUser.id, patch);
  Object.assign(App.currentUser, patch);
  saveSessions();

  showToast('Contact info saved ✅', 'success');
  closeModalForce();

  // Refresh contact tab in-place
  const el = document.getElementById('rendor-contact-content');
  if (el) el.innerHTML = _rendorContactHTML(App.currentUser);
}

// ── Verify tab ────────────────────────────────────────────
// Mirrors the vendor verification flow: Phone OTP → ID & document uploads
// (ID + proof of previous sales + link-share proof) → Admin Approval. The
// upload modal and OTP helpers are shared with the vendor dashboard so the
// experience is identical.
function renderRendorVerify() {
  const el = document.getElementById('rendor-verify-content');
  if (!el) return;
  const u = App.currentUser;
  el.innerHTML = `
<div class="dashboard-wrap">
  <h3 style="font-size:1rem;font-weight:700;margin-bottom:14px">Rendor Verification</h3>
  <div class="verify-steps">
    <div class="verify-step ${u.is_verified?'done':'pending-step'}">
      <div class="verify-step-icon"><i class="fas fa-${u.is_verified?'check':'phone'}"></i></div>
      <div>
        <div style="font-weight:700;font-size:.875rem">Phone OTP Verification</div>
        <div style="font-size:.78rem;color:var(--text-muted)">${u.is_verified?'✅ Verified':'Pending — verify your phone number'}</div>
        ${!u.is_verified ? `<button class="btn btn-warning btn-sm" style="margin-top:6px" onclick="resendOTP()">Resend OTP</button>` : ''}
      </div>
    </div>
    <div class="verify-step ${u.id_verified?'done':(u.id_image?'done':'pending-step')}">
      <div class="verify-step-icon"><i class="fas fa-${u.id_verified?'check':(u.id_image?'clock':'id-card')}"></i></div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.875rem">ID & Verification Uploads</div>
        <div style="font-size:.78rem;color:var(--text-muted)">
          ${u.id_verified ? '✅ Verified' : (u.id_image ? '⏳ Awaiting Admin Approval' : 'Upload ID, proof of previous sales, and link-sharing screenshot')}
        </div>
        ${!u.id_verified ? `
          <button class="btn btn-warning btn-sm" style="margin-top:8px" onclick="showVerificationUploadModal('${u.id}')">
            <i class="fas fa-cloud-upload-alt"></i> ${u.id_image ? 'Update / Re-upload Documents' : 'Upload Documents'}
          </button>
        ` : ''}
      </div>
    </div>
    <div class="verify-step ${u.id_verified&&u.is_verified?'done':'pending-step'}">
      <div class="verify-step-icon"><i class="fas fa-${u.id_verified&&u.is_verified?'check':'shield-alt'}"></i></div>
      <div>
        <div style="font-weight:700;font-size:.875rem">Admin Approval</div>
        <div style="font-size:.78rem;color:var(--text-muted)">${u.id_verified&&u.is_verified?'✅ Approved — profile verified':'Awaiting verification completion'}</div>
      </div>
    </div>
  </div>
</div>`;
}

// ── Add / Edit post modal ─────────────────────────────────
function showAddPostModal() {
  _showPostModal(null);
}

async function showEditPostModal(postId) {
  const post = await apiFetch('services/' + postId);
  _showPostModal(post);
}

function _showPostModal(post) {
  const isEdit = !!post;
  // If editing and post already has an image, show thumb immediately
  const hasExistingImg = isEdit && post?.image_url;
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">${isEdit ? '✏️ Edit Post' : '➕ New Post'}</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body" style="overflow-y:auto;max-height:80vh">
  <div class="form-group">
    <label class="form-label">Post Title *</label>
    <input class="form-control" id="post-title" placeholder="e.g. LinkedIn Profile Rewrite — GHS 50"
           value="${escHtml(post?.title||'')}">
  </div>
  <div class="form-group">
    <label class="form-label">Category *</label>
    <select class="form-control form-select" id="post-cat">
      <option value="">Select…</option>
      ${SERVICE_CATEGORIES.map(c => `<option value="${c}"${post?.category===c?' selected':''}>${c}</option>`).join('')}
    </select>
  </div>
  <div class="form-group">
    <label class="form-label">Description / What You Offer</label>
    <textarea class="form-control" id="post-desc" rows="4"
              placeholder="Describe your service, what clients get, your experience, turnaround time…">${escHtml(post?.description||'')}</textarea>
  </div>
  <div class="form-group">
    <label class="form-label">Starting Price (GHS) <span style="color:var(--text-muted)">(optional)</span></label>
    <input class="form-control" id="post-price" type="number" min="0" step="0.01"
           placeholder="e.g. 50" value="${post?.price||''}">
  </div>

  <!-- ── Image upload (local file) ── -->
  <div class="form-group">
    <label class="form-label">
      Post Image <span style="color:var(--text-muted)">(optional — portfolio / sample work)</span>
    </label>
    <div class="upload-area" id="post-img-upload-area"
         onclick="document.getElementById('post-img-file').click()" style="cursor:pointer">
      <i class="fas fa-image" style="color:#7c3aed;font-size:1.6rem"></i>
      <p style="margin:6px 0 2px;font-size:.85rem;font-weight:600">Tap to choose an image</p>
      <p style="font-size:.72rem;color:var(--text-muted)">JPG, PNG or WEBP · Max 5 MB</p>
    </div>
    <input type="file" id="post-img-file" accept="image/*" style="display:none"
           onchange="previewProductImage(this,'post-img-preview','post-img-b64')">
    <!-- Preview (visible once file chosen OR when editing an existing image) -->
    <div id="post-img-preview" style="margin-top:8px;display:${hasExistingImg?'flex':'none'};align-items:center;gap:10px">
      <img id="post-img-thumb"
           src="${hasExistingImg ? escHtml(post.image_url) : ''}"
           style="width:80px;height:80px;border-radius:8px;object-fit:cover;border:2px solid var(--border)">
      <button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger)"
              onclick="clearProductImage('post-img-preview','post-img-file','post-img-b64');document.getElementById('post-img-keep').value=''">
        <i class="fas fa-times"></i> Remove
      </button>
    </div>
    <!-- Hidden inputs: b64 holds new upload; keep holds the existing URL when editing -->
    <input type="hidden" id="post-img-b64">
    <input type="hidden" id="post-img-keep" value="${hasExistingImg ? escHtml(post.image_url) : ''}">
  </div>

  <div class="form-group">
    <label class="form-label">Status</label>
    <select class="form-control form-select" id="post-status">
      <option value="active"${(!post||post.status==='active')?' selected':''}>Active (visible)</option>
      <option value="paused"${post?.status==='paused'?' selected':''}>Paused (hidden)</option>
    </select>
  </div>
  <button class="btn btn-block" id="post-save-btn" onclick="savePost('${post?.id||''}')"
          style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border-color:#7c3aed;margin-top:8px">
    <i class="fas fa-save"></i> ${isEdit ? 'Update Post' : 'Publish Post'}
  </button>
</div>`);
}

async function savePost(postId) {
  const title  = (document.getElementById('post-title')?.value || '').trim();
  const cat    = document.getElementById('post-cat')?.value || '';
  const desc   = (document.getElementById('post-desc')?.value || '').trim();
  const price  = parseFloat(document.getElementById('post-price')?.value) || 0;
  const status = document.getElementById('post-status')?.value || 'active';

  // Image: prefer newly uploaded base64; fall back to existing URL kept from edit
  const imgB64  = (document.getElementById('post-img-b64')?.value  || '').trim();
  const imgKeep = (document.getElementById('post-img-keep')?.value || '').trim();
  const imageUrl = imgB64 || imgKeep;

  if (!title) { showToast('Please enter a post title', 'warning'); return; }
  if (!cat)   { showToast('Please select a category', 'warning'); return; }
  if (!App.currentUser) { showToast('You must be logged in', 'error'); return; }
  if (!imageUrl && !postId) {
    if (!confirm('Publish without an image? Posts with images get more attention.')) return;
  }

  const btn = document.getElementById('post-save-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }

  const payload = {
    title,
    category:      cat,
    description:   desc,
    price:         price,
    image_url:     imageUrl,
    status:        status,
    rendor_id:     App.currentUser.id,
    delivery_days: 1   // schema compat — not displayed to clients
  };

  let result = null;
  if (postId) {
    result = await apiPut('services', postId, payload);
  } else {
    result = await apiPost('services', payload);
  }

  if (!result) {
    showToast('Failed to save post — please try again.', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fas fa-save"></i> ${postId ? 'Update Post' : 'Publish Post'}`;
    }
    return;
  }

  showToast(postId ? 'Post updated ✅' : 'Post published ✅', 'success');
  closeModalForce();
  loadRendorPosts();
}

async function archivePost(postId) {
  if (!confirm('Delete this post? It will be removed from your profile.')) return;
  const card = document.getElementById('rendor-post-' + postId);
  const btn = card?.querySelector('[onclick*=archivePost]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  await apiPatch('services', postId, { status: 'archived' });
  showToast('Post removed', 'info');
  loadRendorPosts();
}

// ── Edit profile modal ────────────────────────────────────
function showEditRendorProfileModal() {
  const u = App.currentUser;
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">✏️ Edit Profile</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <div class="form-group">
    <label class="form-label">Display / Brand Name *</label>
    <input class="form-control" id="rp-name" type="text" value="${escHtml(u.rendor_display_name||u.name)}">
  </div>
  <div class="form-group">
    <label class="form-label">Service Category *</label>
    <select class="form-control form-select" id="rp-cat">
      ${SERVICE_CATEGORIES.map(c => `<option value="${c}"${u.rendor_service_cat===c?' selected':''}>${c}</option>`).join('')}
    </select>
  </div>
  <div class="form-group">
    <label class="form-label">Bio / What You Offer *</label>
    <textarea class="form-control" id="rp-bio" rows="3">${escHtml(u.rendor_bio||'')}</textarea>
  </div>
  <div class="form-group">
    <label class="form-label">Starting Price (GHS) <span style="color:var(--text-muted)">(optional)</span></label>
    <input class="form-control" id="rp-price" type="number" min="0" value="${u.rendor_starting_price||''}">
  </div>
  <div class="form-group">
    <label class="form-label">Skills / Tags <span style="color:var(--text-muted)">(comma separated)</span></label>
    <input class="form-control" id="rp-tags" placeholder="e.g. LinkedIn, copywriting, branding"
           value="${escHtml(u.rendor_tags||'')}">
  </div>
  <button class="btn btn-block" id="rp-save-btn" onclick="saveRendorProfile()"
          style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border-color:#7c3aed;margin-top:8px">
    <i class="fas fa-save"></i> Save Profile
  </button>
</div>`);
}

async function saveRendorProfile() {
  const displayName = document.getElementById('rp-name')?.value.trim();
  const cat         = document.getElementById('rp-cat')?.value;
  const bio         = document.getElementById('rp-bio')?.value.trim();
  const price       = parseFloat(document.getElementById('rp-price')?.value) || 0;
  const tags        = document.getElementById('rp-tags')?.value.trim();

  if (!displayName) { showToast('Display name is required', 'warning'); return; }
  if (!bio)         { showToast('Please describe your services', 'warning'); return; }

  const btn = document.getElementById('rp-save-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }

  const patch = {
    rendor_display_name:   displayName,
    rendor_service_cat:    cat,
    rendor_bio:            bio,
    rendor_starting_price: price,
    rendor_tags:           tags,
  };
  await apiPatch('users', App.currentUser.id, patch);
  Object.assign(App.currentUser, patch);
  saveSessions();
  showToast('Profile updated ✅', 'success');
  closeModalForce();
  renderRendorDashboard();
}

// ── Phone verify ──────────────────────────────────────────
function startRendorPhoneVerify() {
  const u = App.currentUser;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">📱 Verify Phone</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <p style="font-size:.875rem;color:var(--text-light);margin-bottom:16px">
    OTP sent to <strong>${escHtml(u.phone||'')}</strong>.<br>
    <span style="color:var(--primary)">[Demo: OTP is <strong>${otp}</strong>]</span>
  </p>
  <div class="form-group">
    <input class="form-control" id="rendor-otp-inp" type="text" maxlength="6"
           style="font-size:1.3rem;letter-spacing:8px;text-align:center" placeholder="——————">
  </div>
  <button class="btn btn-primary btn-block" onclick="confirmRendorOTP('${otp}')">
    <i class="fas fa-check-circle"></i> Verify
  </button>
</div>`);
}

async function confirmRendorOTP(expected) {
  const entered = document.getElementById('rendor-otp-inp')?.value.trim();
  if (entered !== expected) { showToast('Incorrect OTP', 'error'); return; }
  const btn = document.querySelector('.modal-body .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying…'; }
  await apiPatch('users', App.currentUser.id, { is_verified: true });
  App.currentUser.is_verified = true;
  saveSessions();
  closeModalForce();
  showToast('Phone verified ✅', 'success');
  renderRendorVerify();
}

// ── ID upload (demo) ──────────────────────────────────────
async function handleRendorIdUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    showToast('File too large. Max 10MB.', 'warning');
    input.value = '';
    return;
  }
  try {
    const base64 = await compressImage(file, 1200, 0.8);
    await apiPatch('users', App.currentUser.id, {
      id_image: base64,
      id_verified: false
    });
    App.currentUser.id_image = base64;
    App.currentUser.id_verified = false;
    saveSessions();
    showToast('ID document uploaded — awaiting admin review ✅', 'success');
    renderRendorVerify();
  } catch (e) {
    console.error('Failed to process ID image:', e);
    showToast('Failed to process image.', 'error');
  }
}
