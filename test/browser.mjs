import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
await mkdir('test-results', { recursive: true });
const wav = Buffer.alloc(44 + 48000 * 4);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<(wav.length-44)/2;i++)wav.writeInt16LE(Math.round(Math.sin(i/48000*440*Math.PI*2)*12000),44+i*2);
await writeFile('test-results/tone.wav',wav);
const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${resolve('test-results/tone.wav')}`] });
const errors = [], results = [];
async function context(forceRelay = false, mobile = false) {
  const c = await browser.newContext({ permissions: ['microphone'], viewport: mobile ? {width:390,height:844} : {width:1440,height:1000}, ...(mobile ? {isMobile:true,hasTouch:true,deviceScaleFactor:1} : {}) });
  await c.addInitScript(({forceRelay}) => {
    const Native = window.RTCPeerConnection;
    window.__testPeers = [];
    window.RTCPeerConnection = class extends Native {
      constructor(config) { super(forceRelay ? {...config,iceTransportPolicy:'relay',iceServers:[]} : config); window.__testPeers.push(this); }
    };
    const Socket = window.WebSocket; window.__testSockets = [];
    window.WebSocket = class extends Socket { constructor(...args) { super(...args); window.__testSockets.push(this); } };
    if(navigator.mediaDevices){const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__testStreams=[];window.__testConstraints=[];
    navigator.mediaDevices.getUserMedia=async constraints=>{window.__testConstraints.push(constraints);const stream=await get(constraints);window.__testStreams.push(stream);return stream};}
    const Audio=window.AudioContext;window.__testContexts=[];window.AudioContext=class extends Audio{constructor(...args){super(...args);window.__testContexts.push(this)}};
    const Worklet=window.AudioWorkletNode;window.__testVoiceNodes=[];
    window.AudioWorkletNode=class extends Worklet{constructor(context,name,options){super(context,name,options);if(name==='voice-processor')window.__testVoiceNodes.push(this);}};
    window.__testProcessedStreams=[];window.__testFilters=[];
    const destination=Audio.prototype.createMediaStreamDestination;
    Audio.prototype.createMediaStreamDestination=function(){const d=destination.call(this);window.__testProcessedStreams.push(d.stream);return d;};
    const filter=Audio.prototype.createBiquadFilter;
    Audio.prototype.createBiquadFilter=function(){const f=filter.call(this);window.__testFilters.push(f);return f;};
  },{forceRelay});
  c.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  return c;
}
async function join(c, code, name) {
  const p=await c.newPage();await p.goto(`${base}/join/${code}`);await p.getByLabel('Your name').fill(name);await p.getByRole('button',{name:'Join class',exact:true}).click();await expect(p.locator('[data-connection=connected]')).toBeVisible();return p;
}
async function hasSound(p) { await expect.poll(()=>p.locator('.speaking .meter>span').evaluate(e=>parseFloat(e.style.width)),{timeout:15000}).toBeGreaterThan(.1); }
async function tracksStopped(p) { await expect.poll(()=>p.evaluate(()=>[...window.__testStreams,...window.__testProcessedStreams].every(s=>s.getTracks().every(t=>t.readyState==='ended')))).toBe(true); }

try {
  const hc=await context(),sc=await context(false,true);
  const h=await hc.newPage();await h.goto(base);
  await expect(h.locator('header, .brand, .eyebrow')).toHaveCount(0);
  await expect(h.locator('html')).toHaveAttribute('lang','en');
  await h.screenshot({path:'test-results/home-desktop.png',fullPage:true});
  await h.getByLabel('Class name').fill('Economics 101');await h.getByRole('button',{name:'Create class',exact:true}).click();
  await expect(h.locator('[data-connection=connected]')).toBeVisible();
  const code=h.url().split('/').at(-1);
  await expect(h.locator('.qr img')).toBeVisible();
  await expect(h.getByRole('slider',{name:'Speaker volume'})).toHaveValue('0.5');
  await h.getByRole('button',{name:'Test speaker',exact:true}).click();
  const s=await join(sc,code,'Alex');
  await s.getByRole('button',{name:'Request to speak',exact:true}).click();
  await expect(s.getByRole('button',{name:'Cancel request',exact:true})).toBeVisible();
  expect(await s.evaluate(()=>[...window.__testStreams,...window.__testProcessedStreams].every(s=>s.getTracks().every(t=>!t.enabled)))).toBe(true);
  await expect(h.locator('.queue')).toContainText('Alex');
  await h.getByRole('button',{name:'Allow',exact:true}).click();
  await expect(s.getByRole('button',{name:'Stop speaking',exact:true})).toBeVisible();
  await expect.poll(()=>h.evaluate(async()=>[...(await window.__testPeers.at(-1).getStats()).values()].filter(r=>r.type==='inbound-rtp').some(r=>r.totalAudioEnergy>0&&r.packetsReceived>30)),{timeout:15000}).toBe(true);
  await hasSound(h);
  const processing = await s.evaluate(() => {
    const filter=window.__testFilters.at(-1), magnitude=new Float32Array(3);
    filter.getFrequencyResponse(new Float32Array([30,300,1000]),magnitude,new Float32Array(3));
    const track=window.__testPeers.at(-1).getSenders().find(s=>s.track?.kind==='audio')?.track;
    return { constraints:window.__testConstraints.at(-1).audio, settings:window.__testStreams.at(-1).getAudioTracks()[0].getSettings(), response:[...magnitude], sendsProcessedAudio:window.__testProcessedStreams.some(s=>s.getTracks().includes(track)) };
  });
  expect(processing.constraints.autoGainControl).toBe(false);expect(processing.settings.autoGainControl).toBe(false);
  expect(processing.settings.echoCancellation).toBe(true);expect(processing.settings.noiseSuppression).toBe(true);
  expect(processing.response[0]).toBeLessThan(.2);expect(processing.response[1]).toBeGreaterThan(.99);expect(processing.response[2]).toBeGreaterThan(.99);
  expect(processing.sendsProcessedAudio).toBe(true);
  results.push({scenario:'Processed microphone: rumble reduction, no automatic gain, browser echo cancellation and noise suppression',pass:true,processing});
  const rtc=await h.evaluate(async()=>{const reports=await window.__testPeers.at(-1).getStats();return [...reports.values()].filter(r=>r.type==='inbound-rtp').map(r=>({bytesReceived:r.bytesReceived,packetsReceived:r.packetsReceived,kind:r.kind}))});
  if(!rtc.some(r=>r.kind==='audio'&&r.bytesReceived>0))throw new Error('No actual WebRTC audio received');
  results.push({scenario:'WebRTC audio',reports:rtc});
  await h.screenshot({path:'test-results/host-desktop.png',fullPage:true});await s.screenshot({path:'test-results/student-mobile.png',fullPage:true});
  const second=await join(sc,code,'Jordan');await second.getByRole('button',{name:'Request to speak',exact:true}).click();
  await h.getByRole('button',{name:'Switch speaker',exact:true}).click();
  await expect(second.getByRole('button',{name:'Stop speaking',exact:true})).toBeVisible();
  await expect(s.getByRole('button',{name:'Request to speak',exact:true})).toBeVisible();
  await tracksStopped(s);
  await hasSound(h);results.push({scenario:'Switch between two students without overlapping audio',pass:true});
  await h.getByRole('button',{name:'Mute',exact:true}).click();
  await tracksStopped(second);
  await expect(s.getByRole('button',{name:'Request to speak',exact:true})).toBeVisible();
  await tracksStopped(s);
  await expect(h.locator('.speaking .meter')).toHaveCount(0);
  results.push({scenario:'Host mute stops tracks and playback',pass:true});
  await s.getByRole('button',{name:'Request to speak',exact:true}).click();
  await expect(s.getByRole('button',{name:'Cancel request',exact:true})).toBeVisible();
  await s.evaluate(()=>window.__testVoiceNodes.at(-1).dispatchEvent(new Event('processorerror')));
  await tracksStopped(s);
  await expect(s.getByRole('button',{name:'Request to speak',exact:true})).toBeVisible();
  await expect(h.locator('.queue').filter({hasText:'Alex'})).toHaveCount(0);
  await expect(s.getByText('Audio processing stopped. Request to speak again.',{exact:true})).toBeVisible();
  results.push({scenario:'Audio-processing failure cancels request and releases all microphone tracks',pass:true});
  await h.getByRole('button',{name:'Pause requests',exact:true}).click();await expect(s.getByRole('button',{name:'Request to speak',exact:true})).toBeDisabled();
  await h.getByRole('button',{name:'Resume requests',exact:true}).click();await expect(s.getByRole('button',{name:'Request to speak',exact:true})).toBeEnabled();
  await h.getByRole('button',{name:'Present QR code',exact:true}).click();await expect(h.getByRole('heading',{name:'Economics 101'})).toBeVisible();await h.keyboard.press('Escape');
  await h.reload();await expect(h.getByRole('heading',{name:'Economics 101',exact:true})).toBeVisible();await expect(h.locator('[data-connection=connected]')).toBeVisible();
  await s.getByRole('button',{name:'Request to speak',exact:true}).click();await h.getByRole('button',{name:'Allow',exact:true}).click();await hasSound(h);
  await s.evaluate(()=>window.__testSockets.find(s=>s.url.endsWith('/ws')&&s.readyState===1).close());
  await expect(h.locator('.speaking')).toContainText('No active microphone');
  await expect(s.locator('[data-connection=connected]')).toBeVisible({timeout:10000});await expect(s.getByRole('button',{name:'Request to speak',exact:true})).toBeVisible();
  results.push({scenario:'Pause, projection, refresh, disconnect/reconnect',pass:true});
  await h.getByRole('button',{name:'End class',exact:true}).click();await h.getByRole('dialog').getByRole('button',{name:'End class',exact:true}).click();await expect(s.getByRole('heading',{name:'Class ended'})).toBeVisible();
  await hc.close();await sc.close();

  const rhc=await context(true),rsc=await context(true,true);const rh=await rhc.newPage();
  const frameDurations=[];rh.on('websocket',ws=>ws.on('framereceived',event=>{if(Buffer.isBuffer(event.payload)){const p=event.payload;frameDurations.push((p.length-8)/2/p.readUInt32LE(4));}}));
  await rh.goto(base);await rh.getByLabel('Class name').fill('Relay test');await rh.getByRole('button',{name:'Create class',exact:true}).click();await expect(rh.locator('[data-connection=connected]')).toBeVisible();
  const rs=await join(rsc,rh.url().split('/').at(-1),'Relay student');
  await rs.getByRole('button',{name:'Request to speak',exact:true}).click();await rh.getByRole('button',{name:'Allow',exact:true}).click();
  await expect(rh.locator('.speaking')).toHaveAttribute('data-audio-mode','relay',{timeout:20000});await hasSound(rh);
  await expect.poll(()=>frameDurations.length).toBeGreaterThan(10);expect(frameDurations.every(d=>Math.abs(d-.02)<.0001)).toBe(true);
  // A measured playback signal proves that the real worklet, websocket relay and PCM decoder work together.
  results.push({scenario:'Automatic WebSocket fallback with actual 20 ms PCM audio',pass:true});
  await rh.setViewportSize({width:390,height:844});await rh.screenshot({path:'test-results/host-mobile.png',fullPage:true});
  for(const page of [rh,rs]){const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw new Error('Horizontal mobile overflow');}
  await rh.getByRole('button',{name:'Mute',exact:true}).click();await tracksStopped(rs);
  await rh.getByRole('button',{name:'End class',exact:true}).click();await rh.getByRole('dialog').getByRole('button',{name:'End class',exact:true}).click();await expect(rs.getByRole('heading',{name:'Class ended'})).toBeVisible();
  await rhc.close();await rsc.close();
  if(errors.length)throw new Error('Browser errors: '+errors.join('\n'));
  console.log(JSON.stringify({pass:true,results,browserErrors:errors},null,2));
  await writeFile('test-results/browser-report.json',JSON.stringify({pass:true,results,browserErrors:errors},null,2));
} catch(e) {
  const diagnostics=[];
  for(const c of browser.contexts())for(const p of c.pages())diagnostics.push(await p.evaluate(async()=>({url:location.pathname,contexts:window.__testContexts?.map(c=>({state:c.state,time:c.currentTime})),streams:window.__testStreams?.map(s=>s.getTracks().map(t=>({state:t.readyState,enabled:t.enabled,muted:t.muted}))),peers:await Promise.all((window.__testPeers||[]).map(async p=>({state:p.connectionState,stats:[...(await p.getStats()).values()].filter(r=>['inbound-rtp','outbound-rtp','media-source'].includes(r.type))})))})).catch(()=>({unavailable:true})));
  await writeFile('test-results/browser-report.json',JSON.stringify({pass:false,error:e.message,results,browserErrors:errors,diagnostics},null,2));
  for(const c of browser.contexts())for(const [i,p] of c.pages().entries())await p.screenshot({path:`test-results/failure-${Date.now()}-${i}.png`,fullPage:true}).catch(()=>{});
  throw e;
} finally {await browser.close();}
