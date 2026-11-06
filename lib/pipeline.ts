import catalogJson from "@/data/catalog.json";
import {
  callClocked,
  type ExtractResponse,
  type FillResponse,
  type GroundingResponse,
  type RerankResponse,
} from "@/lib/clocked";
import type { BuildEvent, Candidate, Check, McuPins, Part, Role, Spec, SpecValue, WireRow } from "@/lib/types";

const catalog = catalogJson as Part[];

const SENSE_ROLES: Record<string, Role> = {
  soil_moisture: "soil_moisture",
  temp_humidity: "temp_humidity",
  light: "light",
  motion: "motion",
  distance: "distance",
  acceleration: "accelerometer",
  sound: "microphone",
  button_press: "button",
};
const OUTPUT_ROLES: Record<string, Role> = { buzzer: "buzzer", display: "display", led: "led", servo: "servo" };

const ROLE_JOB: Record<Role, string> = {
  mcu: "the microcontroller board that runs the device",
  soil_moisture: "the soil moisture sensor",
  temp_humidity: "the temperature and humidity sensor",
  light: "the light sensor",
  motion: "the motion sensor",
  distance: "the distance sensor",
  accelerometer: "the motion and tilt (accelerometer) sensor",
  microphone: "the microphone",
  button: "the push button",
  buzzer: "the part that beeps",
  display: "the screen",
  led: "the status light",
  servo: "the small motor that moves something",
  charger: "the battery charger",
  battery: "the rechargeable battery",
};

type Emit = (e: BuildEvent) => void;

export async function buildGadget(prompt: string, emit: Emit) {
  const started = Date.now();
  let calls = 0;
  const clocked = <T,>(endpoint: string, payload: unknown) => {
    calls++;
    return callClocked<T>(endpoint, payload);
  };

  // 1. Fill: one sentence in, a typed device spec out.
  emit({ type: "stage", stage: "Reading your idea", endpoint: "fill" });
  const fill = await clocked<FillResponse>("fill", {
    text: prompt,
    instructions:
      "The text is a one-line idea for a small electronic gadget that a hobbyist will build at a desk. " +
      "Fill in the device spec. Select only what the idea needs; a microcontroller is always added separately. " +
      "Choose battery power only when the idea says it is portable, wearable, outdoors or away from a plug.",
    fields: {
      device_name: { type: "generate", description: "A short plain name for the device, 2 to 5 words", max_tokens: 16 },
      what_it_does: { type: "generate", description: "One plain sentence on what the device does", max_tokens: 40 },
      senses: {
        type: "multiselect",
        description: "What the device must measure or detect",
        options: Object.keys(SENSE_ROLES),
        threshold: 0.5,
      },
      outputs: {
        type: "multiselect",
        description: "How the device acts on it or tells the person",
        options: Object.keys(OUTPUT_ROLES),
        threshold: 0.5,
      },
      power: { type: "choice", description: "Best power source", options: ["usb", "lipo_battery"] },
      wireless: { type: "choice", description: "Does it need a wireless link", options: ["none", "wifi", "bluetooth"] },
    },
  });
  const f = fill.fields;
  const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
  const spec: Spec = {
    name: String(f.device_name?.value ?? "Your gadget"),
    does: String(f.what_it_does?.value ?? prompt),
    senses: list(f.senses?.value),
    outputs: list(f.outputs?.value),
    power: String(f.power?.value ?? "usb"),
    wireless: String(f.wireless?.value ?? "none"),
    confidence: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.confidence ?? 0])),
  };
  emit({ type: "spec", spec });

  const roles: Role[] = [
    "mcu",
    ...spec.senses.map((s) => SENSE_ROLES[s]).filter(Boolean),
    ...spec.outputs.map((o) => OUTPUT_ROLES[o]).filter(Boolean),
    ...(spec.power === "lipo_battery" ? (["charger", "battery"] as Role[]) : []),
  ];

  // 2. Rerank: every catalog candidate for a role is read against this device's needs.
  emit({ type: "stage", stage: "Picking real parts", endpoint: "rerank" });
  const chosen: Part[] = [];
  const need =
    `Device: ${spec.name}. ${spec.does} Power: ${spec.power === "usb" ? "USB cable" : "rechargeable LiPo battery"}. ` +
    `Wireless: ${spec.wireless}. It also uses: ${roles.filter((r) => r !== "mcu").map((r) => ROLE_JOB[r]).join(", ") || "nothing else"}.`;
  for (const role of roles) {
    const pool = catalog.filter((p) => p.role === role);
    if (!pool.length) continue;
    const rr = await clocked<RerankResponse>("rerank", {
      query: `Which part is the best choice for ${ROLE_JOB[role]} in this build? ${need}`,
      context: "A hobbyist building one unit by hand: prefers simple wiring, 3.3 V logic friendly, low cost, and parts sold as ready breakout boards.",
      instructions:
        "Each passage describes one real catalog part. It answers the query when that part does the job well for this device. " +
        "A part that does a different job is unrelated. A part that does the job but misses a stated need (wireless, battery) is a different case.",
      documents: pool.map((p) => ({
        id: p.id,
        text: `${p.name} (${p.manufacturer} ${p.mpn}). ${p.summary} Interface: ${p.interface}. Price: $${p.price_usd.toFixed(2)} at ${p.vendor}.`,
      })),
    });
    const ranked: Candidate[] = rr.results.map((r) => ({
      id: pool[r.index].id,
      name: pool[r.index].name,
      score: r.relevance_score,
      action: r.action,
    }));
    const best = pool[rr.results[0].index];
    chosen.push(best);
    const { datasheet_excerpt: _omit, ...card } = best;
    emit({ type: "part", role, part: card, score: rr.results[0].relevance_score, candidates: ranked });
  }

  // 3. Extract: read the numbers that matter off each chosen part's datasheet.
  emit({ type: "stage", stage: "Reading datasheets", endpoint: "extract" });
  const mcu = chosen.find((p) => p.role === "mcu");
  const rails = new Map<string, string>();
  const supplies = new Map<string, string>();
  const currents = new Map<string, number>();
  const logicHigh5 = new Set<string>();
  const inputHigh = new Map<string, number>();
  for (const part of chosen) {
    const ex = await clocked<ExtractResponse>("extract", {
      text: part.datasheet_excerpt,
      instructions: "The text is part of an electronics datasheet. Copy values with their units exactly as written.",
      fields: {
        supply_voltage: { description: "operating or supply voltage range for the part or module, with unit" },
        supply_current: { description: "typical or maximum operating current draw, with unit" },
        interface: { description: "communication interface or output signal type, such as I2C, analog, digital or PWM" },
        logic_level: { description: "logic level or output signal voltage, with unit" },
      },
    });
    const labels: Record<string, string> = {
      supply_voltage: "Supply",
      supply_current: "Current",
      interface: "Interface",
      logic_level: "Signal level",
    };
    const values: SpecValue[] = Object.entries(labels).map(([k, label]) => {
      const v = ex.fields[k];
      const value = Array.isArray(v?.value) ? v.value.join(", ") : (v?.value ?? null);
      const quote =
        v && typeof v.start === "number" && typeof v.end === "number"
          ? part.datasheet_excerpt.slice(Math.max(0, v.start - 40), v.end + 40).replace(/\s+/g, " ").trim()
          : null;
      return { label, value: value ?? "not stated", quote };
    });
    const supply = values[0].value;
    const rail = pickRail(part, supply, spec.power);
    rails.set(part.id, rail);
    if (supply !== "not stated") supplies.set(part.id, supply);
    const mA = parseMilliamps(values[1].value);
    if (mA !== null) currents.set(part.id, mA);
    if (part.role !== "mcu" && /\b5(\.0)?\s*V\b/i.test(values[3].value) && !/3\.3/.test(values[3].value)) logicHigh5.add(part.id);
    // An input threshold written as a fraction of the supply, like "0.7VDD", on a part fed from 5 V.
    const frac = values[3].value.match(/0\.(\d+)\s*[x×*]?\s*V\s?DD/i);
    if (frac && rail === "5 V") inputHigh.set(part.id, Number(`0.${frac[1]}`) * 5);
    emit({ type: "specs", partId: part.id, values, rail });
  }

  // 4. Wiring, from the board's pin map and each module's printed header pins.
  const rows = mcu?.mcu_pins ? wire(chosen, mcu.mcu_pins, rails) : [];
  emit({ type: "wiring", rows });

  // 5. Verify: the design's claims, checked against the datasheets they came from.
  emit({ type: "stage", stage: "Checking the design", endpoint: "grounding" });
  const claims: { text: string; doc: string }[] = [];
  for (const part of chosen) {
    const rail = rails.get(part.id) ?? "3.3 V";
    if (part.role === "battery") continue;
    if (part.role === "mcu") {
      claims.push({ text: `The ${part.name} uses 3.3 V logic on its I/O pins.`, doc: part.id });
      continue;
    }
    const rated = supplies.get(part.id);
    claims.push({
      text: rated
        ? `The ${part.name} can run from ${rail}, which is inside its rated supply of ${rated}.`
        : `The ${part.name} can be powered from a ${rail} supply.`,
      doc: part.id,
    });
    if (part.interface !== "power" && part.interface !== "battery")
      claims.push({ text: `The ${part.name} connects using ${ifaceWords(part.interface)}.`, doc: part.id });
  }
  const docs = chosen.map((p) => ({ id: p.id, text: p.datasheet_excerpt }));
  const g = await clocked<GroundingResponse>("grounding", {
    documents: docs,
    answer: claims.map((c) => c.text).join(" "),
    claims: claims.slice(0, 30).map((c) => c.text),
    instructions:
      "The documents are datasheet excerpts, one per part, with the part id as the document id. Each claim is a design note about one named part. " +
      "Judge a claim only against that part's datasheet. A supply voltage claim is supported when the stated voltage falls inside the datasheet's operating range. " +
      "A value the datasheet does not give is not stated, not contradicted.",
    evidence: "all",
    threshold: 0.6,
  });
  const checks: Check[] = g.claims.map((c) => ({
    claim: c.claim,
    verdict: c.verdict === "supported" ? "pass" : c.verdict === "contradicted" ? "flag" : "unknown",
    support: c.supported,
    source: c.evidence?.document ?? null,
    quote: c.evidence?.quote ?? null,
    origin: "clocked-verify",
  }));

  // Current budget from the extracted numbers, against what the supply can give.
  const budget = 500;
  const known = [...currents.values()].reduce((a, b) => a + b, 0);
  if (currents.size) {
    checks.push({
      claim: `Extracted current draws add up to about ${known < 10 ? known.toFixed(2) : Math.round(known)} mA (${currents.size} of ${chosen.length} parts state one), against a ${budget} mA budget${spec.power === "usb" ? ", the USB 2.0 port limit" : ""}.`,
      verdict: known <= budget ? "pass" : "flag",
      support: known <= budget ? 1 : 0,
      source: null,
      quote: null,
      origin: "budget",
    });
  }
  for (const id of logicHigh5) {
    const p = chosen.find((x) => x.id === id);
    if (!p) continue;
    checks.push({
      claim: `${p.name} signals at 5 V; put a voltage divider or level shifter before the 3.3 V board pin.`,
      verdict: "flag",
      support: 0,
      source: id,
      quote: null,
      origin: "budget",
    });
  }
  for (const [id, vih] of inputHigh) {
    const p = chosen.find((x) => x.id === id);
    if (!p || vih <= 3.3) continue;
    checks.push({
      claim: `${p.name} runs on 5 V, so its data input needs at least ${vih.toFixed(1)} V to read a high. A 3.3 V board pin is below that: add a 5 V level shifter on the data line.`,
      verdict: "flag",
      support: 0,
      source: id,
      quote: null,
      origin: "budget",
    });
  }
  if (spec.power !== "usb") {
    for (const p of chosen.filter((x) => rails.get(x.id) === "5 V")) {
      checks.push({
        claim: `${p.name} needs 5 V, but on battery the board has no 5 V rail. Add a 5 V boost converter or pick a 3.3 V part.`,
        verdict: "flag",
        support: 0,
        source: p.id,
        quote: null,
        origin: "budget",
      });
    }
  }
  emit({ type: "checks", checks, grounded: g.grounded });

  const total = chosen.reduce((s, p) => s + p.price_usd, 0);
  emit({ type: "done", total: Math.round(total * 100) / 100, calls, ms: Date.now() - started });
}

function ifaceWords(i: string) {
  return (
    { i2c: "I2C", analog: "an analog output", digital: "a digital signal", pwm: "a PWM signal", spi: "SPI", i2s: "I2S", onewire: "a single data wire" }[i] ??
    i
  );
}

function volts(text: string): number[] {
  return [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:V|VDC|volts?)\b/gi)].map((m) => Number(m[1])).filter((n) => n > 0 && n < 30);
}

function pickRail(part: Part, supply: string, power: string): string {
  if (part.role === "mcu") return power === "usb" ? "USB 5 V" : "LiPo 3.7 V";
  if (part.role === "battery") return "3.7 V";
  if (part.role === "charger") return "USB 5 V";
  // Datasheets write ranges as "3.3 ~ 5.5 V", "4.5～5.5V" or "3.75 — 6 V"; fold every dash and tilde into "-".
  const text = supply.replace(/[～〜~—–]/g, "-");
  const v = volts(text);
  // Ranges like "3.3 to 5.5 V" or "3V - 5V" leave the first number without a unit.
  const range = text.match(/(\d+(?:\.\d+)?)\s*V?\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*V/i);
  const lo = range ? Number(range[1]) : Math.min(...v);
  const hi = range ? Number(range[2]) : Math.max(...v);
  if (!Number.isFinite(lo)) return "3.3 V";
  if (lo <= 3.3 && hi >= 3.3) return "3.3 V";
  if (lo <= 5 && hi >= 5) return "5 V";
  return lo > 3.3 ? "5 V" : "3.3 V";
}

function parseMilliamps(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(mA|µA|uA|A)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "mA" ? n : m[2] === "A" ? n * 1000 : n / 1000;
}

function wire(parts: Part[], pins: McuPins, rails: Map<string, string>): WireRow[] {
  const rows: WireRow[] = [];
  const analog = [...pins.analog];
  const digital = [...pins.digital];
  const pwm = [...pins.pwm];
  const take = (pool: string[], used: Set<string>) => {
    const p = pool.find((x) => !used.has(x));
    if (p) used.add(p);
    return p ?? "free GPIO";
  };
  const used = new Set<string>([pins.i2c_sda, pins.i2c_scl]);
  const fiveV = pins.power_out.find((p) => /5V|VBUS|VUSB|USB/i.test(p)) ?? "5V";
  const threeV = pins.power_out.find((p) => /3V3|3\.3/i.test(p)) ?? "3V3";
  const batIn = parts.find((p) => p.role === "mcu")?.pins.includes("VSYS") ? "VSYS" : "BAT+ pad";
  const isIn = (r: Role) => r === "button" || r === "motion" || r === "distance" || r === "temp_humidity";

  for (const part of parts) {
    if (part.role === "mcu") continue;
    if (part.role === "battery") {
      rows.push({ part: part.name, pin: "JST +/-", to: "charger BAT", net: "battery" });
      continue;
    }
    if (part.role === "charger") {
      const bat = part.pins.find((p) => /BAT/i.test(p)) ?? "BAT";
      rows.push({ part: part.name, pin: bat, to: batIn, net: "battery out" });
      continue;
    }
    // Two-lead parts (piezo, plain LED, tactile switch): one lead to a pin, one to ground.
    if (["buzzer", "led", "button"].includes(part.role) && !part.pins.some((p) => /DIN|VDD/i.test(p))) {
      const pool = part.interface === "pwm" ? pwm : digital;
      rows.push({ part: part.name, pin: part.pins[0], to: take(pool, used), net: part.role === "button" ? "digital in (pull-up)" : part.role === "led" ? "digital out (via 220 Ω)" : "PWM out" });
      const other = part.role === "button" ? part.pins[2] ?? part.pins[1] : part.pins[1];
      rows.push({ part: part.name, pin: other, to: "GND", net: "ground" });
      continue;
    }
    const rail = rails.get(part.id) === "5 V" ? fiveV : threeV;
    for (const pin of part.pins) {
      const P = pin.toUpperCase();
      let to: string;
      let net: string;
      if (/^(GND|GROUND|VSS|-)$|GND/.test(P)) [to, net] = ["GND", "ground"];
      else if (/^(SDA|SDI|DATA)$/.test(P) && part.interface === "i2c") [to, net] = [pins.i2c_sda, "I2C data"];
      else if (/^(SCL|SCK|CLK)$/.test(P) && part.interface === "i2c") [to, net] = [pins.i2c_scl, "I2C clock"];
      else if (/^(VCC|VIN|VDD|V\+|\+|3V|5V|POWER)$/.test(P)) [to, net] = [rail, "power"];
      else if (/^(3VO|2V8|INT|ADR|ALR|RST|XSHUT|GPIO1|SDO|CS|NC|DOUT|SEL|BUTTON)/.test(P) && part.interface !== "i2s") continue;
      else if (part.interface === "i2s" && P === "SEL") [to, net] = ["GND", "left channel"];
      else if (part.interface === "analog") [to, net] = [take(analog, used), "analog in"];
      else if (part.interface === "pwm") [to, net] = [take(pwm, used), "PWM out"];
      else [to, net] = [take(digital, used), isIn(part.role) || P === "ECHO" || P === "DOUT" ? "digital in" : "digital out"];
      rows.push({ part: part.name, pin, to, net });
    }
  }
  return rows;
}
