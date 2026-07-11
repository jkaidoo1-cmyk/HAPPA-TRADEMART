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
    <button class="btn btn-outline btn-sm" style="border-color:#a78bfa;color:#7c3aed"
            onclick="showEditRendorProfileModal()">
      <i class="fas fa-edit"></i> Edit
    </button>
    <button class="btn btn-outline btn-sm" style="border-color:var(--primary);color:var(--primary);padding:3px 8px;font-size:0.7rem;display:inline-flex;align-items:center;gap:4px"
            onclick="window.triggerPWAInstall()">
      <i class="fas fa-download"></i> Install App
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
  <div class="tab-btn active" onclick="switchTab(this,'rendor-overview')">Overview</div>
  <div class="tab-btn" onclick="switchTab(this,'rendor-posts');loadRendorPosts()">My Posts</div>
  <div class="tab-btn" onclick="switchTab(this,'rendor-contact')">Contact Info</div>
  <div class="tab-btn" onclick="switchTab(this,'rendor-subscription');renderRendorSubscription()">Subscription</div>
  <div class="tab-btn" onclick="switchTab(this,'rendor-wallet');renderRendorWallet()">Wallet</div>
  <div class="tab-btn" onclick="switchTab(this,'rendor-verify');renderRendorVerify()">Verify</div>
</div>

<!-- ══ OVERVIEW ══ -->
<div class="tab-content active" id="rendor-overview">
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
        <div class="stat-icon" style="background:#dbeafe"><i class="fas fa-wallet" style="color:#1d4ed8"></i></div>
        <div class="stat-value">GHS ${(u.wallet_balance||0).toFixed(2)}</div>
        <div class="stat-label">Wallet</div>
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
          <li>Keep your <strong>subscription active</strong> so your profile stays visible</li>
        </ol>
      </div>
    </div>

    <!-- Quick Actions -->
    <h3 style="font-size:.88rem;font-weight:700;margin-bottom:10px">Quick Actions</h3>
    <div class="quick-actions-grid" style="margin-bottom:20px">
      <button class="quick-action-btn" onclick="switchTab(document.querySelectorAll('#rendor-tabs .tab-btn')[2],'rendor-contact')">
        <i class="fas fa-address-card"></i><span>Contact Info</span>
      </button>
      <button class="quick-action-btn" onclick="switchTab(document.querySelectorAll('#rendor-tabs .tab-btn')[1],'rendor-posts');loadRendorPosts()">
        <i class="fas fa-plus-circle"></i><span>My Posts</span>
      </button>
      <button class="quick-action-btn" onclick="switchTab(document.querySelectorAll('#rendor-tabs .tab-btn')[3],'rendor-subscription');renderRendorSubscription()">
        <i class="fas fa-star"></i><span>Subscription</span>
      </button>
      <button class="quick-action-btn" onclick="switchTab(document.querySelectorAll('#rendor-tabs .tab-btn')[4],'rendor-wallet');renderRendorWallet()">
        <i class="fas fa-wallet"></i><span>Wallet</span>
      </button>
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

<!-- ══ WALLET ══ -->
<div class="tab-content" id="rendor-wallet">
  <div class="dashboard-wrap" id="rendor-wallet-content">
    <div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading…</div>
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
  <button class="btn btn-outline btn-sm" style="border-color:#7c3aed;color:#7c3aed" onclick="showEditContactModal()">
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
function renderRendorSubscription() {
  const el = document.getElementById('rendor-sub-content');
  if (!el) return;
  const u = App.currentUser;

  const subStatus = u.rendor_sub_status || null;
  const subExpiry = u.rendor_sub_expiry ? new Date(Number(u.rendor_sub_expiry)) : null;
  const subActive = subStatus === 'active' && subExpiry && subExpiry > new Date();

  const plans = [
    { id:'monthly', label:'Monthly', price:30, desc:'30 days of visibility', icon:'📅' },
    { id:'quarterly', label:'3 Months', price:80, desc:'90 days — save GHS 10', icon:'📆' },
    { id:'biannual', label:'6 Months', price:150, desc:'180 days — save GHS 30', icon:'🗓️' },
  ];

  el.innerHTML = `
<!-- Current status -->
<div class="card" style="margin-bottom:20px;border-left:4px solid ${subActive?'var(--success)':'var(--danger)'}">
  <div class="card-body">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="width:44px;height:44px;border-radius:50%;background:${subActive?'#d1fae5':'#fee2e2'};display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0">
        ${subActive ? '✅' : '⏰'}
      </div>
      <div>
        <div style="font-weight:800;font-size:.95rem">${subActive ? 'Subscription Active' : 'No Active Subscription'}</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:2px">
          ${subActive
            ? `Expires ${subExpiry.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}`
            : 'Subscribe to keep your profile visible to clients on HAPPA TRADEMART'}
        </div>
      </div>
    </div>
  </div>
</div>

<!-- How it works -->
<div style="background:linear-gradient(90deg,#ede9fe,#ddd6fe);border:1.5px solid #a78bfa;border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:20px">
  <div style="font-weight:700;font-size:.83rem;color:#4c1d95;margin-bottom:6px"><i class="fas fa-info-circle"></i> About the Subscription</div>
  <ul style="font-size:.8rem;color:#4c1d95;padding-left:16px;line-height:2;margin:0">
    <li>Your profile &amp; posts are visible to clients while your subscription is active</li>
    <li>Clients contact you <strong>directly</strong> using your posted credentials — no in-app booking</li>
    <li>Payment is made directly to HAPPA TRADEMART admin</li>
    <li>Contact admin via WhatsApp or in-app to renew or pay</li>
  </ul>
</div>

<!-- Plans -->
<h3 style="font-size:.9rem;font-weight:700;margin-bottom:12px">Subscription Plans</h3>
<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">
  ${plans.map(pl => `
  <div class="card" style="border:2px solid var(--border);transition:border-color .2s"
       onmouseover="this.style.borderColor='#7c3aed'" onmouseout="this.style.borderColor='var(--border)'">
    <div class="card-body" style="display:flex;align-items:center;gap:12px">
      <div style="font-size:1.6rem;flex-shrink:0">${pl.icon}</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.9rem">${pl.label}</div>
        <div style="font-size:.75rem;color:var(--text-muted)">${pl.desc}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-weight:800;font-size:1.05rem;color:var(--primary)">GHS ${pl.price}</div>
        <button class="btn btn-sm" style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border-color:#7c3aed;font-size:.72rem;margin-top:4px"
                onclick="requestSubscription('${pl.id}',${pl.price},'${pl.label}')">
          ${subActive ? 'Renew' : 'Subscribe'}
        </button>
      </div>
    </div>
  </div>`).join('')}
</div>

<!-- Contact admin -->
<div style="background:var(--bg);border-radius:var(--radius-sm);padding:14px;text-align:center">
  <div style="font-size:.82rem;font-weight:700;margin-bottom:6px">Need help? Contact Admin</div>
  <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:10px;line-height:1.6">
    To activate or renew your subscription, pay via Mobile Money and send proof to admin.
  </p>
  <button class="btn btn-outline btn-sm" style="border-color:#7c3aed;color:#7c3aed" onclick="showRendorAdminContactModal()">
    <i class="fas fa-headset"></i> Contact Admin
  </button>
</div>`;
}

// ── Request subscription (sends notification to admin) ────
async function requestSubscription(planId, price, planLabel) {
  const u = App.currentUser;
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">📋 Subscribe — ${planLabel}</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <div style="background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;border-radius:var(--radius-md);padding:18px;margin-bottom:18px;text-align:center">
    <div style="font-size:.75rem;opacity:.8">Amount to Pay</div>
    <div style="font-size:2rem;font-weight:900">GHS ${price}</div>
    <div style="font-size:.78rem;opacity:.8;margin-top:4px">${planLabel} plan</div>
  </div>
  <div class="card" style="margin-bottom:16px">
    <div class="card-body">
      <div style="font-weight:700;font-size:.85rem;margin-bottom:10px">📱 Payment Instructions</div>
      <ol style="font-size:.82rem;color:var(--text-light);padding-left:16px;line-height:2;margin:0">
        <li>Send <strong>GHS ${price}</strong> via Mobile Money to admin</li>
        <li>Use your registered phone <strong>${escHtml(u.phone||'')}</strong> as reference</li>
        <li>Take a screenshot of your payment</li>
        <li>Click <strong>"Notify Admin"</strong> below — admin will activate your subscription</li>
      </ol>
    </div>
  </div>
  <button class="btn btn-block" id="sub-notify-btn"
          style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border-color:#7c3aed"
          onclick="notifyAdminSubscription('${planId}',${price},'${planLabel}')">
    <i class="fas fa-bell"></i> I've Paid — Notify Admin
  </button>
  <button class="btn btn-ghost btn-block" onclick="closeModalForce()" style="margin-top:6px;color:var(--text-muted)">
    Cancel
  </button>
</div>`);
}

async function notifyAdminSubscription(planId, price, planLabel) {
  const btn = document.getElementById('sub-notify-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…'; }

  const u = App.currentUser;
  // Send notification to all admin users
  const adminsRes = await apiGet('users', 'limit=200');
  const admins = (adminsRes?.data || []).filter(a => a.role === 'admin');
  for (const admin of admins) {
    addNotification(admin.id, 'system',
      `💳 Rendor Subscription Request`,
      `${u.rendor_display_name||u.name} (${u.email}) has paid GHS ${price} for a ${planLabel} subscription. Please verify and activate their account.`
    );
  }
  // Also notify the rendor themselves
  addNotification(u.id, 'system',
    '✅ Subscription Request Sent',
    `Your ${planLabel} subscription request (GHS ${price}) has been sent to admin. You'll be notified once it's activated.`
  );

  showToast('Admin notified! Your subscription will be activated shortly.', 'success');
  closeModalForce();
}

// ── Contact admin modal ────────────────────────────────────
function showRendorAdminContactModal() {
  const u = App.currentUser;
  showModal(`
<div class="modal-handle"></div>
<div class="modal-header">
  <span class="modal-title">🎧 Contact Admin</span>
  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>
</div>
<div class="modal-body">
  <p style="font-size:.85rem;color:var(--text-light);margin-bottom:16px;line-height:1.7">
    Send a message to admin regarding your subscription or account.
  </p>
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

// ── Wallet tab ────────────────────────────────────────────
function renderRendorWallet() {
  const el = document.getElementById('rendor-wallet-content');
  if (!el) return;
  const u = App.currentUser;
  el.innerHTML = `
<div style="background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;border-radius:var(--radius-md);padding:20px;margin-bottom:20px">
  <div style="font-size:.75rem;opacity:.8">Wallet Balance</div>
  <div style="font-size:2rem;font-weight:900">GHS ${(u.wallet_balance||0).toFixed(2)}</div>
  <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
    <button class="btn btn-sm" onclick="showDepositModal()" style="background:rgba(255,255,255,.2);color:#fff;border-color:transparent">
      <i class="fas fa-arrow-down"></i> Top Up
    </button>
    <button class="btn btn-sm" onclick="showWithdrawalModal()" style="background:rgba(255,255,255,.2);color:#fff;border-color:transparent">
      <i class="fas fa-arrow-up"></i> Withdraw
    </button>
  </div>
</div>
<p style="font-size:.8rem;color:var(--text-muted);margin-bottom:14px;line-height:1.6">
  <i class="fas fa-info-circle"></i> Your wallet is for platform top-ups and subscriptions. Earnings from client work are handled directly between you and the client.
</p>
<h3 style="font-size:.88rem;font-weight:700;margin-bottom:10px">Transaction History</h3>
<div id="rendor-txn-wrap">
  <div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i></div>
</div>`;
  renderWalletHistory('rendor-txn-wrap');
}

// ── Verify tab ────────────────────────────────────────────
function renderRendorVerify() {
  const el = document.getElementById('rendor-verify-content');
  if (!el) return;
  const u = App.currentUser;
  el.innerHTML = `
<h3 style="font-size:.9rem;font-weight:700;margin-bottom:16px"><i class="fas fa-shield-alt" style="color:#7c3aed"></i> Profile Verification</h3>
<p style="font-size:.82rem;color:var(--text-muted);margin-bottom:16px;line-height:1.7">
  Verified rendors receive a <strong>✅ Verified</strong> badge on their profile, rank higher in searches and build more trust with clients.
</p>

<!-- Step 1: Phone -->
<div class="card" style="margin-bottom:10px;border-left:4px solid ${u.is_verified?'var(--success)':'var(--warning)'}">
  <div class="card-body">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:36px;height:36px;border-radius:50%;background:${u.is_verified?'#d1fae5':'#fef3c7'};display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">
        ${u.is_verified?'<i class="fas fa-check" style="color:#059669"></i>':'<span style="color:#d97706">1</span>'}
      </div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.88rem">Phone OTP Verification</div>
        <div style="font-size:.78rem;color:var(--text-muted)">${u.is_verified?'Phone number verified ✓':'Verify your phone number with a one-time code'}</div>
      </div>
      ${!u.is_verified?`<button class="btn btn-outline btn-sm" style="border-color:#7c3aed;color:#7c3aed" onclick="startRendorPhoneVerify()">Verify</button>`:''}
    </div>
  </div>
</div>

<!-- Step 2: ID -->
<div class="card" style="margin-bottom:10px;border-left:4px solid ${u.id_verified?'var(--success)':'var(--border)'}">
  <div class="card-body">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:36px;height:36px;border-radius:50%;background:${u.id_verified?'#d1fae5':'var(--bg)'};display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">
        ${u.id_verified?'<i class="fas fa-check" style="color:#059669"></i>':'<span style="color:var(--text-muted)">2</span>'}
      </div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.88rem">ID Document Upload</div>
        <div style="font-size:.78rem;color:var(--text-muted)">${u.id_verified?'ID document verified ✓':'Upload a national ID, passport or Ghana Card'}</div>
      </div>
      ${!u.id_verified?`
      <label class="btn btn-outline btn-sm" style="border-color:#7c3aed;color:#7c3aed;cursor:pointer">
        <i class="fas fa-upload"></i> Upload
        <input type="file" accept=".jpg,.jpeg,.png,.pdf" style="display:none" onchange="handleRendorIdUpload(this)">
      </label>`:''}
    </div>
  </div>
</div>

<!-- Step 3: Admin review -->
<div class="card" style="margin-bottom:10px;border-left:4px solid ${(u.is_verified&&u.id_verified)?'var(--success)':'var(--border)'}">
  <div class="card-body">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:36px;height:36px;border-radius:50%;background:${(u.is_verified&&u.id_verified)?'#d1fae5':'var(--bg)'};display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0">
        ${(u.is_verified&&u.id_verified)?'<i class="fas fa-check" style="color:#059669"></i>':'<span style="color:var(--text-muted)">3</span>'}
      </div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.88rem">Admin Review</div>
        <div style="font-size:.78rem;color:var(--text-muted)">
          ${(u.is_verified&&u.id_verified)
            ? 'Documents submitted — awaiting admin review'
            : 'Complete steps 1 &amp; 2 to trigger admin review'}
        </div>
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
  console.log('[DEMO] Rendor Phone OTP:', otp);
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
  await apiPatch('users', App.currentUser.id, { is_verified: true });
  App.currentUser.is_verified = true;
  saveSessions();
  closeModalForce();
  showToast('Phone verified ✅', 'success');
  renderRendorVerify();
}

// ── ID upload (demo) ──────────────────────────────────────
async function handleRendorIdUpload(input) {
  if (!input.files || !input.files[0]) return;
  await apiPatch('users', App.currentUser.id, { id_verified: true });
  App.currentUser.id_verified = true;
  saveSessions();
  showToast('ID document uploaded — awaiting admin review ✅', 'success');
  renderRendorVerify();
}
