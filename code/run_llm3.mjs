import fs from 'node:fs';
const csv = fs.readFileSync('_secrets/bailian.csv', 'utf8');
const cfg = {};
for (const line of csv.split(/\r?\n/)) { const i = line.indexOf(','); if (i > 0) cfg[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
const H = { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' };
const MODEL = process.env.LLM_MODEL || 'qwen3.8-max';
const CONC = Number(process.env.CONC || 12);
const items = JSON.parse(fs.readFileSync('_exp/eval138.json', 'utf8'));

async function call(prompt, maxTok) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(cfg.openAiCompatible + '/chat/completions', { method: 'POST', headers: H,
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0, enable_thinking: false, max_tokens: maxTok || 800 }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return { text: j.choices[0].message.content, usage: j.usage };
    } catch (e) { if (a === 2) return { text: 'ERROR: ' + e.message, usage: null }; await new Promise(res => setTimeout(res, 1500 * (a + 1))); }
  }
}
const outPath = '_exp/llm3_' + MODEL.replace(/[^a-z0-9.]/gi, '_') + '.jsonl';
const store = new Map();
if (fs.existsSync(outPath)) for (const l of fs.readFileSync(outPath, 'utf8').split(/\n/)) { if (!l.trim()) continue; try { const o = JSON.parse(l); store.set(o.i + '|' + o.mode, o); } catch {} }
const out = fs.createWriteStream(outPath, { flags: 'a' });
function save(i, mode, r) { const o = { i, mode, text: r.text, usage: r.usage }; store.set(i + '|' + mode, o); out.write(JSON.stringify(o) + '\n'); }

// ---------- 阶段一：零样本 ----------
console.log('阶段一：零样本问答');
let cur = 0; const todo1 = items.map((_, i) => i).filter(i => !store.has(i + '|zeroshot'));
async function w1() { while (cur < todo1.length) { const i = todo1[cur++]; const r = await call(['你是一名内部审计专家。请针对下面的审计问题，列出最多3部可能适用的法规及其具体条款编号，按相关性从高到低排列。', '', '【审计问题】' + items[i].q, '【问题描述】' + (items[i].desc || '（无）').slice(0, 1200), '', '输出要求：每行一条，格式为"《法规名称》第X条"，不要解释，不要编造。'].join('\n'), 400); save(i, 'zeroshot', r); } }
await Promise.all(Array.from({ length: CONC }, w1));
console.log('  零样本完成 ' + store.size);

// ---------- 阶段二：按候选法规名检索精确条文 ----------
const chunks = fs.readFileSync('_exp/corpus_chunks_named.jsonl', 'utf8').split(/\n/).filter(Boolean).map(s => JSON.parse(s));
const CONTAMINATED = /审计问题定性法规向导|应知应会法律法规清单/;
const names = new Map(); // 规范化法规名 -> 切片数组
const norm = s => s.replace(/[\s《》（）()【】]/g, '').replace(/^中华人民共和国/, '').replace(/[（(](修订|修正|试行|暂行)[^)）]*[)）]/g, '');
for (const c of chunks) {
  if (CONTAMINATED.test(c.file)) continue;
  const k = norm(c.name);
  if (!names.has(k)) names.set(k, []);
  names.get(k).push(c);
}
function retrievalFor(i) {
  const zs = store.get(i + '|zeroshot');
  const cands = [...new Set(((zs && zs.text) || '').match(/《[^》]{2,60}》/g) || [])].map(x => norm(x.replace(/[《》]/g, '')));
  const picked = [];
  for (const cand of cands) {
    for (const [k, arr] of names) {
      if (k === cand || (cand.length >= 5 && (k.includes(cand) || cand.includes(k)))) { picked.push(...arr.slice(0, 2)); }
      if (picked.length >= 6) break;
    }
    if (picked.length >= 6) break;
  }
  return picked.slice(0, 6);
}
const ctxs3 = items.map((_, i) => retrievalFor(i));
console.log('  两阶段检索命中候选法规的题目数: ' + ctxs3.filter(c => c.length).length + ' / ' + items.length);

// ---------- 阶段三：条文约束生成 ----------
console.log('阶段三：RAG 生成');
const DOMAIN = { G1: '预算执行审计', G2: '经济责任审计', T1: '财务收支审计', T2: '资产管理审计' };
let cur2 = 0; const todo2 = items.map((_, i) => i).filter(i => !store.has(i + '|rag'));
async function w2() {
  while (cur2 < todo2.length) {
    const i = todo2[cur2++];
    const ctx = ctxs3[i];
    const refs = ctx.length ? ctx.map((c, j) => (j + 1) + '.《' + c.name + '》' + c.text).join('\n') : '（未检索到相关条文）';
    const p = ['【角色】你是一名内部审计专家，负责依据给定的法规条文对审计问题作出专业判断。',
      '【背景】被审计单位为广西某高校，适用国家法律、自治区规定与校内制度。',
      '【领域】' + (DOMAIN[items[i].ds] || '内部审计'),
      '【待查事项】' + items[i].q,
      '【问题描述】' + (items[i].desc || '（无）').slice(0, 1200),
      '【引用约束】优先引用【参考条文】中的法规与条款；若参考条文不足，可补充引用你确知的现行有效法规，但不得编造条款编号。',
      '', '【参考条文】', refs, '',
      '【执行步骤】①任务确认；②法规定位；③条款查找；④完整性核对；⑤结论。',
      '', '【输出格式】最后一行按"《法规名称》第X条"给出最终采用的法规依据。'].join('\n');
    const r = await call(p, 700); save(i, 'rag', r);
  }
}
await Promise.all(Array.from({ length: CONC }, w2));
out.end();
console.log('全部完成: ' + store.size + ' 条');
