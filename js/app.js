(function () {
  "use strict";

  // Tibia 7.1 / classic: 1 mana por tick (nao o 2/3s do tibia moderno)
  var REGEN = {
    mage: { mana: 1, seconds: 6, label: "Mage 7.1: 1 mana a cada 6s" },
    promoted: { mana: 1, seconds: 4, label: "Promoted Mage 7.1: 1 mana a cada 4s" },
    paladin: { mana: 1, seconds: 8, label: "Paladin 7.1: 1 mana a cada 8s" },
    royal: { mana: 1, seconds: 6, label: "Royal Paladin 7.1: 1 mana a cada 6s" }
  };

  // nomes antigos salvos no localStorage
  var VOCATION_ALIASES = {
    druid: "mage",
    elder: "promoted"
  };

  var STORAGE_KEY = "runetimer-settings-v4";
  var TOUR_DONE_KEY = "runetimer-tour-done-v1";
  // liquido sobe ate a faixa "fim" (nao ate a boca)
  var LIQUID_BOTTOM = 262;
  var LIQUID_TOP = 46;
  var LIQUID_MAX_H = LIQUID_BOTTOM - LIQUID_TOP;
  // no tibia a mana nao fica 0 depois de craftar ? sempre sobra 1
  var MIN_MANA = 1;

  // Anti-AFK: classic desconecta ~15 min sem acao
  var AFK_TOTAL_MS = 15 * 60 * 1000;
  var AFK_WARN_MS = 14 * 60 * 1000;
  var AFK_AMBIENTS = ["birds", "stream", "rain", "beach"];
  var AFK_LABELS = {
    birds: "campo (passaros)",
    stream: "riacho",
    rain: "chuva",
    beach: "praia"
  };

  // Tibia classic: Meat 180s, Ham 360s, full 1200s (20 min) ~ 3 ham
  var state = {
    vocation: "mage",
    runes: 3,
    manaPerRune: 100,
    meatSec: 180,
    hamSec: 360,
    maxFoodSec: 1200,
    foodLeftMs: 0,
    foodUpdatedAt: 0,
    hungerRaf: 0,
    hungerBlocked: false,
    running: false,
    paused: false,
    ready: false,
    startedAt: 0,
    durationMs: 0,
    pausedElapsedMs: 0,
    raf: 0,
    pipWindow: null,
    bellAudio: null,
    hungerAudio: null,
    hungerAlertPlayed: false,
    syncDirty: false,
    syncLocked: false,
    syncSnapMana: null,
    syncSnapElapsed: null,
    afkStartedAt: 0,
    afkRaf: 0,
    afkPaused: false,
    afkPausedElapsedMs: 0,
    afkAmbientKind: null,
    afkAmbientAudio: null,
    afkAmbientStarted: false
  };

  var els = {};

  function bindElements(root) {
    var doc = root || document;
    els = {
      app: doc.getElementById("app"),
      flaskWrap: doc.getElementById("flaskWrap"),
      liquid: doc.getElementById("liquid"),
      wave: doc.getElementById("wave"),
      timeLeft: doc.getElementById("timeLeft"),
      manaLine: doc.getElementById("manaLine"),
      statusText: doc.getElementById("statusText"),
      btnStart: doc.getElementById("btnStart"),
      btnPause: doc.getElementById("btnPause"),
      btnReset: doc.getElementById("btnReset"),
      btnPip: doc.getElementById("btnPip"),
      btnManaUp: doc.getElementById("btnManaUp"),
      btnManaDown: doc.getElementById("btnManaDown"),
      btnBell: doc.getElementById("btnBell"),
      btnMeat: doc.getElementById("btnMeat"),
      btnHam: doc.getElementById("btnHam"),
      btnHungerSfx: doc.getElementById("btnHungerSfx"),
      btnHungerReset: doc.getElementById("btnHungerReset"),
      hungerWrap: doc.getElementById("hungerWrap"),
      hungerLiquid: doc.getElementById("hungerLiquid"),
      hungerWave: doc.getElementById("hungerWave"),
      hungerTime: doc.getElementById("hungerTime"),
      hungerLine: doc.getElementById("hungerLine"),
      hungerStatus: doc.getElementById("hungerStatus"),
      cfgRunes: doc.getElementById("cfgRunes"),
      cfgMana: doc.getElementById("cfgMana"),
      cfgMeatSec: doc.getElementById("cfgMeatSec"),
      cfgHamSec: doc.getElementById("cfgHamSec"),
      cfgMaxFoodSec: doc.getElementById("cfgMaxFoodSec"),
      cfgCurrentMana: doc.getElementById("cfgCurrentMana"),
      cfgElapsed: doc.getElementById("cfgElapsed"),
      btnSync: doc.getElementById("btnSync"),
      regenHint: doc.getElementById("regenHint"),
      segBtns: doc.querySelectorAll(".seg-btn"),
      afkWrap: doc.getElementById("afkWrap"),
      afkFill: doc.getElementById("afkFill"),
      afkTime: doc.getElementById("afkTime"),
      afkStatus: doc.getElementById("afkStatus"),
      btnAfkPause: doc.getElementById("btnAfkPause"),
      btnTutorial: doc.getElementById("btnTutorial")
    };
  }

  function normalizeVocation(voc) {
    if (!voc) return "mage";
    if (VOCATION_ALIASES[voc]) voc = VOCATION_ALIASES[voc];
    return REGEN[voc] ? voc : "mage";
  }

  function totalMana() {
    return Math.max(1, state.runes) * Math.max(1, state.manaPerRune);
  }

  function manaPerSecond() {
    var r = REGEN[state.vocation];
    return r.mana / r.seconds;
  }

  function durationMsForSettings() {
    return (totalMana() / manaPerSecond()) * 1000;
  }

  function formatTime(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  function clamp(n, a, b) {
    return Math.min(b, Math.max(a, n));
  }

  function setLiquid(progress) {
    var p = clamp(progress, 0, 1);
    var h = LIQUID_MAX_H * p;
    var y = LIQUID_BOTTOM - h;

    if (els.liquid) {
      els.liquid.setAttribute("y", String(y));
      els.liquid.setAttribute("height", String(Math.max(h, 0.01)));
      els.liquid.style.opacity = p <= 0.001 ? "0" : "1";
    }

    if (els.wave) {
      if (p <= 0.001) {
        els.wave.style.opacity = "0";
      } else {
        els.wave.style.opacity = "1";
        els.wave.setAttribute("cy", String(y + 1));
        // onda mais estreita no gargalo
        var rx = p > 0.72 ? 28 : (p > 0.55 ? 48 : 78);
        els.wave.setAttribute("rx", String(rx));
      }
    }

    if (els.flaskWrap) {
      els.flaskWrap.classList.toggle("filling", p > 0.001 && p < 0.999 && state.running);
    }
  }

  function manaModeNow() {
    if (state.ready) return "ready";
    if (state.running) return "running";
    if (state.paused) return "paused";
    if (state.hungerBlocked) return "blocked";
    return "idle";
  }

  function manaElapsedNow() {
    var duration = durationMsForSettings();
    if (state.ready) return duration;
    if (state.running) {
      return clamp(performance.now() - state.startedAt, 0, duration);
    }
    if (state.paused || state.hungerBlocked) {
      return clamp(state.pausedElapsedMs || 0, 0, duration);
    }
    var fromField = els.cfgCurrentMana ? parseInt(els.cfgCurrentMana.value, 10) : MIN_MANA;
    if (!Number.isFinite(fromField)) fromField = MIN_MANA;
    return elapsedForMana(clamp(fromField, MIN_MANA, totalMana()));
  }

  function manaNowFromElapsed(elapsedMs) {
    var total = totalMana();
    var mana = Math.floor((Math.max(0, elapsedMs) / 1000) * manaPerSecond());
    return clamp(mana, MIN_MANA, total);
  }

  function saveSettings() {
    syncHungerClock();
    var elapsed = manaElapsedNow();
    var manaNow = manaNowFromElapsed(elapsed);
    var now = Date.now();
    var data = {
      vocation: state.vocation,
      runes: state.runes,
      manaPerRune: state.manaPerRune,
      meatSec: state.meatSec,
      hamSec: state.hamSec,
      maxFoodSec: state.maxFoodSec,
      foodLeftMs: state.foodLeftMs,
      foodSavedAt: now,
      // progresso preciso em ms (evita "voltar" por causa do floor da mana)
      manaElapsedMs: elapsed,
      manaNow: manaNow,
      manaMode: manaModeNow(),
      manaSavedAt: now,
      lastCurrentMana: String(manaNow),
      lastElapsed: formatTime(elapsed)
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      localStorage.removeItem("runetimer-settings-v3");
      localStorage.removeItem("runetimer-settings-v2");
      localStorage.removeItem("runetimer-settings-v1");
    } catch (e) { /* ignore */ }
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        raw =
          localStorage.getItem("runetimer-settings-v3") ||
          localStorage.getItem("runetimer-settings-v2") ||
          localStorage.getItem("runetimer-settings-v1");
      }
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data.vocation) {
        state.vocation = normalizeVocation(data.vocation);
      }
      if (Number.isFinite(data.runes) && data.runes > 0) state.runes = data.runes | 0;
      if (Number.isFinite(data.manaPerRune) && data.manaPerRune > 0) {
        state.manaPerRune = data.manaPerRune | 0;
      }
      if (Number.isFinite(data.meatSec) && data.meatSec > 0) state.meatSec = data.meatSec | 0;
      if (Number.isFinite(data.hamSec) && data.hamSec > 0) state.hamSec = data.hamSec | 0;
      if (Number.isFinite(data.maxFoodSec) && data.maxFoodSec > 0) {
        state.maxFoodSec = data.maxFoodSec | 0;
      }

      var savedAt = Number.isFinite(data.manaSavedAt)
        ? data.manaSavedAt
        : (Number.isFinite(data.foodSavedAt) ? data.foodSavedAt : Date.now());
      var elapsedAway = Math.max(0, Date.now() - savedAt);
      var foodAtSave = Number.isFinite(data.foodLeftMs) ? Math.max(0, data.foodLeftMs) : 0;
      state.foodLeftMs = Math.max(0, foodAtSave - elapsedAway);

      var mode = data.manaMode || "idle";
      var elapsed = Number.isFinite(data.manaElapsedMs)
        ? data.manaElapsedMs
        : elapsedForMana(
            Number.isFinite(data.manaNow)
              ? data.manaNow
              : parseInt(data.lastCurrentMana, 10) || MIN_MANA
          );

      // se estava regenerando, avanca o tempo real (limitado pela fome que ainda restava)
      if (mode === "running") {
        elapsed += Math.min(elapsedAway, foodAtSave);
      }

      elapsed = clamp(elapsed, 0, durationMsForSettings());
      var mana = manaNowFromElapsed(elapsed);

      state._savedCurrentMana = String(mana);
      state._savedElapsed = formatTime(elapsed);
      state._savedManaMode = mode;
      state._restoreMana = mana;
      state._restoreElapsedMs = elapsed;
    } catch (e) { /* ignore */ }
  }

  function restoreManaSession() {
    var elapsed = state._restoreElapsedMs;
    var mode = state._savedManaMode || "idle";
    var total = totalMana();

    if (!Number.isFinite(elapsed)) {
      renderIdle();
      return;
    }

    state.durationMs = durationMsForSettings();
    elapsed = clamp(elapsed, 0, state.durationMs);
    var mana = manaNowFromElapsed(elapsed);

    if (mode === "ready" || elapsed >= state.durationMs || mana >= total) {
      state.running = false;
      state.paused = false;
      state.hungerBlocked = false;
      state.pausedElapsedMs = state.durationMs;
      setLiquid(1);
      setReady(true);
      writeSyncFields(total, state.durationMs);
      if (els.timeLeft) els.timeLeft.textContent = "0:00";
      if (els.manaLine) els.manaLine.textContent = total + " / " + total + " mana";
      if (els.statusText) els.statusText.textContent = "Mana cheia! Craftar de novo";
      if (els.btnStart) els.btnStart.textContent = "De novo";
      updatePauseButton();
      return;
    }

    if (mode === "running") {
      resumeFromProgress(elapsed);
      return;
    }

    if (mode === "paused") {
      state.running = false;
      state.paused = true;
      state.hungerBlocked = false;
      state.pausedElapsedMs = elapsed;
      state.ready = false;
      setReady(false);
      applyManaVisual(elapsed);
      if (els.flaskWrap) els.flaskWrap.classList.remove("filling");
      if (els.statusText) els.statusText.textContent = "Pausado";
      if (els.btnStart) els.btnStart.textContent = "Craftar";
      updatePauseButton();
      return;
    }

    if (mode === "blocked" || state.foodLeftMs <= 0) {
      state.running = false;
      state.paused = false;
      state.hungerBlocked = true;
      state.pausedElapsedMs = elapsed;
      state.ready = false;
      setReady(false);
      applyManaVisual(elapsed);
      if (els.flaskWrap) els.flaskWrap.classList.remove("filling");
      if (els.statusText) els.statusText.textContent = "Sem fome - mana parada";
      if (els.btnStart) els.btnStart.textContent = "Craftar";
      updatePauseButton();
      return;
    }

    state.running = false;
    state.paused = false;
    state.hungerBlocked = false;
    state.pausedElapsedMs = elapsed;
    state.ready = false;
    setReady(false);
    applyManaVisual(elapsed);
    if (els.statusText) els.statusText.textContent = "Pronto pra craftar";
    if (els.btnStart) els.btnStart.textContent = "Craftar";
    updatePauseButton();
  }

  function syncInputs() {
    if (els.cfgRunes) els.cfgRunes.value = String(state.runes);
    if (els.cfgMana) els.cfgMana.value = String(state.manaPerRune);
    if (els.cfgMeatSec) els.cfgMeatSec.value = String(state.meatSec);
    if (els.cfgHamSec) els.cfgHamSec.value = String(state.hamSec);
    if (els.cfgMaxFoodSec) els.cfgMaxFoodSec.value = String(state.maxFoodSec);
    if (!isSyncEditing()) {
      if (els.cfgCurrentMana && state._savedCurrentMana != null && state._savedCurrentMana !== "") {
        els.cfgCurrentMana.value = String(state._savedCurrentMana);
      }
      if (els.cfgElapsed && state._savedElapsed) {
        els.cfgElapsed.value = String(state._savedElapsed);
      }
    }
    if (els.segBtns) {
      els.segBtns.forEach(function (btn) {
        btn.classList.toggle("active", btn.getAttribute("data-voc") === state.vocation);
      });
    }
    updateFoodButtonTitles();
    updateHint();
  }

  function updateFoodButtonTitles() {
    if (els.btnMeat) {
      els.btnMeat.title = "Meat (+" + formatTime(state.meatSec * 1000) + ")";
    }
    if (els.btnHam) {
      els.btnHam.title = "Ham (+" + formatTime(state.hamSec * 1000) + ")";
    }
  }

  function maxFoodMs() {
    return Math.max(1000, state.maxFoodSec * 1000);
  }

  function syncHungerClock() {
    if (!state.foodUpdatedAt) {
      state.foodUpdatedAt = performance.now();
      return;
    }
    var now = performance.now();
    var dt = now - state.foodUpdatedAt;
    state.foodUpdatedAt = now;
    if (dt > 0 && state.foodLeftMs > 0) {
      state.foodLeftMs = Math.max(0, state.foodLeftMs - dt);
    }
  }

  function setHungerLiquid(progress) {
    var p = clamp(progress, 0, 1);
    var h = LIQUID_MAX_H * p;
    var y = LIQUID_BOTTOM - h;
    if (els.hungerLiquid) {
      els.hungerLiquid.setAttribute("y", String(y));
      els.hungerLiquid.setAttribute("height", String(Math.max(h, 0.01)));
      els.hungerLiquid.style.opacity = p <= 0.001 ? "0" : "1";
    }
    if (els.hungerWave) {
      if (p <= 0.001) {
        els.hungerWave.style.opacity = "0";
      } else {
        els.hungerWave.style.opacity = "1";
        els.hungerWave.setAttribute("cy", String(y + 1));
        var rx = p > 0.72 ? 28 : (p > 0.55 ? 48 : 78);
        els.hungerWave.setAttribute("rx", String(rx));
      }
    }
  }

  function renderHunger() {
    var maxMs = maxFoodMs();
    var left = clamp(state.foodLeftMs, 0, maxMs);
    var progress = left / maxMs;
    setHungerLiquid(progress);

    if (els.hungerTime) els.hungerTime.textContent = formatTime(left);
    if (els.hungerLine) {
      els.hungerLine.textContent = formatTime(left) + " / " + formatTime(maxMs);
    }

    var empty = left <= 0;
    var nearlyFull = left >= maxMs - 500;
    if (els.hungerWrap) {
      els.hungerWrap.classList.toggle("empty", empty);
    }
    if (els.hungerStatus) {
      if (empty) els.hungerStatus.textContent = "Com fome! Come algo";
      else if (nearlyFull) els.hungerStatus.textContent = "Quase cheio";
      else els.hungerStatus.textContent = "Alimentado";
    }
  }

  function flashFoodFull() {
    if (!els.hungerWrap || !els.hungerStatus) return;
    els.hungerStatus.textContent = "You are full";
    els.hungerWrap.classList.add("full-flash");
    setTimeout(function () {
      if (els.hungerWrap) els.hungerWrap.classList.remove("full-flash");
      renderHunger();
    }, 1200);
  }

  function freezeManaForHunger() {
    // para a regen de mana como no tibia (sem food = sem regen)
    if (state.hungerBlocked) return;

    if (state.running && !state.paused) {
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
      state.pausedElapsedMs = Math.max(0, performance.now() - state.startedAt);
      state.running = false;
      state.hungerBlocked = true;
      if (els.flaskWrap) els.flaskWrap.classList.remove("filling");
      if (els.statusText) els.statusText.textContent = "Sem fome - mana parada";
      if (els.btnStart) els.btnStart.textContent = "Craftar";
      updatePauseButton();
      playHungerAlert();
      return;
    }

    // ja estava pausado pelo usuario: so marca bloqueio
    if (state.paused || state.pausedElapsedMs > 0 || state.ready === false) {
      state.hungerBlocked = true;
      if (els.statusText && !state.ready) {
        els.statusText.textContent = "Sem fome - mana parada";
      }
      updatePauseButton();
      playHungerAlert();
    }
  }

  function resumeManaAfterEating() {
    if (!state.hungerBlocked) return;
    if (state.foodLeftMs <= 0) return;
    // se o usuario pausou manualmente, so libera o bloqueio
    if (state.paused) {
      state.hungerBlocked = false;
      if (els.statusText) els.statusText.textContent = "Pausado";
      updatePauseButton();
      return;
    }
    state.hungerBlocked = false;
    resumeFromProgress(state.pausedElapsedMs || 0);
  }

  function eatFood(kind) {
    syncHungerClock();
    var addMs = (kind === "ham" ? state.hamSec : state.meatSec) * 1000;
    var maxMs = maxFoodMs();
    var room = maxMs - state.foodLeftMs;

    // no classic, se nao cabe o food inteiro costuma dar "you are full"
    // (3 ham = 1080s, max 1200s; o 4o ham nao entra)
    if (room < addMs - 20) {
      flashFoodFull();
      return;
    }

    var wasEmpty = state.foodLeftMs <= 0;
    state.foodLeftMs = Math.min(maxMs, state.foodLeftMs + addMs);
    state.foodUpdatedAt = performance.now();
    state.hungerAlertPlayed = false;
    unlockAudio();
    renderHunger();
    saveSettings();
    bumpAntiAfk();
    if (wasEmpty || state.hungerBlocked) resumeManaAfterEating();
  }

  function tickHunger(now) {
    if (!state.foodUpdatedAt) state.foodUpdatedAt = now;
    var before = state.foodLeftMs;
    var dt = now - state.foodUpdatedAt;
    state.foodUpdatedAt = now;
    if (dt > 0 && state.foodLeftMs > 0) {
      state.foodLeftMs = Math.max(0, state.foodLeftMs - dt);
    }
    if (before > 0 && state.foodLeftMs <= 0) {
      freezeManaForHunger();
    } else if (state.foodLeftMs > 0) {
      state.hungerAlertPlayed = false;
    }
    renderHunger();
    state.hungerRaf = requestAnimationFrame(tickHunger);
  }

  function startHungerLoop() {
    if (state.hungerRaf) cancelAnimationFrame(state.hungerRaf);
    state.foodUpdatedAt = performance.now();
    state.hungerRaf = requestAnimationFrame(tickHunger);
  }

  function updateHint() {
    if (!els.regenHint) return;
    var r = REGEN[state.vocation];
    var secs = durationMsForSettings() / 1000;
    var mins = Math.floor(secs / 60);
    var rem = Math.round(secs % 60);
    els.regenHint.textContent =
      r.label +
      " | " +
      state.runes +
      " runa(s) x " +
      state.manaPerRune +
      " = " +
      totalMana() +
      " mana | ~" +
      mins +
      "m " +
      rem +
      "s pra encher | fome max " +
      formatTime(maxFoodMs()) +
      " (Ham " +
      formatTime(state.hamSec * 1000) +
      ", Meat " +
      formatTime(state.meatSec * 1000) +
      ")";
  }

  function parseElapsedToMs(raw) {
    if (!raw) return 0;
    var text = String(raw).trim();
    if (!text) return 0;

    // aceita 16:00, 16.00, 16m, 960, 16
    var mmss = text.match(/^(\d+)\s*[:.]\s*(\d{1,2})$/);
    if (mmss) {
      return (parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10)) * 1000;
    }

    var withM = text.match(/^(\d+)\s*m(?:in)?(?:\s*(\d+)\s*s(?:ec)?)?$/i);
    if (withM) {
      var secPart = withM[2] ? parseInt(withM[2], 10) : 0;
      return (parseInt(withM[1], 10) * 60 + secPart) * 1000;
    }

    var onlyNum = parseFloat(text.replace(",", "."));
    if (!Number.isFinite(onlyNum) || onlyNum < 0) return 0;
    // numero puro: se >= 100 trata como segundos; senao como minutos
    if (onlyNum >= 100) return onlyNum * 1000;
    return onlyNum * 60 * 1000;
  }

  function syncOwnerDoc() {
    if (els.cfgCurrentMana && els.cfgCurrentMana.ownerDocument) {
      return els.cfgCurrentMana.ownerDocument;
    }
    return document;
  }

  function isSyncFieldFocused() {
    var active = syncOwnerDoc().activeElement;
    return !!(
      active &&
      (active === els.cfgCurrentMana || active === els.cfgElapsed)
    );
  }

  function isSyncEditing() {
    return !!(state.syncLocked || state.syncDirty || isSyncFieldFocused());
  }

  function lockSyncFields() {
    state.syncLocked = true;
  }

  function unlockSyncFields() {
    state.syncLocked = false;
    state.syncDirty = false;
    state.syncSnapMana = null;
    state.syncSnapElapsed = null;
  }

  function maybeUnlockSyncFields() {
    // espera o foco mudar (ex.: Mana atual -> Sincronizar) antes de liberar
    setTimeout(function () {
      if (isSyncFieldFocused()) return;
      var active = syncOwnerDoc().activeElement;
      if (active && active.id === "btnSync") return;
      if (state.syncDirty || state.syncSnapMana != null) return;
      state.syncLocked = false;
    }, 0);
  }

  function snapshotSyncInputs() {
    state.syncSnapMana = els.cfgCurrentMana ? els.cfgCurrentMana.value : "";
    state.syncSnapElapsed = els.cfgElapsed ? els.cfgElapsed.value : "";
    state.syncDirty = true;
    state.syncLocked = true;
  }

  function readSyncInputs() {
    // prioriza snapshot do clique (antes do timer sobrescrever o campo)
    var manaRaw =
      state.syncSnapMana != null
        ? state.syncSnapMana
        : els.cfgCurrentMana
          ? els.cfgCurrentMana.value
          : "";
    var elapsedRaw =
      state.syncSnapElapsed != null
        ? state.syncSnapElapsed
        : els.cfgElapsed
          ? els.cfgElapsed.value
          : "0:00";

    var hasMana = manaRaw !== "" && manaRaw !== null;
    var currentMana = hasMana ? parseInt(manaRaw, 10) : NaN;
    var elapsedMs = parseElapsedToMs(elapsedRaw);
    var mps = manaPerSecond();
    var total = totalMana();

    if (!Number.isFinite(currentMana) || currentMana < 0) currentMana = NaN;

    // mana do client manda; tempo so entra se mana nao foi informada
    if (!Number.isFinite(currentMana)) {
      if (elapsedMs > 0) {
        currentMana = Math.floor((elapsedMs / 1000) * mps);
      } else {
        currentMana = 0;
      }
    }

    if (!Number.isFinite(currentMana) || currentMana < MIN_MANA) currentMana = MIN_MANA;
    currentMana = clamp(currentMana, MIN_MANA, total);

    // progresso sempre pela mana digitada (nao pelo tempo antigo do campo)
    elapsedMs = (currentMana / mps) * 1000;

    return { currentMana: currentMana, elapsedMs: elapsedMs, total: total, mps: mps };
  }

  function writeSyncFields(mana, elapsedMs, force) {
    // enquanto o usuario edita, nenhum tick/processo sobrescreve os campos
    if (!force && isSyncEditing()) return;
    if (els.cfgCurrentMana) els.cfgCurrentMana.value = String(Math.floor(mana));
    if (els.cfgElapsed) els.cfgElapsed.value = formatTime(elapsedMs);
  }

  function updatePauseButton() {
    if (!els.btnPause) return;
    if (state.paused) {
      els.btnPause.textContent = "Continuar";
      els.btnPause.disabled = false;
      els.btnPause.classList.add("is-paused");
    } else if (state.hungerBlocked) {
      els.btnPause.textContent = "Pause";
      els.btnPause.disabled = true;
      els.btnPause.classList.remove("is-paused");
    } else if (state.running) {
      els.btnPause.textContent = "Pause";
      els.btnPause.disabled = false;
      els.btnPause.classList.remove("is-paused");
    } else {
      els.btnPause.textContent = "Pause";
      els.btnPause.disabled = true;
      els.btnPause.classList.remove("is-paused");
    }
  }

  function applyManaVisual(elapsedMs) {
    var cappedElapsed = clamp(elapsedMs, 0, state.durationMs || durationMsForSettings());
    state.durationMs = durationMsForSettings();
    setLiquid(cappedElapsed / state.durationMs);
    var manaNow = Math.min(totalMana(), Math.floor((cappedElapsed / 1000) * manaPerSecond()));
    writeSyncFields(manaNow, cappedElapsed);
    if (els.timeLeft) els.timeLeft.textContent = formatTime(state.durationMs - cappedElapsed);
    if (els.manaLine) els.manaLine.textContent = manaNow + " / " + totalMana() + " mana";
  }

  function resumeFromProgress(elapsedMs) {
    unlockAudio();
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;

    state.durationMs = durationMsForSettings();
    var cappedElapsed = clamp(elapsedMs, 0, state.durationMs);

    if (cappedElapsed >= state.durationMs) {
      state.running = false;
      state.paused = false;
      state.hungerBlocked = false;
      state.pausedElapsedMs = 0;
      unlockSyncFields();
      state.startedAt = performance.now() - state.durationMs;
      finishCycle();
      return;
    }

    state.paused = false;
    state.pausedElapsedMs = cappedElapsed;
    state.ready = false;
    unlockSyncFields();
    setReady(false);
    applyManaVisual(cappedElapsed);

    // sem fome: congela no ponto sincronizado
    syncHungerClock();
    if (state.foodLeftMs <= 0) {
      state.running = false;
      state.hungerBlocked = true;
      state.startedAt = performance.now() - cappedElapsed;
      if (els.flaskWrap) els.flaskWrap.classList.remove("filling");
      if (els.btnStart) els.btnStart.textContent = "Craftar";
      if (els.statusText) els.statusText.textContent = "Sem fome - mana parada";
      updatePauseButton();
      return;
    }

    state.running = true;
    state.hungerBlocked = false;
    state.startedAt = performance.now() - cappedElapsed;
    if (els.btnStart) els.btnStart.textContent = "Rodando...";
    if (els.statusText) els.statusText.textContent = "Regenerando mana...";
    updatePauseButton();
    state.raf = requestAnimationFrame(renderTick);
  }

  function pauseCycle() {
    if (!state.running || state.paused) return;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.pausedElapsedMs = Math.max(0, performance.now() - state.startedAt);
    state.running = false;
    state.paused = true;
    state.hungerBlocked = false;
    if (els.flaskWrap) els.flaskWrap.classList.remove("filling");
    if (els.statusText) els.statusText.textContent = "Pausado";
    if (els.btnStart) els.btnStart.textContent = "Craftar";
    updatePauseButton();
  }

  function resumeCycle() {
    if (!state.paused) return;
    syncHungerClock();
    if (state.foodLeftMs <= 0) {
      state.paused = false;
      state.hungerBlocked = true;
      if (els.statusText) els.statusText.textContent = "Sem fome - mana parada";
      updatePauseButton();
      return;
    }
    resumeFromProgress(state.pausedElapsedMs);
  }

  function togglePause() {
    bumpAntiAfk();
    if (state.paused) resumeCycle();
    else if (state.running) pauseCycle();
  }

  function syncFromGame() {
    // se ainda nao houve snapshot (teclado/enter), captura agora
    if (state.syncSnapMana == null) snapshotSyncInputs();

    // para o tick ANTES de ler, pra nao sobrescrever o valor digitado
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;

    readConfigFromInputs({ silent: true });
    var sync = readSyncInputs();
    var elapsedFromMana = (sync.currentMana / sync.mps) * 1000;

    unlockSyncFields();
    writeSyncFields(sync.currentMana, elapsedFromMana, true);
    saveSettings();
    bumpAntiAfk();
    resumeFromProgress(elapsedFromMana);
  }

  function elapsedForMana(mana) {
    return (Math.max(MIN_MANA, mana) / manaPerSecond()) * 1000;
  }

  function currentManaNow() {
    var total = totalMana();
    var mps = manaPerSecond();
    if (state.ready) return total;
    if (state.running) {
      var elapsed = Math.max(0, performance.now() - state.startedAt);
      return clamp(Math.floor((elapsed / 1000) * mps), MIN_MANA, total);
    }
    if (state.paused || state.hungerBlocked) {
      return clamp(Math.floor((state.pausedElapsedMs / 1000) * mps), MIN_MANA, total);
    }
    var fromField = els.cfgCurrentMana ? parseInt(els.cfgCurrentMana.value, 10) : MIN_MANA;
    if (!Number.isFinite(fromField) || fromField < MIN_MANA) fromField = MIN_MANA;
    return clamp(fromField, MIN_MANA, total);
  }

  function applyManaLevel(mana, opts) {
    var total = totalMana();
    var mps = manaPerSecond();
    mana = clamp(Math.round(mana), MIN_MANA, total);
    var elapsed = (mana / mps) * 1000;
    var keepPaused = !!(opts && opts.keepPaused);

    writeSyncFields(mana, elapsed);
    saveSettings();
    state.durationMs = durationMsForSettings();

    if (mana >= total) {
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
      finishCycle();
      return;
    }

    setReady(false);
    state.ready = false;
    setLiquid(mana / total);
    if (els.timeLeft) els.timeLeft.textContent = formatTime(state.durationMs - elapsed);
    if (els.manaLine) els.manaLine.textContent = mana + " / " + total + " mana";

    if (keepPaused) {
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
      state.running = false;
      state.paused = true;
      state.pausedElapsedMs = elapsed;
      state.startedAt = performance.now() - elapsed;
      if (els.flaskWrap) els.flaskWrap.classList.remove("filling");
      if (els.statusText) els.statusText.textContent = "Pausado";
      if (els.btnStart) els.btnStart.textContent = "Craftar";
      updatePauseButton();
      return;
    }

    if (state.running) {
      state.startedAt = performance.now() - elapsed;
      state.pausedElapsedMs = elapsed;
      return;
    }

    resumeFromProgress(elapsed);
  }

  function nudgeMana(delta) {
    var wasRunning = state.running && !state.paused;
    bumpAntiAfk();
    applyManaLevel(currentManaNow() + delta, { keepPaused: !wasRunning });
  }

  function setReady(on) {
    state.ready = on;
    if (els.flaskWrap) els.flaskWrap.classList.toggle("ready", on);
  }

  function renderIdle() {
    state.paused = false;
    state.hungerBlocked = false;
    state.pausedElapsedMs = elapsedForMana(MIN_MANA);
    setReady(false);
    state.durationMs = durationMsForSettings();
    applyManaVisual(state.pausedElapsedMs);
    if (els.statusText) els.statusText.textContent = "Pronto pra craftar";
    if (els.btnStart) els.btnStart.textContent = "Craftar";
    updatePauseButton();
  }

  function renderTick(now) {
    // sem fome = sem regen (igual tibia)
    if (state.foodLeftMs <= 0) {
      freezeManaForHunger();
      return;
    }

    var elapsed = now - state.startedAt;
    var progress = clamp(elapsed / state.durationMs, 0, 1);
    var mana = Math.min(
      totalMana(),
      Math.max(MIN_MANA, Math.floor((elapsed / 1000) * manaPerSecond()))
    );
    var left = state.durationMs - elapsed;

    setLiquid(progress);
    if (els.timeLeft) els.timeLeft.textContent = formatTime(left);
    if (els.manaLine) els.manaLine.textContent = mana + " / " + totalMana() + " mana";
    if (els.statusText) els.statusText.textContent = "Regenerando mana...";

    // nao sobrescreve enquanto o usuario esta editando / vai sincronizar
    writeSyncFields(mana, elapsed);

    if (progress >= 1) {
      finishCycle();
      return;
    }
    state.raf = requestAnimationFrame(renderTick);
  }

  function soundSrc(fileName) {
    try {
      return new URL("sounds/" + fileName, window.location.href).href;
    } catch (e) {
      return "sounds/" + fileName;
    }
  }

  function ensureBell() {
    if (!state.bellAudio) {
      state.bellAudio = new Audio(soundSrc("bell.mp3"));
      state.bellAudio.preload = "auto";
      state.bellAudio.volume = 1;
    }
    return state.bellAudio;
  }

  function ensureHungerSfx() {
    if (!state.hungerAudio) {
      state.hungerAudio = new Audio(soundSrc("hunger.mp3"));
      state.hungerAudio.preload = "auto";
      state.hungerAudio.volume = 1;
    }
    return state.hungerAudio;
  }

  function unlockAudio() {
    var audio = ensureBell();
    ensureHungerSfx();
    // gesto do usuario: carrega/desbloqueia playback no Chrome
    var p = audio.play();
    if (p && typeof p.then === "function") {
      return p.then(function () {
        audio.pause();
        audio.currentTime = 0;
        return audio;
      }).catch(function () {
        return audio;
      });
    }
    audio.pause();
    audio.currentTime = 0;
    return Promise.resolve(audio);
  }

  function stopAfkAmbient() {
    if (state.afkAmbientAudio) {
      try {
        state.afkAmbientAudio.pause();
        state.afkAmbientAudio.currentTime = 0;
      } catch (e) { /* ignore */ }
    }
    state.afkAmbientAudio = null;
    state.afkAmbientKind = null;
    state.afkAmbientStarted = false;
  }

  function pickAfkAmbient() {
    var i = Math.floor(Math.random() * AFK_AMBIENTS.length);
    return AFK_AMBIENTS[i] || "rain";
  }

  function ensureAfkAmbient(kind) {
    if (state.afkAmbientAudio && state.afkAmbientKind === kind) {
      return state.afkAmbientAudio;
    }
    stopAfkAmbient();
    var audio = new Audio(soundSrc("ambient-" + kind + ".mp3"));
    audio.preload = "auto";
    audio.loop = true;
    audio.volume = 0.01;
    state.afkAmbientAudio = audio;
    state.afkAmbientKind = kind;
    return audio;
  }

  function afkElapsedMs() {
    if (state.afkPaused) return Math.max(0, state.afkPausedElapsedMs || 0);
    if (!state.afkStartedAt) return 0;
    return Math.max(0, performance.now() - state.afkStartedAt);
  }

  function afkVolumeForElapsed(elapsed) {
    if (elapsed < AFK_WARN_MS) return 0;
    if (elapsed >= AFK_TOTAL_MS) return 0.72;
    var t = (elapsed - AFK_WARN_MS) / (AFK_TOTAL_MS - AFK_WARN_MS);
    // curva suave: bem baixinho no inicio do aviso, sobe ate o fim
    return 0.04 + Math.pow(clamp(t, 0, 1), 1.35) * 0.68;
  }

  function updateAfkPauseButton() {
    if (!els.btnAfkPause) return;
    if (state.afkPaused) {
      els.btnAfkPause.textContent = "Continuar";
      els.btnAfkPause.classList.add("is-paused");
    } else {
      els.btnAfkPause.textContent = "Pause";
      els.btnAfkPause.classList.remove("is-paused");
    }
  }

  function pauseAfkAmbientOnly() {
    if (!state.afkAmbientAudio) return;
    try {
      state.afkAmbientAudio.pause();
    } catch (e) { /* ignore */ }
  }

  function updateAfkAmbient(elapsed) {
    if (state.afkPaused) {
      pauseAfkAmbientOnly();
      return;
    }

    if (elapsed < AFK_WARN_MS) {
      if (state.afkAmbientStarted) stopAfkAmbient();
      return;
    }

    if (!state.afkAmbientStarted) {
      var kind = pickAfkAmbient();
      var audio = ensureAfkAmbient(kind);
      state.afkAmbientStarted = true;
      unlockAudio();
      audio.volume = afkVolumeForElapsed(elapsed);
      var p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch(function () { /* precisa de gesto; proxima acao destrava */ });
      }
    } else if (state.afkAmbientAudio) {
      try {
        state.afkAmbientAudio.volume = afkVolumeForElapsed(elapsed);
        if (state.afkAmbientAudio.paused) {
          state.afkAmbientAudio.play().catch(function () { /* ignore */ });
        }
      } catch (e) { /* ignore */ }
    }
  }

  function renderAfk() {
    var elapsed = afkElapsedMs();
    var left = Math.max(0, AFK_TOTAL_MS - elapsed);
    var progress = clamp(1 - elapsed / AFK_TOTAL_MS, 0, 1);

    if (els.afkFill) els.afkFill.style.width = (progress * 100).toFixed(2) + "%";
    if (els.afkTime) els.afkTime.textContent = formatTime(left);

    var warn = elapsed >= AFK_WARN_MS;
    var danger = elapsed >= AFK_TOTAL_MS;
    if (els.afkWrap) {
      els.afkWrap.classList.toggle("warn", warn && !danger && !state.afkPaused);
      els.afkWrap.classList.toggle("danger", danger && !state.afkPaused);
      els.afkWrap.classList.toggle("is-paused", state.afkPaused);
    }

    updateAfkAmbient(elapsed);
    updateAfkPauseButton();

    if (els.afkStatus) {
      if (state.afkPaused) {
        els.afkStatus.textContent = "Pausado — tempo congelado";
      } else if (danger) {
        var label = AFK_LABELS[state.afkAmbientKind] || "ambiente";
        els.afkStatus.textContent =
          formatTime(AFK_TOTAL_MS) + " — risco de kick! Som: " + label + " (aja no jogo)";
      } else if (warn) {
        var labelWarn = AFK_LABELS[state.afkAmbientKind] || "ambiente";
        els.afkStatus.textContent =
          "Quase AFK — " + labelWarn + " subindo o volume";
      } else {
        els.afkStatus.textContent = "Ativo — qualquer ação reinicia";
      }
    }
  }

  function pauseAfk() {
    if (state.afkPaused) return;
    state.afkPausedElapsedMs = afkElapsedMs();
    state.afkPaused = true;
    pauseAfkAmbientOnly();
    renderAfk();
  }

  function resumeAfk() {
    if (!state.afkPaused) return;
    state.afkStartedAt = performance.now() - (state.afkPausedElapsedMs || 0);
    state.afkPaused = false;
    renderAfk();
  }

  function toggleAfkPause() {
    unlockAudio();
    if (state.afkPaused) resumeAfk();
    else pauseAfk();
  }

  function bumpAntiAfk() {
    state.afkPaused = false;
    state.afkPausedElapsedMs = 0;
    state.afkStartedAt = performance.now();
    stopAfkAmbient();
    renderAfk();
  }

  function tickAfk() {
    renderAfk();
    state.afkRaf = requestAnimationFrame(tickAfk);
  }

  function startAfkLoop() {
    if (!state.afkStartedAt) state.afkStartedAt = performance.now();
    if (state.afkRaf) cancelAnimationFrame(state.afkRaf);
    state.afkRaf = requestAnimationFrame(tickAfk);
  }

  function playAudioClip(audio) {
    if (!audio) return;
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;
      var p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch(function () {
          unlockAudio().then(function () {
            audio.currentTime = 0;
            audio.play().catch(function () { /* ignore */ });
          });
        });
      }
    } catch (e) { /* ignore */ }
  }

  function playDing() {
    playAudioClip(ensureBell());
  }

  function playHungerAlert(force) {
    if (!force && state.hungerAlertPlayed) return;
    if (!force) state.hungerAlertPlayed = true;
    unlockAudio();
    playAudioClip(ensureHungerSfx());
  }

  function finishCycle() {
    state.running = false;
    state.paused = false;
    state.hungerBlocked = false;
    state.pausedElapsedMs = 0;
    state.raf = 0;
    setLiquid(1);
    setReady(true);
    if (els.flaskWrap) els.flaskWrap.classList.remove("filling");
    if (els.timeLeft) els.timeLeft.textContent = "0:00";
    if (els.manaLine) els.manaLine.textContent = totalMana() + " / " + totalMana() + " mana";
    if (els.statusText) els.statusText.textContent = "Mana cheia! Craftar de novo";
    if (els.btnStart) els.btnStart.textContent = "De novo";
    updatePauseButton();
    playDing();
  }

  function startCycle() {
    unlockAudio(); // libera audio no clique (Chrome)
    bumpAntiAfk();
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.paused = false;
    state.ready = false;
    setReady(false);
    state.durationMs = durationMsForSettings();
    // "De novo" / Craftar sempre comeca em 1 mana (nunca 0)
    var startElapsed = elapsedForMana(MIN_MANA);
    state.pausedElapsedMs = startElapsed;
    state.startedAt = performance.now() - startElapsed;
    applyManaVisual(startElapsed);
    syncHungerClock();

    if (state.foodLeftMs <= 0) {
      state.running = false;
      state.hungerBlocked = true;
      if (els.flaskWrap) els.flaskWrap.classList.remove("filling");
      if (els.btnStart) els.btnStart.textContent = "Craftar";
      if (els.statusText) els.statusText.textContent = "Sem fome - mana parada";
      updatePauseButton();
      return;
    }

    state.running = true;
    state.hungerBlocked = false;
    if (els.btnStart) els.btnStart.textContent = "Rodando...";
    if (els.statusText) els.statusText.textContent = "Regenerando mana...";
    updatePauseButton();
    state.raf = requestAnimationFrame(renderTick);
  }

  function resetHunger() {
    syncHungerClock();
    state.foodLeftMs = 0;
    state.foodUpdatedAt = performance.now();
    state.hungerAlertPlayed = false;
    renderHunger();
    // se estava regenerando, congela por falta de fome
    if (state.running && !state.paused) {
      freezeManaForHunger();
    } else if (!state.ready) {
      state.hungerBlocked = true;
      if (els.statusText) els.statusText.textContent = "Sem fome - mana parada";
      updatePauseButton();
    }
    bumpAntiAfk();
    saveSettings();
  }

  function resetCycle() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.running = false;
    state.paused = false;
    state.hungerBlocked = false;
    state.pausedElapsedMs = 0;
    // Reset geral: mana + fome
    state.foodLeftMs = 0;
    state.foodUpdatedAt = performance.now();
    state.hungerAlertPlayed = false;
    renderIdle();
    renderHunger();
    bumpAntiAfk();
    saveSettings();
  }

  function readConfigFromInputs(opts) {
    if (els.cfgRunes) {
      var runes = parseInt(els.cfgRunes.value, 10);
      if (Number.isFinite(runes) && runes > 0) state.runes = runes;
    }
    if (els.cfgMana) {
      var mana = parseInt(els.cfgMana.value, 10);
      if (Number.isFinite(mana) && mana > 0) state.manaPerRune = mana;
    }
    if (els.cfgMeatSec) {
      var meat = parseInt(els.cfgMeatSec.value, 10);
      if (Number.isFinite(meat) && meat > 0) state.meatSec = meat;
    }
    if (els.cfgHamSec) {
      var ham = parseInt(els.cfgHamSec.value, 10);
      if (Number.isFinite(ham) && ham > 0) state.hamSec = ham;
    }
    if (els.cfgMaxFoodSec) {
      var maxFood = parseInt(els.cfgMaxFoodSec.value, 10);
      if (Number.isFinite(maxFood) && maxFood > 0) state.maxFoodSec = maxFood;
    }
    state.foodLeftMs = Math.min(state.foodLeftMs, maxFoodMs());
    updateFoodButtonTitles();
    renderHunger();
    saveSettings();
    updateHint();
    if (!state.running && !state.paused && !(opts && opts.silent)) renderIdle();
  }

  function wireEvents() {
    // onclick/oninput pra poder religar sem duplicar listener ao ir/voltar do PiP
    if (els.btnStart) els.btnStart.onclick = function () { startCycle(); };
    if (els.btnPause) els.btnPause.onclick = function () { togglePause(); };
    if (els.btnReset) els.btnReset.onclick = function () { resetCycle(); };
    if (els.btnPip) els.btnPip.onclick = function () { openMiniwindow(); };
    if (els.btnAfkPause) els.btnAfkPause.onclick = function () { toggleAfkPause(); };
    if (els.btnManaUp) els.btnManaUp.onclick = function () { nudgeMana(1); };
    if (els.btnManaDown) els.btnManaDown.onclick = function () { nudgeMana(-1); };
    if (els.btnBell) {
      els.btnBell.onclick = function () {
        bumpAntiAfk();
        playDing();
      };
    }
    if (els.btnMeat) els.btnMeat.onclick = function () { eatFood("meat"); };
    if (els.btnHam) els.btnHam.onclick = function () { eatFood("ham"); };
    if (els.btnHungerSfx) {
      els.btnHungerSfx.onclick = function () { playHungerAlert(true); };
    }
    if (els.btnHungerReset) {
      els.btnHungerReset.onclick = function () { resetHunger(); };
    }
    if (els.btnSync) {
      // captura o valor NO POINTERDOWN, antes do foco sair e o tick sobrescrever
      els.btnSync.onpointerdown = function () { snapshotSyncInputs(); };
      els.btnSync.onclick = function () { syncFromGame(); };
    }
    if (els.cfgCurrentMana) {
      els.cfgCurrentMana.onpointerdown = lockSyncFields;
      els.cfgCurrentMana.onfocus = lockSyncFields;
      els.cfgCurrentMana.oninput = function () {
        state.syncDirty = true;
        state.syncLocked = true;
      };
      els.cfgCurrentMana.onchange = function () {
        state.syncDirty = true;
        state.syncLocked = true;
      };
      els.cfgCurrentMana.onblur = maybeUnlockSyncFields;
    }
    if (els.cfgElapsed) {
      els.cfgElapsed.onpointerdown = lockSyncFields;
      els.cfgElapsed.onfocus = lockSyncFields;
      els.cfgElapsed.oninput = function () {
        state.syncDirty = true;
        state.syncLocked = true;
      };
      els.cfgElapsed.onchange = function () {
        state.syncDirty = true;
        state.syncLocked = true;
      };
      els.cfgElapsed.onblur = maybeUnlockSyncFields;
    }
    if (els.cfgRunes) {
      els.cfgRunes.oninput = readConfigFromInputs;
      els.cfgRunes.onchange = readConfigFromInputs;
    }
    if (els.cfgMana) {
      els.cfgMana.oninput = readConfigFromInputs;
      els.cfgMana.onchange = readConfigFromInputs;
    }
    if (els.cfgMeatSec) {
      els.cfgMeatSec.oninput = readConfigFromInputs;
      els.cfgMeatSec.onchange = readConfigFromInputs;
    }
    if (els.cfgHamSec) {
      els.cfgHamSec.oninput = readConfigFromInputs;
      els.cfgHamSec.onchange = readConfigFromInputs;
    }
    if (els.cfgMaxFoodSec) {
      els.cfgMaxFoodSec.oninput = readConfigFromInputs;
      els.cfgMaxFoodSec.onchange = readConfigFromInputs;
    }
    if (els.segBtns) {
      els.segBtns.forEach(function (btn) {
        btn.onclick = function () {
          state.vocation = normalizeVocation(btn.getAttribute("data-voc"));
          bumpAntiAfk();
          syncInputs();
          saveSettings();
          if (!state.running) renderIdle();
        };
      });
    }
    if (els.btnTutorial) {
      els.btnTutorial.onclick = function () { startTour(true); };
    }
  }

  /* ========== Tutorial passo a passo ========== */
  var tour = {
    active: false,
    index: 0,
    steps: [
      {
        sel: '[data-tour="brand"]',
        title: "Bem-vindo ao RuneTimer",
        text: "Este app controla o tempo de regen de mana e a fome enquanto você crafta runas no Tibia classic. Vamos ver cada parte."
      },
      {
        sel: '[data-tour="mana"]',
        title: "Frasco de mana",
        text: "Mostra o progresso da regeneração. O liquido sobe até a mana ficar cheia para o ciclo de runas que você configurou."
      },
      {
        sel: '[data-tour="mana-nudge"]',
        title: "Ajuste fino (+ / -)",
        text: "Soma ou tira 1 de mana no frasco. Útil quando o client e o timer ficam um pouquinho dessincronizados."
      },
      {
        sel: '[data-tour="bell"]',
        title: "Sino",
        text: "Toca um alerta quando a mana enche. Clique aqui pra testar o som antes de craftar de verdade."
      },
      {
        sel: '[data-tour="hunger"]',
        title: "Frasco de fome",
        text: "Espelha a fome do personagem. Sem fome a mana para de regenerar — igual no Tibia classic."
      },
      {
        sel: '[data-tour="food"]',
        title: "Meat e Ham",
        text: "Meat adiciona ~3 min e Ham ~6 min de fome (ajustável na config). O botão R zera a fome; o ícone do meio testa o som de alerta."
      },
      {
        sel: '[data-tour="afk"]',
        title: "Anti-AFK",
        text: "Conta ~15 min sem ação (desconexão classic). Qualquer clique no app reinicia. Pause congela o relógio se você for sair um pouco."
      },
      {
        sel: '[data-tour="craft"]',
        title: "Craftar",
        text: "Inicia o ciclo: começa em 1 de mana e regenera até encher. Quando completar, o sino toca e o botão vira De novo."
      },
      {
        sel: '[data-tour="controls"]',
        title: "Pause e Reset",
        text: "Pause congela a regen. Reset volta mana e fome ao estado inicial do ciclo."
      },
      {
        sel: '[data-tour="pip"]',
        title: "Miniwindow",
        text: "Abre uma janelinha sempre por cima (Picture-in-Picture) pra acompanhar enquanto joga. Funciona melhor em HTTPS."
      },
      {
        sel: '[data-tour="cfg-runes"]',
        title: "Runas por ciclo",
        text: "Quantas runas você vai craftar de uma vez. Junto com a mana por runa, define o total que o frasco precisa encher."
      },
      {
        sel: '[data-tour="cfg-mana"]',
        title: "Mana por runa",
        text: "Custo de mana de cada runa. Ex.: 3 runas × 100 mana = 300 de mana no ciclo."
      },
      {
        sel: '[data-tour="vocation"]',
        title: "Vocação",
        text: "Define a velocidade de regen: Mage (6s), Promoted Mage (4s), Paladin (8s) ou Royal Paladin (6s)."
      },
      {
        sel: '[data-tour="cfg-food"]',
        title: "Tempos de comida",
        text: "Ajuste os segundos do Meat, Ham e o teto de fome se o seu servidor classic usar valores diferentes do padrão."
      },
      {
        sel: '[data-tour="sync"]',
        title: "Sincronizar",
        text: "Digite a mana atual (e opcionalmente o tempo) que você vê no client e aperte Sincronizar pra alinhar o timer com o jogo."
      }
    ]
  };

  function tourEls() {
    return {
      overlay: document.getElementById("tourOverlay"),
      backdrop: document.getElementById("tourBackdrop"),
      spot: document.getElementById("tourSpot"),
      card: document.getElementById("tourCard"),
      progress: document.getElementById("tourProgress"),
      title: document.getElementById("tourTitle"),
      text: document.getElementById("tourText"),
      skip: document.getElementById("tourSkip"),
      prev: document.getElementById("tourPrev"),
      next: document.getElementById("tourNext")
    };
  }

  function markTourDone() {
    try { localStorage.setItem(TOUR_DONE_KEY, "1"); } catch (e) { /* ignore */ }
  }

  function isTourDone() {
    try { return localStorage.getItem(TOUR_DONE_KEY) === "1"; } catch (e) { return false; }
  }

  function endTour() {
    var t = tourEls();
    tour.active = false;
    document.body.classList.remove("tour-open");
    if (t.overlay) {
      t.overlay.hidden = true;
      t.overlay.setAttribute("aria-hidden", "true");
    }
    if (t.spot) {
      t.spot.style.cssText = "";
      t.spot.classList.remove("is-on");
    }
    if (t.overlay) t.overlay.classList.remove("has-spot");
    markTourDone();
    window.removeEventListener("resize", onTourRelayout);
    window.removeEventListener("scroll", onTourRelayout, true);
    window.removeEventListener("keydown", onTourKey);
  }

  function onTourRelayout() {
    if (tour.active) layoutTourStep();
  }

  function startTour(fromButton) {
    if (document.body.classList.contains("pip-mode")) return;
    tour.active = true;
    tour.index = 0;
    document.body.classList.add("tour-open");
    var t = tourEls();
    if (t.overlay) {
      t.overlay.hidden = false;
      t.overlay.setAttribute("aria-hidden", "false");
    }
    if (t.skip) t.skip.onclick = function () { endTour(); };
    if (t.prev) {
      t.prev.onclick = function () {
        if (tour.index > 0) {
          tour.index -= 1;
          showTourStep();
        }
      };
    }
    if (t.next) {
      t.next.onclick = function () {
        if (tour.index >= tour.steps.length - 1) {
          endTour();
        } else {
          tour.index += 1;
          showTourStep();
        }
      };
    }
    if (t.backdrop) {
      t.backdrop.onclick = function () { /* nao fecha no clique do fundo */ };
    }
    window.addEventListener("resize", onTourRelayout);
    window.addEventListener("scroll", onTourRelayout, true);
    window.addEventListener("keydown", onTourKey);
    showTourStep();
    if (fromButton) { /* silencio */ }
  }

  function onTourKey(e) {
    if (!tour.active) return;
    if (e.key === "Escape") {
      endTour();
    } else if (e.key === "ArrowRight" || e.key === "Enter") {
      if (tour.index >= tour.steps.length - 1) endTour();
      else {
        tour.index += 1;
        showTourStep();
      }
    } else if (e.key === "ArrowLeft") {
      if (tour.index > 0) {
        tour.index -= 1;
        showTourStep();
      }
    }
  }

  function showTourStep() {
    var step = tour.steps[tour.index];
    var t = tourEls();
    if (!step || !t.card) return;

    if (t.progress) t.progress.textContent = (tour.index + 1) + " / " + tour.steps.length;
    if (t.title) t.title.textContent = step.title;
    if (t.text) t.text.textContent = step.text;
    if (t.prev) t.prev.disabled = tour.index === 0;
    if (t.next) t.next.textContent = tour.index >= tour.steps.length - 1 ? "Concluir" : "Próximo";

    var target = document.querySelector(step.sel);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }
    // espera o scroll assentar um pouco
    requestAnimationFrame(function () {
      setTimeout(layoutTourStep, 180);
    });
  }

  function layoutTourStep() {
    var step = tour.steps[tour.index];
    var t = tourEls();
    if (!step || !t.spot || !t.card || !tour.active) return;

    var target = document.querySelector(step.sel);
    var pad = 10;
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    if (!target) {
      t.spot.classList.remove("is-on");
      t.spot.style.cssText = "";
      if (t.overlay) t.overlay.classList.remove("has-spot");
      positionTourCard(null, t.card, vw, vh);
      return;
    }

    var r = target.getBoundingClientRect();
    var top = Math.max(8, r.top - pad);
    var left = Math.max(8, r.left - pad);
    var width = Math.min(vw - left - 8, r.width + pad * 2);
    var height = Math.min(vh - top - 8, r.height + pad * 2);

    t.spot.classList.add("is-on");
    if (t.overlay) t.overlay.classList.add("has-spot");
    t.spot.style.top = top + "px";
    t.spot.style.left = left + "px";
    t.spot.style.width = Math.max(24, width) + "px";
    t.spot.style.height = Math.max(24, height) + "px";

    positionTourCard(r, t.card, vw, vh);
  }

  function positionTourCard(rect, card, vw, vh) {
    card.style.visibility = "hidden";
    card.style.left = "0";
    card.style.top = "0";
    var cw = card.offsetWidth || 300;
    var ch = card.offsetHeight || 180;
    var gap = 14;
    var left = (vw - cw) / 2;
    var top = vh * 0.28;

    if (rect) {
      var below = rect.bottom + gap;
      var above = rect.top - ch - gap;
      if (below + ch < vh - 12) {
        top = below;
      } else if (above > 12) {
        top = above;
      } else {
        top = Math.max(12, Math.min(vh - ch - 12, rect.top));
      }
      left = rect.left + rect.width / 2 - cw / 2;
      left = Math.max(12, Math.min(vw - cw - 12, left));
    }

    card.style.left = left + "px";
    card.style.top = top + "px";
    card.style.visibility = "visible";
  }

  function copyStyles(toDoc) {
    var sheets = document.querySelectorAll('link[rel="stylesheet"], style');
    sheets.forEach(function (node) {
      if (node.tagName === "LINK") {
        var link = toDoc.createElement("link");
        link.rel = "stylesheet";
        link.href = node.href;
        toDoc.head.appendChild(link);
      } else {
        var style = toDoc.createElement("style");
        style.textContent = node.textContent;
        toDoc.head.appendChild(style);
      }
    });
  }

  function fitPipContent(win) {
    if (!win || win.closed) return;
    var doc = win.document;
    var app = doc.getElementById("app");
    if (!app) return;

    app.style.transform = "none";
    app.style.marginBottom = "0";

    var pad = 6;
    var availW = Math.max(120, (win.innerWidth || doc.documentElement.clientWidth || 240) - pad);
    var availH = Math.max(160, (win.innerHeight || doc.documentElement.clientHeight || 360) - pad);
    var rect = app.getBoundingClientRect();
    var needW = Math.max(app.scrollWidth, rect.width, 1);
    var needH = Math.max(app.scrollHeight, rect.height, 1);

    // preenche a mini janela (sobe e desce a escala)
    var scale = Math.min(availW / needW, availH / needH);
    scale = Math.max(0.75, Math.min(scale, 2.4));

    app.style.transformOrigin = "top center";
    if (Math.abs(scale - 1) > 0.02) {
      app.style.transform = "scale(" + scale.toFixed(4) + ")";
      app.style.marginBottom = -(needH * (1 - scale)) + "px";
    } else {
      app.style.transform = "";
      app.style.marginBottom = "";
    }
  }

  function bindPipFit(win) {
    if (!win || win.closed) return;
    var run = function () { fitPipContent(win); };
    win.addEventListener("resize", run);
    if (win.visualViewport) {
      win.visualViewport.addEventListener("resize", run);
    }
    var links = win.document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener("load", run);
    }
    run();
    setTimeout(run, 60);
    setTimeout(run, 200);
    setTimeout(run, 500);
  }

  async function openMiniwindow() {
    if (state.pipWindow && !state.pipWindow.closed) {
      try { state.pipWindow.focus(); } catch (e) { /* ignore */ }
      return;
    }

    // Document Picture-in-Picture (Chrome/Edge) - janela sempre por cima
    if (window.documentPictureInPicture && window.documentPictureInPicture.requestWindow) {
      try {
        var pip = await window.documentPictureInPicture.requestWindow({
          width: 280,
          height: 420
        });
        state.pipWindow = pip;
        copyStyles(pip.document);
        pip.document.body.classList.add("pip-mode");

        var app = els.app;
        pip.document.body.appendChild(app);
        ensurePresenceUi(pip.document);
        pingPresence();

        bindElements(pip.document);
        syncInputs();
        wireEvents();
        bindPipFit(pip);
        if (!state.running) {
          if (state.ready) {
            setLiquid(1);
            setReady(true);
            if (els.timeLeft) els.timeLeft.textContent = "0:00";
            if (els.manaLine) els.manaLine.textContent = totalMana() + " / " + totalMana() + " mana";
            if (els.statusText) els.statusText.textContent = "Mana cheia! Craftar de novo";
            if (els.btnStart) els.btnStart.textContent = "De novo";
          } else {
            renderIdle();
          }
        }

        pip.addEventListener("pagehide", function () {
          document.body.appendChild(app);
          state.pipWindow = null;
          bindElements(document);
          syncInputs();
          wireEvents();
          scheduleFit();
          if (!state.running) {
            if (state.ready) {
              setLiquid(1);
              setReady(true);
            } else {
              renderIdle();
            }
          }
        });
        return;
      } catch (err) {
        console.warn("PiP indisponivel, usando popup:", err);
      }
    }

    // Fallback: popup pequena
    var popup = window.open(
      "",
      "runetimer-mini",
      "popup=yes,width=280,height=420,resizable=yes"
    );
    if (!popup) {
      alert("O navegador bloqueou a mini janela. Permita pop-ups pra este site.");
      return;
    }
    state.pipWindow = popup;
    popup.document.open();
    popup.document.write(
      "<!DOCTYPE html><html style=\"height:100%\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
      "<title>RuneTimer</title></head>" +
      "<body class=\"pip-mode\" style=\"height:100%;margin:0\"></body></html>"
    );
    popup.document.close();
    copyStyles(popup.document);

    var clone = els.app.cloneNode(true);
    popup.document.body.appendChild(clone);
    ensurePresenceUi(popup.document);
    pingPresence();
    bindPipFit(popup);

    // Controla o clone; a janela principal continua funcionando tambem
    var popEls = {
      flaskWrap: popup.document.getElementById("flaskWrap"),
      liquid: popup.document.getElementById("liquid"),
      wave: popup.document.getElementById("wave"),
      timeLeft: popup.document.getElementById("timeLeft"),
      manaLine: popup.document.getElementById("manaLine"),
      statusText: popup.document.getElementById("statusText"),
      btnStart: popup.document.getElementById("btnStart"),
      btnPause: popup.document.getElementById("btnPause"),
      btnReset: popup.document.getElementById("btnReset"),
      btnPip: popup.document.getElementById("btnPip"),
      btnManaUp: popup.document.getElementById("btnManaUp"),
      btnManaDown: popup.document.getElementById("btnManaDown"),
      btnBell: popup.document.getElementById("btnBell")
    };

    if (popEls.btnPip) popEls.btnPip.style.display = "none";

    function syncPopupView() {
      if (!state.pipWindow || state.pipWindow.closed) return;
      if (popEls.timeLeft && els.timeLeft) popEls.timeLeft.textContent = els.timeLeft.textContent;
      if (popEls.manaLine && els.manaLine) popEls.manaLine.textContent = els.manaLine.textContent;
      if (popEls.statusText && els.statusText) popEls.statusText.textContent = els.statusText.textContent;
      if (popEls.btnStart && els.btnStart) popEls.btnStart.textContent = els.btnStart.textContent;
      if (popEls.btnPause && els.btnPause) {
        popEls.btnPause.textContent = els.btnPause.textContent;
        popEls.btnPause.disabled = els.btnPause.disabled;
        popEls.btnPause.classList.toggle("is-paused", els.btnPause.classList.contains("is-paused"));
      }
      if (popEls.liquid && els.liquid) {
        popEls.liquid.setAttribute("y", els.liquid.getAttribute("y"));
        popEls.liquid.setAttribute("height", els.liquid.getAttribute("height"));
        popEls.liquid.style.opacity = els.liquid.style.opacity;
      }
      if (popEls.wave && els.wave) {
        popEls.wave.setAttribute("cy", els.wave.getAttribute("cy") || "262");
        popEls.wave.setAttribute("rx", els.wave.getAttribute("rx") || "78");
        popEls.wave.style.opacity = els.wave.style.opacity;
      }
      if (popEls.flaskWrap && els.flaskWrap) {
        popEls.flaskWrap.classList.toggle("ready", els.flaskWrap.classList.contains("ready"));
        popEls.flaskWrap.classList.toggle("filling", els.flaskWrap.classList.contains("filling"));
      }
      requestAnimationFrame(syncPopupView);
    }

    if (popEls.btnStart) {
      popEls.btnStart.onclick = function () { startCycle(); };
    }
    if (popEls.btnPause) {
      popEls.btnPause.onclick = function () { togglePause(); };
    }
    if (popEls.btnReset) {
      popEls.btnReset.onclick = function () { resetCycle(); };
    }
    if (popEls.btnManaUp) {
      popEls.btnManaUp.onclick = function () { nudgeMana(1); };
    }
    if (popEls.btnManaDown) {
      popEls.btnManaDown.onclick = function () { nudgeMana(-1); };
    }
    if (popEls.btnBell) {
      popEls.btnBell.onclick = function () { playDing(); };
    }
    var popMeat = popup.document.getElementById("btnMeat");
    var popHam = popup.document.getElementById("btnHam");
    var popHungerSfx = popup.document.getElementById("btnHungerSfx");
    var popHungerReset = popup.document.getElementById("btnHungerReset");
    if (popMeat) popMeat.onclick = function () { eatFood("meat"); };
    if (popHam) popHam.onclick = function () { eatFood("ham"); };
    if (popHungerSfx) {
      popHungerSfx.onclick = function () { playHungerAlert(true); };
    }
    if (popHungerReset) {
      popHungerReset.onclick = function () { resetHunger(); };
    }

    syncPopupView();
  }

  function fitAppToViewport() {
    var app = document.getElementById("app");
    if (!app) return;

    // PiP/miniwindow tem layout proprio
    if (document.body.classList.contains("pip-mode")) {
      app.style.transform = "";
      app.style.marginBottom = "";
      return;
    }

    app.style.transform = "none";
    app.style.marginBottom = "0";

    var pad = 12;
    var availW = Math.max(220, window.innerWidth - pad);
    var availH = Math.max(220, window.innerHeight - pad);
    var rect = app.getBoundingClientRect();
    var needW = Math.max(app.scrollWidth, rect.width);
    var needH = Math.max(app.scrollHeight, rect.height);
    if (needW < 1 || needH < 1) return;

    var scale = Math.min(1, availW / needW, availH / needH);
    // nao deixa ilegivel demais
    scale = Math.max(0.55, scale);

    if (scale < 0.995) {
      app.style.transformOrigin = "top center";
      app.style.transform = "scale(" + scale.toFixed(4) + ")";
      // compensa o espaco "fantasma" depois do scale
      var unused = needH * (1 - scale);
      app.style.marginBottom = -unused + "px";
    } else {
      app.style.transform = "";
      app.style.marginBottom = "";
    }
  }

  var fitTimer = 0;
  function scheduleFit() {
    if (fitTimer) cancelAnimationFrame(fitTimer);
    fitTimer = requestAnimationFrame(function () {
      fitTimer = 0;
      fitAppToViewport();
    });
  }

  // Presenca online via endpoint HTTP (segredo fica no servidor, nunca no browser)
  var PRESENCE_PING_MS = 25000;
  var presenceTimer = 0;
  var presenceSessionId = "";
  var presenceLeft = false;

  function presenceUrl() {
    var cfg = window.RUNETIMER_CONFIG || {};
    var url = typeof cfg.presenceUrl === "string" ? cfg.presenceUrl.trim() : "";
    return url;
  }

  function ensurePresenceUi(doc) {
    if (!doc || !doc.body) return null;
    var existing = doc.getElementById("onlinePresence");
    if (existing) return existing;

    var wrap = doc.createElement("div");
    wrap.className = "online-presence";
    wrap.id = "onlinePresence";
    wrap.title = "Pessoas online agora";
    wrap.setAttribute("aria-live", "polite");
    wrap.hidden = !presenceUrl();
    wrap.innerHTML =
      '<svg class="online-presence-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="currentColor" d="M12 5c-5 0-9.3 3.1-11 7.5C2.7 16.9 7 20 12 20s9.3-3.1 11-7.5C21.3 8.1 17 5 12 5zm0 12.5c-2.8 0-5-2.2-5-5s2.2-5 5-5 5 2.2 5 5-2.2 5-5 5zm0-8a3 3 0 100 6 3 3 0 000-6z"/>' +
      "</svg>" +
      '<span class="online-presence-count" id="onlineCount">-</span>';
    doc.body.appendChild(wrap);
    return wrap;
  }

  function setOnlineCount(n) {
    var label = Number.isFinite(n) && n > 0 ? String(n) : "-";
    var nodes = [];
    var main = document.getElementById("onlineCount");
    if (main) nodes.push(main);
    if (state.pipWindow && !state.pipWindow.closed) {
      try {
        var pipCount = state.pipWindow.document.getElementById("onlineCount");
        if (pipCount) nodes.push(pipCount);
      } catch (e) { /* ignore */ }
    }
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = label;
  }

  function syncPresenceVisibility() {
    var show = !!presenceUrl();
    var main = document.getElementById("onlinePresence");
    if (main) main.hidden = !show;
    if (state.pipWindow && !state.pipWindow.closed) {
      try {
        var pip = state.pipWindow.document.getElementById("onlinePresence");
        if (pip) pip.hidden = !show;
      } catch (e) { /* ignore */ }
    }
  }

  function newPresenceId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getPresenceSessionId() {
    // localStorage: mesmo browser = mesma pessoa (reabrir nao inventa ID novo)
    var key = "runetimer-presence-id";
    try {
      var saved = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (saved && saved.length > 10) {
        localStorage.setItem(key, saved);
        return saved;
      }
      var id = newPresenceId();
      localStorage.setItem(key, id);
      return id;
    } catch (e) {
      return "00000000-0000-4000-8000-000000000001";
    }
  }

  async function pingPresence() {
    var url = presenceUrl();
    syncPresenceVisibility();
    if (!url) {
      setOnlineCount(NaN);
      return;
    }
    // file:// nao consegue falar com o endpoint; so conta no Pages/HTTP(S)
    if (!/^https?:/i.test(window.location.protocol)) {
      setOnlineCount(NaN);
      return;
    }
    try {
      if (!presenceSessionId) presenceSessionId = getPresenceSessionId();
      presenceLeft = false;
      var res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sessionId: presenceSessionId }),
        mode: "cors",
        cache: "no-store",
        credentials: "omit"
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      var online = data && data.online != null ? Number(data.online) : NaN;
      setOnlineCount(online);
    } catch (err) {
      console.warn("presence ping falhou:", err);
    }
  }

  function leavePresence() {
    if (presenceLeft) return;
    var url = presenceUrl();
    if (!url) return;
    if (!/^https?:/i.test(window.location.protocol)) return;
    if (!presenceSessionId) presenceSessionId = getPresenceSessionId();
    presenceLeft = true;
    var payload = JSON.stringify({ sessionId: presenceSessionId, leave: true });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
        return;
      }
    } catch (e) { /* fallback abaixo */ }
    try {
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: payload,
        mode: "cors",
        cache: "no-store",
        credentials: "omit",
        keepalive: true
      }).catch(function () { /* ignore */ });
    } catch (e) { /* ignore */ }
  }

  function startPresence() {
    ensurePresenceUi(document);
    syncPresenceVisibility();
    if (!presenceUrl()) return;
    pingPresence();
    if (presenceTimer) clearInterval(presenceTimer);
    presenceTimer = setInterval(pingPresence, PRESENCE_PING_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        presenceLeft = false;
        pingPresence();
      }
    });
    // fecha aba/janela: tira do contador na hora (nao espera TTL)
    window.addEventListener("pagehide", leavePresence);
    window.addEventListener("beforeunload", leavePresence);
  }

  function init() {
    bindElements(document);
    loadSettings();
    syncInputs();
    wireEvents();
    restoreManaSession();
    renderHunger();
    startHungerLoop();
    bumpAntiAfk();
    startAfkLoop();
    startPresence();
    window.addEventListener("beforeunload", saveSettings);
    window.addEventListener("pagehide", saveSettings);
    window.addEventListener("resize", scheduleFit);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", scheduleFit);
    }
    // salva progresso com frequencia alta (fome/mana em ms)
    setInterval(function () {
      if (state.running || state.paused || state.hungerBlocked || state.ready) {
        saveSettings();
      }
    }, 1000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") saveSettings();
    });
    scheduleFit();
    setTimeout(scheduleFit, 120);
    setTimeout(scheduleFit, 500);
    // primeira visita: abre o tutorial sozinho
    if (!isTourDone()) {
      setTimeout(function () { startTour(false); }, 700);
    }
  }

  init();
})();
