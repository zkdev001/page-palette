# Page Palette 1.1 — Brave extension

Give individual websites a comfortable light background and readable text, with a native color picker and a personal default.

## What's new

- **Per-site opt-in:** No content script is installed on every page. Click **Enable on this site** to grant Brave's permission just for that site's host and protocol. The approved site keeps working after navigation or browser restart.
- **Safer styling:** The content script keeps a direct reference to its own `<style>` element instead of looking it up by an ID a website could already be using.
- **Default + overrides:** Start with warm paper and dark text. Click either color swatch to use Brave's native color picker. Save an override for this site or save your current colors as the default for future sites.

## Install or upgrade in Brave

1. Extract this ZIP somewhere permanent, such as `Documents\page-palette`.
2. If an older Page Palette is installed at `brave://extensions`, remove or disable it first to avoid two copies overriding the same page.
3. Open `brave://extensions`, enable **Developer mode**, and choose **Load unpacked**.
4. Select the inner `page-palette` directory containing `manifest.json`.
5. Pin the extension to Brave's toolbar if desired.
6. Visit a regular HTTP/HTTPS site and open Page Palette. Choose a theme or your own colors, then click **Enable on this site** and approve the site-specific permission prompt.

For an in-place update, replace the contents of the original unpacked extension folder with the files from this archive, click **Reload** at `brave://extensions`, and refresh any already-open tabs. This preserves the extension's existing storage and saved site choices. Older saved sites may need **Enable on this site** clicked once to receive site permission.

## How it works

- The popup itself is the dropdown panel; clicking the background or text color swatch opens Brave's built-in color picker.
- **Warm paper**, **Soft gray**, and **White** are quick site color choices.
- **Save as default** changes your preferred colors for future unconfigured sites. **Use my default** copies those defaults to the current site.
- Changes to colors on an enabled site take effect immediately. Colors chosen for disabled sites are saved but **do not** grant access or change the page until enabled.
- **Disable on this site** restores the site's appearance, unregisters its future content script, and revokes its optional site permission. Because already-injected JavaScript cannot literally be uninjected, it also removes its own stylesheet and storage-change listener when it sees the disabled state.
- The host-permission prompt applies to the current protocol and hostname (for example `https://example.com/*`). Standard browser match patterns cannot distinguish different ports on the same hostname.
- No data is sent to external services. Preferences remain in Brave's extension-local storage.

## Notes

- Brave/Chromium does not allow extensions to restyle internal pages (`brave://`, Chrome Web Store, etc.).
- For tabs already open when a site is first enabled, the current tab updates immediately; other existing tabs on that site may need a reload.
- Some complicated websites may lose background images or decorative colors when forced into a light palette.
- This extension intentionally does not read website text or collect page content; it changes colors only.

## Files

- `manifest.json` — permissions and extension metadata.
- `popup.html`, `popup.css`, `popup.js` — the user interface, settings, and per-site permissions.
- `content.js` — site styling for enabled origins only.
