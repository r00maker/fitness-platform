# Run from inject.py after patch15 (uses its `s`, `once`, `swap`): full class names on the
# calendar (see mkt19.js). Sample class types use versions, as many studios name them.

# Short classes in the week view: the time sits in front of the name, so the name gets the room.
swap('''      : `<span class="et">${short(s.start)}</span><span class="en">${esc(TYPES[s.type].name)}</span>${compact ? "" : `<span class="em">${metaLine}</span>`}`;''',
     '''      : compact
        ? `<span class="en"><span class="et">${short(s.start)}</span>${esc(TYPES[s.type].name)}</span>`
        : `<span class="et">${short(s.start)}</span><span class="en">${esc(TYPES[s.type].name)}</span><span class="em">${metaLine}</span>`;''')

# After the calendar draws, make every name fit.
swap('''    maybeAskReview();
  }''', '''    maybeAskReview();
    fitEvents();
  }''')

# Sample class types named the way many studios name versions of a class.
swap('reformer: { name: "Reformer Pilates",', 'reformer: { name: "Reformer - Intermediate",')
swap('hiit: { name: "HIIT Circuit",', 'hiit: { name: "Sweat - Essentials",')
swap('mat: { name: "Mat Pilates",', 'mat: { name: "Mat Pilates - Foundations",')
swap('label: "Mat Pilates – 45 min"', 'label: "Mat Pilates - Foundations – 45 min"')
