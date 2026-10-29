import fs from 'node:fs';
const file = process.argv[2];
const mode = process.argv[3] || null;
const items = JSON.parse(fs.readFileSync('_exp/eval138.json', 'utf8'));
const CN = { 零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9 };
function cn2num(s){ if(/^\d+$/.test(s)) return +s; if(s==='十') return 10; let sec=0,num=0; for(const ch of s){ if(ch==='百') sec=(sec||1)*100; else if(ch==='十') sec=(sec||1)*10; else if(ch==='千') sec=(sec||1)*1000; else if(CN[ch]!==undefined){ num=CN[ch]; sec+=num; num=0; } } return sec+num||null; }
const normName = n => n.replace(/《|》/g,'').replace(/\s+/g,'').replace(/^中华人民共和国/,'').replace(/[（(]\d{4}年?[^)）]*[)）]/g,'').replace(/[（(](修订|修正|试行|暂行|草案)[^)）]*[)）]/g,'').replace(/[（(]\d{4}[)）]/g,'');
function cites(text){ const out=[]; if(!text) return out; const re=/《([^》]{2,60})》\s*((?:第[零〇一二三四五六七八九十百千\d]+条(?:之[一二三四五六七八九])?[、，,和及至~～\-]?)+)?/g; let m; while((m=re.exec(text))){ const name=normName(m[1]); const arts=[]; if(m[2]){ const ar=/第([零〇一二三四五六七八九十百千\d]+)条/g; let a; while((a=ar.exec(m[2]))){ const v=cn2num(a[1]); if(v) arts.push(v); } } out.push({name,arts}); } return out; }
function evaluate(answers){
  let fh=0,ah=0,n=0;
  for(let i=0;i<items.length;i++){
    const std=items[i].std, ans=answers[i];
    if(!ans||!std||std.trim().length<4) continue;
    n++;
    const S=[...new Set(cites(std).map(c=>c.name))], A=cites(ans), An=[...new Set(A.map(c=>c.name))];
    if(S.some(x=>An.some(y=>x===y))){ fh++;
      const sa=new Set(); for(const c of cites(std)) for(const a of c.arts) sa.add(c.name+'#'+a);
      const aa=new Set(); for(const c of A) for(const a of c.arts) aa.add(c.name+'#'+a);
      for(const k of sa) if(aa.has(k)){ ah++; break; }
    }
  }
  return {n,fh,ah,filePct:fh/n*100,artPct:ah/n*100};
}
const store=new Map();
for(const l of fs.readFileSync(file,'utf8').split(/\n/)){ if(!l.trim()) continue; try{ const o=JSON.parse(l); if(mode && o.mode!==mode) continue; store.set(o.i,o.text); }catch{} }
const answers=items.map((_,i)=>store.get(i)||'');
const r=evaluate(answers);
console.log(file+(mode?' ['+mode+']':'')+'  覆盖 '+store.size+'/'+items.length);
console.log('  文件级 '+r.filePct.toFixed(2)+'%   条款级 '+r.artPct.toFixed(2)+'%   (n='+r.n+', 文件命中 '+r.fh+', 条款命中 '+r.ah+')');
