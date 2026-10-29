import fs from 'node:fs';
const items = JSON.parse(fs.readFileSync('_exp/eval138.json', 'utf8'));
const CN = { 零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9 };
function cn2num(s){ if(/^\d+$/.test(s)) return +s; if(s==='十') return 10; let sec=0,num=0; for(const ch of s){ if(ch==='百') sec=(sec||1)*100; else if(ch==='十') sec=(sec||1)*10; else if(ch==='千') sec=(sec||1)*1000; else if(CN[ch]!==undefined){ num=CN[ch]; sec+=num; num=0; } } return sec+num||null; }
const normName = n => n.replace(/《|》/g,'').replace(/\s+/g,'').replace(/^中华人民共和国/,'').replace(/[（(]\d{4}年?[^)）]*[)）]/g,'').replace(/[（(](修订|修正|试行|暂行|草案)[^)）]*[)）]/g,'').replace(/[（(]\d{4}[)）]/g,'');
function cites(text){ const out=[]; if(!text) return out; const re=/《([^》]{2,60})》\s*((?:第[零〇一二三四五六七八九十百千\d]+条(?:之[一二三四五六七八九])?[、，,和及至~～\-]?)+)?/g; let m; while((m=re.exec(text))){ const name=normName(m[1]); const arts=[]; if(m[2]){ const ar=/第([零〇一二三四五六七八九十百千\d]+)条/g; let a; while((a=ar.exec(m[2]))){ const v=cn2num(a[1]); if(v) arts.push(v); } } out.push({name,arts}); } return out; }
function flags(text, std){
  const S=[...new Set(cites(std).map(c=>c.name))], A=cites(text), An=[...new Set(A.map(c=>c.name))];
  const f = S.some(x=>An.some(y=>x===y));
  let a=false;
  if(f){ const sa=new Set(); for(const c of cites(std)) for(const x of c.arts) sa.add(c.name+'#'+x);
    const aa=new Set(); for(const c of A) for(const x of c.arts) aa.add(c.name+'#'+x);
    for(const k of sa) if(aa.has(k)){ a=true; break; } }
  return {f,a};
}
function load(file, mode){
  const m=new Map();
  for(const l of fs.readFileSync(file,'utf8').split(/\n/)){ if(!l.trim()) continue; try{ const o=JSON.parse(l); if(mode && o.mode!==mode) continue; m.set(o.i,o.text);}catch{} }
  return items.map((_,i)=>m.get(i)||'');
}
function mcnemar(a,b){
  let n01=0,n10=0;
  for(let i=0;i<a.length;i++){ if(!a[i]&&b[i]) n10++; if(a[i]&&!b[i]) n01++; }
  const n=n01+n10;
  if(n===0) return {n01,n10,p:1};
  // 精确二项双侧
  let p=0; const logC=(n,k)=>{let s=0;for(let i=1;i<=k;i++) s+=Math.log(n-k+i)-Math.log(i);return s;};
  for(let k=0;k<=n;k++){ const pr=Math.exp(logC(n,k)-n*Math.LN2); if(pr<=Math.exp(logC(n,Math.min(n01,n10))-n*Math.LN2)+1e-12) p+=pr; }
  return {n01,n10,p:Math.min(1,p)};
}
const [f1,m1,f2,m2] = process.argv.slice(2);
const a=load(f1,m1||null), b=load(f2,m2||null);
for(const key of ['f','a']){
  const fa=a.map((t,i)=>t?flags(t,items[i].std)[key]:false);
  const fb=b.map((t,i)=>t?flags(t,items[i].std)[key]:false);
  const r=mcnemar(fa,fb);
  console.log((key==='f'?'文件级':'条款级')+': 前者命中 '+fa.filter(Boolean).length+'，后者 '+fb.filter(Boolean).length+
    '，不一致对 '+r.n10+':'+r.n01+'，P='+r.p.toFixed(3));
}
