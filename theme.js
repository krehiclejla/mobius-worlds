export const CSS = `
* { box-sizing: border-box; }
.mw-root {
  position: relative; height: 100%; min-height: 100%;
  color: var(--text); background: var(--bg); font-family: var(--font);
  overflow: hidden;
}
.mw-scroll { height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.mw-wrap { max-width: 880px; margin: 0 auto; padding: 18px 16px 48px; }
button { font: inherit; }
.mw-btn {
  min-height: 44px; padding: 0 18px; border-radius: 12px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); font-weight: 600; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  transition: transform .12s ease, background .15s ease, border-color .15s ease;
}
.mw-btn:hover { border-color: var(--accent); }
.mw-btn:active { transform: scale(.97); }
.mw-btn:disabled { opacity: .5; cursor: default; transform: none; }
.mw-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.mw-btn.ghost { background: transparent; border-color: transparent; }
.mw-btn.danger { color: #e03131; }
.mw-btn.small { min-height: 36px; padding: 0 12px; font-size: 14px; border-radius: 10px; }
.mw-btn:focus-visible, .mw-input:focus-visible, .mw-swatch:focus-visible, .mw-chip:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 2px;
}
.mw-input {
  min-height: 44px; width: 100%; padding: 0 14px; border-radius: 12px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit;
}
.mw-muted { color: var(--muted); }
.mw-small { font-size: 13px; }
.mw-row { display: flex; gap: 10px; align-items: center; }
.mw-grow { flex: 1; min-width: 0; }

/* hero */
.mw-hero {
  position: relative; border-radius: 22px; overflow: hidden; min-height: 210px;
  background: linear-gradient(160deg, #2b1f5c 0%, #5b3a8e 45%, #e0719a 100%);
  color: #fff; padding: 22px; display: flex; flex-direction: column; justify-content: flex-end;
  box-shadow: 0 18px 40px -22px rgba(60, 30, 120, .7);
}
.mw-hero canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.mw-hero-text { position: relative; z-index: 1; }
.mw-hero h1 { margin: 0; font-size: clamp(28px, 6vw, 40px); letter-spacing: -0.02em; }
.mw-hero p { margin: 6px 0 0; opacity: .88; max-width: 460px; line-height: 1.4; }
.mw-hero-actions { position: relative; z-index: 1; margin-top: 16px; display: flex; gap: 10px; flex-wrap: wrap; }
.mw-hero .mw-btn { border-color: rgba(255,255,255,.35); background: rgba(255,255,255,.14); color: #fff; backdrop-filter: blur(6px); }
.mw-hero .mw-btn.primary { background: #fff; color: #3b2575; border-color: #fff; }

.mw-section { margin-top: 26px; }
.mw-section h2 { font-size: 17px; margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
.mw-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 14px;
}
.mw-list { display: grid; gap: 10px; }
.mw-session { display: flex; gap: 12px; align-items: center; }
.mw-session-art { width: 46px; height: 46px; border-radius: 14px; flex: none; display: grid; place-items: center; }
.mw-session-title { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mw-pill {
  display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
  padding: 3px 9px; border-radius: 999px; background: var(--surface-2); color: var(--muted);
}
.mw-pill.live { background: color-mix(in srgb, #2f9e44 18%, transparent); color: #2f9e44; }
.mw-empty { text-align: center; padding: 22px 14px; color: var(--muted); line-height: 1.45; }
.mw-error { color: #e03131; font-size: 14px; margin-top: 8px; }
.mw-join { display: flex; gap: 8px; }

/* profile */
.mw-profile { display: grid; grid-template-columns: 220px 1fr; gap: 18px; align-items: start; }
.mw-preview-col { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.mw-ghost-preview {
  border-radius: 22px; display: grid; place-items: center; overflow: hidden;
  background: radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--accent) 22%, var(--surface-2)), var(--surface-2) 70%);
}
.mw-tabs { display: flex; gap: 4px; margin-top: 14px; border-bottom: 1px solid var(--border); overflow-x: auto; }
.mw-tab {
  min-height: 40px; padding: 0 12px; border: 0; background: none; color: var(--muted); font: inherit; font-weight: 600;
  cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap;
}
.mw-tab[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
.mw-tab:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: -3px; }
.mw-merch {
  margin-left: 6px; font-size: 10px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase;
  padding: 1px 6px; border-radius: 999px; background: linear-gradient(90deg, #5b3a8e, #e0719a); color: #fff;
}
.mw-swatches { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.mw-swatch { width: 34px; height: 34px; border-radius: 50%; border: 3px solid transparent; cursor: pointer; }
.mw-swatch[aria-pressed="true"] { border-color: var(--text); }
.mw-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.mw-chip {
  min-height: 36px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border);
  background: var(--surface-2); color: var(--text); cursor: pointer; font-size: 14px;
}
.mw-chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
@media (max-width: 520px) {
  .mw-profile { grid-template-columns: 1fr; justify-items: center; text-align: center; }
  .mw-swatches, .mw-chips { justify-content: center; }
}

/* sheet */
.mw-scrim { position: absolute; inset: 0; background: rgba(10,12,20,.45); display: flex; align-items: flex-end; justify-content: center; z-index: 30; }
.mw-sheet {
  width: min(520px, 100%); background: var(--bg); border-radius: 22px 22px 0 0; padding: 20px 18px 26px;
  box-shadow: 0 -10px 40px rgba(0,0,0,.25); animation: mw-up .22s ease;
}
@media (min-width: 700px) { .mw-scrim { align-items: center; } .mw-sheet { border-radius: 22px; } }
.mw-sheet h3 { margin: 0 0 14px; font-size: 19px; }
.mw-toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; }
.mw-toggle input { width: 22px; height: 22px; accent-color: var(--accent); }
@keyframes mw-up { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }

/* session */
.mw-session-root { position: absolute; inset: 0; display: flex; flex-direction: column; background: #16233a; }
.mw-topbar {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  background: var(--bg); border-bottom: 1px solid var(--border); z-index: 5;
}
.mw-topbar .mw-title { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mw-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; }
.mw-stage canvas.mw-world, .mw-stage .mw-world-3d canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: pointer; }
.mw-status {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 6;
  background: rgba(20,24,36,.82); color: #fff; padding: 6px 12px; border-radius: 999px; font-size: 13px;
}
.mw-portal-card {
  position: absolute; left: 50%; bottom: 16px; translate: -50% 0; z-index: 6; /* not transform: mw-up animates transform */
  width: min(360px, calc(100% - 24px)); background: var(--bg); color: var(--text);
  border-radius: 18px; padding: 14px; box-shadow: 0 12px 30px rgba(0,0,0,.3); animation: mw-up .2s ease;
}
.mw-portal-card h4 { margin: 0 0 4px; font-size: 17px; }
.mw-portal-card p { margin: 0 0 12px; color: var(--muted); font-size: 14px; line-height: 1.4; }
.mw-bottombar { display: flex; gap: 8px; padding: 8px 10px calc(8px + var(--mobius-safe-bottom, 0px)); background: var(--bg); border-top: 1px solid var(--border); }
.mw-emotes { display: flex; gap: 4px; padding: 6px 10px 0; background: var(--bg); overflow-x: auto; }
.mw-emote { min-width: 44px; min-height: 40px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); font-size: 20px; cursor: pointer; }
.mw-feed {
  position: absolute; left: 10px; top: 10px; z-index: 4; width: min(300px, calc(100% - 20px));
  display: flex; flex-direction: column; gap: 4px; pointer-events: none;
}
.mw-feed-line { background: rgba(20,24,36,.7); color: #fff; font-size: 13px; padding: 5px 10px; border-radius: 10px; line-height: 1.35; width: fit-content; max-width: 100%; animation: mw-fade 10s forwards; }
.mw-feed-line b { font-weight: 650; }
.mw-feed.in-game { left: auto; right: 10px; bottom: 70px; align-items: flex-end; width: min(260px, calc(100% - 20px)); }
.mw-feed-line.system { background: rgba(91, 58, 142, .85); }
.mw-feed-line.good { background: rgba(47, 158, 68, .9); }
@keyframes mw-fade { 0%, 80% { opacity: 1; } 100% { opacity: 0; } }
.mw-people { display: flex; align-items: center; }
.mw-dot { width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--bg); margin-left: -8px; }
.mw-dot:first-child { margin-left: 0; }

/* 3D plaza */
.mw-name {
  position: absolute; left: 0; top: calc(var(--foot, 60px) + 6px); transform: translateX(-50%);
  white-space: nowrap; font-size: 12px; font-weight: 650; color: #fff; background: rgba(20,24,36,.7);
  padding: 2px 9px; border-radius: 999px;
}
.mw-name.host { background: rgba(214,150,10,.92); }
.mw-bubble {
  position: absolute; left: 0; bottom: 4px; translate: -50% 0; width: max-content; max-width: 200px;
  background: #fff; color: #1f2430; font-size: 13px; line-height: 1.35; padding: 6px 10px; border-radius: 12px;
  box-shadow: 0 4px 14px rgba(0,0,0,.18); animation: mw-up .2s ease;
}
@keyframes mw-hop { from { transform: translate(-50%, 0); } to { transform: translate(-50%, -8px); } }

/* island UI */
.mw-minimap {
  position: absolute; top: 10px; right: 10px; z-index: 5; width: min(170px, 34vw); height: auto;
  border-radius: 14px; background: rgba(74,163,223,.85); padding: 4px; box-shadow: 0 6px 18px rgba(0,0,0,.25); cursor: pointer;
}
.mw-action { max-height: 340px; overflow-y: auto; overscroll-behavior: contain; }
.mw-card-x { position: absolute; top: 6px; right: 6px; min-width: 40px; min-height: 40px; border: 0; background: none; color: var(--muted); font-size: 22px; cursor: pointer; border-radius: 10px; }
.mw-card-x:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); }
.mw-kart { position: fixed; inset: 0; z-index: 60; background: #1a1036; }
.mw-kart iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
/* Top right: each game keeps its own status text top left and touch controls in the bottom corners. */
.mw-kart-close { position: absolute; right: max(12px, env(safe-area-inset-right)); top: max(64px, calc(var(--mobius-safe-top, 0px) + 56px)); z-index: 2; opacity: .9; }
.mw-kart:not(.mw-ghostdrop) .mw-kart-close { top: max(152px, calc(var(--mobius-safe-top, 0px) + 152px)); } /* below Kart's mini-map */
.mw-kart-board { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 4px; counter-reset: kart; }
.mw-kart-board li { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-radius: 10px; background: var(--surface); font-size: 13px; counter-increment: kart; }
.mw-kart-board li::before { content: counter(kart); width: 14px; color: var(--muted); font-weight: 700; }
.mw-kart-board li b { flex: 1; }
.mw-kart-board li span:last-child { font-variant-numeric: tabular-nums; }
.mw-kart-dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }
.mw-results { bottom: auto; top: 12px; animation: mw-results-in .35s cubic-bezier(.2,1.3,.4,1); }
.mw-results h4 { padding-right: 34px; }
.mw-results-list { counter-reset: none; margin-top: 0; }
.mw-results-list li { counter-increment: none; }
.mw-results-list li::before { content: none; }
.mw-results-list li.you { background: color-mix(in srgb, var(--accent) 22%, var(--surface)); }
.mw-results-list li:first-child .mw-place { color: #e0a800; }
.mw-place { width: 30px; flex: none; font-weight: 800; color: var(--muted); font-variant-numeric: tabular-nums; }
@keyframes mw-results-in { from { opacity: 0; transform: translate(-50%, -12px) scale(.96); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@media (prefers-reduced-motion: reduce) { .mw-results { animation: none; } }

/* games */
@media (max-width: 700px) {
  .mw-game-body { flex-direction: column; }
  .mw-side { width: auto; flex-direction: row; overflow-x: auto; overflow-y: hidden; flex: none; }
  .mw-score { flex: none; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}

.mw-lobby-world { position: absolute; inset: 0; background: #140f33; }
.mw-lobby-world iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
.mw-arrive { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 12px; text-align: center; padding: 24px;
  color: #efeaff; background: radial-gradient(ellipse at 50% 40%, #2b1f5c 0%, #140f33 70%); }
.mw-arrive b { font-size: 18px; font-weight: 650; }
.mw-arrive span { font-size: 14px; color: #c9bff5; max-width: 340px; }
.mw-arrive-bar { display: block; width: 220px; height: 6px; border-radius: 99px; background: rgba(255,255,255,.14); overflow: hidden; }
.mw-arrive-bar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #ff4fd8, #3de0ff); transition: width .3s ease; }
.mw-seat-bar { position: absolute; left: 50%; transform: translateX(-50%); bottom: 150px; z-index: 6; display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px; border-radius: 999px; background: rgba(40,28,80,.92); color: #fff; font-weight: 600; font-size: 14px; box-shadow: 0 6px 20px rgba(0,0,0,.35); white-space: nowrap; max-width: calc(100% - 24px); }
.mw-kart-nudge { position: absolute; left: 50%; transform: translateX(-50%); bottom: 150px; z-index: 6; box-shadow: 0 6px 20px rgba(0,0,0,.35); }
.mw-wide { width: 100%; }
.mw-store { width: min(400px, calc(100% - 24px)); max-height: min(460px, calc(100% - 32px)); }
.mw-store-shelves { display: flex; gap: 6px; overflow-x: auto; margin: 0 -2px 8px; padding: 2px; scrollbar-width: none; }
.mw-store-chip { flex: none; min-height: 34px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; font-size: 13px; cursor: pointer; }
.mw-store-chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.mw-store-chip:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); }
.mw-store-list { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 2px; }
.mw-store-row { display: flex; align-items: center; gap: 10px; padding: 7px 4px; border-radius: 12px; }
.mw-store-row + .mw-store-row { border-top: 1px solid var(--border); }
.mw-store-row img { width: 44px; height: 44px; border-radius: 11px; flex: none; box-shadow: 0 2px 8px rgba(0,0,0,.18); }
.mw-store-row .mw-grow { min-width: 0; display: grid; gap: 1px; }
.mw-store-row b { font-size: 14px; font-weight: 650; display: flex; align-items: center; gap: 6px; }
.mw-store-row .mw-grow span { font-size: 12.5px; color: var(--muted); line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mw-store-row .mw-btn { flex: none; min-width: 64px; }
.mw-store-pick { font-size: 10.5px; font-weight: 700; letter-spacing: .02em; padding: 1px 7px; border-radius: 999px; background: #ff4fd8; color: #fff; }
.mw-store-wait { width: 64px; height: 32px; border-radius: 10px; background: var(--surface); flex: none; }
.mw-store { display: flex; flex-direction: column; max-height: min(560px, calc(100% - 32px)); }
.mw-store-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.mw-store > :not(.mw-store-list) { flex: none; }
.mw-store-search { display: block; margin: 0 0 8px; }
.mw-store-search .mw-input { min-height: 42px; }
.mw-store-letter { flex: none; display: grid; place-items: center; border-radius: 11px; font-weight: 700; color: #fff; background: linear-gradient(160deg, #5b3a8e, #e0719a); }
.mw-store-empty { padding: 14px 4px; text-align: center; color: var(--muted); font-size: 13.5px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.mw-store-note { font-size: 12.5px; color: var(--muted); margin: 0 0 8px; line-height: 1.4; overflow-wrap: anywhere; }
.mw-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.mw-action .mw-small { margin: 0 0 6px; }
.mw-action .mw-btn + .mw-small { margin-top: 6px; }
@media (prefers-reduced-motion: reduce) { .mw-arrive-bar i { transition: none; } }
`
