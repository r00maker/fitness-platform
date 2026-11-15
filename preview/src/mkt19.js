  // ---- Full class names on the calendar -------------------------------------------------------
  // Studios run versions of a class ("Reformer - Beginner", "Sweat - Foundations"), so a class's
  // name is never cut short on the calendar. Names wrap onto more lines. After the calendar draws,
  // a block whose name still doesn't fit first drops its instructor line, then grows taller (drawn
  // above the grid, with a shadow) so the whole name shows without opening the class.
  if (!document.documentElement.lang) document.documentElement.lang = "en"; // lets long words hyphenate
  function fitEvents() {
    if (state.page !== "schedule") return;
    const evs = [...document.querySelectorAll("#canvas .ev")];
    for (const ev of evs) {
      if (!ev.dataset.h) ev.dataset.h = ev.style.height;
      ev.style.height = ev.dataset.h;
      ev.classList.remove("nometa", "grown");
    }
    for (const ev of evs) {
      const b = ev.firstElementChild;
      if (!b || b.scrollHeight <= b.clientHeight + 1) continue;
      // Free space below: up to the next class in the same column that sits alongside this one.
      const top = ev.offsetTop, left = ev.offsetLeft, right = left + ev.offsetWidth;
      let room = ev.parentElement.clientHeight - top;
      for (const o of evs) {
        if (o === ev || o.parentElement !== ev.parentElement || o.offsetTop <= top) continue;
        if (o.offsetLeft < right - 1 && o.offsetLeft + o.offsetWidth > left + 1) room = Math.min(room, o.offsetTop - top);
      }
      const full = b.scrollHeight + 4; // + the block's own 2px padding top and bottom
      if (full <= room) { ev.style.height = `${full}px`; continue; } // everything fits in the gap
      ev.classList.add("nometa"); // no room: the name matters more than the instructor line
      if (b.scrollHeight <= b.clientHeight + 1) continue;
      ev.classList.add("grown"); // still too long: grow over the next class, with a shadow
      ev.style.height = `${b.scrollHeight + 4}px`;
    }
  }
  let fitTimer = 0;
  window.addEventListener("resize", () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitEvents, 80); });
