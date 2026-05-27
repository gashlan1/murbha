// Returns null when valid, or an Arabic error string when invalid.
function validateUsername(username) {
  if (typeof username !== 'string') return 'اسم المستخدم مطلوب';
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
    return 'اسم المستخدم يجب أن يكون ٣-٣٢ حرفاً (أحرف وأرقام و_ فقط)';
  }
  return null;
}

function validatePassword(password) {
  if (typeof password !== 'string') return 'كلمة المرور مطلوبة';
  if (password.length < 8) return 'كلمة المرور يجب أن تكون ٨ أحرف على الأقل';
  return null;
}

// Normalizes a Saudi mobile number to the canonical +9665XXXXXXXX form.
// Accepts: 05XXXXXXXX, 5XXXXXXXX, 9665XXXXXXXX, +9665XXXXXXXX, with optional spaces/dashes.
// Returns the normalized string when valid, null when not.
function normalizeMobile(mobile) {
  if (typeof mobile !== 'string') return null;
  // Convert Arabic-Indic digits to Latin, strip spaces and dashes.
  const arDigits = '٠١٢٣٤٥٦٧٨٩';
  const latin = mobile.replace(/[٠-٩]/g, d => arDigits.indexOf(d)).replace(/[\s-]/g, '');
  let m = latin;
  if (m.startsWith('00966')) m = '+966' + m.slice(5);
  if (m.startsWith('966'))   m = '+966' + m.slice(3);
  if (m.startsWith('05'))    m = '+966' + m.slice(1);
  if (m.startsWith('5'))     m = '+966' + m;
  if (!/^\+9665\d{8}$/.test(m)) return null;
  return m;
}

function validateMobile(mobile) {
  if (!normalizeMobile(mobile)) return 'رقم الجوال يجب أن يكون رقماً سعودياً صالحاً (يبدأ بـ 05)';
  return null;
}

function validateEmail(email) {
  if (typeof email !== 'string') return 'البريد الإلكتروني مطلوب';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'البريد الإلكتروني غير صالح';
  if (email.length > 254) return 'البريد الإلكتروني طويل جداً';
  return null;
}

module.exports = { validateUsername, validatePassword, validateMobile, validateEmail, normalizeMobile };
