import fs from 'node:fs';
const csv = fs.readFileSync('_secrets/bailian.csv', 'utf8');
const cfg = {};
for (const line of csv.split(/\r?\n/)) { const i = line.indexOf(','); if (i > 0) cfg[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
const H = { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' };
const MODEL = process.env.LLM_MODEL || 'qwen3.8-max';
const CONC = Number(process.env.CONC || 10);

const items = JSON.parse(fs.readFileSync('_exp/eval138.json', 'utf8'));
const ctxs = JSON.parse(fs.readFileSync('_exp/contexts_bm25_named.json', 'utf8'));

async function call(prompt, maxTok) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(cfg.openAiCompatible + '/chat/completions', {
        method: 'POST', headers: H,
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0, enable_thinking: false, max_tokens: maxTok || 120 })
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return { text: j.choices[0].message.content, usage: j.usage };
    } catch (e) { if (a === 2) return { text: 'ERROR: ' + e.message, usage: null }; await new Promise(res => setTimeout(res, 1500 * (a + 1))); }
  }
}

const outPath = '_exp/llm6_verify_' + MODEL.replace(/[^a-z0-9.]/gi, '_') + '.jsonl';
const store = new Map();
if (fs.existsSync(outPath)) for (const l of fs.readFileSync(outPath, 'utf8').split(/\n/)) { if (!l.trim()) continue; try { const o = JSON.parse(l); store.set(o.i, o); } catch {} }
const out = fs.createWriteStream(outPath, { flags: 'a' });

// 原始回答
const ansMap = new Map();
for (const l of fs.readFileSync('_exp/llm5_bm25rag_qwen3.8_max_k5.jsonl', 'utf8').split(/\n/)) {
  if (!l.trim()) continue; const o = JSON.parse(l); ansMap.set(o.i, o.text);
}

const todo = items.map((_, i) => i).filter(i => !store.has(i));
let cur = 0;
async function w() {
  while (cur < todo.length) {
    const i = todo[cur++];
    const ctx = (ctxs[i] || []).slice(0, 5);
    const refs = ctx.map((c, j) => (j + 1) + '.《' + c.name + '》' + c.text).join('\n');
    const prev = (ansMap.get(i) || '').slice(-600);
    const p = ['【任务】核对审计问题的法规条款引用。',
      '【审计问题】' + items[i].q,
      '【问题描述】' + (items[i].desc || '（无）').slice(0, 800),
      '', '【参考条文】', refs, '',
      '【待核对结论（节选）】', prev, '',
      '【要求】仅依据上述参考条文，选出最支持该定性结论的一条条款。',
      '输出格式：只输出一行“《法规名称》第X条”。若参考条文均不适用，只输出“依据不足”。'].join('\n');
    const r = await call(p, 120);
    const o = { i, mode: 'verify', text: r.text, usage: r.usage };
    store.set(i, o);
    out.write(JSON.stringify(o) + '\n');
    if (store.size % 30 === 0) console.log('  ' + store.size + '/' + items.length);
  }
}
console.log('核验待跑 ' + todo.length);
await Promise.all(Array.from({ length: CONC }, w));
out.end();
console.log('完成 ' + store.size + ' -> ' + outPath);
