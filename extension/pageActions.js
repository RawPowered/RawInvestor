(() => {
  const hn = location.hostname.toLowerCase();
  const host = hn.replace(/^www\./, "");
  const source = /^([a-z0-9-]+\.)*pricecharting\.com$/i.test(hn)
    ? "pricecharting"
    : host === "tcgplayer.com"
      ? "tcgplayer"
      : host === "ebay.com" || host === "m.ebay.com"
        ? "ebay"
        : null;
  if (!source) return;
  const path = location.pathname.toLowerCase();
  const isPricechartingCardPage =
    source === "pricecharting" &&
    (/^\/(?:trading-cards|game)\//i.test(path) || /^\/(?:pokemon|yugioh|mtg)\//i.test(path));
  const isTcgplayerCardPage =
    source === "tcgplayer" && /^\/product\/\d+/i.test(path);
  const isEbayPage = source === "ebay";

  const hidePcgrCaptureBanner = () => {
    const el = document.getElementById("pcgr-capture-flight-banner");
    if (el) el.remove();
  };

  const showPcgrCaptureBanner = ({ label, mode }) => {
    hidePcgrCaptureBanner();
    const bar = document.createElement("div");
    bar.id = "pcgr-capture-flight-banner";
    bar.setAttribute("data-pcgr-overlay-root", "1");
    bar.setAttribute("role", "status");
    bar.style.cssText = [
      "position:fixed",
      "top:0",
      "left:0",
      "right:0",
      "z-index:2147483647",
      "padding:10px 14px",
      "background:linear-gradient(90deg,#0f766e,#115e59)",
      "color:#fff",
      "font:600 13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
      "text-align:center",
      "box-shadow:0 2px 12px rgba(0,0,0,0.25)",
      "pointer-events:none"
    ].join(";");
    const modeLabel = mode === "deep" ? "More history" : "Quick";
    bar.textContent = `Raw Investor — ${String(label || "Capturing…")} (${modeLabel})`;
    document.documentElement.appendChild(bar);
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "pcgr-capture-banner-show") {
      showPcgrCaptureBanner({
        label: msg.label,
        mode: msg.mode
      });
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === "pcgr-capture-banner-hide") {
      hidePcgrCaptureBanner();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  const makePanel = () => {
    const root = document.createElement("div");
    root.id = "raw-investor-ext-panel";
    root.style.position = "fixed";
    root.style.top = "16px";
    root.style.right = "16px";
    root.style.zIndex = "2147483647";
    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.gap = "8px";
    root.style.maxWidth = "240px";
    return root;
  };

  const makeButton = (label, bg = "#2563eb") => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.style.background = bg;
    btn.style.color = "#fff";
    btn.style.fontWeight = "700";
    btn.style.fontSize = "12px";
    btn.style.border = "0";
    btn.style.padding = "8px 10px";
    btn.style.borderRadius = "8px";
    btn.style.cursor = "pointer";
    btn.style.boxShadow = "0 2px 8px rgba(0,0,0,0.25)";
    return btn;
  };

  const getEbayQuery = () => {
    const u = new URL(location.href);
    const q = (u.searchParams.get("_nkw") || u.searchParams.get("nkw") || "").trim();
    if (q) return q;
    const title = document.querySelector("h1")?.textContent || document.title || "";
    return title.replace(/\s+/g, " ").trim();
  };

  /** eBay: Price + shipping lowest first (US site convention). */
  const EBAY_SOP_LOWEST_DELIVERED = "15";

  const ebayItemIdFromHref = (href) => {
    const s = String(href || "").trim();
    if (!s) return null;
    const m =
      s.match(/\/itm\/(?:[^/?#]+\/)?(\d{4,})(?:[/?#]|$)/i) ||
      s.match(/[?&](?:item|item_id)=(\d{4,})/i) ||
      s.match(/ebay\.com\/itm\/(\d{4,})/i);
    return m ? m[1] : null;
  };

  const findEbaySrpResultsRoot = (root) => {
    const fromLight =
      root.querySelector?.("ul.srp-results, #srp-river-results, .srp-results") || null;
    if (fromLight) return fromLight;
    const deep = querySelectorAllDeep(
      root,
      "ul.srp-results, #srp-river-results, .srp-results"
    );
    return deep[0] || root;
  };

  const querySelectorAllDeep = (root, selector) => {
    const out = [];
    if (!root || typeof root.querySelectorAll !== "function") return out;
    const visit = (node) => {
      if (!node) return;
      try {
        for (const el of node.querySelectorAll(selector)) out.push(el);
      } catch {
        return;
      }
      let stars;
      try {
        stars = node.querySelectorAll("*");
      } catch {
        return;
      }
      for (let i = 0; i < stars.length; i += 1) {
        const el = stars[i];
        const sr = el && el.shadowRoot;
        if (sr) visit(sr);
      }
    };
    visit(root);
    return out;
  };

  const collectTextDeep = (root) => {
    const parts = [];
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 3) {
        parts.push(node.textContent || "");
        return;
      }
      if (node.nodeType === 1) {
        const ch = node.childNodes;
        if (ch) for (let i = 0; i < ch.length; i += 1) walk(ch[i]);
        if (node.shadowRoot) walk(node.shadowRoot);
      }
    };
    walk(root);
    return parts.join("").replace(/\s+/g, " ").trim();
  };

  const parseUsd = (s) => {
    const m = String(s || "").match(/\$?\s*([\d,]+(?:\.\d{1,2})?)/);
    if (!m) return null;
    const n = Number.parseFloat(m[1].replace(/,/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const parseEbayPriceUsd = (s) => {
    let txt = String(s || "").replace(/\s+/g, " ").trim();
    if (!txt) return null;
    const bo = txt.toLowerCase().indexOf("best offer");
    if (bo !== -1) txt = txt.slice(0, bo).replace(/\s+$/g, "").trim();
    const tLower = txt.toLowerCase();
    if (/\bshipping\b/.test(tLower) || /\bdelivery\b/.test(tLower)) return null;
    if (/^\s*was\b/i.test(txt) || /^\s*est\.?\b/i.test(txt)) return null;
    if (/\bwas\s*:/.test(tLower) || /\boriginal\s*:/.test(tLower)) return null;
    const mUsd = txt.match(/\bUS\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (mUsd) return parseUsd(mUsd[1]);
    return parseUsd(txt);
  };

  const parsePriceFromListingCardText = (raw) => {
    const cleaned = String(raw || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return null;
    const dollarMatches = [...cleaned.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g)];
    if (dollarMatches.length >= 2) {
      for (let i = dollarMatches.length - 1; i >= 0; i -= 1) {
        const frag = dollarMatches[i][0];
        const p = parseEbayPriceUsd(frag);
        if (p != null) return p;
      }
    }
    return parseEbayPriceUsd(cleaned);
  };

  const listingIdFromRowAttrs = (el) => {
    if (!el || !el.getAttribute) return null;
    const cand = [
      el.getAttribute("data-listingid"),
      el.getAttribute("data-listing-id"),
      el.getAttribute("data-item-id"),
      el.getAttribute("data-listingId")
    ];
    for (const v of cand) {
      const t = String(v || "").trim();
      if (/^\d{4,}$/.test(t)) return t;
    }
    if (el.attributes) {
      for (let i = 0; i < el.attributes.length; i += 1) {
        const a = el.attributes[i];
        const n = a.name.toLowerCase();
        if (!/(item|listing|iguid|iid)/.test(n)) continue;
        const t = String(a.value || "").trim();
        if (/^\d{4,}$/.test(t)) return t;
      }
    }
    const marked = querySelectorAllDeep(el, "[data-item-id], [data-listingid], [data-listing-id]")[0];
    if (marked) {
      const t = String(
        marked.getAttribute("data-item-id") ||
          marked.getAttribute("data-listingid") ||
          marked.getAttribute("data-listing-id") ||
          ""
      ).trim();
      if (/^\d{4,}$/.test(t)) return t;
    }
    return null;
  };

  const getPrimaryListingLink = (container) => {
    const anchors = querySelectorAllDeep(
      container,
      "a.s-item__link[href*='/itm/'], a[href*='/itm/'], a[href*='item=']"
    );
    for (let i = 0; i < anchors.length; i += 1) {
      const href = anchors[i].getAttribute("href");
      if (ebayItemIdFromHref(href)) return anchors[i];
    }
    return null;
  };

  const outermostOnly = (arr) => {
    const a = [...new Set(arr)];
    return a.filter((el) => !a.some((o) => o !== el && o.contains(el)));
  };

  const rowLooksLikeListing = (el) => {
    if (!el) return false;
    if (el.matches?.(".s-item__ad")) return false;
    if (listingIdFromRowAttrs(el)) return true;
    const anchors = querySelectorAllDeep(el, "a[href]");
    for (let i = 0; i < anchors.length; i += 1) {
      if (ebayItemIdFromHref(anchors[i].getAttribute("href"))) return true;
    }
    return (
      querySelectorAllDeep(
        el,
        ".s-item__price, .s-card__price, [class*='s-card__price'], .su-card-container__attributes__primary"
      ).length > 0
    );
  };

  const collectEbaySrpRows = (root) => {
    const resultsRoot = findEbaySrpResultsRoot(root);
    const rawRowCandidates = [];
    const pushAll = (list) => {
      list.forEach((n) => rawRowCandidates.push(n));
    };
    pushAll(resultsRoot.querySelectorAll("li.s-item"));
    pushAll(resultsRoot.querySelectorAll("[role='listitem']"));
    pushAll(resultsRoot.querySelectorAll("div.su-card-container"));
    pushAll(resultsRoot.querySelectorAll("div.s-item, .s-item__wrapper"));
    pushAll(querySelectorAllDeep(root, "[data-view*='mi:']"));
    let listingRows = outermostOnly(rawRowCandidates).filter(rowLooksLikeListing);
    if (!listingRows.length) {
      listingRows = outermostOnly(querySelectorAllDeep(root, "[role='listitem']")).filter(
        rowLooksLikeListing
      );
    }
    if (!listingRows.length) {
      listingRows = outermostOnly(Array.from(resultsRoot.querySelectorAll("[role='listitem']")));
    }
    return listingRows.filter((container) => {
      if (container.querySelector?.(".s-item__ad, .s-item--watch-at-corner")) return false;
      return true;
    });
  };

  const titleFromListingContainer = (container) => {
    const a = getPrimaryListingLink(container);
    const ar = (a?.getAttribute?.("aria-label") || a?.getAttribute?.("title") || "").trim();
    if (ar.length > 8) return ar.replace(/^Opens in a new window\s*/i, "").trim();
    const titleHits = querySelectorAllDeep(
      container,
      [
        "[class*='s-card__title']",
        "[class*='item__title']",
        "[class*='listing__title']",
        ".s-item__title span",
        ".s-item__title",
        "[class*='s-item__title']",
        "[data-testid*='title']",
        "h3",
        "h2"
      ].join(", ")
    );
    for (const node of titleHits) {
      const txt = String(node?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      if (txt.length > 8) return txt.slice(0, 220);
    }
    const t = container.querySelector?.(".s-item__title, [class*='item__title']");
    const txt = (t?.textContent || "").replace(/\s+/g, " ").trim();
    if (txt.length > 4) return txt;
    return collectTextDeep(container).slice(0, 220);
  };

  const pickListingImageUrl = (container) => {
    const imgs = querySelectorAllDeep(container, "img");
    let best = "";
    for (const img of imgs) {
      const src = String(
        img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("src") || ""
      ).trim();
      if (!src || /1x1|pixel|spinner|loading|placeholder|^data:/i.test(src)) continue;
      if (/ebayimg\.com|ebaystatic\.com|thumbs\.ebaystatic/i.test(src) && src.length > best.length) {
        best = src;
      }
    }
    return best || null;
  };

  const extractListingSnapshotFromContainer = (container) => {
    const primaryLink = getPrimaryListingLink(container);
    const itemId =
      ebayItemIdFromHref(primaryLink?.getAttribute("href")) || listingIdFromRowAttrs(container);
    if (!itemId) return null;
    const cardText = collectTextDeep(container);
    const title = titleFromListingContainer(container);
    const price = parsePriceFromListingCardText(cardText);
    const imageUrl = pickListingImageUrl(container) || "";
    return {
      itemId,
      title,
      imageUrl,
      priceUsd: price,
      listingUrl: `https://www.ebay.com/itm/${itemId}`
    };
  };

  const scrapeEbayViewItemPage = () => {
    const pathMatch = location.pathname.match(/\/itm\/(?:[^/?#]+\/)?(\d{4,})(?:[/?#]|$)/i);
    let itemId = pathMatch ? pathMatch[1] : null;
    if (!itemId) {
      try {
        const u = new URL(location.href);
        const q =
          u.searchParams.get("item") ||
          u.searchParams.get("item_id") ||
          u.searchParams.get("itemId") ||
          "";
        if (/^\d{4,}$/.test(String(q).trim())) itemId = String(q).trim();
      } catch {
        /* ignore */
      }
    }
    if (!itemId) return null;
    const h1 = document.querySelector(
      "h1#x-item-title-label, h1.x-item-title__main, h1.it-ttl, [data-testid='x-item-title'], h1"
    );
    const title = (h1?.textContent || document.title || "").replace(/\s+/g, " ").trim();
    const priceEls = querySelectorAllDeep(
      document.body,
      ".x-price-primary, [data-testid='x-price-primary'], [itemprop='price'], .x-bin-price, [class*='x-price-primary']"
    );
    const priceScope = priceEls[0] || document.body;
    const price = parsePriceFromListingCardText(collectTextDeep(priceScope));
    const imgEls = querySelectorAllDeep(
      document.body,
      "#icImg, .ux-image-magnify img, .ux-image-carousel-item img, .ux-image-filmstrip img, [data-testid='picture-cnt'] img"
    );
    const img = imgEls[0];
    const imageUrl = String(
      img?.src || img?.getAttribute("data-src") || img?.currentSrc || ""
    ).trim();
    return {
      itemId,
      title: title.slice(0, 240),
      imageUrl,
      priceUsd: price,
      listingUrl: `https://www.ebay.com/itm/${itemId}`
    };
  };

  const stripTargetOverlays = () => {
    document.querySelectorAll("[data-pcgr-overlay-root]").forEach((el) => el.remove());
    document.querySelectorAll("[data-pcgr-row-ring]").forEach((el) => {
      el.style.boxShadow = "";
      el.removeAttribute("data-pcgr-row-ring");
    });
  };

  let overlayDebounce = null;
  const schedulePaintOverlays = () => {
    if (overlayDebounce) window.clearTimeout(overlayDebounce);
    overlayDebounce = window.setTimeout(() => void paintEbayTargetOverlays(), 140);
  };

  const paintEbayTargetOverlays = async () => {
    try {
      let itemIds = [];
      try {
        const rsp = await chrome.runtime.sendMessage({ type: "ext-get-target-overlay-state" });
        if (rsp?.ok && Array.isArray(rsp.itemIds)) itemIds = rsp.itemIds;
      } catch {
        /* offline / no background */
      }
      const targetSet = new Set(itemIds);
      const rows = collectEbaySrpRows(document);
      stripTargetOverlays();
      const priced = [];
      for (const container of rows) {
        const primaryLink = getPrimaryListingLink(container);
        const itemId =
          ebayItemIdFromHref(primaryLink?.getAttribute("href")) || listingIdFromRowAttrs(container);
        if (!itemId) continue;
        const cardText = collectTextDeep(container);
        const title = titleFromListingContainer(container);
        const price = parsePriceFromListingCardText(cardText);
        const imageUrl = pickListingImageUrl(container) || "";
        const listingUrl = `https://www.ebay.com/itm/${itemId}`;
        priced.push({ container, itemId, price, title, listingUrl, imageUrl });
      }
      priced.sort((a, b) => {
        const pa = Number.isFinite(a.price) ? a.price : Number.POSITIVE_INFINITY;
        const pb = Number.isFinite(b.price) ? b.price : Number.POSITIVE_INFINITY;
        return pa - pb;
      });
      const lowestIds = new Set(
        priced
          .filter((p) => Number.isFinite(p.price))
          .slice(0, 12)
          .map((p) => p.itemId)
      );

      for (const p of priced) {
        const isSaved = targetSet.has(p.itemId);
        const isLowest = lowestIds.has(p.itemId) && Number.isFinite(p.price);
        const ring = isSaved
          ? "0 0 0 3px #059669, 0 2px 12px rgba(5,150,105,0.35)"
          : isLowest
            ? "0 0 0 3px #86efac, 0 1px 8px rgba(34,197,94,0.28)"
            : "";
        if (ring) {
          p.container.style.borderRadius = "4px";
          p.container.style.boxShadow = ring;
          p.container.setAttribute("data-pcgr-row-ring", "1");
        }

        const bar = document.createElement("div");
        bar.setAttribute("data-pcgr-overlay-root", "1");
        bar.style.cssText = [
          "position:absolute",
          "top:6px",
          "right:6px",
          "z-index:2147483646",
          "display:flex",
          "flex-wrap:wrap",
          "gap:4px",
          "justify-content:flex-end",
          "align-items:center",
          "max-width:calc(100% - 12px)",
          "pointer-events:auto"
        ].join(";");

        const badge = document.createElement("span");
        badge.style.cssText =
          "font:700 10px/1.2 system-ui,sans-serif;padding:3px 6px;border-radius:4px;background:#0f172a;color:#fff;";
        if (isSaved) {
          badge.textContent = "TARGET";
          badge.style.background = "#059669";
        } else if (isLowest) {
          badge.textContent = "LOW $";
          badge.style.background = "#15803d";
        } else {
          badge.style.display = "none";
        }

        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = isSaved ? "Saved" : "+ Target";
        btn.disabled = Boolean(isSaved);
        btn.style.cssText = [
          "font:700 11px/1 system-ui,sans-serif",
          "border:0",
          "border-radius:6px",
          "padding:5px 8px",
          "cursor:pointer",
          "background:#2563eb",
          "color:#fff",
          "box-shadow:0 1px 4px rgba(0,0,0,0.2)"
        ].join(";");
        btn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (btn.disabled) return;
          btn.disabled = true;
          btn.textContent = "…";
          try {
            const r = await chrome.runtime.sendMessage({
              type: "ext-add-quick-target",
              payload: {
                listingUrl: p.listingUrl,
                itemId: p.itemId,
                title: p.title,
                listingImageUrl: p.imageUrl,
                listingPriceUsd: p.price
              }
            });
            if (!r?.ok) throw new Error(r?.error || "Failed");
            if (r.duplicate) {
              btn.textContent = "Dup";
            } else {
              btn.textContent = "Saved";
              badge.textContent = "TARGET";
              badge.style.background = "#059669";
              badge.style.display = "inline";
              p.container.style.boxShadow =
                "0 0 0 3px #059669, 0 2px 12px rgba(5,150,105,0.35)";
              p.container.setAttribute("data-pcgr-row-ring", "1");
            }
          } catch (err) {
            btn.textContent = "!";
            btn.title = err instanceof Error ? err.message : String(err);
            btn.disabled = false;
          }
        });

        bar.appendChild(badge);
        bar.appendChild(btn);
        const cs = window.getComputedStyle(p.container);
        if (cs.position === "static") {
          p.container.style.position = "relative";
        }
        p.container.appendChild(bar);
      }
    } catch {
      /* ignore */
    }
  };

  const pushSnapshotsFromSrp = () => {
    if (document.visibilityState !== "visible") return;
    const rows = collectEbaySrpRows(document);
    const out = [];
    for (const c of rows) {
      const s = extractListingSnapshotFromContainer(c);
      if (s) out.push(s);
    }
    if (!out.length) return;
    try {
      chrome.runtime.sendMessage(
        { type: "ext-sync-target-listing-snapshots", rows: out },
        () => void chrome.runtime.lastError
      );
    } catch {
      /* ignore */
    }
  };

  const pushSnapshotItemPage = () => {
    if (document.visibilityState !== "visible") return;
    const s = scrapeEbayViewItemPage();
    if (!s) return;
    try {
      chrome.runtime.sendMessage(
        { type: "ext-sync-target-listing-snapshots", rows: [s] },
        () => void chrome.runtime.lastError
      );
    } catch {
      /* ignore */
    }
  };

  const paintEbayItemDock = () => {
    document.querySelectorAll("[data-pcgr-item-dock]").forEach((el) => el.remove());
    const snap = scrapeEbayViewItemPage();
    if (!snap) return;
    const dock = document.createElement("div");
    dock.setAttribute("data-pcgr-overlay-root", "1");
    dock.setAttribute("data-pcgr-item-dock", "1");
    dock.style.cssText =
      "position:fixed;bottom:16px;left:16px;z-index:2147483646;display:flex;gap:12px;align-items:center;flex-wrap:wrap;max-width:min(96vw,520px);padding:12px 14px;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#fff;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.45);font:12px/1.4 system-ui,sans-serif;pointer-events:auto;border:1px solid rgba(255,255,255,0.08)";
    const mini = document.createElement("div");
    mini.style.cssText = "display:flex;gap:12px;align-items:center;min-width:0;flex:1;";
    if (snap.imageUrl) {
      const im = document.createElement("img");
      im.src = snap.imageUrl;
      im.alt = "";
      im.referrerPolicy = "no-referrer";
      im.style.cssText =
        "width:72px;height:72px;object-fit:cover;border-radius:10px;flex-shrink:0;background:#334155;border:1px solid rgba(255,255,255,0.12);";
      mini.appendChild(im);
    }
    const peek = collectTextDeep(document.body).replace(/\s+/g, " ").trim().slice(0, 6000);
    const isAuction = /\bcurrent bid\b/i.test(peek) || /\bplace bid\b/i.test(peek) || /\benter bid\b/i.test(peek);
    const bidsM = peek.match(/(\d+)\s+bids?\b/i);
    const bidsTxt = bidsM ? `${bidsM[1]} bid${bidsM[1] === "1" ? "" : "s"}` : "";
    const endsM = peek.match(/\bends\s+in\s+([^.]{1,56})/i);
    const endsTxt = endsM ? `Ends in ${endsM[1].trim()}` : "";
    const tx = document.createElement("div");
    tx.style.cssText = "min-width:0;flex:1;";
    const t1 = document.createElement("div");
    t1.style.cssText =
      "font-weight:800;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:58vw;";
    t1.textContent = snap.title || "(listing)";
    const lab = document.createElement("div");
    lab.style.cssText =
      "font-size:10px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;opacity:0.75;margin-top:4px;";
    lab.textContent = isAuction ? "Current bid" : "Price";
    const t2 = document.createElement("div");
    t2.style.cssText =
      "font-size:20px;font-weight:900;font-variant-numeric:tabular-nums;line-height:1.1;margin-top:2px;";
    t2.textContent =
      snap.priceUsd != null && Number.isFinite(snap.priceUsd)
        ? `$${Number(snap.priceUsd).toFixed(2)}`
        : "—";
    const t3 = document.createElement("div");
    t3.style.cssText =
      "font-size:11px;opacity:0.88;margin-top:6px;font-variant-numeric:tabular-nums;display:flex;flex-wrap:wrap;gap:8px;";
    const bits = [`#${snap.itemId}`];
    if (bidsTxt) bits.push(bidsTxt);
    if (endsTxt) bits.push(endsTxt);
    t3.textContent = bits.join(" · ");
    tx.appendChild(t1);
    tx.appendChild(lab);
    tx.appendChild(t2);
    tx.appendChild(t3);
    mini.appendChild(tx);
    dock.appendChild(mini);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "+ Target";
    btn.style.cssText =
      "font:800 12px system-ui,sans-serif;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;background:#2563eb;color:#fff;flex-shrink:0;";
    btn.addEventListener("click", async () => {
      const fresh = scrapeEbayViewItemPage();
      if (!fresh) return;
      btn.disabled = true;
      btn.textContent = "…";
      try {
        const r = await chrome.runtime.sendMessage({
          type: "ext-add-quick-target",
          payload: {
            listingUrl: fresh.listingUrl,
            itemId: fresh.itemId,
            title: fresh.title,
            listingImageUrl: fresh.imageUrl,
            listingPriceUsd: fresh.priceUsd
          }
        });
        if (!r?.ok) throw new Error(r?.error || "Failed");
        btn.textContent = r.duplicate ? "Dup" : "Saved";
      } catch (err) {
        btn.textContent = "!";
        btn.title = err instanceof Error ? err.message : String(err);
        btn.disabled = false;
      }
    });
    dock.appendChild(btn);
    document.documentElement.appendChild(dock);
  };

  const initEbaySrpTargetAcquisition = () => {
    void paintEbayTargetOverlays();
    void pushSnapshotsFromSrp();
    const root = findEbaySrpResultsRoot(document) || document.body;
    try {
      const obs = new MutationObserver(() => schedulePaintOverlays());
      obs.observe(root, { childList: true, subtree: true });
    } catch {
      /* ignore */
    }
    window.addEventListener("pageshow", () => schedulePaintOverlays());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") schedulePaintOverlays();
    });
    window.setInterval(() => schedulePaintOverlays(), 3500);
    window.setInterval(() => void pushSnapshotsFromSrp(), 2800);
  };

  const initEbayItemPageAcquisition = () => {
    void pushSnapshotItemPage();
    paintEbayItemDock();
    window.setInterval(() => void pushSnapshotItemPage(), 2800);
    window.setInterval(() => {
      try {
        paintEbayItemDock();
      } catch {
        /* ignore */
      }
    }, 4000);
  };

  const buildPricechartingSearchQuery = () => {
    try {
      const u = new URL(location.href);
      const qp = (
        u.searchParams.get("q") ||
        u.searchParams.get("query") ||
        u.searchParams.get("keywords") ||
        ""
      ).trim();
      if (qp) return qp;
    } catch {
      /* ignore */
    }
    const input = document.querySelector(
      'input[name="q"], input#search, input#q, input[type="search"], input[name="search"]'
    );
    const fromInput = (input && String(input.value || "").trim()) || "";
    if (fromInput) return fromInput;
    const sel = String(window.getSelection?.()?.toString() || "").trim();
    if (sel.length >= 3 && sel.length < 160) return sel;
    const t = (document.title || "").replace(/\s*[|\-]\s*PriceCharting.*$/i, "").trim();
    if (t.length > 2) return t;
    return "pokemon card";
  };

  const initPricechartingEbayAssist = () => {
    if (document.getElementById("pcgr-pc-ebay-assist")) return;
    const wrap = document.createElement("button");
    wrap.type = "button";
    wrap.id = "pcgr-pc-ebay-assist";
    wrap.title = "Open eBay active listings (lowest first) to add Arsenal targets";
    wrap.setAttribute("aria-label", "Open eBay to add Arsenal targets");
    wrap.style.cssText = [
      "position:fixed",
      "bottom:18px",
      "right:18px",
      "z-index:2147483646",
      "width:44px",
      "height:44px",
      "border-radius:999px",
      "border:0",
      "cursor:pointer",
      "background:#ea580c",
      "color:#fff",
      "box-shadow:0 4px 16px rgba(0,0,0,0.28)",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:0"
    ].join(";");
    wrap.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>';
    wrap.addEventListener("click", () => {
      const q = buildPricechartingSearchQuery();
      const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&_sop=${EBAY_SOP_LOWEST_DELIVERED}`;
      window.open(url, "_blank", "noopener,noreferrer");
    });
    document.documentElement.appendChild(wrap);
  };

  if (isEbayPage) {
    /** Same heuristics as RawEngine `buildEbaySessionProbeJs` (tabbed-browser.cjs). */
    const probeEbaySessionFromDom = () => {
      try {
        const text = String(
          document.body && document.body.innerText ? document.body.innerText : ""
        ).toLowerCase();
        const hrefs = Array.from(document.querySelectorAll("a[href]"))
          .map((a) => String(a.href || "").toLowerCase())
          .slice(0, 500);
        const html = String(
          document.documentElement && document.documentElement.innerHTML
            ? document.documentElement.innerHTML
            : ""
        ).toLowerCase();
        const signedOut =
          /signin\.ebay\.com|\/signin|sign in|log in|login/.test(location.href.toLowerCase()) ||
          hrefs.some((h) => /signin\.ebay\.com|\/signin/.test(h)) ||
          /hello[,!]?\s*sign in/.test(text) ||
          /sign in to your account|continue to sign in|create an account/.test(text);
        const signedIn =
          hrefs.some((h) => /\/mye\/|\/mys\/|\/usr\//.test(h)) ||
          /my ebay|watchlist|purchase history|summary|account settings|sign out/.test(text) ||
          /gh-ug|gh-eb-username|gh-identity/.test(html);
        return {
          ok: true,
          status:
            signedIn && !signedOut
              ? "signed-in"
              : signedOut && !signedIn
                ? "signed-out"
                : "unknown",
          url: location.href,
          title: document.title || ""
        };
      } catch (e) {
        return {
          ok: false,
          status: "unknown",
          error: e && e.message ? e.message : String(e)
        };
      }
    };

    let ebaySessionTimer = null;
    const scheduleEbaySessionReport = () => {
      if (ebaySessionTimer) clearTimeout(ebaySessionTimer);
      ebaySessionTimer = setTimeout(() => {
        ebaySessionTimer = null;
        const probe = probeEbaySessionFromDom();
        const status =
          probe.ok && (probe.status === "signed-in" || probe.status === "signed-out" || probe.status === "unknown")
            ? probe.status
            : "unknown";
        void chrome.runtime.sendMessage({
          type: "ext-ebay-session-report",
          status,
          url: typeof probe.url === "string" ? probe.url : location.href,
          title: typeof probe.title === "string" ? probe.title : document.title || ""
        });
      }, 900);
    };
    scheduleEbaySessionReport();
    window.addEventListener("pageshow", scheduleEbaySessionReport);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleEbaySessionReport();
    });

    const pageUrl = new URL(location.href);
    const pathLower = pageUrl.pathname.toLowerCase();
    const isSrp =
      pathLower.includes("/sch/") &&
      (pageUrl.searchParams.get("_nkw") || pageUrl.searchParams.get("nkw"));
    const isItem = /\/itm\/(?:[^/?#]+\/)?\d{4,}/i.test(pathLower);
    const q = getEbayQuery();

    const panel = makePanel();
    if (q) {
      const pcBtn = makeButton("Search PriceCharting", "#0f766e");
      const tcgBtn = makeButton("Search TCGPlayer", "#1d4ed8");
      pcBtn.addEventListener("click", () => {
        const url = `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(q)}`;
        window.open(url, "_blank", "noopener,noreferrer");
      });
      tcgBtn.addEventListener("click", () => {
        const url = `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(q)}&view=grid`;
        window.open(url, "_blank", "noopener,noreferrer");
      });
      panel.appendChild(pcBtn);
      panel.appendChild(tcgBtn);
    }

    if (isSrp) {
      const sop = pageUrl.searchParams.get("_sop");
      const sortBtn = makeButton(
        sop === EBAY_SOP_LOWEST_DELIVERED ? "Sorted: lowest price ✓" : "Sort: lowest price first",
        sop === EBAY_SOP_LOWEST_DELIVERED ? "#64748b" : "#059669"
      );
      if (sop === EBAY_SOP_LOWEST_DELIVERED) sortBtn.disabled = true;
      sortBtn.addEventListener("click", () => {
        if (sortBtn.disabled) return;
        pageUrl.searchParams.set("_sop", EBAY_SOP_LOWEST_DELIVERED);
        location.assign(pageUrl.toString());
      });
      panel.appendChild(sortBtn);
      initEbaySrpTargetAcquisition();
    } else if (isItem) {
      initEbayItemPageAcquisition();
    }

    if (isSrp || isItem) {
      const status = document.createElement("div");
      status.style.cssText =
        "font:10px system-ui,sans-serif;color:#475569;padding:4px 2px 0;text-align:center;line-height:1.3;";
      status.textContent = isSrp
        ? "PCGR · row targets + live sync"
        : "PCGR · listing dock + live sync";
      panel.appendChild(status);
    }

    if (panel.childNodes.length > 0) {
      document.documentElement.appendChild(panel);
    }
    return;
  }

  if (source === "pricecharting" && !isPricechartingCardPage) {
    initPricechartingEbayAssist();
  }

  if (!isPricechartingCardPage && !isTcgplayerCardPage) return;

  const panel = makePanel();
  const toggleBtn = makeButton("Add Card", "#2563eb");
  const removeBtn = makeButton("Remove Card", "#b91c1c");
  removeBtn.style.display = "none";
  const syncButtons = async () => {
    const rsp = await chrome.runtime.sendMessage({
      type: "ext-get-dashboard-card-state",
      source,
      url: location.href
    });
    if (!rsp?.ok) return;
    const added = Boolean(rsp?.result?.added);
    toggleBtn.style.display = added ? "none" : "block";
    removeBtn.style.display = added ? "block" : "none";
  };
  toggleBtn.addEventListener("click", async () => {
    const prior = toggleBtn.textContent || "Add Card";
    toggleBtn.disabled = true;
    toggleBtn.textContent = "Working...";
    try {
      const rsp = await chrome.runtime.sendMessage({
        type: "ext-toggle-dashboard-card",
        source,
        url: location.href
      });
      if (!rsp?.ok) throw new Error(rsp?.error || "Update failed");
      await syncButtons();
    } catch (err) {
      toggleBtn.textContent = err instanceof Error ? err.message : String(err);
      setTimeout(() => {
        toggleBtn.textContent = prior;
      }, 1800);
    } finally {
      toggleBtn.disabled = false;
    }
  });
  removeBtn.addEventListener("click", async () => {
    removeBtn.disabled = true;
    try {
      const rsp = await chrome.runtime.sendMessage({
        type: "ext-toggle-dashboard-card",
        source,
        url: location.href
      });
      if (!rsp?.ok) throw new Error(rsp?.error || "Update failed");
      await syncButtons();
    } catch (err) {
      removeBtn.textContent = err instanceof Error ? err.message : String(err);
      setTimeout(() => {
        removeBtn.textContent = "Remove Card";
      }, 1800);
    } finally {
      removeBtn.disabled = false;
    }
  });
  panel.appendChild(toggleBtn);
  panel.appendChild(removeBtn);
  document.documentElement.appendChild(panel);
  void syncButtons();
  window.addEventListener("pageshow", () => void syncButtons());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncButtons();
  });
  setInterval(() => void syncButtons(), 4000);
})();
