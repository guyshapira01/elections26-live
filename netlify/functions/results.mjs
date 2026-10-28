import { createHash } from 'node:crypto';
const SOURCE = 'https://media26.bechirot.gov.il/files/expc.csv';
const META = ['סמל ועדה','שם ישוב','סמל ישוב','בזב','מצביעים','פסולים','כשרים'];
// Add ONLY agreements verified from the Central Elections Committee, as ballot-letter pairs.
// Example format: [['מחל','ט']] (EXAMPLE ONLY; not activated).
const VERIFIED_SURPLUS_AGREEMENTS = [];
let cache = null;
let lastCheck = 0;
const number = x => Number(String(x ?? '0').replace(/,/g,'')) || 0;
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows=[]; let row=[],cell='',quote=false;
  for(let i=0;i<text.length;i++) { const c=text[i];
    if(c==='"') {if(quote && text[i+1]==='"'){cell+='"';i++;}else quote=!quote;}
    else if(c===','&&!quote){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row);}
  const header=rows.shift().map(x=>x.trim());
  return {header,rows:rows.map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i]??''])))};
}
function allocate(votes, validTotal, agreements) {
  const threshold=validTotal*0.0325;
  const eligible=Object.entries(votes).filter(([,v])=>v>=threshold&&v>0);
  const included=new Set(eligible.map(([k])=>k));
  const paired=new Set(), groups=[];
  for(const [a,b] of agreements){if(a!==b&&included.has(a)&&included.has(b)&&!paired.has(a)&&!paired.has(b)){
    groups.push({members:[a,b],votes:votes[a]+votes[b],seats:0});paired.add(a);paired.add(b);
  }}
  for(const [k,v] of eligible)if(!paired.has(k))groups.push({members:[k],votes:v,seats:0});
  const seats=Object.fromEntries(Object.keys(votes).map(k=>[k,0]));
  // Bader–Ofer (D'Hondt) quotient for the pooled lists. Exact integer comparison via BigInt.
  for(let n=0;n<120&&groups.length;n++){
    let best=0;
    for(let i=1;i<groups.length;i++){
      const a=groups[i],b=groups[best];
      const lhs=BigInt(a.votes)*BigInt(b.seats+1),rhs=BigInt(b.votes)*BigInt(a.seats+1);
      if(lhs>rhs || (lhs===rhs && a.members.join('|')<b.members.join('|')))best=i;
    }
    groups[best].seats++;
  }
  for(const g of groups){
    if(g.members.length===1){seats[g.members[0]]=g.seats;continue;}
    const [a,b]=g.members;
    for(let i=0;i<g.seats;i++){
      const left=BigInt(votes[a])*BigInt(seats[b]+1);
      const right=BigInt(votes[b])*BigInt(seats[a]+1);
      if(left>right||(left===right&&a<b))seats[a]++;else seats[b]++;
    }
  }
  return {seats,threshold:Math.ceil(threshold),allocated:Object.values(seats).reduce((a,b)=>a+b,0)};
}
async function load() {
  const now=Date.now();if(cache&&now-lastCheck<60000)return cache;
  lastCheck=now;
  try{
    const res=await fetch(SOURCE,{headers:{'User-Agent':'Elections26Dashboard/1.0','Accept':'text/csv,*/*'},signal:AbortSignal.timeout(20000)});
    if(!res.ok)throw new Error(`Source HTTP ${res.status}`);
    const bytes=Buffer.from(await res.arrayBuffer());
    const hash=createHash('sha256').update(bytes).digest('hex');
    if(cache?.sourceHash===hash){cache={...cache,lastChecked:new Date(now).toISOString(),sourceChanged:false,stale:false};return cache;}
    let decoded=new TextDecoder('utf-8',{fatal:false}).decode(bytes);
    if(!decoded.includes('שם ישוב'))decoded=new TextDecoder('windows-1255').decode(bytes);
    const {header,rows}=parseCSV(decoded);
    if(!header.includes('שם ישוב')||!header.includes('כשרים')||rows.length===0)throw new Error('Unexpected CSV format');
    const symbols=header.filter(k=>k&&!META.includes(k));
    const votes=Object.fromEntries(symbols.map(k=>[k,0]));
    const cities=[];const totals={eligible:0,voters:0,invalid:0,valid:0};
    for(const r of rows){const cityVotes={};for(const k of symbols){const v=number(r[k]);votes[k]+=v;cityVotes[k]=v;}
      const city={name:r['שם ישוב'],id:r['סמל ישוב'],eligible:number(r['בזב']),voters:number(r['מצביעים']),invalid:number(r['פסולים']),valid:number(r['כשרים']),votes:cityVotes};
      cities.push(city);totals.eligible+=city.eligible;totals.voters+=city.voters;totals.invalid+=city.invalid;totals.valid+=city.valid;
    }
    const sumVotes=Object.values(votes).reduce((a,b)=>a+b,0);
    if(sumVotes!==totals.valid)throw new Error(`Votes mismatch: ${sumVotes} vs ${totals.valid}`);
    const allocation=allocate(votes,totals.valid,VERIFIED_SURPLUS_AGREEMENTS);
    cache={source:SOURCE,sourceHash:hash,sourceBytes:bytes.length,sourceChanged:true,lastChecked:new Date(now).toISOString(),lastChanged:new Date(now).toISOString(),stale:false,totals,cityCount:cities.length,cities,parties:Object.entries(votes).map(([symbol,votes])=>({symbol,votes,percent:totals.valid?100*votes/totals.valid:0,seats:allocation.seats[symbol]||0,passesThreshold:votes>=allocation.threshold})).sort((a,b)=>b.votes-a.votes),allocation:{...allocation,method:'Bader-Ofer / D’Hondt',agreements:VERIFIED_SURPLUS_AGREEMENTS,agreementsVerified:VERIFIED_SURPLUS_AGREEMENTS.length>0,provisional:true,warning:'Seat projection only. Verify official surplus agreements and completeness of nationwide ballots.'}};
    return cache;
  }catch(err){if(cache)return {...cache,stale:true,error:String(err),lastChecked:new Date(now).toISOString()};throw err;}
}
export default async () => {
  try {const result=await load();return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=0, s-maxage=60, stale-while-revalidate=30','Access-Control-Allow-Origin':'*'}});}
  catch(err){return new Response(JSON.stringify({error:String(err),stale:true}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8'}});}
};
