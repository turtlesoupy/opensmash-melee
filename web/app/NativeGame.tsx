import { useEffect, useState } from "react";
import type { Fighter } from "./page";
import { plan, type Settings } from "@/lib/launch";
export default function NativeGame({
  fighter,
  settings,
  roster,
  onClose,
}: {
  fighter: Fighter;
  settings: Settings;
  roster: Fighter[];
  onClose: () => void;
}) {
  const [status, setStatus] = useState("Preparing your character…"),
    [error, setError] = useState("");
  useEffect(() => {
    const session = crypto.randomUUID();
    let closed = false,
      timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function request(url: string, body: unknown) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Could not launch Melee");
      return result;
    }
    async function start() {
      try {
        const launch = plan(settings, fighter, roster);
        for (const c of launch.costumes) {
          if (closed) return;
          setStatus(
            "Preparing " + (roster.find((f) => f.slug === c.character)?.name || c.character) + "…",
          );
          await request(
            "/api/prepare/" +
              encodeURIComponent(c.character) +
              "?color=" +
              c.color +
              "&skin=host" +
              (launch.costumes.length >= 3 ? "&compact=1" : ""),
            {},
          );
        }
        if (closed) return;
        await request("/api/native/launch", { ...launch, session });
        const poll = async () => {
          try {
            const response = await fetch("/api/native/status", { signal: controller.signal });
            const s = await response.json();
            if (closed) return;
            setStatus(s.message);
            if (s.exitCode && s.exitCode !== 0)
              setError("Melee stopped unexpectedly. The local native-session.log has details.");
            if (s.running) timer = setTimeout(poll, 500);
          } catch (e) {
            if (!closed) setError((e as Error).message);
          }
        };
        void poll();
      } catch (e) {
        if (!closed) setError((e as Error).message);
      }
    }
    void start();
    return () => {
      closed = true;
      controller.abort();
      clearTimeout(timer);
      void fetch("/api/native/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session }),
      });
    };
  }, [fighter, settings, roster]);
  return (
    <section className="boot-screen">
      <h2>{fighter.name}</h2>
      <p role="status">{status}</p>
      {error && <p role="alert">{error}</p>}
      <p>The game uses a separate native window. Your launcher stays here.</p>
      <button className="boot-action" onClick={onClose}>
        Close game / return to roster
      </button>
    </section>
  );
}
