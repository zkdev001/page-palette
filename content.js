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
  // Store custom overrides separately so ordinary site-color updates cannot erase them.
  const ELEMENTS_KEY = `pagePaletteElements:${siteKey}`;
  const custom = createCustomElements();

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
    custom.stop();
    chrome.runtime.onMessage.removeListener(onMessage);
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
    custom.enable();
  }

  // Read settings on initial injection and whenever this tab is refreshed.
  async function refresh() {
    if (stopped) return;
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY, ELEMENTS_KEY]);
      // An earlier read must not revive styling after a site is disabled.
      if (!stopped) {
        custom.load(result[ELEMENTS_KEY]);
        render(result[STORAGE_KEY]?.[siteKey]);
      }
    } catch {
      // Fail safely: remove styling when browser storage is unavailable.
      stop();
    }
  }

  // Update or remove the style when the popup changes this site's preference.
  function onStorageChanged(changes, area) {
    if (area === "local" && changes[ELEMENTS_KEY]) {
      custom.load(changes[ELEMENTS_KEY].newValue);
    }
    if (area === "local" && changes[STORAGE_KEY]) {
      render(changes[STORAGE_KEY].newValue?.[siteKey]);
    }
  }

  // Own all custom styles and picker UI so removal never changes website-owned rules.
  function createCustomElements() {
    const PROPERTIES = { background: "background-color", text: "color", border: "border-color" };
    let entries = [];
    let enabled = false;
    let sheet = null;
    let observer = null;
    let timer = null;
    let picker = null;
    let flashCleanup = null;

    // Convert validated locator parts into escaped selectors; never accept raw CSS from storage.
    function selectorFor(locator) {
      if (!Array.isArray(locator) || !locator.length || locator.length > 64) return null;
      const parts = [];
      for (const part of locator) {
        if (!part || !/^[a-z][a-z0-9-]*$/.test(part.tag)) return null;
        let value = part.tag;
        if (typeof part.id === "string" && part.id.length <= 256 && part.id) value += `#${CSS.escape(part.id)}`;
        if (!Array.isArray(part.classes) || part.classes.length > 30) return null;
        for (const name of part.classes) {
          if (typeof name !== "string" || !name || name.length > 256) return null;
          value += `.${CSS.escape(name)}`;
        }
        if (part.nth !== undefined) {
          if (!Number.isInteger(part.nth) || part.nth < 1) return null;
          value += `:nth-of-type(${part.nth})`;
        }
        parts.push(value);
      }
      return parts.join(" > ");
    }

    // Require a unique match on the saved path rather than guessing a replacement target.
    function resolve(entry) {
      if (entry.path !== location.pathname) return { state: "Saved on another page" };
      const selector = selectorFor(entry.locator);
      if (!selector) return { state: "Invalid target" };
      try {
        const matches = document.querySelectorAll(selector);
        if (matches.length !== 1) return { state: matches.length ? "Target is ambiguous" : "Element not found" };
        return { state: "Found on this page", element: matches[0], selector };
      } catch {
        return { state: "Invalid target" };
      }
    }

    // Prefer an ID or unique class anchor, adding parent structure only when needed.
    function locate(element) {
      const path = [];
      for (let node = element; node && path.length < 64; node = node.parentElement) {
        const part = {
          tag: node.localName,
          classes: [...node.classList].filter((name) => name.length <= 256).slice(0, 30),
        };
        if (node.id && node.id.length <= 256) part.id = node.id;
        path.unshift(part);
        let selector = selectorFor(path);
        if (selector && document.querySelectorAll(selector).length === 1) return path;
        // Disambiguate siblings while retaining tag and class checks.
        part.nth = [...(node.parentElement?.children || [node])].filter((child) => child.localName === node.localName).indexOf(node) + 1;
        selector = selectorFor(path);
        if (selector && document.querySelectorAll(selector).length === 1) return path;
      }
      throw new Error("This element cannot be identified reliably.");
    }

    // Generate only supported color declarations; unchecked properties remain untouched.
    function declarations(colors) {
      return Object.entries(PROPERTIES).flatMap(([key, property]) => {
        const color = safeColor(colors?.[key], null);
        return color ? [`${property}: ${color} !important;`] : [];
      }).join("\n");
    }

    // Give custom rules priority over ordinary site and Page Palette styles.
    function rule(selector, colors) {
      const specificity = ":not(#page-palette-reserved-a):not(#page-palette-reserved-b):not(#page-palette-reserved-c)";
      return `${selector}${specificity} { ${declarations(colors)} }`;
    }

    // Rebuild our sheet without modifying inline styles or any website stylesheet.
    function repaint() {
      if (!enabled || !document.documentElement) return;
      if (!sheet?.isConnected) {
        sheet = document.createElement("style");
        document.documentElement.append(sheet);
      }
      const rules = [];
      for (const entry of entries) {
        if (entry.enabled === false) continue;
        const target = resolve(entry);
        if (target.element) rules.push(rule(target.selector, entry.colors));
      }
      const css = rules.join("\n");
      if (sheet.textContent !== css) sheet.textContent = css;
      // Cancel a preview if the site has removed its selected element.
      if (picker?.selected && !picker.selected.isConnected) picker.close();
    }

    // Coalesce DOM changes and ignore our own UI and styles to avoid observer loops.
    function observe() {
      if (observer || !document.documentElement) return;
      observer = new MutationObserver((changes) => {
        if (!changes.some((change) => change.target !== sheet && change.target !== ownedStyle && change.target !== picker?.previewStyle && change.target !== picker?.cursorStyle)) return;
        if (timer !== null) return;
        timer = setTimeout(() => { timer = null; repaint(); }, 100);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "id"] });
    }

    // Isolate the picker from site CSS and keep the overlay out of document layout.
    function overlay() {
      const host = document.createElement("div");
      host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;";
      const root = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = `
        :host { color-scheme: light; }
        * { box-sizing: border-box; }
        .outline { position:fixed; border:3px solid #67c9ff; background:rgba(103,201,255,.08); pointer-events:none; }
        .panel { position:fixed; right:16px; top:16px; width:320px; max-width:calc(100vw - 32px); max-height:calc(100vh - 32px); overflow:auto; padding:16px; background:#282c34; color:#f2f2f2; border:1px solid #aab5c5; border-radius:12px; box-shadow:0 8px 32px #0008; pointer-events:auto; font:14px/1.5 system-ui,sans-serif; }
        h2 { font-size:17px; margin:0 0 8px; } p { margin:8px 0; }
        button,input { font:inherit; } button { border:1px solid #aab5c5; border-radius:6px; background:#f2f2f2; color:#20242c; padding:7px 10px; cursor:pointer; }
        button:disabled { opacity:.45; cursor:not-allowed; } button:focus-visible,input:focus-visible { outline:3px solid #67c9ff; outline-offset:2px; }
        .actions { display:flex; flex-wrap:wrap; gap:7px; margin-top:12px; }
        label { display:flex; align-items:center; gap:8px; margin:10px 0; }
        input[type=text] { width:100%; padding:7px; border:1px solid #aab5c5; border-radius:5px; background:#fff; color:#20242c; }
        input[type=color] { margin-left:auto; width:48px; height:32px; } input[type=checkbox] { width:16px; height:16px; }
        .target { overflow-wrap:anywhere; color:#b9dfff; } .hint { color:#c4ccd8; font-size:12px; } .error { color:#ffb4b4; } [hidden] { display:none!important; }
      `;
      const outline = document.createElement("div");
      outline.className = "outline";
      outline.hidden = true;
      root.append(style, outline);
      document.documentElement.append(host);
      const highlight = (element) => {
        outline.hidden = !element?.isConnected;
        if (outline.hidden) return;
        const rect = element.getBoundingClientRect();
        Object.assign(outline.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      };
      return { host, root, highlight };
    }

    // Start a self-contained picker that continues after the extension popup closes.
    function pick() {
      picker?.close();
      flashCleanup?.();
      const view = overlay();
      const panel = document.createElement("section");
      panel.className = "panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Page Palette element picker");
      // This template is static; names and page data are assigned through textContent/value.
      panel.innerHTML = `
        <h2>Page Palette</h2>
        <p class="instructions">Hover to highlight an element, then click to select it.</p>
        <div class="editor" hidden>
          <p class="target"></p>
          <div class="actions"><button class="larger">Select larger area</button><button class="smaller">Back to smaller area</button><button class="repick">Pick another</button></div>
          <label for="element-name">Name</label><input id="element-name" type="text" maxlength="80" />
          <div class="colors"></div>
          <p class="hint">Checked colors preview immediately. Saved for this page on this site.</p>
        </div>
        <p class="feedback" role="status" aria-live="polite"></p>
        <div class="actions"><button class="save" disabled>Save</button><button class="cancel">Cancel</button></div>
        <p class="hint">Escape cancels without saving.</p>`;
      view.root.append(panel);
      const get = (name) => panel.querySelector(name);
      const previewStyle = document.createElement("style");
      const cursorStyle = document.createElement("style");
      document.documentElement.append(previewStyle, cursorStyle);
      const previousFocus = document.activeElement;
      const session = { selected: null, previewStyle, cursorStyle, close };
      picker = session;
      let hovered = null;
      let history = [];
      let saving = false;
      let closed = false;
      const controls = {};

      // Keep preview state independent from saved entries.
      for (const [key, label] of Object.entries({ background: "Background", text: "Text", border: "Border" })) {
        const row = document.createElement("label");
        const check = document.createElement("input");
        check.type = "checkbox";
        check.setAttribute("aria-label", `Override ${label.toLowerCase()}`);
        const color = document.createElement("input");
        color.type = "color";
        color.setAttribute("aria-label", `${label} color`);
        color.disabled = true;
        row.append(check, document.createTextNode(label), color);
        get(".colors").append(row);
        controls[key] = { check, color };
        check.addEventListener("change", () => { color.disabled = !check.checked; preview(); });
        color.addEventListener("input", preview);
      }

      // Read initial swatches without storing or sending any page content.
      function hex(value) {
        const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
        return channels?.length === 3 ? `#${channels.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}` : "#282c34";
      }

      // Collect only explicitly enabled properties.
      function colors() {
        return Object.fromEntries(Object.entries(controls).filter(([, control]) => control.check.checked).map(([key, control]) => [key, control.color.value]));
      }

      // Update a reversible preview using a separate, owned stylesheet.
      function preview() {
        previewStyle.textContent = "";
        get(".feedback").textContent = "";
        get(".save").disabled = saving || !session.selected || !Object.keys(colors()).length;
        if (!session.selected) return;
        try {
          previewStyle.textContent = rule(selectorFor(locate(session.selected)), colors());
        } catch (error) {
          get(".feedback").textContent = error.message;
          get(".save").disabled = true;
        }
      }

      // Show the exact selected container and retain navigation history.
      function select(element, resetColors = false) {
        previewStyle.textContent = "";
        session.selected = element;
        cursorStyle.textContent = "";
        view.highlight(element);
        get(".editor").hidden = false;
        get(".instructions").textContent = "Adjust the selection and preview your colors.";
        get(".target").textContent = element.localName + (element.id ? ` #${element.id}` : "");
        get("#element-name").value = `${element.localName}${element.id ? ` #${element.id}` : " element"}`.slice(0, 80);
        get(".larger").disabled = !element.parentElement || element === document.documentElement;
        get(".smaller").disabled = !history.length;
        if (resetColors) {
          const computed = getComputedStyle(element);
          for (const [key, control] of Object.entries(controls)) {
            control.check.checked = false;
            control.color.disabled = true;
            control.color.value = hex(computed.getPropertyValue(PROPERTIES[key]));
          }
        }
        preview();
      }

      // Resume selection without leaving a previous preview applied.
      function hunt() {
        session.selected = null;
        hovered = null;
        history = [];
        previewStyle.textContent = "";
        cursorStyle.textContent = "* { cursor: crosshair !important; }";
        view.highlight(null);
        get(".editor").hidden = true;
        get(".save").disabled = true;
        get(".instructions").textContent = "Hover to highlight an element, then click to select it.";
      }

      // Exclude our UI, embedded documents, and non-styleable document nodes.
      function candidate(event) {
        if (event.composedPath().includes(view.host)) return null;
        const element = event.target;
        return element instanceof HTMLElement && !["SCRIPT", "STYLE", "LINK", "META", "HEAD", "IFRAME"].includes(element.tagName) ? element : null;
      }

      // Highlight without suppressing scrolling or moving focus on the website.
      function move(event) {
        if (session.selected || saving) return;
        hovered = candidate(event);
        view.highlight(hovered);
      }

      // Block page actions during picking, including pointer-down handlers and link clicks.
      function intercept(event) {
        if (event.composedPath().includes(view.host)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === "click" && !session.selected && !saving) {
          const target = candidate(event);
          if (target) { select(target, true); get(".larger").focus(); }
        }
      }

      // Escape always rolls back unsaved changes.
      function keyboard(event) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (!saving) close();
          return;
        }
        // Keep keyboard focus inside the editor so Enter cannot activate a page link.
        if (event.key === "Tab") {
          const focusable = [...panel.querySelectorAll("button,input")].filter((control) => !control.disabled && !control.closest("[hidden]"));
          if (!focusable.length) return;
          const index = focusable.indexOf(view.root.activeElement);
          const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index + 1) % focusable.length;
          event.preventDefault();
          event.stopImmediatePropagation();
          focusable[next].focus();
        } else if (!event.composedPath().includes(view.host) && ["Enter", " "].includes(event.key)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }

      // Keep outlines aligned when the page scrolls or the viewport changes.
      function position() { view.highlight(session.selected || hovered); }

      // Remove every temporary effect and restore the previous focus when possible.
      function close() {
        if (closed) return;
        closed = true;
        previewStyle.remove();
        cursorStyle.remove();
        view.host.remove();
        window.removeEventListener("pointermove", move, true);
        for (const type of blockedEvents) window.removeEventListener(type, intercept, true);
        window.removeEventListener("keydown", keyboard, true);
        window.removeEventListener("scroll", position, true);
        window.removeEventListener("resize", position);
        if (picker === session) picker = null;
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      }

      // Parent navigation is reversible until the user picks a different element.
      get(".larger").addEventListener("click", () => {
        if (!session.selected?.parentElement) return;
        history.push(session.selected);
        select(session.selected.parentElement);
      });
      get(".smaller").addEventListener("click", () => { if (history.length) select(history.pop()); });
      get(".repick").addEventListener("click", hunt);
      get(".cancel").addEventListener("click", close);

      // Read current storage before appending, preserving edits from other popup sessions.
      get(".save").addEventListener("click", async () => {
        if (saving || !session.selected || !Object.keys(colors()).length) return;
        saving = true;
        for (const control of panel.querySelectorAll("button,input")) control.disabled = true;
        try {
          const entry = { id: crypto.randomUUID(), name: get("#element-name").value.trim() || "Custom element", enabled: true, path: location.pathname, locator: locate(session.selected), colors: colors() };
          const stored = await chrome.storage.local.get([STORAGE_KEY, ELEMENTS_KEY]);
          if (closed || stopped || !stored[STORAGE_KEY]?.[siteKey]?.enabled) throw new Error("Site access is disabled. Nothing was saved.");
          const current = Array.isArray(stored[ELEMENTS_KEY]) ? stored[ELEMENTS_KEY] : [];
          // Replace a rule for this exact target to avoid competing duplicate entries.
          const duplicate = current.findIndex((item) => item.path === entry.path && JSON.stringify(item.locator) === JSON.stringify(entry.locator));
          if (duplicate >= 0) { entry.id = current[duplicate].id; current[duplicate] = entry; }
          else current.push(entry);
          await chrome.storage.local.set({ [ELEMENTS_KEY]: current });
          entries = current;
          repaint();
          close();
        } catch (error) {
          if (!closed) {
            get(".feedback").textContent = `Could not save: ${error.message}`;
            get(".feedback").classList.add("error");
            for (const control of panel.querySelectorAll("button,input")) control.disabled = false;
            get(".larger").disabled = !session.selected?.parentElement;
            get(".smaller").disabled = !history.length;
            for (const control of Object.values(controls)) control.color.disabled = !control.check.checked;
          }
        } finally { saving = false; }
      });

      const blockedEvents = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu"];
      window.addEventListener("pointermove", move, true);
      for (const type of blockedEvents) window.addEventListener(type, intercept, { capture: true, passive: false });
      window.addEventListener("keydown", keyboard, true);
      window.addEventListener("scroll", position, true);
      window.addEventListener("resize", position);
      hunt();
      get(".cancel").focus();
    }

    return {
      // Refresh saved records from extension-local storage only.
      load(value) { entries = Array.isArray(value) ? value.filter((entry) => entry && typeof entry.id === "string") : []; repaint(); },
      enable() { enabled = true; repaint(); observe(); },
      pick,
      statuses() { return Object.fromEntries(entries.map((entry) => [entry.id, resolve(entry).state])); },
      // Briefly identify a saved target, including disabled overrides.
      show(id) {
        const entry = entries.find((item) => item.id === id);
        if (!entry) throw new Error("Saved element no longer exists.");
        const target = resolve(entry);
        if (!target.element) throw new Error(target.state);
        picker?.close();
        flashCleanup?.();
        target.element.scrollIntoView({ block: "center", behavior: "instant" });
        const view = overlay();
        const position = () => view.highlight(target.element);
        position();
        window.addEventListener("scroll", position, true);
        window.addEventListener("resize", position);
        const timeout = setTimeout(() => flashCleanup?.(), 2500);
        flashCleanup = () => {
          clearTimeout(timeout);
          view.host.remove();
          window.removeEventListener("scroll", position, true);
          window.removeEventListener("resize", position);
          flashCleanup = null;
        };
      },
      // Stop observers, timers, previews, and all custom styling when access is disabled.
      stop() {
        enabled = false;
        picker?.close();
        flashCleanup?.();
        observer?.disconnect();
        observer = null;
        clearTimeout(timer);
        timer = null;
        sheet?.remove();
        sheet = null;
      },
    };
  }

  // Keep this controller isolated from the webpage's own JavaScript environment.
  globalThis.__pagePaletteController = { refresh };
  // Accept commands only from our own extension, never from page scripts.
  function onMessage(request, sender, respond) {
    if (sender.id !== chrome.runtime.id || !request?.type?.startsWith("palette:")) return;
    (async () => {
      // Recheck saved opt-in before opening any page UI.
      await refresh();
      if (stopped) throw new Error("Enable Page Palette on this site first.");
      if (request.type === "palette:pick") custom.pick();
      else if (request.type === "palette:show") custom.show(request.id);
      else if (request.type !== "palette:status") throw new Error("Unknown command.");
      return { ok: true, statuses: custom.statuses() };
    })().then(respond, (error) => respond({ ok: false, error: error.message }));
    return true;
  }
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onStorageChanged);
  refresh();
})();
