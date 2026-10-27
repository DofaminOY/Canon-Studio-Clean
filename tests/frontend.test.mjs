import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// A lightweight DOM contract test without a real printer or browser.
test('browser module initialization and page-range validation', async () => {
  const elements = new Map();
  const makeElement = (id) => ({
    id, value: ({printer:'Canon TS5350i series',copies:'1',paper:'A4',scale:'fit',duplex:'simplex',pageFilter:'all'}[id] ?? ''),
    style: {}, textContent:'', disabled:false, max:'',
    classList: { add(){},remove(){},toggle(){},contains(){return false;} },
    addEventListener(){}, replaceChildren(){},append(){},setAttribute(){},
  });
  globalThis.document = {
    getElementById(id) {if(!elements.has(id)) elements.set(id,makeElement(id)); return elements.get(id);},
    createElement(tag) {return makeElement(tag);},
    querySelector() { return {value:'all',checked:true}; },
    querySelectorAll() { return []; },
  };
  globalThis.Option = class { constructor(label,value){this.label=label;this.value=value;} };
  globalThis.setInterval=()=>0;
  globalThis.fetch=async (url)=>({
    ok:true,status:200,
    async json(){
      if(url==='/api/config') return {token:'test-token'};
      if(url==='/api/printers') return {printers:['Canon TS5350i series']};
      if(url==='/api/status') return {state:'Готов',model:'Canon TS5350i',jobs:0,accepting:true};
      if(url==='/api/tasks') return {tasks:[],active:null};
      if(url.startsWith('/api/jobs?')) return {jobs:[]};
      return {};
    },
  });
  await import('../public/assets/js/app.js');
  await new Promise(resolve=>setTimeout(resolve,40));
  const { state }=await import('../public/assets/js/state.js');
  const { buildSettings,checkSettings }=await import('../public/assets/js/settings.js');
  assert.equal(state.token,'test-token');
  state.chosenFile={name:'demo.pdf'};
  state.pdfDocument={numPages:3};
  let options=buildSettings();
  assert.equal(options.type,'pdf');
  assert.equal(checkSettings(options),'');
  elements.get('from').value='2';
  elements.get('to').value='13';
  globalThis.document.querySelector=()=>({value:'range',checked:true});
  options=buildSettings();
  assert.match(checkSettings(options),/3 стр/);
});

test('HTML contains no inline app script and responsive media rules exist',async()=>{
  const html=await fs.readFile('public/index.html','utf8');
  const css=await fs.readFile('public/assets/css/main.css','utf8');
  assert.match(html,/<script type="module" src="\/assets\/js\/app.js"><\/script>/);
  assert.doesNotMatch(html,/<script type="module">/);
  assert.match(css,/@media\s*\(max-width:\s*850px\)/);
  assert.match(css,/@media\s*\(max-width:\s*490px\)/);
});
