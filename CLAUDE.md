# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A single-file, vanilla JavaScript custom Lovelace resource for Home Assistant that renders animated video/image backgrounds behind dashboard views. It is distributed via HACS (category: Dashboard) and configured entirely through the user's Lovelace YAML under a root-level `animated_background:` key.

## Build / test / lint

There is **no build step, package manager, bundler, or test suite**. The shipped artifact is `dist/animated-background.js` — a plain ES file loaded directly by the browser as a JavaScript Module. Edit it directly; there is no source-to-dist compilation.

To test changes you must run them inside a live Home Assistant instance:
1. Copy `dist/animated-background.js` to `<HA config>/www/animated-background.js`.
2. Register it as a Lovelace resource (`/local/animated-background.js`, type *JavaScript Module*) — see README "Registering the resource".
3. Reload the dashboard. Set `animated_background.debug: true` in the dashboard YAML to enable verbose `console.log` output (prefixed `Animated Background DEBUG:`).

`hacs.json` declares `filename: animated-background.js`; keep that filename and its location consistent with HACS expectations when renaming/moving files.

## Architecture

The entire plugin is `dist/animated-background.js` (~800 lines, no modules/classes). Key constraint: **it must reach Home Assistant's deeply nested Shadow DOM** and survive HA's frequent DOM re-renders. Almost all complexity stems from these two facts.

- **Global state** — Cached DOM references (`Root`, `Hui`, `View`, `Panel_Holder`, etc.) and "previous" tracking vars (`Previous_State`, `Previous_Url`, `Previous_Config`...) are module-level globals. `getVars()` re-resolves every DOM reference by walking through nested `shadowRoot`s (`home-assistant` → `home-assistant-main` → `partial-panel-resolver` → `ha-panel-lovelace` → `hui-root`). Selectors here are brittle against HA version changes — most historical fixes (see README attribution) were updates to this chain.

- **`run()`** — Entry point (called at the bottom of the file). Resolves DOM vars, subscribes to the `hass` object via `home-assistant`'s `provideHass()` to receive state updates, and wires up the three MutationObservers. `restart()` tears everything down and retries `getVars()` on a 200ms interval until `hui-root` is available again (used on dashboard/panel changes).

- **Three MutationObservers** drive re-rendering because HA constantly rebuilds the DOM:
  - `View_Observer` — view tab switches → clear + re-render.
  - `Hui_Observer` — generic HA refreshes → re-render (note: `Previous_Url` is preserved across these so camera-card refreshes don't drop the background).
  - `Panel_Observer` — detects removal of `hui-editor` (exiting the YAML editor) → `restart()`.

- **Config resolution** — `currentConfig()` resolves the effective config for the current view via precedence: root `animated_background` (if it has `entity`/`default_url`) → matching `views[].config` (by `path`) → matching `groups[].config` (selected by a view's `animated_background: <groupname>` field; `none` disables). `getGroupConfig()` handles group lookup. `enabled()` then applies device/user include/exclude filters at both root and per-config level.

- **`renderBackgroundHTML()`** — The core render. Picks a URL from `state_url[state]` (or `default_url`), randomly selecting one entry if the value is a list. Builds an `<iframe id="background-iframe">` whose `srcdoc` contains a self-contained HTML doc with a `<video>` (mp4/webm/ogv/mov) or `<img>`, injected into `hui-root`'s shadowRoot at `z-index: -12`. `urlIsVideo()` decides video vs image by file extension (strips query/hash first) and maps it to the `<source>` MIME subtype: `mp4`→mp4, `webm`→webm, `ogv`→ogg, `mov`→quicktime.

- **The "Meme" interval** — `processDefaultBackground()` / `clearMemes()` run a 100ms `setInterval` (capped at 20 ticks) that repeatedly forces the Lovelace view's own background to `transparent`. This deliberately fights a race condition where HA re-applies its theme background after the plugin clears it. `Meme_Remover`/`Meme_Count` are this mechanism — not dead code.

- **Opacity & stacking context** — When `opacity` (1–99) is set, an `opacity` CSS rule is applied to `hui-masonry-view`/`hui-sections-view`/`hui-panel-view`. This creates a new CSS stacking context and is a known cause of overlays (e.g. Bubble Card popups) rendering *behind* the background. Be cautious changing opacity handling; see the README troubleshooting section. `transparent_panel` separately injects a style to make the header/toolbar transparent.

## Conventions

- Plain ES5/ES6, `var`-heavy, no framework. Intentional compatibility hacks for old iOS exist (e.g. the comment about avoiding `??` nullish coalescing pre-iOS 13.4) — preserve such accommodations unless deliberately dropping old-device support.
- Logging goes through `STATUS_MESSAGE` (always) and `DEBUG_MESSAGE` (only when `debug: true`).
- When changing config resolution or DOM selectors, remember settings can live at root level *or* per-view *or* per-group; new options generally need a fallback to root `Animated_Config` (see how `transparent_panel`/`opacity` fall back).

## Idioma

Responda sempre em português do Brasil.

## Regras Gerais

- Tome cuidado para não quebrar o que já está funcionando;