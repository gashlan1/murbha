const express = require('express');
const { pool } = require('../db/pool');
const { requireAuthApi } = require('../middleware/requireAuth');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/investments/:id/extend — owner requests an extension on an active investment.
router.post('/:id/extend', requireAuthApi, ah(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const months = Number(req.body?.months);
  if (!(months > 0)) return res.status(400).json({ error: 'invalid_input' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT * FROM investments WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [req.params.id, req.user.id]);
    const inv = rows[0];
    if (!inv) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not_found' }); }
    if (inv.status !== 'active') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'closed' }); }

    // Avoid duplicate pending requests for the same investment.
    const pending = await client.query(
      "SELECT id FROM investment_extensions WHERE investment_id = $1 AND status = 'pending'",
      [inv.id]);
    if (pending.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(200).json({ extensionId: pending.rows[0].id, alreadySubmitted: true });
    }

    const { rows: erows } = await client.query(
      `INSERT INTO investment_extensions (investment_id, user_id, months, status)
       VALUES ($1, $2, $3, 'pending') RETURNING id`,
      [inv.id, req.user.id, Math.round(months)]);
    const extensionId = erows[0].id;

    await client.query(
      `INSERT INTO notifications (user_id,title,body,type)
       VALUES ($1,'تم تقديم طلب تمديد الاستثمار',$2,'extension_request')`,
      [req.user.id, `تم تقديم طلب تمديد فترة استثمارك لمدة ${Math.round(months)} أشهر. ستراجعه الإدارة.`]);

    await client.query('COMMIT');
    res.status(201).json({ extensionId });
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally {
    client.release();
  }
}));

module.exports = router;
