import { fillNumbers } from './numbers';

/**
 * The docs' tiny markup: # / ## / ### headings, "- " list items, | tables |, blank-line paragraphs,
 * and inline **bold**, `code`, [[block:x]] / [[article:x]] / [[example:x]] links. Parsed into a tree
 * so React can render it safely (no HTML strings).
 */
export type Inline = { t: 'text'; v: string } | { t: 'b'; v: string } | { t: 'code'; v: string } | { t: 'link'; kind: 'block' | 'article' | 'example'; id: string };
export type MBlock =
  | { t: 'h'; level: 1 | 2 | 3; text: Inline[] }
  | { t: 'p'; text: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] };

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`|\[\[(block|article|example):([\w.-]+)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) });
    if (m[1] != null) out.push({ t: 'b', v: m[1] });
    else if (m[2] != null) out.push({ t: 'code', v: m[2] });
    else out.push({ t: 'link', kind: m[3] as 'block' | 'article' | 'example', id: m[4] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out;
}

export function parseMarkup(src: string): MBlock[] {
  const text = fillNumbers(src);
  const lines = text.split('\n');
  const blocks: MBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', text: parseInline(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^(#{1,3}) (.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ t: 'h', level: h[1].length as 1 | 2 | 3, text: parseInline(h[2]) });
      continue;
    }
    if (line.startsWith('- ')) {
      flush();
      const items: Inline[][] = [];
      while (i < lines.length && lines[i].startsWith('- ')) items.push(parseInline(lines[i++].slice(2)));
      i--;
      blocks.push({ t: 'ul', items });
      continue;
    }
    if (line.startsWith('|')) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i++].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells);
      }
      i--;
      const [head, ...body] = rows;
      blocks.push({ t: 'table', head: head.map(parseInline), rows: body.map((r) => r.map(parseInline)) });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

export function linksIn(blocks: MBlock[]): { kind: string; id: string }[] {
  const out: { kind: string; id: string }[] = [];
  const walk = (xs: Inline[]) => xs.forEach((x) => x.t === 'link' && out.push({ kind: x.kind, id: x.id }));
  for (const b of blocks) {
    if (b.t === 'h' || b.t === 'p') walk(b.text);
    else if (b.t === 'ul') b.items.forEach(walk);
    else {
      b.head.forEach(walk);
      b.rows.forEach((r) => r.forEach(walk));
    }
  }
  return out;
}
