# Run from inject.py after patch14 (uses its `s`, `once`, `swap`): reviews, feedback and
# celebrations (see mkt18.js) on Studio rules, and the review pop-up on Book a class.

# The review pop-up: asked when a client opens Book a class (once per visit).
swap('''    $("#canvas").innerHTML = html;
    renderSelBar();
    if (state.openId) renderDrawer();''', '''    $("#canvas").innerHTML = html;
    renderSelBar();
    if (state.openId) renderDrawer();
    maybeAskReview();''')

# Studio rules: reviews, the Google link, and celebrations.
swap('''        <div class="card"><h3>Waitlist</h3><div class="rules">''', '''        <div class="card"><h3>Reviews and celebrations</h3><div class="rules">
          ${rule("Ask clients for reviews", "After a class they came to, clients are asked for 1 to 5 stars and a comment. They can skip, or pause it for a few weeks.", toggle("pRevOn", STUDIO.reviewsOn, "Ask clients for reviews"), "reviewsEnabled")}
          ${rule("Google review link", "After any review, clients are offered this link to share it on Google too. Everyone is asked, whatever they gave, as Google requires.", `<input type="url" id="pGoogle" value="${esc(STUDIO.googleUrl || "")}" placeholder="https://g.page/r/…/review" style="width:100%;max-width:320px;height:34px;border:1px solid var(--line);border-radius:8px;padding:0 8px;background:var(--surface);color:var(--fg)">`, "googleReviewUrl", "pGoogleErr")}
          ${rule("Celebration pop-ups for staff", "A fun recap every two weeks, and milestones like 100 classes taught. Each person can turn them off for themselves.", toggle("pCelebOn", STUDIO.celebOn, "Celebration pop-ups for staff"), "celebrationsEnabled")}
          ${rule("Write recaps with AI", "Claude summarises the fortnight's review comments and adds two self-care tips. Uses 1 AI credit per recap. It sees numbers and comment text only, never names.", toggle("pAiRecaps", STUDIO.aiRecaps, "Write recaps with AI"), "aiRecaps")}
        </div></div>
        <div class="card"><h3>Waitlist</h3><div class="rules">''')
swap('''    waitlistModes: "“Clients choose”:''', '''    reviewsEnabled: "Clients are asked after their latest class only, never for every class. Skipping is fine; the next class asks again.",
    googleReviewUrl: "In your Google Business Profile, choose “Ask for reviews” and copy the link. Offering it only to happy clients is against Google's rules, so the app offers it to everyone who reviews.",
    celebrationsEnabled: "Recaps and milestones for owners, admins and instructors. They show once, when Home opens.",
    aiRecaps: "Off: the recap uses set wording, with no review summary.",
    waitlistModes: "“Clients choose”:''')
swap('''          err("#pExpErr",''', '''          err("#pGoogleErr", $("#pGoogle").value.trim() && !/^https:\\/\\/\\S+$/.test($("#pGoogle").value.trim()) ? "Use the full https:// link Google gives you for reviews." : ""),
          err("#pExpErr",''')
