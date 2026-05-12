/** Shared 3D viewer chrome — consistent toolbar / FAB styling
 *  Solid slate backgrounds + `text-white`: with `preflight: false`, native button
 *  defaults (often white) would otherwise hide light-gray label text. */

export const viewerToolbarBtn = [
  "viewer-toolbar-btn",
  "inline-flex min-h-[34px] shrink-0 items-center justify-center rounded-lg",
  "border border-slate-500/60 bg-slate-700 px-3.5 py-1.5",
  "text-xs font-semibold tracking-wide text-white antialiased",
  "shadow-md shadow-black/30",
  "transition hover:border-sky-400/50 hover:bg-slate-600 hover:shadow-lg",
  "active:scale-[0.98]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0d12]",
  "disabled:pointer-events-none disabled:opacity-40",
].join(" ");

/** Overrides base toolbar when lens mode is on */
export const viewerToolbarBtnLensActive =
  "!border-emerald-500 !bg-emerald-700 !text-white shadow-emerald-950/40 hover:!border-emerald-400 hover:!bg-emerald-600";


/** Toggle style (e.g. Wireframe / Solid selected) */
export const viewerToolbarBtnActive = [
  "border-sky-500/70 bg-slate-900 text-sky-100",
  "hover:border-sky-400 hover:bg-slate-800",
].join(" ");

export const viewerMiniBtn = [
  "rounded-md border border-slate-500/60 bg-slate-800 px-2.5 py-1",
  "text-[11px] font-semibold text-white shadow-sm",
  "transition hover:border-sky-500/40 hover:bg-slate-700 active:scale-[0.98]",
].join(" ");

export const viewerNextFab = [
  "rounded-xl border px-5 py-2.5 text-sm font-semibold tracking-wide antialiased",
  "shadow-xl shadow-black/40 transition",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-[#13171c] active:scale-[0.98]",
].join(" ");

export const viewerNextFabEnabled =
  "border-sky-400/50 bg-sky-600 text-white hover:bg-sky-500 ring-1 ring-white/10";

export const viewerNextFabDisabled =
  "cursor-not-allowed border-slate-600 bg-slate-800 text-slate-400 ring-slate-700";
