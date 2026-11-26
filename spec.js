// TapeLens spec tools: independent spec check on-chain, function identification, twin finder.
// Shared by index.html and badge.html. Relies on globals from core.js.

// Parse lines like "o0 = i0 ^ i1" / "o1 = (i0 & i1) | !i2". Only pins, 0/1 and & | ^ ! ~ ( ) allowed.
function parseSpec(text, nIn, nOut) {
  const fns = new Array(nOut).fill(null);
  for (const raw of text.split(/\n|;/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^o(\d+)\s*=\s*(.+)$/);
    if (!m) throw new Error(`cannot read "${line}" — use o0 = i0 ^ i1`);
    const k = +m[1];
    if (k >= nOut) throw new Error(`o${k} does not exist (circuit has ${nOut} outputs)`);
    let expr = m[2].replace(/\s+/g, '');
    if (/[^io0-9&|^!~()]/.test(expr)) throw new Error(`only i0..i${nIn - 1}, 0, 1, & | ^ ! ( ) allowed`);
    for (const [, n] of expr.matchAll(/i(\d+)/g)) if (+n >= nIn) throw new Error(`i${n} does not exist`);
    expr = expr.replace(/i(\d+)/g, 'x[$1]').replace(/[!~]/g, '1^');
    // eslint-disable-next-line no-new-func
    fns[k] = new Function('x', `return (${expr}) & 1;`);
  }
  return fns;
}

// X Layer public RPC accepts at most ~10 calls per batch.
async function batch(reqs) {
  const out = [];
  for (let s = 0; s < reqs.length; s += 10) {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(reqs.slice(s, s + 10)) });
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error((j.error && j.error.message) || 'batch failed');
    out.push(...j);
  }
  return out;
}

// Up to 256 rows, batched.
async function evalAllRowsOnChain(proc, id, nIn, nOut) {
  const rows = 1 << nIn;
  const reqs = [];
  for (let m = 0; m < rows; m++) {
    const bits = Array.from({ length: nIn }, (_, i) => (m >> i) & 1);
    const inp = packBits(bits);
    const hex = Array.from(inp, (x) => x.toString(16).padStart(2, '0')).join('');
    reqs.push({ jsonrpc: '2.0', id: m, method: 'eth_call', params: [{ to: proc, data: '0x' + SEL.eval + u256(id) + u256(64) + u256(inp.length) + hex.padEnd(Math.ceil(inp.length / 32) * 64, '0') }, 'latest'] });
  }
  const out = new Array(rows);
  {
    const arr = await batch(reqs);
    for (const j of arr) {
      if (j.error) throw new Error(j.error.message);
      const b = decodeBytes(j.result);
      out[j.id] = Array.from({ length: nOut }, (_, k) => ((b[k >> 3] || 0) >> (k & 7)) & 1);
    }
  }
  const block = parseInt(await rpc('eth_blockNumber', []), 16);
  return { rows: out, block };
}

// ---- function identification ----
const LIB = [
  ['NOT a', 1, (a) => 1 ^ a], ['BUF a', 1, (a) => a],
  ['AND a b', 2, (a, b) => a & b], ['OR a b', 2, (a, b) => a | b], ['XOR a b', 2, (a, b) => a ^ b],
  ['NAND a b', 2, (a, b) => 1 ^ (a & b)], ['NOR a b', 2, (a, b) => 1 ^ (a | b)], ['XNOR a b', 2, (a, b) => 1 ^ a ^ b],
  ['a AND NOT b', 2, (a, b) => a & (1 ^ b)],
  ['MAJ a b c (carry)', 3, (a, b, c) => (a & b) | (a & c) | (b & c)], ['XOR3 a b c (sum)', 3, (a, b, c) => a ^ b ^ c],
  ['MUX c ? b : a', 3, (a, b, c) => (c ? b : a)], ['AND3 a b c', 3, (a, b, c) => a & b & c], ['OR3 a b c', 3, (a, b, c) => a | b | c],
];
function columns(c) {
  const rows = 1 << c.nIn;
  const cols = Array.from({ length: c.nOut }, () => new Array(rows));
  for (let m = 0; m < rows; m++) {
    const bits = Array.from({ length: c.nIn }, (_, i) => (m >> i) & 1);
    simulate(c, bits).outs.forEach((v, k) => (cols[k][m] = v));
  }
  return cols;
}
function perms(n, k) {
  const out = [];
  const rec = (cur) => { if (cur.length === k) { out.push(cur.slice()); return; } for (let i = 0; i < n; i++) if (!cur.includes(i)) { cur.push(i); rec(cur); cur.pop(); } };
  rec([]); return out;
}
function identify(c) {
  if (c.nIn > 8 || c.nState) return [];
  const cols = columns(c); const rows = 1 << c.nIn;
  return cols.map((col, k) => {
    if (col.every((v) => v === 0)) return `o${k} = constant 0`;
    if (col.every((v) => v === 1)) return `o${k} = constant 1`;
    for (const [name, ar, f] of LIB) {
      if (ar > c.nIn) continue;
      for (const p of perms(c.nIn, ar)) {
        let ok = true;
        for (let m = 0; m < rows && ok; m++) ok = f(...p.map((i) => (m >> i) & 1)) === col[m];
        if (ok) { let s = name; ['a', 'b', 'c'].forEach((v, j) => { if (j < ar) s = s.replace(new RegExp(`\\b${v}\\b`, 'g'), 'i' + p[j]); }); return `o${k} = ${s}`; }
      }
    }
    return `o${k} = custom (${col.reduce((a, v) => a + v, 0)}/${rows} rows high)`;
  });
}
// Order-sensitive fingerprint of the whole function (all outputs, all rows).
function fingerprint(c) {
  if (c.nIn > 12 || c.nState) return null;
  const cols = columns(c); let h = 2166136261 >>> 0;
  const s = `${c.nIn}/${c.nOut}:` + cols.map((col) => col.join('')).join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// Scan a window of ids (batched info + netlist), return ids computing exactly the same function.
async function findTwins(proc, c, id, total, span = 240) {
  const fp = fingerprint(c); if (!fp) return { fp: null, twins: [] };
  const lo = Math.max(1, id - span / 2), hi = Math.min(total, lo + span - 1);
  const ids = []; for (let x = lo; x <= hi; x++) if (x !== id) ids.push(x);
  const twins = []; let scanned = 0;
  for (let s = 0; s < ids.length; s += 40) {
    const chunk = ids.slice(s, s + 40);
    const body = chunk.flatMap((x) => [
      { jsonrpc: '2.0', id: 'i' + x, method: 'eth_call', params: [{ to: proc, data: '0x' + SEL.info + u256(x) }, 'latest'] },
      { jsonrpc: '2.0', id: 'n' + x, method: 'eth_call', params: [{ to: proc, data: '0x' + SEL.netlist + u256(x) }, 'latest'] },
    ]);
    const arr = await batch(body);
    const by = Object.fromEntries(arr.map((j) => [j.id, j.result]));
    for (const x of chunk) {
      const ih = by['i' + x], nh = by['n' + x]; if (!ih || !nh) continue;
      const h = ih.replace(/^0x/, '');
      const nIn = Number(BigInt('0x' + h.slice(0, 64))), nOut = Number(BigInt('0x' + h.slice(64, 128))), nState = Number(BigInt('0x' + h.slice(128, 192)));
      if (nIn !== c.nIn || nOut !== c.nOut || nState) continue;
      try {
        const other = { nIn, nOut, nState, gates: parseNetlist(decodeBytes(nh)) };
        scanned++;
        if (fingerprint(other) === fp) twins.push({ id: x, gates: other.gates.length });
      } catch { /* skip malformed */ }
    }
  }
  return { fp, twins, lo, hi, scanned };
}
