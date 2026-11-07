// Exercise controller behavior with a deterministic DOM and Chrome API harness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
class Element {
  constructor(tag='div', id='') { this.localName=tag; this.tagName=tag.toUpperCase(); this.id=id; this.classList=[]; this.classList.add=()=>{}; this.children=[]; this.isConnected=true; this.style={}; this.events={}; this.attrs={}; this.textContent=''; this.hidden=false; this.value=''; }
  append(...elements) { for(const e of elements) { if(e instanceof Element) { e.parentElement=this; e.isConnected=true; this.children.push(e); } } }
  appendChild(e) { this.append(e); }
  setAttribute(k,v) { this.attrs[k]=v; }
  remove() { this.isConnected=false; if(this.parentElement) this.parentElement.children=this.parentElement.children.filter(e=>e!==this); }
  attachShadow() { this.shadow = new Element('shadow'); return this.shadow; }
  getBoundingClientRect() { return {left:0,top:0,width:500,height:300}; }
  focus() {}
  scrollIntoView() {}
  addEventListener(k,fn) { (this.events[k] ||= []).push(fn); }
  async fire(k,event={}) { for(const fn of this.events[k]||[]) await fn(event); }
  set innerHTML(v) { this.map={}; for(const cls of ['instructions','editor','target','larger','smaller','repick','colors','feedback','save','cancel']) this.map['.'+cls]=new Element(['larger','smaller','repick','save','cancel'].includes(cls)?'button':'div'); this.map['#element-name']=new Element('input'); }
  querySelector(q) { return this.map[q]; }
  querySelectorAll() { return [...Object.values(this.map||{}),...this.children.flatMap(e=>e.children)].filter(e=>['BUTTON','INPUT'].includes(e.tagName)); }
}
async function setup(seed) {
 const html=new Element('html'), head=new Element('head'), body=new Element('body'); html.append(head,body);
 const container=new Element('section','course'), para=new Element('p','intro'); body.append(container); container.append(para);
 const bySelector={'html':[html], 'body':[body], 'section#course':[container], 'p#intro':[para]};
 const listeners=new Set(), messages=new Set(), windowEvents={};
 const data=structuredClone(seed||{pagePaletteSites:{'https://example.test':{enabled:true,background:'#282c34',text:'#eeeeee'}}});
 const document={documentElement:html,head,body,activeElement:body,createElement:t=>new Element(t),createTextNode:t=>t,addEventListener(){},querySelectorAll:s=>bySelector[s]||[]};
 const chrome={runtime:{id:'extension-test',onMessage:{addListener:f=>messages.add(f),removeListener:f=>messages.delete(f)}},storage:{onChanged:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},local:{get:async keys=>{const out={}; for(const k of Array.isArray(keys)?keys:[keys])out[k]=structuredClone(data[k]);return out;},set:async values=>{const changes={};for(const [k,v]of Object.entries(values)){changes[k]={oldValue:data[k],newValue:structuredClone(v)};data[k]=structuredClone(v);}for(const f of [...listeners])f(changes,'local');}}}};
 const window={location:{origin:'https://example.test',pathname:'/course'},addEventListener:(k,f)=>(windowEvents[k]||=new Set()).add(f),removeEventListener:(k,f)=>windowEvents[k]?.delete(f)};
 const context=vm.createContext({window,document,location:window.location,chrome,HTMLElement:Element,CSS:{escape:s=>s},MutationObserver:class{observe(){} disconnect(){}},setTimeout,clearTimeout,crypto:{randomUUID:()=> 'entry-1'},getComputedStyle:()=>({getPropertyValue:()=> 'rgb(0, 0, 0)'})});
 vm.runInContext(source,context); await tick();
 async function command(type,id) { return new Promise(resolve=>{[...messages][0]({type,id},{id:'extension-test'},resolve);}); }
 async function click(target) {const event={target,type:'click',composedPath:()=>[target],preventDefault(){this.prevented=true},stopImmediatePropagation(){}};for(const f of windowEvents.click||[]) f(event);return event;}
 function panel(){return html.children.find(e=>e.shadow)?.shadow.children.find(e=>e.className==='panel');}
 function styleText(){return [...head.children,...html.children].filter(e=>e.localName==='style'&&e.isConnected).map(e=>e.textContent).join('\n');}
 return {context,command,click,panel,styleText,chrome,data,html,head,body,para,container,bySelector,listeners,messages,windowEvents};
}
(async()=>{
 const key='pagePaletteElements:https://example.test';
 const t=await setup();
 assert.match(t.styleText(),/#282c34/);
 assert.equal((await t.command('palette:pick')).ok,true);
 const ev=await t.click(t.para); assert.equal(ev.prevented,true);
 let panel=t.panel(); assert.equal(panel.querySelector('.target').textContent,'p #intro');
 await panel.querySelector('.larger').fire('click'); assert.equal(panel.querySelector('.target').textContent,'section #course');
 await panel.querySelector('.smaller').fire('click'); assert.equal(panel.querySelector('.target').textContent,'p #intro');
 await panel.querySelector('.larger').fire('click');
 let [check,,color]=panel.querySelector('.colors').children[0].children;
 // Text nodes are excluded from this lightweight harness's children collection.
 [check,color]=panel.querySelector('.colors').children[0].children;
 check.checked=true; await check.fire('change'); color.value='#556677';await color.fire('input');
 assert.match(t.styleText(),/background-color: #556677/);
 await panel.querySelector('.cancel').fire('click'); assert.doesNotMatch(t.styleText(),/#556677/);assert.equal(t.panel(),undefined);assert.equal(t.windowEvents.click.size,0);
 console.log('PASS selection, parent/back navigation, live preview, cancel cleanup and click interception');
 await t.command('palette:pick');await t.click(t.container);panel=t.panel();[check,color]=panel.querySelector('.colors').children[0].children;check.checked=true;color.value='#445566';await check.fire('change');panel.querySelector('#element-name').value='Course panel';await panel.querySelector('.save').fire('click');
 assert.equal(t.data[key][0].name,'Course panel');assert.match(t.styleText(),/#445566/);assert.equal(t.panel(),undefined);
 const saved=structuredClone(t.data[key]);
 await t.chrome.storage.local.set({[key]:[{...saved[0],enabled:false}]});assert.doesNotMatch(t.styleText(),/#445566/);
 await t.chrome.storage.local.set({[key]:saved});assert.match(t.styleText(),/#445566/);
 assert.equal((await t.command('palette:show','entry-1')).ok,true);
 console.log('PASS save, toggle off/on and show command');
 const reloaded=await setup(t.data);assert.match(reloaded.styleText(),/#445566/);
 reloaded.context.location.pathname='/other';await reloaded.command('palette:status');assert.doesNotMatch(reloaded.styleText(),/#445566/);
 reloaded.context.location.pathname='/course';reloaded.bySelector['section#course']=[];
 assert.equal((await reloaded.command('palette:status')).statuses['entry-1'],'Element not found');assert.doesNotMatch(reloaded.styleText(),/#445566/);
 reloaded.bySelector['section#course']=[reloaded.container,new Element('section','course')];assert.equal((await reloaded.command('palette:status')).statuses['entry-1'],'Target is ambiguous');
 console.log('PASS reload persistence, page scoping, missing and ambiguous targets');
 await t.chrome.storage.local.set({[key]:[]});assert.doesNotMatch(t.styleText(),/#445566/);
 await t.chrome.storage.local.set({[key]:saved});await t.command('palette:pick');await t.click(t.para);
 await t.chrome.storage.local.set({pagePaletteSites:{'https://example.test':{enabled:false}}});
 assert.equal(t.styleText(),'');assert.equal(t.panel(),undefined);assert.equal(t.listeners.size,0);assert.equal(t.messages.size,0);assert.equal(t.windowEvents.click.size,0);assert.equal(t.data[key].length,1);
 console.log('PASS delete and full site-disable cleanup with saved records retained');
 const other=await setup({pagePaletteSites:{'https://example.test':{enabled:true}},'pagePaletteElements:https://other.test':saved});assert.doesNotMatch(other.styleText(),/#445566/);
 const unsafe={...saved[0],colors:{background:'#fff; color:red'},locator:[{tag:'div}body{',classes:[]}]};
 await other.chrome.storage.local.set({[key]:[unsafe]});assert.doesNotMatch(other.styleText(),/color:red/);assert.equal((await other.command('palette:status')).statuses['entry-1'],'Invalid target');
 console.log('PASS origin isolation and rejection of invalid CSS/locators');
 // Stop remaining controllers so test timers cannot keep the process alive.
 for(const item of [reloaded,other]) await item.chrome.storage.local.set({pagePaletteSites:{}});
 console.log('All controller harness checks passed (not a real browser rendering test).');
})().catch(error=>{console.error(error);process.exitCode=1});
