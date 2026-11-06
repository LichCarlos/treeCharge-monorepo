const MAX = 99999999999;
// Addition/subtraction only; all arithmetic uses integer cents.
export function evaluateAmount(expression) {
  if (!/^\d+(?:\.\d{0,2})?(?:[+-]\d+(?:\.\d{0,2})?)*$/.test(expression) || expression.length > 120) throw new Error('请填写完整金额，最多两位小数');
  const tokens = expression.match(/[+-]?\d+(?:\.\d{0,2})?/g);
  let result = 0;
  for (const token of tokens) {
    const sign = token.startsWith('-') ? -1 : 1;
    const [whole, fraction = ''] = token.replace(/^[+-]/, '').split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(cents) || cents > MAX) throw new Error('金额超出范围');
    result += sign * cents;
    if (!Number.isSafeInteger(result) || Math.abs(result) > MAX) throw new Error('计算金额超出范围');
  }
  return result;
}
export function calculatorPress(expression, key) {
  if (key === 'clear') return '';
  if (key === 'backspace') return expression.slice(0, -1);
  if (key === '+' || key === '-') {
    if (!expression) return expression;
    if (/[+-]$/.test(expression)) return expression.slice(0, -1) + key;
    return expression.replace(/\.$/, '.00') + key;
  }
  if (!/^[\d.]$/.test(key) || expression.length >= 120) return expression;
  const last = expression.split(/[+-]/).pop() ?? '';
  if (key === '.') return last.includes('.') ? expression : expression + (last ? '.' : '0.');
  if (last.includes('.') && last.split('.')[1].length >= 2) return expression;
  const next = last === '0' ? expression.slice(0, -1) + key : expression + key;
  const operand = next.split(/[+-]/).pop();
  if (Number(operand) > MAX / 100) return expression;
  return next;
}
