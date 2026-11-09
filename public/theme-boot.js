// Runs before first paint so the window never flashes the wrong theme.
// (External file, not inline, because the CSP has no 'unsafe-inline' for scripts.)
(function () {
  var pref = "system";
  try {
    pref = localStorage.getItem("devomni.theme") || "system";
  } catch (e) {}
  var dark = pref === "dark" || (pref !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var t = dark ? "dark" : "light";
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = t;
})();
