import { getPrimitive } from '../../mechanics/registry';
import { ARTICLE_BY_ID } from '../../docs/articles';
import { EXAMPLE_BY_ID } from '../../docs/examples';
import { parseMarkup, type Inline, type MBlock } from '../../docs/markup';
import type { DocRoute } from '../../store/store';

function InlineView({ xs, go }: { xs: Inline[]; go: (r: DocRoute) => void }) {
  return (
    <>
      {xs.map((x, i) => {
        if (x.t === 'text') return <span key={i}>{x.v}</span>;
        if (x.t === 'b') return <strong key={i}>{x.v}</strong>;
        if (x.t === 'code') return <code key={i}>{x.v}</code>;
        const label =
          x.kind === 'block' ? (getPrimitive(x.id)?.label ?? x.id) : x.kind === 'article' ? (ARTICLE_BY_ID[x.id]?.title ?? x.id) : (EXAMPLE_BY_ID[x.id]?.title ?? x.id);
        const route: DocRoute = x.kind === 'block' ? { kind: 'block', type: x.id } : x.kind === 'article' ? { kind: 'article', id: x.id } : { kind: 'example', id: x.id };
        return (
          <button key={i} type="button" className={`doc-link k-${x.kind}`} onClick={() => go(route)}>
            {label}
          </button>
        );
      })}
    </>
  );
}

export function Markup({ src, go }: { src: string; go: (r: DocRoute) => void }) {
  const blocks: MBlock[] = parseMarkup(src);
  return (
    <div className="doc-body">
      {blocks.map((b, i) => {
        if (b.t === 'h') {
          const H = (`h${b.level + 1}` as 'h2' | 'h3' | 'h4');
          return (
            <H key={i}>
              <InlineView xs={b.text} go={go} />
            </H>
          );
        }
        if (b.t === 'p')
          return (
            <p key={i}>
              <InlineView xs={b.text} go={go} />
            </p>
          );
        if (b.t === 'ul')
          return (
            <ul key={i}>
              {b.items.map((it, k) => (
                <li key={k}>
                  <InlineView xs={it} go={go} />
                </li>
              ))}
            </ul>
          );
        return (
          <div className="doc-table" key={i}>
            <table>
              <thead>
                <tr>
                  {b.head.map((c, k) => (
                    <th key={k}>
                      <InlineView xs={c} go={go} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, k) => (
                  <tr key={k}>
                    {r.map((c, j) => (
                      <td key={j}>
                        <InlineView xs={c} go={go} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
