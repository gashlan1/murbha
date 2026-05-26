const express = require('express');
const { query, pool } = require('../db/pool');
const { requireAuthApi } = require('../middleware/requireAuth');
const { contractDTO, projectDTO } = require('../lib/dto');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/contracts/:id — owner-only contract + its project.
router.get('/:id', requireAuthApi, ah(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const { rows } = await query(
    'SELECT * FROM contracts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  const c = rows[0];
  if (!c) return res.status(404).json({ error: 'not_found' });
  const { rows: prows } = await query('SELECT * FROM projects WHERE id = $1', [c.project_id]);
  res.json({ contract: contractDTO(c), project: projectDTO(prows[0]) });
}));

// POST /api/contracts/:id/sign — owner signs the contract.
router.post('/:id/sign', requireAuthApi, ah(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const signature = typeof req.body?.signature === 'string' ? req.body.signature.trim() : '';
  if (!signature) return res.status(400).json({ error: 'invalid_input' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM contracts WHERE id = $1 AND user_id = $2 FOR UPDATE', [req.params.id, req.user.id]);
    const c = rows[0];
    if (!c) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not_found' }); }

    if (c.status === 'signed' || c.status === 'active') {
      await client.query('ROLLBACK');
      return res.status(200).json({ contract: contractDTO(c), alreadySigned: true });
    }

    const { rows: urows } = await client.query(
      `UPDATE contracts SET status='signed', signature=$1, signed_at=now()
       WHERE id = $2 RETURNING *`, [signature, c.id]);
    await client.query("UPDATE investments SET status='pending_payment' WHERE id = $1", [c.investment_id]);
    await client.query(
      `INSERT INTO notifications (user_id,title,body,type)
       VALUES ($1,'تم توقيع العقد بنجاح','تم توقيع عقد المرابحة. أكمل الدفع لتفعيل استثمارك.','contract')`,
      [req.user.id]);
    await client.query('COMMIT');
    res.json({ contract: contractDTO(urows[0]) });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }
}));

// POST /api/contracts/:id/pay — owner pays; activates investment + project.
router.post('/:id/pay', requireAuthApi, ah(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const method = (typeof req.body?.method === 'string' && req.body.method.trim()) || 'mada';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the user row first to keep a consistent lock order across requests.
    const { rows: urows } = await client.query('SELECT id, balance FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    const { rows } = await client.query(
      'SELECT * FROM contracts WHERE id = $1 AND user_id = $2 FOR UPDATE', [req.params.id, req.user.id]);
    const c = rows[0];
    if (!c) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not_found' }); }

    if (c.status === 'active') {
      await client.query('ROLLBACK');
      return res.status(200).json({ contract: contractDTO(c), alreadyPaid: true });
    }
    if (c.status !== 'signed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'invalid_input' });
    }

    const amount = Number(c.amount);
    const { rows: prows } = await client.query('SELECT * FROM projects WHERE id = $1 FOR UPDATE', [c.project_id]);
    const p = prows[0];

    if (method === 'wallet' && Number(urows[0].balance) < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'insufficient' });
    }

    const { rows: crows } = await client.query(
      "UPDATE contracts SET status='active' WHERE id = $1 RETURNING *", [c.id]);
    await client.query("UPDATE investments SET status='active' WHERE id = $1", [c.investment_id]);
    await client.query(
      'UPDATE projects SET raised = raised + $1, investor_count = investor_count + 1 WHERE id = $2',
      [amount, p.id]);

    if (method === 'wallet') {
      await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, req.user.id]);
      await client.query(
        `INSERT INTO transactions (user_id,kind,amount,project_id,description)
         VALUES ($1,'invest_confirm',$2,$3,$4)`,
        [req.user.id, -amount, p.id, 'تأكيد استثمار في ' + p.name]);
    } else {
      await client.query(
        `INSERT INTO transactions (user_id,kind,amount,project_id,description)
         VALUES ($1,'invest_confirm',0,$2,$3)`,
        [req.user.id, p.id, 'تأكيد استثمار في ' + p.name + ' (' + method + ')']);
    }

    await client.query(
      `INSERT INTO notifications (user_id,title,body,type)
       VALUES ($1,'تم تفعيل الاستثمار بنجاح',$2,'investment')`,
      [req.user.id, 'تم تفعيل استثمارك بمبلغ ' + amount + ' ريال في ' + p.name + '.']);

    await client.query('COMMIT');
    res.json({ contract: contractDTO(crows[0]) });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }
}));

module.exports = router;
