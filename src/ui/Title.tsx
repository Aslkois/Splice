import { synth } from '../audio/Synth';
import { useApp } from '../store/store';

/** The logo is five patch cables, each one plugged into a jack at both ends. */
function Logo() {
  const letters: { d: string; color: string; jacks: [number, number][] }[] = [
    // S
    { d: 'M150 40 C 90 20, 40 40, 60 80 C 80 120, 160 110, 150 160 C 140 210, 70 200, 40 180', color: '#ff8a1f', jacks: [[150, 40], [40, 180]] },
    // P
    { d: 'M200 200 L 200 40 C 300 30, 310 130, 200 120', color: '#2f6bff', jacks: [[200, 200], [200, 120]] },
    // L
    { d: 'M340 30 L 340 180 C 340 196, 352 200, 420 196', color: '#18c29c', jacks: [[340, 30], [420, 196]] },
    // I
    { d: 'M470 40 C 466 90, 474 140, 470 196', color: '#ffd23f', jacks: [[470, 40], [470, 196]] },
    // C
    { d: 'M620 60 C 560 20, 510 70, 515 120 C 520 180, 580 210, 630 170', color: '#b45cff', jacks: [[620, 60], [630, 170]] },
    // E
    { d: 'M760 40 L 680 40 L 680 196 L 765 196 M 680 118 L 745 118', color: '#ff5c8a', jacks: [[760, 40], [765, 196]] },
  ];
  return (
    <svg className="logo logo-draw" viewBox="0 0 820 240" role="img" aria-label="SPLICE">
      {letters.map((l, i) => (
        <g key={i}>
          <path className="cable" d={l.d} stroke="#15161c" strokeWidth={34} style={{ animationDelay: `${i * 90}ms` }} />
          <path className="cable" d={l.d} stroke={l.color} strokeWidth={22} style={{ animationDelay: `${i * 90}ms` }} />
          {l.jacks.map(([x, y], j) => (
            <g key={j}>
              <circle cx={x} cy={y} r={15} fill="#15161c" />
              <circle cx={x} cy={y} r={8} fill="#2c4636" stroke="#f7f7f2" strokeWidth={3} />
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

export function Title() {
  const enterLevel = useApp((s) => s.enterLevel);
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  const completed = useApp((s) => s.progress.completed);
  const go = (level: string) => {
    synth.ensure();
    synth.uiClick();
    enterLevel(level);
  };
  return (
    <main className="title-screen">
      <div className="title-inner">
        <Logo />
        <p className="tagline">Invent how your character works. Then find out what you broke.</p>
        <div className="title-menu">
          <button className="btn go" onClick={() => go('hub')} autoFocus>
            {completed.length ? 'Back to the workshop' : 'Start the campaign'}
          </button>
          <button className="btn" onClick={() => go('sandbox')}>
            Sandbox
          </button>
          <button className="btn quiet" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
        <p className="title-note">
          Move with A/D, jump with Space, dash with Shift. Everything else, you build: press Tab to open the workbench, wire an event to an
          action, and test it straight away.
        </p>
      </div>
      <div className="title-foot">
        <span>{completed.length} of 3 challenges solved</span>
        <span>Your mechanics and progress are saved in this browser.</span>
      </div>
    </main>
  );
}
