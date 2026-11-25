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
    if (e.target && e.target.closest && e.target.closest(".ib-stepper-btns, .ib-pick-actions, .ib-pick-filters, .ib-pick-bar-btns, .ib-pick-note-wrap, .ib-pick-zoom, .ib-pick-preview, .ib-pick-dialog, .ib-pick-fallback")) return;
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
    const fallbackEl = root.querySelector(".ib-pick-fallback");
    const dialog = root.querySelector(".ib-pick-dialog");
    const state = new Map();
    const notes = new Map();

    const emptyText = root.dataset.emptyText || "Click cards above to mark your choices.";
    const likePrefix = root.dataset.likePrefix || "Shortlist: ";
    const skipPrefix = root.dataset.skipPrefix || "Skip: ";
    const selectPrefix = root.dataset.selectPrefix || "Selected: ";
    const notePrefix = root.dataset.notePrefix || "Notes: ";
    const noteOpen = root.dataset.noteOpen || " (";
    const noteClose = root.dataset.noteClose || ")";
    const itemSep = root.dataset.itemSep || ", ";
    const groupSep = root.dataset.groupSep || " | ";
    const copyDefault = copyBtn ? copyBtn.textContent : "Copy selection";
    const copiedLabel = root.dataset.copiedLabel || "Copied";
    const copyFallbackLabel = root.dataset.copyFallbackLabel || "Selected — press Ctrl/Cmd+C";
    const copyEmptyLabel = root.dataset.copyEmptyLabel || "Pick a card first";

    function formatLabel(card) {
      const id = card.dataset.optId || "";
      const title = card.dataset.optTitle || "";
      const base = title ? `${id} ${title}` : id;
      const note = (notes.get(id) || "").trim();
      return note ? `${base}${noteOpen}${note}${noteClose}` : base;
    }

    function formatSummary() {
      const liked = [];
      const skipped = [];
      const selected = [];
      const standaloneNotes = [];
      for (const c of cards) {
        const id = c.dataset.optId || "";
        const st = state.get(id);
        const note = (notes.get(id) || "").trim();
        if (st === "like") liked.push(formatLabel(c));
        else if (st === "skip") skipped.push(formatLabel(c));
        else if (st === "select") selected.push(formatLabel(c));
        else if (note) standaloneNotes.push(formatLabel(c));
      }
      const parts = [];
      if (mode === "triage") {
        if (liked.length) parts.push(`${likePrefix}${liked.join(itemSep)}`);
        if (skipped.length) parts.push(`${skipPrefix}${skipped.join(itemSep)}`);
      } else if (selected.length) {
        parts.push(`${selectPrefix}${selected.join(itemSep)}`);
      }
      if (standaloneNotes.length) {
        parts.push(`${notePrefix}${standaloneNotes.join(itemSep)}`);
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
      const noteInput = card.querySelector("[data-pick-note]");
      const val = notes.get(id) || "";
      if (noteInput && noteInput.value !== val) {
        noteInput.value = val;
      }
    }

    function applyAction(card, act) {
      const id = card.dataset.optId || "";
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
      if (dialogState.activeCard) syncDialogControls();
    }

    function setNote(card, text) {
      const id = card.dataset.optId || "";
      if (text && text.trim()) notes.set(id, text);
      else notes.delete(id);
      syncCardDom(card);
      renderSummary();
      if (dialogState.activeCard === card && dialogState.noteEl && dialogState.noteEl.value !== text) {
        dialogState.noteEl.value = text;
      }
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
      if (fallbackEl) {
        if (!text) {
          fallbackEl.hidden = true;
          fallbackEl.value = "";
        } else if (!fallbackEl.hidden) {
          fallbackEl.value = text;
        }
      }
    }

    // Zoom & A/B compare dialog state
    const dialogState = {
      activeCard: null,
      idEl: dialog ? dialog.querySelector(".ib-pick-dlg-id") : null,
      titleEl: dialog ? dialog.querySelector(".ib-pick-dlg-name") : null,
      posEl: dialog ? dialog.querySelector(".ib-pick-dlg-pos") : null,
      stageEl: dialog ? dialog.querySelector(".ib-pick-dlg-stage") : null,
      descEl: dialog ? dialog.querySelector(".ib-pick-dlg-desc") : null,
      noteEl: dialog ? dialog.querySelector("[data-dlg-note]") : null,
      prevBtn: dialog ? dialog.querySelector("[data-dlg-prev]") : null,
      nextBtn: dialog ? dialog.querySelector("[data-dlg-next]") : null,
      closeBtn: dialog ? dialog.querySelector("[data-dlg-close]") : null,
      actBtns: dialog ? Array.from(dialog.querySelectorAll("[data-dlg-act]")) : [],
    };

    function visibleMediaCards() {
      return cards.filter((c) => !c.hidden && c.querySelector(".ib-pick-media"));
    }

    function syncDialogControls() {
      const card = dialogState.activeCard;
      if (!card) return;
      const id = card.dataset.optId || "";
      const st = state.get(id) || null;
      dialogState.actBtns.forEach((btn) => {
        const act = btn.dataset.dlgAct;
        const on = st === act;
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        btn.classList.toggle("is-active-like", on && act === "like");
        btn.classList.toggle("is-active-skip", on && act === "skip");
        btn.classList.toggle("is-active-select", on && act === "select");
      });
      if (dialogState.noteEl) {
        const val = notes.get(id) || "";
        if (dialogState.noteEl.value !== val) dialogState.noteEl.value = val;
      }
    }

    function showDialogCard(card) {
      if (!dialog || !card) return;
      const list = visibleMediaCards();
      const idx = Math.max(0, list.indexOf(card));
      dialogState.activeCard = card;
      if (dialogState.idEl) dialogState.idEl.textContent = card.dataset.optId || "";
      if (dialogState.titleEl) dialogState.titleEl.textContent = card.dataset.optTitle || "";
      if (dialogState.posEl) dialogState.posEl.textContent = list.length ? `${idx + 1}/${list.length}` : "";
      if (dialogState.stageEl) {
        const img = card.querySelector(".ib-pick-media img");
        const preview = card.querySelector(".ib-pick-preview");
        if (img) {
          const isPixel = img.classList.contains("ib-fit-pixel");
          dialogState.stageEl.innerHTML = "";
          if (typeof document.createElement === "function" && typeof dialogState.stageEl.appendChild === "function") {
            const clone = document.createElement("img");
            clone.src = img.getAttribute("src") || "";
            clone.alt = img.getAttribute("alt") || "";
            if (isPixel) clone.className = "ib-fit-pixel";
            dialogState.stageEl.appendChild(clone);
          } else {
            dialogState.stageEl.innerHTML = `<img src="${img.getAttribute("src") || ""}" alt="${img.getAttribute("alt") || ""}"${isPixel ? ' class="ib-fit-pixel"' : ""} />`;
          }
        } else if (preview) {
          dialogState.stageEl.innerHTML = preview.innerHTML;
        } else {
          dialogState.stageEl.innerHTML = "";
        }
      }
      if (dialogState.descEl) {
        const sub = card.querySelector(".ib-pick-sub");
        dialogState.descEl.textContent = sub ? sub.textContent : "";
      }
      syncDialogControls();
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      }
    }

    function stepDialog(delta) {
      const list = visibleMediaCards();
      if (!list.length || !dialogState.activeCard) return;
      const cur = list.indexOf(dialogState.activeCard);
      const next = list[(cur + delta + list.length) % list.length];
      showDialogCard(next);
    }

    if (dialog) {
      if (dialogState.prevBtn) dialogState.prevBtn.addEventListener("click", () => stepDialog(-1));
      if (dialogState.nextBtn) dialogState.nextBtn.addEventListener("click", () => stepDialog(1));
      if (dialogState.closeBtn) {
        dialogState.closeBtn.addEventListener("click", () => {
          if (typeof dialog.close === "function") dialog.close();
          else dialog.removeAttribute("open");
          dialogState.activeCard = null;
        });
      }
      dialog.addEventListener("click", (e) => {
        if (e.target === dialog) {
          if (typeof dialog.close === "function") dialog.close();
          else dialog.removeAttribute("open");
          dialogState.activeCard = null;
        }
      });
      dialog.addEventListener("keydown", (e) => {
        const tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : "";
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (e.key === "ArrowLeft") {
          if (typeof e.preventDefault === "function") e.preventDefault();
          stepDialog(-1);
        } else if (e.key === "ArrowRight") {
          if (typeof e.preventDefault === "function") e.preventDefault();
          stepDialog(1);
        }
      });
      dialogState.actBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          if (dialogState.activeCard) applyAction(dialogState.activeCard, btn.dataset.dlgAct);
        });
      });
      if (dialogState.noteEl) {
        dialogState.noteEl.addEventListener("input", () => {
          if (dialogState.activeCard) setNote(dialogState.activeCard, dialogState.noteEl.value);
        });
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
        btn.addEventListener("click", () => applyAction(card, btn.dataset.pickAct));
      });
      const noteInput = card.querySelector("[data-pick-note]");
      if (noteInput) {
        noteInput.addEventListener("input", () => setNote(card, noteInput.value));
      }
      card.querySelectorAll("[data-pick-zoom]").forEach((el) => {
        el.addEventListener("click", () => showDialogCard(card));
      });
    });

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        state.clear();
        notes.clear();
        cards.forEach(syncCardDom);
        if (dialogState.activeCard) syncDialogControls();
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
        }, 1600);
      };
      copyBtn.addEventListener("click", async () => {
        const text = formatSummary();
        if (!text) {
          flashLabel(copyEmptyLabel);
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
        if (copied) {
          if (fallbackEl) fallbackEl.hidden = true;
          flashLabel(copiedLabel);
          return;
        }
        // Sandbox fallback: reveal and auto-select plain-text box for one-shortcut manual copy
        if (fallbackEl) {
          fallbackEl.value = text;
          fallbackEl.hidden = false;
          if (typeof fallbackEl.focus === "function") fallbackEl.focus();
          if (typeof fallbackEl.select === "function") fallbackEl.select();
        }
        flashLabel(copyFallbackLabel);
      });
    }

    renderSummary();
  });
})();
