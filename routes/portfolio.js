const express = require('express');
const { query } = require('../db/pool');
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

module.exports = router;
