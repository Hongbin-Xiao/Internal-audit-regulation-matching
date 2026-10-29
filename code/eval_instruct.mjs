import fs from 'node:fs';
const csv = fs.readFileSync('_secrets/bailian.csv', 'utf8');
const cfg = {};
for (const line of csv.split(/\r?\n/)) { const i = line.indexOf(','); if (i > 0) cfg[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
const H = { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' };

const chunks = fs.readFileSync('_exp/corpus_chunks.jsonl', 'utf8').split(/\n/).filter(Boolean).map(s => JSON.parse(s));
const ids = JSON.parse(fs.readFileSync('_exp/corpus_ids.json', 'utf8'));
const buf = fs.readFileSync('_exp/corpus_vectors.f32');
const dim = 1024, N = ids.length;
const vecs = new Float32Array(buf.buffer, buf.byteOffset, N * dim);
const qs = JSON.parse(fs.readFileSync('_exp/questions_masked.json', 'utf8'));
const gt = JSON.parse(fs.readFileSync('_exp/ground_truth.json', 'utf8'));
const CONTAMINATED = /审计问题定性法规向导|应知应会法律法规清单/;
const allowed = new Uint8Array(N);
for (let i = 0; i < N; i++) allowed[i] = CONTAMINATED.test(chunks[ids[i]].file) ? 0 : 1;
const fileSet = new Set(chunks.filter(c => !CONTAMINATED.test(c.file)).map(c => c.file));
const items = [];
for (let i = 0; i < qs.length; i++) { const files = gt[i].files.filter(f => fileSet.has(f)); if (files.length) items.push({ i, files }); }
console.log('可评测问题: ' + items.length);

const INSTR_EN = 'Instruct: Given an audit problem, retrieve the legal provisions that can be cited to qualify the problem\nQuery: ';
const INSTR_ZH = '指令：给定一个内部审计问题，检索可用于该问题定性的法规条款\n查询：';
const variants = [
  { name: 'A 标题+描述(无指令)', build: q => (q.q + ' ' + q.desc).slice(0, 1500) },
  { name: 'B 英文指令+标题+描述', build: q => INSTR_EN + (q.q + ' ' + q.desc).slice(0, 1400) },
  { name: 'C 中文指令+标题+描述', build: q => INSTR_ZH + (q.q + ' ' + q.desc).slice(0, 1400) },
  { name: 'D 英文指令+仅标题', build: q => INSTR_EN + q.q.slice(0, 400) }
];
const KS = [1, 3, 5, 10];
for (const v of variants) {
  const inputs = items.map(it => v.build(qs[it.i]).replace(/\s+/g, ' '));
  const vecsQ = [];
  for (let i = 0; i < inputs.length; i += 10) {
    const r = await fetch(cfg.openAiCompatible + '/embeddings', { method: 'POST', headers: H, body: JSON.stringify({ model: 'qwen3.7-text-embedding', input: inputs.slice(i, i + 10) }) });
    const j = await r.json();
    if (!j.data) { console.log(v.name + ' 嵌入失败 ' + JSON.stringify(j).slice(0, 120)); break; }
    for (const d of j.data) vecsQ.push(d.embedding);
  }
  if (vecsQ.length !== items.length) continue;
  const hit = {}; for (const k of KS) hit[k] = 0;
  for (let qi = 0; qi < items.length; qi++) {
    const q = vecsQ[qi]; const best = [];
    for (let i = 0; i < N; i++) {
      if (!allowed[i]) continue;
      const off = i * dim; let s = 0;
      for (let d = 0; d < dim; d++) s += q[d] * vecs[off + d];
      if (best.length < 10) { best.push({ i, s }); best.sort((a, b) => b.s - a.s); }
      else if (s > best[9].s) { best[9] = { i, s }; best.sort((a, b) => b.s - a.s); }
    }
    for (const k of KS) if (best.slice(0, k).some(x => items[qi].files.includes(chunks[x.i].file))) hit[k]++;
  }
  console.log(v.name.padEnd(22) + ' -> ' + KS.map(k => '@' + k + ' ' + (hit[k] / items.length * 100).toFixed(2) + '%').join('  '));
}
