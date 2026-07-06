import { cn } from "@/lib/utils";

const MIN_VISIBLE_BAR = 4;
const GRID_LINES = 4;

type DonutSlice = {
  label: string;
  value: number;
  color: string;
};

type TrendPoint = {
  label: string;
  value: number;
};

export function DonutChart({
  slices,
  size = 148,
  centerLabel
}: {
  slices: DonutSlice[];
  size?: number;
  centerLabel: string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const stops = getDonutStops(slices, total);

  return (
    <div className="flex items-center gap-7">
      <div
        className="relative shrink-0 rounded-full ring-1 ring-inset ring-zinc-800 transition-shadow hover:ring-cyan-500/30"
        style={{ width: size, height: size, background: `conic-gradient(${stops})` }}
      >
        <div className="absolute inset-[23%] rounded-full bg-zinc-950 ring-1 ring-inset ring-zinc-800" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-3xl font-bold tabular-nums tracking-tight text-white">{total}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {centerLabel}
            </div>
          </div>
        </div>
      </div>
      <ul className="flex min-w-36 flex-col gap-2.5 text-xs">
        {slices.map((slice) => (
          <li
            key={slice.label}
            className="group flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-zinc-900"
          >
            <span
              className="size-2.5 shrink-0 rounded-full ring-2 ring-white/[0.08] transition-shadow group-hover:ring-cyan-400/50"
              style={{ background: slice.color }}
            />
            <span className="text-muted-foreground transition-colors group-hover:text-cyan-300">
              {slice.label}
            </span>
            <span className="ml-auto font-semibold tabular-nums">{slice.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarChart({ data }: { data: TrendPoint[] }) {
  const max = Math.max(1, ...data.map((point) => point.value));

  return (
    <div className="relative h-52 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 px-4 pb-3 pt-6 shadow-inner">
      <ChartGrid />
      <div className="relative z-10 flex h-full items-end gap-3">
        {data.map((point, index) => (
          <div key={point.label} className="flex flex-1 flex-col items-center gap-2">
            <span className="text-[10px] font-semibold tabular-nums text-foreground">{point.value}</span>
            <div className="flex h-36 w-full items-end">
              <div
                className={cn(
                  "w-full rounded-t-lg bg-cyan-400 transition-all duration-700 hover:bg-cyan-300 hover:shadow-glow",
                  point.value > 0 && "animate-slide-up"
                )}
                style={{
                  height: `${getBarHeight(point.value, max)}%`,
                  animationDelay: `${index * 40}ms`
                }}
              />
            </div>
            <span className="text-[10px] font-medium text-muted-foreground">{point.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartGrid() {
  return (
    <div className="pointer-events-none absolute inset-x-4 top-6 bottom-9">
      {Array.from({ length: GRID_LINES }).map((_, index) => (
        <span
          key={index}
          className="absolute left-0 w-full border-t border-white/[0.04]"
          style={{ top: `${(index / (GRID_LINES - 1)) * 100}%` }}
        />
      ))}
    </div>
  );
}

function getBarHeight(value: number, max: number) {
  if (value <= 0) return 0;
  return Math.max((value / max) * 100, MIN_VISIBLE_BAR);
}

function getDonutStops(slices: DonutSlice[], total: number) {
  if (total === 0) return "var(--secondary) 0 100%";

  let acc = 0;
  return slices
    .filter((slice) => slice.value > 0)
    .map((slice) => {
      const start = (acc / total) * 100;
      acc += slice.value;
      const end = (acc / total) * 100;
      return `${slice.color} ${start}% ${end}%`;
    })
    .join(", ");
}
