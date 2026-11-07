// Check popup persistence and safe rendering with mocked extension APIs.
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
class Control {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.value='';this.textContent='';this.disabled=false;this.classList={toggle(){}};this.events={};}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=items;}
 setAttribute(){}
 addEventListener(name,fn){this.events[name]=fn;}
 querySelectorAll(){return this.children.flatMap(c=>typeof c==='object'?[c,...c.querySelectorAll()]:[]).filter(c=>['button','input'].includes(c.tagName));}
}
(async()=>{
 const ids={};for(const [,id]of fs.readFileSync(require('node:path').join(__dirname, '../popup.html'),'utf8').matchAll(/id="([^"]+)"/g))ids[id]=new Control();
 ids.preview.style={};
 const key='pagePaletteElements:https://example.test';
 const item={id:'a',name:'<img src=x onerror=alert(1)>',enabled:true,path:'/course',colors:{background:'#445566'},locator:[{tag:'section',id:'course',classes:[]}]};
 const data={pagePaletteSites:{'https://example.test':{enabled:true,background:'#282c34',text:'#eeeeee',futureSetting:123},'https://other.test':{enabled:false,background:'#123456'}},[key]:[item],'pagePaletteElements:https://other.test':[{id:'other'}]};
 const originalOther=JSON.stringify(data['pagePaletteElements:https://other.test']);
 const listeners=[];
 const chrome={tabs:{query:async()=>[{id:1,url:'https://example.test/course'}],sendMessage:async()=>({ok:true,statuses:{a:'Found on this page'}})},storage:{onChanged:{addListener:f=>listeners.push(f)},local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(data[k])])),set:async values=>{for(const[k,v]of Object.entries(values))data[k]=structuredClone(v);}}},permissions:{contains:async()=>true},scripting:{getRegisteredContentScripts:async()=>[{id:'test'}]}};
 const context=vm.createContext({document:{getElementById:id=>ids[id],querySelectorAll:()=>[],createElement:t=>new Control(t),createTextNode:t=>t},chrome,URL,btoa:s=>Buffer.from(s).toString('base64'),window:{close(){}}});
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../popup.js'),'utf8'),context);
 await new Promise(r=>setImmediate(r));
 assert.equal(ids['custom-count'].textContent,'1');assert.equal(ids['custom-list'].children[0].children[0].value,item.name);
 await vm.runInContext(`updateElement('a', item => ({...item,name:'Course panel', colors:{text:'#aabbcc'}}))`,context);
 assert.equal(data[key][0].name,'Course panel');assert.equal(data[key][0].colors.text,'#aabbcc');
 await vm.runInContext(`updateElement('a', item => ({...item,enabled:false}))`,context);assert.equal(data[key][0].enabled,false);
 await vm.runInContext(`saveSite({background:'#556677',text:'#eeeeee'}, false)`,context);
 assert.equal(data[key].length,1);assert.equal(data.pagePaletteSites['https://example.test'].futureSetting,123);assert.equal(data.pagePaletteSites['https://other.test'].background,'#123456');
 await vm.runInContext(`updateElement('a', () => null)`,context);assert.equal(data[key].length,0);assert.equal(JSON.stringify(data['pagePaletteElements:https://other.test']),originalOther);
 console.log('PASS popup list rendering, safe name handling, editing, toggling, deletion, other-site preservation, and general-color/settings compatibility');
})().catch(error=>{console.error(error);process.exitCode=1});
