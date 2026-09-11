const SMALL=['cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve','veinte','veintiuno','veintidós','veintitrés','veinticuatro','veinticinco','veintiséis','veintisiete','veintiocho','veintinueve'];
const TENS=['','','','treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
const HUND=['','ciento','doscientos','trescientos','cuatrocientos','quinientos','seiscientos','setecientos','ochocientos','novecientos'];
function b1000(n){ if(n<30){ if(n===1) return 'un'; if(n===21) return 'veintiún'; return SMALL[n]; } if(n<100){ const t=Math.floor(n/10),u=n%10; if(u===0) return TENS[t]; return `${TENS[t]} y ${u===1?'un':SMALL[u]}`; } if(n===100) return 'cien'; const h=Math.floor(n/100),r=n%100; return r===0?HUND[h]:`${HUND[h]} ${b1000(r)}`; }
function b1e6(n){ if(n<1000) return b1000(n); const k=Math.floor(n/1000),r=n%1000; const h=k===1?'mil':`${b1000(k)} mil`; return r===0?h:`${h} ${b1000(r)}`; }
function wint(n){ if(n<1e6) return b1e6(n); const m=Math.floor(n/1e6),r=n%1e6; const h=m===1?'un millón':`${b1e6(m)} millones`; return r===0?h:`${h} ${b1e6(r)}`; }
function counted(c,s,p){ const w=wint(c); return `${w}${(w==='un millón'||w.endsWith(' millones'))?' de ':' '}${c===1?s:p}`; }
function words(total){ const raw=String(total).trim(); const m=/^([+-]?)(\d*)(?:[.,](\d*))?/.exec(raw); if(!m||(!m[2]&&!m[3])) return null;
  const i=Number((m[2]||'0').replace(/^0+(?=\d)/,'')); const f=Number((m[3]||'').slice(0,2).padEnd(2,'0'));
  if(!Number.isSafeInteger(i)||i>=1e12||!Number.isSafeInteger(f)) return null;
  const s=[]; if(m[1]==='-'&&(i>0||f>0)) s.push('menos'); s.push(counted(i,'peso','pesos')); if(f>0) s.push('con',counted(f,'centavo','centavos')); s.push('M/CTE');
  return s.join(' ').toLocaleUpperCase('es-CO'); }
for (const v of [3000,5000,100,1,21,31,101,100,1000,21000,1000000,2000000,1234.56,5355000,10.999,0,0.5,100000000,999999999]) console.log(v, '=>', words(v));
console.log('null:', words(null), words('abc'));
