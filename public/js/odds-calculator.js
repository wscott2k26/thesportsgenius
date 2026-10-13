// Educational two-way American odds calculator. No wagering, tracking or live prices.
export function impliedProbability(american) {
  const x = Number(american);
  if (!Number.isFinite(x) || !Number.isInteger(x) || Math.abs(x) < 100 || Math.abs(x) > 100000) return null;
  return x > 0 ? 100 / (x + 100) : -x / (-x + 100);
}
export function decimalOdds(american) {
  const p = impliedProbability(american);
  return p === null ? null : 1 / p;
}
export function twoWayNoVig(a,b) {
  const pa = impliedProbability(a), pb = impliedProbability(b);
  if (pa === null || pb === null) return null;
  const sum = pa + pb;
  return { first: pa / sum, second: pb / sum, overround: (sum - 1) * 100, firstRaw: pa, secondRaw: pb };
}
const fmt = p => (p * 100).toFixed(2) + '%';
function init() {
  const form = document.getElementById('odds-calc-form');
  const result = document.getElementById('odds-calc-output');
  if (!form || !result) return;
  const calc = () => {
    const a = form.elements.namedItem('a').value.trim(), b = form.elements.namedItem('b').value.trim();
    const values = twoWayNoVig(a,b);
    if (!values) {
      result.textContent = 'Enter valid two-way American prices, for example +150 and -170. Each must be a whole number with absolute value 100 or greater.';
      return;
    }
    const ada = decimalOdds(a), adb = decimalOdds(b);
    result.textContent = 'Side A: ' + fmt(values.firstRaw) + ' implied (' + ada.toFixed(3) +
      ' decimal). Side B: ' + fmt(values.secondRaw) + ' implied (' + adb.toFixed(3) +
      ' decimal). Combined implied probabilities: ' + (100 + values.overround).toFixed(2) +
      '%. Overround: ' + values.overround.toFixed(2) + ' percentage points. ' +
      'Normalized two-way estimates (not predictions): A ' + fmt(values.first) +
      ', B ' + fmt(values.second) + '.';
  };
  form.addEventListener('submit', e => { e.preventDefault(); calc(); });
  form.addEventListener('input', calc);
  calc();
}
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);
