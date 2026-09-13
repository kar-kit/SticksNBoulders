interface Point {
  date: string;
  estimatedKg: number;
}

export default function OneRepMaxChart({ points }: { points: Point[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted">
        Log a few more sessions to see a trend line.
      </div>
    );
  }

  const width = 320;
  const height = 120;
  const padding = 8;

  const values = points.map((p) => p.estimatedKg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = padding + (i / (points.length - 1)) * (width - padding * 2);
    const y = height - padding - ((p.estimatedKg - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full">
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {coords.map((c, i) => {
        const [x, y] = c.split(",");
        return <circle key={points[i].date} cx={x} cy={y} r="2.5" fill="var(--accent)" />;
      })}
    </svg>
  );
}
