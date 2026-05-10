/**
 * ┌─────────────────────────────────────────────┐
 * │     Nafath API Integration — مُرابحة         │
 * │     Powered by ELM / Rabet Solutions         │
 * │     v1.0.0 — 2026                            │
 * └─────────────────────────────────────────────┘
 *
 * Two authentication flows:
 *  1. MFA Flow    (mobile) — request → show random code → poll status
 *  2. OIDC Flow   (web)    — session URL → redirect → JWT → validate
 */

const NafathAPI = (() => {

  // ─── Configuration ──────────────────────────────────────────────
  // Requests go through our same-origin backend proxy (server.js),
  // which injects APP_ID / APP_KEY server-side and forwards to ELM.
  // This keeps credentials out of the browser and avoids CORS.
  const CONFIG = {
    BASE_URL: '',                                  // same origin → backend proxy
    LOCALE:   'ar',
    SERVICE:  'Murabaha_Login',                    // service identifier registered with ELM
    POLL_INTERVAL_MS: 3000,                        // poll every 3 seconds
    POLL_TIMEOUT_MS:  120000,                      // give up after 2 minutes
  };

  // ─── Common headers ─────────────────────────────────────────────
  // Credentials are NOT sent from the browser. The backend proxy
  // attaches APP-ID / APP-KEY before forwarding to ELM upstream.
  const _headers = (extra = {}) => ({
    'Content-Type': 'application/json',
    'Accept':       'application/json',
    ...extra,
  });

  // ─── Arabic error messages ───────────────────────────────────────
  const ERRORS = {
    NETWORK:       'تعذّر الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت والمحاولة مجدداً.',
    INVALID_ID:    'رقم الهوية غير صحيح. يجب أن يبدأ بـ ١ أو ٢ ومكوّن من ١٠ أرقام.',
    WAITING:       'في انتظار موافقتك على تطبيق نفاذ…',
    EXPIRED:       'انتهت صلاحية الطلب. يرجى المحاولة مجدداً.',
    REJECTED:      'رفضت الطلب على تطبيق نفاذ. يرجى المحاولة مجدداً إذا كان ذلك خطأً.',
    TIMEOUT:       'انتهت مهلة الانتظار. يرجى المحاولة مجدداً.',
    JWT_INVALID:   'فشل التحقق من الرمز المؤمَّن. يرجى تسجيل الدخول مجدداً.',
    SERVER:        'خطأ في الخادم. يرجى المحاولة لاحقاً.',
    UNKNOWN:       'حدث خطأ غير متوقع. يرجى المحاولة مجدداً.',
  };

  // ─── Validate Saudi national ID format ──────────────────────────
  const validateNationalId = (id) => {
    const clean = id.replace(/\s/g, '');
    return /^[1234569]{1}\d{9}$/.test(clean);
  };

  // ─── Generate unique requestId ───────────────────────────────────
  const _requestId = () =>
    `MRB-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  // ─── Generic fetch wrapper ───────────────────────────────────────
  const _fetch = async (path, options = {}) => {
    const url = `${CONFIG.BASE_URL}${path}`;
    try {
      const response = await fetch(url, {
        ...options,
        headers: _headers(options.headers || {}),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new NafathError(
          options._errKey || 'SERVER',
          `HTTP ${response.status}: ${text}`
        );
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return await response.json();
      }
      return await response.text();

    } catch (err) {
      if (err instanceof NafathError) throw err;
      throw new NafathError('NETWORK', err.message);
    }
  };

  // ─── Custom error class ──────────────────────────────────────────
  class NafathError extends Error {
    constructor(code, detail = '') {
      super(ERRORS[code] || ERRORS.UNKNOWN);
      this.code    = code;
      this.detail  = detail;
      this.nameAr  = ERRORS[code] || ERRORS.UNKNOWN;
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  FLOW 1 — MFA (Mobile) Flow
  //  Step A: send request  →  returns { transId, random }
  //  Step B: show random to user  →  they approve in Nafath app
  //  Step C: poll status  →  wait for COMPLETED
  // ════════════════════════════════════════════════════════════════

  /**
   * Step A — Send MFA Request
   * @param {string} nationalId - Saudi national ID (10 digits)
   * @returns {Promise<{transId: string, random: string}>}
   */
  const sendMfaRequest = async (nationalId) => {
    if (!validateNationalId(nationalId)) {
      throw new NafathError('INVALID_ID');
    }

    const reqId = _requestId();
    const data = await _fetch(
      `/api/v1/mfa/request?local=${CONFIG.LOCALE}&requestId=${reqId}`,
      {
        method: 'POST',
        body: JSON.stringify({
          nationalId: nationalId.trim(),
          service:    CONFIG.SERVICE,
        }),
      }
    );

    // Store for later status polling
    sessionStorage.setItem('nafath_transId',    data.transId);
    sessionStorage.setItem('nafath_random',     data.random);
    sessionStorage.setItem('nafath_nationalId', nationalId.trim());
    sessionStorage.setItem('nafath_requestId',  reqId);

    return {
      transId:   data.transId,
      random:    data.random,
      requestId: reqId,
    };
  };

  /**
   * Step C — Get MFA Request Status (single call)
   * @returns {Promise<{status: 'WAITING'|'EXPIRED'|'REJECTED'|'COMPLETED'}>}
   */
  const getMfaStatus = async () => {
    const nationalId = sessionStorage.getItem('nafath_nationalId');
    const transId    = sessionStorage.getItem('nafath_transId');
    const random     = sessionStorage.getItem('nafath_random');

    if (!nationalId || !transId || !random) {
      throw new NafathError('UNKNOWN', 'Missing session data — call sendMfaRequest first');
    }

    const data = await _fetch('/api/v1/mfa/request/status', {
      method: 'POST',
      body: JSON.stringify({ nationalId, transId, random }),
    });

    return { status: data.status };
  };

  /**
   * Step B+C Combined — Poll until COMPLETED, REJECTED, or EXPIRED
   * @param {Object} callbacks
   * @param {Function} callbacks.onWaiting   - called while waiting
   * @param {Function} callbacks.onCompleted - called on success, receives status data
   * @param {Function} callbacks.onRejected  - called if user rejects
   * @param {Function} callbacks.onExpired   - called if request expired
   * @param {Function} callbacks.onError     - called on network error
   * @returns {Function} cancel - call to stop polling
   */
  const pollMfaStatus = ({ onWaiting, onCompleted, onRejected, onExpired, onError } = {}) => {
    let cancelled   = false;
    let elapsed     = 0;

    const poll = async () => {
      if (cancelled) return;

      if (elapsed >= CONFIG.POLL_TIMEOUT_MS) {
        onError?.(new NafathError('TIMEOUT'));
        return;
      }

      try {
        const { status } = await getMfaStatus();

        switch (status) {
          case 'WAITING':
            onWaiting?.(status);
            break;
          case 'COMPLETED':
            _clearSession();
            onCompleted?.(status);
            return;
          case 'REJECTED':
            _clearSession();
            onRejected?.(new NafathError('REJECTED'));
            return;
          case 'EXPIRED':
            _clearSession();
            onExpired?.(new NafathError('EXPIRED'));
            return;
          default:
            onWaiting?.(status);
        }
      } catch (err) {
        onError?.(err);
        return; // stop polling on network error
      }

      elapsed += CONFIG.POLL_INTERVAL_MS;
      if (!cancelled) {
        setTimeout(poll, CONFIG.POLL_INTERVAL_MS);
      }
    };

    // Start first poll immediately
    poll();

    // Return cancel function
    return () => { cancelled = true; };
  };

  // ════════════════════════════════════════════════════════════════
  //  FLOW 2 — OIDC Web Flow
  //  Step A: get session URL  →  redirect user to Nafath page
  //  Step B: user comes back with ?state=xxx in URL
  //  Step C: exchange state for JWT token
  //  Step D: validate the JWT
  // ════════════════════════════════════════════════════════════════

  /**
   * Step A — Get OIDC Session URL
   * Redirect the user to the returned URL (Nafath hosted page)
   * @returns {Promise<{url: string, hashedState: string, id: number, requestId: string}>}
   */
  const getOidcSession = async () => {
    const reqId = _requestId();
    const data = await _fetch(
      `/stg/api/v2/oidc/session?locale=${CONFIG.LOCALE}&requestId=${reqId}`,
      { method: 'GET' }
    );

    sessionStorage.setItem('nafath_oidc_state',    data.hashedState);
    sessionStorage.setItem('nafath_oidc_requestId', reqId);

    return {
      url:         data.url,
      hashedState: data.hashedState,
      id:          data.id,
      requestId:   reqId,
    };
  };

  /**
   * Step C — Exchange state for JWT token
   * Call after redirect back with ?state=xxx in URL
   * @param {string} state - the state parameter from callback URL
   * @returns {Promise<{state: string, token: string}>}
   */
  const getJwt = async (state) => {
    const data = await _fetch('/stg/api/v2/oidc/jwt', {
      method: 'POST',
      body: JSON.stringify({ state }),
    });

    sessionStorage.setItem('nafath_jwt', data.token);
    return { state: data.state, token: data.token };
  };

  /**
   * Step D — Validate JWT token
   * @param {string} idToken - JWT token from getJwt()
   * @returns {Promise<boolean>}
   */
  const validateJwt = async (idToken) => {
    const result = await _fetch('/stg/api/v2/oidc/jwt/valid', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken }),
    });

    // API returns boolean true/false
    if (result !== true && result !== 'true') {
      throw new NafathError('JWT_INVALID');
    }
    return true;
  };

  /**
   * Retrieve JWK (public key for local JWT verification)
   * @returns {Promise<object>} JWK key data
   */
  const getJwk = async () => {
    return await _fetch('/api/v1/mfa/jwk', { method: 'GET' });
  };

  /**
   * Full OIDC Web flow helper — checks callback URL on page load
   * If ?state= is present in URL → auto-completes the OIDC flow
   * @param {Object} callbacks
   * @param {Function} callbacks.onSuccess  - called with { token, state }
   * @param {Function} callbacks.onError    - called with NafathError
   */
  const handleOidcCallback = async ({ onSuccess, onError } = {}) => {
    const params = new URLSearchParams(window.location.search);
    const state  = params.get('state');

    if (!state) return false; // no callback, not an OIDC redirect

    try {
      const { token } = await getJwt(state);
      await validateJwt(token);
      onSuccess?.({ token, state });
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    } catch (err) {
      onError?.(err);
    }
    return true;
  };

  // ─── Helpers ────────────────────────────────────────────────────
  const _clearSession = () => {
    ['nafath_transId', 'nafath_random', 'nafath_nationalId', 'nafath_requestId',
     'nafath_oidc_state', 'nafath_oidc_requestId'].forEach(k => sessionStorage.removeItem(k));
  };

  /** Convert Latin digits to Arabic-Indic */
  const toArabicDigits = (str) =>
    String(str).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

  /** Convert Arabic-Indic digits to Latin */
  const toLatinDigits = (str) =>
    String(str).replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

  // ─── Public API ──────────────────────────────────────────────────
  return {
    // MFA Flow
    sendMfaRequest,
    getMfaStatus,
    pollMfaStatus,

    // OIDC Web Flow
    getOidcSession,
    getJwt,
    validateJwt,
    getJwk,
    handleOidcCallback,

    // Utilities
    validateNationalId,
    toArabicDigits,
    toLatinDigits,
    ERRORS,
    NafathError,
    CONFIG,
  };

})();

// Make available globally and as ES module default if supported
if (typeof window !== 'undefined') window.NafathAPI = NafathAPI;
if (typeof module !== 'undefined' && module.exports) module.exports = NafathAPI;
