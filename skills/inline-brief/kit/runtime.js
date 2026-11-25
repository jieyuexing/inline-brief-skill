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
    if (e.target && e.target.closest && e.target.closest(".ib-stepper-btns, .ib-pick-actions, .ib-pick-filters, .ib-pick-bar-btns")) return;
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

  // Interactive visual picker widgets (isolated per-instance state)
  document.querySelectorAll(".ib-picker").forEach((root) => {
    const mode = root.dataset.mode || "triage";
    const cards = Array.from(root.querySelectorAll(".ib-opt"));
    if (!cards.length) return;
    const pills = Array.from(root.querySelectorAll(".ib-pick-pill"));
    const sumEl = root.querySelector(".ib-pick-summary");
    const copyBtn = root.querySelector("[data-pick-copy]");
    const clearBtn = root.querySelector("[data-pick-clear]");
    const state = new Map();

    const emptyText = root.dataset.emptyText || "Click cards above to mark your choices.";
    const likePrefix = root.dataset.likePrefix || "Shortlist: ";
    const skipPrefix = root.dataset.skipPrefix || "Skip: ";
    const selectPrefix = root.dataset.selectPrefix || "Selected: ";
    const itemSep = root.dataset.itemSep || ", ";
    const groupSep = root.dataset.groupSep || " | ";
    const copyDefault = copyBtn ? copyBtn.textContent : "Copy selection";
    const copiedLabel = root.dataset.copiedLabel || "Copied";
    const copyFallbackLabel = root.dataset.copyFallbackLabel || "Select text to copy";

    function formatSummary() {
      const liked = [];
      const skipped = [];
      const selected = [];
      for (const c of cards) {
        const id = c.dataset.optId || "";
        const title = c.dataset.optTitle || "";
        const label = title ? `${id} ${title}` : id;
        const st = state.get(id);
        if (st === "like") liked.push(label);
        else if (st === "skip") skipped.push(label);
        else if (st === "select") selected.push(label);
      }
      const parts = [];
      if (mode === "triage") {
        if (liked.length) parts.push(`${likePrefix}${liked.join(itemSep)}`);
        if (skipped.length) parts.push(`${skipPrefix}${skipped.join(itemSep)}`);
      } else if (selected.length) {
        parts.push(`${selectPrefix}${selected.join(itemSep)}`);
      }
      return parts.join(groupSep);
    }

    function syncCardDom(card) {
      const id = card.dataset.optId || "";
      const st = state.get(id) || null;
      card.classList.toggle("is-liked", st === "like");
      card.classList.toggle("is-skipped", st === "skip");
      card.classList.toggle("is-selected", st === "select");
      card.querySelectorAll("[data-pick-act]").forEach((btn) => {
        btn.setAttribute("aria-pressed", btn.dataset.pickAct === st ? "true" : "false");
      });
    }

    function renderSummary() {
      const text = formatSummary();
      if (sumEl) {
        sumEl.textContent = text || emptyText;
        sumEl.classList.toggle("is-empty", !text);
      }
      if (clearBtn) {
        clearBtn.hidden = !text;
      }
    }

    pills.forEach((pill) => {
      pill.addEventListener("click", () => {
        const grp = pill.dataset.pickFilter || "__all__";
        pills.forEach((p) => {
          const on = p === pill;
          p.classList.toggle("is-active", on);
          p.setAttribute("aria-pressed", on ? "true" : "false");
        });
        cards.forEach((c) => {
          c.hidden = grp !== "__all__" && (c.dataset.optGroup || "") !== grp;
        });
      });
    });

    cards.forEach((card) => {
      card.querySelectorAll("[data-pick-act]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = card.dataset.optId || "";
          const act = btn.dataset.pickAct;
          const prev = state.get(id) || null;
          if (mode === "single") {
            state.clear();
            if (prev !== act) state.set(id, act);
            cards.forEach(syncCardDom);
          } else {
            const next = prev === act ? null : act;
            if (next) state.set(id, next);
            else state.delete(id);
            syncCardDom(card);
          }
          renderSummary();
        });
      });
    });

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        state.clear();
        cards.forEach(syncCardDom);
        renderSummary();
      });
    }

    if (copyBtn) {
      let resetTimer = null;
      const flashLabel = (label) => {
        copyBtn.textContent = label;
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          copyBtn.textContent = copyDefault;
          resetTimer = null;
        }, 1400);
      };
      copyBtn.addEventListener("click", async () => {
        const text = formatSummary();
        if (!text) {
          flashLabel(copyFallbackLabel);
          return;
        }
        let copied = false;
        if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          try {
            await navigator.clipboard.writeText(text);
            copied = true;
          } catch {
            copied = false;
          }
        }
        if (!copied && typeof document.createElement === "function" && typeof document.execCommand === "function" && document.body) {
          try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            copied = Boolean(document.execCommand("copy"));
            document.body.removeChild(ta);
          } catch {
            copied = false;
          }
        }
        flashLabel(copied ? copiedLabel : copyFallbackLabel);
      });
    }

    renderSummary();
  });
})();
