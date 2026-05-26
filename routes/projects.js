const express = require('express');
const { query, pool } = require('../db/pool');
const { projectDTO } = require('../lib/dto');
const { requireAuthApi } = require('../middleware/requireAuth');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/', ah(async (req, res) => {
  const { category } = req.query;
  const params = [];
  let sql = 'SELECT * FROM projects';
  if (category) { params.push(category); sql += ' WHERE category = $1'; }
  sql += " ORDER BY (status = 'open') DESC, created_at DESC";
  const { rows } = await query(sql, params);
  res.json({ projects: rows.map(projectDTO) });
}));

router.get('/:slug', ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM projects WHERE slug = $1', [req.params.slug]);
  if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ project: projectDTO(rows[0]) });
}));

// Invest creates a PENDING investment + a contract awaiting signature.
// It does NOT touch the user balance or the project's raised total — that
// happens later in the contract pay step (routes/contracts.js).
router.post('/:slug/invest', requireAuthApi, ah(async (req, res) => {
  const amount = Number(req.body?.amount);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: prows } = await client.query('SELECT * FROM projects WHERE slug = $1 FOR UPDATE', [req.params.slug]);
    const p = prows[0];
    if (!p) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not_found' }); }
    if (p.status !== 'open') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'closed' }); }
    if (!(amount > 0) || amount < Number(p.min_amount)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'below_min' }); }
    if (amount > Number(p.goal) - Number(p.raised)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'exceeds_remaining' }); }

    const rate = Number(p.profit_rate);
    const term = Number(p.term_months);
    const expectedReturn = amount * (1 + rate * term / 12);

    const { rows: irows } = await client.query(
      `INSERT INTO investments (user_id,project_id,amount,profit_rate,expected_return,status)
       VALUES ($1,$2,$3,$4,$5,'pending_signature') RETURNING id`,
      [req.user.id, p.id, amount, rate, expectedReturn]);
    const investmentId = irows[0].id;

    const { rows: crows } = await client.query(
      `INSERT INTO contracts (user_id,project_id,investment_id,amount,profit_rate,term_months,status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING id`,
      [req.user.id, p.id, investmentId, amount, rate, term]);
    const contractId = crows[0].id;

    await client.query(
      `INSERT INTO notifications (user_id,title,body,type)
       VALUES ($1,$2,$3,'contract')`,
      [req.user.id, 'بانتظار توقيع عقد المرابحة',
       `بانتظار توقيعك على عقد استثمار بمبلغ ${amount} ريال في ${p.name}.`]);

    await client.query('COMMIT');
    res.status(201).json({ investmentId, contractId, amount });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }
}));

module.exports = router;
