  // ===========================================================================
  // The help centre: a "Help centre" link at the bottom of the menu (Account), for staff only.
  // It opens in a new tab. In the real app the link comes from GET /v1/help/link (signed, staff
  // only, 12 hours; the API serves the help centre at /help). This preview opens the published
  // help centre instead.
  // ===========================================================================
  {
    const HELP_URL = "https://claude.ai/artifact/RC6G9kQ871d3ifvWyuGsds";
    const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5h-5A1.5 1.5 0 0 1 4 16Z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 0 20 16Z"/></svg>';
    const OUT = '<svg class="helpout" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
    function addHelpLink() {
      document.querySelector("#helpLink")?.remove();
      if (state.role === "client") return;
      const prefs = document.querySelector('.side [data-nav="preferences"]');
      if (!prefs) return;
      prefs.insertAdjacentHTML("afterend", `<a class="navitem helplink" id="helpLink" href="${HELP_URL}" target="_blank" rel="noopener" aria-label="Help centre (opens in a new tab)" data-help="How everything works, with troubleshooting. Opens in a new tab.">${ICON}<span>Help centre</span>${OUT}</a>`);
    }
    const renderWithHelp = render;
    render = function () { // eslint-disable-line no-func-assign
      renderWithHelp();
      addHelpLink();
    };
    addHelpLink();
  }
