/**
 * Single-series HTML charts (server-rendered). Marks use --chart-1, text uses ink tokens,
 * every chart has a table twin. See the dataviz rules in DESIGN.md.
 */
import { cx } from '@/lib/format';

export function ChartFrame({
  id,
  title,
  subtitle,
  children,
  table,
}: {
  id: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  table: { head: string[]; rows: Array<Array<string | number>> };
}) {
  return (
    <figure aria-labelledby={`${id}-t`} className="border-t border-rule pt-5">
      <figcaption>
        <h3 id={`${id}-t`} className="font-sans text-[1.05rem] font-semibold tracking-normal text-ink">
          {title}
        </h3>
        {subtitle && <p className="mt-0.5 text-[0.9rem] text-ink-2">{subtitle}</p>}
      </figcaption>
      <div className="mt-5" aria-hidden="true">
        {children}
      </div>
      <details className="group mt-3">
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center text-[0.88rem] text-ink-2 underline decoration-ink/25 underline-offset-4 hover:text-ink [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show as a table</span>
          <span className="hidden group-open:inline">Hide table</span>
        </summary>
        <table className="mt-2 w-full text-[0.9rem]">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-rule text-left text-ink-3">
              {table.head.map((h, i) => (
                <th key={h} scope="col" className={cx('py-1.5 font-medium', i > 0 && 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={String(r[0])} className="border-b border-rule/60">
                {r.map((c, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="py-1.5 text-left font-normal text-ink">
                      {c}
                    </th>
                  ) : (
                    <td key={i} className="py-1.5 text-right tabular text-ink">
                      {c}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {/* screen readers get the table directly */}
      <div className="sr-only">
      <table>
        <caption>{title}</caption>
        <thead>
          <tr>
            {table.head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={String(r[0])}>
              {r.map((c, i) => (i === 0 ? <th key={i} scope="row">{c}</th> : <td key={i}>{c}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}

/** Columns from a shared baseline; value on the cap; one emphasized column. */
export function Columns({ data, emphasize }: { data: Array<{ label: string; value: number; hint: string }>; emphasize?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2">
      <div className="relative h-48 text-right text-[0.75rem] tabular text-ink-3">
        {ticks.map((t) => (
          <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: `${(t / top) * 100}%` }}>
            {t}
          </span>
        ))}
      </div>
      <div>
        <div className="relative h-48 border-b border-rule-strong">
          {ticks.slice(1).map((t) => (
            <span key={t} className="absolute inset-x-0 border-t border-rule" style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0,1fr))` }}>
            {data.map((d, i) => (
              <div key={d.label} className="group relative flex flex-col items-center justify-end" title={d.hint}>
                <span className={cx('mb-1 text-[0.8rem] tabular', i === emphasize ? 'font-semibold text-ink' : 'text-ink-2')}>{d.value || ''}</span>
                <span
                  className={cx('w-full max-w-6 rounded-t-[4px] transition-opacity', i === emphasize ? 'bg-chart-1' : 'bg-chart-1/55', 'group-hover:opacity-80')}
                  style={{ height: `${(d.value / top) * 100}%`, minHeight: d.value ? 2 : 0 }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 grid" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0,1fr))` }}>
          {data.map((d) => (
            <span key={d.label} className="px-0.5 text-center text-[0.75rem] leading-tight text-ink-2">
              {d.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Horizontal bars with the value at the tip. */
export function Bars({ data }: { data: Array<{ label: string; value: number; display: string; note?: string }> }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(7rem,9.5rem)_minmax(0,1fr)] items-center gap-3" title={`${d.label}: ${d.display}${d.note ? ` · ${d.note}` : ''}`}>
          <span className="truncate text-[0.92rem] text-ink">{d.label}</span>
          <span className="flex items-center gap-2">
            <span className="h-5 rounded-r-[4px] bg-chart-1" style={{ width: `${Math.max(1, (d.value / max) * 72)}%` }} />
            <span className="shrink-0 text-[0.85rem] tabular text-ink">
              {d.display}
              {d.note && <span className="text-ink-3"> · {d.note}</span>}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Dot plot on a shared axis with a reference line (overall median). */
export function Dots({
  data,
  reference,
  unit,
}: {
  data: Array<{ label: string; value: number; right: string }>;
  reference: { value: number; label: string };
  unit: string;
}) {
  const top = Math.max(3, Math.ceil(Math.max(reference.value, ...data.map((d) => d.value)) + 0.5));
  const pct = (v: number) => `${(v / top) * 100}%`;
  return (
    <div>
      <div className="grid grid-cols-[minmax(7rem,9.5rem)_minmax(0,1fr)_4.5rem] items-end gap-3 pb-1 text-[0.75rem] text-ink-3">
        <span />
        <span className="relative h-4">
          <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(reference.value) }}>
            {reference.label}
          </span>
        </span>
        <span className="text-right">Approved</span>
      </div>
      <ul>
        {data.map((d) => (
          <li key={d.label} className="grid grid-cols-[minmax(7rem,9.5rem)_minmax(0,1fr)_4.5rem] items-center gap-3 py-1.5" title={`${d.label}: ${d.value} ${unit}`}>
            <span className="truncate text-[0.92rem] text-ink">{d.label}</span>
            <span className="relative h-6">
              <span className="absolute inset-x-0 top-1/2 border-t border-rule" />
              <span className="absolute bottom-0 top-0 border-l border-ink-3" style={{ left: pct(reference.value) }} />
              <span
                className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chart-1 ring-2 ring-paper"
                style={{ left: pct(d.value) }}
              />
            </span>
            <span className="text-right text-[0.85rem] tabular text-ink">{d.right}</span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-[minmax(7rem,9.5rem)_minmax(0,1fr)_4.5rem] gap-3 text-[0.75rem] tabular text-ink-3">
        <span />
        <span className="flex justify-between border-t border-rule-strong pt-1">
          {Array.from({ length: top + 1 }, (_, i) => (
            <span key={i}>{i}</span>
          ))}
        </span>
        <span />
      </div>
      <p className="mt-1 text-center text-[0.75rem] text-ink-3">{unit}</p>
    </div>
  );
}

function niceTicks(max: number): number[] {
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : 20;
  const out: number[] = [];
  for (let v = 0; v <= max + step - 1; v += step) out.push(v);
  return out;
}
