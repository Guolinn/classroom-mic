import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, MicOff, Volume2, Maximize2, X, Copy, Check, Hand, Pause, Play, LogOut } from 'lucide-react';
import QRCode from 'qrcode';
import { ClassroomAudio } from './audio';
import { Footer, LegalPage, PolicyLink } from './legal';
import './styles.css';

const readSession = (role, code) => { try { return JSON.parse(sessionStorage.getItem(`mic:${role}:${code}`)); } catch { return null; } };
function remember(session) { sessionStorage.setItem(`mic:${session.role}:${session.code}`, JSON.stringify(session)); }
async function api(path, data) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  let body; try { body = await response.json(); } catch { throw new Error('Cannot reach the server. Try again.'); }
  if (!response.ok) throw new Error(body.error || 'Something went wrong. Try again.');
  return body;
}
function useLocation() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => { const update = () => setPath(location.pathname); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []);
  const go = path => { history.pushState({}, '', path); setPath(path); };
  return [path, go];
}
function Notice({ children, error = false }) {
  return children ? <p className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{children}</p> : null;
}
function Home({ go, joinCode = '' }) {
  const [role, setRole] = useState(joinCode ? 'student' : 'host');
  const [title, setTitle] = useState(''), [code, setCode] = useState(joinCode), [name, setName] = useState('');
  const [password, setPassword] = useState(''), [requiresPassword, setRequiresPassword] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { fetch('/api/config').then(r => r.json()).then(c => setRequiresPassword(c.hostPasswordRequired)).catch(() => setError('Cannot reach the server. Refresh to retry.')); }, []);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (role === 'student' && !/^\d{6}$/.test(code)) throw new Error('Enter a six-digit class code.');
      const session = await api(role === 'host' ? '/api/rooms' : `/api/rooms/${code}/join`, role === 'host' ? { title, password } : { name });
      remember(session); go(`/${role === 'host' ? 'host' : 'join'}/${session.code}`);
      window.dispatchEvent(new Event('session-change'));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <main className="home">
    <a className="home-brand" href="/" aria-label="MicTurn home">
      <svg viewBox="92 330 1352 310" width="124" height="29" aria-hidden="true" focusable="false">
        <image href="/brand/micturn-wordmark.png" width="1536" height="1024" />
      </svg>
    </a>
    <div className="tabs" aria-label="Role">
      <button aria-pressed={role === 'host'} onClick={() => { setRole('host'); setError(''); }}>Teacher</button>
      <button aria-pressed={role === 'student'} onClick={() => { setRole('student'); setError(''); }}>Student</button>
    </div>
    <h1>{role === 'host' ? 'Create a class' : 'Join a class'}</h1>
    <form onSubmit={submit}>
      {role === 'host' ? <>
        <label htmlFor="title">Class name <span>(optional)</span></label>
        <input id="title" maxLength={60} value={title} onChange={e => setTitle(e.target.value)} />
        {requiresPassword && <><label htmlFor="password">Teacher password</label><input id="password" required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></>}
      </> : <>
        <label htmlFor="code">Class code</label><input id="code" value={code} inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
        <label htmlFor="name">Your name</label><input id="name" autoComplete="given-name" value={name} maxLength={24} required onChange={e => setName(e.target.value)} />
      </>}
      <button className="primary full" disabled={busy}>{busy ? 'Please wait…' : role === 'host' ? 'Create class' : 'Join class'}</button>
      <p className="entry-notice">By continuing, you agree to the <PolicyLink type="terms">Terms of Service</PolicyLink>. Read our <PolicyLink type="privacy">Privacy Policy</PolicyLink>.</p>
      <Notice error>{error}</Notice>
    </form>
  </main>;
}
function useClassroom(session) {
  const [state, setState] = useState(null), [connection, setConnection] = useState('connecting');
  const [error, setError] = useState(''), [ended, setEnded] = useState('');
  const [audio, setAudio] = useState({ status: '', level: 0, outputReady: false });
  const socket = useRef(null), engine = useRef(null);
  const send = data => { const ws = socket.current; if (ws?.readyState !== 1) { setError('Connection lost. Reconnecting…'); return false; } ws.send(JSON.stringify(data)); return true; };
  useEffect(() => {
    let disposed = false, timer, attempts = 0, terminal = false;
    const sound = new ClassroomAudio(session.role, data => send(data), data => { const ws = socket.current; if (ws?.readyState === 1 && ws.bufferedAmount < 65536) ws.send(data); }, data => { if (!disposed) setAudio(a=>({...a,...data})); });
    engine.current = sound;
    function connect() {
      if (disposed || terminal) return;
      setConnection(attempts ? 'reconnecting' : 'connecting');
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`); socket.current = ws; ws.binaryType = 'arraybuffer';
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', ...session }));
      ws.onmessage = e => {
        if (disposed || socket.current !== ws) return;
        if (e.data instanceof ArrayBuffer) return sound.receivePcm(e.data);
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'ready') { attempts = 0; sound.iceServers = msg.iceServers; setConnection('connected'); setError(''); }
        if (msg.type === 'state') { sound.sync(msg, session.id); setState(msg); }
        if (msg.type === 'rtc') sound.receiveRtc(msg);
        if (msg.type === 'error' || msg.type === 'notice') { setError(msg.message); if (session.role === 'student' && !sound.grant) sound.releaseMic(); }
        if (msg.type === 'ended') { terminal = true; sound.stopAll(); setEnded(msg.reason); sessionStorage.removeItem(`mic:${session.role}:${session.code}`); }
      };
      ws.onclose = e => {
        if (disposed || socket.current !== ws) return;
        sound.stopAll();
        if ([4001,4002,4004].includes(e.code)) { terminal = true; setEnded(e.code === 4002 ? 'This session is open in another tab.' : 'Class unavailable. Join again.'); }
        if (terminal) { setConnection('closed'); return; }
        setConnection('reconnecting'); setState(s => s ? { ...s, activeId: null, grant: 0 } : null);
        timer = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 10000));
      };
      ws.onerror = () => {};
    }
    connect();
    const visibility = () => { if (document.visibilityState === 'visible') sound.ctx?.resume().catch(()=>{}); };
    document.addEventListener('visibilitychange', visibility);
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); socket.current?.close(); sound.destroy(); };
  }, [session.code, session.token]);
  return { state, connection, error, ended, audio, send, engine, setError };
}
function Meter({ level }) {
  return <div className="meter" aria-label="Audio level"><span style={{ width: `${Math.max(0, Math.min(100, level * 100))}%` }} /></div>;
}
function Connection({ value }) {
  return value === 'reconnecting' ? <Notice error>Connection lost. Reconnecting…</Notice> : null;
}
function QR({ code, large = false }) {
  const [src, setSrc] = useState(''), [copied, setCopied] = useState(false), [error, setError] = useState('');
  const url = `${location.origin}/join/${code}`;
  useEffect(() => { QRCode.toDataURL(url, { width: 600, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#17191fff', light: '#ffffffff' } }).then(setSrc).catch(() => setError('QR code unavailable. Use the class code instead.')); }, [url]);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setError(`Copy this link: ${url}`); }
  }
  return <div className={`qr ${large ? 'qr-large' : ''}`}>
    {src ? <img src={src} alt={`Join class ${code}`} width="240" height="240" /> : <div className="qr-placeholder">Loading QR code…</div>}
    <strong className="class-code" aria-label={`Class code ${code}`}>{code.slice(0, 3)} {code.slice(3)}</strong>
    <button className="text-button" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy link'}</button>
    <Notice error>{error}</Notice>
  </div>;
}
function Host({ room, go }) {
  const { state, connection, error, ended, audio, send, engine, setError } = room;
  const [projection, setProjection] = useState(false), [volume, setVolume] = useState(.5), [confirmEnd, setConfirmEnd] = useState(false);
  const dialog = useRef(null);
  useEffect(() => { if (confirmEnd) dialog.current?.showModal(); else dialog.current?.close(); }, [confirmEnd]);
  useEffect(() => { const onKey = e => { if (e.key === 'Escape') setProjection(false); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);
  const connected = connection === 'connected';
  async function testAudio() { try { await engine.current.unlock(true); setError(''); } catch (e) { setError(e.message); } }
  async function approve(id) { try { await engine.current.unlock(); if (send({ type: 'approve', id })) setError(''); } catch (e) { setError(e.message); } }
  const mute = () => { engine.current.stopAll(); send({ type: 'mute' }); };
  if (ended) return <End reason={ended} go={go} />;
  if (!state) return <Loading go={go} />;
  const queue = state.queue.map(id => state.students.find(s => s.id === id)).filter(Boolean);
  return <>
    {projection ? <main className="projection">
      <button className="text-button projection-close" onClick={() => setProjection(false)}><X size={18} />Close</button>
      <h1>{state.title}</h1><QR code={state.code} large />
    </main> : <main className="host" data-connection={connection}>
      <div className="page-heading"><h1>{state.title}</h1><button className="text-button danger" onClick={() => setConfirmEnd(true)}>End class</button></div>
      <Connection value={connection} />
      <div className="host-layout"><section className="controls">
        <div className="sound-settings">
          <button className="text-button" onClick={testAudio}><Volume2 size={19} />Test speaker</button>
          <label className="volume"><span>Volume</span><input aria-label="Speaker volume" type="range" min="0" max="1" step=".01" value={volume} onChange={e => { const v = Number(e.target.value); setVolume(v); engine.current.setVolume(v); }} /><span>{Math.round(volume * 100)}%</span></label>
        </div>
        <div className={`speaking ${state.activeId ? 'is-live' : ''}`} data-audio-mode={state.mode}>
          <h2>{state.activeId ? state.activeName : state.paused ? 'Requests paused' : 'No active microphone'}</h2>
          {state.activeId && <><Meter level={audio.level} /><button className="danger-button" onClick={mute}><MicOff size={18} />Mute</button></>}
          {state.activeId && <Notice>{audio.status}</Notice>}
        </div>
        <div className="section-heading"><h2>Requests <span>{queue.length}</span></h2>
          <button className="text-button" disabled={!connected} onClick={() => { if (!state.paused) engine.current.stopAll(); send({ type: 'pause', paused: !state.paused }); }}>{state.paused ? <Play size={16} /> : <Pause size={16} />}{state.paused ? 'Resume requests' : 'Pause requests'}</button>
        </div>
        {queue.length ? <ol className="queue">{queue.map((s, i) => <li key={s.id}>
          <span className="queue-number">{i + 1}</span><span className="student-name">{s.name}</span>
          <button className="text-button" onClick={() => send({ type: 'reject', id: s.id })} aria-label={`Dismiss ${s.name}`} disabled={!connected}>Dismiss</button>
          <button className="small-primary" onClick={() => approve(s.id)} disabled={!connected || state.paused}>{state.activeId ? 'Switch speaker' : 'Allow'}</button>
        </li>)}</ol> : <p className="empty">No requests</p>}
        <Notice error>{error}</Notice>
        <details className="participants"><summary>Participants ({state.students.length})</summary><ul>{state.students.map(s => <li key={s.id}><span>{s.name}</span><span className="muted">{!s.online ? 'Offline' : state.activeId === s.id ? 'Speaking' : s.requestedAt ? 'Waiting' : ''}</span></li>)}</ul></details>
      </section><aside className="join-panel">
        <div className="section-heading"><h2>Join this class</h2><button className="icon-button" aria-label="Enlarge QR code" onClick={() => setProjection(true)}><Maximize2 size={18} /></button></div>
        <QR code={state.code} /><button className="outline full" onClick={() => setProjection(true)}><Maximize2 size={17} />Present QR code</button>
      </aside></div>
    </main>}
    <dialog ref={dialog} onCancel={() => setConfirmEnd(false)}><h2>End this class?</h2><p>This disconnects everyone and expires the class code.</p><div className="dialog-actions"><button className="outline" onClick={() => setConfirmEnd(false)}>Cancel</button><button className="danger-button" disabled={!connected} onClick={() => { engine.current.stopAll(); send({ type: 'end' }); setConfirmEnd(false); }}>End class</button></div></dialog>
  </>;
}
function Student({ room, session, go }) {
  const { state, connection, error, ended, audio, send, engine, setError } = room;
  const [busy, setBusy] = useState(false); const wake = useRef(null);
  const active = state?.activeId === session.id, waiting = state?.me?.requested;
  useEffect(() => {
    const lock = async () => { if (active && document.visibilityState === 'visible' && navigator.wakeLock) try { wake.current = await navigator.wakeLock.request('screen'); } catch {} };
    lock(); document.addEventListener('visibilitychange', lock);
    return () => { document.removeEventListener('visibilitychange', lock); wake.current?.release().catch(() => {}); wake.current = null; };
  }, [active]);
  async function action() {
    setError('');
    if (active) { engine.current.stopAll(); send({ type: 'finish' }); return; }
    if (waiting) { engine.current.releaseMic(); send({ type: 'cancel' }); return; }
    setBusy(true);
    try { await engine.current.prepare(); if (!send({ type: 'request' })) engine.current.releaseMic(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  if (ended) return <End reason={ended} go={go} />;
  if (!state) return <Loading go={go} />;
  const disabled = busy || connection !== 'connected' || (!active && !waiting && (state.paused || !state.hostOnline));
  return <main className="student" data-connection={connection}>
    <div className="page-heading"><h1>{state.title}</h1><button className="text-button" onClick={() => { engine.current.stopAll(); send({ type: 'leave' }); go('/'); }}><LogOut size={16} />Leave</button></div>
    <div className="student-meta"><span>{state.me.name}</span><span>{state.code}</span></div>
    <Connection value={connection} />
    <div className="student-status" aria-live="polite"><h2>{active ? 'Microphone on' : waiting ? 'Waiting for approval' : state.paused ? 'Requests paused' : !state.hostOnline ? 'Waiting for teacher' : 'Microphone off'}</h2>
      {waiting && <p>Position {state.me.position || 1}</p>}
    </div>
    <button className={`mic-button ${active ? 'live' : waiting ? 'waiting' : ''}`} disabled={disabled} onClick={action} aria-label={active ? 'Stop speaking' : waiting ? 'Cancel request' : busy ? 'Opening microphone' : 'Request to speak'}>{active ? <MicOff size={42} strokeWidth={1.6} /> : waiting ? <Hand size={42} strokeWidth={1.6} /> : <Mic size={42} strokeWidth={1.6} />}</button>
    <span className="mic-label">{active ? 'Stop speaking' : waiting ? 'Cancel request' : busy ? 'Opening microphone…' : 'Request to speak'}</span>
    {active && <div className="student-meter"><Meter level={audio.level} /></div>}
    <Notice>{audio.status}</Notice>
    <Notice error>{error}</Notice>
    <p className="student-tip">{active ? 'Hold your phone close to your mouth and away from speakers. Keep this page open and your screen unlocked.' : waiting ? 'Your microphone stays off until the teacher approves. You can cancel your request.' : 'Requesting to speak lets your teacher turn on your microphone for this turn.'}</p>
  </main>;
}
function Loading({ go }) { return <main className="end"><h1>Loading class…</h1><button className="outline" onClick={() => go('/')}>Back</button></main>; }
function End({ reason, go }) { return <main className="end"><h1>{reason}</h1><button className="primary" onClick={() => go('/')}>Back</button></main>; }
function Classroom({session,go}) { const room = useClassroom(session); return session.role==='host' ? <Host room={room} go={go}/> : <Student room={room} session={session} go={go}/>; }
function App() {
  const [path,go]=useLocation(); const [revision,setRevision]=useState(0);
  useEffect(()=>{const refresh=()=>setRevision(v=>v+1);window.addEventListener('session-change',refresh);return()=>window.removeEventListener('session-change',refresh)},[]);
  const match=path.match(/^\/(host|join)\/(\d{6})$/);
  if(path==='/terms'||path==='/privacy')return <LegalPage type={path.slice(1)}/>;
  if(match){ const role=match[1]==='host'?'host':'student'; const session=readSession(role,match[2]); if(session)return <Classroom key={`${role}:${match[2]}:${revision}`} session={session} go={go}/>; if(role==='student')return <Home key={path} go={go} joinCode={match[2]}/>; return <End reason="Open this class in the browser where you created it." go={go}/>; }
  return <Home key={path} go={go}/>;
}
createRoot(document.getElementById('root')).render(<div className="app-shell"><div className="app-content"><App/></div><Footer/></div>);
