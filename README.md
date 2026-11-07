# Page Palette 1.2 — Brave extension

Per-site background and text colors, personal defaults, and a new element picker for sections the general settings do not reach.

## Upgrade without losing settings

1. Keep a backup of your current extension files.
2. Extract this ZIP and copy the contents of its `page-palette` folder into the **same unpacked extension folder you already use**. Replace the existing files. Keep your existing Git folder if you use Git.
3. Open `brave://extensions` and click **Reload** on Page Palette.
4. Refresh the website tabs you want to customize. This replaces the old content script already running in those tabs.

Do not remove and reinstall the extension to update it: removing it can delete its saved settings. This update keeps the existing site and default storage keys and requests no new permission types.

For a new installation, enable Developer mode at `brave://extensions`, choose **Load unpacked**, and select the folder containing `manifest.json`.

## Pick and recolor a container

1. Enable Page Palette on the current site if necessary.
2. Under **Site colors**, expand **Custom Elements** and click **Pick an element**. The popup closes and a floating editor opens on the page.
3. Hover to highlight an HTML element. Click to select it; the picker intercepts ordinary pointer actions so selecting a link does not navigate.
4. Use **Select larger area** to move to its parent container. Repeat as needed. **Back to smaller area** retraces your selection. **Pick another** starts selection again.
5. Give the selection a useful name. Check **Background**, **Text**, or **Border** to enable that override, then choose a color. Unchecked properties are untouched.
6. **Save** stores the change. **Cancel** or **Escape** discards the preview. Tab stays within the floating editor.

A background change affects the selected container, not every child. If a child has its own opaque background, select that child or save another override. Text colors inherit only where the website has not assigned a separate color to a descendant. Border color does not create a border that was previously absent.

## Manage Custom Elements

The submenu lists saved entries for the current origin (protocol, hostname, and port):

- Edit the name or colors; changes save when the field commits.
- Uncheck a color to remove only that property's override.
- **Disable / Enable** suspends or restores an individual entry.
- **Show on page** scrolls to the target and highlights it briefly, even if that entry is disabled.
- **Delete** removes the saved entry and its effect.

For safer matching, each entry is restricted to the page pathname where it was selected. Entries from other pages on the same site remain in the list and show **Saved on another page**. Query strings and fragments do not change this scope. Missing or ambiguous targets are reported instead of choosing a fallback. Re-pick an element if the site changes its structure. Saving the exact same target again replaces its existing entry.

Disabling Page Palette for a site removes both general and custom styles, closes the picker, stops its observers/listeners, and revokes the optional host access through the existing cleanup flow. Saved custom entries remain available when you enable the site again. Removal always removes Page Palette's own stylesheet rules; it never writes a snapshot of an old color back into website styles.

## Existing features

- Background and Text swatches change general site colors.
- Warm paper, Soft gray, and White are quick themes.
- Save as default sets your preferred colors for future sites.
- Use my default copies those colors to the current site.
- A site must be explicitly enabled before any page injection takes place.
- No external services or network requests are used by the extension. Settings and element identifiers stay in extension-local storage.

## Limits

- This version selects ordinary HTML elements in the top-level document. Embedded frames, SVG internals, shadow-root internals, canvas pixels, image pixels, and pseudo-elements are not individually editable.
- Inline `!important` declarations or sufficiently strong website CSS may override a chosen color. Background images or gradients may cover a background-color change.
- Locators prefer IDs/classes and fall back to structural positions. Large website changes can invalidate a locator, and structurally identical replacement elements cannot always be distinguished. Disable, delete, or re-pick the entry if a site's layout changes.
- Browser-internal pages and other pages where Brave disallows extension injection cannot be customized.
- Standard host-permission match patterns do not distinguish ports, although saved settings do.
- Two simultaneous saves to the same custom-element list in different tabs are not transactionally merged. Finish one edit before saving another in another tab.

## Validation

JavaScript syntax checks and deterministic Node harness checks passed for:

- Selection, parent/back navigation, pointer-click interception, preview rollback, and cleanup.
- Save, individual toggle, delete, reload persistence, and site-disable cleanup while retaining records.
- Page/origin isolation, missing/ambiguous targets, and invalid CSS/locator rejection.
- Popup list rendering, safe name handling, edits, and preservation of other-site and general settings.

Run from this folder with Node 18 or later:

```sh
node --check content.js
node --check popup.js
node tests/controller.cjs
node tests/popup.cjs
```

The harness uses a mocked DOM and Chrome APIs; it does not verify native rendering, browser permissions, or browser storage persistence across an actual restart. A live browser launch was blocked in the build environment.

### Brave acceptance check

After reloading the extension and page, select a paragraph, move up to the black container, check Background, and choose a softer color. Try Cancel first, then repeat and Save. Reopen Custom Elements to edit, disable, re-enable, highlight, and delete the entry. Save another entry and verify it after refreshing the page and restarting Brave. Finally disable Page Palette for the site and verify that its styling and picker are removed. These native Brave checks remain unverified.

## Files

- `manifest.json` — metadata and the unchanged permission model.
- `popup.html`, `popup.css`, `popup.js` — site controls and Custom Elements management.
- `content.js` — general styling, custom rules, element picker, and cleanup.
- `tests/` — dependency-free controller and popup harnesses.
