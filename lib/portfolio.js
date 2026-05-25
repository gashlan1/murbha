const { query } = require('../db/pool');
const { investmentDTO, txnDTO } = require('./dto');

async function buildPortfolio(userId) {
  const u = await query('SELECT balance FROM users WHERE id = $1', [userId]);
  const inv = await query(
    `SELECT i.*, p.name AS p_name, p.slug AS p_slug, p.status AS p_status
       FROM investments i JOIN projects p ON p.id = i.project_id
      WHERE i.user_id = $1 ORDER BY i.created_at DESC`, [userId]);
  const txn = await query(
    'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [userId]);

  let invested = 0, expectedReturn = 0;
  for (const r of inv.rows) {
    if (r.status === 'active' || r.status === 'completed') {
      invested += Number(r.amount);
      expectedReturn += Number(r.expected_return);
    }
  }
  return {
    balance: Number(u.rows[0]?.balance || 0),
    invested,
    expectedReturn,
    expectedProfit: expectedReturn - invested,
    investments: inv.rows.map(investmentDTO),
    transactions: txn.rows.map(txnDTO),
  };
}

module.exports = { buildPortfolio };
