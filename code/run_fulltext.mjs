import fs from 'node:fs';
import path from 'node:path';

const csv = fs.readFileSync('_secrets/bailian.csv', 'utf8');
const cfg = {};
for (const line of csv.split(/\r?\n/)) { const i = line.indexOf(','); if (i > 0) cfg[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
const H = { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' };
const MODEL = process.env.LLM_MODEL || 'qwen3.8-max';
const CONC = Number(process.env.CONC || 8);

const items = JSON.parse(fs.readFileSync('_exp/eval138.json', 'utf8'));
const ctxs = JSON.parse(fs.readFileSync('_exp/contexts_bm25_top20.json', 'utf8'));
const subset = JSON.parse(fs.readFileSync('_exp/fulltext_subset.json', 'utf8'));

async function call(prompt, maxTok) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(cfg.openAiCompatible + '/chat/completions', {
        method: 'POST', headers: H,
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0, enable_thinking: false, max_tokens: maxTok || 700 })
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return { text: j.choices[0].message.content, usage: j.usage };
    } catch (e) { if (a === 2) return { text: 'ERROR: ' + e.message, usage: null }; await new Promise(res => setTimeout(res, 1500 * (a + 1))); }
  }
}

const outPath = '_exp/llm7_fulltext_' + MODEL.replace(/[^a-z0-9.]/gi, '_') + '.jsonl';
const store = new Map();
if (fs.existsSync(outPath)) for (const l of fs.readFileSync(outPath, 'utf8').split(/\n/)) { if (!l.trim()) continue; try { const o = JSON.parse(l); store.set(o.i, o); } catch {} }
const out = fs.createWriteStream(outPath, { flags: 'a' });

const DOMAIN = { G1: '预算执行审计', G2: '经济责任审计', T1: '财务收支审计', T2: '资产管理审计' };
const todo = subset.filter(i => !store.has(i));
let cur = 0;
async function w() {
  while (cur < todo.length) {
    const i = todo[cur++];
    const file = ctxs[i][0].file;
    const name = path.basename(file).replace(/\.txt$/, '');
    const full = fs.readFileSync(path.join('_parsed', 'text', file + '.txt'), 'utf8');
    const p = ['【角色】你是一名内部审计专家，负责对审计问题作出专业判断并给出法规依据。',
      '【背景】被审计单位为广西某高校，适用国家法律、自治区规定与校内制度。',
      '【领域】' + (DOMAIN[items[i].ds] || '内部审计'),
      '【待查事项】' + items[i].q,
      '【问题描述】' + (items[i].desc || '（无）').slice(0, 1200),
      '', '【参考法规全文】《' + name + '》', full.slice(0, 12000), '',
      '【执行步骤】①任务确认；②法规定位；③条款查找（给出具体条款编号）；④完整性核对；⑤结论。',
      '',
      '【输出格式】先简要说明理由，最后一行按"《法规名称》第X条"给出最终采用的法规依据。'].join('\n');
    const r = await call(p, 700);
    const o = { i, mode: 'fulltext', text: r.text, usage: r.usage };
    store.set(i, o);
    out.write(JSON.stringify(o) + '\n');
    console.log('  ' + store.size + '/' + subset.length);
  }
}
console.log('整篇直塞待跑 ' + todo.length + '（子集 ' + subset.length + '），模型 ' + MODEL);
await Promise.all(Array.from({ length: CONC }, w));
out.end();
console.log('完成 ' + store.size + ' -> ' + outPath);
