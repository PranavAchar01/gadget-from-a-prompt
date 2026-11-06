import { buildGadget } from "@/lib/pipeline";
import { ClockedError } from "@/lib/clocked";
import type { BuildEvent } from "@/lib/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { prompt } = (await req.json().catch(() => ({}))) as { prompt?: unknown };
  if (typeof prompt !== "string" || prompt.trim().length < 6 || prompt.length > 400) {
    return Response.json({ error: "Describe the gadget in one line (6 to 400 characters)." }, { status: 400 });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: BuildEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        await buildGadget(prompt.trim(), emit);
      } catch (err) {
        const message = err instanceof ClockedError ? err.message : "The build stopped. Try again.";
        emit({ type: "error", message });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
