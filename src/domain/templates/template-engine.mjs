// Pure, offline calculations. No database writes or automatic posting.
const MAX_MINOR = 99999999999;
function integer(value, name, min = 0, max = MAX_MINOR) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name}超出有效整数范围`);
  return value;
}
function roundedRatio(numerator, denominator) {
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}
export function allocateBudget(template, baseMinor, { overrides = {} } = {}) {
  integer(baseMinor, '分配基数', 1);
  const rows = template.rows.map(row => ({ ...row, ...(overrides[row.key] ?? {}) }));
  if (new Set(rows.map(row => row.key)).size !== rows.length) throw new Error('分配项键重复');
  const amounts = new Map();
  const remainderRows = [];
  let allocated = 0;
  for (const row of rows) {
    let amount;
    switch (row.mode) {
      case 'fixed': amount = integer(row.fixedMinor, `请设置${row.name ?? row.key}的预算金额`); break;
      case 'ratio':
        integer(row.ratioBps, '分配比例', 0, 10000);
        amount = roundedRatio(BigInt(baseMinor) * BigInt(row.ratioBps), 10000n);
        break;
      case 'remainder':
        if(row.remainderBps!=null)integer(row.remainderBps,'剩余池百分比',0,10000);
        else integer(row.weight,'剩余分配权重',1,10000);
        remainderRows.push(row);continue;
      default: throw new Error('未知分配规则');
    }
    integer(amount, '派生金额');
    amounts.set(row.key, amount);
    allocated += amount;
  }
  integer(allocated, '已分配金额');
  const remainder = baseMinor - allocated;
  if (remainderRows.length) {
    const explicit=remainderRows.some(row=>row.remainderBps!=null),totalBps=remainderRows.reduce((sum,row)=>sum+(row.remainderBps??0),0);
    if(explicit&&remainderRows.some(row=>row.remainderBps==null))throw new Error('请设置剩余池百分比');
    if(totalBps>10000)throw new Error('剩余分配比例合计不能超过100%');
    if(remainder<0&&(!explicit||totalBps>0))throw new Error('分配超出基数，不可完成剩余分配');
    const pool=Math.max(0,remainder),totalWeight=explicit?10000:remainderRows.reduce((sum,row)=>sum+row.weight,0);
    const shares = remainderRows.map((row, index) => {
      const numerator = BigInt(pool) * BigInt(explicit?row.remainderBps:row.weight);
      return { row, index, amount: Number(numerator / BigInt(totalWeight)), fractional: numerator % BigInt(totalWeight) };
    });
    let centsLeft = (explicit?roundedRatio(BigInt(pool)*BigInt(totalBps),10000n):pool) - shares.reduce((sum, share) => sum + share.amount, 0);
    const ordered = [...shares].sort((a, b) => a.fractional === b.fractional ? a.index - b.index : a.fractional > b.fractional ? -1 : 1);
    for (let index = 0; index < centsLeft; index++) ordered[index].amount++;
    for (const share of shares) amounts.set(share.row.key, share.amount);
  }
  const output = rows.map(row => ({ ...row, amountMinor: amounts.get(row.key), shareOfBase: amounts.get(row.key) / baseMinor }));
  const unallocatedMinor = baseMinor-output.reduce((sum,row)=>sum+row.amountMinor,0);
  return {
    baseMinor,
    rows: output,
    expenseBudgetMinor: output.filter(row => row.purpose === 'expense_budget').reduce((sum, row) => sum + row.amountMinor, 0),
    savingsBudgetMinor: output.filter(row => row.purpose === 'savings_budget').reduce((sum, row) => sum + row.amountMinor, 0),
    allocatedMinor: output.reduce((sum, row) => sum + row.amountMinor, 0),
    unallocatedMinor
  };
}

export function weeklyChallenge({ weeks, firstMinor, stepMinor }) {
  integer(weeks, '周数', 1, 520);
  integer(firstMinor, '首周金额', 1);
  integer(stepMinor, '每周递增');
  const rows = Array.from({ length: weeks }, (_, index) => ({ week: index + 1, plannedMinor: integer(firstMinor + stepMinor * index, '每周金额', 1) }));
  const targetMinor = integer(rows.reduce((sum, row) => sum + row.plannedMinor, 0), '计划总额', 1);
  return { rows, targetMinor };
}

export function emergencyFund({ monthlyEssentialMinor, coverageMonths, monthlyContributionMinor, currentMinor = 0 }) {
  integer(monthlyEssentialMinor, '每月必要支出', 1);
  integer(coverageMonths, '覆盖月数', 1, 120);
  integer(monthlyContributionMinor, '每月计划存入', 1);
  integer(currentMinor, '当前存款');
  const targetMinor = integer(monthlyEssentialMinor * coverageMonths, '备用金目标', 1);
  const remainingMinor = Math.max(0, targetMinor - currentMinor);
  return { targetMinor, remainingMinor, estimatedMonths: Math.ceil(remainingMinor / monthlyContributionMinor), plannedOnly: true };
}
