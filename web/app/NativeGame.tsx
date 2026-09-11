import { useEffect, useRef, useState } from "react";
import { desktop } from "@/lib/desktop";
import { names, type Fighter } from "./page";
import Controls from "./Controls";
import { plan, schema, type Settings } from "@/lib/launch";
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
  useEffect(() => {
    if (!embedded) return;
    const bridge = desktop()!;
    const element = canvas.current!;
    const frame = () => setHasFrame(true);
    const failed = (event: Event) => setError((event as CustomEvent<string>).detail);
    const clear = () => bridge.input(null, false);
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
        setStatus("Starting Melee…");
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
        <div className="native-game-screen">
          <canvas
            id="native-game-canvas"
            ref={canvas}
            width={960}
            height={720}
            tabIndex={0}
            aria-label={`Play as ${fighter.name}`}
            onClick={() => canvas.current?.focus()}
          />
          {!hasFrame && !error && (
            <p className="native-game-message" role="status">
              {status}
            </p>
          )}
        </div>
      )}
      <p>
        {schema.modes.find((m) => m.id === settings.mode)?.label} ·{" "}
        {names[fighter.target] || fighter.target} moveset
      </p>
      {settings.mode !== 0 && (
        <p>
          This mode opens Melee’s menus. Custom characters use their host fighter’s original menu
          slot and costume. Choose Free-for-All to play a match immediately.
        </p>
      )}
      {(!embedded || hasFrame) && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      <p>
        {embedded
          ? "Click the game to use the keyboard. Press J to confirm first-run memory-card prompts. F11 toggles fullscreen; Esc exits fullscreen."
          : "The game uses a separate native window. Your launcher stays here."}
      </p>
      <details>
        <summary>Keyboard & PS5 controls</summary>
        <Controls />
      </details>
    </section>
  );
}
