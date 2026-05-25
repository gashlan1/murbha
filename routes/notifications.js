const express = require('express');
const { query } = require('../db/pool');
const { requireAuthApi } = require('../middleware/requireAuth');

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/', requireAuthApi, ah(async (req, res) => {
  const { rows } = await query(
    'SELECT id,title,body,type,read,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ notifications: rows });
}));

router.post('/read-all', requireAuthApi, ah(async (req, res) => {
  await query('UPDATE notifications SET read=true WHERE user_id=$1', [req.user.id]);
  res.json({ success: true });
}));

router.post('/:id/read', requireAuthApi, ah(async (req, res) => {
  await query('UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ success: true });
}));

module.exports = router;
