import type { ReactNode } from 'react';

export function Section({ title, en, children, actions }: { title: string; en?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel-section">
      <header>
        <h2>
          {title}
          {en && <small>{en}</small>}
        </h2>
        {actions}
      </header>
      {children}
    </section>
  );
}
