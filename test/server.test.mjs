import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApp } from '../server/index.mjs';

const origin = 'http://classroom.test';
async function setup(t, env = {}) {
  const app = createApp({env:{PUBLIC_URL:origin,HOST_PASSWORD:'',...env}});
  await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const post=async(path,data,headers={})=>{ const r=await fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});return {status:r.status,...await r.json()}; };
  const create=()=>post('/api/rooms',{title:'Economics'});
  const join=(code,name)=>post(`/api/rooms/${code}/join`,{name});
  async function connect(session) {
    const ws=new WebSocket(base.replace('http:','ws:')+'/ws',{origin});
    const messages=[];
    ws.on('error',()=>{});
    ws.on('message',(raw,binary)=>messages.push(binary ? {type:'binary',raw} : JSON.parse(raw)));
    const wait=(predicate,timeout=2000)=>new Promise((resolve,reject)=>{
      const started=Date.now();
      const check=()=>{const i=messages.findIndex(predicate);if(i>=0){const msg=messages.splice(i,1)[0];clearInterval(timer);resolve(msg)}else if(Date.now()-started>timeout){clearInterval(timer);reject(new Error('Expected message missing: '+messages.map(m=>m.type).join(',')))}};
      const timer=setInterval(check,5);check();
    });
    await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
    ws.send(JSON.stringify({type:'auth',...session}));
    return {ws,messages,send:m=>ws.send(JSON.stringify(m)),wait,clear:()=>{messages.length=0}};
  }
  const ready=async s=>{const c=await connect(s);await c.wait(m=>m.type==='ready');await c.wait(m=>m.type==='state');return c};
  return {app,base,post,create,join,connect,ready};
}
const stateWhere = fn => m => m.type === 'state' && fn(m);
const delay=ms=>new Promise(r=>setTimeout(r,ms));

test('HTTP validates origins, password, room and student name; no privileges in student response',async t=>{
  const f=await setup(t,{HOST_PASSWORD:'secret'});
  assert.equal((await f.post('/api/rooms',{}, {Origin:'https://evil.test'})).status,403);
  assert.equal((await f.create()).status,403);
  assert.equal((await f.post('/api/rooms',{password:'\u754c\u754c\u754c\u754c\u754c\u754c'})).status,403);
  const host=await f.post('/api/rooms',{password:'secret',title:'  Class  '});
  assert.equal(host.status,201);assert.match(host.code,/^\d{6}$/);
  assert.equal((await f.join(host.code,'  ')).status,400);
  assert.equal((await f.join('000000','Student')).status,404);
  const student=await f.join(host.code,'Alex');
  assert.notEqual(student.token,host.token);assert.equal(student.hostToken,undefined);
  const invalid=await f.connect({...student,role:'host'});
  assert.match((await invalid.wait(m=>m.type==='error')).message,/Session expired/);
});

test('single speaker, private signaling, relay frame gating and immediate revoke',async t=>{
  const f=await setup(t);const hs=await f.create(),as=await f.join(hs.code,'Alex'),bs=await f.join(hs.code,'Jordan');
  const h=await f.ready(hs),a=await f.ready(as),b=await f.ready(bs);
  a.send({type:'request'});b.send({type:'request'});
  const queued=await h.wait(stateWhere(s=>s.queue.length===2));assert.deepEqual(queued.queue,[as.id,bs.id]);
  b.send({type:'approve',id:bs.id});await delay(30);assert.equal(f.app.rooms.get(hs.code).activeId,null);
  h.send({type:'approve',id:as.id});
  const granted=await h.wait(stateWhere(s=>s.activeId===as.id));assert.ok(granted.grant);
  const studentState=await a.wait(stateWhere(s=>s.activeId===as.id));assert.equal(studentState.students,undefined);assert.equal(studentState.queue,undefined);
  a.send({type:'rtc',grant:granted.grant,description:{type:'offer',sdp:'test'}});
  assert.equal((await h.wait(m=>m.type==='rtc')).description.sdp,'test');
  h.clear();b.send({type:'rtc',grant:granted.grant,description:{type:'offer',sdp:'intruder'}});await delay(30);assert.equal(h.messages.some(m=>m.type==='rtc'),false);
  a.send({type:'relay',grant:granted.grant});await h.wait(stateWhere(s=>s.mode==='relay'));
  const pcm=Buffer.alloc(1928);pcm.writeUInt32LE(granted.grant);pcm.writeUInt32LE(24000,4);pcm.writeInt16LE(1234,8);
  a.ws.send(pcm);assert.equal((await h.wait(m=>m.type==='binary')).raw.readInt16LE(8),1234);
  b.ws.send(pcm);await delay(30);assert.equal(h.messages.some(m=>m.type==='binary'),false);
  b.send({type:'finish'});await delay(30);assert.equal(f.app.rooms.get(hs.code).activeId,as.id);
  h.send({type:'approve',id:bs.id});const second=await h.wait(stateWhere(s=>s.activeId===bs.id));assert.notEqual(second.grant,granted.grant);
  h.clear();a.ws.send(pcm);await delay(30);assert.equal(h.messages.some(m=>m.type==='binary'),false);
  h.send({type:'mute'});await h.wait(stateWhere(s=>s.activeId===null));assert.equal(f.app.rooms.get(hs.code).grant,0);
  h.send({type:'pause',paused:true});await a.wait(stateWhere(s=>s.paused));a.send({type:'request'});assert.match((await a.wait(m=>m.type==='error')).message,/Requests/);
  h.send({type:'end'});await a.wait(m=>m.type==='ended');await b.wait(m=>m.type==='ended');assert.equal(f.app.rooms.has(hs.code),false);
});

test('host disconnect revokes microphone and reconnection preserves control, not open audio',async t=>{
  const f=await setup(t),hs=await f.create(),ss=await f.join(hs.code,'Student');
  const h=await f.ready(hs),s=await f.ready(ss);
  s.send({type:'request'});await h.wait(stateWhere(x=>x.queue.length===1));h.send({type:'approve',id:ss.id});await s.wait(stateWhere(x=>x.activeId===ss.id));
  h.ws.close();const offline=await s.wait(stateWhere(x=>!x.hostOnline));assert.equal(offline.activeId,null);
  const h2=await f.ready(hs);const online=await s.wait(stateWhere(x=>x.hostOnline && !x.activeId));assert.equal(online.grant,0);
  const h3=await f.ready(hs);await delay(30);assert.equal(f.app.rooms.get(hs.code).host.readyState,1);
  assert.notEqual(h2.ws.readyState,1);h3.send({type:'end'});await s.wait(m=>m.type==='ended');
});

test('student disconnect removes queue; malformed tokens/messages do not crash server',async t=>{
  const f=await setup(t),hs=await f.create(),ss=await f.join(hs.code,'Student');
  const h=await f.ready(hs),s=await f.ready(ss);
  s.send({type:'request'});await h.wait(stateWhere(x=>x.queue.length===1));
  s.ws.close();await h.wait(stateWhere(x=>x.queue.length===0 && x.online===0));
  const bad=await f.connect({...hs,token:'\u754c'.repeat(hs.token.length)});await bad.wait(m=>m.type==='error');
  h.ws.send('null');h.ws.send('{');assert.match((await h.wait(m=>m.type==='error')).message,/format/);
  assert.equal((await fetch(f.base+'/health')).status,200);
});
