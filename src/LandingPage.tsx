import {
  ArrowRight,
  Cpu,
  Download,
  Film,
  HardDrive,
  LockKeyhole,
  MousePointer2,
  ScanLine,
  ShieldCheck,
  Upload,
  ZoomIn,
} from 'lucide-react'
import isolateLogo from '../isolate-logo.webp'

const workflow = [
  {
    icon: Upload,
    title: 'Open a local clip',
    copy: 'Choose browser-decodable footage up to 20 seconds and 500 MB. The source file stays on your device.',
  },
  {
    icon: MousePointer2,
    title: 'Mark what stays',
    copy: 'Add subject and exclude points on the active frame, then refine the matte where edges need attention.',
  },
  {
    icon: ScanLine,
    title: 'Track every frame',
    copy: 'SAM2 runs sequentially on WebGPU when available, with a CPU/WASM fallback on supported browsers.',
  },
  {
    icon: Download,
    title: 'Download the cutout',
    copy: 'Original color is combined with the stored masks and exported as one silent, transparent WebM.',
  },
]

export function LandingPage() {
  return (
    <main className="landing-shell">
      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="Isolate home">
          <img src={isolateLogo} alt="" />
          <strong>Isolate</strong>
        </a>
        <div className="landing-nav-actions">
          <span><ShieldCheck size={15} aria-hidden="true" /> Private by design</span>
          <a href="/studio">Open studio <ArrowRight size={16} aria-hidden="true" /></a>
        </div>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-core">
          <img className="landing-hero-logo" src={isolateLogo} alt="Isolate" />
          <h1 id="landing-title">Keep the subject.<br /><span>Lose everything else.</span></h1>
          <p>
            Private, browser-native rotoscoping for short clips. Guide SAM2 with a few points,
            track the selection locally, and leave with a transparent video—not an uploaded source file.
          </p>
          <a className="landing-primary-action" href="/studio">
            Try now <ArrowRight size={19} aria-hidden="true" />
          </a>
          <span className="landing-action-note">No account · no server upload · processing stays on this device</span>
        </div>
        <div className="landing-capacity" aria-label="Service limits">
          <div><strong>20s</strong><span>maximum duration</span></div>
          <div><strong>500MB</strong><span>maximum source file</span></div>
          <div><strong>2K</strong><span>working and output ceiling</span></div>
          <div><strong>64MB</strong><span>local mask cache</span></div>
        </div>
      </section>

      <section className="landing-privacy" aria-labelledby="privacy-title">
        <div className="landing-section-title">
          <LockKeyhole size={28} aria-hidden="true" />
          <h2 id="privacy-title">Your footage stays where it belongs.</h2>
        </div>
        <div className="landing-privacy-copy">
          <p>
            Isolate is delivered as a static website. Video decoding, model inference, masks,
            session recovery, and export all happen inside your browser.
          </p>
          <dl>
            <div><dt>Compute</dt><dd>Your GPU through WebGPU, or your CPU through WebAssembly</dd></div>
            <div><dt>Storage</dt><dd>Bounded browser cache for masks and project metadata</dd></div>
            <div><dt>Server role</dt><dd>Serves the interface only; it never receives your footage</dd></div>
          </dl>
        </div>
      </section>

      <section className="landing-workflow" aria-labelledby="workflow-title">
        <div className="landing-workflow-heading">
          <h2 id="workflow-title">From footage to clean alpha in four deliberate passes.</h2>
          <p>Nothing is queued in a cloud render farm. Every frame is processed and stored sequentially.</p>
        </div>
        <ol className="landing-workflow-list">
          {workflow.map(({ icon: Icon, title, copy }, index) => (
            <li key={title}>
              <span className="landing-step-number">{String(index + 1).padStart(2, '0')}</span>
              <Icon size={22} aria-hidden="true" />
              <h3>{title}</h3>
              <p>{copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-output" aria-labelledby="output-title">
        <div className="landing-output-copy">
          <Film size={29} aria-hidden="true" />
          <h2 id="output-title">One source in.<br />One transparent video out.</h2>
          <p>
            The output keeps original color inside the matte and makes everything outside it transparent.
            Larger sources are reduced proportionally to the 2K working envelope.
          </p>
        </div>
        <div className="landing-output-ledger" aria-label="Output specification">
          <div><span>Container</span><strong>WebM</strong></div>
          <div><span>Video</span><strong>VP9 / VP8 + alpha</strong></div>
          <div><span>Frame rate</span><strong>6–8 analysis FPS</strong></div>
          <div><span>Color</span><strong>Original inside mask</strong></div>
          <div><span>Audio</span><strong>Silent output</strong></div>
          <div><span>Export cap</span><strong>64 MB</strong></div>
        </div>
      </section>

      <section className="landing-details" aria-labelledby="details-title">
        <div className="landing-details-heading">
          <h2 id="details-title">Built for close inspection, bounded for the browser.</h2>
          <p>Clear limits keep memory use predictable while the editing controls stay precise.</p>
        </div>
        <div className="landing-detail-rows">
          <article>
            <ZoomIn size={22} aria-hidden="true" />
            <div><h3>Inspect the edge</h3><p>Scroll from 1× to 8× zoom. Hold Space and drag to pan without placing prompt points.</p></div>
          </article>
          <article>
            <Cpu size={22} aria-hidden="true" />
            <div><h3>Use available hardware</h3><p>WebGPU is preferred. CPU/WASM remains available when compatible GPU acceleration is not.</p></div>
          </article>
          <article>
            <HardDrive size={22} aria-hidden="true" />
            <div><h3>Keep memory bounded</h3><p>Only the active frame, active mask, and current model embedding stay in working memory.</p></div>
          </article>
        </div>
        <p className="landing-format-note">
          Recommended input: H.264 in MP4 or VP9 in WebM. Input support follows your browser.
          Transparent export requires Chrome, Edge, or Firefox; Safari discards WebM alpha.
        </p>
      </section>

      <section className="landing-close" aria-labelledby="close-title">
        <h2 id="close-title">Ready to separate the frame?</h2>
        <p>Open a clip and build the cutout on the hardware already in front of you.</p>
        <a className="landing-primary-action" href="/studio">
          Try now <ArrowRight size={19} aria-hidden="true" />
        </a>
      </section>

      <footer className="landing-footer">
        <span>Isolate</span>
        <span>Local SAM2 rotoscoping · static deployment · transparent WebM output</span>
      </footer>
    </main>
  )
}
