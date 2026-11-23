(() => {
  const focusables = () => Array.from(document.querySelectorAll("[data-focus]"));
  let userPinnedKeys = null;
  let activeStepper = null;
  let hoveredEl = null;
  const steppers = [];

  function parseKeys(val) {
    return (val || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function currentPinnedKeys() {
    return userPinnedKeys ?? (activeStepper ? activeStepper.pinnedKeys : null);
  }

  function applyFocus(keys) {
    const els = focusables();
    if (!keys || keys.length === 0) {
      els.forEach((el) => {
        el.classList.remove("ib-lit", "ib-dim");
      });
      return;
    }
    const set = new Set(keys);
    els.forEach((el) => {
      const elKeys = parseKeys(el.getAttribute("data-focus"));
      const match = elKeys.some((k) => set.has(k));
      el.classList.toggle("ib-lit", match);
      el.classList.toggle("ib-dim", !match);
    });
  }

  function stopOtherPlayers(except) {
    for (const s of steppers) {
      if (s !== except) s.stopPlay();
    }
  }

  // Delegated hover & click cross-highlighting (keeps dynamic .ib-ref elements active)
  document.addEventListener("mouseover", (e) => {
    const el = e.target && e.target.closest ? e.target.closest("[data-focus]") : null;
    if (el === hoveredEl) return;
    hoveredEl = el;
    if (!el) {
      applyFocus(currentPinnedKeys());
      return;
    }
    const keys = parseKeys(el.getAttribute("data-focus"));
    if (keys.length) applyFocus(keys);
  });

  document.addEventListener("mouseout", (e) => {
    if (!hoveredEl) return;
    const next = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest("[data-focus]") : null;
    if (next === hoveredEl) return;
    hoveredEl = null;
    applyFocus(currentPinnedKeys());
  });

  document.addEventListener("click", (e) => {
    if (e.target && e.target.closest && e.target.closest(".ib-stepper-btns")) return;
    const el = e.target && e.target.closest ? e.target.closest("[data-focus]") : null;
    if (!el) return;
    const keys = parseKeys(el.getAttribute("data-focus"));
    if (!keys.length) return;
    const prev = currentPinnedKeys();
    const same = prev && prev.join(",") === keys.join(",");
    stopOtherPlayers(null);
    activeStepper = null;
    userPinnedKeys = same ? null : keys;
    applyFocus(currentPinnedKeys());
  });

  // Stepper widgets (isolated per-instance state)
  document.querySelectorAll(".ib-stepper").forEach((root) => {
    const stages = Array.from(root.querySelectorAll(".ib-stage-data"));
    if (!stages.length) return;
    const titleEl = root.querySelector(".ib-stage-title");
    const bodyEl = root.querySelector(".ib-stage-body");
    const dots = Array.from(root.querySelectorAll(".ib-dot"));
    const prevBtn = root.querySelector('[data-act="prev"]');
    const nextBtn = root.querySelector('[data-act="next"]');
    const playBtn = root.querySelector('[data-act="play"]');
    const resetBtn = root.querySelector('[data-act="reset"]');

    const state = {
      idx: 0,
      timer: null,
      pinnedKeys: null,
      stopPlay,
    };
    steppers.push(state);

    function stopPlay() {
      if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
      }
      if (playBtn) {
        playBtn.setAttribute("aria-pressed", "false");
        playBtn.textContent = "▶ Play";
      }
    }

    function show(nextIdx, syncFocus = true) {
      state.idx = (nextIdx + stages.length) % stages.length;
      const st = stages[state.idx];
      if (titleEl) titleEl.textContent = `${state.idx + 1}/${stages.length} · ${st.dataset.title || ""}`;
      if (bodyEl) bodyEl.innerHTML = st.innerHTML;
      dots.forEach((d, i) => d.classList.toggle("is-active", i === state.idx));
      if (syncFocus) {
        const keys = parseKeys(st.dataset.stageFocus);
        state.pinnedKeys = keys.length ? keys : null;
        activeStepper = state;
        userPinnedKeys = null;
        applyFocus(currentPinnedKeys());
      }
    }

    dots.forEach((d, i) =>
      d.addEventListener("click", () => {
        stopOtherPlayers(null);
        show(i, true);
      })
    );
    if (prevBtn) prevBtn.addEventListener("click", () => { stopOtherPlayers(null); show(state.idx - 1, true); });
    if (nextBtn) nextBtn.addEventListener("click", () => { stopOtherPlayers(null); show(state.idx + 1, true); });
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        stopPlay();
        state.pinnedKeys = null;
        if (activeStepper === state) {
          activeStepper = null;
          userPinnedKeys = null;
        }
        applyFocus(currentPinnedKeys());
        show(0, false);
      });
    }
    if (playBtn) {
      playBtn.addEventListener("click", () => {
        if (state.timer) {
          stopPlay();
          return;
        }
        stopOtherPlayers(state);
        playBtn.setAttribute("aria-pressed", "true");
        playBtn.textContent = "❚❚ Pause";
        show(state.idx, true);
        state.timer = setInterval(() => show(state.idx + 1, true), 2200);
      });
    }

    // Initialize first stage text without dimming overview on initial render
    show(0, false);
  });
})();
