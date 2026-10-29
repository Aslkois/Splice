import { getPrimitive } from '../mechanics/registry';
import { LABS } from '../sim/levels/labs';
import { useApp } from '../store/store';

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** The Challenge Lab door opens onto this list of short, constrained puzzles. */
export function LabPicker() {
  const labs = useApp((s) => s.progress.labs);
  const last = useApp((s) => s.lastLabResult);
  const enterLevel = useApp((s) => s.enterLevel);
  const close = () => useApp.getState().setLabPickerOpen(false);
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="lab-title" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="panel lab-panel">
        <h2 id="lab-title">Challenge Lab</h2>
        <p>Short rooms, a fixed parts list and a block budget. Everything you have plugged in must fit the rules. Fewer blocks beat less energy beats a faster time.</p>
        {last && (
          <p className="lab-last">
            {LABS.find((l) => l.id === last.id)?.name}: solved with {last.score.blocks} blocks, {fmt(last.score.energy)} E spent, {fmt(last.score.time)} s
            {last.best ? '. New best.' : '.'}
          </p>
        )}
        <ul className="lab-list">
          {LABS.map((lab) => {
            const best = labs[lab.id];
            return (
              <li key={lab.id} className="lab">
                <div className="lab-head">
                  <h3>{lab.name}</h3>
                  <span className="lab-budget">{lab.maxBlocks} blocks</span>
                </div>
                <p>{lab.brief}</p>
                <div className="lab-parts" aria-label="Allowed parts">
                  {lab.parts.map((t) => {
                    const def = getPrimitive(t);
                    return (
                      <span key={t} className={`part cat-${def?.category ?? 'data'} mini`}>
                        {def?.label ?? t}
                      </span>
                    );
                  })}
                </div>
                <div className="lab-foot">
                  <span>{best ? `Best: ${best.blocks} blocks, ${fmt(best.energy)} E, ${fmt(best.time)} s` : 'Not solved yet'}</span>
                  <button className="btn go small" onClick={() => enterLevel(lab.id)}>
                    Enter
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <button className="btn quiet" onClick={close}>
          Back to the workshop
        </button>
      </div>
    </div>
  );
}
