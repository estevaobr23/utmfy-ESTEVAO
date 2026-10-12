/*! utmfy tracker v1 — propagação de UTMs para o checkout (sem analytics comportamental).
 * Uso: <script src="https://SEU_APP/t.js" data-offer="slug-da-oferta" async></script>
 * Atributos opcionais:
 *   data-endpoint="https://SEU_APP/api/track"   (padrão: mesma origem do script)
 *   data-checkout-domains="pay.cakto.com.br"     (lista separada por vírgula)
 *   data-callback="false"                        (não enviar ?callback=<sessão> ao checkout)
 *   data-beacon="false"                          (não enviar sessão ao servidor)
 *   data-pixel="<ID_DO_PIXEL_META>"              (carrega o pixel da Meta: PageView + InitiateCheckout no clique do
 *                                                 checkout. Use SÓ em páginas sem outro pixel da Meta instalado;
 *                                                 se a página já tiver `fbq`, o t.js não mexe no pixel)
 * API: window.UtmfyTracker.decorate(url) → url com os parâmetros de atribuição.
 */
(function (w, d) {
  "use strict";
  if (!w || !d || (w.UtmfyTracker && w.UtmfyTracker.version)) return;

  var PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "sck", "fbclid"];
  var UTM5 = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
  var STORE = "_utmfy";
  var TTL_MS = 30 * 24 * 3600 * 1000;
  var script = d.currentScript || null;
  var attr = function (n, def) {
    var v = script && script.getAttribute ? script.getAttribute(n) : null;
    return v == null || v === "" ? def : v;
  };
  var scriptOrigin = (function () {
    try { return new URL(script && script.src ? script.src : w.location.href).origin; } catch (e) { return ""; }
  })();
  var cfg = {
    offer: attr("data-offer", ""),
    endpoint: attr("data-endpoint", scriptOrigin ? scriptOrigin + "/api/track" : ""),
    domains: String(attr("data-checkout-domains", "pay.cakto.com.br")).split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean),
    callback: attr("data-callback", "true") !== "false",
    beacon: attr("data-beacon", "true") !== "false",
    pixel: /^\d{5,30}$/.test(attr("data-pixel", "")) ? attr("data-pixel", "") : "",
  };

  function now() { return new Date().getTime(); }
  function rid() {
    var s = "";
    var a = "abcdefghijklmnopqrstuvwxyz0123456789";
    try {
      var b = new Uint8Array(20);
      w.crypto.getRandomValues(b);
      for (var i = 0; i < b.length; i++) s += a.charAt(b[i] % 36);
    } catch (e) {
      for (var j = 0; j < 20; j++) s += a.charAt(Math.floor(Math.random() * 36));
    }
    return "s" + s;
  }
  function getCookie(name) {
    try {
      var m = d.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()\[\]\\\/+^])/g, "\\$1") + "=([^;]*)"));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }
  function setCookie(name, value, days) {
    try {
      var exp = new Date(now() + days * 864e5).toUTCString();
      d.cookie = name + "=" + encodeURIComponent(value) + "; expires=" + exp + "; path=/; SameSite=Lax";
    } catch (e) { /* ignore */ }
  }
  function load() {
    try {
      var raw = w.localStorage.getItem(STORE);
      var v = raw ? JSON.parse(raw) : null;
      if (v && v.exp && v.exp > now()) return v;
    } catch (e) { /* storage bloqueado */ }
    return null;
  }
  function save(v) {
    try { w.localStorage.setItem(STORE, JSON.stringify(v)); } catch (e) { /* ignore */ }
    setCookie("_utmfy_sid", v.sid, 30);
  }

  function readParams(search) {
    var out = {};
    var any = false;
    try {
      var sp = new URLSearchParams(search);
      for (var i = 0; i < PARAMS.length; i++) {
        var v = sp.get(PARAMS[i]);
        if (v != null && v !== "") { out[PARAMS[i]] = v.slice(0, 500); any = true; }
      }
    } catch (e) { /* ignore */ }
    return any ? out : null;
  }

  // ---- estado -------------------------------------------------------------
  var state = load() || { sid: getCookie("_utmfy_sid") || rid(), ft: null, lt: null };
  if (!/^[A-Za-z0-9._~-]{8,64}$/.test(state.sid)) state.sid = rid();
  var current = readParams(w.location.search);
  var hasTouch = current && (current.fbclid || UTM5.some(function (k) { return current[k]; }));
  if (hasTouch) {
    var touch = { p: current, ts: now(), url: w.location.origin + w.location.pathname };
    if (!state.ft) state.ft = touch;
    state.lt = touch; // last-touch: nova visita com parâmetros substitui a anterior
  }
  state.exp = now() + TTL_MS;
  save(state);

  // fbc: formato fb.1.<ms>.<fbclid>, só se o Pixel ainda não criou.
  if (current && current.fbclid) {
    var fbc = getCookie("_fbc");
    if (!fbc || fbc.split(".").pop() !== current.fbclid) {
      setCookie("_fbc", "fb.1." + now() + "." + current.fbclid, 90);
    }
  }

  function attributionParams() {
    var p = {};
    var src = (state.lt && state.lt.p) || (state.ft && state.ft.p) || {};
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k) && src[k]) p[k] = src[k];
    return p;
  }

  // ---- Pixel da Meta (opcional) ---------------------------------------------
  // Base code padrão da Meta. Só assume o pixel se a página ainda não tem `fbq`
  // (outro dono do pixel → não dobra PageView/InitiateCheckout).
  var pixelOwned = false;
  function loadPixel(id) {
    if (!id || w.fbq) return;
    try {
      var n = (w.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); });
      if (!w._fbq) w._fbq = n;
      n.push = n; n.loaded = true; n.version = "2.0"; n.queue = []; n._utmfy = true;
      var s = d.createElement("script");
      s.async = true;
      s.src = "https://connect.facebook.net/en_US/fbevents.js";
      var first = d.getElementsByTagName("script")[0];
      if (first && first.parentNode) first.parentNode.insertBefore(s, first); else (d.head || d.documentElement).appendChild(s);
      n("init", id);
      n("track", "PageView");
      pixelOwned = true;
    } catch (e) { /* nunca quebra a página */ }
  }
  var lastIC = 0;
  function trackInitiateCheckout() {
    if (!pixelOwned || !w.fbq) return;
    var t = now();
    if (t - lastIC < 1500) return; // clique duplo / bolha de evento
    lastIC = t;
    try { w.fbq("track", "InitiateCheckout"); } catch (e) { /* ignore */ }
  }

  function isCheckout(host) {
    host = String(host || "").toLowerCase();
    for (var i = 0; i < cfg.domains.length; i++) {
      var dm = cfg.domains[i];
      if (host === dm || host.slice(-(dm.length + 1)) === "." + dm) return true;
    }
    return false;
  }

  // Acrescenta SÓ o que falta: nunca sobrescreve nem duplica parâmetro existente.
  function decorate(href, opts) {
    opts = opts || {};
    try {
      var u = new URL(href, w.location.href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return href;
      var checkout = isCheckout(u.hostname);
      var internal = u.hostname === w.location.hostname;
      if (!checkout && !internal && !opts.force) return href;
      var p = attributionParams();
      var changed = false;
      var keys = checkout ? PARAMS : UTM5.concat(["fbclid"]);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (p[k] && !u.searchParams.has(k)) { u.searchParams.set(k, p[k]); changed = true; }
      }
      if (checkout && cfg.callback && !u.searchParams.has("callback")) {
        u.searchParams.set("callback", state.sid);
        changed = true;
      }
      return changed ? u.toString() : href;
    } catch (e) {
      return href;
    }
  }

  function beacon(event) {
    if (!cfg.beacon || !cfg.endpoint) return;
    try {
      var body = JSON.stringify({
        v: 1,
        e: event,
        sid: state.sid,
        offer: cfg.offer,
        url: w.location.origin + w.location.pathname,
        ref: d.referrer ? new URL(d.referrer).hostname : null,
        ft: state.ft ? state.ft.p : null,
        lt: state.lt ? state.lt.p : null,
        fbc: getCookie("_fbc"),
        fbp: getCookie("_fbp"),
      });
      if (w.navigator && w.navigator.sendBeacon) {
        w.navigator.sendBeacon(cfg.endpoint, new Blob([body], { type: "text/plain" }));
      } else if (w.fetch) {
        w.fetch(cfg.endpoint, { method: "POST", body: body, keepalive: true, mode: "no-cors", headers: { "Content-Type": "text/plain" } });
      }
    } catch (e) { /* nunca quebra a página */ }
  }

  function decorateAll() {
    try {
      var links = d.querySelectorAll("a[href]");
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        var h = a.getAttribute("href");
        if (!h || h.charAt(0) === "#" || /^(mailto|tel|sms|javascript):/i.test(h)) continue;
        var n = decorate(a.href);
        if (n !== a.href) a.href = n;
      }
    } catch (e) { /* ignore */ }
  }

  // Links criados depois (ou alterados por JS) são decorados no clique.
  function onClick(ev) {
    var el = ev.target;
    while (el && el.tagName !== "A") el = el.parentNode;
    if (!el || !el.href) return;
    var n = decorate(el.href);
    if (n !== el.href) el.href = n;
    try { if (isCheckout(new URL(el.href).hostname)) beacon("checkout_click"); } catch (e) { /* ignore */ }
    // InitiateCheckout: link para o domínio do checkout OU marcado com data-checkout (mesma regra que a UTMify usava).
    try {
      var marked = el.hasAttribute ? el.hasAttribute("data-checkout") : false;
      if (marked || isCheckout(new URL(el.href).hostname)) trackInitiateCheckout();
    } catch (e) { /* ignore */ }
  }

  w.UtmfyTracker = {
    version: 1,
    sessionId: function () { return state.sid; },
    params: attributionParams,
    decorate: function (url) { return decorate(url, { force: false }); },
    _isCheckout: isCheckout,
  };

  loadPixel(cfg.pixel);
  if (d.addEventListener) d.addEventListener("click", onClick, true);
  if (d.readyState === "loading" && d.addEventListener) {
    d.addEventListener("DOMContentLoaded", decorateAll);
  } else {
    decorateAll();
  }
  beacon("pageview");
})(typeof window !== "undefined" ? window : null, typeof document !== "undefined" ? document : null);
