import type { PartCard, WireRow } from "@/lib/types";

const INPUTS = new Set(["soil_moisture", "temp_humidity", "light", "motion", "distance", "accelerometer", "microphone", "button"]);

// A block diagram drawn from the wiring table: inputs on the left, outputs on the
// right, power underneath, every signal line labelled with the board pin it lands on.
export function Diagram({ parts, rows }: { parts: PartCard[]; rows: WireRow[] }) {
  const mcu = parts.find((p) => p.role === "mcu");
  if (!mcu) return null;
  const left = parts.filter((p) => INPUTS.has(p.role));
  const right = parts.filter((p) => p.role !== "mcu" && !INPUTS.has(p.role) && p.role !== "charger" && p.role !== "battery");
  const power = parts.filter((p) => p.role === "charger" || p.role === "battery");

  const W = 760;
  const boxW = 190;
  const boxH = 54;
  const rowsCount = Math.max(left.length, right.length, 1);
  const H = Math.max(240, rowsCount * 84 + 60) + (power.length ? 110 : 0);
  const midY = (H - (power.length ? 110 : 0)) / 2;
  const mcuX = W / 2 - 95;
  const mcuH = Math.max(110, rowsCount * 60);
  const mcuY = midY - mcuH / 2;

  const signals = (name: string) =>
    rows.filter((r) => r.part === name && r.net !== "power" && r.net !== "ground").map((r) => r.to);
  const ys = (n: number) => Array.from({ length: n }, (_, i) => midY + (i - (n - 1) / 2) * 84);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Block diagram of the gadget">
      <defs>
        <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M16 0H0V16" fill="none" stroke="var(--grid)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />

      {left.map((p, i) => {
        const y = ys(left.length)[i];
        const pins = signals(p.name);
        return (
          <g key={p.id} className="fade-in">
            <path d={`M${24 + boxW} ${y} C ${mcuX - 60} ${y}, ${mcuX - 60} ${y}, ${mcuX} ${y * 0.4 + midY * 0.6}`} className="wire" />
            <text x={(24 + boxW + mcuX) / 2} y={y - 8} className="pin-label" textAnchor="middle">
              {pins.join(" · ") || "I/O"}
            </text>
            <Block x={24} y={y - boxH / 2} w={boxW} h={boxH} title={p.name} sub={p.mpn} />
          </g>
        );
      })}

      {right.map((p, i) => {
        const y = ys(right.length)[i];
        const pins = signals(p.name);
        const x = W - 24 - boxW;
        return (
          <g key={p.id} className="fade-in">
            <path d={`M${mcuX + 190} ${y * 0.4 + midY * 0.6} C ${x + 40} ${y}, ${x + 40} ${y}, ${x} ${y}`} className="wire" />
            <text x={(mcuX + 190 + x) / 2} y={y - 8} className="pin-label" textAnchor="middle">
              {pins.join(" · ") || "I/O"}
            </text>
            <Block x={x} y={y - boxH / 2} w={boxW} h={boxH} title={p.name} sub={p.mpn} />
          </g>
        );
      })}

      <g>
        <rect x={mcuX} y={mcuY} width={190} height={mcuH} rx={10} className="mcu-box" />
        <text x={mcuX + 95} y={midY - 6} textAnchor="middle" className="mcu-title">
          {mcu.name}
        </text>
        <text x={mcuX + 95} y={midY + 14} textAnchor="middle" className="block-sub">
          {mcu.mpn}
        </text>
      </g>

      {power.map((p, i) => {
        const x = W / 2 - (power.length * 210) / 2 + i * 210 + 10;
        const y = H - 80;
        return (
          <g key={p.id} className="fade-in">
            <path d={`M${x + boxW / 2} ${y} L${x + boxW / 2} ${mcuY + mcuH + 8}`} className="wire power" />
            <Block x={x} y={y} w={boxW} h={boxH} title={p.name} sub={p.mpn} />
          </g>
        );
      })}
    </svg>
  );
}

function Block({ x, y, w, h, title, sub }: { x: number; y: number; w: number; h: number; title: string; sub: string }) {
  const t = title.length > 26 ? title.slice(0, 25) + "…" : title;
  const s = sub.length > 28 ? sub.slice(0, 27) + "…" : sub;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} className="block" />
      <text x={x + 12} y={y + 22} className="block-title">
        {t}
      </text>
      <text x={x + 12} y={y + 40} className="block-sub">
        {s}
      </text>
    </g>
  );
}
