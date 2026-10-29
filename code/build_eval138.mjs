import fs from 'node:fs';
// 1) 组装 138 题（与论文配对样本一致）
const paired = JSON.parse(fs.readFileSync('_parsed/paired.json', 'utf8')).filter(p => (p.labels.RAG.std || '').trim().length > 3);
const all = JSON.parse(fs.readFileSync('_exp/questions_all.json', 'utf8'));
const key = s => s.replace(/\s+/g, '').slice(0, 60);
const byKey = new Map();
for (const v of all) byKey.set(v.ds + '||' + key(v.q), v);
const items = [];
for (const p of paired) {
  const v = byKey.get(p.ds + '||' + key(p.q));
  if (!v) continue;
  items.push({ ds: p.ds, q: v.q, desc: v.desc, std: p.labels.RAG.std, labels: { BASE: p.labels.BASE.label, KB: p.labels.KB.label, CoT: p.labels.CoT.label, KB_CoT: p.labels.KB_CoT.label, RAG: p.labels.RAG.label } });
}
console.log('配对题目: ' + items.length);
fs.writeFileSync('_exp/eval138.json', JSON.stringify(items, null, 1), 'utf8');
const byDs = {}; for (const v of items) byDs[v.ds] = (byDs[v.ds] || 0) + 1;
console.log('分布: ' + JSON.stringify(byDs));
console.log('标签分布(RAG): 1=' + items.filter(v => v.labels.RAG === '1').length + ' 2=' + items.filter(v => v.labels.RAG === '2').length + ' 0=' + items.filter(v => v.labels.RAG === '0').length);
// 2) 对每题做 BM25 top-5 检索，保存上下文（供 RAG 提示词使用）
const chunks = fs.readFileSync('_exp/corpus_chunks.jsonl', 'utf8').split(/\n/).filter(Boolean).map(s => JSON.parse(s));
const CONTAMINATED = /审计问题定性法规向导|应知应会法律法规清单/;
const docs = [], docFile = [];
for (const c of chunks) { if (CONTAMINATED.test(c.file)) continue; docs.push(c.text); docFile.push(c.file); }
const clean = s => s.replace(/\*+/g, '').replace(/[\s\u3000，。、；：（）()《》“”"'’‘！？!?,.;:\[\]【】——\-]/g, '');
const bigr = s => { const t = clean(s); const o = []; for (let i = 0; i + 1 < t.length; i++) o.push(t.slice(i, i + 2)); return o; };
const qterms = items.map(v => [...new Set(bigr(v.q + ' ' + v.desc))]);
const vocab = new Set(); for (const t of qterms) for (const x of t) vocab.add(x);
const postings = new Map(); const docLen = new Int32Array(docs.length); let avgdl = 0;
for (let d = 0; d < docs.length; d++) {
  const t = clean(docs[d]); docLen[d] = t.length || 1; avgdl += docLen[d];
  const tf = new Map();
  for (let i = 0; i + 1 < t.length; i++) { const g = t.slice(i, i + 2); if (!vocab.has(g)) continue; tf.set(g, (tf.get(g) || 0) + 1); }
  for (const [g, c] of tf) { let a = postings.get(g); if (!a) { a = []; postings.set(g, a); } a.push(d, c); }
}
avgdl /= docs.length;
const k1 = 1.2, b = 0.75;
const ctx = [];
for (const terms of qterms) {
  const sc = new Map();
  for (const term of terms) {
    const arr = postings.get(term); if (!arr) continue;
    const df = arr.length / 2, idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
    for (let j = 0; j < arr.length; j += 2) { const d = arr[j], tf = arr[j + 1]; sc.set(d, (sc.get(d) || 0) + idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen[d] / avgdl))); }
  }
  const top = [...sc.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 5).map(([d]) => d);
  ctx.push(top.map(d => ({ file: docFile[d], text: docs[d].slice(0, 700) })));
}
fs.writeFileSync('_exp/contexts_bm25.json', JSON.stringify(ctx), 'utf8');
console.log('已生成每题 top-5 检索上下文，平均长度 ' + Math.round(ctx.flat().reduce((a, c) => a + c.text.length, 0) / ctx.length) + ' 字');
console.log('样例上下文:'); ctx[0].slice(0, 3).forEach(c => console.log('   [' + c.file.slice(0, 40) + '] ' + c.text.slice(0, 70)));
