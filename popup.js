// Reuse previously saved site choices from Page Palette 1.0.
const SITES_KEY = "pagePaletteSites";
const DEFAULT_KEY = "pagePaletteDefault";
const STARTER_DEFAULT = { background: "#f7f1e7", text: "#292622" };
const PRESETS = {
  paper: { background: "#f7f1e7", text: "#292622" },
  gray: { background: "#e9ecf0", text: "#23282d" },
  white: { background: "#ffffff", text: "#202124" }
};

const $ = (id) => document.getElementById(id);
const siteLabel = $("site");
const accessButton = $("site-access");
const accessState = $("access-state");
const bgPicker = $("background");
const inkPicker = $("text-color");
const preview = $("preview");
const status = $("status");
const allButtons = [accessButton, $("use-default"), $("save-default"), ...document.querySelectorAll("[data-preset]")];

let siteKey = null;
let matchPattern = null;
let tabId = null;
let isEnabled = false;
let isBusy = false;
let defaults = { ...STARTER_DEFAULT };
let sites = {};

// Accept only safe, six-digit hex colors before saving or displaying them.
function safeColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
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
  for (const control of [...allButtons, bgPicker, inkPicker]) control.disabled = value;
}

// Match only the active site's host and protocol; URL fragments and paths are not needed.
function sitePattern(url) {
  return `${url.protocol}//${url.hostname}/*`;
}

// Use an origin-derived, stable registration ID for the site's automatic restyling.
function scriptId() {
  return `page-palette-${btoa(siteKey).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

// Keep permissions and the UI in agreement after enabling or disabling a site.
function showAccess(enabled) {
  isEnabled = enabled;
  accessState.textContent = enabled ? "On" : "Off";
  accessState.classList.toggle("on", enabled);
  accessButton.textContent = enabled ? "Disable on this site" : "Enable on this site";
  accessButton.classList.toggle("enabled", enabled);
}

// Save site settings without affecting other previously configured websites.
async function saveSite(colors = { background: bgPicker.value, text: inkPicker.value }, enabled = isEnabled) {
  sites[siteKey] = {
    enabled,
    background: safeColor(colors.background, defaults.background),
    text: safeColor(colors.text, defaults.text)
  };
  await chrome.storage.local.set({ [SITES_KEY]: sites });
}

// Register an opt-in content script that survives website navigation and browser restart.
async function registerSite() {
  const id = scriptId();
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (registered.length) return;
  await chrome.scripting.registerContentScripts([{
    id,
    matches: [matchPattern],
    js: ["content.js"],
    runAt: "document_start",
    persistAcrossSessions: true
  }]);
}

// Stop future injections into this site once access is disabled.
async function unregisterSite() {
  const id = scriptId();
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  }
}

// Enable only after the person clicks the access button and grants Brave permission.
async function enableSite() {
  // This permission request must begin directly inside the button-click gesture.
  const grantedPromise = chrome.permissions.request({ origins: [matchPattern] });
  setBusy(true);
  try {
    const granted = await grantedPromise;
    if (!granted) {
      message("Website permission was not granted.", true);
      return;
    }

    // Register first so the extension continues working after navigation.
    await registerSite();
    await saveSite(undefined, true);

    // Apply colors immediately to the already-open page as well.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    showAccess(true);
    message("Enabled on this website.");
  } catch (error) {
    // Avoid leaving permission behind if enabling fails partway through.
    try {
      await saveSite(undefined, false);
      await unregisterSite();
      await chrome.permissions.remove({ origins: [matchPattern] });
    } catch {
      // A later attempt to disable can clean up any incomplete registration.
    }
    showAccess(false);
    message(`Could not enable: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

// Immediately remove the saved override, future injections, and site access.
async function disableSite() {
  setBusy(true);
  try {
    // Storage notification makes already-open content scripts remove their styles.
    await saveSite(undefined, false);
    await unregisterSite();
    await chrome.permissions.remove({ origins: [matchPattern] });
    // Verify that Brave has actually revoked the site's host permission.
    const stillAllowed = await chrome.permissions.contains({ origins: [matchPattern] });
    showAccess(false);
    message(stillAllowed ? "Styles disabled, but site permission remains. Review Brave's extension site access." : "Disabled and site access removed.", stillAllowed);
  } catch (error) {
    message(`Could not fully disable: ${error.message}`, true);
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
    message(isEnabled ? "Colors updated on this site." : "Saved. Enable this site to apply the colors.");
  } catch (error) {
    message(`Could not save colors: ${error.message}`, true);
  }
}

// Initialize without requesting access or injecting anything into the webpage.
async function start() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url);
    if (!/^https?:$/.test(url.protocol)) {
      throw new Error("Only regular HTTP/HTTPS websites are supported.");
    }
    if (!Number.isInteger(tab?.id)) throw new Error("No active website tab was found.");
    tabId = tab.id;
    siteKey = url.origin;
    matchPattern = sitePattern(url);
    siteLabel.textContent = url.hostname;

    const values = await chrome.storage.local.get([SITES_KEY, DEFAULT_KEY]);
    sites = values[SITES_KEY] && typeof values[SITES_KEY] === "object" ? values[SITES_KEY] : {};
    const storedDefault = values[DEFAULT_KEY] || STARTER_DEFAULT;
    defaults = {
      background: safeColor(storedDefault.background, STARTER_DEFAULT.background),
      text: safeColor(storedDefault.text, STARTER_DEFAULT.text)
    };
    showColors(sites[siteKey] || defaults);
    const hasPermission = await chrome.permissions.contains({ origins: [matchPattern] });
    const enabled = Boolean(sites[siteKey]?.enabled && hasPermission);
    showAccess(enabled);
    message(enabled ? "Active on this website." : "Not active on this website.");
  } catch (error) {
    siteLabel.textContent = "Unavailable on this page";
    for (const control of [...allButtons, bgPicker, inkPicker]) control.disabled = true;
    message(error.message, true);
  }
}

// Change permission only via a deliberate click, never merely by opening the popup.
accessButton.addEventListener("click", () => {
  if (isBusy || !siteKey) return;
  if (isEnabled) disableSite();
  else enableSite();
});

// Native browser color pickers provide a popup/modal without additional libraries.
for (const input of [bgPicker, inkPicker]) {
  input.addEventListener("input", () => showColors({ background: bgPicker.value, text: inkPicker.value }));
  input.addEventListener("change", () => saveColors({ background: bgPicker.value, text: inkPicker.value }));
}

// Preset buttons update this site's colors without granting site access.
for (const button of document.querySelectorAll("[data-preset]")) {
  button.addEventListener("click", () => saveColors(PRESETS[button.dataset.preset]));
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
