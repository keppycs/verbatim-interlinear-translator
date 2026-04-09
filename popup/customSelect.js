/**
 * Styled listbox UI synced to a hidden native <select> (native OS dropdown cannot be themed).
 * @param {HTMLSelectElement} selectEl
 * @returns {() => void} call after any programmatic change to options/value/disabled
 */
export function mountCustomSelect(selectEl) {
  const wrap = selectEl.closest(".custom-select");
  if (!wrap) return () => {};

  const trigger = wrap.querySelector(".custom-select-trigger");
  const dropdown = wrap.querySelector(".custom-select-dropdown");
  const list = wrap.querySelector(".custom-select-options");
  const valueSpan = wrap.querySelector(".custom-select-value");

  if (!trigger || !dropdown || !list || !valueSpan) return () => {};

  function close() {
    if (dropdown.hidden) return;
    dropdown.hidden = true;
    wrap.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  }

  function closeAllOthers() {
    document.querySelectorAll(".custom-select.is-open").forEach((w) => {
      if (w === wrap) return;
      w.classList.remove("is-open");
      const d = w.querySelector(".custom-select-dropdown");
      if (d) d.hidden = true;
      const t = w.querySelector(".custom-select-trigger");
      if (t) t.setAttribute("aria-expanded", "false");
    });
  }

  function openMenu() {
    if (trigger.disabled) return;
    closeAllOthers();
    dropdown.hidden = false;
    wrap.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    const selected = list.querySelector(".custom-select-option.is-selected");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }

  function toggle() {
    if (!dropdown.hidden) close();
    else openMenu();
  }

  function renderList() {
    list.innerHTML = "";
    for (let i = 0; i < selectEl.options.length; i++) {
      const opt = selectEl.options[i];
      /* Empty value = placeholder label only (shown on trigger); not a real choice in the list. */
      if (opt.value === "") continue;
      const li = document.createElement("li");
      li.className = "custom-select-option";
      li.setAttribute("role", "option");
      li.dataset.value = opt.value;
      li.textContent = opt.textContent || opt.value || "";
      const selected = selectEl.selectedIndex === i;
      li.setAttribute("aria-selected", String(selected));
      li.classList.toggle("is-selected", selected);
      li.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (selectEl.selectedIndex !== i) {
          selectEl.selectedIndex = i;
          selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
        close();
        sync();
        if (!trigger.disabled) {
          trigger.focus({ preventScroll: true });
        }
      });
      list.appendChild(li);
    }
  }

  function sync() {
    const opt = selectEl.options[selectEl.selectedIndex];
    valueSpan.textContent = opt ? opt.textContent : "-";
    trigger.disabled = selectEl.disabled;
    close();
    renderList();
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });

  document.addEventListener("click", (e) => {
    if (!dropdown.hidden && !wrap.contains(/** @type {Node} */ (e.target))) {
      close();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !dropdown.hidden) {
      e.preventDefault();
      close();
    }
  });

  sync();

  return sync;
}
