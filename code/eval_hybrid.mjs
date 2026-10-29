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
const qv = JSON.parse(fs.readFileSync('_exp/question_vectors.json', 'utf8'));
const qs = JSON.parse(fs.readFileSync('_exp/questions_masked.json', 'utf8'));
const gt = JSON.parse(fs.readFileSync('_exp/ground_truth.json', 'utf8'));

const CONTAMINATED = /审计问题定性法规向导|应知应会法律法规清单/;
const allowed = new Uint8Array(N);
const docFile = [];
for (let i = 0; i < N; i++) { const f = chunks[ids[i]].file; allowed[ids[i]] = CONTAMINATED.test(f) ? 0 : 1; }
const fileSet = new Set(chunks.filter(c => !CONTAMINATED.test(c.file)).map(c => c.file));
const items = [];
for (let i = 0; i < qs.length; i++) { const files = gt[i].files.filter(f => fileSet.has(f)); if (files.length) items.push({ i, files, std: qs[i].std }); }
console.log('可评测问题: ' + items.length);

// ----- BM25 -----
const clean = s => s.replace(/\*+/g, '').replace(/[\s\u3000，。、；：（）()《》“”"'’‘！？!?,.;:\[\]【】——\-]/g, '');
function bigrams(s) { const t = clean(s); const o = []; for (let i = 0; i + 1 < t.length; i++) o.push(t.slice(i, i + 2)); return o; }
const queries = items.map(it => ({ i: it.i, files: it.files, terms: [...new Set(bigrams(qs[it.i].q + qs[it.i].desc))], std: qs[it.i].std }));
const vocab = new Set(); for (const q of queries) for (const t of q.terms) vocab.add(t);
const postings = new Map(); const docLen = new Int32Array(N); let avgdl = 0, nd = 0;
for (let d = 0; d < N; d++) {
  if (!allowed[d]) { docLen[d] = 0; continue; }
  const t = clean(chunks[d].text); docLen[d] = t.length || 1; avgdl += docLen[d]; nd++;
  const tf = new Map();
  for (let i = 0; i + 1 < t.length; i++) { const g = t.slice(i, i + 2); if (!vocab.has(g)) continue; tf.set(g, (tf.get(g) || 0) + 1); }
  for (const [g, c] of tf) { let a = postings.get(g); if (!a) { a = []; postings.set(g, a); } a.push(d, c); }
}
avgdl /= nd;
const k1 = 1.2, b = 0.75;
function bm25Top(q, k) {
  const sc = new Map();
  for (const term of q.terms) {
    const arr = postings.get(term); if (!arr) continue;
    const df = arr.length / 2, idf = Math.log(1 + (nd - df + 0.5) / (df + 0.5));
    for (let j = 0; j < arr.length; j += 2) {
      const d = arr[j], tf = arr[j + 1];
      sc.set(d, (sc.get(d) || 0) + idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen[d] / avgdl)));
    }
  }
  return [...sc.entries()].sort((a, bb) => bb[1] - a[1]).slice(0, k).map(([d]) => d);
}
function denseTop(qi, k) {
  const q = qv[qi]; const best = [];
  for (let i = 0; i < N; i++) {
    if (!allowed[i]) continue;
    const off = i * dim; let s = 0;
    for (let d = 0; d < dim; d++) s += q[d] * vecs[off + d];
    if (best.length < k) { best.push({ i, s }); best.sort((a, b2) => b2.s - a.s); }
    else if (s > best[k - 1].s) { best[k - 1] = { i, s }; best.sort((a, b2) => b2.s - a.s); }
  }
  return best.map(x => x.i);
}
// ----- RRF 融合 + 重排 -----
const KS = [1, 3, 5, 10];
const res = { rrf: {}, rerank: {} };
for (const k of KS) { res.rrf[k] = 0; res.rerank[k] = 0; }
let rerankTokens = 0;
const t0 = Date.now();
for (const q of queries) {
  const bm = bm25Top(q, 20), dn = denseTop(q.i, 20);
  const RRF_K = 60; const fuse = new Map();
  bm.forEach((d, r) => fuse.set(d, (fuse.get(d) || 0) + 1 / (RRF_K + r + 1)));
  dn.forEach((d, r) => fuse.set(d, (fuse.get(d) || 0) + 1 / (RRF_K + r + 1)));
  const fused = [...fuse.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 20).map(([d]) => d);
  const arts = (q.std.match(/第[零〇一二三四五六七八九十百千0-9]{1,8}条/g) || []);
  for (const k of KS) if (fused.slice(0, k).some(d => q.files.includes(chunks[d].file))) res.rrf[k]++;
  // 重排
  try {
    const r = await fetch(cfg.dashScope + '/services/rerank/text-rerank/text-rerank', { method: 'POST', headers: H,
      body: JSON.stringify({ model: 'qwen3.7-text-rerank', input: { query: (qs[q.i].q + ' ' + qs[q.i].desc).slice(0, 1500), documents: fused.map(d => chunks[d].text) }, parameters: { top_n: 20, return_documents: false } }) });
    const j = await r.json();
    rerankTokens += (j.usage && j.usage.total_tokens) || 0;
    const order = j.output.results.sort((a, b2) => b2.relevance_score - a.relevance_score).map(x => fused[x.index]);
    for (const k of KS) if (order.slice(0, k).some(d => q.files.includes(chunks[d].file))) res.rerank[k]++;
  } catch (e) { console.log('rerank fail @' + q.i + ': ' + e.message); }
}
const M = items.length;
console.log('\n=== 混合检索（BM25 + 稠密，RRF 融合） ===');
for (const k of KS) console.log('  文件级命中@' + k + ': ' + (res.rrf[k] / M * 100).toFixed(2) + '%');
console.log('\n=== 混合检索 + qwen3.7-text-rerank 重排 ===');
for (const k of KS) console.log('  文件级命中@' + k + ': ' + (res.rerank[k] / M * 100).toFixed(2) + '%');
console.log('\n用时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's  重排 tokens=' + rerankTokens);
fs.writeFileSync('_exp/retrieval_hybrid.json', JSON.stringify({ M, rrf: res.rrf, rerank: res.rerank, rerankTokens }, null, 1), 'utf8');
