import fs from 'node:fs';

// ---------- 载入 ----------
const chunks = fs.readFileSync('_exp/corpus_chunks.jsonl', 'utf8').split(/\n/).filter(Boolean).map(s => JSON.parse(s));
const ids = JSON.parse(fs.readFileSync('_exp/corpus_ids.json', 'utf8'));
const buf = fs.readFileSync('_exp/corpus_vectors.f32');
const dim = 1024;
const N = ids.length;
const vecs = new Float32Array(buf.buffer, buf.byteOffset, N * dim);
const qv = JSON.parse(fs.readFileSync('_exp/question_vectors.json', 'utf8'));
const qs = JSON.parse(fs.readFileSync('_exp/questions_masked.json', 'utf8'));

// ---------- 污染文件过滤 ----------
const CONTAMINATED = /审计问题定性法规向导|应知应会法律法规清单/;
const chunkFile = new Map();
for (const c of chunks) chunkFile.set(c.id, c.file);
const allowed = new Uint8Array(N);
for (let i = 0; i < N; i++) allowed[ids[i]] = (chunkFile.get(ids[i]) && !CONTAMINATED.test(chunkFile.get(ids[i]))) ? 1 : 0;
const allowedCount = allowed.reduce((a, b) => a + b, 0);
console.log('检索语料切片: ' + allowedCount + ' / ' + N + '（已排除定性向导/清单等污染文件）');

// ---------- 真值 ----------
const gt = JSON.parse(fs.readFileSync('_exp/ground_truth.json', 'utf8'));
const fileSet = new Set();
for (const c of chunks) if (!CONTAMINATED.test(c.file)) fileSet.add(c.file);

// 重新映射：只保留能对应到“允许文件”的真值
function recheck(names) {
  const out = [];
  for (const f of names) if (fileSet.has(f)) out.push(f);
  return out;
}
const items = [];
for (let i = 0; i < qs.length; i++) {
  const files = recheck(gt[i].files);
  if (files.length) items.push({ i, files, std: qs[i].std });
}
console.log('可评测问题: ' + items.length);

// ---------- 稠密检索 ----------
function denseTopK(qi, k) {
  const q = qv[qi];
  const best = [];
  for (let i = 0; i < N; i++) {
    if (!allowed[i]) continue;
    const off = i * dim;
    let s = 0;
    for (let d = 0; d < dim; d++) s += q[d] * vecs[off + d];
    if (best.length < k) { best.push({ i, s }); best.sort((a, b) => b.s - a.s); }
    else if (s > best[k - 1].s) { best[k - 1] = { i, s }; best.sort((a, b) => b.s - a.s); }
  }
  return best;
}
const KS = [1, 3, 5, 10, 20];
const denseHit = {}; const denseArtHit = {};
for (const k of KS) { denseHit[k] = 0; denseArtHit[k] = 0; }
const t0 = Date.now();
for (const it of items) {
  const top = denseTopK(it.i, 20);
  const q = qs[it.i];
  for (const k of KS) {
    const topK = top.slice(0, k);
    const files = topK.map(t => chunkFile.get(ids[t.i]));
    if (files.some(f => it.files.includes(f))) denseHit[k]++;
    // 条款级：命中文件 且 片段中含标准答案的条号
    const arts = (q.std.match(/第[零〇一二三四五六七八九十百千0-9]{1,8}条/g) || []);
    if (arts.length) {
      const ok = topK.some((t, idx) => it.files.includes(files[idx]) && arts.some(a => chunks[t.i].text.includes(a)));
      if (ok) denseArtHit[k]++;
    }
  }
}
console.log('\n=== 稠密检索（qwen3.7-text-embedding） 用时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's ===');
console.log('k\t文件级命中\t条款级命中');
const M = items.length;
for (const k of KS) {
  console.log(k + '\t' + (denseHit[k] / M * 100).toFixed(2) + '%\t\t' + (denseArtHit[k] / M * 100).toFixed(2) + '%');
}
fs.writeFileSync('_exp/retrieval_dense.json', JSON.stringify({ M, denseHit, denseArtHit, KS }, null, 1), 'utf8');
