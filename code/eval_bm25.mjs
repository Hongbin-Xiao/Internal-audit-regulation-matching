import fs from 'node:fs';

const chunks = fs.readFileSync('_exp/corpus_chunks.jsonl', 'utf8').split(/\n/).filter(Boolean).map(s => JSON.parse(s));
const qs = JSON.parse(fs.readFileSync('_exp/questions_masked.json', 'utf8'));
const gt = JSON.parse(fs.readFileSync('_exp/ground_truth.json', 'utf8'));

const CONTAMINATED = /审计问题定性法规向导|应知应会法律法规清单/;
const docs = [];  // 检索文档
const docFile = [];
for (const c of chunks) {
  if (CONTAMINATED.test(c.file)) continue;
  docs.push(c.text);
  docFile.push(c.file);
}
console.log('BM25 语料片段: ' + docs.length);

const fileSet = new Set(docFile);
const items = [];
for (let i = 0; i < qs.length; i++) {
  const files = gt[i].files.filter(f => fileSet.has(f));
  if (files.length) items.push({ i, files });
}
console.log('可评测问题: ' + items.length);

// 查询分词：字符二元组（去占位符与标点）
const clean = s => s.replace(/\*+/g, '').replace(/[\s\u3000]/g, '');
function bigrams(s) {
  const t = clean(s).replace(/[，。、；：（）()《》“”"'’‘！？!?,.;:\[\]【】——\-]/g, '');
  const out = [];
  for (let i = 0; i + 1 < t.length; i++) out.push(t.slice(i, i + 2));
  return out;
}
const queries = items.map(it => {
  const q = qs[it.i];
  const terms = bigrams(q.q + q.desc);
  return { i: it.i, files: it.files, terms: [...new Set(terms)], std: q.std };
});

// 只为查询词建倒排
const vocab = new Set();
for (const q of queries) for (const t of q.terms) vocab.add(t);
console.log('查询词表大小: ' + vocab.size);

const postings = new Map();   // term -> [docId, tf, ...]
const docLen = new Int32Array(docs.length);
let avgdl = 0;
for (let d = 0; d < docs.length; d++) {
  const t = clean(docs[d]).replace(/[，。、；：（）()《》“”"'’‘！？!?,.;:\[\]【】——\-]/g, '');
  docLen[d] = t.length;
  avgdl += t.length;
  const tf = new Map();
  for (let i = 0; i + 1 < t.length; i++) {
    const g = t.slice(i, i + 2);
    if (!vocab.has(g)) continue;
    tf.set(g, (tf.get(g) || 0) + 1);
  }
  for (const [g, c] of tf) {
    let arr = postings.get(g);
    if (!arr) { arr = []; postings.set(g, arr); }
    arr.push(d, c);
  }
}
avgdl /= docs.length;
console.log('倒排构建完成, 命中词 ' + postings.size + ', 平均文档长度 ' + avgdl.toFixed(0));

const k1 = 1.2, b = 0.75;
const KS = [1, 3, 5, 10, 20];
const hit = {}; const artHit = {};
for (const k of KS) { hit[k] = 0; artHit[k] = 0; }
const t0 = Date.now();
for (const q of queries) {
  const scores = new Map();
  for (const term of q.terms) {
    const arr = postings.get(term);
    if (!arr) continue;
    const df = arr.length / 2;
    const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
    for (let j = 0; j < arr.length; j += 2) {
      const d = arr[j], tf = arr[j + 1];
      const s = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen[d] / avgdl));
      scores.set(d, (scores.get(d) || 0) + s);
    }
  }
  const top = [...scores.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 20);
  const arts = (q.std.match(/第[零〇一二三四五六七八九十百千0-9]{1,8}条/g) || []);
  for (const k of KS) {
    const tk = top.slice(0, k);
    if (tk.some(([d]) => q.files.includes(docFile[d]))) hit[k]++;
    if (arts.length && tk.some(([d]) => q.files.includes(docFile[d]) && arts.some(a => docs[d].includes(a)))) artHit[k]++;
  }
}
const M = items.length;
console.log('\n=== BM25（字符二元组） 用时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's ===');
console.log('k\t文件级命中\t条款级命中');
for (const k of KS) console.log(k + '\t' + (hit[k] / M * 100).toFixed(2) + '%\t\t' + (artHit[k] / M * 100).toFixed(2) + '%');
fs.writeFileSync('_exp/retrieval_bm25.json', JSON.stringify({ M, hit, artHit, KS }, null, 1), 'utf8');
