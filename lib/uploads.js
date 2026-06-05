/**
 * Local-disk file uploads. MVP storage.
 *
 * Files land under data/uploads/<userId>/<kind>/<rand>.<ext>. The path is
 * stored on the user record; the actual binary stays out of db.json.
 *
 * To swap to S3/R2 later: change `persist()` to upload + return the URL
 * and (optionally) `delete()` to remove. The route layer is unaware of
 * the storage backend.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOADS_DIR = path.join(process.env.MURBHA_DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads');
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB raw
const ALLOWED_KINDS = new Set(['id_front', 'id_back', 'selfie', 'address_proof', 'project_doc', 'avatar', 'project_image']);

// magic-byte sniff (first 12 bytes) → mime
const sniffMime = (buf) => {
  if (buf.length < 4) return null;
  // JPEG
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  // WebP: 'RIFF'…'WEBP'
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  // PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf';
  // HEIC / HEIF (ISO base media: 'ftypheic' or 'ftypheix')
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.slice(8, 12).toString('ascii');
    if (['heic', 'heix', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
  }
  return null;
};

const extFor = (mime) => ({
  'image/jpeg':      '.jpg',
  'image/png':       '.png',
  'image/webp':      '.webp',
  'application/pdf': '.pdf',
  'image/heic':      '.heic',
}[mime] || '.bin');

const _ensureUserDir = (userId, kind) => {
  const dir = path.join(UPLOADS_DIR, String(userId).replace(/[^a-z0-9_-]/gi, ''), kind);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * Persist a base64-encoded payload.
 * @param {string} userId
 * @param {string} kind one of ALLOWED_KINDS
 * @param {string} base64
 * @returns {{ok:true, relPath, size, mime} | {ok:false, error}}
 */
const persist = (userId, kind, base64) => {
  if (!ALLOWED_KINDS.has(kind)) return { ok: false, error: 'invalid_kind' };
  if (typeof base64 !== 'string' || base64.length < 16) return { ok: false, error: 'invalid_input' };
  // strip data: prefix if present
  const cleaned = base64.replace(/^data:[^;]+;base64,/, '');
  let buf;
  try { buf = Buffer.from(cleaned, 'base64'); }
  catch { return { ok: false, error: 'invalid_input' }; }
  if (!buf.length || buf.length > MAX_BYTES) return { ok: false, error: 'too_large' };
  const mime = sniffMime(buf);
  if (!mime) return { ok: false, error: 'invalid_file_type' };

  const dir = _ensureUserDir(userId, kind);
  const name = crypto.randomBytes(12).toString('hex') + extFor(mime);
  fs.writeFileSync(path.join(dir, name), buf, { mode: 0o600 });
  // return path relative to repo root for storing on user record
  const rel = path.relative(path.join(__dirname, '..'), path.join(dir, name));
  return { ok: true, relPath: rel, size: buf.length, mime };
};

const remove = (relPath) => {
  if (!relPath || !relPath.startsWith('data/uploads/')) return false;
  const abs = path.join(__dirname, '..', relPath);
  try { fs.unlinkSync(abs); return true; }
  catch { return false; }
};

const stream = (relPath) => {
  if (!relPath || !relPath.startsWith('data/uploads/')) return null;
  const abs = path.join(__dirname, '..', relPath);
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
    return { stream: fs.createReadStream(abs), size: st.size };
  } catch { return null; }
};

module.exports = { persist, remove, stream, ALLOWED_KINDS, MAX_BYTES };
