/**
 * REST API for the Murabaha platform.
 * Mounted at /app/* (kept separate from /api/v1/mfa/* Nafath proxy).
 *
 * Conventions:
 *   - All bodies are JSON.
 *   - All responses are JSON.
 *   - Session is a signed cookie (lib/session.js).
 *   - Errors return { error: "code", message: "<arabic>" }.
 */
'use strict';

const db = require('./db');
const S  = require('./session');
const M  = require('./mailer');
const TOTP = require('./totp');
const P  = require('./payments');
const U  = require('./uploads');
const SMS = require('./sms');
const SAN = require('./sanctions');
const PUSH = require('./push');
const WH   = require('./webhooks');
const EV   = require('./events');

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const genOtp = () => String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
const otpExpired = (otp) => !otp || !otp.expiresAt || Date.now() > otp.expiresAt;

const ARABIC = {
  invalid_input:    'البيانات المُدخلة غير صحيحة.',
  email_taken:      'هذا البريد مُسجّل بالفعل.',
  phone_taken:      'هذا الرقم مُسجّل بالفعل.',
  bad_credentials:  'بيانات الدخول غير صحيحة.',
  unauthorized:     'يجب تسجيل الدخول أولاً.',
  not_found:        'العنصر غير موجود.',
  insufficient:     'الرصيد غير كافٍ لإتمام العملية.',
  closed:           'هذه الفرصة الاستثمارية لم تعد مفتوحة.',
  already_invested: 'لقد استثمرت في هذه الفرصة من قبل.',
  min_amount:       'المبلغ أقل من الحد الأدنى للاستثمار.',
  max_amount:       'المبلغ يتجاوز الحد المتاح في الفرصة.',
  server:           'حدث خطأ في الخادم. يُرجى المحاولة لاحقاً.',
  unapproved_account: 'حسابك بانتظار موافقة الإدارة.',
  account_rejected: 'تم رفض حسابك. يُرجى التواصل مع الدعم.',
  account_suspended: 'تم تعليق حسابك مؤقتاً. للاستفسار راسل الدعم.',
  kyc_out_of_order: 'يجب إكمال خطوات التحقق بالترتيب.',
  id_taken:         'رقم الهوية مُسجّل بحساب آخر.',
  csrf_failed:      'فشل التحقق من الجلسة. يرجى تحديث الصفحة وإعادة المحاولة.',
  invalid_card_number: 'رقم البطاقة غير صحيح.',
  invalid_expiry:   'تاريخ الانتهاء غير صحيح.',
  card_expired:     'البطاقة منتهية الصلاحية.',
  invalid_cvv:      'رمز CVV غير صحيح.',
  invalid_holder:   'يرجى إدخال اسم صاحب البطاقة كاملاً.',
  invalid_iban:     'رقم IBAN السعودي غير صحيح. يجب أن يبدأ بـ SA ويتكوّن من ٢٤ خانة.',
  declined:         'تم رفض عملية الدفع. تحقق من بطاقتك أو جرّب طريقة أخرى.',
  invalid_kind:     'نوع المستند غير معتمد.',
  invalid_file_type: 'صيغة الملف غير مدعومة. ارفع JPG أو PNG أو PDF فقط.',
  too_large:        'حجم الملف كبير جداً (الحد الأقصى ٥ ميجابايت).',
  missing_documents: 'يرجى رفع صورة الهوية وصورة شخصية (سيلفي) قبل المتابعة.',
  retail_per_deal_cap: 'تجاوز الحد الأقصى لكل فرصة للمستثمر الفردي.',
  retail_per_year_cap: 'تجاوز الحد السنوي للمستثمر الفردي.',
};

// ─── Helpers ──────────────────────────────────────────────────────
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const err = (res, status, code, extra = {}) =>
  send(res, status, { error: code, message: ARABIC[code] || code, ...extra });

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB (covers 5MB raw + base64 inflation + JSON envelope)
const readJson = (req) => new Promise((resolve) => {
  const chunks = [];
  let total = 0;
  let aborted = false;
  req.on('data', c => {
    total += c.length;
    if (total > MAX_BODY_BYTES) {
      aborted = true;
      try { req.destroy(); } catch {}
      return resolve(null);
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    if (!chunks.length) return resolve({});
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch { resolve(null); }
  });
  req.on('error', () => resolve(null));
});

const requireAuth = (req, res) => {
  const user = S.currentUser(req);
  if (!user) { err(res, 401, 'unauthorized'); return null; }
  return user;
};

const requireAdmin = (req, res) => {
  const user = S.currentUser(req);
  if (!user) { err(res, 401, 'unauthorized'); return null; }
  if (user.role !== 'admin') { err(res, 403, 'unauthorized'); return null; }
  return user;
};

const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isPhone = (s) => typeof s === 'string' && /^(\+?966|0)?5\d{8}$/.test(s.replace(/\s|-/g, ''));
const normPhone = (s) => {
  const d = (s || '').replace(/\D/g, '');
  if (d.startsWith('966')) return '+' + d;
  if (d.startsWith('0'))   return '+966' + d.slice(1);
  if (d.startsWith('5'))   return '+966' + d;
  return s;
};

const now = () => new Date().toISOString();

const notify = (userId, kind, title, body, meta = {}) => {
  const ntf = {
    id: S.newId('ntf_'),
    userId, kind, title, body, meta,
    read: false,
    createdAt: now(),
  };
  const result = db.insert('notifications', ntf);
  // Fire to any open SSE connections for this user (and all admins via broadcast).
  EV.emit(userId, 'notification', ntf);
  return result;
};

const clientIp = (req) => (
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket?.remoteAddress || ''
);

const audit = (actorId, action, target, meta = {}, req = null) => {
  return db.insert('auditLog', {
    id: S.newId('aud_'),
    actorId,
    action,
    target,
    meta,
    ip: req ? clientIp(req) : null,
    ua: req?.headers?.['user-agent'] || null,
    createdAt: now(),
  });
};

// ─── Route table ──────────────────────────────────────────────────
const routes = [];
const R = (method, pattern, handler) => routes.push({ method, pattern, handler });

// ============================================================
//  AUTH
// ============================================================

R('POST', '/app/auth/register', async (req, res) => {
  const body = await readJson(req);
  if (!body) return err(res, 400, 'invalid_input');

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const phone = body.phone ? normPhone(body.phone) : '';
  const password = body.password || '';
  const nationalId = (body.nationalId || '').trim();

  if (!name || name.length < 2) return err(res, 400, 'invalid_input', { field: 'name' });
  if (!email && !phone)         return err(res, 400, 'invalid_input', { field: 'identifier' });
  if (email && !isEmail(email)) return err(res, 400, 'invalid_input', { field: 'email' });
  if (phone && !isPhone(phone)) return err(res, 400, 'invalid_input', { field: 'phone' });
  if (password.length < 8)      return err(res, 400, 'invalid_input', { field: 'password' });

  if (email && db.find('users', u => u.email === email)) return err(res, 409, 'email_taken');
  if (phone && db.find('users', u => u.phone === phone)) return err(res, 409, 'phone_taken');

  const { salt, passwordHash } = S.hashPassword(password);
  const emailOtp = email ? { code: genOtp(), expiresAt: Date.now() + OTP_TTL_MS, sentAt: Date.now() } : null;
  const mobileOtp = phone ? { code: genOtp(), expiresAt: Date.now() + OTP_TTL_MS, sentAt: Date.now() } : null;
  const user = {
    id: S.newId('usr_'),
    name, email, phone, nationalId,
    avatar: null,
    role: 'investor',
    locale: 'ar',
    nafathVerified: false,
    approved: false,
    balance: 0,                  // SAR
    kycStatus: 'pending',
    createdAt: now(),
    salt, passwordHash,
    emailOtp, mobileOtp,
  };
  await db.insert('users', user);
  await notify(user.id, 'welcome', 'مرحباً بك في مُرابحة',
    'تم إنشاء حسابك بنجاح. أكمل التحقق من هويتك للبدء.');

  if (email) {
    const tpl = M.welcomeTemplate(name);
    M.send({ to: email, subject: 'مرحباً بك في منصة مُرابحة', html: tpl.html, text: tpl.text }).catch(()=>{});
    const otpTpl = M.otpTemplate(emailOtp.code, 'البريد الإلكتروني');
    M.send({ to: email, subject: `رمز التحقق: ${emailOtp.code}`, html: otpTpl.html, text: otpTpl.text }).catch(()=>{});
  }
  if (phone) {
    SMS.send({ to: phone, text: SMS.otpTemplate(mobileOtp.code) }).catch(() => {});
  }
  WH.dispatch(db, 'user.registered', { userId: user.id, email: user.email, phone: user.phone, name: user.name });

  S.setSessionCookie(res, user.id);
  return send(res, 201, { success: true, pendingApproval: true, user: S.publicUser(user) });
});

const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 min
const LOGIN_MAX_FAILS_PER_IP = 20;
const LOGIN_MAX_FAILS_PER_ID = 5;

const recentFailedAttempts = (predicate) => {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  return db.all('loginAttempts').filter(a => !a.success && predicate(a) && new Date(a.createdAt).getTime() > cutoff).length;
};

R('POST', '/app/auth/login', async (req, res) => {
  const body = await readJson(req);
  if (!body) return err(res, 400, 'invalid_input');

  const identifier = (body.identifier || body.email || body.phone || '').trim().toLowerCase();
  const password   = body.password || '';
  if (!identifier || !password) return err(res, 400, 'invalid_input');
  const ip = clientIp(req);

  // rate-limit: too many recent failures from this IP or against this identifier
  if (recentFailedAttempts(a => a.ip === ip) >= LOGIN_MAX_FAILS_PER_IP) {
    return send(res, 429, { error: 'rate_limited', message: 'محاولات تسجيل دخول كثيرة. حاول لاحقاً.' });
  }
  if (recentFailedAttempts(a => a.identifier === identifier) >= LOGIN_MAX_FAILS_PER_ID) {
    return send(res, 429, { error: 'rate_limited', message: 'محاولات تسجيل دخول كثيرة لهذا الحساب. حاول لاحقاً.' });
  }

  const phoneNorm = isPhone(identifier) ? normPhone(identifier) : null;
  const user = db.find('users', u =>
    u.email === identifier || (phoneNorm && u.phone === phoneNorm)
  );
  const recordFail = (reason) => db.insert('loginAttempts', {
    id: S.newId('att_'),
    identifier, ip, ua: req.headers['user-agent'] || null,
    userId: user ? user.id : null,
    success: false, reason,
    createdAt: now(),
  });
  if (!user) { await recordFail('no_user'); return err(res, 401, 'bad_credentials'); }
  if (!S.verifyPassword(password, user.salt, user.passwordHash)) { await recordFail('bad_password'); return err(res, 401, 'bad_credentials'); }
  if (user.rejected) { await recordFail('rejected'); return err(res, 403, 'account_rejected'); }
  if (user.suspendedAt) { await recordFail('suspended'); return err(res, 403, 'account_suspended'); }

  if (user.role !== 'admin' && !user.approved) {
    if (user.kycStatus === 'verified') {
      await recordFail('unapproved');
      return err(res, 403, 'unapproved_account');
    }
  }

  // 2FA gate for admins (and any user who's enrolled)
  if (user.totpEnrolled) {
    const challenge = require('crypto').randomBytes(24).toString('hex');
    await db.patch('users', u => u.id === user.id, {
      twofaChallenge: { token: challenge, expiresAt: Date.now() + 5 * 60_000 },
    });
    await db.insert('loginAttempts', {
      id: S.newId('att_'),
      identifier, ip, ua: req.headers['user-agent'] || null,
      userId: user.id, success: false, reason: 'pending_2fa', createdAt: now(),
    });
    return send(res, 200, { requires2fa: true, twofaToken: challenge });
  }

  await db.insert('loginAttempts', {
    id: S.newId('att_'),
    identifier, ip, ua: req.headers['user-agent'] || null,
    userId: user.id, success: true, createdAt: now(),
  });
  S.setSessionCookie(res, user.id);
  return send(res, 200, { user: S.publicUser(user) });
});

R('POST', '/app/auth/login-2fa', async (req, res) => {
  const body = await readJson(req);
  const twofaToken = (body?.twofaToken || '').trim();
  const code = (body?.code || '').trim();
  if (!twofaToken || !code) return err(res, 400, 'invalid_input');
  const user = db.find('users', u => u.twofaChallenge && u.twofaChallenge.token === twofaToken);
  if (!user || user.twofaChallenge.expiresAt < Date.now()) return err(res, 400, 'invalid_token');
  // Accept either a fresh TOTP code or a one-time backup code
  let totpOk = !!(user.totpSecret && TOTP.verifyTotp(user.totpSecret, code));
  let usedBackup = false;
  if (!totpOk && Array.isArray(user.backupCodes) && user.backupCodes.length) {
    const normalized = code.toUpperCase().replace(/\s+/g, '');
    const h = require('crypto').createHash('sha256').update(normalized).digest('hex');
    const idx = user.backupCodes.indexOf(h);
    if (idx >= 0) {
      const remaining = user.backupCodes.slice();
      remaining.splice(idx, 1);
      await db.patch('users', u => u.id === user.id, { backupCodes: remaining });
      totpOk = true; usedBackup = true;
    }
  }
  if (!totpOk) {
    await db.insert('loginAttempts', {
      id: S.newId('att_'),
      identifier: user.email || user.phone, ip: clientIp(req), ua: req.headers['user-agent'] || null,
      userId: user.id, success: false, reason: '2fa_bad_code', createdAt: now(),
    });
    return err(res, 401, 'bad_credentials');
  }
  if (usedBackup) await audit(user.id, 'auth.2fa.backup-code-used', user.id, {}, req);
  await db.patch('users', u => u.id === user.id, { twofaChallenge: null });
  await db.insert('loginAttempts', {
    id: S.newId('att_'),
    identifier: user.email || user.phone, ip: clientIp(req), ua: req.headers['user-agent'] || null,
    userId: user.id, success: true, createdAt: now(),
  });
  S.setSessionCookie(res, user.id);
  return send(res, 200, { user: S.publicUser(user) });
});

// ─── Admin 2FA enrollment ──────────────────────────────────────────
R('POST', '/app/admin/2fa/init', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const fresh = db.find('users', u => u.id === admin.id);
  let secret = fresh.totpSecret;
  if (!secret || fresh.totpEnrolled) {
    // never reveal a secret tied to an already-enrolled account
    if (fresh.totpEnrolled) return err(res, 409, 'already_enrolled');
    secret = TOTP.generateSecret();
    await db.patch('users', u => u.id === admin.id, { totpSecret: secret, totpEnrolled: false });
  }
  const account = fresh.email || (fresh.phone || admin.id);
  const uri = TOTP.otpauthUri(secret, account);
  return send(res, 200, { secret, uri, account, issuer: 'Murbha' });
});

R('POST', '/app/admin/2fa/enable', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const code = (body?.code || '').trim();
  const fresh = db.find('users', u => u.id === admin.id);
  if (!fresh.totpSecret) return err(res, 400, 'invalid_input');
  if (fresh.totpEnrolled) return err(res, 409, 'already_enrolled');
  if (!TOTP.verifyTotp(fresh.totpSecret, code)) return err(res, 400, 'invalid_code');
  await db.patch('users', u => u.id === admin.id, { totpEnrolled: true, totpEnrolledAt: now() });
  await audit(admin.id, 'admin.2fa.enable', admin.id, {}, req);
  return send(res, 200, { ok: true });
});

R('POST', '/app/admin/2fa/disable', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const code = (body?.code || '').trim();
  const fresh = db.find('users', u => u.id === admin.id);
  if (!fresh.totpEnrolled || !fresh.totpSecret) return err(res, 400, 'invalid_input');
  if (!TOTP.verifyTotp(fresh.totpSecret, code)) return err(res, 401, 'bad_credentials');
  await db.patch('users', u => u.id === admin.id, { totpEnrolled: false, totpSecret: null });
  await audit(admin.id, 'admin.2fa.disable', admin.id, {}, req);
  return send(res, 200, { ok: true });
});

R('POST', '/app/auth/logout', async (req, res) => {
  S.clearSessionCookie(res);
  return send(res, 200, { ok: true });
});

R('GET', '/app/auth/me', async (req, res) => {
  const user = S.currentUser(req);
  return send(res, 200, { user });
});

// ─── Investor qualification ────────────────────────────────────────
// Retail investors are capped per SAMA crowdfunding rules. Users can
// request promotion to "qualified" by attesting to net-worth thresholds;
// admin reviews and approves.
R('POST', '/app/me/qualify', async (req, res) => {
  const auth = requireAuth(req, res); if (!auth) return;
  const body = await readJson(req);
  const netWorth     = Number(body?.netWorth || 0);
  const annualIncome = Number(body?.annualIncome || 0);
  const employmentTitle = (body?.employmentTitle || '').trim().slice(0, 200);
  const experience   = (body?.experience || '').trim().slice(0, 500);
  const declaration  = !!body?.declaration;
  if (!declaration) return err(res, 400, 'invalid_input', { field: 'declaration' });
  // Thresholds (illustrative; align with SAMA framework before launch).
  // Auto-eligibility if netWorth >= 5,000,000 SAR OR annualIncome >= 1,000,000 SAR.
  const eligible = netWorth >= 5_000_000 || annualIncome >= 1_000_000;
  await db.patch('users', u => u.id === auth.id, {
    qualificationRequest: {
      netWorth, annualIncome, employmentTitle, experience,
      declaredAt: now(),
      autoEligible: eligible,
      status: 'pending',
    },
  });
  return send(res, 200, { ok: true, autoEligible: eligible, status: 'pending' });
});

R('GET', '/app/admin/qualifications', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const list = db.all('users')
    .filter(u => u.qualificationRequest && u.qualificationRequest.status === 'pending')
    .map(u => ({
      userId: u.id, name: u.name, email: u.email, phone: u.phone,
      request: u.qualificationRequest,
      currentClass: u.investorClass || 'retail',
    }));
  return send(res, 200, { qualifications: list });
});

R('POST', /^\/app\/admin\/qualifications\/([^/]+)\/(approve|reject)$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const [, userId, action] = m;
  const u = db.find('users', x => x.id === userId);
  if (!u || !u.qualificationRequest) return err(res, 404, 'not_found');
  if (action === 'approve') {
    await db.patch('users', x => x.id === userId, {
      investorClass: 'qualified',
      qualificationRequest: { ...u.qualificationRequest, status: 'approved', decidedAt: now(), decidedBy: admin.id },
    });
    await audit(admin.id, 'qualification.approve', userId, {}, req);
    await notify(userId, 'qualification_approved', 'تأهيلك كمستثمر مؤهل',
      'تمت الموافقة على طلب تأهيلك كمستثمر مؤهل. أصبحت سقوف الاستثمار أعلى لك الآن.');
  } else {
    await db.patch('users', x => x.id === userId, {
      qualificationRequest: { ...u.qualificationRequest, status: 'rejected', decidedAt: now(), decidedBy: admin.id },
    });
    await audit(admin.id, 'qualification.reject', userId, {}, req);
    await notify(userId, 'qualification_rejected', 'مراجعة طلب التأهيل',
      'لم تتم الموافقة على طلب تأهيلك كمستثمر مؤهل. يمكنك تقديم طلب جديد عند تغيّر بياناتك المالية.');
  }
  return send(res, 200, { ok: true });
});

// ─── PDPL: data export + right-to-erasure ──────────────────────────
// PDPL Art. 8 (right of access) and Art. 18 (right to erasure).
// Export returns ALL personal data we hold; erasure schedules deletion
// with a 30-day grace window so accidental requests can be reversed.

R('GET', '/app/me/export', async (req, res) => {
  const auth = requireAuth(req, res); if (!auth) return;
  const u = db.find('users', x => x.id === auth.id);
  const safe = S.publicUser(u) || {};
  delete safe.deletionScheduledAt; delete safe.deletionRequestedAt;
  const investments  = db.filter('investments',  i => i.userId === auth.id);
  const contracts    = db.filter('contracts',    c => c.userId === auth.id);
  const transactions = db.filter('transactions', t => t.userId === auth.id);
  const notifications= db.filter('notifications',n => n.userId === auth.id);
  const paymentMethods = db.filter('paymentMethods', m => m.userId === auth.id && !m.removedAt)
    .map(m => ({ id: m.id, type: m.type, brand: m.brand || null, last4: m.last4 || null, ibanMasked: m.ibanMasked || null, holder: m.holder, isDefault: m.isDefault, createdAt: m.createdAt }));
  const kycDocs = u?.kycDocs ? Object.fromEntries(
    Object.entries(u.kycDocs).map(([k, v]) => [k, { mime: v.mime, size: v.size, uploadedAt: v.uploadedAt, downloadUrl: `/app/auth/kyc/file/${k}` }])
  ) : {};
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="murbha-data-${auth.id}.json"`,
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({
    exportedAt: now(),
    note: 'بيانات شخصية محفوظة على منصة مُرابحة وفقاً لنظام حماية البيانات الشخصية (PDPL).',
    user: safe, kycDocs, paymentMethods, investments, contracts, transactions, notifications,
  }, null, 2));
});

const ERASURE_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

R('POST', '/app/me/request-deletion', async (req, res) => {
  const auth = requireAuth(req, res); if (!auth) return;
  if (auth.role === 'admin') return err(res, 403, 'unauthorized');
  const body = await readJson(req);
  const password = body?.password || '';
  const fresh = db.find('users', u => u.id === auth.id);
  if (!S.verifyPassword(password, fresh.salt, fresh.passwordHash)) return err(res, 401, 'bad_credentials');
  const eta = Date.now() + ERASURE_GRACE_MS;
  await db.patch('users', u => u.id === auth.id, {
    deletionRequestedAt: now(),
    deletionScheduledAt: new Date(eta).toISOString(),
  });
  await notify(auth.id, 'account_deletion_scheduled', 'تم جدولة حذف الحساب',
    `سيتم حذف حسابك وبياناتك نهائياً في ${new Date(eta).toLocaleDateString('ar-SA')}. يمكنك الإلغاء قبل ذلك من إعدادات الحساب.`);
  if (fresh.email) {
    const text = `استلمنا طلب حذف حسابك من منصة مُرابحة.\nسيتم تنفيذ الحذف نهائياً في ${new Date(eta).toLocaleDateString('ar-SA')}.\nإذا لم تطلب ذلك، يرجى تسجيل الدخول وإلغاء الطلب فوراً.`;
    M.send({ to: fresh.email, subject: 'تأكيد جدولة حذف حسابك في منصة مُرابحة', text, html: '<p style="font-family:Tajawal,Cairo,sans-serif;direction:rtl">' + text.replace(/\n/g, '<br>') + '</p>' }).catch(() => {});
  }
  return send(res, 200, { ok: true, scheduledAt: new Date(eta).toISOString() });
});

R('POST', '/app/me/cancel-deletion', async (req, res) => {
  const auth = requireAuth(req, res); if (!auth) return;
  const fresh = db.find('users', u => u.id === auth.id);
  if (!fresh.deletionScheduledAt) return send(res, 200, { ok: true });
  await db.patch('users', u => u.id === auth.id, { deletionScheduledAt: null, deletionRequestedAt: null });
  await notify(auth.id, 'account_deletion_cancelled', 'تم إلغاء حذف الحساب', 'تم إلغاء طلب حذف الحساب بناءً على طلبك.');
  return send(res, 200, { ok: true });
});

// ─── Password reset ────────────────────────────────────────────────
// Single-use token, 1h TTL, stored as sha256(token) on the user record so
// even a DB leak doesn't disclose live reset links. The plaintext token
// lives only in the email and the URL fragment.
const RESET_TTL_MS = 60 * 60 * 1000;
const sha256 = (s) => require('crypto').createHash('sha256').update(s).digest('hex');

R('POST', '/app/auth/forgot-password', async (req, res) => {
  const body = await readJson(req);
  const email = (body?.email || '').trim().toLowerCase();
  // Always respond 200 to avoid leaking which emails are registered.
  if (!isEmail(email)) return send(res, 200, { ok: true });
  const user = db.find('users', u => u.email === email);
  if (!user) return send(res, 200, { ok: true });

  const token = require('crypto').randomBytes(32).toString('hex');
  const reset = { hash: sha256(token), expiresAt: Date.now() + RESET_TTL_MS, createdAt: now() };
  await db.patch('users', u => u.id === user.id, { passwordReset: reset });

  const origin = process.env.APP_PUBLIC_URL || `http://${req.headers.host || 'localhost'}`;
  const url = `${origin}/reset-password.html?token=${token}`;
  const tpl = M.passwordResetTemplate(user.name, url);
  M.send({ to: email, subject: 'إعادة تعيين كلمة المرور — مُرابحة', html: tpl.html, text: tpl.text }).catch(()=>{});
  return send(res, 200, { ok: true });
});

R('POST', '/app/auth/reset-password', async (req, res) => {
  const body = await readJson(req);
  const token = (body?.token || '').trim();
  const newPassword = body?.newPassword || '';
  if (!token || newPassword.length < 8) return err(res, 400, 'invalid_input');

  const hash = sha256(token);
  const user = db.find('users', u => u.passwordReset && u.passwordReset.hash === hash);
  if (!user) return err(res, 400, 'invalid_token');
  if (user.passwordReset.expiresAt < Date.now()) return err(res, 400, 'invalid_token');

  const { salt, passwordHash } = S.hashPassword(newPassword);
  await db.patch('users', u => u.id === user.id, {
    salt, passwordHash,
    passwordReset: null,
    rejected: false, // restore access if they were rejected? no - keep rejected
  });
  await notify(user.id, 'security', 'تم تغيير كلمة المرور',
    'تم تغيير كلمة المرور لحسابك. إذا لم تكن أنت من قام بذلك، تواصل مع الدعم فوراً.');
  if (user.email) {
    M.send({
      to: user.email,
      subject: '🔐 تم تغيير كلمة المرور لحسابك',
      html: M.passwordResetTemplate(user.name, '').html.replace('تلقّينا طلباً لإعادة تعيين كلمة المرور', 'تم تغيير كلمة المرور لحسابك بنجاح').replace(/<div style="text-align:center[\s\S]*?<\/div>/, ''),
      text: 'تم تغيير كلمة المرور لحسابك بنجاح. إذا لم تكن أنت من قام بذلك، تواصل مع الدعم فوراً.\n\n— منصة مُرابحة',
    }).catch(()=>{});
  }
  return send(res, 200, { ok: true });
});

/** Nafath success callback — accepts a verified nationalId, links or creates a user, sets session. */
R('POST', '/app/auth/nafath', async (req, res) => {
  const body = await readJson(req);
  const nationalId = (body?.nationalId || '').trim();
  const name = (body?.name || 'مستثمر مُرابحة').trim();
  if (!/^[12]\d{9}$/.test(nationalId)) return err(res, 400, 'invalid_input');

  let user = db.find('users', u => u.nationalId === nationalId);
  if (!user) {
    user = {
      id: S.newId('usr_'),
      name, email: '', phone: '', nationalId,
      avatar: null, role: 'investor', locale: 'ar',
      nafathVerified: true, balance: 0, kycStatus: 'verified',
      createdAt: now(),
      salt: '', passwordHash: '',
    };
    await db.insert('users', user);
    await notify(user.id, 'welcome', 'مرحباً بك في مُرابحة',
      'تم التحقق من هويتك بنجاح.');
  } else if (!user.nafathVerified) {
    await db.patch('users', u => u.id === user.id, { nafathVerified: true, kycStatus: 'verified' });
  }

  S.setSessionCookie(res, user.id);
  return send(res, 200, { user: S.publicUser(user) });
});

// ============================================================
//  PROJECTS
// ============================================================

R('GET', '/app/projects', async (req, res) => {
  const auth = S.currentUser(req);
  const isAdmin = auth?.role === 'admin';
  const list = db.all('projects')
    .filter(p => isAdmin || !p.paused)
    .map(p => ({
      ...p,
      fundedPct: p.goal > 0 ? Math.min(100, Math.round((p.raised / p.goal) * 100)) : 0,
    }));
  return send(res, 200, { projects: list });
});

// Public anonymized activity feed — for social proof on the landing page.
R('GET', '/app/activity-public', async (req, res) => {
  const limit = Math.min(parseInt(new URL(req.url, 'http://x').searchParams.get('limit') || '8', 10), 30);
  const userIdx = Object.fromEntries(db.all('users').map(u => [u.id, u]));
  const projIdx = Object.fromEntries(db.all('projects').map(p => [p.id, p]));
  const anon = (name) => {
    if (!name) return 'مستثمر';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 1) + '. مستثمر';
    return parts[0] + ' ' + parts[1].slice(0, 1) + '.';
  };
  const recent = db.all('investments')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map(i => {
      const u = userIdx[i.userId];
      const p = projIdx[i.projectId];
      return {
        name: anon(u?.name),
        projectName: p?.name || '—',
        projectSlug: p?.slug || p?.id,
        amount: i.amount || 0,
        at: i.createdAt,
      };
    });
  return send(res, 200, { activity: recent });
});

// Public platform statistics — no auth, safe to expose aggregates only.
R('GET', '/app/stats', async (req, res) => {
  const projects = db.all('projects');
  const investments = db.all('investments');
  const users = db.all('users');

  const open      = projects.filter(p => p.status === 'open');
  const funded    = projects.filter(p => p.status === 'funded');
  const completed = projects.filter(p => p.status === 'completed');
  const defaulted = projects.filter(p => p.status === 'defaulted');

  const cumulativeFunded = projects.reduce((s, p) => s + (p.raised || 0), 0);
  const totalGoal        = projects.reduce((s, p) => s + (p.goal   || 0), 0);

  // Weighted-average profit rate across all funded projects.
  const weightedRate = (() => {
    const tot = projects.reduce((s, p) => s + (p.raised || 0), 0);
    if (!tot) return 0;
    const w   = projects.reduce((s, p) => s + (p.raised || 0) * (p.profitRate || 0), 0);
    return w / tot;
  })();

  // Investors: take the larger of (real unique investors who've invested) and
  // (sum of project-level investorCount). The latter is the per-project trust
  // signal from the seed; the former takes over as real activity exceeds it.
  const uniqueInvestorIds = new Set(investments.map(i => i.userId).filter(Boolean));
  const projectInvestorSum = projects.reduce((s, p) => s + (p.investorCount || 0), 0);
  const investorCount = Math.max(uniqueInvestorIds.size, projectInvestorSum);

  // Profit distributed = sum of expected returns on completed investments
  // OR fallback: completed projects' raised * rate * term.
  const profitFromCompletedInvestments = investments
    .filter(i => i.status === 'completed')
    .reduce((s, i) => s + ((i.expectedReturn || 0) - (i.amount || 0)), 0);
  const profitFromCompletedProjects = completed.reduce(
    (s, p) => s + (p.raised || 0) * (p.profitRate || 0) * ((p.termMonths || 0) / 12),
    0
  );
  const profitDistributed = profitFromCompletedInvestments || profitFromCompletedProjects;

  // Default rate by count and by amount.
  const closedCount   = completed.length + defaulted.length;
  const defaultRatePct = closedCount > 0
    ? (defaulted.length / closedCount) * 100
    : 0;
  const onTimeRepaymentPct = 100 - defaultRatePct;

  // Funded breakdown by category (top 6).
  const byCategory = {};
  for (const p of projects) {
    const c = p.category || 'أخرى';
    byCategory[c] = (byCategory[c] || 0) + (p.raised || 0);
  }
  const categoryBreakdown = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([category, raised]) => ({ category, raised }));

  return send(res, 200, {
    totals: {
      cumulativeFunded,
      totalGoal,
      profitDistributed,
      investorCount,
      registeredUsers: users.length,
      projectCount: projects.length,
    },
    projects: {
      open:      open.length,
      funded:    funded.length,
      completed: completed.length,
      defaulted: defaulted.length,
    },
    performance: {
      avgProfitRate: weightedRate,
      onTimeRepaymentPct,
      defaultRatePct,
    },
    categoryBreakdown,
    updatedAt: new Date().toISOString(),
  });
});

R('GET', /^\/app\/projects\/([^/]+)$/, async (req, res, m) => {
  const p = db.find('projects', x => x.id === m[1] || x.slug === m[1]);
  if (!p) return err(res, 404, 'not_found');
  const fundedPct = p.goal > 0 ? Math.min(100, Math.round((p.raised / p.goal) * 100)) : 0;
  return send(res, 200, { project: { ...p, fundedPct, shareCount: p.shareCount || 0 } });
});

const SHARE_CHANNELS = ['whatsapp', 'twitter', 'telegram', 'copy_link', 'native', 'linkedin'];
R('POST', /^\/app\/projects\/([^/]+)\/share$/, async (req, res, m) => {
  const body = await readJson(req);
  const channel = (body?.channel || '').trim();
  if (!SHARE_CHANNELS.includes(channel)) return err(res, 400, 'invalid_input');
  const p = db.find('projects', x => x.id === m[1] || x.slug === m[1]);
  if (!p) return err(res, 404, 'not_found');
  await db.update(d => {
    const prj = d.projects.find(x => x.id === p.id);
    if (!prj) return;
    prj.shareCount = (prj.shareCount || 0) + 1;
    prj.shareBreakdown = prj.shareBreakdown || {};
    prj.shareBreakdown[channel] = (prj.shareBreakdown[channel] || 0) + 1;
  });
  return send(res, 200, { ok: true });
});

// ============================================================
//  INVESTMENTS  (creates a pending contract; sign it to activate)
// ============================================================

R('POST', /^\/app\/projects\/([^/]+)\/invest$/, async (req, res, m) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const amount = Number(body?.amount);

  const project = db.find('projects', x => x.id === m[1] || x.slug === m[1]);
  if (!project) return err(res, 404, 'not_found');
  if (project.status !== 'open') return err(res, 400, 'closed');
  if (!(amount > 0) || amount < (project.minAmount || 1000)) return err(res, 400, 'min_amount');
  if (amount > (project.goal - project.raised))             return err(res, 400, 'max_amount');

  // SAMA crowdfunding caps (retail vs qualified). Retail investors are limited
  // both per-deal and per-year to protect non-professional participants.
  const fresh = db.find('users', u => u.id === user.id);
  const klass = fresh.investorClass || 'retail';
  const RETAIL_PER_DEAL = 50_000;
  const RETAIL_PER_YEAR = 200_000;
  if (klass === 'retail') {
    if (amount > RETAIL_PER_DEAL) return send(res, 400, { error: 'retail_per_deal_cap', message: `الحد الأقصى لكل فرصة للمستثمر الفردي هو ${RETAIL_PER_DEAL.toLocaleString('ar-SA')} ر.س. للترقية، قدّم طلب تأهيل كمستثمر مؤهل.` });
    const yearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const yearTotal = db.filter('investments', i => i.userId === user.id && new Date(i.createdAt).getTime() > yearAgo)
      .reduce((s, i) => s + (i.amount || 0), 0);
    if (yearTotal + amount > RETAIL_PER_YEAR) {
      return send(res, 400, {
        error: 'retail_per_year_cap',
        message: `الحد السنوي للمستثمر الفردي هو ${RETAIL_PER_YEAR.toLocaleString('ar-SA')} ر.س. استثمرت ${yearTotal.toLocaleString('ar-SA')} حتى الآن.`,
      });
    }
  }

  const contractId = S.newId('ctr_');
  const investmentId = S.newId('inv_');

  await db.update(d => {
    d.investments.push({
      id: investmentId,
      userId: user.id,
      projectId: project.id,
      amount,
      status: 'pending_signature',
      expectedReturn: amount * (1 + (project.profitRate || 0.08) * (project.termMonths || 12) / 12),
      contractId,
      createdAt: now(),
      signedAt: null,
    });
    d.contracts.push({
      id: contractId,
      userId: user.id,
      projectId: project.id,
      investmentId,
      amount,
      profitRate: project.profitRate || 0.08,
      termMonths: project.termMonths || 12,
      status: 'pending',
      signature: null,
      createdAt: now(),
      signedAt: null,
    });
  });

  await notify(user.id, 'invest', 'بانتظار توقيع عقد المرابحة',
    `تم إنشاء طلب استثمار بقيمة ${amount.toLocaleString('ar-SA')} ر.س. في ${project.name}. وقّع العقد لإكمال العملية.`,
    { contractId, projectId: project.id, investmentId });
  WH.dispatch(db, 'investment.created', { investmentId, contractId, userId: user.id, projectId: project.id, amount });

  return send(res, 201, { investmentId, contractId, amount });
});

// ============================================================
//  CONTRACTS
// ============================================================

R('GET', /^\/app\/contracts\/([^/]+)$/, async (req, res, m) => {
  const user = requireAuth(req, res); if (!user) return;
  const c = db.find('contracts', x => x.id === m[1] && x.userId === user.id);
  if (!c) return err(res, 404, 'not_found');
  const project = db.find('projects', p => p.id === c.projectId);
  return send(res, 200, { contract: c, project });
});

R('POST', /^\/app\/contracts\/([^/]+)\/sign$/, async (req, res, m) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const signature = (body?.signature || '').trim();
  if (!signature) return err(res, 400, 'invalid_input');

  const c = db.find('contracts', x => x.id === m[1] && x.userId === user.id);
  if (!c) return err(res, 404, 'not_found');
  if (c.status === 'signed' || c.status === 'active') return send(res, 200, { contract: c, alreadySigned: true });

  // Resolve which contract template + fatwa applies to this project at time of signing.
  const project = db.find('projects', p => p.id === c.projectId);
  const templates = db.filter('contractTemplates', t => t.projectId === c.projectId || t.projectId === null);
  const active = templates
    .filter(t => !t.deprecatedAt)
    .sort((a, b) => new Date(b.activatedAt || 0) - new Date(a.activatedAt || 0))[0]
    || { id: null, version: 'v1', fatwaId: project?.fatwaId || null, fatwaIssuer: project?.shariaApproval || null };

  // Hash of the canonical signed-content + signature creates an immutable
  // audit trail: re-computing this off the stored values must match.
  const canonical = JSON.stringify({
    contractId: c.id, userId: user.id, projectId: c.projectId,
    amount: c.amount, templateId: active.id, templateVersion: active.version,
    fatwaId: active.fatwaId, signature, ts: now(),
  });
  const sha = require('crypto').createHash('sha256').update(canonical).digest('hex');

  await db.update(d => {
    const ct = d.contracts.find(x => x.id === c.id);
    ct.status = 'signed';
    ct.signature = signature;
    ct.signedAt = now();
    ct.templateId = active.id;
    ct.templateVersion = active.version;
    ct.fatwaId = active.fatwaId;
    ct.signatureHash = sha;
    const inv = d.investments.find(x => x.id === ct.investmentId);
    inv.status = 'pending_payment';
    inv.signedAt = now();
    d.signingRecords.push({
      id: S.newId('sig_'),
      contractId: c.id,
      userId: user.id,
      projectId: c.projectId,
      amount: c.amount,
      templateId: active.id,
      templateVersion: active.version,
      fatwaId: active.fatwaId,
      fatwaIssuer: active.fatwaIssuer,
      signatureHash: sha,
      ip: clientIp(req),
      ua: req.headers['user-agent'] || null,
      signedAt: now(),
    });
  });

  await notify(user.id, 'contract_signed', 'تم توقيع العقد بنجاح',
    'تم توقيع العقد بنجاح. يُرجى إكمال عملية الدفع لتنشيط الاستثمار.', { contractId: c.id });
  WH.dispatch(db, 'contract.signed', { contractId: c.id, userId: user.id, projectId: c.projectId, amount: c.amount, signatureHash: sha });

  const updated = db.find('contracts', x => x.id === c.id);
  return send(res, 200, { contract: updated });
});

// ─── Contract templates (admin manages versioned templates + fatwa IDs) ───
R('GET', '/app/admin/contract-templates', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const list = db.all('contractTemplates').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return send(res, 200, { templates: list });
});

R('POST', '/app/admin/contract-templates', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const projectId  = body?.projectId || null; // null = applies to all projects
  const version    = (body?.version || 'v1').toString().trim().slice(0, 32);
  const fatwaId    = (body?.fatwaId || '').toString().trim().slice(0, 200) || null;
  const fatwaIssuer= (body?.fatwaIssuer || '').toString().trim().slice(0, 200) || null;
  const fatwaUrl   = (body?.fatwaUrl || '').toString().trim().slice(0, 500) || null;
  const bodyText   = (body?.body || '').toString().slice(0, 200_000);
  if (!version || !bodyText) return err(res, 400, 'invalid_input');
  const tpl = {
    id: S.newId('tpl_'),
    projectId, version, fatwaId, fatwaIssuer, fatwaUrl, body: bodyText,
    createdBy: admin.id, createdAt: now(),
    activatedAt: now(), deprecatedAt: null,
  };
  await db.insert('contractTemplates', tpl);
  await audit(admin.id, 'contract-template.create', tpl.id, { version, fatwaId }, req);
  return send(res, 201, { template: tpl });
});

// ─── Push notifications (Web Push / VAPID) ─────────────────────────
R('GET', '/app/push/public-key', async (req, res) => {
  return send(res, 200, { publicKey: PUSH.publicKey(), configured: PUSH.isConfigured() });
});

R('POST', '/app/push/subscribe', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const sub = body?.subscription;
  if (!sub?.endpoint) return err(res, 400, 'invalid_input');
  const existing = db.find('pushSubscriptions', s => s.userId === user.id && s.endpoint === sub.endpoint);
  if (existing) return send(res, 200, { ok: true, alreadySubscribed: true });
  await db.insert('pushSubscriptions', {
    id: S.newId('psub_'),
    userId: user.id,
    endpoint: sub.endpoint,
    keys: sub.keys || null,
    ua: req.headers['user-agent'] || null,
    createdAt: now(),
  });
  return send(res, 201, { ok: true });
});

R('POST', '/app/push/unsubscribe', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  if (!body?.endpoint) return err(res, 400, 'invalid_input');
  await db.remove('pushSubscriptions', s => s.userId === user.id && s.endpoint === body.endpoint);
  return send(res, 200, { ok: true });
});

R('POST', '/app/admin/push/broadcast', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const title = (body?.title || '').trim().slice(0, 200);
  const text  = (body?.body || '').trim().slice(0, 500);
  const url   = (body?.url || '').trim();
  if (!title || !text) return err(res, 400, 'invalid_input');
  const subs = db.all('pushSubscriptions');
  let sent = 0;
  for (const s of subs) {
    const r = await PUSH.sendPush({ subscription: { endpoint: s.endpoint, keys: s.keys }, payload: { title, body: text, url } });
    if (r.ok) sent++;
  }
  await audit(admin.id, 'push.broadcast', 'all', { sent, title }, req);
  return send(res, 200, { ok: true, sent, total: subs.length });
});

// ─── Project documents (PDFs) ─────────────────────────────────────
R('POST', /^\/app\/admin\/projects\/([^/]+)\/documents$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const project = db.find('projects', p => p.id === m[1] || p.slug === m[1]);
  if (!project) return err(res, 404, 'not_found');
  const body = await readJson(req);
  const title = (body?.title || '').trim().slice(0, 200);
  const data  = body?.data || '';
  if (!title) return err(res, 400, 'invalid_input', { field: 'title' });
  const result = U.persist('project_' + project.id, 'project_doc', data);
  if (!result.ok) return send(res, 400, { error: result.error, message: ARABIC[result.error] || 'فشل رفع الملف.' });
  const doc = {
    id: S.newId('pdoc_'),
    projectId: project.id,
    title,
    path: result.relPath,
    size: result.size,
    mime: result.mime,
    uploadedBy: admin.id,
    uploadedAt: now(),
  };
  await db.insert('projectDocuments', doc);
  await audit(admin.id, 'project.document.upload', doc.id, { projectId: project.id, title, size: result.size }, req);
  return send(res, 201, { document: { id: doc.id, title, size: doc.size, mime: doc.mime, uploadedAt: doc.uploadedAt } });
});

R('GET', /^\/app\/projects\/([^/]+)\/documents$/, async (req, res, m) => {
  const project = db.find('projects', p => p.id === m[1] || p.slug === m[1]);
  if (!project) return err(res, 404, 'not_found');
  const list = db.filter('projectDocuments', d => d.projectId === project.id)
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
    .map(d => ({ id: d.id, title: d.title, size: d.size, mime: d.mime, uploadedAt: d.uploadedAt }));
  return send(res, 200, { documents: list });
});

R('GET', /^\/app\/projects\/[^/]+\/documents\/([^/]+)$/, async (req, res, m) => {
  const auth = requireAuth(req, res); if (!auth) return;
  const doc = db.find('projectDocuments', d => d.id === m[1]);
  if (!doc) return err(res, 404, 'not_found');
  const s = U.stream(doc.path);
  if (!s) return err(res, 404, 'not_found');
  res.writeHead(200, {
    'Content-Type': doc.mime || 'application/octet-stream',
    'Content-Disposition': `inline; filename="${doc.title.replace(/[^\w\s.-]/g, '_')}.pdf"`,
    'Cache-Control': 'private, no-store',
  });
  s.stream.pipe(res);
});

R('DELETE', /^\/app\/admin\/project-documents\/([^/]+)$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const doc = db.find('projectDocuments', d => d.id === m[1]);
  if (!doc) return err(res, 404, 'not_found');
  U.remove(doc.path);
  await db.remove('projectDocuments', d => d.id === m[1]);
  await audit(admin.id, 'project.document.delete', m[1], { projectId: doc.projectId }, req);
  return send(res, 200, { ok: true });
});

// ─── Magic-link login (passwordless) ───────────────────────────────
const MAGIC_TTL_MS = 15 * 60 * 1000;
R('POST', '/app/auth/magic-link', async (req, res) => {
  const body = await readJson(req);
  const email = (body?.email || '').trim().toLowerCase();
  if (!isEmail(email)) return send(res, 200, { ok: true });
  const user = db.find('users', u => u.email === email);
  if (!user || user.rejected) return send(res, 200, { ok: true });
  const token = require('crypto').randomBytes(32).toString('hex');
  const hash = require('crypto').createHash('sha256').update(token).digest('hex');
  await db.insert('magicLinks', {
    id: S.newId('ml_'), userId: user.id, hash,
    expiresAt: Date.now() + MAGIC_TTL_MS,
    createdAt: now(), usedAt: null,
  });
  const origin = process.env.APP_PUBLIC_URL || `http://${req.headers.host || 'localhost'}`;
  const url = `${origin}/app/auth/magic-link/consume?token=${token}`;
  const text = `استلمنا طلب دخول بدون كلمة مرور إلى حسابك على منصة مُرابحة.\nاضغط على الرابط التالي خلال 15 دقيقة:\n${url}\n\nإذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة.\n\n— منصة مُرابحة`;
  const html = `<p style="font-family:Tajawal,Cairo,sans-serif;direction:rtl;font-size:15px;line-height:1.7">استلمنا طلب دخول إلى حسابك على منصة مُرابحة.</p>
<div style="text-align:center;margin:24px 0"><a href="${url}" style="background:#062b1e;color:#fbf6ea;padding:14px 28px;border-radius:12px;text-decoration:none;font:800 14px Cairo,sans-serif">تسجيل الدخول</a></div>
<p style="font-family:Tajawal,Cairo,sans-serif;direction:rtl;font-size:12px;color:#6b7268">صالح لمدة 15 دقيقة، مرّة واحدة فقط.</p>`;
  M.send({ to: email, subject: 'رابط الدخول لمنصة مُرابحة', text, html }).catch(() => {});
  return send(res, 200, { ok: true });
});

R('GET', '/app/auth/magic-link/consume', async (req, res) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token') || '';
  if (!token) { res.writeHead(302, { Location: '/login.html?error=invalid_link' }); return res.end(); }
  const hash = require('crypto').createHash('sha256').update(token).digest('hex');
  const link = db.find('magicLinks', l => l.hash === hash);
  if (!link || link.usedAt || link.expiresAt < Date.now()) {
    res.writeHead(302, { Location: '/login.html?error=expired_link' }); return res.end();
  }
  await db.patch('magicLinks', l => l.id === link.id, { usedAt: now() });
  const user = db.find('users', u => u.id === link.userId);
  if (!user || user.rejected) { res.writeHead(302, { Location: '/login.html?error=account_unavailable' }); return res.end(); }
  if (user.totpEnrolled) {
    const challenge = require('crypto').randomBytes(24).toString('hex');
    await db.patch('users', u => u.id === user.id, { twofaChallenge: { token: challenge, expiresAt: Date.now() + 5 * 60_000 } });
    res.writeHead(302, { Location: '/login.html?2fa=' + encodeURIComponent(challenge) }); return res.end();
  }
  S.setSessionCookie(res, user.id);
  res.writeHead(302, { Location: '/portfolio.html' });
  return res.end();
});

// ─── Help center articles (CMS) ───────────────────────────────────
const HELP_CATS = ['getting_started', 'investing', 'kyc', 'payments', 'security', 'shariah'];

R('GET', '/app/public/search', async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  if (!q || q.length < 2) return send(res, 200, { results: [], q });
  const matches = (s) => (s || '').toString().toLowerCase().includes(q);
  const results = [];

  for (const a of db.all('helpArticles').filter(x => x.publishedAt)) {
    if (matches(a.title) || matches(a.body) || matches(a.tags)) {
      results.push({
        kind: 'help',
        title: a.title,
        snippet: (a.body || '').slice(0, 220),
        url: '/help.html?article=' + encodeURIComponent(a.slug || a.id),
      });
    }
  }
  for (const ann of db.all('announcements').filter(x => !x.deletedAt && (!x.expiresAt || new Date(x.expiresAt) > new Date()))) {
    if (matches(ann.title) || matches(ann.body)) {
      results.push({
        kind: 'announcement',
        title: ann.title,
        snippet: (ann.body || '').slice(0, 220),
        url: '/changelog.html',
      });
    }
  }
  for (const p of db.all('projects').filter(x => x.status === 'open')) {
    if (matches(p.name) || matches(p.summary) || matches(p.category) || matches(p.city)) {
      results.push({
        kind: 'project',
        title: p.name,
        snippet: (p.summary || '').slice(0, 220),
        url: '/project.html?id=' + encodeURIComponent(p.slug || p.id),
      });
    }
  }
  res.setHeader('Cache-Control', 'public, max-age=30');
  return send(res, 200, { results: results.slice(0, 40), q });
});

R('GET', '/app/help/articles', async (req, res) => {
  const params = new URL(req.url, 'http://x').searchParams;
  const q   = (params.get('q') || '').trim().toLowerCase();
  const cat = params.get('category');
  let list = db.all('helpArticles').filter(a => a.publishedAt);
  if (cat) list = list.filter(a => a.category === cat);
  if (q) list = list.filter(a => (a.title + ' ' + a.body).toLowerCase().includes(q));
  list = list.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .map(a => ({ id: a.id, title: a.title, summary: a.summary, category: a.category, publishedAt: a.publishedAt }));
  return send(res, 200, { articles: list, categories: HELP_CATS });
});

R('GET', /^\/app\/help\/articles\/([^/]+)$/, async (req, res, m) => {
  const a = db.find('helpArticles', x => x.id === m[1] || x.slug === m[1]);
  if (!a || !a.publishedAt) return err(res, 404, 'not_found');
  return send(res, 200, { article: a });
});

R('GET', '/app/admin/help/articles', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  return send(res, 200, { articles: db.all('helpArticles').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), categories: HELP_CATS });
});

R('POST', '/app/admin/help/articles', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const title = (body?.title || '').trim().slice(0, 200);
  const summary = (body?.summary || '').trim().slice(0, 400);
  const text = (body?.body || '').trim().slice(0, 50_000);
  const category = HELP_CATS.includes(body?.category) ? body.category : 'getting_started';
  const publish = body?.publish !== false;
  if (!title || !text) return err(res, 400, 'invalid_input');
  const slug = title.toLowerCase().replace(/[^a-z0-9أ-ي\s-]/g, '').replace(/\s+/g, '-').slice(0, 60);
  const article = {
    id: S.newId('help_'), slug, title, summary, body: text, category,
    createdBy: admin.id, createdAt: now(), updatedAt: now(),
    publishedAt: publish ? now() : null,
  };
  await db.insert('helpArticles', article);
  await audit(admin.id, 'help.article.create', article.id, { title, category }, req);
  return send(res, 201, { article });
});

R('PATCH', /^\/app\/admin\/help\/articles\/([^/]+)$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const allowed = ['title', 'summary', 'body', 'category', 'publishedAt'];
  const changes = { updatedAt: now() };
  for (const k of allowed) if (k in (body || {})) changes[k] = body[k];
  if (changes.category && !HELP_CATS.includes(changes.category)) delete changes.category;
  await db.patch('helpArticles', a => a.id === m[1], changes);
  await audit(admin.id, 'help.article.update', m[1], Object.keys(changes), req);
  return send(res, 200, { ok: true });
});

R('DELETE', /^\/app\/admin\/help\/articles\/([^/]+)$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  await db.remove('helpArticles', a => a.id === m[1]);
  await audit(admin.id, 'help.article.delete', m[1], {}, req);
  return send(res, 200, { ok: true });
});

// ─── Notification preferences ──────────────────────────────────────
const DEFAULT_NOTIF_PREFS = {
  email: { kyc: true, payments: true, contracts: true, marketing: false, security: true },
  sms:   { otp: true, payments: true, security: true },
  push:  { all: true },
};

R('GET', '/app/me/notification-prefs', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const fresh = db.find('users', u => u.id === user.id);
  return send(res, 200, { prefs: fresh?.notificationPrefs || DEFAULT_NOTIF_PREFS, defaults: DEFAULT_NOTIF_PREFS });
});

R('PATCH', '/app/me/notification-prefs', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const fresh = db.find('users', u => u.id === user.id);
  const current = fresh.notificationPrefs || DEFAULT_NOTIF_PREFS;
  const next = {
    email: { ...current.email, ...(body?.email || {}) },
    sms:   { ...current.sms,   ...(body?.sms   || {}) },
    push:  { ...current.push,  ...(body?.push  || {}) },
  };
  await db.patch('users', u => u.id === user.id, { notificationPrefs: next });
  return send(res, 200, { prefs: next });
});

// ─── One-click email unsubscribe (no login required) ─────────────
// Embed `/unsubscribe?u=<userId>&c=<category>&t=<hmac>` in transactional emails.
const _unsubSecret = () => process.env.SESSION_SECRET || 'dev-only-fallback';
const _unsubToken = (userId, category) => {
  return require('crypto').createHmac('sha256', _unsubSecret())
    .update(`${userId}:${category}`).digest('hex').slice(0, 32);
};
const buildUnsubLink = (host, userId, category) => {
  const t = _unsubToken(userId, category);
  return `${host}/app/unsubscribe?u=${encodeURIComponent(userId)}&c=${encodeURIComponent(category)}&t=${t}`;
};

R('GET', '/app/unsubscribe', async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const u = url.searchParams.get('u') || '';
  const c = url.searchParams.get('c') || '';
  const t = url.searchParams.get('t') || '';
  if (!u || !c || !t) return err(res, 400, 'invalid_input');
  if (t !== _unsubToken(u, c)) return err(res, 403, 'invalid_token');
  const user = db.find('users', x => x.id === u);
  if (!user) return err(res, 404, 'not_found');
  const current = user.notificationPrefs || DEFAULT_NOTIF_PREFS;
  const next = {
    email: { ...current.email },
    sms:   { ...current.sms },
    push:  { ...current.push },
  };
  if (c === 'all' || c === 'all-email') {
    Object.keys(next.email || {}).forEach(k => { next.email[k] = false; });
  } else if (next.email && c in next.email) {
    next.email[c] = false;
  } else {
    return err(res, 400, 'invalid_category');
  }
  await db.patch('users', x => x.id === u, { notificationPrefs: next });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تم إلغاء الاشتراك</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,-apple-system,sans-serif;background:#fbf6ea;color:#0d1612;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}div{max-width:480px;background:#fff;border-radius:18px;padding:32px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.05);}h1{color:#062b1e;margin:0 0 8px;}p{color:#6b7268;line-height:1.7;}a{color:#0a4d36;font-weight:700;text-decoration:none;}</style></head><body><div><h1>✓ تم إلغاء الاشتراك</h1><p>لن تصلك المزيد من رسائل البريد لهذه الفئة. يمكنك تعديل تفضيلاتك في أي وقت من <a href="/profile.html">صفحة الحساب</a>.</p></div></body></html>');
});

// ─── Referrals ─────────────────────────────────────────────────────
R('GET', '/app/me/referral', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const fresh = db.find('users', u => u.id === user.id);
  let code = fresh?.referralCode;
  if (!code) {
    code = ('MRB-' + (fresh.name || 'INV').replace(/[^A-Za-z؀-ۿ]/g, '').slice(0, 4).toUpperCase() + '-' + require('crypto').randomBytes(2).toString('hex').toUpperCase());
    await db.patch('users', u => u.id === user.id, { referralCode: code });
  }
  const invited = db.filter('referrals', r => r.referrerId === user.id);
  return send(res, 200, {
    code,
    shareUrl: (process.env.APP_PUBLIC_URL || ('http://' + (req.headers.host || 'localhost'))) + '/signup.html?ref=' + encodeURIComponent(code),
    invitedCount: invited.length,
    activatedCount: invited.filter(r => r.activatedAt).length,
  });
});

R('POST', '/app/me/referral/track', async (req, res) => {
  const body = await readJson(req);
  const code = (body?.code || '').trim();
  if (!code) return err(res, 400, 'invalid_input');
  const referrer = db.find('users', u => u.referralCode === code);
  if (!referrer) return send(res, 200, { ok: true });
  await db.insert('referrals', {
    id: S.newId('ref_'),
    referrerId: referrer.id,
    code, ip: clientIp(req),
    ua: req.headers['user-agent'] || null,
    referredUserId: null,
    activatedAt: null,
    createdAt: now(),
  });
  return send(res, 200, { ok: true });
});

// ─── Newsletter signup ────────────────────────────────────────────
R('POST', '/app/newsletter/subscribe', async (req, res) => {
  const body = await readJson(req);
  const email = (body?.email || '').toString().trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return err(res, 400, 'invalid_email');
  }
  const existing = db.find('newsletter', n => n.email === email);
  if (existing) return send(res, 200, { ok: true, already: true });
  await db.insert('newsletter', {
    id: S.newId('nws_'),
    email,
    source: (body?.source || 'web').toString().slice(0, 40),
    ip: clientIp(req),
    ua: (req.headers['user-agent'] || '').slice(0, 200),
    createdAt: now(),
  });
  // Best-effort welcome email; ignored if mailer not configured.
  try {
    const mailer = require('./mailer');
    if (mailer && mailer.send) {
      await mailer.send({
        to: email,
        subject: 'مرحباً بك في نشرة مُرابحة',
        html: '<div style="font-family:Tajawal,sans-serif;direction:rtl;text-align:right;padding:24px;background:#fbf6ea;color:#0d1612;line-height:1.8;"><h1 style="color:#062b1e;">أهلاً بك</h1><p>تم تسجيلك بنجاح في نشرة مُرابحة. سنرسل لك ملخّصاً شهرياً للفرص الجديدة والتحديثات.</p><p style="color:#6b7268;font-size:13px;">إذا لم تسجّل بنفسك، تجاهل هذا البريد.</p></div>',
      });
    }
  } catch (e) {}
  return send(res, 200, { ok: true });
});

R('GET', '/app/admin/newsletter', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const rows = db.all('newsletter').slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return send(res, 200, { subscribers: rows, count: rows.length });
});

// ─── Calendar (.ics) export for upcoming payouts ──────────────────
R('GET', '/app/me/payouts.ics', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const projIdx = Object.fromEntries(db.all('projects').map(p => [p.id, p]));
  const invs = db.filter('investments', i => i.userId === user.id && i.status !== 'canceled');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Murbha//Payouts//AR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:توزيعات مُرابحة',
    'X-WR-TIMEZONE:Asia/Riyadh',
  ];
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => d.getUTCFullYear() + pad(d.getUTCMonth()+1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00Z';
  const escIcs = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const now = new Date();
  for (const inv of invs) {
    const p = projIdx[inv.projectId];
    if (!p) continue;
    const rate = p.profitRate || 0.092;
    const term = p.termMonths || 12;
    const quarters = Math.max(1, Math.round(term / 3));
    const yearlyProfit = (inv.amount || 0) * rate;
    const perQ = yearlyProfit / 4;
    const start = inv.createdAt ? new Date(inv.createdAt) : new Date();
    for (let q = 1; q <= quarters; q++) {
      const d = new Date(start);
      d.setMonth(d.getMonth() + q * 3);
      d.setHours(10, 0, 0, 0);
      const end = new Date(d.getTime() + 60 * 60 * 1000);
      const uid = `payout-${inv.id}-q${q}@murbha`;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${fmt(now)}`,
        `DTSTART:${fmt(d)}`,
        `DTEND:${fmt(end)}`,
        `SUMMARY:${escIcs('توزيع ربعي — ' + p.name + ' (الربع ' + q + ')')}`,
        `DESCRIPTION:${escIcs('توزيع متوقّع: ~' + Math.round(perQ).toLocaleString('ar-SA') + ' ر.س على استثمارك في ' + p.name + '.')}`,
        'STATUS:CONFIRMED',
        'TRANSP:TRANSPARENT',
        'END:VEVENT'
      );
    }
  }
  lines.push('END:VCALENDAR');
  res.writeHead(200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'attachment; filename="murbha-payouts.ics"',
  });
  res.end(lines.join('\r\n'));
});

// ─── User portfolio CSV export ────────────────────────────────────
R('GET', '/app/me/export.csv', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const invs = db.filter('investments', i => i.userId === user.id);
  const txns = db.filter('transactions', t => t.userId === user.id);
  const projIdx = Object.fromEntries(db.all('projects').map(p => [p.id, p]));
  const rows = [['type', 'date', 'id', 'project', 'amount', 'status', 'meta']];
  for (const i of invs.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))) {
    rows.push(['investment', i.createdAt, i.id, projIdx[i.projectId]?.name || '', i.amount || 0, i.status, 'expected=' + (i.expectedReturn || 0)]);
  }
  for (const t of txns.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))) {
    rows.push([t.kind || 'transaction', t.createdAt, t.id, '', t.amount || 0, t.status || 'completed', t.description || '']);
  }
  const csv = rows.map(r => r.map(v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="murbha-${user.id}-${new Date().toISOString().slice(0,10)}.csv"`,
    'Cache-Control': 'no-store',
  });
  res.end('﻿' + csv);
});

// ─── Two-step withdraw confirmation ────────────────────────────────
const WITHDRAW_2STEP_THRESHOLD = 10_000;
R('POST', '/app/portfolio/withdraw/init', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const amount = Number(body?.amount);
  const methodId = (body?.methodId || '').toString();
  if (!(amount > 0) || !methodId) return err(res, 400, 'invalid_input');
  const fresh = db.find('users', u => u.id === user.id);
  if ((fresh.balance || 0) < amount) return err(res, 400, 'insufficient');
  if (amount < WITHDRAW_2STEP_THRESHOLD) {
    return send(res, 200, { requiresConfirmation: false });
  }
  if (!fresh.email) return err(res, 400, 'invalid_input', { field: 'email' });
  const code = genOtp();
  const conf = {
    id: S.newId('wc_'),
    userId: user.id, amount, methodId,
    code, expiresAt: Date.now() + OTP_TTL_MS,
    createdAt: now(), usedAt: null,
  };
  await db.insert('withdrawConfirms', conf);
  const tpl = M.otpTemplate(code, 'تأكيد عملية السحب');
  M.send({ to: fresh.email, subject: `رمز تأكيد السحب: ${code}`, html: tpl.html, text: tpl.text }).catch(() => {});
  return send(res, 200, { requiresConfirmation: true, confirmationId: conf.id, expiresInSec: Math.floor(OTP_TTL_MS / 1000) });
});

R('POST', '/app/portfolio/withdraw/confirm', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const confId = (body?.confirmationId || '').trim();
  const code = (body?.code || '').trim();
  const conf = db.find('withdrawConfirms', c => c.id === confId && c.userId === user.id);
  if (!conf || conf.usedAt || conf.expiresAt < Date.now()) return err(res, 400, 'invalid_token');
  if (conf.code !== code) return err(res, 400, 'invalid_code');
  await db.patch('withdrawConfirms', c => c.id === confId, { usedAt: now() });
  const fresh = db.find('users', u => u.id === user.id);
  if ((fresh.balance || 0) < conf.amount) return err(res, 400, 'insufficient');
  const method = db.find('paymentMethods', m => m.id === conf.methodId && m.userId === user.id && !m.removedAt);
  if (!method || method.type !== 'iban') return err(res, 404, 'not_found');
  await db.update(d => {
    const u = d.users.find(x => x.id === user.id);
    u.balance -= conf.amount;
    d.transactions.push({
      id: S.newId('txn_'),
      userId: user.id, kind: 'withdraw',
      amount: -conf.amount, ref: 'po_2step_' + require('crypto').randomBytes(6).toString('hex'),
      methodId: conf.methodId, methodLabel: 'IBAN ' + (method.ibanMasked || ''),
      status: 'pending', description: 'سحب إلى ' + method.ibanMasked + ' (مع تأكيد OTP)',
      createdAt: now(),
    });
  });
  await notify(user.id, 'withdraw', 'تم تقديم طلب السحب',
    `سيتم تحويل ${conf.amount.toLocaleString('ar-SA')} ر.س. إلى حسابك خلال ١-٣ أيام عمل.`);
  return send(res, 200, { balance: db.find('users', u => u.id === user.id).balance });
});

// ─── SSE events stream ─────────────────────────────────────────────
R('GET', '/app/events', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (payload) => {
    res.write(`event: ${payload.event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  // Initial hello so the client knows it's connected.
  res.write('retry: 5000\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, at: Date.now() })}\n\n`);
  const release = EV.subscribe(user.id, send, { isAdmin: user.role === 'admin' });
  // Keepalive ping every 25s so proxies don't drop the connection.
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(ping); release(); });
});

// ─── Public deal ticker (anonymized recent investments) ──────────
R('GET', '/app/public/activity', async (req, res) => {
  const projIdx = Object.fromEntries(db.all('projects').map(p => [p.id, p]));
  const events = [];
  db.all('investments').filter(i => i.createdAt && i.status !== 'canceled').slice(-30).forEach(i => {
    const u = db.find('users', x => x.id === i.userId);
    const initial = ((u?.name || 'م').trim()[0] || 'م');
    events.push({
      kind: 'investment',
      initial,
      title: 'استثمار جديد',
      detail: `بقيمة ${(i.amount || 0).toLocaleString('ar-SA')} ر.س في ${projIdx[i.projectId]?.name || '—'}`,
      at: i.createdAt,
    });
  });
  db.all('projects').filter(p => p.fundedAmount && p.targetAmount && p.fundedAmount >= p.targetAmount).slice(-5).forEach(p => {
    events.push({
      kind: 'completed',
      initial: '✓',
      title: 'صفقة مكتملة',
      detail: `${p.name} وصلت إلى نسبة التمويل الكاملة`,
      at: p.completedAt || p.createdAt,
    });
  });
  db.all('contracts').filter(c => c.signedAt).slice(-10).forEach(c => {
    events.push({
      kind: 'signed',
      initial: '✎',
      title: 'توقيع عقد',
      detail: `بقيمة ${(c.amount || 0).toLocaleString('ar-SA')} ر.س`,
      at: c.signedAt,
    });
  });
  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  res.setHeader('Cache-Control', 'public, max-age=30');
  return send(res, 200, { events: events.slice(0, 20) });
});

R('GET', '/app/public/ticker', async (req, res) => {
  const projIdx = Object.fromEntries(db.all('projects').map(p => [p.id, p]));
  const invs = db.all('investments')
    .filter(i => i.status !== 'canceled' && i.createdAt)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 12)
    .map(i => {
      const u = db.find('users', x => x.id === i.userId);
      const name = u?.name || 'مستثمر';
      const anon = name.split(' ').filter(Boolean).map((w, idx) => idx === 0 ? w : (w[0] + '.')).join(' ');
      return {
        investor: anon,
        amount: i.amount || 0,
        project: projIdx[i.projectId]?.name || '—',
        at: i.createdAt,
      };
    });
  res.setHeader('Cache-Control', 'public, max-age=20');
  return send(res, 200, { ticker: invs });
});

// ─── Project Q&A ───────────────────────────────────────────────────
R('GET', /^\/app\/projects\/([^/]+)\/questions$/, async (req, res, m) => {
  const project = db.find('projects', p => p.id === m[1] || p.slug === m[1]);
  if (!project) return err(res, 404, 'not_found');
  const userIdx = Object.fromEntries(db.all('users').map(u => [u.id, u]));
  const list = db.filter('projectQuestions', q => q.projectId === project.id && q.publishedAt)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(q => ({
      id: q.id,
      question: q.question,
      answer: q.answer,
      askerName: userIdx[q.userId]?.name || 'مستثمر',
      answeredAt: q.answeredAt,
      createdAt: q.createdAt,
    }));
  return send(res, 200, { questions: list });
});

R('POST', /^\/app\/projects\/([^/]+)\/questions$/, async (req, res, m) => {
  const user = requireAuth(req, res); if (!user) return;
  const project = db.find('projects', p => p.id === m[1] || p.slug === m[1]);
  if (!project) return err(res, 404, 'not_found');
  const body = await readJson(req);
  const question = (body?.question || '').trim().slice(0, 800);
  if (question.length < 5) return err(res, 400, 'invalid_input');
  const q = {
    id: S.newId('q_'),
    projectId: project.id,
    userId: user.id,
    question,
    answer: null,
    answeredBy: null,
    answeredAt: null,
    publishedAt: null,
    createdAt: now(),
  };
  await db.insert('projectQuestions', q);
  await notify(user.id, 'question_received', 'استلمنا سؤالك',
    'سيتم الرد على سؤالك خلال 24-48 ساعة من فريق الدعم.');
  // Notify admins
  for (const a of db.filter('users', u => u.role === 'admin')) {
    await notify(a.id, 'new_question', `سؤال جديد على ${project.name}`,
      'يرجى الإجابة من لوحة التحكم.', { questionId: q.id });
  }
  return send(res, 201, { ok: true, questionId: q.id });
});

R('GET', '/app/admin/questions', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const params = new URL(req.url, 'http://x').searchParams;
  const status = params.get('status'); // pending / answered
  const userIdx = Object.fromEntries(db.all('users').map(u => [u.id, u]));
  const projIdx = Object.fromEntries(db.all('projects').map(p => [p.id, p]));
  let list = db.all('projectQuestions');
  if (status === 'pending')  list = list.filter(q => !q.answer);
  if (status === 'answered') list = list.filter(q => !!q.answer);
  list = list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(q => ({
      ...q,
      askerName: userIdx[q.userId]?.name || '—',
      askerEmail: userIdx[q.userId]?.email || null,
      projectName: projIdx[q.projectId]?.name || '—',
    }));
  return send(res, 200, { questions: list });
});

R('POST', /^\/app\/admin\/questions\/([^/]+)\/answer$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const answer = (body?.answer || '').trim().slice(0, 2000);
  const publish = body?.publish !== false; // default true
  if (answer.length < 2) return err(res, 400, 'invalid_input');
  const q = db.find('projectQuestions', x => x.id === m[1]);
  if (!q) return err(res, 404, 'not_found');
  await db.patch('projectQuestions', x => x.id === m[1], {
    answer, answeredBy: admin.id, answeredAt: now(),
    publishedAt: publish ? now() : null,
  });
  await audit(admin.id, 'question.answer', m[1], { publish }, req);
  await notify(q.userId, 'question_answered', 'تم الرد على سؤالك',
    'يمكنك مراجعة الإجابة على صفحة المشروع.');
  return send(res, 200, { ok: true });
});

// ─── Risk profile quiz ─────────────────────────────────────────────
// 5-question Likert scale → conservative | moderate | aggressive.
R('POST', '/app/me/risk-profile', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const answers = body?.answers;
  if (!Array.isArray(answers) || answers.length !== 5) return err(res, 400, 'invalid_input');
  for (const a of answers) {
    const v = Number(a);
    if (!Number.isFinite(v) || v < 1 || v > 5) return err(res, 400, 'invalid_input');
  }
  const score = answers.reduce((s, a) => s + Number(a), 0); // 5–25
  const profile = score <= 11 ? 'conservative' : score <= 18 ? 'moderate' : 'aggressive';
  await db.patch('users', u => u.id === user.id, {
    riskProfile: { score, profile, answers, takenAt: now() },
  });
  return send(res, 200, { score, profile });
});

R('GET', '/app/me/risk-profile', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const fresh = db.find('users', u => u.id === user.id);
  return send(res, 200, { profile: fresh?.riskProfile || null });
});

// ─── Activity timeline ─────────────────────────────────────────────
R('GET', '/app/me/activity', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const events = [];
  const invs = db.filter('investments', i => i.userId === user.id);
  invs.forEach(i => events.push({ kind: 'investment', title: 'استثمار جديد', meta: 'بقيمة ' + (i.amount || 0).toLocaleString('ar-SA') + ' ر.س.', at: i.createdAt }));
  const sigs = db.filter('signingRecords', s => s.userId === user.id);
  sigs.forEach(s => events.push({ kind: 'signing', title: 'توقيع عقد مرابحة', meta: 'بقيمة ' + (s.amount || 0).toLocaleString('ar-SA') + ' ر.س.', at: s.signedAt }));
  const txns = db.filter('transactions', t => t.userId === user.id);
  txns.forEach(t => events.push({ kind: t.kind || 'transaction', title: t.description || (t.kind === 'deposit' ? 'إيداع' : 'سحب'), meta: (t.amount > 0 ? '+' : '') + (t.amount || 0).toLocaleString('ar-SA') + ' ر.س.', at: t.createdAt, status: t.status }));
  const fresh = db.find('users', u => u.id === user.id);
  if (fresh?.createdAt) events.push({ kind: 'registered', title: 'انضمام إلى المنصّة', at: fresh.createdAt });
  if (fresh?.totpEnrolledAt) events.push({ kind: 'security', title: 'تفعيل المصادقة الثنائية', at: fresh.totpEnrolledAt });
  if (fresh?.riskProfile?.takenAt) events.push({ kind: 'profile', title: 'ملف المخاطر: ' + fresh.riskProfile.profile, at: fresh.riskProfile.takenAt });
  const recentLogins = db.filter('loginAttempts', a => a.userId === user.id && a.success).slice(-3);
  recentLogins.forEach(a => events.push({ kind: 'login', title: 'تسجيل دخول', meta: a.ip || null, at: a.createdAt }));
  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  return send(res, 200, { events: events.slice(0, 50) });
});

// ─── Webhooks (admin manages outbound subscriptions) ──────────────
R('GET', '/app/admin/webhooks', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const list = (db.all('webhooks') || []).map(w => ({
    id: w.id, url: w.url, events: w.events,
    description: w.description || null,
    secretPreview: w.secret ? w.secret.slice(0, 8) + '...' : null,
    disabledAt: w.disabledAt, lastDeliveredAt: w.lastDeliveredAt || null,
    lastStatus: w.lastStatus || null, createdAt: w.createdAt,
  }));
  return send(res, 200, { webhooks: list, allowedEvents: WH.ALLOWED_EVENTS });
});

R('POST', '/app/admin/webhooks', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const url = (body?.url || '').trim();
  const events = Array.isArray(body?.events) ? body.events.filter(e => WH.ALLOWED_EVENTS.includes(e)) : [];
  const description = (body?.description || '').trim().slice(0, 200) || null;
  if (!/^https?:\/\//i.test(url)) return err(res, 400, 'invalid_input', { field: 'url' });
  if (!events.length) return err(res, 400, 'invalid_input', { field: 'events' });
  const secret = require('crypto').randomBytes(24).toString('hex');
  const hook = {
    id: S.newId('wh_'), url, events, description, secret,
    createdBy: admin.id, createdAt: now(), disabledAt: null,
    lastDeliveredAt: null, lastStatus: null,
  };
  await db.insert('webhooks', hook);
  await audit(admin.id, 'webhook.create', hook.id, { url, events }, req);
  // Return the secret ONCE so admin can copy it
  return send(res, 201, { webhook: { ...hook, secret } });
});

R('DELETE', /^\/app\/admin\/webhooks\/([^/]+)$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const w = db.find('webhooks', x => x.id === m[1]);
  if (!w) return err(res, 404, 'not_found');
  await db.remove('webhooks', x => x.id === m[1]);
  await audit(admin.id, 'webhook.delete', m[1], { url: w.url }, req);
  return send(res, 200, { ok: true });
});

R('POST', /^\/app\/admin\/webhooks\/([^/]+)\/test$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const w = db.find('webhooks', x => x.id === m[1]);
  if (!w) return err(res, 404, 'not_found');
  WH.dispatch(db, w.events[0] || 'user.registered', { test: true, at: now() });
  return send(res, 200, { ok: true });
});

// ─── Favorites (saved projects per user) ─────────────────────────
R('GET', '/app/me/favorites', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const fresh = db.find('users', u => u.id === user.id);
  const ids = fresh.favorites || [];
  const projects = db.all('projects').filter(p => ids.includes(p.id));
  return send(res, 200, { ids, projects });
});

R('POST', '/app/me/favorites/toggle', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const id = (body?.projectId || '').toString();
  if (!id) return err(res, 400, 'invalid_input');
  const project = db.find('projects', p => p.id === id || p.slug === id);
  if (!project) return err(res, 404, 'not_found');
  const fresh = db.find('users', u => u.id === user.id);
  const set = new Set(fresh.favorites || []);
  if (set.has(project.id)) set.delete(project.id);
  else set.add(project.id);
  await db.patch('users', u => u.id === user.id, { favorites: [...set] });
  return send(res, 200, { ids: [...set], saved: set.has(project.id) });
});

// ─── 2FA backup codes ───────────────────────────────────────────
const _hashCode = (s) => require('crypto').createHash('sha256').update(s).digest('hex');
const _genBackupCode = () => {
  const c = require('crypto').randomBytes(5).toString('hex').toUpperCase();
  return c.slice(0, 5) + '-' + c.slice(5);
};

R('POST', '/app/admin/2fa/backup-codes/generate', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const fresh = db.find('users', u => u.id === admin.id);
  if (!fresh.totpEnrolled) return err(res, 400, 'invalid_input');
  const codes = [];
  const hashes = [];
  for (let i = 0; i < 8; i++) {
    const c = _genBackupCode();
    codes.push(c);
    hashes.push(_hashCode(c));
  }
  await db.patch('users', u => u.id === admin.id, { backupCodes: hashes });
  await audit(admin.id, 'admin.2fa.backup-codes.generate', admin.id, { count: 8 }, req);
  return send(res, 200, { codes });
});

// ─── Admin bulk-message (email blast) ────────────────────────────
const _audienceFilter = (audience, users) => {
  switch (audience) {
    case 'approved':   return users.filter(u => u.approved && !u.rejected);
    case 'pending':    return users.filter(u => !u.approved && !u.rejected && u.role !== 'admin');
    case 'qualified':  return users.filter(u => (u.investorClass || 'retail') === 'qualified');
    default:           return users.filter(u => u.role !== 'admin');
  }
};
R('POST', '/app/admin/blast/preview', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const audience = (body?.audience || 'all').toString();
  const list = _audienceFilter(audience, db.all('users')).filter(u => u.email);
  return send(res, 200, { count: list.length });
});
R('POST', '/app/admin/blast/send', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const audience = (body?.audience || 'all').toString();
  const subject = (body?.subject || '').trim().slice(0, 200);
  const text    = (body?.body    || '').trim().slice(0, 10_000);
  if (!subject || !text) return err(res, 400, 'invalid_input');
  const list = _audienceFilter(audience, db.all('users')).filter(u => u.email);
  const html = '<div style="font-family:Tajawal,Cairo,sans-serif;direction:rtl;line-height:1.7;font-size:15px;">' + text.replace(/\n/g, '<br>') + '</div>';
  let sent = 0;
  for (const u of list) {
    const r = await M.send({ to: u.email, subject, text, html });
    if (r.ok) sent++;
  }
  await audit(admin.id, 'blast.send', audience, { subject, sent }, req);
  return send(res, 200, { ok: true, sent, total: list.length });
});

// ─── Webhook delivery logs ───────────────────────────────────────
R('GET', /^\/app\/admin\/webhooks\/([^/]+)\/deliveries$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const w = db.find('webhooks', x => x.id === m[1]);
  if (!w) return err(res, 404, 'not_found');
  // Webhook deliveries we kept on the row: last-status, last-delivered-at,
  // last-error. The dispatcher in lib/webhooks.js currently records only
  // the most recent; expose a tiny snapshot here for the UI.
  return send(res, 200, {
    webhook: { id: w.id, url: w.url, events: w.events },
    lastDeliveredAt: w.lastDeliveredAt || null,
    lastStatus: w.lastStatus || null,
    lastDeliveryError: w.lastDeliveryError || null,
  });
});

// ─── Profile picture upload (avatar) ─────────────────────────────
R('POST', '/app/me/avatar', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const data = body?.data || '';
  const result = U.persist(user.id, 'avatar', data);
  if (!result.ok) {
    return send(res, 400, { error: result.error, message: ARABIC[result.error] || 'فشل رفع الصورة.' });
  }
  // Remove old avatar if any
  const fresh = db.find('users', u => u.id === user.id);
  if (fresh.avatarPath) U.remove(fresh.avatarPath);
  await db.patch('users', u => u.id === user.id, { avatarPath: result.relPath, avatarMime: result.mime });
  return send(res, 200, { ok: true, url: '/app/me/avatar', mime: result.mime });
});

R('GET', '/app/me/avatar', async (req, res) => {
  const auth = S.currentUser(req); if (!auth) return err(res, 401, 'unauthorized');
  const fresh = db.find('users', u => u.id === auth.id);
  if (!fresh?.avatarPath) return err(res, 404, 'not_found');
  const s = U.stream(fresh.avatarPath);
  if (!s) return err(res, 404, 'not_found');
  res.writeHead(200, { 'Content-Type': fresh.avatarMime || 'image/jpeg', 'Cache-Control': 'private, max-age=300' });
  s.stream.pipe(res);
});

// ─── Per-user activity (admin view) ───────────────────────────────
R('GET', /^\/app\/admin\/users\/([^/]+)\/activity$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const userId = m[1];
  const user = db.find('users', u => u.id === userId);
  if (!user) return err(res, 404, 'not_found');
  const events = [];
  events.push({ kind: 'registered', title: 'انضمام إلى المنصّة', at: user.createdAt });
  if (user.approved) events.push({ kind: 'approved', title: 'تمت الموافقة على الحساب', at: user.approvedAt || user.createdAt });
  if (user.rejected) events.push({ kind: 'rejected', title: 'تم رفض الحساب', meta: user.rejectedReason || null, at: user.rejectedAt });
  if (user.totpEnrolledAt) events.push({ kind: 'security', title: 'تفعيل المصادقة الثنائية', at: user.totpEnrolledAt });
  if (user.deletionRequestedAt) events.push({ kind: 'deletion', title: 'طلب حذف الحساب', at: user.deletionRequestedAt });
  db.filter('investments', i => i.userId === userId).forEach(i => events.push({ kind: 'investment', title: 'استثمار', meta: (i.amount || 0).toLocaleString('ar-SA') + ' ر.س', at: i.createdAt }));
  db.filter('signingRecords', s => s.userId === userId).forEach(s => events.push({ kind: 'signing', title: 'توقيع عقد', meta: (s.amount || 0).toLocaleString('ar-SA') + ' ر.س · hash=' + (s.signatureHash || '').slice(0,12), at: s.signedAt }));
  db.filter('transactions', t => t.userId === userId).forEach(t => events.push({ kind: t.kind || 'transaction', title: t.description || t.kind, meta: (t.amount || 0).toLocaleString('ar-SA') + ' ر.س' + (t.status ? ' · ' + t.status : ''), at: t.createdAt }));
  db.filter('auditLog', e => e.target === userId).forEach(e => events.push({ kind: 'audit', title: e.action, meta: 'بواسطة ' + (e.actorId || ''), at: e.createdAt }));
  db.filter('loginAttempts', a => a.userId === userId).slice(-10).forEach(a => events.push({ kind: a.success ? 'login_success' : 'login_fail', title: a.success ? 'تسجيل دخول' : 'محاولة فاشلة', meta: (a.ip || '') + (a.reason ? ' · ' + a.reason : ''), at: a.createdAt }));
  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  return send(res, 200, { events: events.slice(0, 200) });
});

// ─── Reports (admin only) ──────────────────────────────────────────
R('GET', '/app/admin/reports', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const users    = db.all('users');
  const projects = db.all('projects');
  const invs     = db.all('investments');
  const txns     = db.all('transactions');

  const byUser = new Map();
  for (const i of invs) {
    if (!byUser.has(i.userId)) byUser.set(i.userId, { userId: i.userId, count: 0, total: 0 });
    const e = byUser.get(i.userId);
    e.count += 1; e.total += (i.amount || 0);
  }
  const topInvestors = [...byUser.values()]
    .sort((a, b) => b.total - a.total).slice(0, 10)
    .map(e => { const u = users.find(x => x.id === e.userId) || {}; return { userId: e.userId, name: u.name, email: u.email, ...e }; });

  const days30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const projectStats = projects.map(p => {
    const projInvs = invs.filter(i => i.projectId === p.id);
    const recent = projInvs.filter(i => new Date(i.createdAt).getTime() > days30);
    return {
      id: p.id, slug: p.slug, name: p.name,
      goal: p.goal, raised: p.raised, fundedPct: p.goal > 0 ? Math.round((p.raised / p.goal) * 100) : 0,
      investorCount: projInvs.length,
      raisedLast30d: recent.reduce((s, i) => s + (i.amount || 0), 0),
      status: p.status,
    };
  }).sort((a, b) => b.raised - a.raised);

  const kycSteps = ['pending', 'email_verified', 'mobile_verified', 'id_verified', 'verified'];
  const kycFunnel = kycSteps.map(k => ({ step: k, count: users.filter(u => (u.kycStatus || 'pending') === k && u.role !== 'admin').length }));

  const awaitingApproval = users.filter(u => u.role !== 'admin' && !u.approved && !u.rejected && u.kycStatus === 'verified').length;

  const recentTxns = txns.filter(t => new Date(t.createdAt).getTime() > days30);
  const depositsLast30 = recentTxns.filter(t => t.kind === 'deposit'  && (t.status || 'completed') === 'completed').reduce((s, t) => s + Math.abs(t.amount || 0), 0);
  const withdrawsLast30 = recentTxns.filter(t => t.kind === 'withdraw').reduce((s, t) => s + Math.abs(t.amount || 0), 0);
  const investsLast30  = invs.filter(i => new Date(i.createdAt).getTime() > days30).reduce((s, i) => s + (i.amount || 0), 0);

  return send(res, 200, {
    generatedAt: now(),
    topInvestors,
    projectStats,
    kycFunnel,
    awaitingApproval,
    cashFlow30d: { deposits: depositsLast30, withdraws: withdrawsLast30, invests: investsLast30 },
  });
});

// ─── System health (admin only) ─────────────────────────────────
const _bootTime = Date.now();
const _fs = require('fs');
const _path = require('path');

R('GET', '/app/admin/health', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const data = db.get();
  const counts = {
    users:         (data.users || []).length,
    projects:      (data.projects || []).length,
    investments:   (data.investments || []).length,
    contracts:     (data.contracts || []).length,
    transactions:  (data.transactions || []).length,
    paymentMethods:(data.paymentMethods || []).filter(m => !m.removedAt).length,
    pushSubs:      (data.pushSubscriptions || []).length,
    signingRecords:(data.signingRecords || []).length,
    auditLog:      (data.auditLog || []).length,
  };
  let dbBackend = process.env.DATABASE_URL ? 'postgres' : 'json';
  let dbSizeBytes = null;
  try {
    const dbFile = _path.join(process.env.MURBHA_DATA_DIR || _path.join(__dirname, '..', 'data'), 'db.json');
    if (_fs.existsSync(dbFile)) dbSizeBytes = _fs.statSync(dbFile).size;
  } catch {}
  const lastOtp = (data.users || [])
    .map(u => Math.max(u.emailOtp?.sentAt || 0, u.mobileOtp?.sentAt || 0))
    .reduce((a, b) => Math.max(a, b), 0) || null;
  return send(res, 200, {
    counts, dbBackend, dbSizeBytes,
    uptimeSec: Math.floor((Date.now() - _bootTime) / 1000),
    nodeVersion: process.version,
    bootAt: new Date(_bootTime).toISOString(),
    providers: {
      mail:      process.env.RESEND_API_KEY ? 'resend' : 'mock',
      sms:       process.env.SMS_PROVIDER || 'mock',
      payments:  process.env.PAYMENT_PROVIDER || 'mock',
      sanctions: process.env.SANCTIONS_PROVIDER || 'mock',
      push:      PUSH.isConfigured() ? 'configured' : 'dry-run',
    },
    lastOtpSentAt: lastOtp ? new Date(lastOtp).toISOString() : null,
  });
});

R('GET', '/app/admin/signing-records', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const limit = Math.min(parseInt(new URL(req.url, 'http://x').searchParams.get('limit') || '100', 10), 1000);
  const list = db.all('signingRecords').sort((a, b) => new Date(b.signedAt) - new Date(a.signedAt)).slice(0, limit);
  return send(res, 200, { records: list });
});

R('POST', /^\/app\/contracts\/([^/]+)\/pay$/, async (req, res, m) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const method = (body?.method || 'mada').toString();

  const c = db.find('contracts', x => x.id === m[1] && x.userId === user.id);
  if (!c) return err(res, 404, 'not_found');
  if (c.status === 'active') return send(res, 200, { contract: c, alreadyPaid: true });
  if (c.status !== 'signed') return err(res, 400, 'invalid_input');

  const project = db.find('projects', p => p.id === c.projectId);
  if (!project) return err(res, 404, 'not_found');

  const fresh = db.find('users', u => u.id === user.id);
  if (method === 'wallet') {
    if ((fresh.balance || 0) < c.amount) {
      return err(res, 400, 'insufficient');
    }
  }

  await db.update(d => {
    const ct = d.contracts.find(x => x.id === c.id);
    ct.status = 'active';
    const inv = d.investments.find(x => x.id === ct.investmentId);
    inv.status = 'active';
    
    const proj = d.projects.find(p => p.id === ct.projectId);
    proj.raised = (proj.raised || 0) + ct.amount;
    proj.investorCount = (proj.investorCount || 0) + 1;

    if (method === 'wallet') {
      const u = d.users.find(x => x.id === user.id);
      u.balance -= ct.amount;
      d.transactions.push({
        id: S.newId('txn_'),
        userId: user.id,
        kind: 'invest_confirm',
        amount: -ct.amount,
        ref: ct.investmentId,
        description: `تأكيد استثمار في ${proj.name} (محفظة)`,
        createdAt: now(),
      });
    } else {
      d.transactions.push({
        id: S.newId('txn_'),
        userId: user.id,
        kind: 'invest_confirm',
        amount: 0,
        ref: ct.investmentId,
        description: `تأكيد استثمار في ${proj.name} (عبر ${method})`,
        createdAt: now(),
      });
    }
  });

  console.log(`
========================================================================
📧 [SIMULATED EMAIL SENT]
To: ${user.email || 'demo@murabaha.sa'}
Subject: تم استلام دفعة استثمارك وتفعيل العقد بنجاح - ${project.name}
Body:
عزيزنا المستثمر ${user.name}،
تم بنجاح استلام مبلغ استثماركم وقدره ${c.amount.toLocaleString('ar-SA')} ر.س.
عبر طريقة الدفع: ${method === 'wallet' ? 'رصيد المحفظة' : method}
وتم تفعيل عقد المرابحة رقم ${c.id} الخاص بمشروع:
"${project.name}"
تاريخ التنشيط والدفع: ${now()}
حالة العقد: موثّق ومفعّل ✓
يمكنك الاطلاع على مستندات العقد ومتابعة أداء محفظتك عبر بوابة العميل.

منصة مرابحة الاستثمارية.
========================================================================
`);

  await notify(user.id, 'payment_completed', 'تم تفعيل الاستثمار بنجاح',
    `تم استلام دفعة استثمارك في ${project.name} وتفعيل عقدك.`, { contractId: c.id });

  const updated = db.find('contracts', x => x.id === c.id);
  return send(res, 200, { contract: updated });
});

const kycStepErr = (res) => send(res, 409, {
  error: 'kyc_out_of_order',
  message: 'يجب إكمال خطوات التحقق بالترتيب.',
});

R('POST', '/app/auth/verify-email', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const fresh = db.find('users', u => u.id === user.id);
  if (fresh.kycStatus !== 'pending' && fresh.kycStatus !== 'email_pending') return kycStepErr(res);
  const body = await readJson(req);
  const code = (body?.code || '').trim();
  if (!fresh.emailOtp || otpExpired(fresh.emailOtp)) {
    return send(res, 400, { error: 'otp_expired', message: 'انتهت صلاحية الرمز. يرجى طلب رمز جديد.' });
  }
  if (code !== fresh.emailOtp.code) {
    return send(res, 400, { error: 'invalid_code', message: 'رمز التحقق من البريد الإلكتروني غير صحيح' });
  }

  await db.patch('users', u => u.id === user.id, { kycStatus: 'email_verified', emailOtp: null });
  return send(res, 200, { success: true });
});

R('POST', '/app/auth/verify-mobile', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const fresh = db.find('users', u => u.id === user.id);
  if (fresh.kycStatus !== 'email_verified' && fresh.kycStatus !== 'mobile_pending') return kycStepErr(res);
  const body = await readJson(req);
  const code = (body?.code || '').trim();
  if (!fresh.mobileOtp || otpExpired(fresh.mobileOtp)) {
    return send(res, 400, { error: 'otp_expired', message: 'انتهت صلاحية الرمز. يرجى طلب رمز جديد.' });
  }
  if (code !== fresh.mobileOtp.code) {
    return send(res, 400, { error: 'invalid_code', message: 'رمز التحقق من رقم الجوال غير صحيح' });
  }

  await db.patch('users', u => u.id === user.id, { kycStatus: 'mobile_verified', mobileOtp: null });
  return send(res, 200, { success: true });
});

R('POST', '/app/auth/resend-otp', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const channel = (body?.channel || 'email').trim();
  const fresh = db.find('users', u => u.id === user.id);
  // throttle: 60s between resends per channel
  const lastSent = (channel === 'email' ? fresh.emailOtp?.sentAt : fresh.mobileOtp?.sentAt) || 0;
  if (Date.now() - lastSent < 60_000) {
    return send(res, 429, { error: 'rate_limited', message: 'يرجى الانتظار قبل طلب رمز جديد.' });
  }
  const code = genOtp();
  const otp = { code, expiresAt: Date.now() + OTP_TTL_MS, sentAt: Date.now() };
  if (channel === 'email') {
    if (!fresh.email) return err(res, 400, 'invalid_input', { field: 'email' });
    await db.patch('users', u => u.id === user.id, { emailOtp: otp });
    const tpl = M.otpTemplate(code, 'البريد الإلكتروني');
    M.send({ to: fresh.email, subject: `رمز التحقق: ${code}`, html: tpl.html, text: tpl.text }).catch(()=>{});
  } else if (channel === 'mobile') {
    if (!fresh.phone) return err(res, 400, 'invalid_input', { field: 'phone' });
    await db.patch('users', u => u.id === user.id, { mobileOtp: otp });
    SMS.send({ to: fresh.phone, text: SMS.otpTemplate(code) }).catch(() => {});
  } else {
    return err(res, 400, 'invalid_input', { field: 'channel' });
  }
  return send(res, 200, { success: true, expiresInSec: Math.floor(OTP_TTL_MS / 1000) });
});

R('POST', '/app/auth/verify-id', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const fresh = db.find('users', u => u.id === user.id);
  if (fresh.kycStatus !== 'mobile_verified' && fresh.kycStatus !== 'id_pending') return kycStepErr(res);
  const body = await readJson(req);
  const nationalId = (body?.nationalId || '').trim();
  if (!/^[12]\d{9}$/.test(nationalId)) {
    return send(res, 400, { error: 'invalid_id', message: 'رقم الهوية الوطنية أو الإقامة غير صحيح' });
  }
  if (!fresh.kycDocs?.id_front || !fresh.kycDocs?.selfie) {
    return send(res, 400, { error: 'missing_documents', message: 'يرجى رفع صورة الهوية وصورة شخصية (سيلفي) قبل المتابعة.' });
  }
  const taken = db.find('users', u => u.nationalId === nationalId && u.id !== user.id);
  if (taken) {
    return send(res, 409, { error: 'id_taken', message: 'رقم الهوية مُسجّل بحساب آخر.' });
  }

  await db.patch('users', u => u.id === user.id, { nationalId, kycStatus: 'id_verified' });
  return send(res, 200, { success: true });
});

// Upload a KYC document (base64-encoded). Validates magic bytes server-side.
R('POST', '/app/auth/kyc/upload', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const kind = (body?.kind || '').trim();
  const data = body?.data || '';
  if (!U.ALLOWED_KINDS.has(kind)) return err(res, 400, 'invalid_input', { field: 'kind' });

  const result = U.persist(user.id, kind, data);
  if (!result.ok) {
    return send(res, 400, { error: result.error, message: ARABIC[result.error] || 'فشل رفع الملف.' });
  }
  // Replace any previously uploaded file of the same kind
  const fresh = db.find('users', u => u.id === user.id);
  const prev = fresh.kycDocs?.[kind];
  if (prev?.path) U.remove(prev.path);
  await db.update(d => {
    const u = d.users.find(x => x.id === user.id);
    u.kycDocs = u.kycDocs || {};
    u.kycDocs[kind] = { path: result.relPath, size: result.size, mime: result.mime, uploadedAt: now() };
  });
  return send(res, 200, { ok: true, size: result.size, mime: result.mime });
});

// Stream a KYC document. Owner OR admin only.
R('GET', /^\/app\/auth\/kyc\/file\/([a-z_]+)$/, async (req, res, m) => {
  const auth = S.currentUser(req);
  if (!auth) return err(res, 401, 'unauthorized');
  const kind = m[1];
  const targetUserId = new URL(req.url, 'http://x').searchParams.get('userId') || auth.id;
  if (targetUserId !== auth.id && auth.role !== 'admin') return err(res, 403, 'unauthorized');
  const target = db.find('users', u => u.id === targetUserId);
  if (!target) return err(res, 404, 'not_found');
  const doc = target.kycDocs?.[kind];
  if (!doc?.path) return err(res, 404, 'not_found');
  const s = U.stream(doc.path);
  if (!s) return err(res, 404, 'not_found');
  res.writeHead(200, { 'Content-Type': doc.mime || 'application/octet-stream', 'Cache-Control': 'private, no-store' });
  s.stream.pipe(res);
});

R('POST', '/app/auth/verify-address', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const fresh = db.find('users', u => u.id === user.id);
  if (fresh.kycStatus !== 'id_verified' && fresh.kycStatus !== 'address_pending') return kycStepErr(res);
  const body = await readJson(req);
  if (!body?.buildingNo || !body?.postalCode || !body?.streetName || !body?.district || !body?.city) {
    return send(res, 400, { error: 'invalid_address', message: 'يرجى ملء جميع الحقول المطلوبة للعنوان الوطني' });
  }

  await db.patch('users', u => u.id === user.id, { kycStatus: 'verified' });
  WH.dispatch(db, 'kyc.completed', { userId: user.id, name: fresh.name, email: fresh.email });
  // Sanctions / PEP screening — fire-and-store; admin alert on hits.
  SAN.screen({ name: fresh.name, nationality: 'SA' }).then(async (result) => {
    await db.patch('users', u => u.id === user.id, { sanctionsScreen: result });
    if (!result.clean) {
      WH.dispatch(db, 'sanctions.hit', { userId: user.id, name: fresh.name, hits: result.hits });
      const admins = db.filter('users', u => u.role === 'admin');
      for (const a of admins) {
        await notify(a.id, 'sanctions_hit', `⚠️ مطابقة محتملة في قوائم الحظر — ${fresh.name}`,
          `تطابقت بيانات المستخدم ${fresh.name} مع ${result.hits.length} مدخل/مدخلات في قوائم الحظر/PEP (${result.provider}). يرجى المراجعة قبل الموافقة على الحساب.`);
      }
    }
  }).catch(err => console.error('[sanctions] screen failed:', err.message));
  await notify(user.id, 'kyc_completed', 'اكتمل التحقق من الهوية والعنوان الوطني',
    'تم استلام بيانات التحقق بنجاح وهي قيد المراجعة والموافقة من الإدارة.');
  return send(res, 200, { success: true });
});

// ============================================================
//  PORTFOLIO
// ============================================================

R('GET', '/app/portfolio', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const fresh = db.find('users', u => u.id === user.id);

  const investments = db.filter('investments', i => i.userId === user.id).map(inv => {
    const project = db.find('projects', p => p.id === inv.projectId);
    return { 
      ...inv, 
      project: project ? { 
        id: project.id, 
        name: project.name, 
        slug: project.slug, 
        status: project.status, 
        profitRate: project.profitRate, 
        termMonths: project.termMonths,
        extendable: project.extendable,
        updates: project.updates || []
      } : null 
    };
  });
  const transactions = db.filter('transactions', t => t.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const totals = investments.reduce((a, i) => {
    if (i.status === 'active' || i.status === 'completed') {
      a.invested += i.amount;
      a.expectedReturn += i.expectedReturn;
    }
    return a;
  }, { invested: 0, expectedReturn: 0 });

  return send(res, 200, {
    balance: fresh.balance || 0,
    invested: totals.invested,
    expectedReturn: totals.expectedReturn,
    expectedProfit: totals.expectedReturn - totals.invested,
    investments,
    transactions: transactions.slice(0, 50),
  });
});

// ============================================================
//  PAYMENT METHODS  (cards + IBANs; provider-abstracted)
// ============================================================

const publicPaymentMethod = (m) => ({
  id: m.id,
  type: m.type,
  brand: m.brand || null,
  last4: m.last4 || null,
  ibanMasked: m.ibanMasked || null,
  holder: m.holder || null,
  expMonth: m.expMonth || null,
  expYear: m.expYear || null,
  isDefault: !!m.isDefault,
  createdAt: m.createdAt,
});

R('GET', '/app/payment-methods', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const list = db.filter('paymentMethods', m => m.userId === user.id && !m.removedAt)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || new Date(b.createdAt) - new Date(a.createdAt))
    .map(publicPaymentMethod);
  return send(res, 200, { methods: list });
});

R('POST', '/app/payment-methods', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const type = (body?.type || '').toString();
  if (type !== 'card' && type !== 'iban') return err(res, 400, 'invalid_input', { field: 'type' });

  let method;
  if (type === 'card') {
    const result = await Promise.resolve(P.provider().tokenizeCard({
      pan: body.pan, expMonth: body.expMonth, expYear: body.expYear,
      cvv: body.cvv, holder: body.holder,
    }));
    if (!result.ok) return send(res, 400, { error: result.error, message: ARABIC[result.error] || result.error });
    method = {
      id: S.newId('pm_'),
      userId: user.id,
      type: 'card',
      provider: P.provider().name,
      providerToken: result.token,
      brand: result.brand,
      last4: result.last4,
      expMonth: result.expMonth,
      expYear: result.expYear,
      holder: (body.holder || '').trim(),
      isDefault: false,
      createdAt: now(),
    };
  } else {
    const iban = (body.iban || '').toUpperCase().replace(/\s/g, '');
    if (!P.isSaudiIban(iban)) return err(res, 400, 'invalid_iban');
    const holder = (body.holder || '').trim();
    if (holder.length < 2) return err(res, 400, 'invalid_input', { field: 'holder' });
    method = {
      id: S.newId('pm_'),
      userId: user.id,
      type: 'iban',
      provider: P.provider().name,
      providerToken: null,
      ibanLast4: iban.slice(-4),
      ibanMasked: P.maskIban(iban),
      holder,
      isDefault: false,
      createdAt: now(),
    };
  }
  // first method becomes default
  const existing = db.filter('paymentMethods', m => m.userId === user.id && !m.removedAt);
  if (existing.length === 0) method.isDefault = true;
  await db.insert('paymentMethods', method);
  return send(res, 201, { method: publicPaymentMethod(method) });
});

R('PATCH', /^\/app\/payment-methods\/([^/]+)$/, async (req, res, m) => {
  const user = requireAuth(req, res); if (!user) return;
  const id = m[1];
  const method = db.find('paymentMethods', x => x.id === id && x.userId === user.id && !x.removedAt);
  if (!method) return err(res, 404, 'not_found');
  const body = await readJson(req);
  if (body?.isDefault === true) {
    await db.update(d => {
      d.paymentMethods.forEach(x => {
        if (x.userId === user.id) x.isDefault = (x.id === id);
      });
    });
  }
  return send(res, 200, { method: publicPaymentMethod(db.find('paymentMethods', x => x.id === id)) });
});

R('DELETE', /^\/app\/payment-methods\/([^/]+)$/, async (req, res, m) => {
  const user = requireAuth(req, res); if (!user) return;
  const id = m[1];
  const method = db.find('paymentMethods', x => x.id === id && x.userId === user.id && !x.removedAt);
  if (!method) return err(res, 404, 'not_found');
  await db.patch('paymentMethods', x => x.id === id, { removedAt: now(), isDefault: false });
  // promote another method to default if needed
  if (method.isDefault) {
    const others = db.filter('paymentMethods', x => x.userId === user.id && !x.removedAt);
    if (others.length) {
      await db.patch('paymentMethods', x => x.id === others[0].id, { isDefault: true });
    }
  }
  return send(res, 200, { ok: true });
});

R('GET', '/app/payment-history', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const list = db.filter('transactions', t => t.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 200);
  return send(res, 200, { transactions: list });
});

// ============================================================
//  PORTFOLIO  (deposit / withdraw using payment methods)
// ============================================================

R('POST', '/app/portfolio/deposit', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const amount = Number(body?.amount);
  const methodId = (body?.methodId || '').toString();
  if (!(amount > 0) || amount < 100) return err(res, 400, 'invalid_input', { field: 'amount' });
  if (amount > 1_000_000) return err(res, 400, 'invalid_input', { field: 'amount' });
  if (!methodId) return err(res, 400, 'invalid_input', { field: 'methodId' });

  const method = db.find('paymentMethods', m => m.id === methodId && m.userId === user.id && !m.removedAt);
  if (!method) return err(res, 404, 'not_found');
  if (method.type !== 'card') return err(res, 400, 'invalid_input', { field: 'methodId' });

  const charge = await Promise.resolve(P.provider().charge({
    token: method.providerToken,
    amount,
    last4: method.last4,
  }));
  const txnId = S.newId('txn_');
  await db.update(d => {
    const u = d.users.find(x => x.id === user.id);
    if (charge.ok) u.balance = (u.balance || 0) + amount;
    d.transactions.push({
      id: txnId,
      userId: user.id,
      kind: 'deposit',
      amount: charge.ok ? amount : 0,
      ref: charge.ref || null,
      methodId,
      methodLabel: `${method.brand?.toUpperCase()} ${method.last4 ? '****' + method.last4 : ''}`.trim(),
      status: charge.ok ? 'completed' : 'failed',
      failureReason: charge.ok ? null : charge.error,
      description: charge.ok ? `إيداع عبر بطاقة ****${method.last4}` : `محاولة إيداع فاشلة`,
      createdAt: now(),
    });
  });

  if (!charge.ok) {
    WH.dispatch(db, 'payment.failed', { userId: user.id, amount, methodId, reason: charge.error || 'declined' });
    return send(res, 402, { error: charge.error || 'declined', message: 'تم رفض عملية الدفع. تحقق من بطاقتك أو جرّب طريقة أخرى.' });
  }

  await notify(user.id, 'deposit', 'تم الإيداع',
    `تم إضافة ${amount.toLocaleString('ar-SA')} ر.س. إلى رصيدك.`);
  WH.dispatch(db, 'payment.completed', { userId: user.id, amount, methodId, ref: charge.ref, txnId });

  const fresh = db.find('users', u => u.id === user.id);
  return send(res, 200, { balance: fresh.balance, txnId, ref: charge.ref });
});

R('POST', '/app/portfolio/withdraw', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const amount = Number(body?.amount);
  const methodId = (body?.methodId || '').toString();
  if (!(amount > 0)) return err(res, 400, 'invalid_input');
  if (!methodId) return err(res, 400, 'invalid_input', { field: 'methodId' });

  const fresh = db.find('users', u => u.id === user.id);
  if ((fresh.balance || 0) < amount) return err(res, 400, 'insufficient');

  const method = db.find('paymentMethods', m => m.id === methodId && m.userId === user.id && !m.removedAt);
  if (!method) return err(res, 404, 'not_found');
  if (method.type !== 'iban') return err(res, 400, 'invalid_input', { field: 'methodId' });

  const payout = await Promise.resolve(P.provider().payout({
    iban: method.ibanMasked ? null : null, // never store full IBAN; mock accepts token-less
    token: null,
    amount,
  }));
  // Mock payout always accepts (no IBAN stored full). In a real provider this
  // would use a payout-token tied to the user.
  await db.update(d => {
    const u = d.users.find(x => x.id === user.id);
    u.balance -= amount;
    d.transactions.push({
      id: S.newId('txn_'),
      userId: user.id,
      kind: 'withdraw',
      amount: -amount,
      ref: payout.ref || null,
      methodId,
      methodLabel: `IBAN ${method.ibanMasked || ''}`.trim(),
      status: 'pending', // payouts take 1-3 business days
      description: `سحب إلى ${method.ibanMasked}`,
      createdAt: now(),
    });
  });
  await notify(user.id, 'withdraw', 'تم تقديم طلب السحب',
    `سيتم تحويل ${amount.toLocaleString('ar-SA')} ر.س. إلى حسابك خلال ١-٣ أيام عمل.`);

  return send(res, 200, { balance: db.find('users', u => u.id === user.id).balance });
});

// ============================================================
//  NOTIFICATIONS
// ============================================================

R('GET', '/app/notifications', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const list = db.filter('notifications', n => n.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = list.filter(n => !n.read).length;
  return send(res, 200, { notifications: list, unread });
});

R('POST', /^\/app\/notifications\/([^/]+)\/read$/, async (req, res, m) => {
  const user = requireAuth(req, res); if (!user) return;
  await db.patch('notifications', n => n.id === m[1] && n.userId === user.id, { read: true });
  return send(res, 200, { ok: true });
});

R('POST', '/app/notifications/read-all', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  await db.patch('notifications', n => n.userId === user.id, { read: true });
  return send(res, 200, { ok: true });
});

// ============================================================
//  PROFILE
// ============================================================

R('PATCH', '/app/profile', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const allowed = ['name', 'email', 'phone', 'locale', 'avatar'];
  const changes = {};
  for (const k of allowed) if (k in (body || {})) changes[k] = body[k];
  if (changes.email && !isEmail(changes.email)) return err(res, 400, 'invalid_input', { field: 'email' });
  if (changes.phone) changes.phone = normPhone(changes.phone);
  await db.patch('users', u => u.id === user.id, changes);
  return send(res, 200, { user: S.publicUser(db.find('users', u => u.id === user.id)) });
});

R('POST', '/app/profile/password', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const oldPwd = body?.oldPassword || '';
  const newPwd = body?.newPassword || '';
  if (newPwd.length < 8) return err(res, 400, 'invalid_input', { field: 'newPassword' });
  const fresh = db.find('users', u => u.id === user.id);
  if (!S.verifyPassword(oldPwd, fresh.salt, fresh.passwordHash)) return err(res, 401, 'bad_credentials');
  const { salt, passwordHash } = S.hashPassword(newPwd);
  await db.patch('users', u => u.id === user.id, { salt, passwordHash });
  await notify(user.id, 'security', 'تم تغيير كلمة المرور',
    'إذا لم تكن أنت من قام بذلك، فيرجى التواصل مع الدعم فوراً.');
  return send(res, 200, { ok: true });
});

// ============================================================
//  AUTO-INVEST  (investor preference rules; surfaces matches but
//  never auto-executes investments — explicit consent is required
//  for each investment under SAMA crowdfunding rules.)
// ============================================================

const DEFAULT_AUTO_RULES = {
  enabled:           false,
  minAmount:         5000,
  maxAmount:         25000,
  maxTermMonths:     24,
  minProfitRate:     0.08,
  excludeInviteOnly: true,
  updatedAt:         null,
};

const sanitizeRules = (body) => {
  const r = { ...DEFAULT_AUTO_RULES };
  if (body && typeof body === 'object') {
    if (typeof body.enabled === 'boolean')           r.enabled = body.enabled;
    if (typeof body.excludeInviteOnly === 'boolean') r.excludeInviteOnly = body.excludeInviteOnly;
    const n = (k, min, max) => {
      const v = Number(body[k]);
      if (Number.isFinite(v)) r[k] = Math.max(min, Math.min(max, v));
    };
    n('minAmount',     1000, 1_000_000);
    n('maxAmount',     1000, 5_000_000);
    n('maxTermMonths', 1,    60);
    n('minProfitRate', 0,    0.5);
  }
  if (r.maxAmount < r.minAmount) r.maxAmount = r.minAmount;
  r.updatedAt = new Date().toISOString();
  return r;
};

function projectMatchesRules(project, rules) {
  if (!rules || !rules.enabled) return false;
  if (project.status !== 'open') return false;
  if (rules.excludeInviteOnly && project.inviteOnly) return false;
  if ((project.termMonths || 0) > rules.maxTermMonths) return false;
  if ((project.profitRate || 0) < rules.minProfitRate) return false;
  const room = (project.goal || 0) - (project.raised || 0);
  if (room < rules.minAmount) return false;
  return true;
}

R('GET', '/app/profile/auto-invest', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const fresh = db.find('users', u => u.id === user.id);
  return send(res, 200, { rules: fresh.autoInvestRules || DEFAULT_AUTO_RULES });
});

R('PATCH', '/app/profile/auto-invest', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const rules = sanitizeRules(body);
  await db.patch('users', u => u.id === user.id, { autoInvestRules: rules });
  if (rules.enabled) {
    await notify(user.id, 'auto_invest', 'تفعيل الاستثمار الآلي',
      'تم حفظ تفضيلاتك. سنُبلغك بالفرص المطابقة فور طرحها.');
  }
  return send(res, 200, { rules });
});

R('GET', '/app/auto-invest/matches', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const fresh = db.find('users', u => u.id === user.id);
  const rules = fresh.autoInvestRules || DEFAULT_AUTO_RULES;
  const matches = db.all('projects')
    .filter(p => projectMatchesRules(p, rules))
    .map(p => ({
      ...p,
      fundedPct: p.goal > 0 ? Math.min(100, Math.round((p.raised / p.goal) * 100)) : 0,
      suggestedAmount: Math.min(rules.maxAmount, Math.max(rules.minAmount, p.minAmount || rules.minAmount)),
    }));
  return send(res, 200, { rules, matches });
});

// ============================================================
//  WAITLIST + HELP CONTACT
// ============================================================

R('POST', '/app/waitlist', async (req, res) => {
  const body = await readJson(req);
  const value = (body?.email || body?.phone || body?.contact || '').toString().trim();
  if (!value) return err(res, 400, 'invalid_input');
  const channel = isEmail(value) ? 'email' : (isPhone(value) ? 'phone' : 'other');
  await db.insert('waitlist', {
    id: S.newId('wl_'),
    contact: channel === 'phone' ? normPhone(value) : value,
    channel,
    createdAt: now(),
  });
  return send(res, 201, { ok: true });
});

R('POST', '/app/help/contact', async (req, res) => {
  const body = await readJson(req);
  const subject = (body?.subject || '').toString().trim();
  const message = (body?.message || '').toString().trim();
  const contact = (body?.contact || '').toString().trim();
  if (!message) return err(res, 400, 'invalid_input', { field: 'message' });
  const userId = S.userIdFromReq(req);
  await db.insert('helpRequests', {
    id: S.newId('hlp_'),
    userId, subject, message, contact,
    status: 'open',
    createdAt: now(),
  });
  if (userId) {
    await notify(userId, 'help', 'تم استلام طلبك',
      'سيتواصل معك فريق الدعم خلال ٢٤ ساعة.');
  }
  return send(res, 201, { ok: true });
});

// ============================================================
//  ADMIN
// ============================================================

R('GET', '/app/admin/investments', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const params = new URL(req.url, 'http://x').searchParams;
  const q       = (params.get('q') || '').trim().toLowerCase();
  const status  = params.get('status');
  const projectId = params.get('projectId');
  const limit   = Math.min(parseInt(params.get('limit') || '200', 10), 1000);
  const offset  = parseInt(params.get('offset') || '0', 10);

  const userIdx = Object.fromEntries(db.all('users').map(u => [u.id, u]));
  const projectIdx = Object.fromEntries(db.all('projects').map(p => [p.id, p]));

  let list = db.all('investments').map(i => {
    const u = userIdx[i.userId] || {};
    const p = projectIdx[i.projectId] || {};
    return {
      ...i,
      userName: u.name,
      userEmail: u.email,
      userPhone: u.phone,
      projectName: p.name,
      projectSlug: p.slug,
    };
  });

  if (q) list = list.filter(x =>
    (x.userName || '').toLowerCase().includes(q) ||
    (x.userEmail || '').toLowerCase().includes(q) ||
    (x.userPhone || '').includes(q) ||
    (x.projectName || '').toLowerCase().includes(q)
  );
  if (status) list = list.filter(x => x.status === status);
  if (projectId) list = list.filter(x => x.projectId === projectId);

  const total = list.length;
  const sum = list.reduce((s, x) => s + (x.amount || 0), 0);
  list = list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(offset, offset + limit);
  return send(res, 200, { total, sum, offset, limit, investments: list });
});

R('GET', '/app/admin/investments.csv', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const userIdx = Object.fromEntries(db.all('users').map(u => [u.id, u]));
  const projectIdx = Object.fromEntries(db.all('projects').map(p => [p.id, p]));
  const rows = [
    ['investmentId', 'createdAt', 'userId', 'userName', 'userEmail', 'projectId', 'projectName', 'amount', 'status', 'contractId', 'expectedReturn', 'signedAt'],
  ];
  for (const i of db.all('investments').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))) {
    const u = userIdx[i.userId] || {};
    const p = projectIdx[i.projectId] || {};
    rows.push([i.id, i.createdAt, i.userId, u.name, u.email, i.projectId, p.name, i.amount, i.status, i.contractId, i.expectedReturn, i.signedAt || '']);
  }
  const csv = rows.map(r => r.map(v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
  await audit(admin.id, 'investments.export', 'csv', { rows: rows.length - 1 }, req);
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="murbha-investments-${new Date().toISOString().slice(0,10)}.csv"`,
    'Cache-Control': 'no-store',
  });
  res.end('﻿' + csv); // BOM so Excel reads UTF-8
});

R('GET', '/app/admin/users', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const params = new URL(req.url, 'http://x').searchParams;
  const q       = (params.get('q') || '').trim().toLowerCase();
  const status  = params.get('status'); // pending, approved, rejected
  const kyc     = params.get('kyc');    // pending, email_verified, mobile_verified, id_verified, verified
  const klass   = params.get('class');  // retail, qualified
  const limit   = Math.min(parseInt(params.get('limit') || '200', 10), 1000);
  const offset  = parseInt(params.get('offset') || '0', 10);

  let list = db.all('users');
  if (q) {
    list = list.filter(u =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.phone || '').includes(q) ||
      (u.nationalId || '').includes(q)
    );
  }
  if (status === 'pending')  list = list.filter(u => !u.approved && !u.rejected && u.role !== 'admin');
  if (status === 'approved') list = list.filter(u => u.approved && !u.rejected);
  if (status === 'rejected') list = list.filter(u => u.rejected);
  if (kyc)   list = list.filter(u => (u.kycStatus || 'pending') === kyc);
  if (klass) list = list.filter(u => (u.investorClass || 'retail') === klass);

  const total = list.length;
  list = list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(offset, offset + limit);
  return send(res, 200, { total, offset, limit, users: list.map(u => S.publicUser(u)) });
});

R('POST', '/app/admin/users/bulk-approve', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const ids = Array.isArray(body?.userIds) ? body.userIds.slice(0, 500) : [];
  let approved = 0;
  for (const id of ids) {
    const u = db.find('users', x => x.id === id);
    if (!u || u.rejected) continue;
    await db.patch('users', x => x.id === id, { approved: true });
    await audit(admin.id, 'user.approve', id, { bulk: true }, req);
    await notify(id, 'welcome', 'تم تفعيل حسابك', 'تمت الموافقة على حسابك من قبل الإدارة.');
    if (u.email) {
      const tpl = M.welcomeTemplate(u.name);
      M.send({ to: u.email, subject: '✅ تم تفعيل حسابك في منصة مُرابحة', html: tpl.html, text: tpl.text }).catch(()=>{});
    }
    approved++;
  }
  return send(res, 200, { ok: true, count: approved });
});

R('POST', '/app/admin/users/bulk-reject', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const ids = Array.isArray(body?.userIds) ? body.userIds.slice(0, 500) : [];
  const reason = (body?.reason || '').trim().slice(0, 500);
  let rejected = 0;
  for (const id of ids) {
    const u = db.find('users', x => x.id === id);
    if (!u || u.role === 'admin') continue;
    await db.patch('users', x => x.id === id, {
      approved: false, rejected: true, rejectedAt: now(), rejectedBy: admin.id, rejectedReason: reason || null,
    });
    await audit(admin.id, 'user.reject', id, { bulk: true, reason: reason || null }, req);
    await notify(id, 'account_rejected', 'تم رفض حسابك',
      reason ? `سبب الرفض: ${reason}` : 'لم تتم الموافقة على حسابك.');
    if (u.email) {
      const tpl = M.rejectedTemplate(reason);
      M.send({ to: u.email, subject: 'حالة طلب حسابك في منصة مُرابحة', html: tpl.html, text: tpl.text }).catch(()=>{});
    }
    rejected++;
  }
  return send(res, 200, { ok: true, count: rejected });
});

R('POST', '/app/admin/notify-segment', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const segment = (body?.segment || 'all').toString();
  const title = (body?.title || '').toString().trim();
  const message = (body?.body || '').toString().trim();
  if (!title || !message) return err(res, 400, 'invalid_input');
  if (title.length > 120 || message.length > 1000) return err(res, 400, 'invalid_input');
  const ctaUrl = (body?.ctaUrl || '').toString().slice(0, 200) || null;
  let recipients = db.all('users').filter(u => !u.deletedAt && u.role !== 'admin');
  if (segment === 'approved')     recipients = recipients.filter(u => u.approved && !u.rejected);
  else if (segment === 'pending') recipients = recipients.filter(u => !u.approved && !u.rejected);
  else if (segment === 'kyc-pending') recipients = recipients.filter(u => (u.kycStatus || 'pending') !== 'verified');
  else if (segment === 'investors')   recipients = recipients.filter(u => db.filter('investments', i => i.userId === u.id).length > 0);
  if (recipients.length > 2000) return err(res, 400, 'segment_too_large');
  const meta = { fromAdmin: admin.id, ctaUrl, segment };
  for (const u of recipients) {
    await notify(u.id, 'admin', title, message, meta);
  }
  await audit(admin.id, 'admin.notify.segment', segment, { count: recipients.length, title }, req);
  return send(res, 200, { ok: true, count: recipients.length });
});

R('POST', /^\/app\/admin\/users\/([^/]+)\/suspend$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const user = db.find('users', u => u.id === m[1]);
  if (!user) return err(res, 404, 'not_found');
  if (user.role === 'admin') return err(res, 403, 'forbidden');
  const body = await readJson(req);
  const reason = (body?.reason || '').toString().slice(0, 500) || 'no_reason';
  await db.patch('users', u => u.id === user.id, {
    suspendedAt: now(),
    suspendedBy: admin.id,
    suspendReason: reason,
  });
  // Wipe sessions so they're immediately locked out
  await db.update(d => {
    d.sessions = (d.sessions || []).filter(s => s.userId !== user.id);
  });
  await audit(admin.id, 'admin.user.suspend', user.id, { reason }, req);
  return send(res, 200, { ok: true });
});

R('POST', /^\/app\/admin\/users\/([^/]+)\/unsuspend$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const user = db.find('users', u => u.id === m[1]);
  if (!user) return err(res, 404, 'not_found');
  if (!user.suspendedAt) return send(res, 200, { ok: true, already: true });
  await db.patch('users', u => u.id === user.id, {
    suspendedAt: null,
    suspendedBy: null,
    suspendReason: null,
    unsuspendedAt: now(),
    unsuspendedBy: admin.id,
  });
  await audit(admin.id, 'admin.user.unsuspend', user.id, {}, req);
  return send(res, 200, { ok: true });
});

R('POST', /^\/app\/admin\/users\/([^/]+)\/notify$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const user = db.find('users', u => u.id === m[1]);
  if (!user) return err(res, 404, 'not_found');
  const body = await readJson(req);
  const title = (body?.title || '').toString().trim();
  const message = (body?.body || '').toString().trim();
  if (!title || !message) return err(res, 400, 'invalid_input');
  if (title.length > 120 || message.length > 1000) return err(res, 400, 'invalid_input');
  const kind = (body?.kind || 'admin').toString().slice(0, 30);
  const ctaUrl = (body?.ctaUrl || '').toString().slice(0, 200) || null;
  const meta = { fromAdmin: admin.id, ctaUrl };
  await notify(user.id, kind, title, message, meta);
  await audit(admin.id, 'admin.user.notify', user.id, { title, kind }, req);
  return send(res, 200, { ok: true });
});

R('PUT', /^\/app\/admin\/users\/([^/]+)\/note$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const user = db.find('users', u => u.id === m[1]);
  if (!user) return err(res, 404, 'not_found');
  const body = await readJson(req);
  const note = (body?.note || '').toString().slice(0, 4000);
  await db.patch('users', u => u.id === user.id, {
    adminNote: note || null,
    adminNoteBy: note ? admin.id : null,
    adminNoteAt: note ? now() : null,
  });
  await audit(admin.id, 'admin.user.note.update', user.id, { length: note.length }, req);
  return send(res, 200, { ok: true });
});

R('GET', /^\/app\/admin\/users\/([^/]+)\/portfolio$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const user = db.find('users', u => u.id === m[1]);
  if (!user) return err(res, 404, 'not_found');
  const projIdx = Object.fromEntries(db.all('projects').map(p => [p.id, p]));
  const invs = db.filter('investments', i => i.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(i => ({ ...i, projectName: projIdx[i.projectId]?.name || '—' }));
  const txns = db.filter('transactions', t => t.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const contracts = db.filter('contracts', c => c.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const logins = db.filter('loginAttempts', l => l.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20);
  const totalInvested = invs.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const totalReturned = txns.filter(t => t.kind === 'profit' || t.kind === 'payout').reduce((s, t) => s + (Number(t.amount) || 0), 0);
  await audit(admin.id, 'admin.user.view-portfolio', user.id, {}, req);
  return send(res, 200, {
    user: S.publicUser(user),
    summary: { totalInvested, totalReturned, investmentCount: invs.length, contractCount: contracts.length },
    investments: invs,
    transactions: txns,
    contracts,
    recentLogins: logins,
  });
});

R('POST', '/app/admin/users/approve', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const userId = body?.userId;
  if (!userId) return err(res, 400, 'invalid_input');

  const u = db.find('users', x => x.id === userId);
  if (!u) return err(res, 404, 'not_found');

  await db.patch('users', x => x.id === userId, { approved: true });
  await audit(admin.id, 'user.approve', userId, { name: u.name, email: u.email }, req);
  WH.dispatch(db, 'user.approved', { userId, name: u.name, email: u.email });
  await notify(userId, 'welcome', 'تم تفعيل حسابك', 'تمت الموافقة على حسابك من قبل الإدارة. يمكنك الآن الاستثمار في الفرص المتاحة.');
  if (u.email) {
    const tpl = M.welcomeTemplate(u.name);
    M.send({
      to: u.email,
      subject: '✅ تم تفعيل حسابك في منصة مُرابحة',
      html: tpl.html.replace('تم إنشاء حسابك في منصة مُرابحة بنجاح', 'تمت الموافقة على حسابك بنجاح'),
      text: tpl.text.replace('تم إنشاء حسابك في منصة مُرابحة بنجاح', 'تمت الموافقة على حسابك بنجاح'),
    }).catch(()=>{});
  }

  return send(res, 200, { success: true });
});

R('POST', '/app/admin/users/reject', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const userId = body?.userId;
  const reason = (body?.reason || '').trim().slice(0, 500);
  if (!userId) return err(res, 400, 'invalid_input');

  const u = db.find('users', x => x.id === userId);
  if (!u) return err(res, 404, 'not_found');
  if (u.role === 'admin') return err(res, 403, 'unauthorized');

  await db.patch('users', x => x.id === userId, {
    approved: false,
    rejected: true,
    rejectedAt: now(),
    rejectedBy: admin.id,
    rejectedReason: reason || null,
  });
  await audit(admin.id, 'user.reject', userId, { name: u.name, email: u.email, reason: reason || null }, req);
  WH.dispatch(db, 'user.rejected', { userId, name: u.name, email: u.email, reason: reason || null });
  await notify(userId, 'account_rejected', 'تم رفض حسابك',
    reason ? `سبب الرفض: ${reason}` : 'لم تتم الموافقة على حسابك. يُرجى التواصل مع الدعم لمزيد من المعلومات.');
  if (u.email) {
    const tpl = M.rejectedTemplate(reason);
    M.send({ to: u.email, subject: 'حالة طلب حسابك في منصة مُرابحة', html: tpl.html, text: tpl.text }).catch(()=>{});
  }

  return send(res, 200, { success: true });
});

// ============================================================
//  ADMIN PROJECT CREATION & CALCULATORS
// ============================================================

R('PATCH', /^\/app\/admin\/projects\/([^/]+)$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const p = db.find('projects', x => x.id === m[1] || x.slug === m[1]);
  if (!p) return err(res, 404, 'not_found');
  const body = await readJson(req);
  const allowed = ['name','category','city','summary','description','image','status','goal','minAmount','termMonths','profitRate','closesAt','guarantee','shariaApproval','fatwaId','inviteOnly','paused'];
  const changes = {};
  for (const k of allowed) if (k in (body || {})) changes[k] = body[k];
  await db.patch('projects', x => x.id === p.id, changes);
  await audit(admin.id, 'project.update', p.id, Object.keys(changes), req);
  return send(res, 200, { project: db.find('projects', x => x.id === p.id) });
});

R('POST', /^\/app\/admin\/projects\/([^/]+)\/(pause|resume)$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const [, id, action] = m;
  const p = db.find('projects', x => x.id === id || x.slug === id);
  if (!p) return err(res, 404, 'not_found');
  await db.patch('projects', x => x.id === p.id, { paused: action === 'pause' });
  await audit(admin.id, 'project.' + action, p.id, {}, req);
  return send(res, 200, { ok: true, paused: action === 'pause' });
});

R('POST', '/app/admin/projects', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  if (!body) return err(res, 400, 'invalid_input');

  const id = body.id || '';
  const name = (body.name || '').trim();
  const category = (body.category || 'عقاري سكني').trim();
  const city = (body.city || 'الرياض').trim();
  const summary = (body.summary || '').trim();
  const description = (body.description || '').trim();
  const image = (body.image || '🏢').trim();
  const goal = Number(body.goal);
  const minAmount = Number(body.minAmount) || 1000;
  const totalProjectValue = Number(body.totalProjectValue) || goal;
  const opsCosts = Number(body.opsCosts) || 0;
  const otherCosts = Number(body.otherCosts) || 0;
  const minInvestors = Number(body.minInvestors) || 1;
  const maxInvestors = Number(body.maxInvestors) || 1000;
  const extendable = !!body.extendable;

  if (!name || !goal || goal <= 0) return err(res, 400, 'invalid_input');

  // ROI auto-calculation: profitRate = Net Profit / Total Project Value
  const netProfit = totalProjectValue - opsCosts - otherCosts;
  const profitRate = totalProjectValue > 0 ? (netProfit / totalProjectValue) : 0.08;

  const slug = name.toLowerCase().replace(/[^a-z0-9أ-ي\s-]/g, '').replace(/\s+/g, '-');

  await db.update(d => {
    let p = d.projects.find(x => x.id === id);
    if (p) {
      Object.assign(p, {
        name, category, city, summary, description, image, goal, minAmount,
        totalProjectValue, opsCosts, otherCosts, minInvestors, maxInvestors, extendable,
        profitRate, slug
      });
    } else {
      const newPrjId = id || S.newId('prj_');
      d.projects.push({
        id: newPrjId,
        slug,
        name,
        category,
        city,
        summary,
        description,
        image,
        goal,
        raised: 0,
        investorCount: 0,
        minAmount,
        profitRate,
        termMonths: Number(body.termMonths) || 12,
        status: 'open',
        openedAt: now(),
        closesAt: body.closesAt || now(),
        guarantee: body.guarantee || 'رهن عقاري + كفالة شركة',
        shariaApproval: body.shariaApproval || 'اعتماد الهيئة الشرعية',
        documents: [
          { "id": "doc_1", "name": "نموذج عقد المرابحة", "type": "pdf" },
          { "id": "doc_2", "name": "الفتوى الشرعية", "type": "pdf" }
        ],
        faq: [],
        totalProjectValue,
        opsCosts,
        otherCosts,
        minInvestors,
        maxInvestors,
        extendable,
        updates: [
          {
            "id": S.newId('upd_'),
            "date": now(),
            "title": "إطلاق الفرصة الاستثمارية",
            "body": `تم بحمد الله طرح فرصة تمويل مشروع "${name}" للعموم بعقد مرابحة شرعي.`
          }
        ]
      });
    }
  });

  return send(res, 200, { success: true });
});

R('POST', /^\/app\/admin\/projects\/([^/]+)\/updates$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  if (!body) return err(res, 400, 'invalid_input');

  const title = (body.title || '').trim();
  const bodyText = (body.body || '').trim();
  if (!title || !bodyText) return err(res, 400, 'invalid_input');

  const prj = db.find('projects', x => x.id === m[1] || x.slug === m[1]);
  if (!prj) return err(res, 404, 'not_found');

  const newUpdate = {
    id: S.newId('upd_'),
    date: now(),
    title,
    body: bodyText
  };

  await db.update(d => {
    const p = d.projects.find(x => x.id === prj.id);
    if (!p.updates) p.updates = [];
    p.updates.push(newUpdate);

    const investors = d.investments.filter(i => i.projectId === prj.id);
    for (const inv of investors) {
      d.notifications.push({
        id: S.newId('ntf_'),
        userId: inv.userId,
        kind: 'project_update',
        title: `تحديث جديد: ${title}`,
        body: `تحديث لمشروع ${p.name}: ${bodyText}`,
        meta: { projectId: p.id, updateId: newUpdate.id },
        read: false,
        createdAt: now(),
      });
    }
  });

  return send(res, 200, { success: true, update: newUpdate });
});

// ============================================================
//  INVESTMENT PERIOD EXTENSIONS
// ============================================================

R('POST', /^\/app\/investments\/([^/]+)\/extend$/, async (req, res, m) => {
  const user = requireAuth(req, res); if (!user) return;

  const inv = db.find('investments', x => x.id === m[1] && x.userId === user.id);
  if (!inv) return err(res, 404, 'not_found');
  if (inv.status !== 'active') return err(res, 400, 'closed');

  const prj = db.find('projects', x => x.id === inv.projectId);
  if (!prj || !prj.extendable) return err(res, 400, 'closed');

  if (inv.extensionStatus === 'pending' || inv.extensionStatus === 'approved') {
    return send(res, 200, { success: true, alreadySubmitted: true });
  }

  await db.update(d => {
    const targetInv = d.investments.find(x => x.id === inv.id);
    targetInv.extensionRequested = true;
    targetInv.extensionStatus = 'pending';
  });

  await notify(user.id, 'extension_request', 'تم تقديم طلب تمديد الاستثمار',
    `تم تقديم طلب تمديد فترة استثمارك في ${prj.name}. ستقوم الإدارة بمراجعته والرد قريباً.`,
    { investmentId: inv.id });

  return send(res, 200, { success: true });
});

R('GET', '/app/admin/extensions', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const list = db.filter('investments', i => i.extensionStatus === 'pending').map(inv => {
    const user = db.find('users', u => u.id === inv.userId);
    const project = db.find('projects', p => p.id === inv.projectId);
    return {
      ...inv,
      userName: user ? user.name : 'مستثمر',
      projectName: project ? project.name : 'مشروع'
    };
  });
  return send(res, 200, { extensions: list });
});

R('POST', /^\/app\/admin\/extensions\/([^/]+)\/resolve$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const approve = !!body?.approve;

  const inv = db.find('investments', x => x.id === m[1]);
  if (!inv) return err(res, 404, 'not_found');

  const project = db.find('projects', p => p.id === inv.projectId);

  await db.update(d => {
    const targetInv = d.investments.find(x => x.id === inv.id);
    targetInv.extensionStatus = approve ? 'approved' : 'rejected';
    if (approve) {
      targetInv.termMonths = (targetInv.termMonths || project.termMonths || 12) + 6;
      targetInv.expectedReturn = targetInv.amount * (1 + (project.profitRate || 0.08) * targetInv.termMonths / 12);
    }
    d.notifications.push({
      id: S.newId('ntf_'),
      userId: targetInv.userId,
      kind: 'extension_resolved',
      title: approve ? 'تمت الموافقة على تمديد الاستثمار' : 'تم رفض طلب تمديد الاستثمار',
      body: approve 
        ? `تمت الموافقة على تمديد استثمارك في مشروع ${project.name} لمدة ٦ أشهر إضافية وعائد متوقع جديد ${targetInv.expectedReturn.toLocaleString('ar-SA')} ر.س.`
        : `نعتذر، لم تتم الموافقة على تمديد استثمارك في مشروع ${project.name}. سيتم تسييل الاستثمار في موعده المحدد.`,
      meta: { investmentId: inv.id },
      read: false,
      createdAt: now(),
    });
  });

  return send(res, 200, { success: true });
});

// ============================================================
//  ANNOUNCEMENTS  (public + admin CRUD)
// ============================================================

const isAnnActive = (a) => {
  if (a.deletedAt) return false;
  const t = Date.now();
  if (a.publishAt && new Date(a.publishAt).getTime() > t) return false;
  if (a.expiresAt && new Date(a.expiresAt).getTime() < t) return false;
  return true;
};

const ANN_AUDIENCES = ['all', 'investors', 'kyc_pending', 'admins'];
const ANN_LEVELS = ['info', 'success', 'warning', 'urgent'];

R('GET', '/app/announcements', async (req, res) => {
  const user = S.currentUser(req); // may be null
  const list = db.all('announcements')
    .filter(isAnnActive)
    .filter(a => {
      if (!a.audience || a.audience === 'all') return true;
      if (!user) return false;
      if (a.audience === 'admins')        return user.role === 'admin';
      if (a.audience === 'investors')     return user.approved && user.kycStatus === 'verified';
      if (a.audience === 'kyc_pending')   return user.kycStatus !== 'verified';
      return false;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(a => ({
      id: a.id, title: a.title, titleEn: a.titleEn || null,
      body: a.body, bodyEn: a.bodyEn || null,
      level: a.level, cta: a.cta || null, ctaUrl: a.ctaUrl || null,
      publishAt: a.publishAt, expiresAt: a.expiresAt, createdAt: a.createdAt,
    }));
  return send(res, 200, { announcements: list });
});

R('GET', '/app/admin/announcements', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const list = db.all('announcements')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return send(res, 200, { announcements: list });
});

R('POST', '/app/admin/announcements', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  if (!body) return err(res, 400, 'invalid_input');
  const title = (body.title || '').trim();
  const text  = (body.body  || '').trim();
  if (!title || !text) return err(res, 400, 'invalid_input', { field: title ? 'body' : 'title' });
  const audience = ANN_AUDIENCES.includes(body.audience) ? body.audience : 'all';
  const level    = ANN_LEVELS.includes(body.level) ? body.level : 'info';

  const ann = {
    id: S.newId('ann_'),
    title,
    titleEn: (body.titleEn || '').trim() || null,
    body: text,
    bodyEn: (body.bodyEn || '').trim() || null,
    audience,
    level,
    cta: (body.cta || '').trim() || null,
    ctaUrl: (body.ctaUrl || '').trim() || null,
    publishAt: body.publishAt || now(),
    expiresAt: body.expiresAt || null,
    createdBy: admin.id,
    createdAt: now(),
    deletedAt: null,
  };
  await db.insert('announcements', ann);
  await audit(admin.id, 'announcement.create', ann.id, { title, audience, level }, req);
  return send(res, 201, { announcement: ann });
});

R('PATCH', /^\/app\/admin\/announcements\/([^/]+)$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const ann = db.find('announcements', a => a.id === m[1]);
  if (!ann) return err(res, 404, 'not_found');
  const body = await readJson(req);
  const allowed = ['title', 'titleEn', 'body', 'bodyEn', 'audience', 'level', 'cta', 'ctaUrl', 'publishAt', 'expiresAt'];
  const changes = {};
  for (const k of allowed) if (k in (body || {})) changes[k] = body[k];
  if (changes.audience && !ANN_AUDIENCES.includes(changes.audience)) delete changes.audience;
  if (changes.level    && !ANN_LEVELS.includes(changes.level)) delete changes.level;
  await db.patch('announcements', a => a.id === m[1], changes);
  await audit(admin.id, 'announcement.update', m[1], Object.keys(changes), req);
  return send(res, 200, { announcement: db.find('announcements', a => a.id === m[1]) });
});

R('DELETE', /^\/app\/admin\/announcements\/([^/]+)$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const ann = db.find('announcements', a => a.id === m[1]);
  if (!ann) return err(res, 404, 'not_found');
  await db.patch('announcements', a => a.id === m[1], { deletedAt: now() });
  await audit(admin.id, 'announcement.delete', m[1], { title: ann.title }, req);
  return send(res, 200, { ok: true });
});

// ============================================================
//  PUBLIC SETTINGS (platform-wide config: social links, support)
// ============================================================

const DEFAULT_SETTINGS = {
  social: {
    twitter:   'https://x.com/murbha_sa',
    linkedin:  'https://www.linkedin.com/company/murbha',
    whatsapp:  'https://wa.me/966500000000',
    instagram: 'https://instagram.com/murbha.sa',
    youtube:   'https://youtube.com/@murbha_sa',
  },
  support: {
    hotline: '9200-12345',
    email:   'support@murbha.sa',
  },
};

const _settings = () => {
  const raw = db.get().settings || {};
  return {
    social: { ...DEFAULT_SETTINGS.social, ...(raw.social || {}) },
    support: { ...DEFAULT_SETTINGS.support, ...(raw.support || {}) },
  };
};

R('GET', '/app/settings', async (req, res) => {
  return send(res, 200, _settings());
});

R('PATCH', '/app/admin/settings', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  if (!body || typeof body !== 'object') return err(res, 400, 'invalid_input');
  await db.update(d => {
    d.settings = d.settings || {};
    if (body.social && typeof body.social === 'object') {
      d.settings.social = { ...(d.settings.social || {}), ...body.social };
    }
    if (body.support && typeof body.support === 'object') {
      d.settings.support = { ...(d.settings.support || {}), ...body.support };
    }
    if (body.maintenance && typeof body.maintenance === 'object') {
      d.settings.maintenance = { ...(d.settings.maintenance || {}), ...body.maintenance };
    }
  });
  await audit(admin.id, 'settings.update', 'settings', Object.keys(body), req);
  return send(res, 200, _settings());
});

// Public status snapshot for /status.html
R('GET', '/app/public/status', async (req, res) => {
  const s = _settings();
  const projects = db.all('projects');
  const investments = db.all('investments');
  const users = db.all('users');
  const recentInvCount = investments.filter(i => {
    const t = new Date(i.createdAt || 0).getTime();
    return Date.now() - t < 24 * 60 * 60 * 1000;
  }).length;
  const maint = s.maintenance || {};
  const components = [
    { id: 'api',       name: 'API الأساسي', status: 'operational' },
    { id: 'database',  name: 'قاعدة البيانات', status: 'operational' },
    { id: 'auth',      name: 'تسجيل الدخول', status: 'operational' },
    { id: 'payments',  name: 'بوابة الدفع', status: process.env.HYPERPAY_KEY ? 'operational' : 'degraded' },
    { id: 'email',     name: 'إشعارات البريد', status: process.env.RESEND_API_KEY ? 'operational' : 'degraded' },
    { id: 'sms',       name: 'الرسائل النصية', status: (process.env.UNIFONIC_API_KEY || process.env.TWILIO_SID) ? 'operational' : 'degraded' },
  ];
  if (maint.active) components.forEach(c => c.status = 'maintenance');
  const overall = components.every(c => c.status === 'operational') ? 'operational'
    : components.some(c => c.status === 'down') ? 'down'
    : components.some(c => c.status === 'maintenance') ? 'maintenance'
    : 'degraded';
  res.setHeader('Cache-Control', 'public, max-age=15');
  return send(res, 200, {
    overall,
    components,
    metrics: {
      projectsOpen: projects.filter(p => p.status === 'open').length,
      investmentsLast24h: recentInvCount,
      userCount: users.filter(u => !u.deletedAt).length,
    },
    serverTime: new Date().toISOString(),
  });
});

// Public maintenance gate: anyone (incl. non-admin) checks current state.
R('GET', '/app/public/maintenance', async (req, res) => {
  const s = _settings();
  const m = s.maintenance || {};
  res.setHeader('Cache-Control', 'no-cache');
  return send(res, 200, {
    active: !!m.active,
    message: m.message || 'النظام تحت الصيانة حالياً. سنعود قريباً.',
    eta: m.eta || null,
  });
});

// ============================================================
//  ADMIN SECURITY (audit log + login attempts + sessions)
// ============================================================

R('GET', '/app/admin/audit-log', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const limit = Math.min(parseInt(req.url.split('?')[1]?.match(/limit=(\d+)/)?.[1] || '100', 10), 500);
  const list = db.all('auditLog')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
  // hydrate actor names
  const usrIdx = Object.fromEntries(db.all('users').map(u => [u.id, u.name]));
  const enriched = list.map(e => ({ ...e, actorName: usrIdx[e.actorId] || 'system' }));
  return send(res, 200, { entries: enriched });
});

// ============================================================
//  LAUNCH PLAN  (admin checklist + progress dashboard)
// ============================================================

const DEFAULT_LAUNCH_PLAN = [
  // Pre-launch: P0 — cannot launch without these
  { id: 'sama_license',     phase: 'P0', title: 'ترخيص ساما (أو شراكة مع جهة مرخصة)', desc: 'لا يمكن قبول استثمارات في السعودية دون ترخيص ساما أو شراكة مع جهة مرخصة.', done: false },
  { id: 'payment_gateway',  phase: 'P0', title: 'تفعيل بوابة الدفع (HyperPay/Moyasar)', desc: 'إعداد بوابة دفع حقيقية مع mada وApple Pay وSTC Pay.', done: false },
  { id: 'postgres_migration', phase: 'P0', title: 'الهجرة من JSON إلى PostgreSQL', desc: 'تشغيل Postgres على Render، تحويل lib/db.js للاتصال بالقاعدة.', done: false },
  { id: 'sms_provider',     phase: 'P0', title: 'مزود SMS (Unifonic أو Twilio)', desc: 'إرسال رموز التحقق عبر SMS حقيقي للمستخدمين.', done: false },
  { id: 'resend_domain',    phase: 'P0', title: 'التحقق من نطاق Resend للبريد', desc: 'إعداد SPF/DKIM/DMARC لـ murbha.sa وتعيين RESEND_FROM.', done: false },
  { id: 'kyc_upload',       phase: 'P0', title: 'رفع صورة الهوية والسيلفي في KYC', desc: 'تخزين آمن للوثائق المطلوبة في خطوة الهوية.', done: false },
  { id: 'production_secrets', phase: 'P0', title: 'تدوير مفاتيح الإنتاج', desc: 'SESSION_SECRET عشوائي، NAFATH_APP_KEY حقيقي في متغيرات بيئة Render.', done: false },
  // Launch-week: P1
  { id: 'sec_headers',      phase: 'P1', title: 'رؤوس الأمان (HSTS/CSP)', desc: 'تم في PR #4.', done: true },
  { id: 'csrf',             phase: 'P1', title: 'حماية CSRF', desc: 'تم في PR #4.', done: true },
  { id: 'password_reset',   phase: 'P1', title: 'استعادة كلمة المرور', desc: 'تم في PR #4.', done: true },
  { id: 'admin_2fa',        phase: 'P1', title: 'المصادقة الثنائية للمسؤولين', desc: 'تم في PR #4. مطلوب تفعيلها على كل حساب مسؤول.', done: true },
  { id: 'real_hotline',     phase: 'P1', title: 'تحديث الرقم الموحد والبريد', desc: 'استبدل 9200-12345 ببيانات حقيقية في الصفحات القانونية.', done: false },
  { id: 'monitoring',       phase: 'P1', title: 'المراقبة والإنذارات', desc: 'تنبيه فوري عند تعطل /healthz أو أخطاء 5xx متكررة.', done: false },
  // 90 days: P2
  { id: 'pdpl_compliance',  phase: 'P2', title: 'الامتثال لـ PDPL', desc: 'تشفير الحقول الحساسة، حق المسح، سياسة الاحتفاظ، DPO.', done: false },
  { id: 'investor_class',   phase: 'P2', title: 'تصنيف المستثمر (تجزئة/مؤهل)', desc: 'سقوف استثمار حسب التصنيف، إعلان مصادر الأموال.', done: false },
  { id: 'sanctions_screen', phase: 'P2', title: 'فحص العقوبات وPEP', desc: 'OFAC، EU، UN، قوائم محلية، أشخاص ذوو مخاطر سياسية.', done: false },
  { id: 'sharia_audit',     phase: 'P2', title: 'سجل المراجعة الشرعية', desc: 'تتبع نسخ العقود مع معرف الفتوى لكل إصدار.', done: false },
  { id: 'test_suite',       phase: 'P2', title: 'مجموعة اختبارات (CI)', desc: 'اختبارات تكامل للتسجيل، KYC، الاستثمار، التوقيع.', done: false },
  { id: 'backups',          phase: 'P2', title: 'نسخ احتياطية واختبار استعادة', desc: 'نسخ يومية + اختبار استعادة ربع سنوي.', done: false },
  { id: 'pwa_push',         phase: 'P2', title: 'PWA + إشعارات Push', desc: 'Service worker + إشعارات على الجوال.', done: false },
];

const _launchPlan = () => {
  const stored = db.get().settings?.launchPlan;
  if (stored && Array.isArray(stored)) return stored;
  return DEFAULT_LAUNCH_PLAN.map(x => ({ ...x }));
};

R('GET', '/app/admin/launch-plan', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const items = _launchPlan();
  const total = items.length;
  const done = items.filter(i => i.done).length;
  return send(res, 200, { items, total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 });
});

R('PATCH', /^\/app\/admin\/launch-plan\/([^/]+)$/, async (req, res, m) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readJson(req);
  const id = m[1];
  const items = _launchPlan();
  const item = items.find(x => x.id === id);
  if (!item) return err(res, 404, 'not_found');
  if (typeof body?.done === 'boolean') item.done = body.done;
  if (typeof body?.title === 'string') item.title = body.title;
  if (typeof body?.desc === 'string') item.desc = body.desc;
  await db.update(d => {
    d.settings = d.settings || {};
    d.settings.launchPlan = items;
  });
  await audit(admin.id, 'launchplan.update', id, { done: item.done }, req);
  return send(res, 200, { item });
});

R('POST', '/app/admin/launch-plan/reset', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  await db.update(d => {
    d.settings = d.settings || {};
    d.settings.launchPlan = DEFAULT_LAUNCH_PLAN.map(x => ({ ...x }));
  });
  await audit(admin.id, 'launchplan.reset', 'all', {}, req);
  return send(res, 200, { ok: true });
});

R('GET', '/app/admin/login-attempts', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const limit = Math.min(parseInt(req.url.split('?')[1]?.match(/limit=(\d+)/)?.[1] || '100', 10), 500);
  const list = db.all('loginAttempts')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
  return send(res, 200, { attempts: list });
});

// ─── Dispatcher ───────────────────────────────────────────────────
// CSRF policy:
//  - GET requests: CSRF cookie is issued at the server.js layer (covers
//    static pages too). The dispatcher just re-issues if missing.
//  - State-changing requests (POST/PATCH/PUT/DELETE): require matching
//    X-CSRF-Token header. Login/register/forgot-password are exempted
//    because the first hit may not carry the cookie yet on some flows.
const CSRF_EXEMPT = new Set([
  '/app/auth/login',
  '/app/auth/login-2fa',
  '/app/auth/register',
  '/app/auth/forgot-password',
  '/app/auth/reset-password',
  '/app/auth/nafath',
  '/app/auth/magic-link',
  '/app/waitlist',
  '/app/help/contact',
]);

const handle = async (req, res, parsed) => {
  const { pathname } = parsed;
  const method = req.method;

  if (method === 'GET') {
    S.setCsrfCookieIfMissing(req, res);
  } else if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    if (pathname.startsWith('/app/') && !CSRF_EXEMPT.has(pathname) && !S.verifyCsrf(req)) {
      return err(res, 403, 'csrf_failed');
    }
  }

  for (const r of routes) {
    if (r.method !== method) continue;
    if (typeof r.pattern === 'string') {
      if (pathname === r.pattern) return r.handler(req, res);
    } else {
      const m = r.pattern.exec(pathname);
      if (m) return r.handler(req, res, m);
    }
  }
  return err(res, 404, 'not_found');
};

module.exports = { handle };
