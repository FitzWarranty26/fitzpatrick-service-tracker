import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (!window.location.hash) {
  window.location.hash = "#/";
}

// Recovery path for stale-bundle chunk load errors. When we deploy a new
// build, any user who still has the old index.html open in a tab will try to
// lazy-load a JS chunk whose hashed filename no longer exists. That surfaces
// as a 'Failed to fetch dynamically imported module' error. Rather than
// leaving the user stuck on a blank / broken page, we force a one-time hard
// reload (using sessionStorage to prevent infinite loops).
function shouldReloadOnChunkError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Loading chunk .+ failed/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /ChunkLoadError/i.test(msg)
  );
}

function handleChunkError(err: unknown) {
  if (!shouldReloadOnChunkError(err)) return;
  try {
    if (sessionStorage.getItem("reloadingForChunk") === "1") return;
    sessionStorage.setItem("reloadingForChunk", "1");
  } catch {
    // no-op — private mode
  }
  // Reload bypassing HTTP cache so we pick up the new index.html + assets.
  window.location.reload();
}

// Clear the reload-loop guard once we've booted successfully.
try {
  sessionStorage.removeItem("reloadingForChunk");
} catch {
  /* no-op */
}

window.addEventListener("error", (e) => handleChunkError(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => handleChunkError(e.reason));

createRoot(document.getElementById("root")!).render(<App />);
