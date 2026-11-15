"use client";

export type ExtractionChartDatum = {
  name: string;
  Baseline?: number;
  AI?: number;
};

export type StatusChartDatum = {
  status: string;
  count: number;
};

const WIDTH = 640;
const GRID = "var(--line)";
const MUTED = "var(--muted)";
const BASELINE = "#9abbb5";
const ACCENT = "#0f766e";

function EmptyChart() {
  return (
    <div className="chart-loading" role="status">
      No chart data available.
    </div>
  );
}

export function ExtractionChart({
  data,
}: {
  data: ExtractionChartDatum[];
}) {
  if (data.length === 0) return <EmptyChart />;

  const height = 260;
  const left = 42;
  const right = 12;
  const top = 12;
  const bottom = 42;
  const plotWidth = WIDTH - left - right;
  const plotHeight = height - top - bottom;
  const band = plotWidth / data.length;
  const series = [
    { key: "Baseline" as const, label: "Baseline", color: BASELINE },
    { key: "AI" as const, label: "AI", color: ACCENT },
  ];
  const barWidth = Math.min(24, band * 0.26);
  const gap = 4;

  return (
    <div className="chart-visual">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Extraction performance percentages for baseline and AI"
      >
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = top + plotHeight * (1 - tick / 100);
          return (
            <g key={tick}>
              <line x1={left} x2={WIDTH - right} y1={y} y2={y} stroke={GRID} />
              <text x={left - 8} y={y + 4} textAnchor="end" fill={MUTED}>
                {tick}%
              </text>
            </g>
          );
        })}
        {data.map((row, index) => {
          const center = left + band * (index + 0.5);
          const groupWidth = barWidth * series.length + gap;
          return (
            <g key={row.name}>
              {series.map((item, seriesIndex) => {
                const value = Math.max(0, Math.min(100, row[item.key] ?? 0));
                const barHeight = (value / 100) * plotHeight;
                const x = center - groupWidth / 2 + seriesIndex * (barWidth + gap);
                const y = top + plotHeight - barHeight;
                return (
                  <rect
                    key={item.key}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    rx={4}
                    fill={item.color}
                  >
                    <title>{`${row.name} ${item.label}: ${value}%`}</title>
                  </rect>
                );
              })}
              <text
                x={center}
                y={height - 14}
                textAnchor="middle"
                fill={MUTED}
              >
                {row.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend" aria-hidden="true">
        {series.map((item) => (
          <span key={item.key}>
            <i style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ConsultationStatusChart({
  data,
}: {
  data: StatusChartDatum[];
}) {
  if (data.length === 0) return <EmptyChart />;

  const height = 300;
  const left = 42;
  const right = 12;
  const top = 14;
  const bottom = 52;
  const plotWidth = WIDTH - left - right;
  const plotHeight = height - top - bottom;
  const maxCount = Math.max(1, ...data.map((row) => row.count));
  const maxValue = Math.ceil(maxCount / 4) * 4;
  const band = plotWidth / data.length;
  const barWidth = Math.min(48, band * 0.52);

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${WIDTH} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Consultation counts by status"
    >
      {Array.from({ length: 5 }, (_, index) => {
        const tick = (maxValue * index) / 4;
        const y = top + plotHeight * (1 - index / 4);
        return (
          <g key={index}>
            <line x1={left} x2={WIDTH - right} y1={y} y2={y} stroke={GRID} />
            <text x={left - 8} y={y + 4} textAnchor="end" fill={MUTED}>
              {tick}
            </text>
          </g>
        );
      })}
      {data.map((row, index) => {
        const value = Math.max(0, row.count);
        const barHeight = (value / maxValue) * plotHeight;
        const center = left + band * (index + 0.5);
        return (
          <g key={row.status}>
            <rect
              x={center - barWidth / 2}
              y={top + plotHeight - barHeight}
              width={barWidth}
              height={barHeight}
              rx={5}
              fill={ACCENT}
            >
              <title>{`${row.status}: ${value}`}</title>
            </rect>
            <text
              x={center}
              y={height - 18}
              textAnchor="middle"
              fill={MUTED}
            >
              {row.status}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
