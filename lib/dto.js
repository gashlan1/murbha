// Map a projects row (snake_case) to the camelCase DTO the front-end expects.
function projectDTO(row) {
  if (!row) return null;
  const goal = Number(row.goal);
  const raised = Number(row.raised);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    city: row.city,
    summary: row.summary,
    description: row.description,
    goal,
    raised,
    minAmount: Number(row.min_amount),
    profitRate: Number(row.profit_rate),
    termMonths: row.term_months,
    investorCount: row.investor_count,
    totalValue: row.total_value != null ? Number(row.total_value) : null,
    status: row.status,
    fundedPct: goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0,
  };
}

function investmentDTO(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    amount: Number(row.amount),
    profitRate: Number(row.profit_rate),
    expectedReturn: Number(row.expected_return),
    status: row.status,
    createdAt: row.created_at,
    project: row.p_name ? { id: row.project_id, name: row.p_name, slug: row.p_slug, status: row.p_status } : null,
  };
}

function txnDTO(row) {
  return {
    id: row.id, kind: row.kind, amount: Number(row.amount),
    projectId: row.project_id, description: row.description, createdAt: row.created_at,
  };
}

function contractDTO(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    investmentId: row.investment_id,
    amount: Number(row.amount),
    profitRate: Number(row.profit_rate),
    termMonths: row.term_months,
    status: row.status,
    signature: row.signature,
    createdAt: row.created_at,
    signedAt: row.signed_at,
  };
}

module.exports = { projectDTO, investmentDTO, txnDTO, contractDTO };
