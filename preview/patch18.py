# Run from inject.py after patch17 (uses its `s`, `once`, `swap`): setup by studio type (see mkt21.js).

# Studio rules: each row says which setting it is, for search and "Changed from the usual" marks.
swap('''      const rule = (title, hint, control, helpKey, errId) => `<div class="rule" data-help=''',
     '''      const rule = (title, hint, control, helpKey, errId) => `<div class="rule" data-key="${helpKey || ""}" data-help=''')
