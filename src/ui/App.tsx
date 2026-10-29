import { useEffect, useRef } from 'react';
import { synth } from '../audio/Synth';
import { runner } from '../game/bridge';
import { createGame } from '../game/createGame';
import { useApp } from '../store/store';
import { HUD } from './HUD';
import { LabPicker } from './LabPicker';
import { PauseMenu, SettingsPanel } from './Menus';
import { SandboxTools } from './SandboxTools';
import { Title } from './Title';
import { Workshop } from './workshop/Workshop';
import { installDebugHooks } from './debug';
import { DocsPanel } from './docs/DocsPanel';
import { DebuggerPanel } from './debugger/DebuggerPanel';

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const screen = useApp((s) => s.screen);
  const workshopOpen = useApp((s) => s.workshopOpen);
  const pauseOpen = useApp((s) => s.pauseOpen);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const mode = useApp((s) => s.mode);
  const labPickerOpen = useApp((s) => s.labPickerOpen);
  const docsOpen = useApp((s) => s.docs.open);
  const debugOverlay = useApp((s) => s.debugOverlay);
  const trial = useApp((s) => s.trial);

  useEffect(() => {
    if (!host.current) return;
    const game = createGame(host.current);
    runner.input.attach(host.current);
    runner.input.onSystemKey = (key) => {
      const s = useApp.getState();
      if (key === 'Tab') {
        if (!s.docs.open) s.toggleWorkshop();
      } else if (key === 'Escape') {
        if (s.docs.open) s.closeDocs();
        else if (s.settingsOpen) s.setSettingsOpen(false);
        else if (s.labPickerOpen) s.setLabPickerOpen(false);
        else if (s.workshopOpen) s.closeWorkshop();
        else if (s.screen === 'game') s.setPause(!s.pauseOpen);
      }
    };
    const unlock = () => synth.ensure();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // Backquote toggles the debugger window while playing; F1 opens the docs anywhere.
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const s = useApp.getState();
      if (e.code === 'Backquote' && s.screen === 'game' && !s.workshopOpen) {
        e.preventDefault();
        s.setDebugOverlay(!s.debugOverlay);
      } else if (e.key === 'F1' && !s.workshopOpen) {
        e.preventDefault();
        s.openDocs();
      }
    };
    window.addEventListener('keydown', onKey);
    installDebugHooks();
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      runner.input.detach();
      game.destroy(true);
    };
  }, []);

  useEffect(() => {
    runner.input.enabled = screen === 'game' && !workshopOpen && !pauseOpen && !labPickerOpen && !docsOpen;
    // The docs pause play like the workbench does.
    if (screen === 'game') runner.paused = workshopOpen || pauseOpen || labPickerOpen || docsOpen;
  }, [screen, workshopOpen, pauseOpen, labPickerOpen, docsOpen]);

  return (
    <>
      <div className="game-host" ref={host} aria-label="Game view" />
      {screen === 'game' && !workshopOpen && <HUD />}
      {screen === 'game' && !workshopOpen && mode === 'sandbox' && <SandboxTools />}
      {screen === 'title' && <Title />}
      {workshopOpen && <Workshop />}
      {pauseOpen && !workshopOpen && <PauseMenu />}
      {labPickerOpen && !workshopOpen && <LabPicker />}
      {settingsOpen && <SettingsPanel />}
      {screen === 'game' && !workshopOpen && trial && (
        <div className="trial-banner" role="status">
          Trying “{trial.title}” in the testbench — only this mechanic is running.
          <button className="btn small" onClick={() => useApp.getState().enterLevel('hub')}>
            Leave
          </button>
        </div>
      )}
      {screen === 'game' && !workshopOpen && debugOverlay && (
        <section className="dbg-overlay" aria-label="Debugger">
          <header>
            <span>Debugger</span>
            <button className="btn small quiet" onClick={() => useApp.getState().setDebugOverlay(false)} title="Close (`)">
              Close
            </button>
          </header>
          <DebuggerPanel compact />
        </section>
      )}
      {docsOpen && <DocsPanel />}
    </>
  );
}
