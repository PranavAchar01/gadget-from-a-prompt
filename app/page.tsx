"use client";

import { useRef, useState } from "react";
import { Diagram } from "@/components/Diagram";
import type { BuildEvent, Candidate, Check, PartCard, Role, Spec, SpecValue, WireRow } from "@/lib/types";

const EXAMPLES = [
  "a desk plant monitor that beeps when the soil is dry",
  "a door greeter that lights up when someone walks past",
  "a pocket weather station with a little screen",
];

const STEPS = [
  { endpoint: "fill", name: "Fill", job: "idea to device spec" },
  { endpoint: "rerank", name: "Rerank", job: "best real part per role" },
  { endpoint: "extract", name: "Extract", job: "specs off each datasheet" },
  { endpoint: "grounding", name: "Verify", job: "design checked against datasheets" },
];

const ROLE_LABEL: Record<Role, string> = {
  mcu: "Brain",
  soil_moisture: "Soil moisture",
  temp_humidity: "Temp + humidity",
  light: "Light",
  motion: "Motion",
  distance: "Distance",
  accelerometer: "Tilt",
  microphone: "Microphone",
  button: "Button",
  buzzer: "Beeper",
  display: "Screen",
  led: "Light",
  servo: "Motor",
  charger: "Charger",
  battery: "Battery",
};

type Row = { role: Role; part: PartCard; score: number; candidates: Candidate[]; values?: SpecValue[]; rail?: string };

export default function Home() {
  const [prompt, setPrompt] = useState(EXAMPLES[0]);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [spec, setSpec] = useState<Spec | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [wiring, setWiring] = useState<WireRow[]>([]);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [summary, setSummary] = useState<{ total: number; calls: number; ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  async function build() {
    setRunning(true);
    setStep(null);
    setDone(new Set());
    setSpec(null);
    setRows([]);
    setWiring([]);
    setChecks(null);
    setSummary(null);
    setError(null);

    const res = await fetch("/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok || !res.body) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "The build did not start.");
      setRunning(false);
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let current: string | null = null;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const e = JSON.parse(line) as BuildEvent;
        if (e.type === "stage") {
          const prev = current;
          if (prev) setDone((d) => new Set(d).add(prev));
          current = e.endpoint;
          setStep(e.endpoint);
        } else if (e.type === "spec") {
          setSpec(e.spec);
        } else if (e.type === "part") {
          setRows((r) => [...r, { role: e.role, part: e.part, score: e.score, candidates: e.candidates }]);
        } else if (e.type === "specs") {
          setRows((r) => r.map((x) => (x.part.id === e.partId ? { ...x, values: e.values, rail: e.rail } : x)));
        } else if (e.type === "wiring") {
          setWiring(e.rows);
        } else if (e.type === "checks") {
          setChecks(e.checks);
        } else if (e.type === "done") {
          if (current) setDone((d) => new Set(d).add(current as string));
          setStep(null);
          setSummary({ total: e.total, calls: e.calls, ms: e.ms });
        } else if (e.type === "error") {
          setError(e.message);
        }
      }
    }
    setRunning(false);
  }

  const total = rows.reduce((s, r) => s + r.part.price_usd, 0);
  const passed = checks?.filter((c) => c.verdict === "pass").length ?? 0;

  return (
    <main className="mx-auto max-w-[1180px] px-4 sm:px-6 pb-24">
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="font-semibold tracking-tight">Gadget from a Prompt</span>
        </div>
        <span className="text-xs text-muted font-mono">every step runs on Clocked</span>
      </header>

      <section className="mt-6 sm:mt-10">
        <h1 className="text-3xl sm:text-[44px] leading-[1.05] font-semibold tracking-tight max-w-3xl">
          Describe a gadget. Get a parts list you can actually buy and wire.
        </h1>
        <p className="mt-3 text-muted max-w-2xl">
          Real parts from real catalogs, specs read off their datasheets, and every design claim checked against the
          datasheet it came from.
        </p>
        <form
          className="mt-6 flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!running) build();
          }}
        >
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="flex-1 rounded-xl border border-line bg-panel px-4 py-3.5 text-lg outline-none focus:border-ink"
            placeholder="a desk plant monitor that beeps when the soil is dry"
            aria-label="Describe your gadget"
          />
          <button
            disabled={running}
            className="rounded-xl bg-ink text-panel px-6 py-3.5 font-medium disabled:opacity-60 cursor-pointer"
          >
            {running ? "Building…" : "Build it"}
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((x) => (
            <button
              key={x}
              onClick={() => setPrompt(x)}
              className="text-sm rounded-full border border-line px-3 py-1 text-muted hover:text-ink cursor-pointer"
            >
              {x}
            </button>
          ))}
        </div>
      </section>

      <ol className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-2">
        {STEPS.map((s, i) => {
          const state = done.has(s.endpoint) ? "done" : step === s.endpoint ? "live" : "idle";
          return (
            <li
              key={s.endpoint}
              className={`rounded-xl border px-4 py-3 transition-colors ${
                state === "live" ? "border-ink bg-panel" : state === "done" ? "border-accent bg-accent-soft" : "border-line"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted">
                  {i + 1} · /{s.endpoint}
                </span>
                {state === "live" && <span className="h-2 w-2 rounded-full bg-ink animate-pulse" />}
                {state === "done" && <span className="text-accent text-sm">✓</span>}
              </div>
              <div className="mt-1 font-medium">Clocked {s.name}</div>
              <div className="text-sm text-muted">{s.job}</div>
            </li>
          );
        })}
      </ol>

      {error && <p className="mt-6 rounded-xl bg-warn-soft text-warn px-4 py-3">{error}</p>}

      <div ref={resultsRef} className="mt-8 grid lg:grid-cols-[1.05fr_1fr] gap-6 items-start">
        <div className="space-y-6">
          {spec && (
            <Card title="Device spec" tag="Fill">
              <div className="text-xl font-semibold capitalize">{spec.name}</div>
              <p className="text-muted mt-1">{spec.does}</p>
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <Field k="Senses" v={spec.senses.join(", ").replaceAll("_", " ") || "nothing"} c={spec.confidence.senses} />
                <Field k="Outputs" v={spec.outputs.join(", ") || "none"} c={spec.confidence.outputs} />
                <Field k="Power" v={spec.power === "usb" ? "USB" : "LiPo battery"} c={spec.confidence.power} />
                <Field k="Wireless" v={spec.wireless} c={spec.confidence.wireless} />
              </dl>
            </Card>
          )}

          {rows.length > 0 && (
            <Card title="Parts" tag="Rerank + Extract">
              <ul className="divide-y divide-line">
                {rows.map((r) => (
                  <li key={r.part.id} className="py-3 fade-in">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-wide text-muted">{ROLE_LABEL[r.role]}</div>
                        <a href={r.part.price_url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                          {r.part.name}
                        </a>
                        <div className="font-mono text-xs text-muted truncate">
                          {r.part.manufacturer} {r.part.mpn} · {r.part.vendor} {r.part.vendor_sku}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono">${r.part.price_usd.toFixed(2)}</div>
                        {r.part.pack && <div className="text-xs text-muted">pack of {r.part.pack}</div>}
                        <div className="text-xs text-muted font-mono">fit {(r.score * 100).toFixed(0)}%</div>
                      </div>
                    </div>
                    {r.candidates.length > 1 && (
                      <div className="mt-1.5 text-xs text-muted">
                        beat{" "}
                        {r.candidates
                          .slice(1)
                          .map((c) => `${c.name} (${(c.score * 100).toFixed(0)}%)`)
                          .join(", ")}
                      </div>
                    )}
                    {r.values && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.values
                          .filter((v) => v.value !== "not stated")
                          .map((v) => (
                            <span
                              key={v.label}
                              title={v.quote ?? undefined}
                              className="rounded-md bg-bg border border-line px-2 py-0.5 text-xs font-mono"
                            >
                              {v.label}: {v.value.length > 42 ? v.value.slice(0, 41) + "…" : v.value}
                            </span>
                          ))}
                        {r.rail && r.role !== "mcu" && (
                          <span className="rounded-md bg-accent-soft text-accent px-2 py-0.5 text-xs font-mono">on {r.rail}</span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-baseline justify-between border-t border-ink pt-3">
                <span className="font-medium">Total</span>
                <span className="font-mono text-xl">${total.toFixed(2)}</span>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {wiring.length > 0 && (
            <Card title="Block diagram" tag="drawn from the wiring">
              <Diagram parts={rows.map((r) => r.part)} rows={wiring} />
            </Card>
          )}

          {checks && (
            <Card title={`Checks · ${passed} of ${checks.length} pass`} tag="Verify">
              <ul className="space-y-2.5">
                {checks.map((c, i) => (
                  <li key={i} className="fade-in flex gap-3">
                    <span
                      className={`mt-0.5 h-5 shrink-0 rounded px-1.5 text-[11px] font-mono leading-5 ${
                        c.verdict === "pass"
                          ? "bg-accent-soft text-accent"
                          : c.verdict === "flag"
                            ? "bg-warn-soft text-warn"
                            : "bg-bg text-muted border border-line"
                      }`}
                    >
                      {c.verdict === "pass" ? "PASS" : c.verdict === "flag" ? "FLAG" : "OPEN"}
                    </span>
                    <div className="min-w-0 text-sm">
                      <div>{c.claim}</div>
                      {c.quote && (
                        <div className="mt-0.5 text-xs text-muted font-mono">
                          “{c.quote.length > 140 ? c.quote.slice(0, 139) + "…" : c.quote}”
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {wiring.length > 0 && (
            <Card title="Wiring" tag="pin to pin">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="font-normal pb-1.5">Part</th>
                    <th className="font-normal pb-1.5">Pin</th>
                    <th className="font-normal pb-1.5">Goes to</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-xs">
                  {wiring.map((w, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="py-1.5 pr-2 font-sans text-sm">{w.part}</td>
                      <td className="py-1.5 pr-2">{w.pin}</td>
                      <td className="py-1.5">
                        {w.to} <span className="text-muted">· {w.net}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>

      {summary && (
        <p className="mt-8 text-sm text-muted font-mono">
          {summary.calls} Clocked calls · {(summary.ms / 1000).toFixed(1)} s · ${summary.total.toFixed(2)} in parts
        </p>
      )}

      <footer className="mt-16 text-xs text-muted">
        Part data from Adafruit, SparkFun, DFRobot, Seeed and the makers' datasheets. Prices are vendor list prices
        checked November 5, 2026.{" "}
        <a className="underline" href="https://github.com/PranavAchar01/gadget-from-a-prompt">
          Source
        </a>
      </footer>
    </main>
  );
}

function Card({ title, tag, children }: { title: string; tag: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 fade-in">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        <span className="font-mono text-[11px] text-muted">{tag}</span>
      </div>
      {children}
    </section>
  );
}

function Field({ k, v, c }: { k: string; v: string; c?: number }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="capitalize">
        {v}
        {c !== undefined && <span className="ml-1.5 font-mono text-xs text-muted normal-case">{(c * 100).toFixed(0)}%</span>}
      </dd>
    </div>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <rect x="5" y="5" width="12" height="12" rx="2" fill="var(--ink)" />
      {[7, 11, 15].map((p) => (
        <g key={p} stroke="var(--ink)" strokeWidth="1.5">
          <line x1={p} y1="1" x2={p} y2="5" />
          <line x1={p} y1="17" x2={p} y2="21" />
          <line x1="1" y1={p} x2="5" y2={p} />
          <line x1="17" y1={p} x2="21" y2={p} />
        </g>
      ))}
    </svg>
  );
}
