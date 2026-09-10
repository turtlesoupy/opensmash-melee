import { useEffect, useMemo, useRef, useState } from "react";
import Game from "./Game";
import BootScreen from "./BootScreen";
import LaunchSettings from "./LaunchSettings";
import RosterGrid, { FrameRule } from "./RosterGrid";
import SiteDialog from "./SiteDialog";
import ImportCharacter from "./ImportCharacter";
import { loadSettings, type Settings } from "@/lib/launch";
import { unlockAudio } from "@/lib/audio";
import { warmMelee } from "@/lib/melee-session";
import order from "@/lib/roster-order.json";
export type Fighter = {
  slug: string;
  name: string;
  short: string;
  target: string;
  review?: boolean;
  portrait?: string;
  imported?: boolean;
};
export const names: Record<string, string> = {
  mario: "Mario",
  luigi: "Luigi",
  "captain-falcon": "Captain Falcon",
  fox: "Fox",
  marth: "Marth",
  link: "Link",
};
const ranks = new Map(order.map((slug, index) => [slug, index]));
export default function Home() {
  const [gameReady,setGameReady]=useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const [roster, setRoster] = useState<Fighter[]>([]),
    [query, setQuery] = useState(""),
    [target, setTarget] = useState("all"),
    [selected, setSelected] = useState<{ id: number; fighter: Fighter; settings: Settings } | null>(
      null,
    ),
    [error, setError] = useState("");
  const [dialog, setDialog] = useState<"Settings" | "Controls" | "About" | "Import character" | null>(null);
  const frame = useRef<HTMLDivElement>(null),
    launchId = useRef(0);
  useEffect(() => {
    localStorage.setItem("melee-launch-v1", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    document.body.classList.add("is-game-booted");
    return () => document.body.classList.remove("is-game-booted");
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetch("/catalog.json", { signal: controller.signal }), fetch("/api/imports", { signal: controller.signal })])
      .then(async ([base,imports]) => {
        if (!base.ok) throw Error("The fighter roster could not load.");
        const catalog=await base.json();
        const imported=imports.ok?await imports.json():[];
        return [...imported,...(catalog.fighters||catalog)];
      })
      .then((data) =>
        setRoster(
          data.sort(
            (a: Fighter, b: Fighter) =>
              (ranks.get(a.slug) ?? Infinity) - (ranks.get(b.slug) ?? Infinity),
          ),
        ),
      )
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(()=>{if(gameReady)warmMelee();},[gameReady]);
  const choose = (fighter: Fighter) => {
    if(!gameReady){setError("Choose and verify your Melee ISO in the boot screen first.");frame.current?.scrollIntoView({block:"start"});return;}
    setError("");
    void unlockAudio().catch(() => {});
    setSelected({ id: ++launchId.current, fighter, settings: structuredClone(settings) });
    frame.current?.scrollIntoView({ block: "start", behavior: "instant" });
  };
  const filtered = useMemo(
    () =>
      roster.filter(
        (f) =>
          (target === "all" || f.target === target) &&
          (f.name + " " + names[f.target]).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      ),
    [roster, query, target],
  );
  return (
    <>
      <main className="arena-shell" aria-label="Smash.fun Melee character grid">
        <header className="retro-site-header">
          <a
            className="retro-site-logo"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setSelected(null);
              setQuery("");
              setTarget("all");
            }}
            aria-label="Smash.fun Melee home"
          >
            <img
              className="hero-logo-fallback"
              src="/brand/smash-the-weights-logo.png"
              alt="Smash.fun"
              draggable="false"
            />
          </a>
          <nav className="retro-site-nav" aria-label="Site information and settings">
            <button className="retro-site-link" onClick={()=>setDialog("Import character")}>Import character</button>
            <button className="retro-site-link" onClick={() => setDialog("About")}>
              About
            </button>
            <button
              id="controls-menu-button"
              className="retro-site-link"
              onClick={() => setDialog("Controls")}
            >
              Controls
            </button>
            <button
              className="retro-site-link retro-site-advanced-button"
              onClick={() => setDialog("Settings")}
            >
              Settings
            </button>
            <details className="retro-site-more">
              <summary className="retro-site-link">More</summary>
              <div className="retro-site-more-menu">
                {(["Controls", "Settings"] as const).map((name) => (
                  <button
                    key={name}
                    className="retro-site-link"
                    onClick={(e) => {
                      e.currentTarget.closest("details")?.removeAttribute("open");
                      setDialog(name);
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </details>
            <div className="retro-social-links">
              <a
                className="retro-site-link retro-social-link retro-github-link"
                href="https://github.com/turtlesoupy/opensmash-melee"
                target="_blank"
                rel="noreferrer"
                aria-label="View the source on GitHub"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 .7a11.6 11.6 0 0 0-3.7 22.6c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C15.7 5 16.7 5.3 16.7 5.3c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.8 5.5-5.5 5.8.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.6 11.6 0 0 0 12 .7Z" />
                </svg>
                <span>Github</span>
              </a>
              <a
                className="retro-site-link retro-social-link retro-discord-link"
                href="https://discord.gg/qYBbGmwBhr"
                target="_blank"
                rel="noreferrer"
                aria-label="Join the Smash.fun community on Discord"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19.6 5.3A18 18 0 0 0 15.3 4l-.5 1a14.7 14.7 0 0 0-5.6 0l-.5-1a18 18 0 0 0-4.3 1.3C1.7 9.4 1 13.4 1.4 17.4a17.3 17.3 0 0 0 5.3 2.7l1.3-1.8a10.8 10.8 0 0 1-2-1l.5-.4a12.6 12.6 0 0 0 11 0l.5.4a11 11 0 0 1-2 1l1.3 1.8a17.3 17.3 0 0 0 5.3-2.7c.5-4.6-.8-8.5-3-12.1ZM8.5 15.2c-1.3 0-2.3-1.2-2.3-2.7s1-2.7 2.3-2.7 2.3 1.2 2.3 2.7-1 2.7-2.3 2.7Zm7 0c-1.3 0-2.3-1.2-2.3-2.7s1-2.7 2.3-2.7 2.3 1.2 2.3 2.7-1 2.7-2.3 2.7Z" />
                </svg>
                <span>Discord</span>
              </a>
            </div>
          </nav>
        </header>
        <section
          className="intro-video-stage"
          aria-label={selected ? "Melee game" : "Smash.fun introduction"}
        >
          <div ref={frame} className={`intro-video-frame ${selected ? "is-game-running" : ""}`}>
            {selected ? (
              <Game
                key={selected.id}
                fighter={selected.fighter}
                settings={selected.settings}
                roster={roster}
                onClose={() => setSelected(null)}
              />
            ) : (
              <BootScreen settings={settings} onChange={setSettings} onReady={setGameReady} onSettings={()=>setDialog("Settings")}/>
            )}
            <FrameRule />
          </div>
        </section>
        <RosterGrid
          fighters={filtered}
          query={query}
          onQuery={setQuery}
          onChoose={choose}
          onRandom={() => {
            if (filtered.length) choose(filtered[Math.floor(Math.random() * filtered.length)]);
          }}
          paused={!!selected}
        />
        <div className="roster-status" role="status">
          {error ||
            (!roster.length
              ? "Loading fighters…"
              : `${filtered.length.toLocaleString()} fighters · Melee`)}
          {(query || target !== "all") && (
            <button
              className="retro-site-link"
              onClick={() => {
                setQuery("");
                setTarget("all");
              }}
            >
              Clear search / filter
            </button>
          )}
        </div>
      </main>
      {dialog && (
        <SiteDialog title={dialog} onClose={() => setDialog(null)}>
          {dialog === "Import character" && <ImportCharacter onImported={fighter=>setRoster(previous=>[fighter,...previous.filter(f=>f.slug!==fighter.slug)])} onPlay={fighter=>{setDialog(null);choose(fighter);}}/>}
          {dialog === "Settings" && (
            <>
              <LaunchSettings value={settings} onChange={setSettings} roster={roster} />
              <label className="moveset-filter">
                Roster moveset filter
                <select
                  aria-label="Filter by Melee fighter"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="all">All Melee fighters</option>
                  {Object.entries(names).map(([key, name]) => (
                    <option key={key} value={key}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <p>Changes apply to the next launch.</p>
              <button className="retro-site-link" onClick={() => setDialog("Controls")}>
                View controls
              </button>
            </>
          )}
          {dialog === "Controls" && (
            <>
              <p>Choose any fighter to play. Use Settings to assign up to four player ports.</p>
              <dl className="controls-list">
                {[
                  ["Move", "WASD / arrow keys"],
                  ["Attack / confirm", "J"],
                  ["Special", "K"],
                  ["Jump", "I / Space"],
                  ["Shield", "Q / E"],
                  ["Grab", "U"],
                  ["Start / pause", "Enter"],
                ].map(([action, key]) => (
                  <div key={action}>
                    <dt>{action}</dt>
                    <dd>{key}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Gamepads: left stick to move, A attack, B special, X/Y jump, shoulder buttons
                shield. Touch controls appear on touch devices.
              </p>
            </>
          )}
          {dialog === "About" && (
            <>
              <p>
                Smash.fun Melee brings the OpenSmash character roster into Super Smash Bros. Melee,
                using its original game engine.
              </p>
              <p>
                {roster.length.toLocaleString()} custom characters retargeted across six Melee
                fighters. Select a portrait to play, or choose a different launch mode in Settings.
              </p>
              <p>
                This local development build uses your verified Melee 1.02 ROM. The introduction
                video is the original Smash.fun trailer.
              </p>
              <p>
                Character creation is still supplied by the original OpenSmash pipeline; this picker
                launches the imported roster.
              </p>
            </>
          )}
        </SiteDialog>
      )}
    </>
  );
}
