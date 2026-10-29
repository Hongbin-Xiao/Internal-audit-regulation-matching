import fs from 'node:fs';

const csv = fs.readFileSync('_secrets/bailian.csv', 'utf8');
const cfg = {};
for (const line of csv.split(/\r?\n/)) { const i = line.indexOf(','); if (i > 0) cfg[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
const base = cfg.openAiCompatible;
const H = { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' };

const MODEL = process.env.EMB_MODEL || 'qwen3.7-text-embedding';
const BATCH = 16;
const CONC = 4;

const chunks = fs.readFileSync('_exp/corpus_chunks.jsonl', 'utf8').split(/\n/).filter(Boolean).map(s => JSON.parse(s));
const outPath = '_exp/embeddings_' + MODEL.replace(/[^a-z0-9.]/gi, '_') + '.jsonl';
const done = new Set();
if (fs.existsSync(outPath)) {
  for (const l of fs.readFileSync(outPath, 'utf8').split(/\n/)) {
    if (!l.trim()) continue;
    try { done.add(JSON.parse(l).id); } catch {}
  }
}
const todo = chunks.filter(c => !done.has(c.id));
console.log('模型 ' + MODEL + ' | 待嵌入 ' + todo.length + ' / ' + chunks.length);
const out = fs.createWriteStream(outPath, { flags: 'a' });
let ok = 0, fail = 0, tokens = 0;
const t0 = Date.now();

async function embedBatch(batch) {
  const body = JSON.stringify({ model: MODEL, input: batch.map(c => c.text), encoding_format: 'float' });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(base + '/embeddings', { method: 'POST', headers: H, body });
      if (!r.ok) { const t = await r.text(); throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 120)); }
      const j = await r.json();
      tokens += (j.usage && j.usage.total_tokens) || 0;
      return j.data.map(d => d.embedding);
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(res => setTimeout(res, 800 * (attempt + 1)));
    }
  }
}

let cursor = 0;
async function worker() {
  while (cursor < todo.length) {
    const start = cursor;
    cursor += BATCH;
    const batch = todo.slice(start, start + BATCH);
    if (!batch.length) break;
    try {
      const vecs = await embedBatch(batch);
      for (let i = 0; i < batch.length; i++) out.write(JSON.stringify({ id: batch[i].id, v: vecs[i] }) + '\n');
      ok += batch.length;
    } catch (e) { fail += batch.length; console.log('BATCH FAIL @' + start + ': ' + e.message); }
    if (ok % 1600 < BATCH) {
      const el = (Date.now() - t0) / 1000;
      console.log('进度 ' + ok + '/' + todo.length + ' | ' + el.toFixed(0) + 's | ' + (ok / el).toFixed(1) + ' 条/s | tokens=' + tokens);
    }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
out.end();
console.log('完成 ok=' + ok + ' fail=' + fail + ' tokens=' + tokens + ' 用时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
console.log('输出: ' + outPath);
