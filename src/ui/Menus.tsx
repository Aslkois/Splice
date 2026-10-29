import { useApp } from '../store/store';

export function PauseMenu() {
  const s = useApp();
  const inChallenge = s.mode === 'campaign';
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <div className="panel">
        <h2 id="pause-title">Paused</h2>
        <div className="stack">
          <button className="btn go" onClick={() => s.setPause(false)} autoFocus>
            Resume
          </button>
          <button className="btn" onClick={() => s.openWorkshop()}>
            Open the workbench
          </button>
          {s.mode !== 'hub' && (
            <button className="btn" onClick={() => s.restartLevel()}>
              {inChallenge ? 'Restart challenge' : 'Reset the arena'}
            </button>
          )}
          {s.mode !== 'hub' && (
            <button className="btn quiet" onClick={() => s.enterLevel('hub')}>
              Back to the workshop
            </button>
          )}
          <button className="btn quiet" onClick={() => s.setSettingsOpen(true)}>
            Settings
          </button>
          <button className="btn quiet" onClick={() => s.toTitle()}>
            Title screen
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const close = () => useApp.getState().setSettingsOpen(false);
  const resetProgress = useApp((s) => s.resetProgress);
  const vol = (key: 'master' | 'sfx' | 'ui', label: string) => (
    <label className="row">
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={settings[key]} onChange={(e) => setSettings({ [key]: Number(e.target.value) })} />
      <span>{Math.round(settings[key] * 100)}</span>
    </label>
  );
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="panel">
        <h2 id="settings-title">Settings</h2>
        {vol('master', 'Master volume')}
        {vol('sfx', 'Game sounds')}
        {vol('ui', 'Workbench sounds')}
        <label className="row">
          <span>Screen shake</span>
          <input type="checkbox" className="switch" checked={settings.shake} onChange={(e) => setSettings({ shake: e.target.checked })} />
          <span />
        </label>
        <label className="row">
          <span>Impact flashes</span>
          <input type="checkbox" className="switch" checked={settings.flashes} onChange={(e) => setSettings({ flashes: e.target.checked })} />
          <span />
        </label>
        <div className="stack">
          <button className="btn go" onClick={close} autoFocus>
            Done
          </button>
          <button
            className="btn quiet small"
            onClick={() => {
              if (confirm('Forget which challenges you have solved? Your mechanics are kept.')) resetProgress();
            }}
          >
            Reset campaign progress
          </button>
        </div>
      </div>
    </div>
  );
}
