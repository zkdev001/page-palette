// Reuse previously saved site choices from Page Palette 1.0.
const SITES_KEY = "pagePaletteSites";
const DEFAULT_KEY = "pagePaletteDefault";
const STARTER_DEFAULT = { background: "#f7f1e7", text: "#292622" };
const PRESETS = {
  paper: { background: "#f7f1e7", text: "#292622" },
  gray: { background: "#e9ecf0", text: "#23282d" },
  white: { background: "#ffffff", text: "#202124" },
};

const $ = (id) => document.getElementById(id);
const siteLabel = $("site");
const accessButton = $("site-access");
const accessState = $("access-state");
const bgPicker = $("background");
const inkPicker = $("text-color");
const preview = $("preview");
const status = $("status");
const allButtons = [
  accessButton,
  $("use-default"),
  $("save-default"),
  ...document.querySelectorAll("[data-preset]"),
];

let siteKey = null;
let matchPattern = null;
let tabId = null;
let isEnabled = false;
// Track whether site access is enabled, disabled, or uncertain.
let accessMode = "unknown";
let isBusy = false;
let defaults = { ...STARTER_DEFAULT };
let sites = {};

// Accept only safe, six-digit hex colors before saving or displaying them.
function safeColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : fallback;
}

// Keep the controls, hex labels, and preview synchronized.
function showColors(colors) {
  bgPicker.value = safeColor(colors.background, defaults.background);
  inkPicker.value = safeColor(colors.text, defaults.text);
  $("background-value").textContent = bgPicker.value;
  $("text-value").textContent = inkPicker.value;
  preview.style.backgroundColor = bgPicker.value;
  preview.style.color = inkPicker.value;
}

// Display a status message without interrupting keyboard or color-picker focus.
function message(value, error = false) {
  status.textContent = value;
  status.classList.toggle("error", error);
}

// Avoid concurrent permission and storage operations caused by rapid clicking.
function setBusy(value) {
  isBusy = value;
  for (const control of [...allButtons, bgPicker, inkPicker])
    control.disabled = value;
}

// Match only the active site's host and protocol; URL fragments and paths are not needed.
function sitePattern(url) {
  return `${url.protocol}//${url.hostname}/*`;
}

// Use an origin-derived, stable registration ID for the site's automatic restyling.
function scriptId() {
  return `page-palette-${btoa(siteKey).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

// Display access status based on verified browser state.
function showAccess(state) {
  const { permission, script, saved } = state;

  // Check whether every browser state was verified.
  const verified = [permission, script, saved].every(
    (value) => typeof value === "boolean",
  );

  // Distinguish fully enabled, fully disabled, and incomplete states.
  accessMode = !verified
    ? "unknown"
    : permission && script && saved
      ? "on"
      : !permission && !script && !saved
        ? "off"
        : "incomplete";

  isEnabled = accessMode === "on";

  // Update the popup status label.
  accessState.textContent = {
    on: "On",
    off: "Off",
    incomplete: "Check access",
    unknown: "Unverified",
  }[accessMode];

  // Highlight incomplete or unverified permissions.
  accessState.classList.toggle("on", isEnabled);
  accessState.classList.toggle(
    "warning",
    accessMode === "incomplete" || accessMode === "unknown",
  );

  // Update the available button action.
  accessButton.textContent = {
    on: "Disable on this site",
    off: "Enable on this site",
    incomplete: "Retry removing site access",
    unknown: "Check site access again",
  }[accessMode];

  accessButton.classList.toggle(
    "enabled",
    accessMode === "on" || accessMode === "incomplete",
  );
}

// Independently inspect saved state, registered scripts, and permissions.
async function inspectAccess() {
  const id = scriptId();

  const checks = await Promise.allSettled([
    chrome.storage.local.get(SITES_KEY),
    chrome.scripting.getRegisteredContentScripts({ ids: [id] }),
    chrome.permissions.contains({ origins: [matchPattern] }),
  ]);

  const [stored, scripts, permission] = checks;

  // Refresh the local site settings when storage is available.
  if (stored.status === "fulfilled") {
    const loadedSites = stored.value[SITES_KEY];
    sites = loadedSites && typeof loadedSites === "object" ? loadedSites : {};
  }

  // Return null for any state that could not be verified.
  return {
    saved:
      stored.status === "fulfilled" ? Boolean(sites[siteKey]?.enabled) : null,
    script: scripts.status === "fulfilled" ? scripts.value.length > 0 : null,
    permission:
      permission.status === "fulfilled" ? permission.value === true : null,
  };
}

// Confirm that every form of site access has been removed.
function fullyDisabled(state) {
  return (
    state.saved === false &&
    state.script === false &&
    state.permission === false
  );
}

// Describe what remains enabled when cleanup is incomplete.
function incompleteAccessMessage(state) {
  if (Object.values(state).some((value) => value === null)) {
    return "Could not verify all site permissions. Retry or review Brave's extension site access.";
  }

  const leftovers = [];

  if (state.permission) leftovers.push("host permission");
  if (state.script) leftovers.push("registered script");
  if (state.saved) leftovers.push("enabled setting");

  return `Cleanup incomplete (${leftovers.join(", ")}). Retry removing site access.`;
}
// Save site settings without affecting other previously configured websites.
async function saveSite(
  colors = { background: bgPicker.value, text: inkPicker.value },
  enabled = isEnabled,
) {
  sites[siteKey] = {
    enabled,
    background: safeColor(colors.background, defaults.background),
    text: safeColor(colors.text, defaults.text),
  };
  await chrome.storage.local.set({ [SITES_KEY]: sites });
}

// Register an opt-in content script that survives website navigation and browser restart.
async function registerSite() {
  const id = scriptId();
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [id],
  });
  if (registered.length) return;
  await chrome.scripting.registerContentScripts([
    {
      id,
      matches: [matchPattern],
      js: ["content.js"],
      runAt: "document_start",
      persistAcrossSessions: true,
    },
  ]);
}

// Stop future injections into this site once access is disabled.
async function unregisterSite() {
  const id = scriptId();
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [id],
  });
  if (registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  }
}

// Attempt every cleanup operation, even if another operation fails.
async function cleanupSite() {
  await Promise.allSettled([
    saveSite(undefined, false),
    unregisterSite(),
    chrome.permissions.remove({ origins: [matchPattern] }),
  ]);

  // Verify the actual browser state after cleanup.
  const state = await inspectAccess();
  showAccess(state);

  return state;
}

// Request permission and enable styling for the current website.
async function enableSite() {
  setBusy(true);

  try {
    // Request permission directly from the user's click action.
    const granted = await chrome.permissions.request({
      origins: [matchPattern],
    });

    if (!granted) {
      message("Website permission was not granted.", true);
      return;
    }

    // Register the content script and save the enabled state.
    await registerSite();
    await saveSite(undefined, true);

    // Apply styling to the already-open tab.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });

    // Verify that enabling succeeded.
    const state = await inspectAccess();
    showAccess(state);

    if (accessMode !== "on") {
      throw new Error("Site access could not be verified");
    }

    message("Enabled on this website.");
  } catch (error) {
    // Independently clean up permissions, scripts, and settings.
    const state = await cleanupSite();

    message(
      fullyDisabled(state)
        ? `Could not enable (${error.message}). All site access was removed.`
        : `Could not enable (${error.message}). ${incompleteAccessMessage(state)}`,
      true,
    );
  } finally {
    setBusy(false);
  }
}

// Disable the site and verify that access was actually removed.
async function disableSite() {
  setBusy(true);

  try {
    // Attempt all cleanup operations and inspect their results.
    const state = await cleanupSite();

    message(
      fullyDisabled(state)
        ? "Disabled and site access removed."
        : incompleteAccessMessage(state),
      !fullyDisabled(state),
    );
  } catch (error) {
    // Never display Off when verification fails.
    showAccess({
      saved: null,
      script: null,
      permission: null,
    });

    message(`Could not verify site access: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

// Save color adjustments, including choices made before enabling a website.
async function saveColors(colors) {
  if (!siteKey || isBusy) return;
  showColors(colors);
  try {
    await saveSite(colors);
    message(
      isEnabled
        ? "Colors updated on this site."
        : "Saved. Enable this site to apply the colors.",
    );
  } catch (error) {
    message(`Could not save colors: ${error.message}`, true);
  }
}

// Initialize without requesting access or injecting anything into the webpage.
async function start() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const url = new URL(tab?.url);
    if (!/^https?:$/.test(url.protocol)) {
      throw new Error("Only regular HTTP/HTTPS websites are supported.");
    }
    if (!Number.isInteger(tab?.id))
      throw new Error("No active website tab was found.");
    tabId = tab.id;
    siteKey = url.origin;
    matchPattern = sitePattern(url);
    siteLabel.textContent = url.hostname;

    const values = await chrome.storage.local.get([SITES_KEY, DEFAULT_KEY]);
    sites =
      values[SITES_KEY] && typeof values[SITES_KEY] === "object"
        ? values[SITES_KEY]
        : {};
    const storedDefault = values[DEFAULT_KEY] || STARTER_DEFAULT;
    defaults = {
      background: safeColor(
        storedDefault.background,
        STARTER_DEFAULT.background,
      ),
      text: safeColor(storedDefault.text, STARTER_DEFAULT.text),
    };
    showColors(sites[siteKey] || defaults);
    // Verify all three access states when opening the popup.
    const state = await inspectAccess();
    showAccess(state);

    // Explain the verified result to the user.
    message(
      accessMode === "on"
        ? "Active on this website."
        : accessMode === "off"
          ? "Not active on this website."
          : accessMode === "incomplete"
            ? incompleteAccessMessage(state)
            : "Unable to verify site access. Click Check site access again.",
      accessMode === "incomplete" || accessMode === "unknown",
    );
  } catch (error) {
    siteLabel.textContent = "Unavailable on this page";
    for (const control of [...allButtons, bgPicker, inkPicker])
      control.disabled = true;
    message(error.message, true);
  }
}

// Choose the action based on the verified access state.
accessButton.addEventListener("click", () => {
  if (isBusy || !siteKey) return;

  // Enable only when access is confirmed off.
  if (accessMode === "off") {
    enableSite();
  } else if (accessMode === "unknown") {
    // Recheck permissions without granting additional access.
    setBusy(true);

    inspectAccess()
      .then((state) => {
        showAccess(state);

        message(
          accessMode === "on"
            ? "Active on this website."
            : accessMode === "off"
              ? "Not active on this website."
              : incompleteAccessMessage(state),
          accessMode !== "on" && accessMode !== "off",
        );
      })
      .catch((error) => {
        message(`Could not check access: ${error.message}`, true);
      })
      .finally(() => setBusy(false));
  } else {
    // Disable fully enabled or partially enabled sites.
    disableSite();
  }
});

// Native browser color pickers provide a popup/modal without additional libraries.
for (const input of [bgPicker, inkPicker]) {
  input.addEventListener("input", () =>
    showColors({ background: bgPicker.value, text: inkPicker.value }),
  );
  input.addEventListener("change", () =>
    saveColors({ background: bgPicker.value, text: inkPicker.value }),
  );
}

// Preset buttons update this site's colors without granting site access.
for (const button of document.querySelectorAll("[data-preset]")) {
  button.addEventListener("click", () =>
    saveColors(PRESETS[button.dataset.preset]),
  );
}

// Restore the global default to the current website without affecting other sites.
$("use-default").addEventListener("click", () => saveColors(defaults));

// Allow a custom color to become the default for websites enabled in the future.
$("save-default").addEventListener("click", async () => {
  if (isBusy || !siteKey) return;
  defaults = { background: bgPicker.value, text: inkPicker.value };
  try {
    await chrome.storage.local.set({ [DEFAULT_KEY]: defaults });
    message("Your default colors were saved.");
  } catch (error) {
    message(`Could not save default: ${error.message}`, true);
  }
});

start();
