const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }
function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || 'assertEqual'}: expected ${e}, got ${a}`);
}
async function runAll() {
  const out = document.getElementById('results');
  let pass = 0, fail = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      pass++;
      out.insertAdjacentHTML('beforeend', `<div style="color:#7d9b76">✓ ${name}</div>`);
    } catch (err) {
      fail++;
      out.insertAdjacentHTML('beforeend', `<div style="color:#c6613f">✗ ${name} — ${err.message}</div>`);
    }
  }
  out.insertAdjacentHTML('beforeend', `<h2>${pass} passed, ${fail} failed</h2>`);
  document.title = fail ? `✗ ${fail} failing` : '✓ all passing';
}
