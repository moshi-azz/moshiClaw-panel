// ─── BROWSER AUTOMATION (UI) ──────────────────────────────────────────────────
function navBrowser() {
    const url = qs('#browser-url').value.trim();
    if (!url) return;
    if (eventsWS) eventsWS.send(JSON.stringify({ type: 'browser', action: 'goto', url }));
    qs('#browser-placeholder').style.display = 'none';
    qs('#browser-img').style.display = 'block';
}

function browserRefresh() {
    if (eventsWS) eventsWS.send(JSON.stringify({ type: 'browser', action: 'refresh' }));
}

function browserScroll(dir) {
    if (eventsWS) eventsWS.send(JSON.stringify({ type: 'browser', action: 'scroll', direction: dir }));
}

function browserManualScreenshot() {
    if (eventsWS) eventsWS.send(JSON.stringify({ type: 'browser', action: 'screenshot' }));
}

function updateBrowserScreenshot(data) {
    const img = qs('#browser-img');
    const ph = qs('#browser-placeholder');
    if (!img) return;
    img.src = 'data:image/png;base64,' + data;
    img.style.display = 'block';
    if (ph) ph.style.display = 'none';
}
