# Run from inject.py after patch16 (uses its `s`, `once`, `swap`): feature switches and the
# grouped menu (see mkt20.js).

# Pages for switched-off features are hidden for everyone (same rules as the API).
swap('''  const navFor = (role) => NAV.filter((n) => n.roles.includes(role));''',
     '''  const navFor = (role) => NAV.filter((n) => n.roles.includes(role) && navAllowed(n.id, role));''')

# Pages that share a menu item get tabs across the top.
swap('''      $("#pgOther").innerHTML = PAGES[state.page]();
      BIND[state.page]?.();''', '''      $("#pgOther").innerHTML = hubTabs() + PAGES[state.page]();
      BIND[state.page]?.();
      bindHubTabs();''')
