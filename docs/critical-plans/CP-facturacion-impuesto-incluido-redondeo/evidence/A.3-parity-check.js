// Mirror of invoice-line-math.ts integer kernel (transcribed for value check)
const CAP = 16, PPM = 1e6;
const norm = (r) => { const v = Number(r); if (!isFinite(v) || v <= 0) return 0; const p = v > 1 ? v : v*100; return Math.round(p*100)/100; };
const ppm = (p, t) => { const perMil = ['ica','reteica'].includes(String(t||'').trim().toLowerCase()); return Math.round(p * (perMil ? 1000 : 10000)); };
const quota = (b, p) => (b <= 0 || p <= 0) ? 0 : Math.floor((b*p)/1e6);
function line(grossCents, rates /* [{p, incl, type}] */) {
  const norm1 = rates.map(r => ({...r, pc: norm(r.p), ppm: ppm(norm(r.p), r.type)}));
  const incl = norm1.filter(t => t.incl === true && t.ppm > 0);
  let base = grossCents;
  if (incl.length && grossCents > 0) {
    const div = 1 + incl.reduce((s,t) => s + t.ppm/PPM, 0);
    const f = b => b + incl.reduce((s,t) => s + quota(b,t.ppm), 0);
    base = Math.floor(grossCents/div);
    while (base > 0 && f(base) > grossCents) base--;
    let s = 0; while (s < CAP && f(base+1) <= grossCents) { base++; s++; }
  }
  const qs = norm1.map(t => quota(base, t.ppm));
  let ii=0, aa=0; norm1.forEach((t,i)=>{ if(t.incl===true) ii+=qs[i]; else aa+=qs[i]; });
  return { base, qs, total: base+ii+aa, residual: grossCents-(base+ii) };
}
const c = (n) => (n/100).toFixed(2);
let r;
r = line(300000, [{p:8,incl:true}]); console.log('$3000/8%:', c(r.base), c(r.qs[0]), c(r.total), 'res', r.residual);
r = line(500000, [{p:8,incl:true}]); console.log('$5000/8%:', c(r.base), c(r.qs[0]), c(r.total), 'res', r.residual);
r = line(10000, [{p:19,incl:true}]); console.log('$100/19%:', c(r.base), c(r.qs[0]), c(r.total), 'res', r.residual);
r = line(1700, [{p:8,incl:true}]); console.log('$17/8%:', c(r.base), c(r.qs[0]), c(r.total), 'res', r.residual);
r = line(300000, [{p:19,incl:true},{p:8,incl:true}]); console.log('$3000/19+8%:', c(r.base), c(r.qs[0]), c(r.qs[1]), c(r.total), 'res', r.residual);
r = line(10000000, [{p:8,incl:true},{p:19,incl:false}]); console.log('$100k mixto:', c(r.base), c(r.qs[0]), c(r.qs[1]), c(r.total));
r = line(100000000, [{p:9.66,incl:true,type:'ica'}]); console.log('$1M ica 9.66:', c(r.base), c(r.qs[0]), c(r.total));
r = line(10000, [{p:0.19,incl:true}]); console.log('guard 0.19==19:', c(r.base), c(r.qs[0]), c(r.total));
