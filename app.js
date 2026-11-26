// TapeLens UI.

const S = { proc: PROCESSORS[0], id: 1, c: null, bits: [], counts: {}, names: {} };

function levels(c) {
  const lv = new Array(2 + c.nIn + c.gates.length).fill(0);
  c.gates.forEach((g, i) => {
    const s = 2 + c.nIn + i;
    lv[s] = g.k === 'NAND' ? Math.max(lv[g.a], lv[g.b]) + 1 : 1;
  });
  return lv;
}

function draw() {
  const c = S.c; const box = $('diagram');
  if (!c) { box.innerHTML = ''; return; }
  const { sig } = simulate(c, S.bits);
  const n = Math.min(c.gates.length, MAX_DRAW);
  const lv = levels(c);
  const cols = {}; const pos = {};
  const W = 64, H = 26, PADX = 70, PADY = 16;
  for (let i = 0; i < c.nIn; i++) pos[2 + i] = { x: 18, y: PADY + i * (H + 8) + 6 };
  pos[0] = { x: 18, y: PADY + c.nIn * (H + 8) + 6 }; pos[1] = { x: 18, y: PADY + (c.nIn + 1) * (H + 8) + 6 };
  for (let i = 0; i < n; i++) {
    const s = 2 + c.nIn + i; const L = lv[s];
    cols[L] = (cols[L] || 0) + 1;
    pos[s] = { x: PADX + (L - 1) * (W + 34), y: PADY + (cols[L] - 1) * (H + 8) };
  }
  const maxX = Math.max(...Object.values(pos).map((p) => p.x)) + W + 40;
  const maxY = Math.max(...Object.values(pos).map((p) => p.y)) + H + 20;
  const firstOut = c.gates.length - c.nOut;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX}" height="${maxY}" font-family="Consolas,monospace" font-size="10">`;
  const col = (v) => (v ? '#c6f34f' : '#3a4256');
  for (let i = 0; i < n; i++) {
    const g = c.gates[i]; const s = 2 + c.nIn + i; const p = pos[s];
    const srcs = g.k === 'NAND' ? [g.a, g.b] : [g.d];
    srcs.forEach((q, j) => {
      const a = pos[q]; if (!a) return;
      const x1 = a.x + (q < 2 + c.nIn ? 30 : W), y1 = a.y + H / 2, x2 = p.x, y2 = p.y + 8 + j * 10;
      svg += `<path d="M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}" stroke="${col(sig[q])}" stroke-width="1.4" fill="none" opacity=".85"/>`;
    });
  }
  for (let i = 0; i < c.nIn; i++) { const p = pos[2 + i]; svg += `<rect x="${p.x}" y="${p.y}" width="30" height="${H - 6}" rx="5" fill="${col(sig[2 + i])}"/><text x="${p.x + 7}" y="${p.y + 14}" fill="${sig[2 + i] ? '#10140a' : '#e7ebf3'}">i${i}</text>`; }
  for (let i = 0; i < n; i++) {
    const g = c.gates[i]; const s = 2 + c.nIn + i; const p = pos[s]; const isOut = i >= firstOut; const v = sig[s];
    svg += `<rect x="${p.x}" y="${p.y}" width="${W}" height="${H}" rx="6" fill="${v ? '#2f3b12' : '#1b2130'}" stroke="${isOut ? '#c6f34f' : '#3a4256'}" stroke-width="${isOut ? 2 : 1}"/>`;
    svg += `<text x="${p.x + 6}" y="${p.y + 16}" fill="#e7ebf3">${g.k === 'NAND' ? '⊼' : 'L'} ${isOut ? 'o' + (i - firstOut) : 'g' + i}</text><circle cx="${p.x + W - 8}" cy="${p.y + H / 2}" r="4" fill="${col(v)}"/>`;
  }
  svg += '</svg>';
  box.innerHTML = svg + (c.gates.length > MAX_DRAW ? `<div class="meta" style="padding:6px 10px">Showing first ${MAX_DRAW} of ${c.gates.length} gates.</div>` : '');
}

function renderPins() {
  const c = S.c; const box = $('inputs'); box.innerHTML = '';
  for (let i = 0; i < c.nIn; i++) {
    const d = document.createElement('div');
    d.className = 'pin' + (S.bits[i] ? ' on' : '');
    d.innerHTML = `${S.bits[i] ? 1 : 0}<small>in ${i}</small>`;
    d.onclick = () => { S.bits[i] = S.bits[i] ? 0 : 1; renderPins(); draw(); showLocal(); };
    box.appendChild(d);
  }
}
const outChips = (bits) => '<div class="outs">' + bits.map((b, k) => `<span class="out${b ? ' on' : ''}">o${k}=${b}</span>`).join('') + '</div>';
function showLocal() {
  const { outs } = simulate(S.c, S.bits);
  $('result').innerHTML = `<div>Local simulation (your browser):</div>${outChips(outs)}<div class="meta">Press “Run on X Layer” to check this against the contract.</div>`;
}

function setUrl() {
  const q = new URLSearchParams({ p: S.proc, id: String(S.id), in: S.bits.join('') });
  history.replaceState(null, '', '?' + q.toString());
}

async function load() {
  S.proc = $('proc').value; S.id = Math.max(1, parseInt($('cid').value || '1'));
  $('info').textContent = 'Reading circuit from X Layer…'; $('diagram').innerHTML = ''; $('ttbox').innerHTML = '';
  try {
    const info = await circuitInfo(S.proc, S.id);
    if (!info.nOut && !info.gateCount) throw new Error('no circuit with this id');
    const gates = parseNetlist(decodeBytes(await call(S.proc, SEL.netlist + u256(S.id))));
    S.c = { ...info, gates };
    if (S.bits.length !== info.nIn) S.bits = new Array(info.nIn).fill(0);
    const nands = gates.filter((g) => g.k === 'NAND').length;
    const depth = Math.max(0, ...levels(S.c));
    $('info').innerHTML = `<b>${S.names[S.proc] || ''} #${S.id}</b> · inputs <b>${info.nIn}</b> · outputs <b>${info.nOut}</b> · gates <b>${gates.length}</b> (NAND ${nands}, LATCH ${gates.length - nands}) · depth <b>${depth}</b>` + (info.nState ? ' · <span class="bad">has state: on-chain eval() is not available, local tick shown</span>' : '');
    renderPins(); draw(); showLocal(); renderIdent(); setUrl();
  } catch (e) {
    S.c = null; $('info').innerHTML = `<span class="bad">Could not open circuit: ${e.message}</span>`; $('inputs').innerHTML = ''; $('result').innerHTML = '';
  }
}

async function runChain() {
  if (!S.c) return;
  const b = $('runChain'); b.disabled = true;
  try {
    const local = simulate(S.c, S.bits).outs;
    const chain = await evalOnChain(S.proc, S.id, S.bits, S.c.nOut);
    const same = chain.bits.every((v, i) => v === local[i]);
    $('result').innerHTML = `<div>On-chain <code>eval()</code> at block <b>${chain.block.toLocaleString()}</b>:</div>${outChips(chain.bits)}
      <div>Local simulation:</div>${outChips(local)}
      <div class="${same ? 'ok' : 'bad'}">${same ? '✓ Match — the contract and the decoded netlist agree.' : '✗ Mismatch — the decoded netlist and contract disagree for these inputs.'}</div>`;
    setUrl();
  } catch (e) {
    $('result').innerHTML = `<span class="bad">On-chain call failed: ${e.message}</span>`;
  } finally { b.disabled = false; }
}

function truthTable() {
  const c = S.c; if (!c) return;
  if (c.nIn > 10) { $('ttbox').innerHTML = '<div class="meta">Truth table is shown for circuits with up to 10 inputs.</div>'; return; }
  let h = '<table><tr>' + Array.from({ length: c.nIn }, (_, i) => `<th>i${i}</th>`).join('') + Array.from({ length: c.nOut }, (_, k) => `<th>o${k}</th>`).join('') + '</tr>';
  for (let m = 0; m < 1 << c.nIn; m++) {
    const bits = Array.from({ length: c.nIn }, (_, i) => (m >> i) & 1);
    const { outs } = simulate(c, bits);
    h += '<tr>' + bits.map((b) => `<td>${b}</td>`).join('') + outs.map((o) => `<td style="color:${o ? '#c6f34f' : ''}">${o}</td>`).join('') + '</tr>';
  }
  $('ttbox').innerHTML = h + '</table>';
}

async function init() {
  const sel = $('proc');
  for (const p of PROCESSORS) {
    const o = document.createElement('option'); o.value = p; o.textContent = p.slice(0, 8) + '…' + p.slice(-4); sel.appendChild(o);
    Promise.all([call(p, SEL.name), call(p, SEL.symbol)]).then(([n, s]) => {
      S.names[p] = decodeString(n); o.textContent = `${S.names[p]} (${decodeString(s)}) · ${p.slice(0, 6)}…${p.slice(-4)}`;
    }).catch(() => {});
  }
  const q = new URLSearchParams(location.search);
  if (q.get('p')) sel.value = q.get('p');
  if (q.get('id')) $('cid').value = q.get('id');
  if (q.get('in')) S.bits = q.get('in').split('').map((x) => (x === '1' ? 1 : 0));
  sel.onchange = updateMeta;
  $('load').onclick = () => { S.bits = []; load(); };
  $('runChain').onclick = runChain;
  $('tt').onclick = truthTable;
  $('share').onclick = async () => { setUrl(); try { await navigator.clipboard.writeText(location.href); $('share').textContent = 'Link copied'; setTimeout(() => ($('share').textContent = 'Copy share link'), 1500); } catch { prompt('Share link', location.href); } };
  $('rand').onclick = async () => { const n = S.counts[sel.value] || (await countCircuits(sel.value)); S.counts[sel.value] = n; $('cid').value = 1 + Math.floor(Math.random() * Math.max(1, n)); S.bits = []; load(); };
  await updateMeta();
  await load();
  if (q.get('run') === '1') runChain();
}
async function updateMeta() {
  const p = $('proc').value; $('procMeta').textContent = 'Counting circuits on this processor…';
  try {
    const n = S.counts[p] || (await countCircuits(p)); S.counts[p] = n;
    $('procMeta').innerHTML = `Processor <code>${p}</code> · <b>${n.toLocaleString()}</b> circuits · <a style="color:#8e98ab" href="https://www.oklink.com/xlayer/address/${p}" target="_blank" rel="noopener">view on explorer</a>`;
    $('cid').max = n;
  } catch (e) { $('procMeta').textContent = 'Could not count circuits: ' + e.message; }
}
init();

// ---------- spec / identify / twins ----------
function renderIdent() {
  if (!S.c) return;
  const ids = identify(S.c); const fp = fingerprint(S.c);
  $('ident').innerHTML = (ids.length ? ids.map((x) => `<div><b>${x}</b></div>`).join('') : '<div>Too large or stateful to identify automatically.</div>') + (fp ? `<div class="meta">Function fingerprint <code>${fp}</code> — circuits with the same fingerprint compute exactly the same thing.</div>` : '');
}
$('useGuess').onclick = () => {
  if (!S.c) return;
  const lines = identify(S.c).map((l) => l
    .replace(/= NOT (i\d+)/, '= !$1').replace(/= BUF (i\d+)/, '= $1')
    .replace(/= AND (i\d+) (i\d+)/, '= $1 & $2').replace(/= OR (i\d+) (i\d+)/, '= $1 | $2').replace(/= XOR (i\d+) (i\d+)/, '= $1 ^ $2')
    .replace(/= NAND (i\d+) (i\d+)/, '= !($1 & $2)').replace(/= NOR (i\d+) (i\d+)/, '= !($1 | $2)').replace(/= XNOR (i\d+) (i\d+)/, '= !($1 ^ $2)')
    .replace(/= (i\d+) AND NOT (i\d+)/, '= $1 & !$2').replace(/= MAJ (i\d+) (i\d+) (i\d+).*/, '= ($1&$2)|($1&$3)|($2&$3)').replace(/= XOR3 (i\d+) (i\d+) (i\d+).*/, '= $1^$2^$3')
    .replace(/= MUX (i\d+) \? (i\d+) : (i\d+)/, '= ($1&$2)|(!$1&$3)').replace(/= AND3 (i\d+) (i\d+) (i\d+)/, '= $1&$2&$3').replace(/= OR3 (i\d+) (i\d+) (i\d+)/, '= $1|$2|$3')
    .replace(/= constant (\d)/, '= $1')).filter((l) => !/custom/.test(l));
  $('spec').value = lines.join('\n');
};
$('checkSpec').onclick = async () => {
  if (!S.c) return;
  const out = $('specOut'); const btn = $('checkSpec');
  if (S.c.nState) { out.innerHTML = '<span class="bad">Stateful circuits cannot use eval() on-chain.</span>'; return; }
  if (S.c.nIn > 8) { out.innerHTML = '<span class="bad">Spec check runs up to 8 inputs (256 on-chain rows).</span>'; return; }
  let fns;
  try { fns = parseSpec($('spec').value, S.c.nIn, S.c.nOut); } catch (e) { out.innerHTML = `<span class="bad">${e.message}</span>`; return; }
  if (fns.every((f) => !f)) { out.innerHTML = '<span class="bad">Write at least one line, e.g. o0 = i0 ^ i1</span>'; return; }
  btn.disabled = true; out.innerHTML = `Running ${1 << S.c.nIn} rows on X Layer…`;
  try {
    const { rows, block } = await evalAllRowsOnChain(S.proc, S.id, S.c.nIn, S.c.nOut);
    const bad = [];
    rows.forEach((r, m) => {
      const x = Array.from({ length: S.c.nIn }, (_, i) => (m >> i) & 1);
      fns.forEach((f, k) => { if (f && f(x) !== r[k]) bad.push({ m, k, want: f(x), got: r[k], x }); });
    });
    const checked = fns.filter(Boolean).length;
    out.innerHTML = bad.length
      ? `<div class="bad">✗ Spec fails on ${bad.length} of ${rows.length * checked} checks (block ${block.toLocaleString()}).</div>` + bad.slice(0, 8).map((b) => `<div class="rowbad">inputs ${b.x.join('')} → o${b.k}: chain ${b.got}, spec ${b.want}</div>`).join('')
      : `<div class="ok">✓ All ${rows.length} input rows × ${checked} output(s) match your spec on-chain at block ${block.toLocaleString()}.</div>`;
    S.lastSpec = { ok: !bad.length, block };
  } catch (e) { out.innerHTML = `<span class="bad">On-chain check failed: ${e.message}</span>`; }
  finally { btn.disabled = false; }
};
$('badge').onclick = () => {
  if (!S.c) return;
  const base = location.href.split('?')[0].replace(/index\.html$/, '');
  const q = new URLSearchParams({ p: S.proc, id: String(S.id) });
  if ($('spec').value.trim()) q.set('spec', $('spec').value.trim());
  const url = `${base}badge.html?${q}`;
  $('badgeOut').innerHTML = `<div class="meta">Paste this on a marketplace or project page. The badge re-runs the check on X Layer every time it loads.</div><div class="badgecode">&lt;iframe src="${url}" width="420" height="150" style="border:0"&gt;&lt;/iframe&gt;</div><iframe src="${url}" width="420" height="150" style="border:0;margin-top:8px"></iframe>`;
};
$('twins').onclick = async () => {
  if (!S.c) return;
  const out = $('twinOut'); const btn = $('twins'); btn.disabled = true; out.textContent = 'Scanning nearby circuits on X Layer…';
  try {
    const total = S.counts[S.proc] || (await countCircuits(S.proc));
    const r = await findTwins(S.proc, S.c, S.id, total);
    if (!r.fp) out.innerHTML = '<span class="meta">Twin search needs a stateless circuit with up to 12 inputs.</span>';
    else out.innerHTML = `<div class="meta">Scanned ids ${r.lo}–${r.hi} (${r.scanned} with the same shape).</div>` + (r.twins.length
      ? `<div><b>${r.twins.length}</b> circuit(s) compute exactly the same function:</div>` + r.twins.map((t) => `<span class="twin" data-id="${t.id}">#${t.id} · ${t.gates} gates${t.gates < S.c.gates.length ? ' · smaller' : ''}</span>`).join('')
      : '<div>No twins nearby — this function looks unique in that range.</div>');
    out.querySelectorAll('.twin').forEach((el) => (el.onclick = () => { $('cid').value = el.dataset.id; S.bits = []; load(); }));
  } catch (e) { out.innerHTML = `<span class="bad">${e.message}</span>`; }
  finally { btn.disabled = false; }
};
