# Gadget from a Prompt

Type one line about a gadget you want, like "a desk plant monitor that beeps when the soil is dry". You get a parts list of real products you can buy, the specs read off each part's datasheet, a wiring table, a block diagram and a total cost. You also get a list of checks showing which parts of the design the datasheets back up.

Live: https://gadget-from-a-prompt.vercel.app

Demo video: [docs/demo.mp4](docs/demo.mp4)

Built for the Clocked Build Challenge on the [Clocked API](https://clocked.rezolve.ai/docs).

## How it uses Clocked

Every step of a build is a Clocked call. The server runs them in order and streams each result to the page as it comes back.

1. Fill (`/clocked/fill`) turns the prompt into a device spec in one call. The spec has a short name, one sentence on what the device does, what it senses and what it outputs (both multiselect), the power source, and whether it needs wireless. The page shows the confidence Clocked returns for each field.
2. Rerank (`/clocked/rerank`) runs once for each role in the spec: the board, each sensor, each output. The candidates are the catalog parts for that role, and the query describes the device and the other parts it uses. The top result is the pick. The page also lists the parts it beat and their scores.
3. Extract (`/clocked/extract`) reads each chosen part's datasheet excerpt for supply voltage, current draw, interface and signal level. The supply range decides whether the part goes on the 3.3 V or the 5 V pin, and the current values go into the power budget.
4. Verify (`/clocked/grounding`) takes the design's claims, such as "this sensor can run from 3.3 V" or "this display talks I2C", with the chosen datasheets as documents. For each claim it returns supported, contradicted or not stated, plus the quote it used. The page shows supported claims as PASS, contradicted ones as FLAG, and claims the datasheet doesn't cover as OPEN.

The wiring table and the block diagram are built in code from the board's pin map and each module's header pins. No images are generated.

Calls run one at a time. On a 429 or 409 the client waits with backoff and retries with the same idempotency key and payload.

## The parts

`data/catalog.json` has 34 real parts across 15 roles. Each entry has the maker's part number, the vendor page, the single-unit price as checked on November 5, 2026, the datasheet link, a verbatim excerpt of that datasheet, and the header pin names. If a source couldn't be fetched, the part isn't in the catalog.

Sources: Adafruit, SparkFun, DFRobot and Seeed product pages, plus the makers' datasheets. The datasheets belong to their makers.

## Run it

```bash
pnpm install
echo "CLOCKED_API_KEY=your-key" > .env.local
pnpm dev
```

Open http://localhost:3000. It deploys to Vercel as is; set `CLOCKED_API_KEY` as an environment variable there.

## Stack

Next.js 15 (App Router), TypeScript and Tailwind. There is one streaming API route and no database. The API key stays on the server.

## License

MIT for the code. Part data and datasheet excerpts belong to their vendors and makers, credited in each entry.
