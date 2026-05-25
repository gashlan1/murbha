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

module.exports = { validateUsername, validatePassword };
