import React, { useEffect } from 'react';

const email = 'guolinn@student.ubc.ca';
const updated = 'October 2, 2026';

export function PolicyLink({ type, children }) {
  return <a href={`/${type}`} target="_blank" rel="noopener" title="Opens in a new tab">{children}</a>;
}

export function Footer() {
  return <footer className="site-footer">
    <span>Made by Guolin in UBC</span>
    <nav aria-label="Legal"><PolicyLink type="terms">Terms of Service</PolicyLink><PolicyLink type="privacy">Privacy Policy</PolicyLink></nav>
  </footer>;
}

function Contact() {
  return <>
    <p>For questions about this service or your personal information, contact Guolin at <a href={`mailto:${email}`}>{email}</a>. You can ask about access, correction, deletion, or raise a privacy concern. We may need enough information to identify your session and verify your request. Please do not send passwords or recordings of other people. Information that has already expired cannot be recovered.</p>
    <p>GitHub: <a href="https://github.com/Guolinn" target="_blank" rel="noopener noreferrer">Guolinn</a></p>
  </>;
}

function Terms() {
  return <>
    <p>These terms apply to classroom-mic.beringtech.com, a classroom microphone service operated by Guolin. Creating or joining a class means you agree to these terms.</p>
    <section><h2>Personal project</h2><p>This is an independent project made by Guolin at UBC. It is not operated, sponsored, or endorsed by The University of British Columbia (UBC).</p></section>
    <section><h2>Using a class</h2>
      <p>Use the service with the permission of your teacher or class organizer. Share class codes and links only with intended participants. A code is not proof of a person's identity: anyone with it may attempt to join. The teacher controls which microphone can broadcast and may mute speakers, dismiss requests, or end the class.</p>
      <p>Teachers and organizers are responsible for checking whether this service is appropriate and permitted for their setting, explaining its use to participants, and providing another way to participate when needed.</p>
    </section>
    <section><h2>Microphone permission</h2>
      <p>Requesting to speak authorizes the teacher to turn on your microphone for that speaking turn. Your browser first asks for microphone permission; audio is not sent to the teacher while your request is waiting. After approval, your voice is transmitted live to the teacher's device and may be played over classroom speakers.</p>
      <p>You can cancel a request before approval, select Stop speaking during your turn, or leave the class. The website does not record or transcribe audio. People who can hear the class may use recording tools outside this website; do not record others without the permission required for your setting.</p>
    </section>
    <section><h2>Acceptable use</h2>
      <p>Do not impersonate others, harass participants, share unlawful content, disrupt a class, create harmful audio, or try to bypass microphone controls or access someone else's session. You remain responsible for what you say and share. Access may be restricted to address misuse or protect the service.</p>
    </section>
    <section><h2>Privacy</h2><p>The <a href="/privacy">Privacy Policy</a> explains what information is processed, who receives it, how long it remains available, and your choices. Do not enter student numbers, grades, or other sensitive information as your display name or class name.</p></section>
    <section><h2>Availability and limitations</h2>
      <p>The service is provided as available. Audio quality, delay, and connectivity depend on your devices, browser, network, and classroom sound system. Test it before use and start with a low speaker volume. Availability, uninterrupted operation, and freedom from acoustic feedback are not guaranteed. Do not rely on it for emergency communication.</p>
      <p>To the extent permitted by applicable law, the service is provided without warranties of fitness for a particular purpose. Nothing in these terms limits rights or liability that cannot legally be excluded.</p>
    </section>
    <section><h2>Changes and contact</h2><p>The service may change or be suspended for maintenance, security, or operational reasons. Updates to these terms will be posted here with a revised date and apply to subsequent use. Material changes will be highlighted before they take effect.</p><Contact /></section>
  </>;
}

function Privacy() {
  return <>
    <p>Guolin operates classroom-mic.beringtech.com as an independent personal project created at UBC. It is not an official UBC service. This policy describes the current website and audio service.</p>
    <section><h2>What we process and why</h2>
      <ul>
        <li><strong>Class information.</strong> The class name, your chosen display name, random session identifiers, join time, connection status, and speaking requests let the teacher manage participation. A first name or nickname is enough; no student number or account is required.</li>
        <li><strong>Live audio.</strong> Microphone audio is processed to reduce noise and transmit your voice after the teacher approves your request. We do not record, transcribe, sell, or use your audio to train AI models.</li>
        <li><strong>Connection information.</strong> IP addresses, browser request information, and connection details are processed to deliver the website, establish audio connections, limit abusive requests, and diagnose failures.</li>
      </ul>
      <p>The application does not use advertising, analytics trackers, or tracking cookies. We do not sell personal information.</p>
    </section>
    <section><h2>Who can receive it</h2>
      <p>The teacher receives participants' display names, speaking requests, connection status, and the approved speaker's live audio. The class name and active speaker's display name are also sent to class participants. Anyone who knows a class code may join; keep the code within the intended group.</p>
      <p>Your voice can be heard by people near the classroom speakers or the teacher's device. The website cannot control recordings made by teachers, participants, or other software outside this service.</p>
      <p>Audio normally travels directly between the approved speaker and teacher using an encrypted browser connection. Establishing that connection may reveal network addresses to the other device. If a direct connection fails, audio passes through our server over encrypted connections and is briefly buffered in memory for delivery. That fallback is not end-to-end encrypted against the server operator.</p>
    </section>
    <section><h2>Hosting and connection providers</h2>
      <p>The application is hosted on Amazon Web Services (AWS) in Oregon, United States. Class information and any server-relayed audio are processed there. Data processed outside Canada may be subject to the laws of the country where it is processed. See <a href="https://aws.amazon.com/compliance/data-privacy-faq/" target="_blank" rel="noopener noreferrer">AWS data privacy information</a>.</p>
      <p>Browsers use Cloudflare's STUN service to help establish direct audio connections. Cloudflare receives network information such as your IP address and port for that purpose; our application does not send microphone audio to this STUN service. Cloudflare may process connection information outside Canada. See <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Cloudflare's privacy policy</a>.</p>
    </section>
    <section><h2>Storage and retention</h2>
      <ul>
        <li><strong>Audio:</strong> only transient processing and playback buffers are used. The application has no audio recording or audio archive.</li>
        <li><strong>Class data:</strong> kept in server memory, not a database. It is removed when the teacher ends the class, the class expires after about 12 hours, the teacher stays offline for about five minutes, or the application restarts. A student's server entry is removed when they leave or after about ten minutes offline.</li>
        <li><strong>Abuse prevention:</strong> temporary IP-based request counters are kept in memory and normally cleared after about one minute.</li>
        <li><strong>Browser storage:</strong> class codes and session access credentials are stored in the current tab so refreshing can restore access. They are removed when the app receives a class-end message or the tab's session storage is cleared. Browser session-restore features may retain them; you can remove them by clearing this site's data.</li>
        <li><strong>Operational logs:</strong> server and proxy errors can include IP addresses, timestamps, and requested paths. Routine page-view access logging is not enabled. Logs follow the host's rotation and storage settings, rather than a guaranteed fixed deletion period. The application does not intentionally write microphone audio or participant names to logs.</li>
      </ul>
      <p>Hosting and connection providers may retain their own operational data under their applicable policies. Information copied or recorded by class participants is outside the website's retention controls.</p>
    </section>
    <section><h2>Your choices</h2>
      <p>Before requesting to speak, you can join without granting microphone access. A speaking request lets the teacher activate your microphone for that turn. While waiting, your microphone tracks are disabled and no microphone audio is sent to the teacher. Cancel request withdraws that request; Stop speaking, Leave, or closing the page stops further microphone transmission. You can also revoke microphone permission in your browser.</p>
      <p>Use a display name your teacher recognizes and avoid sensitive information. If you do not want your voice amplified or information processed as described here, ask your teacher for another way to participate.</p>
    </section>
    <section><h2>Requests and policy updates</h2><Contact /><p>If data practices change, this policy and its date will be updated. Material changes will be brought to your attention, and additional consent will be requested where required before information is used for a new purpose.</p></section>
  </>;
}

export function LegalPage({ type }) {
  const title = type === 'terms' ? 'Terms of Service' : 'Privacy Policy';
  useEffect(() => { document.title = `${title} · MicTurn`; return () => { document.title = 'MicTurn'; }; }, [title]);
  return <main className="legal-page">
    <a className="legal-back" href="/">Back to microphone</a>
    <h1>{title}</h1><p className="legal-date">Last updated {updated}</p>
    {type === 'terms' ? <Terms /> : <Privacy />}
  </main>;
}
