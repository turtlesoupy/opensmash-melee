import { useEffect, useRef, useState } from "react";
import { desktop } from "@/lib/desktop";
import { type Fighter } from "./page";
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
  const embedded = desktop()?.embedded;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [gameReady, setGameReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (hasFrame && gameReady) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [hasFrame, gameReady]);
  useEffect(() => {
    if (embedded && hasFrame && gameReady && !document.querySelector('dialog[open]')) {
      canvas.current?.focus({preventScroll: true});
    }
  }, [embedded, hasFrame, gameReady]);
  useEffect(() => {
    if (!embedded) return;
    const bridge = desktop()!;
    const element = canvas.current!;
    const frame = () => setHasFrame(true);
    const failed = (event: Event) => setError((event as CustomEvent<string>).detail);
    const clear = () => bridge.input(null, false);
    const restoreFocus = () => {
      if (!document.querySelector('dialog[open]')) element.focus({preventScroll: true});
    };
    const key = (event: KeyboardEvent) => {
      if (event.code === "F11" || event.code === "Escape") return;
      if (event.type === "keydown" && (event.metaKey || event.ctrlKey || event.altKey)) return;
      event.preventDefault();
      if (!event.repeat) bridge.input(event.code, event.type === "keydown");
    };
    element.addEventListener("native-frame", frame);
    element.addEventListener("native-error", failed);
    element.addEventListener("keydown", key);
    element.addEventListener("keyup", key);
    element.addEventListener("blur", clear);
    window.addEventListener("blur", clear);
    window.addEventListener("focus", restoreFocus);
    bridge.setGameActive(true);
    element.focus();
    return () => {
      bridge.setGameActive(false);
      void bridge.fullscreen(false);
      element.removeEventListener("native-frame", frame);
      element.removeEventListener("native-error", failed);
      element.removeEventListener("keydown", key);
      element.removeEventListener("keyup", key);
      element.removeEventListener("blur", clear);
      window.removeEventListener("blur", clear);
      window.removeEventListener("focus", restoreFocus);
    };
  }, [embedded]);
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
        for (const [index, c] of launch.costumes.entries()) {
          if (closed) return;
          setStatus(
            "Preparing " + (roster.find((f) => f.slug === c.character)?.name || c.character) + `… (${index + 1}/${launch.costumes.length})`,
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
        setStatus("Preparing your game…");
        const poll = async () => {
          try {
            const response = await fetch("/api/native/status", { signal: controller.signal });
            const s = await response.json();
            if (closed) return;
            if (s.session !== session) { timer = setTimeout(poll, 500); return; }
            setStatus(s.message);
            setGameReady(s.ready);
            if (s.exitCode && s.exitCode !== 0)
              setError("The game stopped unexpectedly. Return to the roster to try again.");
            timer = setTimeout(poll, 500);
          } catch (e) {
            if (!closed) setError((e as Error).message);
          }
        };
        void poll();
        await request("/api/native/launch", { ...launch, session });
      } catch (e) {
        clearTimeout(timer);
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
    <section className={embedded ? "native-game" : "boot-screen"}>
      <header className="native-game-toolbar">
        <h2>{fighter.name}</h2>
        <div>
          {embedded && (
            <button
              onClick={() => {
                void desktop()!.fullscreen();
                canvas.current?.focus();
              }}
            >
              Fullscreen · F11
            </button>
          )}
          <button onClick={onClose}>Return to roster</button>
        </div>
      </header>
      {embedded && (
        <div className="native-game-screen" onPointerDown={() => canvas.current?.focus({preventScroll: true})}>
          <canvas
            id="native-game-canvas"
            ref={canvas}
            width={960}
            height={720}
            tabIndex={0}
            aria-label={`Play as ${fighter.name}`}
            onClick={() => canvas.current?.focus()}
          />
          {!(hasFrame && gameReady) && !error && (
            <div className="native-game-message native-loading" role="status">
              <progress aria-label="Loading game" />
              <p>{status}</p>
              <small>{elapsed}s elapsed{elapsed >= 15 ? " · The first load can take a little longer." : ""}</small>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
