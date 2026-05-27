const express = require('express');
const crypto = require('crypto');
const { query, pool } = require('../db/pool');
const { requireAdminApi } = require('../middleware/requireAuth');
const { projectDTO } = require('../lib/dto');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(requireAdminApi);

// GET /api/admin/stats
router.get('/stats', ah(async (req, res) => {
  const { rows } = await query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'investor')::int                                   AS investors,
      (SELECT COUNT(*) FROM investment_extensions WHERE status = 'pending')::int                   AS "pendingExtensions",
      (SELECT COALESCE(SUM(GREATEST(goal - raised, 0)), 0) FROM projects WHERE status = 'open')    AS "fundingNeeded",
      (SELECT COUNT(*) FROM projects)::int                                                         AS "projectCount"
  `);
  const r = rows[0];
  res.json({
    investors: r.investors,
    pendingExtensions: r.pendingExtensions,
    fundingNeeded: Number(r.fundingNeeded),
    projectCount: r.projectCount,
  });
}));

// GET /api/admin/users
router.get('/users', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT id, username, full_name, role, approved, balance, created_at
       FROM users ORDER BY created_at DESC`
  );
  res.json({
    users: rows.map(u => ({
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      role: u.role,
      approved: u.approved,
      balance: Number(u.balance),
      createdAt: u.created_at,
    })),
  });
}));

async function setApproved(req, res, approved) {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const { rows } = await query(
    `UPDATE users SET approved = $1 WHERE id = $2
     RETURNING id, username, full_name, role, approved, balance, created_at`,
    [approved, req.params.id]
  );
  const u = rows[0];
  if (!u) return res.status(404).json({ error: 'not_found' });
  res.json({
    user: {
      id: u.id, username: u.username, fullName: u.full_name, role: u.role,
      approved: u.approved, balance: Number(u.balance), createdAt: u.created_at,
    },
  });
}

// POST /api/admin/users/:id/approve
router.post('/users/:id/approve', ah((req, res) => setApproved(req, res, true)));
// POST /api/admin/users/:id/reject
router.post('/users/:id/reject', ah((req, res) => setApproved(req, res, false)));

// POST /api/admin/projects — create a project.
router.post('/projects', ah(async (req, res) => {
  const b = req.body || {};
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const category = typeof b.category === 'string' ? b.category.trim() : null;
  const city = typeof b.city === 'string' ? b.city.trim() : null;
  const summary = typeof b.summary === 'string' ? b.summary.trim() : null;
  const goal = Number(b.goal);
  const minAmount = Number(b.minAmount);
  const profitRate = Number(b.profitRate);
  const termMonths = Number(b.termMonths);
  const totalValue = b.totalValue != null ? Number(b.totalValue) : goal;

  if (!name || !(goal > 0) || !(minAmount > 0) || !(profitRate >= 0) || !(termMonths > 0)) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  // Slug: lowercase, spaces -> '-', strip non-url chars (keep a-z0-9 arabic and '-').
  let base = name.toLowerCase().replace(/[^a-z0-9؀-ۿ\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!base) base = 'project';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let slug = base;
    // Ensure uniqueness by appending a short random suffix on collision.
    /* eslint-disable no-constant-condition */
    while (true) {
      const exists = await client.query('SELECT 1 FROM projects WHERE slug = $1', [slug]);
      if (exists.rowCount === 0) break;
      slug = base + '-' + crypto.randomBytes(2).toString('hex');
    }
    const { rows } = await client.query(
      `INSERT INTO projects (slug,name,category,city,summary,goal,raised,min_amount,profit_rate,term_months,total_value,status)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,'open') RETURNING *`,
      [slug, name, category, city, summary, goal, minAmount, profitRate, termMonths, totalValue]
    );
    await client.query('COMMIT');
    res.status(201).json({ project: projectDTO(rows[0]) });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }
}));

// PATCH /api/admin/projects/:id — update editable fields present in the body.
router.patch('/projects/:id', ah(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  const map = {
    status: 'status',
    goal: 'goal',
    minAmount: 'min_amount',
    profitRate: 'profit_rate',
    termMonths: 'term_months',
    summary: 'summary',
  };
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(map)) {
    if (b[key] === undefined) continue;
    params.push(b[key]);
    sets.push(`${col} = $${params.length}`);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'invalid_input' });
  params.push(req.params.id);
  const { rows } = await query(
    `UPDATE projects SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json({ project: projectDTO(rows[0]) });
}));

// GET /api/admin/extensions — pending extension requests with investment + user info.
router.get('/extensions', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT e.id, e.investment_id, e.months, e.status, e.created_at, u.username
       FROM investment_extensions e
       JOIN users u ON u.id = e.user_id
      WHERE e.status = 'pending'
      ORDER BY e.created_at DESC`
  );
  res.json({
    extensions: rows.map(e => ({
      id: e.id,
      investmentId: e.investment_id,
      username: e.username,
      months: e.months,
      status: e.status,
      createdAt: e.created_at,
    })),
  });
}));

// POST /api/admin/extensions/:id/resolve — { decision: 'approved' | 'rejected' }
router.post('/extensions/:id/resolve', ah(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const decision = req.body?.decision;
  if (decision !== 'approved' && decision !== 'rejected') {
    return res.status(400).json({ error: 'invalid_input' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM investment_extensions WHERE id = $1 FOR UPDATE', [req.params.id]);
    const ext = rows[0];
    if (!ext) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not_found' }); }

    const note = decision === 'approved'
      ? `extended by ${ext.months} months`
      : ext.note;
    const { rows: urows } = await client.query(
      `UPDATE investment_extensions SET status = $1, resolved_at = now(), note = $2
       WHERE id = $3 RETURNING *`,
      [decision, note, ext.id]);

    // The investments table has no term_months column; we record the extension
    // in the extension row's note (above). Investment term tracking can be
    // derived from approved extensions.

    await client.query(
      `INSERT INTO notifications (user_id,title,body,type)
       VALUES ($1,$2,$3,'extension')`,
      [ext.user_id,
       decision === 'approved' ? 'تمت الموافقة على تمديد الاستثمار' : 'تم رفض طلب تمديد الاستثمار',
       decision === 'approved'
         ? `تمت الموافقة على تمديد استثمارك لمدة ${ext.months} أشهر إضافية.`
         : 'نعتذر، لم تتم الموافقة على طلب تمديد استثمارك.']);

    await client.query('COMMIT');
    const e = urows[0];
    res.json({
      extension: {
        id: e.id, investmentId: e.investment_id, months: e.months,
        status: e.status, note: e.note, createdAt: e.created_at, resolvedAt: e.resolved_at,
      },
    });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }
}));

module.exports = router;
