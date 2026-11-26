import React, { useState } from 'react';
import { readReceiver, saveReceiverCode } from './local-receiver';

export function ReceiverPage({ go }) {
  const [code, setCode] = useState(''), [error, setError] = useState('');
  function pair(e) {
    e.preventDefault();
    try { saveReceiverCode(code.trim()); go('/'); } catch (e) { setError(e.message); }
  }
  return <main className="legal-page receiver-page">
    <a href="/">Back to microphone</a>
    <h1>Local audio receiver</h1>
    <p>Experimental. Students use their browsers; the teacher runs this receiver on a Mac. Both devices must be on a network that allows them to connect directly.</p>
    <ol>
      <li><a href="/downloads/MicTurn-Receiver-macOS.zip?v=0.1.3" download>Download for Mac</a> — version 0.1.3 (Apple silicon and Intel). Quit an older receiver before opening this version.</li>
      <li>Unzip, then open <strong>Start Receiver.command</strong>. Keep its window open. It opens the teacher website with the receiver selected. Keep the teacher page visible during use; background tabs may stop audio.</li>
      <li>Choose the classroom speakers in macOS Sound settings before starting the receiver. Allow local network access if asked. Create a class and use <strong>Test speaker</strong> before approving a student.</li>
    </ol>
    <p>The download is not Apple-notarized. If macOS blocks it, review the download and use System Settings → Privacy &amp; Security → Open Anyway. Do not disable macOS security protections.</p>
    <p>Students need Safari 26.4 or newer, or a current Chrome or Firefox with WebTransport support. Campus Wi-Fi may block local connections. If it does, select <strong>Browser audio</strong> on the teacher page and ask the student to request again.</p>
    <p>This mode sends 5 ms audio packets to the Mac and uses a small adaptive playback buffer. Those settings are not a measurement or guarantee of total delay. iPhone-to-classroom-speaker latency still needs an on-site comparison.</p>
    <p>To stop, mute or end the class, then close the receiver window. Restart the receiver after changing networks or audio output devices.</p>
    <details className="receiver-pair"><summary>Enter a pairing code manually</summary>
      <form onSubmit={pair}><label htmlFor="receiver-code">Pairing code from the receiver window</label><input id="receiver-code" autoComplete="off" spellCheck="false" value={code} onChange={e => setCode(e.target.value)} required /><button className="primary">Use receiver</button>{error && <p role="alert" className="notice error">{error}</p>}</form>
    </details>
    {readReceiver() && <p>A receiver is saved in this tab. <button className="text-button" onClick={() => { sessionStorage.removeItem('mic:local-receiver'); go('/'); }}>Forget receiver</button></p>}
    <p><a href="/downloads/SHA256SUMS.txt">Download checksum</a> · <a href="https://github.com/Guolinn/classroom-mic/tree/main/receiver" target="_blank" rel="noopener noreferrer">Source and build instructions</a></p>
  </main>;
}
