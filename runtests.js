// Runner Node per i test in fondo a index.html (vedi DOCUMENTAZIONE §11).
function mkNode() {
  const n = { innerHTML:'', style:{}, classList:{add:()=>{}, remove:()=>{}}, children:[] };
  n.appendChild=()=>{}; n.insertBefore=()=>{}; n.setAttribute=()=>{};
  n.getAttribute=()=>'0'; n.addEventListener=()=>{}; n.querySelector=()=>null;
  n.querySelectorAll=()=>[]; n.remove=()=>{}; n.append=()=>{};
  return n;
}
global.document = {
  getElementById:()=>mkNode(), createElement:()=>mkNode(),
  createElementNS:()=>mkNode(), createTextNode:()=>mkNode(),
  querySelector:()=>null, querySelectorAll:()=>[], addEventListener:()=>{}
};
global.window={}; global.requestAnimationFrame=(fn)=>setTimeout(fn,16);
global.setTimeout=()=>0; global.setInterval=()=>0; global.clearInterval=()=>{};
global.confirm=()=>true; global.performance={now:()=>Date.now()};

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const script = m[1].replace('window.runTests = runTests;', 'global.runTests = runTests;');
new Function(script)();
const r = global.runTests();
console.log(`${r.passed}/${r.total} passati`);
process.exit(r.failed === 0 ? 0 : 1);
