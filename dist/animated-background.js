
(function () {
const Debug_Prefix = "Animated Background DEBUG: ";
const Log_Prefix = "Animated Background: "

//globals
var Root;
var Hui;
var Header;
var Main;
var Panel_Background_Overridden = null; // element whose inline vars we changed
var Lovelace;
var Animated_Config;
var Haobj = null;
var View;
var Panel_Holder;
var Debug_Mode = false;
var Loaded = false;
var View_Loaded = false;
var Meme_Remover = null;
var Meme_Count = 0;
var Opacity = 99;
var Restart_Interval = null;

//state tracking variables
let Previous_State;
let Previous_Entity;
let Previous_Url;
let Previous_Config;

function STATUS_MESSAGE(message, force) {
  if (!Debug_Mode) {
    console.log(Log_Prefix + message);
  }
  else {
    if (force) {
      console.log(Debug_Prefix + message);
    }
  }
}

function DEBUG_MESSAGE(message, object, only_if_view_not_loaded) {
  if (Debug_Mode) {
    if (only_if_view_not_loaded && View_Loaded) {
      return;
    }
    console.log(Debug_Prefix + message);
    if (object) {
      console.log(object);
    }
  }
}

function randomIntFromInterval(min, max) { // min and max included
  return Math.floor(Math.random() * (max - min + 1) + min);
}

//reset all DOM variables
function getVars() {
  Root = document.querySelector("home-assistant");
  Header = Root;
  Root = Root && Root.shadowRoot;
  Root = Root && Root.querySelector("home-assistant-main");
  Main = Root;
  Root = Root && Root.shadowRoot;
  Root = Root && Root.querySelector("app-drawer-layout partial-panel-resolver, ha-drawer partial-panel-resolver");
  
  Root = (Root && Root.shadowRoot) || Root;
  Root = Root && Root.querySelector("ha-panel-lovelace");
  if (Root) {
    Panel_Holder = Root.shadowRoot;
  }
  Root = Root && Root.shadowRoot;
  Root = Root && Root.querySelector("hui-root");
  Hui = Root;

  if (Root) {
    Lovelace = Root.lovelace;
    if (Lovelace) {
      Animated_Config = Lovelace.config.animated_background;
    }
    View = Root.shadowRoot.getElementById("view");
  }
}

//Mutation observer to set the background of views to transparent each time a new tab is selected
var View_Observer = new MutationObserver(function (mutations) {
  mutations.forEach(function (mutation) {
    if (mutation.addedNodes.length > 0) {
      if (!currentConfig() && View_Loaded) {
        DEBUG_MESSAGE("No configuration found for this view");
      }
      View_Loaded = false;
      clearMemes();
      renderBackgroundHTML();
    }
  });
});

//Mutation observer to refresh video on HA refresh
var Hui_Observer = new MutationObserver(function (mutations) {
  mutations.forEach(function (mutation) {
    if (mutation.addedNodes.length > 0) {
      DEBUG_MESSAGE("Proof that this observer is not useless");
      renderBackgroundHTML();
    }
  });
});

//Mutation observer to reload on dashboard change
var Panel_Observer = new MutationObserver(function (mutations) {
  mutations.forEach(function (mutation) {
    if (mutation.removedNodes.length > 0) {
      if (mutation.removedNodes[0].nodeName.toLowerCase() == "hui-editor") {
        restart();
      }
    }
  });
});

//Current known support: iphone, ipad (if set to mobile site option), windows, macintosh, android
function deviceIncluded(element, index, array) {
  return navigator.userAgent.toLowerCase().includes(element.toLowerCase());
}

//return the currently selected lovelace view
function currentViewPath() {
  return window.location.pathname.split('/')[2];
}

//return group config by name if it exists
function getGroupConfig(name) {
  var return_config = null;
  if (name == "none") {
    return { enabled: false, reason: "current group is set to 'none'" };
  }
  if (Animated_Config.groups) {
    Animated_Config.groups.forEach(group => {
      if (group.name) {
        if (group.name == name) {
          if (group.config) {
            return_config = group.config;
          }
        }
      }
    })
  }
  return return_config;
}

//return the current view configuration or null if none is found
function currentConfig() {
  var current_view_path = currentViewPath();
  var return_config = null;
  if (current_view_path == undefined) {
    return return_config;
  }
  
  if (Animated_Config) {
    if (Animated_Config.entity || Animated_Config.default_url) {
      return_config = Animated_Config;
    }


    if (Animated_Config.views) {
      Animated_Config.views.forEach(view => {
        if (view.path == current_view_path) {
          if (view.config) {
            return_config = view.config;
          }
          else {
            STATUS_MESSAGE("Error, defined view has no config", true);
          }
        }
      });
    }

    var current_view_config = Lovelace.config.views[Lovelace.current_view];
    if (Lovelace && current_view_path) {
      for (var i = 0; Lovelace.config.views.length > i; i++) {
        if (Lovelace.config.views[i].path == current_view_path) {
          current_view_config = Lovelace.config.views[i];
        }
        else {
          if (i.toString() == current_view_path.toString()) {
            current_view_config = Lovelace.config.views[i];
          }
        }
      }

      if (current_view_config) {
        var potential_config = getGroupConfig(current_view_config.animated_background);
        if (potential_config) {
          return_config = potential_config;
        }
      }
    }

    if (return_config) {
      if (return_config.entity && return_config.state_url) {
        var current_state = getEntityState(return_config.entity);
        var current_url = return_config.state_url[current_state];
        if (current_url) {
          if (current_url == "none") {
            return_config = { enabled: false, reason: "current state('" + current_state + "') state_url is set to 'none'", entity: return_config.entity, default_url: return_config.default_url, state_url: return_config.state_url };
          }
        }
      }

    }
  }
  return return_config;
}

//logic for checking if enabled in configuration
function enabled() {
  var temp_enabled = false;
  if (Animated_Config) {
    if (Animated_Config.default_url || Animated_Config.entity || Animated_Config.views || Animated_Config.groups) {
      temp_enabled = true;
    }
  }

  if (temp_enabled == false) {
    return false;
  }

  var current_config = currentConfig();

  if (!Haobj) {
    return false;
  }

  if (!current_config) {
    return false;
  }

  // Precedence (documented in the README's Access notes):
  //   1. Exclusions always win: a match on any excluded_users /
  //      excluded_devices list (root or view/group config) disables the
  //      background no matter what else is configured.
  //   2. An explicit enabled: true/false on the view/group config applies
  //      next - it can override inclusion lists, never exclusions.
  //   3. Inclusion lists are allowlists: if any non-empty included_users /
  //      included_devices list is configured, the current user or device
  //      must match at least one of them.
  var user_name = (Haobj.user && Haobj.user.name) ? Haobj.user.name.toLowerCase() : "";
  function userInList(list) {
    return (list || []).map(function (username) { return String(username).toLowerCase(); }).includes(user_name);
  }

  // 1. Exclusions win - evaluated first, short-circuit everything below.
  if ((Animated_Config.excluded_devices && Animated_Config.excluded_devices.some(deviceIncluded)) ||
      (current_config.excluded_devices && current_config.excluded_devices.some(deviceIncluded))) {
    DEBUG_MESSAGE("Current device is excluded", null, true);
    return false;
  }
  if (userInList(Animated_Config.excluded_users) || userInList(current_config.excluded_users)) {
    DEBUG_MESSAGE("Current user: " + user_name + " is excluded", null, true);
    return false;
  }

  // 2. Explicit per-config switch.
  if (current_config.enabled == false) {
    return false;
  }
  if (current_config.enabled == true) {
    return true;
  }

  // 3. Inclusion lists act as allowlists (root or per-config).
  var has_inclusions =
    (Animated_Config.included_users && Animated_Config.included_users.length) ||
    (Animated_Config.included_devices && Animated_Config.included_devices.length) ||
    (current_config.included_users && current_config.included_users.length) ||
    (current_config.included_devices && current_config.included_devices.length);
  if (has_inclusions) {
    var user_matched = userInList(Animated_Config.included_users) || userInList(current_config.included_users);
    var device_matched =
      (Animated_Config.included_devices || []).some(deviceIncluded) ||
      (current_config.included_devices || []).some(deviceIncluded);
    if (!user_matched && !device_matched) {
      DEBUG_MESSAGE("Current user (" + user_name + ") / device is not included", null, true);
      return false;
    }
  }

  return temp_enabled;
}


//returns selected entity's current state if it is available
function getEntityState(entity) {
  var return_state = null;
  if (Haobj) {
    if (Haobj.states[entity]) {
      return_state = Haobj.states[entity].state;
    }
  }

  return return_state;
}

//main render function
function renderBackgroundHTML() {
  Opacity = 99;
  var current_config = currentConfig();
  var resolved_opacity = current_config && current_config.opacity !== undefined ? current_config.opacity : (Animated_Config ? Animated_Config.opacity : 99);
  if (parseInt(resolved_opacity) > 0) {
    Opacity = resolved_opacity;
  }
  var state_url = "";
  var temp_enabled = true;
  //rerender background if entity has changed (to avoid no background refresh if the new entity happens to have the same state)
  if (current_config && current_config.entity && Previous_Entity != current_config.entity) {
    Previous_State = null;
  }

  if (current_config != Previous_Config) {
    Previous_State = null;
  }

  //get state of config object
  if (current_config) {
    if (current_config.entity && current_config.state_url) {
      Previous_Entity = current_config.entity;
      var current_state = getEntityState(current_config.entity);
      if (current_config.state_url[current_state]) {
        if (Previous_State != current_state) {
          View_Loaded = false;
          DEBUG_MESSAGE("Configured entity " + current_config.entity + " is now " + current_state, true);
          if (current_config.state_url) {
            var url = current_config.state_url[current_state];
            if (Array.isArray(url)) {
              state_url = url[randomIntFromInterval(0, url.length - 1)];
            }
            else {
              state_url = current_config.state_url[current_state];
            }
          }
          Previous_State = current_state;
        }
        else {
          // Preserve the current background URL across dashboard DOM rerenders
          // (for example, when camera cards refresh) so the iframe can be rebuilt.
          state_url = Previous_Url || "";
        }
      }
      else {
        DEBUG_MESSAGE("No state_url found for the current state '" + current_state + "'. Attempting to set default_url")
        Previous_State = current_state;
        Previous_Url = null;
        var url = current_config.default_url;
        if (url) {
          if (Array.isArray(url)) {
            state_url = url[randomIntFromInterval(0, url.length - 1)];
          }
          else {
            state_url = url;
          }
        }
        else {
          if (!current_config.reason) {
            DEBUG_MESSAGE("No default_url found, restoring lovelace theme")
          }
          temp_enabled = false;
        }
      }
    }
    else {
      var url = current_config.default_url;
      if (url) {
        if (Array.isArray(url)) {
          state_url = url[randomIntFromInterval(0, url.length - 1)];
        }
        else {
          state_url = url;
        }
      }
      else {
        if (!current_config.reason) {
          DEBUG_MESSAGE("No default_url found, restoring lovelace theme")
        }
        temp_enabled = false;
      }
    }
  }
  else {
    temp_enabled = false;
  }

  if (temp_enabled) {
    temp_enabled = enabled();
  }

  processDefaultBackground(temp_enabled);

  if (!temp_enabled || !current_config) {
    setPanelBackgroundTransparent(false);
    return;
  }

  setPanelBackgroundTransparent(true);

  Previous_Config = current_config;

  var html_to_render;
  if (state_url != "" && Hui) {
    var bg = Hui.shadowRoot.getElementById("background-iframe");
    var video_type = urlIsVideo(state_url);
    var doc_body;
    if (video_type) {
      doc_body = `<video id='cinemagraph' autoplay='' loop='' preload='' playsinline='' muted='' poster=''><source src='${state_url}' type='video/${video_type}'></video>`
    }
    else {
      doc_body = `<img src='${state_url}'>`
    }

    
    var source_doc = `
    <html>
    <head>
      <style type='text/css'>
        body {
          min-height: 100vh;
          min-width: 100vw;
          max-height: 100%;
          max-width: 100%;
          overflow: hidden;
          margin: 0;
          position: relative;
        }
    
        video {
          min-width: 100%;
          min-height: 100%;
          width: auto;
          height: auto;
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        }
        
        img {
          min-width: 100%;
          min-height: 100%;
          width: auto;
          height: auto;
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        }
      </style>
    </head>  
    <body id='source-body'>
    ${doc_body}
    </body>
    </html>`;
    if (!bg) {
      if (!current_config.entity) {
        STATUS_MESSAGE("Applying default background", true);
      }
      var style = Root.shadowRoot.getElementById("animated-bg-style");
      if (!style) {
        style = document.createElement("style");
        style.id = "animated-bg-style";
        Root.shadowRoot.appendChild(style);
      }
      style.innerHTML = `
      .bg-video{
          min-width: 100vw; 
          min-height: 100vh;    
      }
      
      #view {
          background: none;
        }
      
      .bg-wrap{
          position: fixed;
          left: 0;
          top: 0;
          min-width: 100vw; 
          min-height: 100vh;
          z-index: -12;
          pointer-events: none;
      }

      #background-iframe{
          pointer-events: none;
      }

      hui-view-background{
          background:none;
      }
      `;

// transparent for top Pannel
      var div = document.createElement("div");
      div.id = "background-video";
      div.className = "bg-wrap";
      // Built via element properties, not HTML interpolation: a double
      // quote in a URL would truncate an interpolated srcdoc attribute and
      // blank the background with no diagnostic.
      var iframe = document.createElement("iframe");
      iframe.id = "background-iframe";
      iframe.className = "bg-video";
      iframe.setAttribute("frameborder", "0");
      iframe.style.pointerEvents = "none";
      iframe.srcdoc = source_doc;
      div.appendChild(iframe);

      Root.shadowRoot.appendChild(div);
      
      View.setAttribute ("style","background:none;");
      
      Previous_Url = state_url;
    }
    else {
      if (current_config.entity || (Previous_Url != state_url)) {
        if (!current_config.entity) {
          STATUS_MESSAGE("Applying default background", true);
          Previous_Entity = null;
          Previous_State = null;
        }
        bg.srcdoc = source_doc;
        Previous_Url = state_url;
      }
    }

    }  // <-- this closes the if (state_url != "" && Hui) block

  // transparent for top Panel - evaluated on every render
  // Reachable with Hui unresolved (e.g. provideHass during startup), so gate first.
  if (!Hui || !Hui.shadowRoot) return;
  // Fall back to root Animated_Config for top-level settings not present in group/view configs
  var transparent_panel = current_config.transparent_panel !== undefined ? current_config.transparent_panel : (Animated_Config ? Animated_Config.transparent_panel : false);
  if (transparent_panel) {
    if (!Hui.shadowRoot.getElementById('animated-bg-panel-style')) {
      var ha_style = document.createElement('style');
      ha_style.id = 'animated-bg-panel-style';
      ha_style.innerHTML = `
        .header {
          background-color: transparent !important;
        }
        .toolbar {
          background-color: transparent !important;
        }`;
      Hui.shadowRoot.appendChild(ha_style);
    }
  }
  else {
    var panelStyle = Hui.shadowRoot.getElementById('animated-bg-panel-style');
    if (panelStyle) panelStyle.remove();
  }

  // Opacity is re-evaluated on every render (not only on first creation) so it
  // tracks per-view/group config changes. Note it creates a CSS stacking context
  // which may cause overlays (e.g. Bubble Card) to appear behind the background -
  // remove opacity: from your config if this affects you.
  var opacityStyle = Hui.shadowRoot.getElementById('animated-bg-opacity-style');
  if (Opacity < 99) {
    // Computed numerically: concatenating after "0." turned single-digit
    // values (5) into ten times the intended opacity (0.5).
    var alpha = Math.min(99, Math.max(1, parseInt(Opacity, 10))) / 100;
    var opacity_css = `
      hui-masonry-view,
      hui-sections-view,
      hui-panel-view {
          opacity: ` + alpha + `;
      }`;
    if (!opacityStyle) {
      opacityStyle = document.createElement('style');
      opacityStyle.id = 'animated-bg-opacity-style';
      Hui.shadowRoot.appendChild(opacityStyle);
    }
    if (opacityStyle.innerHTML !== opacity_css) {
      opacityStyle.innerHTML = opacity_css;
    }
  }
  else if (opacityStyle) {
    opacityStyle.remove();
  }
}

function urlIsVideo(url) {
  if (!url || typeof url !== "string") {
    return false;
  }

  // Normalize URL/path and ignore query strings/hash fragments.
  var clean_url = url.split("?")[0].split("#")[0].toLowerCase();
  var last_dot = clean_url.lastIndexOf(".");
  if (last_dot === -1) {
    return false;
  }

  var extension = clean_url.slice(last_dot + 1);
  // Map file extension -> <source> MIME subtype (used as type='video/<value>').
  var video_types = {
    mp4: "mp4",
    webm: "webm",
    ogv: "ogg",
    mov: "quicktime"
  };
  if (video_types[extension]) {
    return video_types[extension];
  }

  return false;
}

//removes lovelace theme background
function removeDefaultBackground(node, current_config) {
  var background = 'transparent';
  if (current_config.background) {
    background = current_config.background;
  }
  if (node.style.background != background) {
    node.style.background = background;
  }
}

//restores lovelace theme background
function restoreDefaultBackground(node) {
  node.style.background = null;
}


//remove background every 100 milliseconds for 2 seconds because race condition memes
function processDefaultBackground(temp_enabled) {
  if (!Meme_Remover) {
    Meme_Remover = setInterval(() => {
      getVars();
      var current_config = currentConfig();

      var view_holder;
      var view_node = null;
      var view_node_panel = null;

      if (Root) {
        view_holder = Root.shadowRoot.getElementById("view");

        if (view_holder) {
          view_node_panel = view_holder.querySelector("hui-panel-view")
          view_node = view_holder.querySelector('hui-view');
        }

        if (view_node || view_node_panel) {
          //required because ios pre 13.4 bitches out if there is nullish coalescing operator ('??')
          var iphone_bullshit_fixer = view_node;
          if (!iphone_bullshit_fixer) {
            iphone_bullshit_fixer = view_node_panel;
          }
          if (temp_enabled) {
            removeDefaultBackground(iphone_bullshit_fixer, current_config);
            DEBUG_MESSAGE("Removing view background for configuration:", currentConfig(), true);
          }
          else {
            restoreDefaultBackground(iphone_bullshit_fixer);
            if (current_config && current_config.reason) {
              DEBUG_MESSAGE("Current config is disabled because " + current_config.reason, null, true);
            }
          }
          View_Loaded = true;
        }
      }
      Meme_Count++;
      if (Meme_Count > 20) {
        clearMemes();
        Meme_Count = 0;
      }

      Loaded = true;
    }, 100);
  }
}

function clearMemes() {
  clearInterval(Meme_Remover);
  Meme_Remover = null;
  Meme_Count = 0;
}

function setDebugMode() {
  if (Animated_Config) {
    if (Animated_Config.debug) {
      Debug_Mode = Animated_Config.debug;
      if (Animated_Config.display_user_agent) {
        if (Animated_Config.display_user_agent == true) {
          alert(navigator.userAgent);
        }
      }
    }
    else {
      Debug_Mode = false;
    }
  }
  else {
    Debug_Mode = false;
  }
}

// HA 2026.11+ paints the theme background once, behind all panels, on a
// z-index:-1 layer inside home-assistant-main's stacking context
// (isolation: isolate). Our .bg-wrap (z-index:-12) lives in that same context,
// so the theme background would cover the video. Neutralize the variables that
// layer reads, only while the animated background is active. On older HA,
// --ha-panel-background is unused and --lovelace-background only feeds
// hui-view-background, which this plugin already clears - so it is harmless.
var Panel_Background_Vars = ["--ha-panel-background", "--lovelace-background"];

function setPanelBackgroundTransparent(active) {
  if (active) {
    if (Panel_Background_Overridden && Panel_Background_Overridden !== Main) {
      setPanelBackgroundTransparent(false);
    }
    if (!Panel_Background_Overridden && Main && Main.style) {
      Panel_Background_Vars.forEach(function (v) {
        Main.style.setProperty(v, "transparent");
      });
      Panel_Background_Overridden = Main;
      DEBUG_MESSAGE("Panel background variables set to transparent");
    }
  }
  else if (Panel_Background_Overridden) {
    var el = Panel_Background_Overridden;
    Panel_Background_Vars.forEach(function (v) {
      el.style.removeProperty(v);
    });
    Panel_Background_Overridden = null;
    DEBUG_MESSAGE("Panel background variables restored");
  }
}

function cleanupDOM() {
  setPanelBackgroundTransparent(false);
  if (Root && Root.shadowRoot) {
    var oldDiv = Root.shadowRoot.getElementById('background-video');
    if (oldDiv) oldDiv.remove();
  }
  // Remove only our own style elements. hui-root's shadow root also holds
  // Home Assistant's stylesheets (and card-mod's) - those must survive.
  if (Hui && Hui.shadowRoot) {
    ['animated-bg-style', 'animated-bg-panel-style', 'animated-bg-opacity-style'].forEach(function (id) {
      var own = Hui.shadowRoot.getElementById(id);
      if (own) own.remove();
    });
  }
}

//main function
function run() {
  getVars();
  setDebugMode();
  STATUS_MESSAGE("Starting");
  DEBUG_MESSAGE("Starting, Debug mode enabled");
  if (!Loaded) {
    if (!currentConfig()) {
      if (Debug_Mode) {
        DEBUG_MESSAGE("No configuration found");
      }
      else {
        STATUS_MESSAGE("No configuration found");
      }
    }
  }

  //subscribe to hass object to detect state changes
  if (!Haobj) {
    var ha_el = document.querySelector("home-assistant");
    if (!ha_el || typeof ha_el.provideHass !== "function") {
      // run() fires at load, possibly before Home Assistant mounts.
      // restart()'s poll loop waits for it.
      restart();
      return;
    }
    ha_el.provideHass({
      set hass(value) {
        if (Haobj && Haobj.panelUrl != value.panelUrl) {
          restart();
        }
        Haobj = value;
        var current_config = currentConfig();
        if (Loaded) {
          if (current_config && current_config.entity) {
            var current_state = getEntityState(current_config.entity);
            if (Previous_State != current_state) {
              clearMemes();
              renderBackgroundHTML();
            }
          }

        }
        else {
          renderBackgroundHTML();
        }
      }
    });
  }
  else {
    if (!Loaded) {
      renderBackgroundHTML();
    }
  }

  if (!View) {
    restart();
    return;
  }

  View_Observer.observe(View, {
    characterData: true,
    childList: true,
    subtree: true,
    characterDataOldValue: true
  });

  Hui_Observer.disconnect();
  Hui_Observer.observe(Hui, {
    characterData: true,
    childList: true,
    subtree: true,
    characterDataOldValue: true
  });

  Panel_Observer.disconnect();
  Panel_Observer.observe(Panel_Holder, {
    characterData: true,
    childList: true,
    subtree: true,
    characterDataOldValue: true
  });
}

function restart() {
  cleanupDOM();
  clearInterval(Restart_Interval);
  Restart_Interval = setInterval(() => {
    getVars()
    if (Hui) {
      Previous_Entity = null;
      Previous_State = null;
      Loaded = false;
      View_Loaded = false;
      clearMemes();
      View_Observer.disconnect();
      run();
      clearInterval(Restart_Interval);
      Restart_Interval = null;
    }
  }, 200);
}

// Guard against double registration (e.g. a leftover /local/ resource plus
// the /hacsfiles/ one): two copies would run competing observers and render
// loops on the same DOM.
if (window.__animatedBackgroundLoaded) {
  console.warn(Log_Prefix + "already loaded; ignoring duplicate resource registration.");
} else {
  window.__animatedBackgroundLoaded = true;
  run();
}
})();
