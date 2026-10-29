import fs from 'node:fs';
import path from 'node:path';

const root = '_parsed/text';
const out = [];
const files = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.txt') && !p.includes('大语言模型与审计结合的范文')) files.push(p);
  }
}
walk(root);
console.log('法规文件数: ' + files.length);

const ART = /第[零〇一二三四五六七八九十百千0-9]{1,8}条/g;
let nArt = 0, nPara = 0;
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const text = raw.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  const rel = f.replace(/\\/g, '/').replace('_parsed/text/', '').replace(/\.txt$/, '');
  const marks = [...text.matchAll(ART)];
  if (marks.length >= 3) {
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].index;
      const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
      const body = text.slice(start, end).trim();
      if (body.length < 20) continue;
      out.push({ id: out.length, file: rel, art: marks[i][0], text: body.slice(0, 1200) });
      nArt++;
    }
  } else {
    const paras = text.split(/\n/).filter(s => s.trim().length > 40);
    let buf = '';
    for (const p of paras) {
      if ((buf + p).length > 900) { if (buf) { out.push({ id: out.length, file: rel, art: '', text: buf.slice(0, 1200) }); nPara++; } buf = p; }
      else buf += (buf ? ' ' : '') + p;
    }
    if (buf) { out.push({ id: out.length, file: rel, art: '', text: buf.slice(0, 1200) }); nPara++; }
  }
}
fs.mkdirSync('_exp', { recursive: true });
fs.writeFileSync('_exp/corpus_chunks.jsonl', out.map(o => JSON.stringify(o)).join('\n'), 'utf8');
const chars = out.reduce((a, o) => a + o.text.length, 0);
console.log('切片总数: ' + out.length + '  (条款级 ' + nArt + ' / 段落级 ' + nPara + ')');
console.log('总字符: ' + (chars / 10000).toFixed(1) + ' 万   平均每条 ' + Math.round(chars / out.length) + ' 字');
console.log('预估 token（中文约 1.6 字/token）: ' + Math.round(chars / 1.6 / 10000) + ' 万 token');
console.log('涉及法规文件: ' + new Set(out.map(o => o.file)).size);
