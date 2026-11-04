(() => {
  // Keep only one controller per tab, even if Brave injects this file more than once.
  if (globalThis.__pagePaletteController) {
    globalThis.__pagePaletteController.refresh();
    return;
  }

  // Read only the saved appearance choice for this website.
  const STORAGE_KEY = "pagePaletteSites";
  const siteKey = window.location.origin;
  let ownedStyle = null;
  let stopped = false;

  // Reject arbitrary CSS; only six-digit hexadecimal colors may enter the stylesheet.
  function safeColor(value, fallback) {
    return typeof value === "string" && /^#[\da-fA-F]{6}$/.test(value)
      ? value
      : fallback;
  }

  // Apply colors to page surfaces without destroying website styling.
  function buildStyles(settings) {
    const background = safeColor(settings.background, "#f7f1e7");
    const ink = safeColor(settings.text, "#292622");

    return `
      :root {
        color-scheme: light !important;
      }

      html, body {
        background-color: ${background} !important;
        color: ${ink} !important;
      }

      /* Recolor major content surfaces instead of every element. */
      :where(main, [role="main"], [data-testid="primaryColumn"], [data-testid="sidebarColumn"]) {
        background-color: ${background} !important;
        color: ${ink} !important;
      }

      /* Adjust ordinary text without changing links or buttons. */
      :where(main, [role="main"]) :where(h1, h2, h3, h4, h5, h6, p) {
        color: ${ink} !important;
      }

      /* Preserve the website's original interactive styling. */
      body ::selection {
        background-color: #bfd2f5 !important;
        color: #141414 !important;
      }
    `;
  }

  // Track the actual element we created; never query a potentially page-owned ID.
  function removeStyle() {
    ownedStyle?.remove();
    ownedStyle = null;
  }

  // When site access is turned off, remove both our style and our storage listener.
  function stop() {
    if (stopped) return;
    stopped = true;
    removeStyle();
    chrome.storage.onChanged.removeListener(onStorageChanged);
    delete globalThis.__pagePaletteController;
  }

  // Repaint only when the site remains enabled in the extension's local settings.
  function render(settings) {
    if (!settings?.enabled) {
      stop();
      return;
    }

    if (!ownedStyle || !ownedStyle.isConnected) {
      const parent = document.head || document.documentElement;
      // At document_start, the page's root may not exist yet.
      if (!parent) {
        document.addEventListener(
          "DOMContentLoaded",
          () => {
            if (!stopped) refresh();
          },
          { once: true },
        );
        return;
      }
      ownedStyle = document.createElement("style");
      ownedStyle.setAttribute("data-page-palette", "1");
      parent.appendChild(ownedStyle);
    }
    ownedStyle.textContent = buildStyles(settings);
  }

  // Read settings on initial injection and whenever this tab is refreshed.
  async function refresh() {
    if (stopped) return;
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      // An earlier read must not revive styling after a site is disabled.
      if (!stopped) render(result[STORAGE_KEY]?.[siteKey]);
    } catch {
      // Fail safely: remove styling when browser storage is unavailable.
      stop();
    }
  }

  // Update or remove the style when the popup changes this site's preference.
  function onStorageChanged(changes, area) {
    if (area === "local" && changes[STORAGE_KEY]) {
      render(changes[STORAGE_KEY].newValue?.[siteKey]);
    }
  }

  // Keep this controller isolated from the webpage's own JavaScript environment.
  globalThis.__pagePaletteController = { refresh };
  chrome.storage.onChanged.addListener(onStorageChanged);
  refresh();
})();
