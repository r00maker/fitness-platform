"""Insert the marketing CSS/JS into the preview (between markers), plus nav entries and icons."""
p = "studio-calendar-preview.html"
s = open(p).read()
css = open("src/mkt.css").read()
js = open("src/social.js").read() + open("src/mkt.js").read() + open("src/mkt3.js").read() + open("src/mkt4.js").read() + open("src/mkt5.js").read() + open("src/mkt6.js").read() + open("src/mkt7.js").read() + open("src/mkt8.js").read() + open("src/mkt9.js").read() + open("src/mkt2.js").read() + open("src/mkt10.js").read() + open("src/mkt11.js").read() + open("src/mkt12.js").read() + open("src/mkt13.js").read()
CS, CE = "/* MKT-CSS-START */", "/* MKT-CSS-END */"
JS, JE = "  // MKT-JS-START", "  // MKT-JS-END"
if CS in s:
    s = s[: s.index(CS)] + CS + "\n" + css + "\n" + s[s.index(CE):]
else:
    i = s.index("</style>")
    s = s[:i] + CS + "\n" + css + "\n" + CE + "\n" + s[i:]
if JS in s:
    s = s[: s.index(JS)] + JS + "\n" + js + "\n" + s[s.index(JE):]
else:
    a = '  window.addEventListener("hashchange"'
    i = s.index(a)
    s = s[:i] + JS + "\n" + js + "\n" + JE + "\n" + s[i:]


def once(marker, anchor, text):
    """Insert `text` before `anchor` unless `marker` is already there."""
    global s
    if marker in s:
        return
    assert anchor in s, anchor
    s = s.replace(anchor, text + anchor, 1)


STAFF_NAV = '    { id: "staff", group: "Setup", roles: ["admin"], label: "Staff & pay",'
PAY_NAV = '    { id: "my-pay", group: "Studio", roles: ["instructor"],'
PREF_ICON = "    preferences: '"
once('{ id: "marketing", group: "Studio"', STAFF_NAV,
     '    { id: "marketing", group: "Studio", roles: ["admin"], label: "Marketing", help: "Journeys that run by themselves, emails, campaigns, segments, banners, gift cards and referrals." },\n')
once('{ id: "announcements", group: "Studio"', '    { id: "marketing", group: "Studio"',
     '    { id: "announcements", group: "Studio", roles: ["admin", "foh"], label: "Announcements", help: "Quick notices for clients, like a lift out of order, with an optional push notification." },\n')
once('{ id: "gift-cards", group: "Studio"', PAY_NAV,
     '    { id: "gift-cards", group: "Studio", roles: ["client"], label: "Gift cards", help: "Buy a gift card, give one you\'ve bought, and see your studio credit." },\n'
     '    { id: "refer", group: "Studio", roles: ["client"], label: "Refer a friend", help: "Your referral link and the rewards you\'ve earned." },\n')
once("    marketing: '<path", PREF_ICON,
     "    marketing: '<path d=\"M4 10v4h3l6 4V6L7 10z\"/><path d=\"M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11\"/>',\n"
     "    \"gift-cards\": '<rect x=\"3.5\" y=\"9\" width=\"17\" height=\"11\" rx=\"1.5\"/><path d=\"M12 9v11M3.5 13h17M12 9C10 4 6 5 7.5 7.5 8.5 9 12 9 12 9Zm0 0c2-5 6-4 4.5-1.5C15.5 9 12 9 12 9Z\"/>',\n"
     "    refer: '<circle cx=\"9\" cy=\"8\" r=\"3.2\"/><path d=\"M3 19c.8-3.3 3.2-5 6-5s5.2 1.7 6 5\"/><path d=\"M18 8v6M15 11h6\"/>',\n")
once("    announcements: '<path", PREF_ICON,
     "    announcements: '<path d=\"M5 11a7 7 0 0 1 14 0v4l2 3H3l2-3z\"/><path d=\"M9.5 21h5\"/>',\n")
once('{ id: "loyalty", group: "Studio"', PAY_NAV,
     '    { id: "loyalty", group: "Studio", roles: ["client"], label: "Rewards", help: "Your loyalty points, the rewards you can swap them for, and how to redeem." },\n')
once('{ id: "pickups", group: "Studio"', '    { id: "announcements", group: "Studio"',
     '    { id: "pickups", group: "Studio", roles: ["foh"], label: "Reward pickups", help: "Rewards clients redeemed that you hand over in person.", count: () => LOY_PICKUPS.filter((x) => x.status === "waiting").length },\n')
once("    loyalty: '<path", PREF_ICON,
     "    loyalty: '<path d=\"M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z\"/>',\n"
     "    pickups: '<path d=\"M4 8h16v12H4z\"/><path d=\"M2.5 8h19M12 8v12M12 8C10 3 6 4 7.5 6.5 8.5 8 12 8 12 8Zm0 0c2-5 6-4 4.5-1.5C15.5 8 12 8 12 8Z\"/>',\n")
once('{ id: "leads", group: "Studio"', '    { id: "marketing", group: "Studio"',
     '    { id: "leads", group: "Studio", roles: ["admin"], label: "Leads", help: "People who aren\'t paying members yet: ad enquiries, ClassPass clients and walk-ins.", count: () => LEADS.filter((l) => l.status === "new").length },\n')
once('{ id: "reports", group: "Studio"', '    { id: "marketing", group: "Studio"',
     '    { id: "reports", group: "Studio", roles: ["admin"], label: "Reports", help: "Money in, sales, how full classes are, whether clients come back, and how new people convert." },\n')
once("    leads: '<circle", PREF_ICON,
     "    leads: '<circle cx=\"10\" cy=\"8\" r=\"3.5\"/><path d=\"M3.5 20c.8-3.6 3.4-5.5 6.5-5.5 1.6 0 3 .5 4.2 1.4\"/><path d=\"M17 14v6M14 17h6\"/>',\n"
     "    reports: '<path d=\"M4 20V10M10 20V4M16 20v-7M21 20H3\"/>',\n")
once('{ id: "comms", group: "Studio"', '    { id: "leads", group: "Studio"',
     '    { id: "comms", group: "Studio", roles: ["admin", "foh"], label: "Communication", help: "Read and answer client messages from WhatsApp (email next), alongside your phone.", count: () => unreadTotal() },\n')
once("    comms: '<path", PREF_ICON,
     "    comms: '<path d=\"M4 5h16v11H9l-5 4z\"/><path d=\"M8 9.5h8M8 12.5h5\"/>',\n")
exec(open("patch9.py").read())
exec(open("patch10.py").read())
exec(open("patch11.py").read())
open(p, "w").write(s)
print("ok")
