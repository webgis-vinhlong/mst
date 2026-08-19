(() => {
  "use strict";

  const API_SEARCH = "https://topmst.com/api/v1/search";
  const API_POST = "https://topmst.com/api/wp/v2/posts";
  const MAX_RESULTS = 10;
  const CONFIG = window.MST_CONFIG || {};
  const VIETNAM_CENTER = [15.8, 109.5];

  const $ = (s, root = document) => root.querySelector(s);
  const els = {
    form: $("#searchForm"),
    keyword: $("#keyword"),
    clear: $("#clearSearch"),
    searchBtn: $("#searchBtn"),
    status: $("#statusRegion"),
    shell: $("#resultShell"),
    companyName: $("#companyName"),
    taxIdBadge: $("#taxIdBadge"),
    companyStatus: $("#companyStatus"),
    companyIntro: $("#companyIntro"),
    infoGrid: $("#infoGrid"),
    updateBox: $("#updateBox"),
    lastUpdated: $("#lastUpdated"),
    industries: $("#industryBody"),
    industryCount: $("#industryCount"),
    industrySearch: $("#industrySearch"),
    industryEmpty: $("#industryEmpty"),
    sourceLink: $("#sourceLink"),
    copyCompany: $("#copyCompany"),
    printCompany: $("#printCompany"),
    mapAddress: $("#mapAddress"),
    adminWard: $("#adminWard"),
    adminProvince: $("#adminProvince"),
    coords: $("#coordsText"),
    boundaryStatus: $("#boundaryStatus"),
    googleMapsLink: $("#googleMapsLink"),
    googleEarthLink: $("#googleEarthLink"),
    roadBtn: $("#roadBtn"),
    satelliteBtn: $("#satelliteBtn"),
    toast: $("#toast")
  };

  let activeController = null;
  let currentCompany = null;
  let currentIndustries = [];
  let toastTimer = null;

  let map = null;
  let baseLayer = null;
  let marker = null;
  let wardBoundaryLayer = null;
  let provinceBoundaryLayer = null;

  const clean = (v) => String(v ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const normalize = (v) => clean(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const safeUrl = (value) => {
    try {
      const u = new URL(value, location.href);
      return /^(https?):$/.test(u.protocol) ? u.href : "";
    } catch {
      return "";
    }
  };

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  function setBusy(busy) {
    els.searchBtn.disabled = busy;
    els.searchBtn.textContent = busy ? "ĐANG TRA CỨU..." : "TRA CỨU";
    els.keyword.setAttribute("aria-busy", String(busy));
  }

  function setStatus(message = "", type = "info") {
    els.status.replaceChildren();
    if (!message) return;
    const box = document.createElement("div");
    box.className = type === "loading" ? "loading" : "alert";
    if (type !== "loading") {
      const strong = document.createElement("strong");
      strong.textContent = type === "error" ? "LỖI" : "THÔNG BÁO";
      box.append(strong);
    }
    box.append(document.createTextNode(message));
    els.status.append(box);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.append(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      showToast("ĐÃ SAO CHÉP.");
    } catch {
      showToast("KHÔNG THỂ SAO CHÉP.");
    }
  }

  async function fetchJson(url, signal, options = {}) {
    const response = await fetch(url, {
      signal,
      headers: { Accept: "application/json", ...(options.headers || {}) },
      cache: options.cache || "default"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function searchBusiness(keyword, signal) {
    const data = await fetchJson(`${API_SEARCH}?s=${encodeURIComponent(keyword)}`, signal, { cache: "no-store" });
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.results)) return data.results;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  }

  async function getPostDetail(id, signal) {
    return fetchJson(`${API_POST}/${encodeURIComponent(id)}`, signal, { cache: "no-store" });
  }

  function findRowByIcon(table, iconId) {
    if (!table) return null;
    for (const use of table.querySelectorAll("use")) {
      const href = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
      if (href === `#${iconId}`) return use.closest("tr");
    }
    return null;
  }

  function rowValueByIcon(table, iconId) {
    const row = findRowByIcon(table, iconId);
    if (!row) return "";
    const cells = row.querySelectorAll("th,td");
    return clean(cells[cells.length - 1]?.textContent);
  }

  function rowField(table, aliases) {
    if (!table) return "";
    const wanted = aliases.map(normalize);
    for (const row of table.querySelectorAll("tr")) {
      const cells = row.querySelectorAll("th,td");
      if (cells.length < 2) continue;
      const label = normalize(cells[0].textContent).replace(/[:：]+$/g, "").trim();
      if (wanted.some((x) => label === x || label.includes(x))) {
        return clean(cells[cells.length - 1].textContent);
      }
    }
    return "";
  }

  function parseIndustryTable(table) {
    if (!table) return [];
    const output = [];
    for (const row of table.querySelectorAll("tr")) {
      const cells = row.querySelectorAll("td");
      if (cells.length < 2) continue;
      const code = clean(cells[0].textContent);
      if (!/^\d{3,5}$/.test(code)) continue;

      const cell = cells[1];
      const link = cell.querySelector("a");
      let name = clean(link?.textContent || "");
      let detail = "";

      if (link) {
        const clone = cell.cloneNode(true);
        clone.querySelectorAll("a").forEach((a) => a.remove());
        detail = clean(clone.textContent).replace(/^[-–—:;,\s]+/, "");
      } else {
        const parts = Array.from(cell.childNodes)
          .map((n) => clean(n.textContent))
          .filter(Boolean);
        name = parts[0] || clean(cell.textContent);
        detail = clean(parts.slice(1).join(" "));
      }

      detail = detail.replace(/^(chi tiết|ghi chú)\s*[:：]\s*/i, "");
      output.push({
        code,
        name: name || clean(cell.textContent),
        detail,
        url: safeUrl(link?.href || "")
      });
    }
    return output;
  }

  function parseCompanyDetail(html, fallback = {}) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const tables = Array.from(doc.querySelectorAll("table"));

    const tableScores = tables.map((table) => ({
      table,
      industries: parseIndustryTable(table)
    }));

    const mainTable =
      doc.querySelector("table.taxinfo") ||
      tableScores.find((x) => x.industries.length === 0)?.table ||
      tables[0] ||
      null;

    const industryTable =
      tableScores
        .filter((x) => x.table !== mainTable)
        .sort((a, b) => b.industries.length - a.industries.length)[0]?.table ||
      tableScores.sort((a, b) => b.industries.length - a.industries.length)[0]?.table ||
      null;

    const fallbackTitle = clean(fallback.title);
    const name = clean(
      doc.querySelector(".entry-title")?.textContent ||
      mainTable?.querySelector("th[colspan],th")?.textContent ||
      fallbackTitle
    ).replace(/^\d{10,13}\s*[-–—]\s*/, "");

    const taxId =
      rowValueByIcon(mainTable, "topmst_ico_hashtag") ||
      rowField(mainTable, ["Mã số thuế", "MST"]) ||
      clean(fallbackTitle.match(/\b\d{10,13}\b/)?.[0]);

    const address =
      rowValueByIcon(mainTable, "topmst_ico_location_dot") ||
      rowField(mainTable, ["Địa chỉ", "Địa chỉ trụ sở", "Trụ sở"]);

    const representative =
      rowValueByIcon(mainTable, "topmst_ico_user_tie") ||
      rowField(mainTable, ["Người đại diện", "Người đại diện theo pháp luật", "Đại diện pháp luật"]);

    const mainIndustry =
      rowValueByIcon(mainTable, "topmst_ico_book_atlas") ||
      rowField(mainTable, ["Ngành nghề chính", "Ngành chính"]);

    const fields = {
      internationalName: rowField(mainTable, ["Tên quốc tế", "Tên giao dịch quốc tế"]),
      shortName: rowField(mainTable, ["Tên viết tắt"]),
      startDate: rowField(mainTable, ["Ngày hoạt động", "Ngày bắt đầu hoạt động", "Ngày cấp"]),
      managingAuthority: rowField(mainTable, ["Quản lý bởi", "Cơ quan quản lý", "Cơ quan thuế quản lý"]),
      businessType: rowField(mainTable, ["Loại hình DN", "Loại hình doanh nghiệp"]),
      status: rowField(mainTable, ["Tình trạng", "Trạng thái"]),
      invoiceInfo: rowField(mainTable, ["Thông tin xuất hóa đơn", "Thông tin hóa đơn"])
    };

    if (/^thông tin xuất hóa đơn$/i.test(fields.invoiceInfo)) fields.invoiceInfo = "";

    let lastUpdated = clean(doc.querySelector(".request-update-info-content")?.textContent);
    if (!lastUpdated) {
      const bodyText = clean(doc.body.textContent);
      const match = bodyText.match(/Mã số thuế\s+\d{10,13}[^.]{0,240}?được cập nhật thông tin lần cuối[^.]*\./i);
      if (match) lastUpdated = clean(match[0]);
    }

    const industries = parseIndustryTable(industryTable);
    return {
      name: name || fallbackTitle || "Doanh nghiệp",
      taxId,
      address,
      representative,
      mainIndustry,
      ...fields,
      industries,
      lastUpdated,
      url: safeUrl(fallback.url || "")
    };
  }

  function addInfoRow(label, value, opts = {}) {
    if (!clean(value)) return;
    const row = document.createElement("div");
    row.className = "info-row";

    const left = document.createElement("div");
    left.className = "info-label";
    left.textContent = label;

    const right = document.createElement("div");
    right.className = "info-value";

    if (opts.link) {
      const a = document.createElement("a");
      a.href = opts.link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = clean(value);
      right.append(a);
    } else if (opts.copy) {
      const line = document.createElement("div");
      line.className = "value-line";
      const text = document.createElement("span");
      text.textContent = clean(value);
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "mini-copy";
      copy.textContent = "COPY";
      copy.addEventListener("click", () => copyText(clean(value)));
      line.append(text, copy);
      right.append(line);
    } else {
      right.textContent = clean(value);
    }

    row.append(left, right);
    els.infoGrid.append(row);
  }

  function companySummary(info) {
    const lines = [
      info.name,
      info.taxId ? `Mã số thuế: ${info.taxId}` : "",
      info.address ? `Địa chỉ: ${info.address}` : "",
      info.representative ? `Người đại diện: ${info.representative}` : "",
      info.mainIndustry ? `Ngành nghề chính: ${info.mainIndustry}` : ""
    ].filter(Boolean);
    return lines.join("\n");
  }

  function renderCompany(info) {
    currentCompany = info;
    currentIndustries = Array.isArray(info.industries) ? info.industries : [];

    els.shell.hidden = false;
    els.companyName.textContent = info.name;
    els.taxIdBadge.textContent = info.taxId ? `MST ${info.taxId}` : "MST —";
    els.companyStatus.textContent = info.status ? `TRẠNG THÁI ${info.status}` : "TRẠNG THÁI —";

    const introBits = [];
    if (info.name) introBits.push(`${info.name} là doanh nghiệp${info.taxId ? ` có mã số thuế ${info.taxId}` : ""}.`);
    if (info.address) introBits.push(`Trụ sở đăng ký tại ${info.address}.`);
    if (info.representative) introBits.push(`Người đại diện theo pháp luật là ${info.representative}.`);
    els.companyIntro.textContent = introBits.join(" ");

    els.infoGrid.replaceChildren();
    addInfoRow("Mã số thuế", info.taxId, { copy: true });
    addInfoRow("Tên doanh nghiệp", info.name);
    addInfoRow("Tên quốc tế", info.internationalName);
    addInfoRow("Tên viết tắt", info.shortName);
    addInfoRow("Địa chỉ", info.address, { copy: true });
    addInfoRow("Người đại diện", info.representative);
    addInfoRow("Ngày hoạt động", info.startDate);
    addInfoRow("Cơ quan quản lý", info.managingAuthority);
    addInfoRow("Loại hình DN", info.businessType);
    addInfoRow("Tình trạng", info.status);
    addInfoRow("Ngành nghề chính", info.mainIndustry);
    addInfoRow("Thông tin hóa đơn", info.invoiceInfo);

    if (info.lastUpdated) {
      els.updateBox.hidden = false;
      els.lastUpdated.textContent = info.lastUpdated;
    } else {
      els.updateBox.hidden = true;
      els.lastUpdated.textContent = "";
    }

    if (info.url) {
      els.sourceLink.href = info.url;
      els.sourceLink.hidden = false;
    } else {
      els.sourceLink.hidden = true;
    }

    els.copyCompany.onclick = () => copyText(companySummary(info));
    els.printCompany.onclick = () => window.print();

    renderIndustries("");
    updateMapForCompany(info);
    els.shell.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderIndustries(query) {
    const q = normalize(query);
    const filtered = q
      ? currentIndustries.filter((x) => normalize(`${x.code} ${x.name} ${x.detail}`).includes(q))
      : currentIndustries;

    els.industries.replaceChildren();
    els.industryCount.textContent = `${currentIndustries.length} NGÀNH`;
    els.industryEmpty.hidden = filtered.length > 0;

    for (const ind of filtered) {
      const tr = document.createElement("tr");
      const code = document.createElement("td");
      code.className = "industry-code";
      code.textContent = ind.code;

      const desc = document.createElement("td");
      const name = document.createElement("div");
      name.className = "industry-name";
      if (ind.url) {
        const a = document.createElement("a");
        a.href = ind.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = ind.name;
        name.append(a);
      } else {
        name.textContent = ind.name;
      }
      desc.append(name);

      if (ind.detail) {
        const detail = document.createElement("div");
        detail.className = "industry-detail";
        detail.textContent = ind.detail;
        desc.append(detail);
      }
      tr.append(code, desc);
      els.industries.append(tr);
    }
  }

  function ensureMap() {
    if (map) return map;
    if (!window.Vietflex) throw new Error("Không tải được thư viện Vietflex.");

    map = Vietflex.vietflexMap("map", {
      googleMaps: false,
      center: VIETNAM_CENTER,
      zoom: 5,
      zoomControl: false,
      attributionControl: true
    });
    new Vietflex.ZoomControl({ position: "topleft" }).addTo(map);
    setBaseMap(CONFIG.defaultMapType || "roadmap");
    return map;
  }

  function setBaseMap(type) {
    ensureMapBase(type);
    [els.roadBtn, els.satelliteBtn].forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.maptype === type);
    });
  }

  function ensureMapBase(type) {
    if (!map) return;
    if (baseLayer && map.hasLayer(baseLayer)) map.removeLayer(baseLayer);
    baseLayer = Vietflex.legacyGoogleTiles({ mapType: type, maxZoom: 22 });
    baseLayer.addTo(map);
  }

  function clearMapOverlays() {
    if (!map) return;
    for (const layer of [marker, wardBoundaryLayer, provinceBoundaryLayer]) {
      if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    }
    marker = wardBoundaryLayer = provinceBoundaryLayer = null;
  }

  function geocodeCacheKey(address) {
    return `mst:geocode:v1:${normalize(address)}`;
  }

  function getCachedGeocode(address) {
    try {
      const raw = localStorage.getItem(geocodeCacheKey(address));
      if (!raw) return null;
      const item = JSON.parse(raw);
      const ttl = (Number(CONFIG.geocodeCacheDays) || 30) * 86400000;
      if (!item?.savedAt || Date.now() - item.savedAt > ttl) {
        localStorage.removeItem(geocodeCacheKey(address));
        return null;
      }
      return item.data || null;
    } catch {
      return null;
    }
  }

  function saveCachedGeocode(address, data) {
    try {
      localStorage.setItem(geocodeCacheKey(address), JSON.stringify({ savedAt: Date.now(), data }));
    } catch {}
  }

  async function geocodeAddress(address, signal) {
    if (!address) return null;
    const cached = getCachedGeocode(address);
    if (cached) return cached;

    const endpoint = CONFIG.geocoder || "https://nominatim.openstreetmap.org/search";
    const url = new URL(endpoint);
    url.searchParams.set("q", address);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "vn");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "vi");

    const data = await fetchJson(url.toString(), signal);
    if (!Array.isArray(data) || !data[0]) return null;
    const result = {
      lat: Number(data[0].lat),
      lng: Number(data[0].lon),
      displayName: clean(data[0].display_name)
    };
    if (!Number.isFinite(result.lat) || !Number.isFinite(result.lng)) return null;
    saveCachedGeocode(address, result);
    return result;
  }

  async function fetchGeoVina(path, params, signal) {
    const proxy = clean(CONFIG.geovinaProxyUrl).replace(/\/+$/, "");
    if (!proxy) return null;
    const url = new URL(`${proxy}/${path.replace(/^\/+/, "")}`);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });
    return fetchJson(url.toString(), signal);
  }

  async function getAdminContext(address, signal) {
    const parsed = await fetchGeoVina("parse", { address }, signal);
    const data = parsed?.data || parsed;
    if (!data) return null;

    const province = data.new_province || null;
    const ward = data.matched_new_ward || data.matched_ward || null;
    return {
      data,
      province,
      ward,
      fullNewAddress: clean(data.full_new_address),
      provinceId: clean(province?.id || ward?.province_id),
      wardId: clean(ward?.id)
    };
  }

  async function getBoundaries(admin, signal) {
    if (!admin?.provinceId) return { province: null, ward: null };
    const [province, allWards] = await Promise.all([
      fetchGeoVina("new-boundaries", {
        type: "new-province",
        province_ids: admin.provinceId
      }, signal),
      fetchGeoVina("new-boundaries", {
        type: "new-ward",
        province_ids: admin.provinceId
      }, signal)
    ]);

    let ward = allWards;
    if (admin.wardId && Array.isArray(allWards?.features)) {
      ward = {
        ...allWards,
        features: allWards.features.filter((f) => {
          const p = f?.properties || {};
          return String(p.ward_id || p.ward_code || "") === String(admin.wardId);
        })
      };
    }
    return { province, ward };
  }

  function drawBoundaries(boundaries) {
    if (!map) return;
    if (boundaries?.province?.features?.length) {
      provinceBoundaryLayer = new Vietflex.GeoJSON(boundaries.province, {
        style: {
          color: "#000000",
          weight: 2,
          opacity: 0.85,
          fillColor: "#ffffff",
          fillOpacity: 0.04,
          dashArray: "7 5"
        }
      }).addTo(map);
    }

    if (boundaries?.ward?.features?.length) {
      wardBoundaryLayer = new Vietflex.GeoJSON(boundaries.ward, {
        style: {
          color: "#000000",
          weight: 3,
          opacity: 1,
          fillColor: "#ffffff",
          fillOpacity: 0.14
        },
        onEachFeature: (feature, layer) => {
          const p = feature?.properties || {};
          const label = clean(p.ward_name || p.new_ward_name || "");
          if (label) layer.bindPopup(label);
        }
      }).addTo(map);
    }
  }

  function makeGoogleLinks(info, point) {
    const query = encodeURIComponent(info.address || info.name || "");
    els.googleMapsLink.href = `https://www.google.com/maps/search/?api=1&query=${query}`;
    if (point) {
      els.googleEarthLink.href = `https://earth.google.com/web/@${point.lat},${point.lng},250a,1000d,35y,0h,0t,0r`;
    } else {
      els.googleEarthLink.href = `https://earth.google.com/web/search/${query}`;
    }
  }

  function buildMarkerPopup(info) {
    const wrap = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = info.name || "Doanh nghiệp";
    const address = document.createElement("div");
    address.textContent = info.address || "";
    wrap.append(title, address);
    return wrap;
  }

  async function updateMapForCompany(info) {
    ensureMap();
    clearMapOverlays();
    map.setView(VIETNAM_CENTER, 5);

    els.mapAddress.textContent = info.address || "—";
    els.adminWard.textContent = "—";
    els.adminProvince.textContent = "—";
    els.coords.textContent = "ĐANG ĐỐI CHIẾU...";
    els.boundaryStatus.textContent = clean(CONFIG.geovinaProxyUrl) ? "ĐANG TẢI..." : "CHƯA CẤU HÌNH PROXY";
    makeGoogleLinks(info, null);

    const controller = activeController;
    const signal = controller?.signal;

    let point = null;
    let admin = null;
    let boundaries = null;

    const tasks = [];

    tasks.push(
      geocodeAddress(info.address, signal)
        .then((value) => { point = value; })
        .catch(() => {})
    );

    if (clean(CONFIG.geovinaProxyUrl)) {
      tasks.push(
        getAdminContext(info.address, signal)
          .then(async (value) => {
            admin = value;
            if (admin) boundaries = await getBoundaries(admin, signal);
          })
          .catch(() => {})
      );
    }

    await Promise.all(tasks);
    if (signal?.aborted) return;

    if (admin) {
      els.adminWard.textContent = clean(admin.ward?.name || admin.ward?.ward_name) || "—";
      els.adminProvince.textContent = clean(admin.province?.name || admin.ward?.province_name) || "—";
      if (admin.fullNewAddress) els.mapAddress.textContent = admin.fullNewAddress;
    }

    if (boundaries) {
      drawBoundaries(boundaries);
      const wardCount = boundaries.ward?.features?.length || 0;
      const provinceCount = boundaries.province?.features?.length || 0;
      els.boundaryStatus.textContent = wardCount
        ? "ĐÃ NẠP RANH GIỚI XÃ/PHƯỜNG"
        : provinceCount
          ? "ĐÃ NẠP RANH GIỚI TỈNH/THÀNH"
          : "KHÔNG CÓ POLYGON PHÙ HỢP";
    }

    if (point) {
      marker = new Vietflex.Marker([point.lat, point.lng], { title: info.name })
        .bindPopup(buildMarkerPopup(info))
        .addTo(map);

      els.coords.textContent = `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
      makeGoogleLinks(info, point);

      if (wardBoundaryLayer?.getBounds?.().isValid?.()) {
        map.fitBounds(wardBoundaryLayer.getBounds(), { padding: [22, 22], maxZoom: 16 });
      } else {
        map.setView([point.lat, point.lng], 16);
      }
    } else if (wardBoundaryLayer?.getBounds?.().isValid?.()) {
      const center = wardBoundaryLayer.getBounds().getCenter();
      els.coords.textContent = `${center.lat.toFixed(6)}, ${center.lng.toFixed(6)} (TÂM RANH GIỚI)`;
      map.fitBounds(wardBoundaryLayer.getBounds(), { padding: [22, 22], maxZoom: 15 });
    } else if (provinceBoundaryLayer?.getBounds?.().isValid?.()) {
      map.fitBounds(provinceBoundaryLayer.getBounds(), { padding: [16, 16], maxZoom: 11 });
      els.coords.textContent = "CHỈ XÁC ĐỊNH ĐƯỢC CẤP TỈNH/THÀNH";
    } else {
      els.coords.textContent = "KHÔNG XÁC ĐỊNH";
      if (clean(CONFIG.geovinaProxyUrl)) els.boundaryStatus.textContent = "KHÔNG TẢI ĐƯỢC RANH GIỚI";
    }

    setTimeout(() => map.invalidateSize(), 60);
  }

  async function runSearch(keyword) {
    const q = clean(keyword);
    if (!q) {
      setStatus("Vui lòng nhập mã số thuế, tên doanh nghiệp hoặc người đại diện.", "error");
      return;
    }

    activeController?.abort();
    activeController = new AbortController();
    const { signal } = activeController;

    setBusy(true);
    setStatus("ĐANG KẾT NỐI NGUỒN DỮ LIỆU VÀ TẢI HỒ SƠ DOANH NGHIỆP...", "loading");
    els.shell.hidden = true;

    try {
      const results = await searchBusiness(q, signal);
      if (!results.length) {
        setStatus(`Không tìm thấy kết quả phù hợp với "${q}".`, "error");
        return;
      }

      const limited = results.slice(0, MAX_RESULTS);
      const taxLike = /^\d{10,13}(-\d{3})?$/.test(q);
      let selected = limited[0];

      if (taxLike) {
        selected =
          limited.find((x) => normalize(`${x.title || ""} ${x.url || ""}`).includes(normalize(q))) ||
          limited[0];
      }

      const post = await getPostDetail(selected.id, signal);
      const content = post?.content?.rendered || "";
      const info = parseCompanyDetail(content, {
        title: selected.title,
        url: selected.url
      });

      if (signal.aborted) return;
      setStatus("");
      renderCompany(info);

      const newUrl = new URL(location.href);
      newUrl.searchParams.set("q", q);
      history.replaceState(null, "", newUrl);
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error(error);
      setStatus(`Không thể hoàn tất tra cứu: ${error.message}. Có thể nguồn dữ liệu hoặc CORS đang tạm thời không khả dụng.`, "error");
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    runSearch(els.keyword.value);
  });

  els.clear.addEventListener("click", () => {
    activeController?.abort();
    els.keyword.value = "";
    els.keyword.focus();
    els.shell.hidden = true;
    setStatus("");
    const url = new URL(location.href);
    url.searchParams.delete("q");
    history.replaceState(null, "", url);
  });

  document.querySelectorAll(".example").forEach((button) => {
    button.addEventListener("click", () => {
      els.keyword.value = button.dataset.query || "";
      runSearch(els.keyword.value);
    });
  });

  els.industrySearch.addEventListener("input", () => renderIndustries(els.industrySearch.value));

  els.roadBtn.addEventListener("click", () => setBaseMap("roadmap"));
  els.satelliteBtn.addEventListener("click", () => setBaseMap("satellite"));

  window.addEventListener("resize", () => {
    if (map) map.invalidateSize();
  });

  const initial = new URLSearchParams(location.search).get("q");
  if (initial) {
    els.keyword.value = initial;
    runSearch(initial);
  }
})();
