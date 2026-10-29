import { useEffect, useRef } from 'react';
import { synth } from '../audio/Synth';
import { runner } from '../game/bridge';
import { createGame } from '../game/createGame';
import { useApp } from '../store/store';
import { HUD } from './HUD';
import { PauseMenu, SettingsPanel } from './Menus';
import { SandboxTools } from './SandboxTools';
import { Title } from './Title';
import { Workshop } from './workshop/Workshop';
import { installDebugHooks } from './debug';

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const screen = useApp((s) => s.screen);
  const workshopOpen = useApp((s) => s.workshopOpen);
  const pauseOpen = useApp((s) => s.pauseOpen);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const mode = useApp((s) => s.mode);

  useEffect(() => {
    if (!host.current) return;
    const game = createGame(host.current);
    runner.input.attach(host.current);
    runner.input.onSystemKey = (key) => {
      const s = useApp.getState();
      if (key === 'Tab') s.toggleWorkshop();
      else if (key === 'Escape') {
        if (s.settingsOpen) s.setSettingsOpen(false);
        else if (s.workshopOpen) s.closeWorkshop();
        else if (s.screen === 'game') s.setPause(!s.pauseOpen);
      }
    };
    const unlock = () => synth.ensure();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    installDebugHooks();
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      runner.input.detach();
      game.destroy(true);
    };
  }, []);

  useEffect(() => {
    runner.input.enabled = screen === 'game' && !workshopOpen && !pauseOpen;
  }, [screen, workshopOpen, pauseOpen]);

  return (
    <>
      <div className="game-host" ref={host} aria-label="Game view" />
      {screen === 'game' && !workshopOpen && <HUD />}
      {screen === 'game' && !workshopOpen && mode === 'sandbox' && <SandboxTools />}
      {screen === 'title' && <Title />}
      {workshopOpen && <Workshop />}
      {pauseOpen && !workshopOpen && <PauseMenu />}
      {settingsOpen && <SettingsPanel />}
    </>
  );
}
