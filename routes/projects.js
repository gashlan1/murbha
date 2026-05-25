const express = require('express');
const { query, pool } = require('../db/pool');
const { projectDTO } = require('../lib/dto');
const { requireAuthApi } = require('../middleware/requireAuth');
const { buildPortfolio } = require('../lib/portfolio');

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

    const { rows: urows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    if (amount > Number(urows[0].balance)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'insufficient_balance' }); }

    const rate = Number(p.profit_rate);
    const expectedReturn = amount * (1 + rate * Number(p.term_months) / 12);
    await client.query(
      `INSERT INTO investments (user_id,project_id,amount,profit_rate,expected_return,status)
       VALUES ($1,$2,$3,$4,$5,'active')`,
      [req.user.id, p.id, amount, rate, expectedReturn]);
    await client.query(
      `INSERT INTO transactions (user_id,kind,amount,project_id,description)
       VALUES ($1,'investment',$2,$3,$4)`,
      [req.user.id, amount, p.id, 'استثمار في ' + p.name]);
    await client.query('UPDATE projects SET raised = raised + $1, investor_count = investor_count + 1 WHERE id = $2', [amount, p.id]);
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, req.user.id]);
    await client.query('COMMIT');

    const portfolio = await buildPortfolio(req.user.id);
    res.status(201).json({ portfolio });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }
}));

module.exports = router;
