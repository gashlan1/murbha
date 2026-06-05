/**
 * Daily admin digest email.
 *
 * On a timer (default once every 24h), sends each admin a summary of:
 *   - users awaiting approval (KYC verified, awaiting admin sign-off)
 *   - pending qualification requests
 *   - sanctions hits (unreviewed)
 *   - active investments in last 24h
 *
 * Opt-in via DIGEST_ENABLED=true. Disabled in tests/dev to keep
 * inboxes quiet.
 */
'use strict';

const isEnabled = () => process.env.DIGEST_ENABLED === 'true';

const buildSummary = (db) => {
  const users = db.all('users');
  const pendingApproval = users.filter(u => u.role !== 'admin' && !u.approved && !u.rejected && u.kycStatus === 'verified');
  const pendingQualify  = users.filter(u => u.qualificationRequest?.status === 'pending');
  const sanctionsHits   = users.filter(u => u.sanctionsScreen && !u.sanctionsScreen.clean && !u.sanctionsReviewedAt);
  const last24h = Date.now() - 24 * 60 * 60 * 1000;
  const recentInvestments = db.filter('investments', i => new Date(i.createdAt).getTime() > last24h);
  const recentRegistrations = users.filter(u => new Date(u.createdAt).getTime() > last24h);
  return {
    pendingApprovalCount: pendingApproval.length,
    pendingApproval: pendingApproval.slice(0, 10).map(u => ({ id: u.id, name: u.name, email: u.email })),
    pendingQualifyCount: pendingQualify.length,
    sanctionsHitsCount: sanctionsHits.length,
    sanctionsHits: sanctionsHits.slice(0, 10).map(u => ({ id: u.id, name: u.name, email: u.email })),
    recentInvestmentsCount: recentInvestments.length,
    recentInvestmentsSum: recentInvestments.reduce((s, i) => s + (i.amount || 0), 0),
    recentRegistrationsCount: recentRegistrations.length,
  };
};

const renderHtml = (s) => `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#fbf6ea;font-family:Tajawal,Cairo,Helvetica Neue,Arial,sans-serif;color:#0d1612;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fbf6ea;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid rgba(13,22,18,0.08);">
        <tr><td style="background:#062b1e;color:#fbf6ea;padding:24px;text-align:center;">
          <div style="font:900 22px Cairo,sans-serif;letter-spacing:-0.5px;">منصة مُرابحة — ملخص اليوم</div>
        </td></tr>
        <tr><td style="padding:24px;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="padding:12px;background:rgba(176,136,64,0.08);border-radius:10px;width:33%;">
                <div style="font-size:11px;color:#6b7268;">بانتظار الموافقة</div>
                <div style="font:900 22px Cairo,sans-serif;color:#062b1e;">${s.pendingApprovalCount}</div>
              </td>
              <td style="width:8px;"></td>
              <td style="padding:12px;background:rgba(15,110,58,0.08);border-radius:10px;width:33%;">
                <div style="font-size:11px;color:#6b7268;">طلبات تأهيل</div>
                <div style="font:900 22px Cairo,sans-serif;color:#062b1e;">${s.pendingQualifyCount}</div>
              </td>
              <td style="width:8px;"></td>
              <td style="padding:12px;background:rgba(197,74,58,0.08);border-radius:10px;width:33%;">
                <div style="font-size:11px;color:#6b7268;">⚠ مطابقات حظر</div>
                <div style="font:900 22px Cairo,sans-serif;color:#c54a3a;">${s.sanctionsHitsCount}</div>
              </td>
            </tr>
          </table>
          <div style="margin-top:18px;padding:14px;background:#fbf6ea;border:1px solid rgba(13,22,18,0.08);border-radius:10px;">
            <div style="font:800 14px Cairo,sans-serif;color:#062b1e;margin-bottom:6px;">آخر ٢٤ ساعة</div>
            <div style="font-size:13px;color:#0d1612;">${s.recentRegistrationsCount} حساب جديد · ${s.recentInvestmentsCount} استثمار جديد بإجمالي ${s.recentInvestmentsSum.toLocaleString('ar-SA')} ر.س</div>
          </div>
        </td></tr>
        <tr><td style="background:#fbf6ea;color:#6b7268;padding:14px;text-align:center;font-size:11px;line-height:1.6;">
          هذه رسالة آلية. للوصول إلى لوحة التحكم: <a href="https://murbha.sa/admin.html" style="color:#062b1e;">admin.html</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

const sendDigest = async ({ db, mailer }) => {
  const summary = buildSummary(db);
  if (summary.pendingApprovalCount + summary.pendingQualifyCount + summary.sanctionsHitsCount + summary.recentInvestmentsCount === 0) {
    return { ok: true, skipped: 'empty' };
  }
  const admins = db.all('users').filter(u => u.role === 'admin' && u.email);
  let sent = 0;
  for (const a of admins) {
    const r = await mailer.send({
      to: a.email,
      subject: 'مُرابحة — ملخص اليوم (' + new Date().toLocaleDateString('ar-SA') + ')',
      html: renderHtml(summary),
      text: `ملخص اليوم — منصة مُرابحة\n\nبانتظار الموافقة: ${summary.pendingApprovalCount}\nطلبات تأهيل: ${summary.pendingQualifyCount}\nمطابقات حظر: ${summary.sanctionsHitsCount}\nآخر 24س: ${summary.recentRegistrationsCount} تسجيل، ${summary.recentInvestmentsCount} استثمار بإجمالي ${summary.recentInvestmentsSum.toLocaleString('ar-SA')} ر.س`,
    });
    if (r.ok) sent++;
  }
  return { ok: true, sent, admins: admins.length, summary };
};

let _timer = null;
const start = ({ db, mailer }) => {
  if (_timer) return;
  if (!isEnabled()) {
    console.log('[digest] disabled (set DIGEST_ENABLED=true to enable)');
    return;
  }
  const intervalMin = Math.max(60, parseInt(process.env.DIGEST_INTERVAL_MIN || '1440', 10));
  const intervalMs = intervalMin * 60_000;
  const tick = async () => {
    try {
      const r = await sendDigest({ db, mailer });
      if (r.skipped) console.log('[digest] skipped (empty summary)');
      else console.log(`[digest] sent to ${r.sent}/${r.admins} admin(s)`);
    } catch (e) { console.error('[digest] tick failed:', e.message); }
  };
  setTimeout(tick, 120_000);
  _timer = setInterval(tick, intervalMs);
  _timer.unref?.();
  console.log(`[digest] enabled, interval ${intervalMin}m`);
};

const stop = () => { if (_timer) { clearInterval(_timer); _timer = null; } };

module.exports = { isEnabled, buildSummary, renderHtml, sendDigest, start, stop };
