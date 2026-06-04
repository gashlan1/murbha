/**
 * Resend email sender. No SDK — uses fetch against api.resend.com.
 *
 * Environment:
 *   RESEND_API_KEY        Resend API key. If unset, sends are no-ops and
 *                         the rendered email is logged to stdout (dev).
 *   RESEND_FROM           Default sender (e.g. "Murbha <noreply@murbha.sa>").
 *                         Defaults to "onboarding@resend.dev" (Resend's test
 *                         sender; only delivers to your verified account email).
 *   APP_PUBLIC_URL        Used in templated links. Defaults to current host.
 */
'use strict';

const RESEND_API = 'https://api.resend.com/emails';

const cfg = () => ({
  apiKey: process.env.RESEND_API_KEY || '',
  from:   process.env.RESEND_FROM || 'Murbha <onboarding@resend.dev>',
  appUrl: process.env.APP_PUBLIC_URL || '',
});

const send = async ({ to, subject, html, text }) => {
  const { apiKey, from } = cfg();
  if (!apiKey) {
    console.log(`[mailer] (dry-run, no RESEND_API_KEY) → ${to}: ${subject}`);
    if (text) console.log(`[mailer] text:\n${text}`);
    return { ok: true, dryRun: true };
  }
  try {
    const r = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[mailer] resend error', r.status, data);
      return { ok: false, status: r.status, error: data };
    }
    console.log(`[mailer] sent → ${to} [${data.id}] ${subject}`);
    return { ok: true, id: data.id };
  } catch (e) {
    console.error('[mailer] send failed', e.message);
    return { ok: false, error: e.message };
  }
};

// ─── Templates ────────────────────────────────────────────────────
const wrapper = (innerHtml) => `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#fbf6ea;font-family:'Tajawal','Cairo','Helvetica Neue',Arial,sans-serif;color:#0d1612;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fbf6ea;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid rgba(13,22,18,0.08);">
        <tr><td style="background:#062b1e;color:#fbf6ea;padding:24px 24px 20px;text-align:center;">
          <div style="font-family:'Cairo','Tajawal',sans-serif;font-weight:900;font-size:22px;letter-spacing:-0.5px;">منصة مُرابحة</div>
          <div style="font-size:12px;color:#d4ac6e;margin-top:4px;">منصة الشراكة الاستثمارية الشرعية</div>
        </td></tr>
        <tr><td style="padding:28px 28px 24px;">${innerHtml}</td></tr>
        <tr><td style="background:#fbf6ea;color:#6b7268;padding:16px 24px;text-align:center;font-size:11px;line-height:1.6;border-top:1px solid rgba(13,22,18,0.06);">
          © 2026 منصة مُرابحة — مُدارة بواسطة شركة العنقري<br/>
          هذه الرسالة آلية، يرجى عدم الرد عليها.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

const otpTemplate = (code, purpose = 'البريد الإلكتروني') => {
  const innerHtml = `
    <p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#0d1612;">مرحباً،</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#0d1612;">رمز التحقق الخاص بك للتحقق من ${purpose} هو:</p>
    <div style="background:#fbf6ea;border:1px dashed #b08840;border-radius:12px;padding:18px;text-align:center;margin:0 0 20px;">
      <div style="font-family:'SF Mono',Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:#062b1e;">${code}</div>
    </div>
    <p style="margin:0 0 8px;font-size:13px;color:#6b7268;line-height:1.7;">هذا الرمز صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.</p>
    <p style="margin:16px 0 0;font-size:12px;color:#6b7268;line-height:1.6;">إذا لم تكن أنت من طلب هذا الرمز، يمكنك تجاهل هذه الرسالة.</p>
  `;
  const text = `رمز التحقق من ${purpose}: ${code}\n\nصالح لمدة 10 دقائق. لا تشاركه مع أي شخص.\n\nإذا لم تكن أنت من طلب هذا الرمز، يمكنك تجاهل هذه الرسالة.\n— منصة مُرابحة`;
  return { html: wrapper(innerHtml), text };
};

const welcomeTemplate = (name) => {
  const innerHtml = `
    <p style="margin:0 0 12px;font-size:15px;line-height:1.7;">مرحباً ${name || 'بك'} 👋</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">تم إنشاء حسابك في منصة مُرابحة بنجاح. الخطوة التالية هي إكمال التحقق من هويتك (KYC) خلال 4 خطوات سريعة:</p>
    <ol style="margin:0 0 20px 20px;padding:0;font-size:14px;line-height:1.9;color:#0d1612;">
      <li>التحقق من البريد الإلكتروني</li>
      <li>التحقق من رقم الجوال</li>
      <li>التحقق من الهوية الوطنية</li>
      <li>التحقق من العنوان الوطني</li>
    </ol>
    <p style="margin:0;font-size:13px;color:#6b7268;line-height:1.7;">بعد إكمال التحقق، ستتم مراجعة حسابك من قبل الإدارة قبل تفعيل الاستثمار.</p>
  `;
  const text = `مرحباً ${name || 'بك'}\n\nتم إنشاء حسابك في منصة مُرابحة بنجاح.\nالخطوة التالية: أكمل التحقق من هويتك (KYC) خلال 4 خطوات.\n\n— منصة مُرابحة`;
  return { html: wrapper(innerHtml), text };
};

const rejectedTemplate = (reason) => {
  const innerHtml = `
    <p style="margin:0 0 12px;font-size:15px;line-height:1.7;">السلام عليكم،</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">نأسف لإبلاغك بأن طلب فتح حسابك في منصة مُرابحة لم تتم الموافقة عليه.</p>
    ${reason ? `<div style="background:#fbf6ea;border-inline-start:3px solid #b08840;padding:14px 16px;border-radius:8px;margin:0 0 16px;"><div style="font-size:12px;color:#6b7268;margin-bottom:4px;">سبب الرفض</div><div style="font-size:14px;color:#0d1612;line-height:1.7;">${reason}</div></div>` : ''}
    <p style="margin:0;font-size:13px;color:#6b7268;line-height:1.7;">إذا كنت تعتقد أن هذا قرار غير صحيح، يرجى التواصل مع فريق الدعم.</p>
  `;
  const text = `السلام عليكم،\n\nنأسف لإبلاغك بأن طلب فتح حسابك في منصة مُرابحة لم تتم الموافقة عليه.${reason ? `\n\nسبب الرفض: ${reason}` : ''}\n\nللتواصل مع الدعم، راسلنا على support@murbha.sa\n\n— منصة مُرابحة`;
  return { html: wrapper(innerHtml), text };
};

module.exports = {
  send,
  otpTemplate,
  welcomeTemplate,
  rejectedTemplate,
};
