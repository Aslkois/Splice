import { useEffect, useState } from 'react';

/** Numeric field that commits on blur / Enter, so typing doesn't flood the undo history. */
export function NumField({ value, onCommit, step = 1, label, min, max }: { value: number; onCommit: (v: number) => void; step?: number; label: string; min?: number; max?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (text.trim() === '' || !Number.isFinite(v)) {
      setText(String(value));
      return;
    }
    if (v !== value) onCommit(v);
  };
  return (
    <input
      className="nodrag num"
      type="number"
      aria-label={label}
      value={text}
      step={step}
      min={min}
      max={max}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}

export function TextField({ value, onCommit, label, className = '' }: { value: string; onCommit: (v: string) => void; label: string; className?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className={`nodrag text ${className}`}
      aria-label={label}
      value={text}
      maxLength={40}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}
