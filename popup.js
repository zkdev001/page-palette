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
  $("pick-element").disabled = value || !isEnabled;
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
  renderCustom();
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
  const current = await chrome.storage.local.get(SITES_KEY);
  sites = current[SITES_KEY] || {};
  sites[siteKey] = {
    ...sites[siteKey],
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

// Keep element overrides separate from general site colors and personal defaults.
function elementsKey() { return `pagePaletteElements:${siteKey}`; }
let customRenderVersion = 0;

// Send commands to the top-level page only, with an actionable error on restricted pages.
async function pageCommand(type, id) {
  const response = await chrome.tabs.sendMessage(tabId, { type, id }, { frameId: 0 });
  if (!response?.ok) throw new Error(response?.error || "Refresh the page and try again.");
  return response;
}

// Render stored entries using text nodes, never page-derived HTML.
async function renderCustom() {
  const version = ++customRenderVersion;
  $("pick-element").disabled = !isEnabled || isBusy;
  if (!siteKey) return;
  try {
    const stored = await chrome.storage.local.get(elementsKey());
    const entries = Array.isArray(stored[elementsKey()]) ? stored[elementsKey()] : [];
    let statuses = {};
    if (isEnabled) {
      try { statuses = (await pageCommand("palette:status")).statuses; } catch { /* Show saved controls even when the tab needs a refresh. */ }
    }
    if (version !== customRenderVersion) return;
    const list = $("custom-list");
    list.replaceChildren();
    $("custom-count").textContent = String(entries.length);
    $("custom-hint").textContent = isEnabled ? "Pick a section to customize. Changes are saved for its page on this site." : "Enable this site to pick or highlight elements. Saved overrides are kept.";
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No custom elements saved for this site.";
      list.append(empty);
    }
    for (const entry of entries) {
      if (!entry || typeof entry.id !== "string") continue;
      const card = document.createElement("div");
      card.className = "custom-card";
      const name = document.createElement("input");
      name.type = "text";
      name.maxLength = 80;
      name.value = entry.name || "Custom element";
      name.setAttribute("aria-label", "Element name");
      name.addEventListener("change", () => updateElement(entry.id, (item) => ({ ...item, name: name.value.trim() || "Custom element" })));
      const detail = document.createElement("p");
      detail.className = "hint target-status";
      detail.textContent = `${entry.path || "/"} · ${isEnabled ? statuses[entry.id] || "Refresh page to locate" : "Site is disabled"}`;
      card.append(name, detail);
      for (const [key, label] of Object.entries({ background: "Background", text: "Text", border: "Border" })) {
        const row = document.createElement("label");
        row.className = "custom-color";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = Boolean(safeColor(entry.colors?.[key], null));
        check.setAttribute("aria-label", `Override ${label.toLowerCase()} for ${entry.name}`);
        const color = document.createElement("input");
        color.type = "color";
        color.value = safeColor(entry.colors?.[key], key === "text" ? "#f2f2f2" : "#282c34");
        color.disabled = !check.checked;
        color.setAttribute("aria-label", `${label} for ${entry.name}`);
        const change = () => updateElement(entry.id, (item) => {
          const colors = { ...item.colors };
          if (check.checked) colors[key] = color.value;
          else delete colors[key];
          return { ...item, colors };
        });
        check.addEventListener("change", change);
        color.addEventListener("change", change);
        row.append(check, document.createTextNode(label), color);
        card.append(row);
      }
      const actions = document.createElement("div");
      actions.className = "custom-actions";
      const toggle = document.createElement("button");
      toggle.textContent = entry.enabled === false ? "Enable" : "Disable";
      toggle.setAttribute("aria-label", `${toggle.textContent} ${entry.name}`);
      toggle.addEventListener("click", () => updateElement(entry.id, (item) => ({ ...item, enabled: item.enabled === false })));
      const show = document.createElement("button");
      show.textContent = "Show on page";
      show.disabled = !isEnabled || statuses[entry.id] !== "Found on this page";
      show.addEventListener("click", async () => {
        try { await pageCommand("palette:show", entry.id); window.close(); }
        catch (error) { message(error.message, true); }
      });
      const remove = document.createElement("button");
      remove.textContent = "Delete";
      remove.className = "delete-element";
      remove.setAttribute("aria-label", `Delete ${entry.name}`);
      remove.addEventListener("click", () => updateElement(entry.id, () => null));
      actions.append(toggle, show, remove);
      card.append(actions);
      list.append(card);
    }
  } catch (error) { message(`Could not load custom elements: ${error.message}`, true); }
}

// Read fresh records before editing so general colors and other sites remain untouched.
async function updateElement(id, update) {
  if (isBusy || !siteKey) return;
  setBusy(true);
  for (const control of $("custom-list").querySelectorAll("button,input")) control.disabled = true;
  try {
    const key = elementsKey();
    const stored = await chrome.storage.local.get(key);
    const entries = Array.isArray(stored[key]) ? stored[key] : [];
    await chrome.storage.local.set({ [key]: entries.map((item) => item.id === id ? update(item) : item).filter(Boolean) });
    message("Custom element updated.");
  } catch (error) { message(`Could not save: ${error.message}`, true); }
  finally { setBusy(false); await renderCustom(); }
}

// Inject only after verified opt-in; the floating picker survives closing this popup.
$("pick-element").addEventListener("click", async () => {
  if (!isEnabled || isBusy) return;
  setBusy(true);
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await pageCommand("palette:pick");
    window.close();
  } catch (error) { message(`Could not open picker: ${error.message}`, true); }
  finally { setBusy(false); }
});

// Reflect saved selections from the floating picker when the popup is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && siteKey && changes[elementsKey()] && !isBusy) renderCustom();
});

start();
