(function () {
  "use strict";

  // Tibia 7.1 / classic: 1 mana por tick (nao o 2/3s do tibia moderno)
  var REGEN = {
    druid: { mana: 1, seconds: 6, label: "Druid 7.1: 1 mana a cada 6s" },
    elder: { mana: 1, seconds: 4, label: "Elder Druid 7.1: 1 mana a cada 4s" }
  };

  var STORAGE_KEY = "runetimer-settings-v4";
  // liquido sobe ate a faixa "fim" (nao ate a boca)
  var LIQUID_BOTTOM = 262;
  var LIQUID_TOP = 46;
  var LIQUID_MAX_H = LIQUID_BOTTOM - LIQUID_TOP;
  // no tibia a mana nao fica 0 depois de craftar ? sempre sobra 1
  var MIN_MANA = 1;

  // Tibia classic: Meat 180s, Ham 360s, full 1200s (20 min) ~ 3 ham
  var state = {
    vocation: "druid",
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
    audioCtx: null,
    bellAudio: null,
    hungerAudio: null,
    hungerAlertPlayed: false,
    syncDirty: false,
    syncSnapMana: null,
    syncSnapElapsed: null
  };

  var els = {};

  function $(id) {
    return document.getElementById(id);
  }

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
      segBtns: doc.querySelectorAll(".seg-btn")
    };
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
      if (data.vocation === "druid" || data.vocation === "elder") {
        state.vocation = data.vocation;
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
    if (els.cfgCurrentMana && state._savedCurrentMana != null && state._savedCurrentMana !== "") {
      els.cfgCurrentMana.value = String(state._savedCurrentMana);
    }
    if (els.cfgElapsed && state._savedElapsed) {
      els.cfgElapsed.value = String(state._savedElapsed);
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

    var shouldAlert = true;

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
      if (shouldAlert) playHungerAlert();
      return;
    }

    // ja estava pausado pelo usuario: so marca bloqueio
    if (state.paused || state.pausedElapsedMs > 0 || state.ready === false) {
      state.hungerBlocked = true;
      if (els.statusText && !state.ready) {
        els.statusText.textContent = "Sem fome - mana parada";
      }
      updatePauseButton();
      if (shouldAlert) playHungerAlert();
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

  function snapshotSyncInputs() {
    state.syncSnapMana = els.cfgCurrentMana ? els.cfgCurrentMana.value : "";
    state.syncSnapElapsed = els.cfgElapsed ? els.cfgElapsed.value : "";
    state.syncDirty = true;
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

  function writeSyncFields(mana, elapsedMs) {
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
      state.syncDirty = false;
      state.syncSnapMana = null;
      state.syncSnapElapsed = null;
      state.startedAt = performance.now() - state.durationMs;
      finishCycle();
      return;
    }

    state.paused = false;
    state.pausedElapsedMs = cappedElapsed;
    state.ready = false;
    state.syncDirty = false;
    state.syncSnapMana = null;
    state.syncSnapElapsed = null;
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

    writeSyncFields(sync.currentMana, elapsedFromMana);
    saveSettings();
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
    var active = document.activeElement;
    var editingSync =
      active &&
      (active.id === "cfgCurrentMana" || active.id === "cfgElapsed");
    if (!editingSync && !state.syncDirty) writeSyncFields(mana, elapsed);

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

  function playHungerAlert() {
    if (state.hungerAlertPlayed) return;
    state.hungerAlertPlayed = true;
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

  function resetCycle() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.running = false;
    state.paused = false;
    state.hungerBlocked = false;
    state.pausedElapsedMs = 0;
    renderIdle();
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
    if (els.btnManaUp) els.btnManaUp.onclick = function () { nudgeMana(1); };
    if (els.btnManaDown) els.btnManaDown.onclick = function () { nudgeMana(-1); };
    if (els.btnBell) els.btnBell.onclick = function () { playDing(); };
    if (els.btnMeat) els.btnMeat.onclick = function () { eatFood("meat"); };
    if (els.btnHam) els.btnHam.onclick = function () { eatFood("ham"); };
    if (els.btnSync) {
      // captura o valor NO POINTERDOWN, antes do foco sair e o tick sobrescrever
      els.btnSync.onpointerdown = function () { snapshotSyncInputs(); };
      els.btnSync.onclick = function () { syncFromGame(); };
    }
    if (els.cfgCurrentMana) {
      els.cfgCurrentMana.oninput = function () { state.syncDirty = true; };
      els.cfgCurrentMana.onchange = function () { state.syncDirty = true; };
    }
    if (els.cfgElapsed) {
      els.cfgElapsed.oninput = function () { state.syncDirty = true; };
      els.cfgElapsed.onchange = function () { state.syncDirty = true; };
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
          state.vocation = btn.getAttribute("data-voc") || "elder";
          syncInputs();
          saveSettings();
          if (!state.running) renderIdle();
        };
      });
    }
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

  async function openMiniwindow() {
    if (state.pipWindow && !state.pipWindow.closed) {
      try { state.pipWindow.focus(); } catch (e) { /* ignore */ }
      return;
    }

    // Document Picture-in-Picture (Chrome/Edge) ? janela sempre por cima
    if (window.documentPictureInPicture && window.documentPictureInPicture.requestWindow) {
      try {
        var pip = await window.documentPictureInPicture.requestWindow({
          width: 240,
          height: 360
        });
        state.pipWindow = pip;
        copyStyles(pip.document);
        pip.document.body.classList.add("pip-mode");

        var app = els.app;
        pip.document.body.appendChild(app);

        bindElements(pip.document);
        syncInputs();
        wireEvents();
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
      "popup=yes,width=240,height=360,resizable=yes"
    );
    if (!popup) {
      alert("O navegador bloqueou a mini janela. Permita pop-ups pra este site.");
      return;
    }
    state.pipWindow = popup;
    popup.document.open();
    popup.document.write(
      "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>RuneTimer</title></head>" +
      "<body class=\"pip-mode\"></body></html>"
    );
    popup.document.close();
    copyStyles(popup.document);

    var clone = els.app.cloneNode(true);
    popup.document.body.appendChild(clone);

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
    if (popMeat) popMeat.onclick = function () { eatFood("meat"); };
    if (popHam) popHam.onclick = function () { eatFood("ham"); };

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

  function init() {
    bindElements(document);
    loadSettings();
    syncInputs();
    wireEvents();
    restoreManaSession();
    renderHunger();
    startHungerLoop();
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
  }

  init();
})();
