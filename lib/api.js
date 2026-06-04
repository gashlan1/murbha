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
  kyc_out_of_order: 'يجب إكمال خطوات التحقق بالترتيب.',
  id_taken:         'رقم الهوية مُسجّل بحساب آخر.',
};

// ─── Helpers ──────────────────────────────────────────────────────
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const err = (res, status, code, extra = {}) =>
  send(res, status, { error: code, message: ARABIC[code] || code, ...extra });

const readJson = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
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
  return db.insert('notifications', {
    id: S.newId('ntf_'),
    userId, kind, title, body, meta,
    read: false,
    createdAt: now(),
  });
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
    console.log(`[sms-stub] OTP for ${phone}: ${mobileOtp.code} (TODO: wire SMS provider)`);
  }

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

  if (user.role !== 'admin' && !user.approved) {
    if (user.kycStatus === 'verified') {
      await recordFail('unapproved');
      return err(res, 403, 'unapproved_account');
    }
  }

  await db.insert('loginAttempts', {
    id: S.newId('att_'),
    identifier, ip, ua: req.headers['user-agent'] || null,
    userId: user.id, success: true, createdAt: now(),
  });
  S.setSessionCookie(res, user.id);
  return send(res, 200, { user: S.publicUser(user) });
});

R('POST', '/app/auth/logout', async (req, res) => {
  S.clearSessionCookie(res);
  return send(res, 200, { ok: true });
});

R('GET', '/app/auth/me', async (req, res) => {
  const user = S.currentUser(req);
  return send(res, 200, { user });
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
  const list = db.all('projects').map(p => ({
    ...p,
    fundedPct: p.goal > 0 ? Math.min(100, Math.round((p.raised / p.goal) * 100)) : 0,
  }));
  return send(res, 200, { projects: list });
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

  await db.update(d => {
    const ct = d.contracts.find(x => x.id === c.id);
    ct.status = 'signed';
    ct.signature = signature;
    ct.signedAt = now();
    const inv = d.investments.find(x => x.id === ct.investmentId);
    inv.status = 'pending_payment';
    inv.signedAt = now();
  });

  await notify(user.id, 'contract_signed', 'تم توقيع العقد بنجاح',
    'تم توقيع العقد بنجاح. يُرجى إكمال عملية الدفع لتنشيط الاستثمار.', { contractId: c.id });

  const updated = db.find('contracts', x => x.id === c.id);
  return send(res, 200, { contract: updated });
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
    console.log(`[sms-stub] OTP for ${fresh.phone}: ${code} (TODO: wire SMS provider)`);
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
  const taken = db.find('users', u => u.nationalId === nationalId && u.id !== user.id);
  if (taken) {
    return send(res, 409, { error: 'id_taken', message: 'رقم الهوية مُسجّل بحساب آخر.' });
  }

  await db.patch('users', u => u.id === user.id, { nationalId, kycStatus: 'id_verified' });
  return send(res, 200, { success: true });
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

R('POST', '/app/portfolio/deposit', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const amount = Number(body?.amount);
  const method = (body?.method || 'mada').toString();
  if (!(amount > 0) || amount < 100) return err(res, 400, 'invalid_input', { field: 'amount' });

  await db.update(d => {
    const u = d.users.find(x => x.id === user.id);
    u.balance = (u.balance || 0) + amount;
    d.transactions.push({
      id: S.newId('txn_'),
      userId: user.id,
      kind: 'deposit',
      amount,
      ref: method,
      description: `إيداع عبر ${method}`,
      createdAt: now(),
    });
  });

  await notify(user.id, 'deposit', 'تم الإيداع',
    `تم إضافة ${amount.toLocaleString('ar-SA')} ر.س. إلى رصيدك.`);

  const fresh = db.find('users', u => u.id === user.id);
  return send(res, 200, { balance: fresh.balance });
});

R('POST', '/app/portfolio/withdraw', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const body = await readJson(req);
  const amount = Number(body?.amount);
  if (!(amount > 0)) return err(res, 400, 'invalid_input');

  const fresh = db.find('users', u => u.id === user.id);
  if ((fresh.balance || 0) < amount) return err(res, 400, 'insufficient');

  await db.update(d => {
    const u = d.users.find(x => x.id === user.id);
    u.balance -= amount;
    d.transactions.push({
      id: S.newId('txn_'),
      userId: user.id,
      kind: 'withdraw',
      amount: -amount,
      ref: 'iban',
      description: 'سحب إلى الحساب البنكي',
      createdAt: now(),
    });
  });
  await notify(user.id, 'withdraw', 'تم تقديم طلب السحب',
    `سيتم تحويل ${amount.toLocaleString('ar-SA')} ر.س. إلى حسابك خلال ١-٣ أيام عمل.`);

  return send(res, 200, { balance: (db.find('users', u => u.id === user.id)).balance });
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

R('GET', '/app/admin/users', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const list = db.all('users').map(u => S.publicUser(u));
  return send(res, 200, { users: list });
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
  });
  await audit(admin.id, 'settings.update', 'settings', Object.keys(body), req);
  return send(res, 200, _settings());
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

R('GET', '/app/admin/login-attempts', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const limit = Math.min(parseInt(req.url.split('?')[1]?.match(/limit=(\d+)/)?.[1] || '100', 10), 500);
  const list = db.all('loginAttempts')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
  return send(res, 200, { attempts: list });
});

// ─── Dispatcher ───────────────────────────────────────────────────
const handle = async (req, res, parsed) => {
  const { pathname } = parsed;
  const method = req.method;
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
