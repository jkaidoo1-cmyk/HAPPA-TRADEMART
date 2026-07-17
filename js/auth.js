/* ============================================================

   HAPPA TRADEMART — Authentication Module

   ============================================================ */


let authMode = 'login'; // login | register
let authRole = 'buyer'; // buyer | vendor | rendor



function renderAuth() {

  const c = document.getElementById('auth-content');

  if (!c) return;

  if (App.currentUser) { showPage('dashboard'); return; }

  c.innerHTML = `

<div class="auth-container" style="min-height:100vh;padding-top:0;padding-bottom:var(--bottom-h)">

  <div class="auth-header">

    <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">

      <img src="images/photo_2026-05-30_17-40-49-Photoroom.png" alt="HAPPA MART Logo" style="width:48px;height:48px;">

      <div class="auth-logo" style="font-size:1.6rem;font-weight:900;color:var(--primary);letter-spacing:-1px">HAPPA<span style="color:var(--secondary)">MART</span></div>

    </div>

    <div class="auth-subtitle">Ghana's Premier Multi-Vendor Marketplace</div>

  </div>

  <div class="auth-body" style="min-height:70vh">

    <div class="auth-tabs">

      <div class="auth-tab ${authMode==='login'?'active':''}" onclick="switchAuthMode('login')">Sign In</div>

      <div class="auth-tab ${authMode==='register'?'active':''}" onclick="switchAuthMode('register')">Create Account</div>

    </div>

    <div id="auth-form-area"></div>

  </div>

</div>`;

  renderAuthForm();

}



function switchAuthMode(mode) {

  authMode = mode;

  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));

  const tabs = document.querySelectorAll('.auth-tab');

  if (mode === 'login') tabs[0]?.classList.add('active');

  else tabs[1]?.classList.add('active');

  renderAuthForm();

}



function renderAuthForm() {

  const c = document.getElementById('auth-form-area');

  if (!c) return;

  if (authMode === 'login') {

    c.innerHTML = `

<form onsubmit="doLogin(event)">

  <div class="form-group">

    <label class="form-label">Email or Phone</label>

    <div class="input-group">

      <i class="fas fa-user input-icon"></i>

      <input class="form-control" id="login-email" type="text" placeholder="your@email.com or 024..." required>

    </div>

  </div>

  <div class="form-group">

    <label class="form-label">Password</label>

    <div class="input-group">

      <i class="fas fa-lock input-icon"></i>

      <input class="form-control" id="login-pass" type="password" placeholder="Your password" required>

      <i class="fas fa-eye input-icon-right" onclick="togglePw('login-pass',this)"></i>

    </div>

  </div>

  <button class="btn btn-primary btn-block btn-lg" type="submit" style="margin-top:8px">

    <i class="fas fa-sign-in-alt"></i> Sign In

  </button>

  <div style="text-align:center;margin-top:16px;font-size:.85rem;color:var(--text-muted)">

    <a href="#" onclick="showForgotPw()" style="color:var(--primary)">Forgot Password?</a>

  </div>

</form>`;

  } else {

    c.innerHTML = `

<div style="display:flex;gap:0;margin-bottom:20px;border-radius:var(--radius-md);overflow:hidden;border:2px solid var(--border)">

  <button class="btn${authRole==='buyer'?' btn-primary':' btn-ghost'}" style="flex:1;border-radius:0;border:none;font-size:.82rem" onclick="switchRole('buyer')">

    <i class="fas fa-user"></i> Buyer

  </button>

  <button class="btn${authRole==='vendor'?' btn-primary':' btn-ghost'}" style="flex:1;border-radius:0;border:none;font-size:.82rem" onclick="switchRole('vendor')">

    <i class="fas fa-store"></i> Vendor

  </button>

  <button class="btn${authRole==='rendor'?' btn-primary':' btn-ghost'}" style="flex:1;border-radius:0;border:none;font-size:.82rem" onclick="switchRole('rendor')">

    <i class="fas fa-briefcase"></i> Rendor

  </button>

</div>

${authRole === 'rendor' ? `

<div style="background:linear-gradient(90deg,#ede9fe,#ddd6fe);border:1.5px solid #a78bfa;border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:16px;display:flex;gap:8px;align-items:flex-start">

  <i class="fas fa-info-circle" style="color:#7c3aed;margin-top:2px;flex-shrink:0"></i>

  <div style="font-size:.8rem;color:#4c1d95;line-height:1.6">

    <strong>Rendors</strong> offer <strong>services</strong> rather than physical products — think LinkedIn posts, graphic design, copywriting, tutoring and more.

    Your profile is reviewed and approved by admin before going live.

  </div>

</div>` : ''}

<form onsubmit="doRegister(event)">

  <div class="form-group">

    <label class="form-label">Full Name</label>

    <div class="input-group">

      <i class="fas fa-user input-icon"></i>

      <input class="form-control" id="reg-name" type="text" placeholder="Kwame Asante" required>

    </div>

  </div>

  <div class="form-group">

    <label class="form-label">Email Address</label>

    <div class="input-group">

      <i class="fas fa-envelope input-icon"></i>

      <input class="form-control" id="reg-email" type="email" placeholder="your@email.com" required>

    </div>

  </div>

  <div class="form-group">

    <label class="form-label">Phone Number</label>

    <div class="input-group">

      <i class="fas fa-phone input-icon"></i>

      <input class="form-control" id="reg-phone" type="tel" placeholder="+233 24 000 0000" required>

    </div>

  </div>

  <div class="form-group">

    <label class="form-label">Location (City)</label>

    <select class="form-control form-select" id="reg-location" required>

      <option value="">Select your city…</option>

      ${LOCATIONS.map(l => `<option value="${l}">${l}</option>`).join('')}

    </select>

  </div>

  <div class="form-group">

    <label class="form-label">Password</label>

    <div class="input-group">

      <i class="fas fa-lock input-icon"></i>

      <input class="form-control" id="reg-pass" type="password" placeholder="Min 6 characters" required minlength="6">

      <i class="fas fa-eye input-icon-right" onclick="togglePw('reg-pass',this)"></i>

    </div>

  </div>

  <!-- Referral code is picked up automatically from the URL — no manual entry needed -->

  <input type="hidden" id="reg-ref">

  ${authRole === 'vendor' ? `

  <div class="verify-banner" style="margin:12px 0">

    <i class="fas fa-id-card"></i>

    <p>Vendor accounts require admin approval. You'll be notified when approved and your store is ready.</p>

  </div>

  <!-- ── Store Details (vendor only) ── -->

  <div style="background:linear-gradient(90deg,#fef9c3,#fef3c7);border:1.5px solid #fde047;border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:14px">

    <div style="font-weight:700;font-size:.88rem;margin-bottom:8px;color:#92400e"><i class="fas fa-store"></i> Your Store Details</div>

    <p style="font-size:.78rem;color:#92400e;margin-bottom:10px">These details are used to set up your store. Admin will review and create the store with these exact details.</p>

    <div class="form-group" style="margin-bottom:8px">

      <label class="form-label" style="font-size:.82rem">Store Name *</label>

      <input class="form-control" id="reg-store-name" type="text" placeholder="e.g. Kofi's Sneaker Shop" required>

    </div>

    <div class="form-group" style="margin-bottom:8px">

      <label class="form-label" style="font-size:.82rem">Store Category</label>

      <select class="form-control form-select" id="reg-store-cat">

        ${CATEGORIES.map(c => '<option value="'+c+'">'+c+'</option>').join('')}

      </select>

    </div>

    <div class="form-group" style="margin-bottom:8px">

      <label class="form-label" style="font-size:.82rem">Store Description <span style="color:var(--text-muted)">(optional)</span></label>

      <textarea class="form-control" id="reg-store-desc" rows="2" placeholder="What do you sell? Who are your customers?"></textarea>

    </div>

    <div class="form-group" style="margin-bottom:0">

      <label class="form-label" style="font-size:.82rem">Keywords <span style="color:var(--text-muted)">(comma separated, optional)</span></label>

      <input class="form-control" id="reg-store-kws" placeholder="e.g. sneakers, shoes, footwear">

    </div>

  </div>` : ''}

  ${authRole === 'rendor' ? `

  <div class="verify-banner" style="margin:12px 0;background:linear-gradient(90deg,#ede9fe,#ddd6fe);border-color:#a78bfa">

    <i class="fas fa-briefcase" style="color:#7c3aed"></i>

    <p style="color:#4c1d95">Rendor accounts require admin approval. Once approved your profile goes live and clients can book you.</p>

  </div>

  <!-- ── Service Profile (rendor only) ── -->

  <div style="background:linear-gradient(90deg,#ede9fe,#ddd6fe);border:1.5px solid #a78bfa;border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:14px">

    <div style="font-weight:700;font-size:.88rem;margin-bottom:8px;color:#4c1d95"><i class="fas fa-briefcase"></i> Your Service Profile</div>

    <p style="font-size:.78rem;color:#4c1d95;margin-bottom:10px">Tell clients what services you offer. Admin will review and activate your profile.</p>

    <div class="form-group" style="margin-bottom:8px">

      <label class="form-label" style="font-size:.82rem">Display / Brand Name *</label>

      <input class="form-control" id="reg-rendor-name" type="text" placeholder="e.g. Ama Creative Studio">

    </div>

    <div class="form-group" style="margin-bottom:8px">

      <label class="form-label" style="font-size:.82rem">Service Category *</label>

      <select class="form-control form-select" id="reg-rendor-cat">

        <option value="">Select a category…</option>

        ${SERVICE_CATEGORIES.map(c => '<option value="'+c+'">'+c+'</option>').join('')}

      </select>

    </div>

    <div class="form-group" style="margin-bottom:8px">

      <label class="form-label" style="font-size:.82rem">Bio / What You Offer *</label>

      <textarea class="form-control" id="reg-rendor-bio" rows="3" placeholder="e.g. I write viral LinkedIn posts and professional bios for executives and founders…"></textarea>

    </div>

    <div class="form-group" style="margin-bottom:8px">

      <label class="form-label" style="font-size:.82rem">Starting Price (GHS)</label>

      <input class="form-control" id="reg-rendor-price" type="number" min="0" placeholder="e.g. 50">

    </div>

    <div class="form-group" style="margin-bottom:0">

      <label class="form-label" style="font-size:.82rem">Skills / Tags <span style="color:var(--text-muted)">(comma separated)</span></label>

      <input class="form-control" id="reg-rendor-tags" placeholder="e.g. LinkedIn, copywriting, branding">

    </div>

  </div>` : ''}

  ${/* Show referral banner if they arrived via a referral link */ ''}

  <div id="reg-referral-banner" style="display:none;margin-bottom:14px">

    <div style="background:linear-gradient(90deg,#d1fae5,#a7f3d0);border:1.5px solid #6ee7b7;border-radius:var(--radius-sm);padding:10px 12px;display:flex;gap:8px;align-items:flex-start">

      <i class="fas fa-gift" style="color:#059669;margin-top:2px;flex-shrink:0"></i>

      <div style="font-size:.82rem;color:#065f46">

        <strong>You were invited!</strong> Sign up through this link — your account is already connected to your friend's referral. No code needed!

      </div>

    </div>

  </div>

  <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:16px">

    <input type="checkbox" id="reg-terms" required style="margin-top:3px">

    <label for="reg-terms" style="font-size:.8rem;color:var(--text-light)">

      I agree to the <a href="#" onclick="showPage('privacy')" style="color:var(--primary)">Privacy Policy</a> and Terms of Service

    </label>

  </div>

  <button class="btn btn-primary btn-block btn-lg" type="submit"

          style="${authRole==='rendor'?'background:linear-gradient(135deg,#7c3aed,#6d28d9);border-color:#7c3aed':''}"

  >

    <i class="fas fa-user-plus"></i>

    Create ${authRole === 'vendor' ? 'Vendor' : authRole === 'rendor' ? 'Rendor' : 'Buyer'} Account

  </button>

</form>`;



  // After rendering, check sessionStorage for a pending referral and show the banner

  setTimeout(() => {

    const pendingRef = sessionStorage.getItem('pending_ref');

    const refBanner  = document.getElementById('reg-referral-banner');

    const refInput   = document.getElementById('reg-ref');

    if (pendingRef) {

      if (refBanner) refBanner.style.display = 'block';

      if (refInput)  refInput.value = pendingRef.toUpperCase();

    }

  }, 0);

  }

}



function switchRole(role) {

  authRole = role;

  renderAuthForm();

}



function togglePw(id, icon) {

  const inp = document.getElementById(id);

  if (!inp) return;

  if (inp.type === 'password') { inp.type = 'text'; icon.className = icon.className.replace('fa-eye','fa-eye-slash'); }

  else { inp.type = 'password'; icon.className = icon.className.replace('fa-eye-slash','fa-eye'); }

}



async function doLogin(e) {

  e.preventDefault();

  const email = document.getElementById('login-email')?.value.trim().toLowerCase();

  const pass  = document.getElementById('login-pass')?.value;

  if (!email || !pass) return;



  // Find user in DB

  const res = await apiGet('users', `search=${encodeURIComponent(email)}&limit=10`);

  const users = res ? res.data || [] : [];

  const user = users.find(u =>

    (u.email?.toLowerCase() === email || u.phone === email) &&

    u.password_hash === pass && u.status !== 'deleted'

  );



  if (!user) {
    showToast('Invalid email or password. Please try again.', 'error');
    return;
  }

  if (user.status === 'suspended') {

    showToast('Your account has been suspended. Contact support.', 'error');

    return;

  }

  if (user.status === 'pending_approval') {

    // Let them log in but show the waiting screen

    App.currentUser = user;

    saveSessions();

    showToast(`Welcome, ${user.name}! Your account is still under review.`, 'info');

    showVendorPendingScreen();

    return;

  }

  // Migrate legacy 'seller' role to 'vendor'

  if (user.role === 'seller') {

    user.role = 'vendor';

    await apiPatch('users', user.id, { role: 'vendor' }).catch(() => {});

  }

  App.currentUser = user;

  saveSessions();

  showToast(`Welcome back, ${user.name}! 🎉`, 'success');

  showPage('dashboard');

}



async function doRegister(e) {

  e.preventDefault();

  const name   = document.getElementById('reg-name')?.value.trim();

  const email  = document.getElementById('reg-email')?.value.trim().toLowerCase();

  const phone  = document.getElementById('reg-phone')?.value.trim();

  const loc    = document.getElementById('reg-location')?.value;
  const pass   = document.getElementById('reg-pass')?.value;

  // Read referral code from hidden field OR from sessionStorage (set when user clicked a referral link)

  // Also check reg-ref which is auto-populated after render

  const refFromField   = (document.getElementById('reg-ref')?.value || '').trim().toUpperCase();

  const refFromSession = (sessionStorage.getItem('pending_ref') || '').toUpperCase();

  const ref = refFromField || refFromSession;



  // Vendor-specific store details

  const storeName = authRole === 'vendor' ? (document.getElementById('reg-store-name')?.value.trim() || '') : '';

  const storeCat  = authRole === 'vendor' ? (document.getElementById('reg-store-cat')?.value || '') : '';

  const storeDesc = authRole === 'vendor' ? (document.getElementById('reg-store-desc')?.value.trim() || '') : '';

  const storeKws  = authRole === 'vendor' ? (document.getElementById('reg-store-kws')?.value || '') : '';



  // Rendor-specific service profile details

  const rendorName  = authRole === 'rendor' ? (document.getElementById('reg-rendor-name')?.value.trim() || '') : '';

  const rendorCat   = authRole === 'rendor' ? (document.getElementById('reg-rendor-cat')?.value || '') : '';

  const rendorBio   = authRole === 'rendor' ? (document.getElementById('reg-rendor-bio')?.value.trim() || '') : '';

  const rendorPrice = authRole === 'rendor' ? (document.getElementById('reg-rendor-price')?.value || '0') : '0';

  const rendorTags  = authRole === 'rendor' ? (document.getElementById('reg-rendor-tags')?.value || '') : '';



  if (!name || !email || !phone || !loc || !pass) {

    showToast('Please fill in all required fields', 'warning');

    return;

  }

  if (pass.length < 6) {

    showToast('Password must be at least 6 characters', 'warning');

    return;

  }

  if (authRole === 'vendor' && !storeName) {

    showToast('Please enter your preferred store name', 'warning');

    return;

  }

  if (authRole === 'rendor' && !rendorName) {

    showToast('Please enter your display / brand name', 'warning');

    return;

  }

  if (authRole === 'rendor' && !rendorCat) {

    showToast('Please select a service category', 'warning');

    return;

  }

  if (authRole === 'rendor' && !rendorBio) {

    showToast('Please describe what services you offer', 'warning');

    return;

  }



  // Disable submit button to prevent double-submit

  const submitBtn = e.target?.querySelector('[type=submit]');

  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating account…'; }



  // Check email uniqueness

  const check = await apiGet('users', `search=${encodeURIComponent(email)}&limit=10`);

  const existing = (check?.data || []).find(u => u.email?.toLowerCase() === email);

  if (existing) {

    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = `<i class="fas fa-user-plus"></i> Create ${authRole === 'vendor' ? 'Vendor' : authRole === 'rendor' ? 'Rendor' : 'Buyer'} Account`; }

    showToast('Email already registered. Please sign in.', 'error');

    return;

  }



  const refCode = generateRefCode(name);

  // Check if auto-approve is enabled in platform settings

  const autoApprove = await getSetting('vendor_auto_approve', 'false');

  // Vendors & rendors start as pending_approval unless auto-approve is on

  const needsApproval = (authRole === 'vendor' || authRole === 'rendor') && autoApprove !== 'true';

  const initialStatus = needsApproval ? 'pending_approval' : 'active';

  const newUser = {
    name, email, phone, role: authRole, location: loc,    is_verified: false, id_verified: false,

    referral_code: refCode, referred_by: ref || '',

    referral_earnings: 0, referral_count: 0, wallet_balance: 0,

    // Store vendor's preferred store details so admin can create it

    preferred_store_name: storeName || '',

    preferred_store_cat:  storeCat  || '',

    preferred_store_desc: storeDesc || '',

    preferred_store_kws:  storeKws  || '',

    // Rendor service profile fields

    rendor_display_name:  rendorName  || '',

    rendor_service_cat:   rendorCat   || '',

    rendor_bio:           rendorBio   || '',

    rendor_starting_price: parseFloat(rendorPrice) || 0,

    rendor_tags:          rendorTags  || '',

    status: initialStatus, password_hash: pass,

    registered_at: new Date().toISOString()

  };



  const created = await apiPost('users', newUser);

  if (!created || !created.id) {

    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = `<i class="fas fa-user-plus"></i> Create ${authRole === 'vendor' ? 'Vendor' : 'Buyer'} Account`; }

    showToast('Registration failed. Please try again.', 'error');

    return;

  }



  // Handle referral — look up referrer by their referral_code, record the link

  // Commission is earned on every future purchase by this user (not at registration)

  if (ref) {

    // Search broadly then match exact referral_code (codes look like 'VKOF1234')

    const refRes = await apiGet('users', `search=${encodeURIComponent(ref)}&limit=50`);

    const allRefUsers = refRes?.data || [];

    // Also try a second search with lower-case just in case

    let referrer = allRefUsers.find(u => (u.referral_code || '').toUpperCase() === ref);

    if (!referrer) {

      // Fallback: fetch up to 200 users and scan for the code

      const wideRes = await apiGet('users', 'limit=200');

      referrer = (wideRes?.data || []).find(u => (u.referral_code || '').toUpperCase() === ref);

    }

    if (referrer) {

      // Create referral record — reward_amount stays 0 until a purchase is made

      await apiPost('referrals', {

        referrer_id:   referrer.id,

        referred_id:   created.id,

        referred_email: email,

        type:          'basic',

        reward_pct:    3,

        reward_amount: 0,

        order_id:      '',

        status:        'active',

        referrer_store_id: ''

      });

      // Increment referrer's referral_count immediately

      const newCount = (referrer.referral_count || 0) + 1;

      await apiPatch('users', referrer.id, { referral_count: newCount });

      // Notify the referrer

      addNotification(referrer.id, 'referral', '🎁 New Referral Signup!',

        `${name} joined using your referral link! Your store gets saved for them automatically.`);



      // ── Auto-save the referrer's store for the new user ──────

      // If the referrer is a vendor with an active store, add it to the new user's saved stores

      if (referrer.role === 'vendor') {

        const storeRes = await apiGet('stores', `limit=200`);

        const referrerStore = (storeRes?.data || []).find(s =>

          s.vendor_id === referrer.id && s.status === 'active'

        );

        if (referrerStore) {

          // Save the store ID to localStorage so it's in the saved list when they browse

          try {

            const savedRaw = localStorage.getItem('happa_saved');

            const saved = savedRaw ? JSON.parse(savedRaw) : [];

            if (!saved.includes(referrerStore.id)) {

              saved.unshift(referrerStore.id); // add to front so it shows first

              localStorage.setItem('happa_saved', JSON.stringify(saved));

              App.savedStores = saved;

            }

          } catch(err) { console.warn('Could not auto-save store', err); }



          // Also store metadata so we can highlight the store after login

          sessionStorage.setItem('referral_store_id', referrerStore.id);

          sessionStorage.setItem('referral_store_name', referrerStore.name || '');



          addNotification(created.id, 'referral', '🏪 Store Saved For You!',

            `"${referrerStore.name}" has been saved to your stores. Check it out in the marketplace!`);

        }

      }

    }

    if (!referrer) {

      console.warn('[Referral] Code not found:', ref, '— referral not recorded');

    }

    // Always clear the session referral so it doesn't re-apply on future registrations

    sessionStorage.removeItem('pending_ref');

  }



  App.currentUser = created;
  saveSessions();

  if (authRole === 'vendor' && initialStatus === 'active') {
    await window.autoCreateStoreForVendor(created);
  }



  // Add welcome notification
  showToast('🎉 Welcome to HAPPA TRADEMART!', 'success');



  // Vendors need OTP first, then show pending-approval screen

  // Buyers go straight through OTP ΓåÆ dashboard

  showOTPModal(created);

}



function showOTPModal(user) {

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  console.log('[DEMO] OTP for', user.phone, ':', otp); // In real app, SMS is sent

  showModal(`

<div class="modal-handle"></div>

<div class="modal-header">

  <span class="modal-title">📱 Verify Phone</span>

</div>

<div class="modal-body">

  <p style="font-size:.875rem;color:var(--text-light);margin-bottom:16px">

    An OTP has been sent to <strong>${user.phone}</strong>.<br>

    <span style="color:var(--primary)">[Demo: OTP is <strong>${otp}</strong>]</span>

  </p>

  <div class="form-group">

    <label class="form-label">Enter OTP</label>

    <input class="form-control" id="otp-input" type="text" placeholder="6-digit code" maxlength="6" style="font-size:1.3rem;letter-spacing:8px;text-align:center">

  </div>

  <button class="btn btn-primary btn-block" onclick="verifyOTP('${user.id}','${otp}')">

    <i class="fas fa-check-circle"></i> Verify

  </button>

  <div style="text-align:center;margin-top:12px">

    <a href="#" onclick="skipOTP('${user.id}')" style="font-size:.8rem;color:var(--text-muted)">Skip for now</a>

  </div>

</div>`);

}



async function verifyOTP(userId, expectedOtp) {

  const entered = document.getElementById('otp-input')?.value.trim();

  if (entered !== expectedOtp) { showToast('Incorrect OTP. Please try again.', 'error'); return; }

  await apiPatch('users', userId, { is_verified: true });

  if (App.currentUser) App.currentUser.is_verified = true;

  saveSessions();

  closeModalForce();

  showToast('Phone verified successfully! ✅', 'success');



  // Vendors & rendors in pending_approval ΓåÆ show waiting screen instead of dashboard

  if ((App.currentUser?.role === 'vendor' || App.currentUser?.role === 'rendor') &&

       App.currentUser?.status === 'pending_approval') {

    showPendingScreen();

    return;

  }

  showPage('dashboard');

}



// Keep old name as alias for backwards compatibility

function showVendorPendingScreen() { showPendingScreen(); }



function showPendingScreen() {

  const role  = App.currentUser?.role || 'vendor';

  const isRen = role === 'rendor';

  const accentGrad = isRen

    ? 'linear-gradient(90deg,#ede9fe,#ddd6fe)'

    : 'linear-gradient(90deg,#dbeafe,#ede9fe)';

  const accentBorder = isRen ? '#a78bfa' : '#93c5fd';

  const accentTxt    = isRen ? '#4c1d95' : '#1e3a8a';

  const icon         = isRen ? 'fas fa-briefcase' : 'fas fa-sign-in-alt';

  const dashLabel    = isRen ? 'Rendor Hub' : 'vendor dashboard and store';

  const steps = isRen ? `

    <li>Admin reviews your service profile</li>

    <li>You get notified when your profile is approved</li>

    <li>Your profile goes live — clients can discover and book you</li>

    <li>Log in to your Rendor Hub to manage services &amp; orders</li>` : `

    <li>Admin reviews your registration &amp; store details</li>

    <li>You get notified when your account is approved</li>

    <li>Admin creates your store using the details you provided</li>

    <li>Log in to your vendor dashboard to start selling!</li>`;



  // Replace auth content with a friendly waiting screen

  const c = document.getElementById('auth-content');

  if (c) {

    c.innerHTML = `

<div class="auth-container" style="min-height:100vh;padding-top:0">

  <div class="auth-header">

    <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">

      <img src="images/photo_2026-05-30_17-40-49-Photoroom.png" alt="HAPPA MART Logo" style="width:48px;height:48px;">

      <div class="auth-logo" style="font-size:1.6rem;font-weight:900;color:var(--primary);letter-spacing:-1px">HAPPA<span style="color:var(--secondary)">MART</span></div>

    </div>

  </div>

  <div class="auth-body" style="text-align:center;padding:32px 20px">

    <div style="font-size:3rem;margin-bottom:16px">${isRen ? '🎨' : '⏳'}</div>

    <h2 style="font-weight:800;font-size:1.2rem;margin-bottom:8px">

      ${isRen ? 'Rendor Profile Under Review' : 'Account Under Review'}

    </h2>

    <p style="font-size:.875rem;color:var(--text-light);margin-bottom:20px;line-height:1.7">

      Your ${isRen ? 'rendor profile' : 'vendor account'} has been submitted and is <strong>awaiting admin approval</strong>.<br>

      You'll receive an in-app notification once approved — usually within 24 hours.

    </p>



    <div style="background:${accentGrad};border:1.5px solid ${accentBorder};border-radius:var(--radius-sm);padding:14px;text-align:left;margin-bottom:16px">

      <div style="font-weight:700;font-size:.85rem;margin-bottom:6px;color:${accentTxt}">

        <i class="${icon}"></i> Your Login Credentials

      </div>

      <div style="font-size:.82rem;color:${accentTxt};line-height:1.7">

        You can already <strong>log in</strong> with the email and password you registered with.<br>

        Once approved, your ${dashLabel} will be fully accessible.

      </div>

    </div>



    <div style="background:#fef9c3;border:1.5px solid #fde047;border-radius:var(--radius-sm);padding:14px;text-align:left;margin-bottom:24px">

      <div style="font-weight:700;font-size:.85rem;margin-bottom:6px;color:#713f12"><i class="fas fa-info-circle"></i> What happens next?</div>

      <ol style="font-size:.82rem;color:#713f12;padding-left:16px;line-height:1.9;margin:0">

        ${steps}

      </ol>

    </div>

    <button class="btn btn-primary btn-block" onclick="showPage('marketplace')" style="margin-bottom:10px${isRen ? ';background:linear-gradient(135deg,#7c3aed,#6d28d9);border-color:#7c3aed' : ''}">

      <i class="fas fa-store"></i> Browse Marketplace While You Wait

    </button>

    <button class="btn btn-ghost btn-sm" onclick="logout()" style="color:var(--text-muted)">

      Sign out

    </button>

  </div>

</div>`;

  }

  showPage('auth');

}



function skipOTP(userId) {

  closeModalForce();

  showToast(`Welcome to HAPPA TRADEMART! Please verify your phone later.`, 'warning');

  if ((App.currentUser?.role === 'vendor' || App.currentUser?.role === 'rendor') &&

       App.currentUser?.status === 'pending_approval') {

    showPendingScreen();

    return;

  }

  showPage('dashboard');

}



function showForgotPw() {

  showModal(`

<div class="modal-handle"></div>

<div class="modal-header">

  <span class="modal-title">Reset Password</span>

  <div class="modal-close" onclick="closeModalForce()"><i class="fas fa-times"></i></div>

</div>

<div class="modal-body">

  <p style="font-size:.875rem;color:var(--text-light);margin-bottom:16px">Enter your email or phone and we'll send a reset link/OTP.</p>

  <div class="form-group">

    <input class="form-control" type="text" placeholder="Email or phone">

  </div>

  <button class="btn btn-primary btn-block" onclick="showToast('Password reset OTP sent! Check your phone or email.','success');closeModalForce()">

    <i class="fas fa-paper-plane"></i> Send Reset Link

  </button>

</div>`);

}



// Demo quick-login helper

async function quickLogin(role) {

  showToast('Signing in…', 'info');



  // Hardcoded demo users (works without a backend!

  const demoUsers = {

    buyer: {

      id: 'u-buyer-001',

      name: 'Ama Asante',

      email: 'ama@test.com',

      phone: '024 123 4567',

      role: 'buyer',

      location: 'Accra',

      status: 'active',

      password_hash: 'buyer123',

      wallet_balance: 150,

      is_verified: true,

      id_verified: false,

      referral_code: 'AMA123'

    },

    vendor: {

      id: 'u-vendor-001',

      name: 'Kwame Mensah',

      email: 'kwame@test.com',

      phone: '024 987 6543',

      role: 'vendor',

      location: 'Accra',

      status: 'active',

      password_hash: 'vendor123',

      wallet_balance: 420,

      is_verified: true,

      id_verified: true,

      referral_code: 'KWA456'

    },

    admin: {

      id: 'u-admin-001',

      name: 'Admin User',

      email: 'admin@happatrademart.com',

      phone: '020 000 0000',

      role: 'admin',

      location: 'Accra',

      status: 'active',

      password_hash: 'admin123',

      wallet_balance: 0,

      is_verified: true,

      id_verified: true,

      referral_code: 'ADM789'

    }

  };



  const user = demoUsers[role];

  App.currentUser = user;

  saveSessions();

  showToast(`Welcome, ${user.name}! 🎉`, 'success');

  showToast(`Welcome back, ${user.name}! 🎉`, 'success');

  showPage('dashboard');

}



function generateRefCode(name) {

  const base = name.replace(/\s+/,'').substring(0,3).toUpperCase();

  const num  = Math.floor(100 + Math.random() * 900);

  return `${base}${num}`;

}



function addNotification(userId, type, title, message, actionUrl = '') {
  const notif = {
    id: 'n' + Date.now() + Math.random().toString(36).substr(2, 5),
    user_id: userId,
    type,
    title,
    message,
    is_read: false,
    action_url: actionUrl,
    created_at: new Date().toISOString()
  };

  App.notifications.unshift(notif);
  if (App.notifications.length > 50) App.notifications.pop();
  saveNotifs();
  renderNotifBadge();

  // Asynchronously upload to database
  apiPost('notifications', notif).catch(err => {
    console.warn('Failed to upload notification to server:', err);
  });
}

