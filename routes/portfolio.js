const express = require('express');
const { query, pool } = require('../db/pool');
const { requireAuthApi } = require('../middleware/requireAuth');
const { buildPortfolio } = require('../lib/portfolio');
const { txnDTO } = require('../lib/dto');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/portfolio', requireAuthApi, ah(async (req, res) => {
  res.json(await buildPortfolio(req.user.id));
}));

router.get('/transactions', requireAuthApi, ah(async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
  res.json({ transactions: rows.map(txnDTO) });
}));

router.post('/portfolio/deposit', requireAuthApi, ah(async (req, res) => {
  const amount = Number(req.body?.amount);
  const method = (typeof req.body?.method === 'string' && req.body.method.trim()) || 'mada';
  if (!(amount >= 100)) return res.status(400).json({ error: 'invalid_input' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance', [amount, req.user.id]);
    await client.query(
      `INSERT INTO transactions (user_id,kind,amount,description)
       VALUES ($1,'deposit',$2,$3)`,
      [req.user.id, amount, 'إيداع رصيد عبر ' + method]);
    await client.query(
      `INSERT INTO notifications (user_id,title,body,type)
       VALUES ($1,'تم إيداع الرصيد',$2,'deposit')`,
      [req.user.id, 'تم إيداع ' + amount + ' ريال في محفظتك.']);
    await client.query('COMMIT');
    res.json({ balance: Number(rows[0].balance) });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }
}));

router.post('/portfolio/withdraw', requireAuthApi, ah(async (req, res) => {
  const amount = Number(req.body?.amount);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: urows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    if (!(amount > 0) || amount > Number(urows[0].balance)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'insufficient' });
    }
    const { rows } = await client.query(
      'UPDATE users SET balance = balance - $1 WHERE id = $2 RETURNING balance', [amount, req.user.id]);
    await client.query(
      `INSERT INTO transactions (user_id,kind,amount,description)
       VALUES ($1,'withdraw',$2,$3)`,
      [req.user.id, -amount, 'سحب رصيد']);
    await client.query(
      `INSERT INTO notifications (user_id,title,body,type)
       VALUES ($1,'تم سحب الرصيد',$2,'withdraw')`,
      [req.user.id, 'تم سحب ' + amount + ' ريال من محفظتك.']);
    await client.query('COMMIT');
    res.json({ balance: Number(rows[0].balance) });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }
}));

module.exports = router;
