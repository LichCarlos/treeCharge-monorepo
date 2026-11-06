// All amounts are integer minor units. Transfers move available budget, never transactions.
function minor(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 99999999999) throw new Error(`${name}无效`);
  return value;
}
function uniqueIds(rows, name) {
  if (rows.some(row => typeof row.id !== 'string' || !row.id) || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error(`${name}ID重复或无效`);
}

export function calculateBalances(state) {
  const { baseMinor, allocations, usages = [], transfers = [] } = state;
  minor(baseMinor, '可支配金额');
  if (!baseMinor) throw new Error('可支配金额必须大于0');
  uniqueIds(allocations, '预算tag');
  uniqueIds(usages, '使用记录');
  uniqueIds(transfers, '调剂记录');
  const balances = new Map(allocations.map(row => [row.id, { tagId: row.id, initialMinor: minor(row.amountMinor, '预算'), usedMinor: 0, transferredInMinor: 0, transferredOutMinor: 0 }]));
  const allocated = allocations.reduce((sum, row) => sum + row.amountMinor, 0);
  if (allocated > baseMinor) throw new Error('初始分配超出可支配金额');
  for (const usage of usages) {
    const target = balances.get(usage.tagId);
    if (!target) throw new Error('使用记录tag不存在');
    minor(usage.amountMinor, '使用金额');
    if (!usage.amountMinor) throw new Error('使用金额必须大于0');
    if (usage.kind !== 'consume' && usage.kind !== 'refund') throw new Error('使用方向无效');
    // refund is an explicit linked reversal or release; ordinary income is never a budget refund.
    target.usedMinor += usage.kind === 'refund' ? -usage.amountMinor : usage.amountMinor;
  }
  for (const transfer of transfers) {
    const source = balances.get(transfer.fromTagId);
    const target = balances.get(transfer.toTagId);
    if (!source || !target || source === target) throw new Error('调剂来源或目标无效');
    minor(transfer.amountMinor, '调剂金额');
    if (!transfer.amountMinor) throw new Error('调剂金额必须大于0');
    source.transferredOutMinor += transfer.amountMinor;
    target.transferredInMinor += transfer.amountMinor;
  }
  const rows = [...balances.values()].map(row => ({ ...row, availableMinor: row.initialMinor + row.transferredInMinor - row.transferredOutMinor - row.usedMinor }));
  return { rows, unallocatedMinor: baseMinor - allocated, totalUsedMinor: rows.reduce((sum, row) => sum + row.usedMinor, 0), totalAvailableMinor: rows.reduce((sum, row) => sum + row.availableMinor, 0) + baseMinor - allocated };
}

export function compensateNegativeTag(state, { operationId, targetTagId, deductions }) {
  if (typeof operationId !== 'string' || !operationId || !Array.isArray(deductions) || !deductions.length) throw new Error('请选择扣除来源并提供操作ID');
  const proposed = deductions.map((row, index) => ({ id: `${operationId}/${index}`, operationId, fromTagId: row.fromTagId, toTagId: targetTagId, amountMinor: row.amountMinor }));
  const previous = (state.transfers ?? []).filter(row => row.operationId === operationId);
  if (previous.length) {
    if (JSON.stringify(previous) !== JSON.stringify(proposed)) throw new Error('相同操作ID不能用于不同扣款');
    return state; // Idempotent retry; don't deduct a second time.
  }
  const before = calculateBalances(state);
  const lookup = new Map(before.rows.map(row => [row.tagId, row]));
  const target = lookup.get(targetTagId);
  if (!target || target.availableMinor >= 0) throw new Error('目标tag不是负余额');
  if (new Set(deductions.map(row => row.fromTagId)).size !== deductions.length) throw new Error('扣除来源重复');
  let total = 0;
  for (const deduction of deductions) {
    minor(deduction.amountMinor, '扣除金额');
    const source = lookup.get(deduction.fromTagId);
    if (!deduction.amountMinor || !source || source.tagId === targetTagId || source.availableMinor <= 0 || deduction.amountMinor > source.availableMinor) throw new Error('来源tag可用余额不足或金额无效');
    total += deduction.amountMinor;
  }
  if (total > -target.availableMinor) throw new Error('扣除总额不能超过待补缺口');
  const next = { ...state, transfers: [...(state.transfers ?? []), ...proposed] };
  const after = calculateBalances(next);
  if (after.totalAvailableMinor !== before.totalAvailableMinor || after.totalUsedMinor !== before.totalUsedMinor) throw new Error('调剂金额不守恒');
  return next;
}
