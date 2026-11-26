// TapeLens core — X Layer RPC + TapeOut netlist decode/simulate (shared).
const RPC = 'https://rpc.xlayer.tech';
const PROCESSORS = [
  '0x87bfca3494aa228ff589ab9b642143a5e8c8f9a6',
  '0x69f663931209096037474d7c20402232e5c762ca',
  '0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355',
];
const SEL = { name: '06fdde03', symbol: '95d89b41', info: '084d60f1', netlist: '3fc4be56', eval: '934d06ea' };
const MAX_DRAW = 400;

const $ = (id) => document.getElementById(id);
const u256 = (v) => BigInt(v).toString(16).padStart(64, '0');
let rid = 1;

async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: rid++, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'rpc error');
  return j.result;
}
const call = (to, data) => rpc('eth_call', [{ to, data: '0x' + data }, 'latest']);

function decodeString(hex) {
  const h = hex.replace(/^0x/, '');
  const len = parseInt(h.slice(64, 128), 16);
  const bytes = h.slice(128, 128 + len * 2).match(/../g) || [];
  return decodeURIComponent(bytes.map((b) => '%' + b).join(''));
}
function decodeBytes(hex) {
  const h = hex.replace(/^0x/, '');
  const len = parseInt(h.slice(64, 128), 16);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(h.substr(128 + i * 2, 2), 16);
  return out;
}

async function circuitInfo(proc, id) {
  const h = (await call(proc, SEL.info + u256(id))).replace(/^0x/, '');
  const w = [0, 1, 2, 3].map((i) => Number(BigInt('0x' + h.slice(i * 64, i * 64 + 64))));
  return { nIn: w[0], nOut: w[1], nState: w[2], gateCount: w[3] };
}
async function exists(proc, id) {
  try { const i = await circuitInfo(proc, id); return i.nOut > 0 || i.gateCount > 0; } catch { return false; }
}
// Highest existing id by exponential + binary search (ids are minted in sequence).
async function countCircuits(proc) {
  if (!(await exists(proc, 1))) return 0;
  let lo = 1, hi = 2;
  while (await exists(proc, hi)) { lo = hi; hi *= 2; if (hi > 1 << 22) break; }
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (await exists(proc, m)) lo = m; else hi = m; }
  return lo;
}

// TAP-02 netlist: NAND = 0x00|u24 a|u24 b (7B), LATCH = 0x01|u24 d (4B).
// Signals: 0 const0, 1 const1, 2..1+nIn inputs, then one per gate.
function parseNetlist(bytes) {
  const gates = [];
  let o = 0;
  const u24 = (p) => (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2];
  while (o < bytes.length) {
    const op = bytes[o];
    if (op === 0) { gates.push({ k: 'NAND', a: u24(o + 1), b: u24(o + 4) }); o += 7; }
    else if (op === 1) { gates.push({ k: 'LATCH', d: u24(o + 1) }); o += 4; }
    else throw new Error('unknown opcode ' + op + ' at byte ' + o);
  }
  return gates;
}

function simulate(c, inBits, state) {
  const sig = new Array(2 + c.nIn + c.gates.length).fill(0);
  sig[1] = 1;
  for (let i = 0; i < c.nIn; i++) sig[2 + i] = inBits[i] ? 1 : 0;
  const latchIdx = [];
  c.gates.forEach((g, i) => {
    const s = 2 + c.nIn + i;
    if (g.k === 'NAND') sig[s] = sig[g.a] & sig[g.b] ? 0 : 1;
    else { sig[s] = state ? state[latchIdx.length] || 0 : 0; latchIdx.push(i); }
  });
  const outs = [];
  for (let k = 0; k < c.nOut; k++) outs.push(sig[2 + c.nIn + c.gates.length - c.nOut + k]);
  return { sig, outs };
}

function packBits(bits) {
  const n = Math.max(1, Math.ceil(bits.length / 8));
  const b = new Uint8Array(n);
  bits.forEach((v, i) => { if (v) b[i >> 3] |= 1 << (i & 7); });
  return b;
}
async function evalOnChain(proc, id, bits, nOut) {
  const inp = packBits(bits);
  const hex = Array.from(inp, (x) => x.toString(16).padStart(2, '0')).join('');
  const padded = hex.padEnd(Math.ceil(inp.length / 32) * 64, '0');
  const data = SEL.eval + u256(id) + u256(64) + u256(inp.length) + padded;
  const [res, block] = await Promise.all([call(proc, data), rpc('eth_blockNumber', [])]);
  const out = decodeBytes(res);
  const bitsOut = [];
  for (let k = 0; k < nOut; k++) bitsOut.push(((out[k >> 3] || 0) >> (k & 7)) & 1);
  return { bits: bitsOut, block: parseInt(block, 16) };
}

