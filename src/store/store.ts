import { create } from 'zustand';
import { synth } from '../audio/Synth';
import { presentation, runner, setRunnerHooks } from '../game/bridge';
import { emptyGraph, MAX_EQUIPPED, uid, type MechanicGraph, type MechanicLibrary } from '../mechanics/schema';
import {
  loadLibrary,
  loadProgress,
  loadSettings,
  saveLibrary,
  saveProgress,
  saveSettings,
  betterLabScore,
  unlockedTier,
  type LabScore,
  type Progress,
  type Settings,
} from '../persistence/storage';
import type { ValidateOptions } from '../mechanics/validate';
import { Door } from '../sim/entities/props';
import { LAB_BY_ID } from '../sim/levels/labs';
import type { GameMode } from '../sim/World';

export type Screen = 'title' | 'game';

interface History {
  past: MechanicGraph[];
  future: MechanicGraph[];
}

export interface AppState {
  screen: Screen;
  levelId: string;
  mode: GameMode;
  /** Sandbox Law of Equivalent Exchange toggle. Campaign ignores it. */
  law: boolean;
  workshopOpen: boolean;
  pauseOpen: boolean;
  settingsOpen: boolean;
  labPickerOpen: boolean;
  /** Result of the lab run just finished, for the picker to show. */
  lastLabResult: { id: string; score: LabScore; best: boolean } | null;
  library: MechanicLibrary;
  selectedId: string | null;
  history: Record<string, History>;
  progress: Progress;
  settings: Settings;
  /** Primitive types the player has not opened the drawer on since unlocking. */
  justUnlockedTier: number | null;

  enterLevel(levelId: string): void;
  toTitle(): void;
  restartLevel(): void;
  openWorkshop(): void;
  closeWorkshop(): void;
  toggleWorkshop(): void;
  setPause(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setLabPickerOpen(open: boolean): void;
  completeLab(levelId: string, score: LabScore): void;
  setLaw(on: boolean): void;
  setSettings(patch: Partial<Settings>): void;

  selectMechanic(id: string): void;
  createMechanic(name?: string): string;
  importMechanic(g: MechanicGraph): void;
  duplicateMechanic(id: string): void;
  deleteMechanic(id: string): void;
  renameMechanic(id: string, name: string): void;
  /** Records an edit as one undoable step. */
  commitGraph(g: MechanicGraph): void;
  undo(): void;
  redo(): void;
  toggleEquip(id: string): void;
  moveEquip(id: string, dir: -1 | 1): void;
  completeLevel(levelId: string, time: number): void;
  resetProgress(): void;
}

export function modeFor(levelId: string): GameMode {
  if (levelId === 'hub') return 'hub';
  if (levelId === 'sandbox') return 'sandbox';
  if (LAB_BY_ID[levelId]) return 'lab';
  return 'campaign';
}

export function equippedGraphs(lib: MechanicLibrary): MechanicGraph[] {
  return lib.equipped.map((id) => lib.mechanics.find((m) => m.id === id)).filter((m): m is MechanicGraph => !!m);
}

/** Which parts a world allows: everything in the sandbox, the lab's list in a lab, unlocked tiers elsewhere. */
export function rulesFor(mode: GameMode, levelId: string, progress: Progress): ValidateOptions {
  if (mode === 'sandbox') return {};
  if (mode === 'lab') {
    const lab = LAB_BY_ID[levelId];
    return lab ? { allowedTypes: lab.parts, maxBlocks: lab.maxBlocks } : {};
  }
  return { maxTier: unlockedTier(progress) };
}

const initialLibrary = loadLibrary();
if (initialLibrary.mechanics.length === 0) {
  const first = emptyGraph('My first mechanic');
  initialLibrary.mechanics.push(first);
  initialLibrary.equipped.push(first.id);
}
const initialSettings = loadSettings();
synth.setVolumes(initialSettings);
presentation.shake = initialSettings.shake;
presentation.flashes = initialSettings.flashes;

let returnTimer: ReturnType<typeof setTimeout> | null = null;

export const useApp = create<AppState>((set, get) => {
  const persistLibrary = (library: MechanicLibrary) => {
    saveLibrary(library);
    set({ library });
  };

  const hotReload = () => {
    const s = get();
    if (!runner.world) return;
    runner.reloadMechanics(equippedGraphs(s.library), rulesFor(s.mode, s.levelId, s.progress));
  };

  return {
    screen: 'title',
    levelId: 'hub',
    mode: 'hub',
    law: true,
    workshopOpen: false,
    pauseOpen: false,
    settingsOpen: false,
    labPickerOpen: false,
    lastLabResult: null,
    library: initialLibrary,
    selectedId: initialLibrary.mechanics[0]?.id ?? null,
    history: {},
    progress: loadProgress(),
    settings: initialSettings,
    justUnlockedTier: null,

    enterLevel(levelId) {
      if (returnTimer) clearTimeout(returnTimer);
      returnTimer = null;
      set({ labPickerOpen: false });
      const s = get();
      const mode = modeFor(levelId);
      runner.load({
        levelId,
        mode,
        lawEnabled: mode === 'sandbox' ? s.law : true,
        mechanics: equippedGraphs(s.library),
        rules: rulesFor(mode, levelId, s.progress),
      });
      runner.paused = s.workshopOpen || s.pauseOpen;
      set({ screen: 'game', levelId, mode, pauseOpen: false });
      runner.paused = get().workshopOpen;
    },

    toTitle() {
      runner.paused = true;
      synth.stopAllLoops();
      set({ screen: 'title', workshopOpen: false, pauseOpen: false });
    },

    restartLevel() {
      runner.restart();
      set({ pauseOpen: false });
      runner.paused = get().workshopOpen;
    },

    openWorkshop() {
      runner.paused = true;
      runner.input.releaseAll();
      synth.uiOpen();
      synth.stopAllLoops();
      set({ workshopOpen: true, pauseOpen: false, justUnlockedTier: null });
    },

    closeWorkshop() {
      hotReload();
      runner.input.releaseAll();
      set({ workshopOpen: false });
      runner.paused = get().pauseOpen;
    },

    toggleWorkshop() {
      if (get().screen !== 'game') return;
      if (get().workshopOpen) get().closeWorkshop();
      else get().openWorkshop();
    },

    setPause(open) {
      if (get().screen !== 'game') return;
      runner.paused = open || get().workshopOpen;
      if (open) {
        runner.input.releaseAll();
        synth.stopAllLoops();
      }
      set({ pauseOpen: open });
    },

    setSettingsOpen(open) {
      set({ settingsOpen: open });
    },

    setLabPickerOpen(open) {
      runner.paused = open || get().workshopOpen || get().pauseOpen;
      if (open) runner.input.releaseAll();
      set({ labPickerOpen: open });
    },

    completeLab(levelId, score) {
      const p = get().progress;
      const best = betterLabScore(score, p.labs[levelId]);
      const progress = { ...p, labs: best ? { ...p.labs, [levelId]: score } : p.labs };
      saveProgress(progress);
      set({ progress, lastLabResult: { id: levelId, score, best } });
      if (returnTimer) clearTimeout(returnTimer);
      returnTimer = setTimeout(() => {
        returnTimer = null;
        if (get().screen === 'game' && get().levelId === levelId && !get().workshopOpen) {
          get().enterLevel('hub');
          get().setLabPickerOpen(true);
        }
      }, 2600);
    },

    setLaw(on) {
      if (get().mode !== 'sandbox') return;
      runner.setLaw(on);
      set({ law: on });
    },

    setSettings(patch) {
      const settings = { ...get().settings, ...patch };
      saveSettings(settings);
      synth.setVolumes(settings);
      presentation.shake = settings.shake;
      presentation.flashes = settings.flashes;
      set({ settings });
    },

    selectMechanic(id) {
      set({ selectedId: id });
    },

    createMechanic(name = 'New mechanic') {
      const g = emptyGraph(name);
      const lib = get().library;
      const equipped = lib.equipped.length < MAX_EQUIPPED ? [...lib.equipped, g.id] : lib.equipped;
      persistLibrary({ ...lib, mechanics: [...lib.mechanics, g], equipped });
      set({ selectedId: g.id });
      return g.id;
    },

    importMechanic(g) {
      const lib = get().library;
      const copy = { ...g, id: lib.mechanics.some((m) => m.id === g.id) ? uid('m') : g.id, updated: Date.now() };
      const equipped = lib.equipped.length < MAX_EQUIPPED ? [...lib.equipped, copy.id] : lib.equipped;
      persistLibrary({ ...lib, mechanics: [...lib.mechanics, copy], equipped });
      set({ selectedId: copy.id });
    },

    duplicateMechanic(id) {
      const lib = get().library;
      const src = lib.mechanics.find((m) => m.id === id);
      if (!src) return;
      const copy: MechanicGraph = { ...JSON.parse(JSON.stringify(src)), id: uid('m'), name: `${src.name} (copy)`, created: Date.now(), updated: Date.now() };
      persistLibrary({ ...lib, mechanics: [...lib.mechanics, copy] });
      set({ selectedId: copy.id });
    },

    deleteMechanic(id) {
      const lib = get().library;
      const mechanics = lib.mechanics.filter((m) => m.id !== id);
      persistLibrary({ ...lib, mechanics, equipped: lib.equipped.filter((e) => e !== id) });
      const sel = get().selectedId === id ? (mechanics[0]?.id ?? null) : get().selectedId;
      set({ selectedId: sel });
    },

    renameMechanic(id, name) {
      const lib = get().library;
      const m = lib.mechanics.find((x) => x.id === id);
      if (!m) return;
      get().commitGraph({ ...m, name: name.slice(0, 60) || 'Untitled mechanic' });
    },

    commitGraph(g) {
      const lib = get().library;
      const prev = lib.mechanics.find((m) => m.id === g.id);
      if (!prev) return;
      const h = get().history[g.id] ?? { past: [], future: [] };
      const next: History = { past: [...h.past.slice(-99), prev], future: [] };
      persistLibrary({ ...lib, mechanics: lib.mechanics.map((m) => (m.id === g.id ? g : m)) });
      set({ history: { ...get().history, [g.id]: next } });
    },

    undo() {
      const id = get().selectedId;
      if (!id) return;
      const h = get().history[id];
      if (!h || !h.past.length) return;
      const lib = get().library;
      const cur = lib.mechanics.find((m) => m.id === id)!;
      const prev = h.past[h.past.length - 1];
      persistLibrary({ ...lib, mechanics: lib.mechanics.map((m) => (m.id === id ? prev : m)) });
      set({ history: { ...get().history, [id]: { past: h.past.slice(0, -1), future: [cur, ...h.future] } } });
    },

    redo() {
      const id = get().selectedId;
      if (!id) return;
      const h = get().history[id];
      if (!h || !h.future.length) return;
      const lib = get().library;
      const cur = lib.mechanics.find((m) => m.id === id)!;
      const nxt = h.future[0];
      persistLibrary({ ...lib, mechanics: lib.mechanics.map((m) => (m.id === id ? nxt : m)) });
      set({ history: { ...get().history, [id]: { past: [...h.past, cur], future: h.future.slice(1) } } });
    },

    toggleEquip(id) {
      const lib = get().library;
      if (lib.equipped.includes(id)) persistLibrary({ ...lib, equipped: lib.equipped.filter((e) => e !== id) });
      else if (lib.equipped.length < MAX_EQUIPPED) persistLibrary({ ...lib, equipped: [...lib.equipped, id] });
      else {
        synth.uiError();
        return;
      }
      if (!get().workshopOpen) hotReload();
    },

    moveEquip(id, dir) {
      const lib = get().library;
      const i = lib.equipped.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= lib.equipped.length) return;
      const eq = [...lib.equipped];
      [eq[i], eq[j]] = [eq[j], eq[i]];
      persistLibrary({ ...lib, equipped: eq });
    },

    completeLevel(levelId, time) {
      const p = get().progress;
      const before = unlockedTier(p);
      const completed = p.completed.includes(levelId) ? p.completed : [...p.completed, levelId];
      const best = { ...p.best, [levelId]: Math.min(p.best[levelId] ?? Infinity, time) };
      const progress = { ...p, completed, best };
      saveProgress(progress);
      const after = unlockedTier(progress);
      set({ progress, justUnlockedTier: after > before ? after : get().justUnlockedTier });
      if (returnTimer) clearTimeout(returnTimer);
      returnTimer = setTimeout(() => {
        returnTimer = null;
        if (get().screen === 'game' && get().levelId === levelId && !get().workshopOpen) get().enterLevel('hub');
      }, 3200);
    },

    resetProgress() {
      const progress = { completed: [], best: {}, labs: {} };
      saveProgress(progress);
      set({ progress });
    },
  };
});

setRunnerHooks({
  onRequest(req) {
    const s = useApp.getState();
    switch (req.type) {
      case 'door':
        if (req.requires && !s.progress.completed.includes(req.requires)) {
          synth.uiError();
          return;
        }
        if (req.target === 'lab') s.setLabPickerOpen(true);
        else s.enterLevel(req.target);
        break;
      case 'bench':
        s.openWorkshop();
        break;
      case 'restart':
        runner.restart();
        break;
      case 'complete':
        if (modeFor(req.levelId) === 'campaign') s.completeLevel(req.levelId, runner.world.time);
        else if (modeFor(req.levelId) === 'lab')
          s.completeLab(req.levelId, {
            blocks: runner.attach.compiled.reduce((n, c) => n + c.nodes.size, 0),
            energy: runner.world.exchange.totalSpent,
            time: runner.world.time,
          });
        break;
    }
  },
  onWorldChanged(world) {
    const done = useApp.getState().progress.completed;
    for (const e of world.entities) if (e instanceof Door && e.requires) e.locked = !done.includes(e.requires);
  },
});
