import fs from 'node:fs';
const csv = fs.readFileSync('_secrets/bailian.csv', 'utf8');
const cfg = {};
for (const line of csv.split(/\r?\n/)) { const i = line.indexOf(','); if (i > 0) cfg[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
const H = { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' };
const qs = JSON.parse(fs.readFileSync('_exp/questions_masked.json', 'utf8'));
const inputs = qs.map(q => (q.q + ' ' + q.desc).replace(/\s+/g, ' ').slice(0, 1500));
const vecs = [];
let tokens = 0;
for (let i = 0; i < inputs.length; i += 10) {
  const batch = inputs.slice(i, i + 10);
  const r = await fetch(cfg.openAiCompatible + '/embeddings', { method: 'POST', headers: H, body: JSON.stringify({ model: 'qwen3.7-text-embedding', input: batch }) });
  const j = await r.json();
  if (!j.data) { console.log('失败 @' + i + ': ' + JSON.stringify(j).slice(0, 200)); break; }
  tokens += (j.usage && j.usage.total_tokens) || 0;
  for (const d of j.data) vecs.push(d.embedding);
}
fs.writeFileSync('_exp/question_vectors.json', JSON.stringify(vecs), 'utf8');
console.log('问题嵌入: ' + vecs.length + ' / ' + inputs.length + '  tokens=' + tokens);
// 双模式：只用问题标题（更严格）
const titles = qs.map(q => q.q.replace(/\s+/g, ' ').slice(0, 500));
const vecs2 = [];
for (let i = 0; i < titles.length; i += 10) {
  const r = await fetch(cfg.openAiCompatible + '/embeddings', { method: 'POST', headers: H, body: JSON.stringify({ model: 'qwen3.7-text-embedding', input: titles.slice(i, i + 10) }) });
  const j = await r.json();
  if (j.data) for (const d of j.data) vecs2.push(d.embedding);
}
fs.writeFileSync('_exp/question_vectors_title.json', JSON.stringify(vecs2), 'utf8');
console.log('标题嵌入: ' + vecs2.length);
