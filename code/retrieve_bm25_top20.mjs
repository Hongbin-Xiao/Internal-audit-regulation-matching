import fs from 'node:fs';

const chunks = fs.readFileSync('_exp/corpus_chunks_named.jsonl', 'utf8').split(/\n/).filter(Boolean).map(s => JSON.parse(s));
const items = JSON.parse(fs.readFileSync('_exp/eval138.json', 'utf8'));
const CONTAMINATED = /审计问题定性法规向导|应知应会法律法规清单/;

const docs = [], docName = [], docFile = [];
for (const c of chunks) {
  if (CONTAMINATED.test(c.file)) continue;
  docs.push(c.text); docName.push(c.name); docFile.push(c.file);
}
console.log('语料片段 ' + docs.length);

const clean = s => s.replace(/\*+/g, '').replace(/[\s\u3000]/g, '');
const strip = s => s.replace(/[，。、；：（）()《》“”"'’‘！？!?,.;:\[\]【】——\-]/g, '');
function bigrams(s) {
  const t = strip(clean(s));
  const out = [];
  for (let i = 0; i + 1 < t.length; i++) out.push(t.slice(i, i + 2));
  return [...new Set(out)];
}

const queries = items.map(it => bigrams(it.q + (it.desc || '')));
const vocab = new Set();
for (const q of queries) for (const g of q) vocab.add(g);

const postings = new Map();
const docLen = new Int32Array(docs.length);
let avgdl = 0;
for (let d = 0; d < docs.length; d++) {
  const t = strip(clean(docs[d]));
  docLen[d] = t.length; avgdl += t.length;
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
console.log('倒排完成，命中词 ' + postings.size);

const k1 = 1.2, b = 0.75, TOPK = 20;
const out = [];
for (let qi = 0; qi < items.length; qi++) {
  const scores = new Map();
  for (const term of queries[qi]) {
    const arr = postings.get(term);
    if (!arr) continue;
    const df = arr.length / 2;
    const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
    for (let j = 0; j < arr.length; j += 2) {
      const d = arr[j], tf = arr[j + 1];
      scores.set(d, (scores.get(d) || 0) + idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen[d] / avgdl)));
    }
  }
  const top = [...scores.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, TOPK);
  out.push(top.map(([d]) => ({ name: docName[d], file: docFile[d], text: docs[d] })));
  if ((qi + 1) % 30 === 0) console.log('  ' + (qi + 1));
}
fs.writeFileSync('_exp/contexts_bm25_top20.json', JSON.stringify(out), 'utf8');
console.log('已写出 _exp/contexts_bm25_top20.json');
