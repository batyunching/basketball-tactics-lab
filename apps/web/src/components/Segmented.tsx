import type { ReactNode } from 'react';

interface Option<T extends string | number> {
  value: T;
  label: ReactNode;
  title?: string;
}

interface Props<T extends string | number> {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  testId?: string;
}

/** 大按鈕分段選擇（大屏幕、觸控好按） */
export function Segmented<T extends string | number>({ label, value, options, onChange, disabled, testId }: Props<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'is-on' : ''}
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
