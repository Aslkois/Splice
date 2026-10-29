import { useEffect, useState } from 'react';
import { synth } from '../audio/Synth';
import { runner } from '../game/bridge';
import { PHYSICS } from '../sim/config';
import { useApp } from '../store/store';

type Tool = 'crate' | 'heavy' | 'target' | 'cell' | 'turret' | 'walker' | 'cannon' | 'erase';

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'crate', label: 'Crate' },
  { id: 'heavy', label: 'Iron crate' },
  { id: 'target', label: 'Target' },
  { id: 'cell', label: 'Cell' },
  { id: 'turret', label: 'Turret' },
  { id: 'walker', label: 'Walker' },
  { id: 'cannon', label: 'Cannon' },
  { id: 'erase', label: 'Remove' },
];

/** Sandbox-only tools: place things, bend the environment, reset the experiment. */
export function SandboxTools() {
  const [tool, setTool] = useState<Tool | null>(null);
  const [gravity, setGravity] = useState(1);
  const [speed, setSpeed] = useState(1);
  const restart = useApp((s) => s.restartLevel);

  useEffect(() => {
    runner.input.mouseCaptured = tool !== null;
    if (!tool) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName !== 'CANVAS' || e.button !== 0) return;
      const at = runner.input.aim;
      if (!at || !runner.world) return;
      if (tool === 'erase') {
        if (runner.world.sandboxRemoveAt(at)) synth.uiUnplug();
      } else if (runner.world.sandboxSpawn(tool, at)) synth.uiDrop();
    };
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      runner.input.mouseCaptured = false;
    };
  }, [tool]);

  useEffect(() => {
    if (runner.world) runner.world.gravity = PHYSICS.gravity * gravity;
  }, [gravity]);

  useEffect(() => {
    runner.timeScale = speed;
    return () => {
      runner.timeScale = 1;
    };
  }, [speed]);

  return (
    <section className="toolbox" aria-label="Sandbox tools">
      <h4>Place with a click</h4>
      <div className="tool-grid">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tool ${tool === t.id ? 'on' : ''}`} aria-pressed={tool === t.id} onClick={() => setTool(tool === t.id ? null : t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <label className="slider-row">
        <span>Gravity</span>
        <input type="range" min={0.2} max={2} step={0.1} value={gravity} onChange={(e) => setGravity(Number(e.target.value))} />
        <span>{gravity.toFixed(1)}×</span>
      </label>
      <label className="slider-row">
        <span>Sim speed</span>
        <input type="range" min={0.25} max={1} step={0.25} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
        <span>{speed}×</span>
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className="btn small"
          onClick={() => {
            runner.world?.sandboxRefill();
            synth.pickup();
          }}
        >
          Refill
        </button>
        <button
          className="btn small quiet"
          onClick={() => {
            restart();
            setGravity(1);
          }}
        >
          Reset arena
        </button>
      </div>
    </section>
  );
}
