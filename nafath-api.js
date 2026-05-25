/**
 * Nafath API Integration — مُرابحة
 * App ID:  fu5ofq88
 * App Key: a79fe84a66f34f76bb63dbba04b7eaa2
 */
const NafathAPI = (() => {
  const CONFIG = {
    APP_ID:   'fu5ofq88',
    APP_KEY:  'a79fe84a66f34f76bb63dbba04b7eaa2',
    BASE_URL: 'https://mock-service.api.elm.sa',
    LOCALE:   'ar',
    SERVICE:  'Murabaha_Login',
    POLL_INTERVAL_MS: 3000,
    POLL_TIMEOUT_MS:  120000,
  };

  const _headers = (extra = {}) => ({
    'Content-Type': 'application/json',
    'APP-ID':  CONFIG.APP_ID,
    'APP-KEY': CONFIG.APP_KEY,
    'app_id':  CONFIG.APP_ID,
    'app_key': CONFIG.APP_KEY,
    ...extra,
  });

  const ERRORS = {
    NETWORK:    'تعذّر الاتصال بالخادم. تحقق من الإنترنت.',
    INVALID_ID: 'رقم الهوية غير صحيح. يجب أن يبدأ بـ ١ أو ٢ ومكوّن من ١٠ أرقام.',
    WAITING:    'في انتظار موافقتك على تطبيق نفاذ…',
    EXPIRED:    'انتهت صلاحية الطلب. يرجى المحاولة مجدداً.',
    REJECTED:   'رُفض الطلب على تطبيق نفاذ.',
    TIMEOUT:    'انتهت مهلة الانتظار.',
    JWT_INVALID:'فشل التحقق من الرمز.',
    SERVER:     'خطأ في الخادم.',
    UNKNOWN:    'حدث خطأ غير متوقع.',
  };

  class NafathError extends Error {
    constructor(code, detail = '') {
      super(ERRORS[code] || ERRORS.UNKNOWN);
      this.code = code; this.detail = detail;
      this.nameAr = ERRORS[code] || ERRORS.UNKNOWN;
    }
  }

  const validateNationalId = id => /^[1234569]{1}\d{9}$/.test(id.replace(/\s/g,''));

  const _requestId = () => `MRB-${Date.now()}-${Math.random().toString(36).substring(2,8).toUpperCase()}`;

  const _fetch = async (path, options = {}) => {
    try {
      const res = await fetch(`${CONFIG.BASE_URL}${path}`, {
        ...options, headers: _headers(options.headers || {}),
      });
      if (!res.ok) throw new NafathError('SERVER', `HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      return ct.includes('application/json') ? res.json() : res.text();
    } catch(e) {
      if (e instanceof NafathError) throw e;
      throw new NafathError('NETWORK', e.message);
    }
  };

  const sendMfaRequest = async (nationalId) => {
    if (!validateNationalId(nationalId)) throw new NafathError('INVALID_ID');
    const reqId = _requestId();
    const data = await _fetch(
      `/api/v1/nfa/request?local=${CONFIG.LOCALE}&requestId=${reqId}`,
      { method: 'POST', body: JSON.stringify({ nationalId: nationalId.trim(), service: CONFIG.SERVICE }) }
    );
    sessionStorage.setItem('nafath_transId', data.transId);
    sessionStorage.setItem('nafath_random', data.random);
    sessionStorage.setItem('nafath_nationalId', nationalId.trim());
    return { transId: data.transId, random: data.random };
  };

  const getMfaStatus = async () => {
    const nationalId = sessionStorage.getItem('nafath_nationalId');
    const transId    = sessionStorage.getItem('nafath_transId');
    const random     = sessionStorage.getItem('nafath_random');
    const data = await _fetch('/api/v1/nfa/request/status', {
      method: 'POST', body: JSON.stringify({ nationalId, transId, random })
    });
    return { status: data.status };
  };

  const pollMfaStatus = ({ onWaiting, onCompleted, onRejected, onExpired, onError } = {}) => {
    let cancelled = false, elapsed = 0;
    const poll = async () => {
      if (cancelled) return;
      if (elapsed >= CONFIG.POLL_TIMEOUT_MS) { onError?.(new NafathError('TIMEOUT')); return; }
      try {
        const { status } = await getMfaStatus();
        if      (status === 'WAITING')   { onWaiting?.(status); }
        else if (status === 'COMPLETED') { _clear(); onCompleted?.(status); return; }
        else if (status === 'REJECTED')  { _clear(); onRejected?.(new NafathError('REJECTED')); return; }
        else if (status === 'EXPIRED')   { _clear(); onExpired?.(new NafathError('EXPIRED')); return; }
      } catch(e) { onError?.(e); return; }
      elapsed += CONFIG.POLL_INTERVAL_MS;
      if (!cancelled) setTimeout(poll, CONFIG.POLL_INTERVAL_MS);
    };
    poll();
    return () => { cancelled = true; };
  };

  const getOidcSession = async () => {
    const reqId = _requestId();
    const data = await _fetch(`/stg/api/v2/oidc/session?locale=${CONFIG.LOCALE}&requestId=${reqId}`, { method: 'GET' });
    sessionStorage.setItem('nafath_oidc_state', data.hashedState);
    return { url: data.url, hashedState: data.hashedState };
  };

  const getJwt = async (state) => {
    const data = await _fetch('/stg/api/v2/oidc/jwt', { method: 'POST', body: JSON.stringify({ state }) });
    sessionStorage.setItem('nafath_jwt', data.token);
    return { state: data.state, token: data.token };
  };

  const validateJwt = async (idToken) => {
    const result = await _fetch('/stg/api/v2/oidc/jwt/valid', { method: 'POST', body: JSON.stringify({ id_token: idToken }) });
    if (result !== true && result !== 'true') throw new NafathError('JWT_INVALID');
    return true;
  };

  const handleOidcCallback = async ({ onSuccess, onError } = {}) => {
    const state = new URLSearchParams(window.location.search).get('state');
    if (!state) return false;
    try {
      const { token } = await getJwt(state);
      await validateJwt(token);
      onSuccess?.({ token, state });
      window.history.replaceState({}, '', window.location.pathname);
    } catch(e) { onError?.(e); }
    return true;
  };

  const _clear = () => ['nafath_transId','nafath_random','nafath_nationalId','nafath_oidc_state']
    .forEach(k => sessionStorage.removeItem(k));

  const toArabicDigits = str => String(str).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

  return { sendMfaRequest, getMfaStatus, pollMfaStatus, getOidcSession, getJwt, validateJwt,
           handleOidcCallback, validateNationalId, toArabicDigits, ERRORS, NafathError, CONFIG };
})();

if (typeof window !== 'undefined') window.NafathAPI = NafathAPI;
if (typeof module !== 'undefined' && module.exports) module.exports = NafathAPI;
