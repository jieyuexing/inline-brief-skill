(() => {
  const focusables = () => Array.from(document.querySelectorAll("[data-focus]"));
  let pinnedKeys = null;

  function parseKeys(val) {
    return (val || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
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

  // Hover & click cross-highlighting
  focusables().forEach((el) => {
    const keys = parseKeys(el.getAttribute("data-focus"));
    if (!keys.length) return;
    el.addEventListener("mouseenter", () => applyFocus(keys));
    el.addEventListener("mouseleave", () => applyFocus(pinnedKeys));
    el.addEventListener("click", () => {
      const same = pinnedKeys && pinnedKeys.join(",") === keys.join(",");
      pinnedKeys = same ? null : keys;
      applyFocus(pinnedKeys);
    });
  });

  // Stepper widgets
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

    let idx = 0;
    let timer = null;

    function stopPlay() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (playBtn) {
        playBtn.setAttribute("aria-pressed", "false");
        playBtn.textContent = "▶ Play";
      }
    }

    function show(nextIdx, syncFocus = true) {
      idx = (nextIdx + stages.length) % stages.length;
      const st = stages[idx];
      if (titleEl) titleEl.textContent = `${idx + 1}/${stages.length} · ${st.dataset.title || ""}`;
      if (bodyEl) bodyEl.innerHTML = st.innerHTML;
      dots.forEach((d, i) => d.classList.toggle("is-active", i === idx));
      if (syncFocus) {
        const keys = parseKeys(st.dataset.stageFocus);
        pinnedKeys = keys.length ? keys : null;
        applyFocus(pinnedKeys);
      }
    }

    dots.forEach((d, i) =>
      d.addEventListener("click", () => {
        stopPlay();
        show(i, true);
      })
    );
    if (prevBtn) prevBtn.addEventListener("click", () => { stopPlay(); show(idx - 1, true); });
    if (nextBtn) nextBtn.addEventListener("click", () => { stopPlay(); show(idx + 1, true); });
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        stopPlay();
        pinnedKeys = null;
        applyFocus(null);
        show(0, false);
      });
    }
    if (playBtn) {
      playBtn.addEventListener("click", () => {
        if (timer) {
          stopPlay();
          return;
        }
        playBtn.setAttribute("aria-pressed", "true");
        playBtn.textContent = "❚❚ Pause";
        show(idx, true);
        timer = setInterval(() => show(idx + 1, true), 2200);
      });
    }

    // Initialize first stage text without dimming overview on initial render
    show(0, false);
  });
})();
