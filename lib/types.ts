export type Role =
  | "mcu"
  | "soil_moisture"
  | "temp_humidity"
  | "light"
  | "motion"
  | "distance"
  | "accelerometer"
  | "microphone"
  | "button"
  | "buzzer"
  | "display"
  | "led"
  | "servo"
  | "charger"
  | "battery";

export type McuPins = {
  i2c_sda: string;
  i2c_scl: string;
  analog: string[];
  digital: string[];
  pwm: string[];
  logic_v: number;
  power_out: string[];
};

export type Part = {
  id: string;
  role: Role;
  name: string;
  mpn: string;
  manufacturer: string;
  summary: string;
  vendor: string;
  vendor_sku: string;
  price_usd: number;
  price_url: string;
  datasheet_url: string;
  datasheet_excerpt: string;
  pins: string[];
  interface: string;
  source_note: string;
  pack?: number;
  mcu_pins?: McuPins;
};

// What the browser receives: the datasheet text stays on the server.
export type PartCard = Omit<Part, "datasheet_excerpt">;

export type Spec = {
  name: string;
  does: string;
  senses: string[];
  outputs: string[];
  power: string;
  wireless: string;
  confidence: Record<string, number>;
};

export type Candidate = { id: string; name: string; score: number; action: string };

export type SpecValue = { label: string; value: string; quote: string | null };

export type WireRow = { part: string; pin: string; to: string; net: string };

export type Check = {
  claim: string;
  verdict: "pass" | "flag" | "unknown";
  support: number;
  source: string | null;
  quote: string | null;
  origin: "clocked-verify" | "budget";
};

export type BuildEvent =
  | { type: "stage"; stage: string; endpoint: string }
  | { type: "spec"; spec: Spec }
  | { type: "part"; role: Role; part: PartCard; score: number; candidates: Candidate[] }
  | { type: "specs"; partId: string; values: SpecValue[]; rail: string }
  | { type: "wiring"; rows: WireRow[] }
  | { type: "checks"; checks: Check[]; grounded: number }
  | { type: "done"; total: number; calls: number; ms: number }
  | { type: "error"; message: string };
