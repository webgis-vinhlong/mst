window.MST_CONFIG = Object.freeze({
  // URL proxy server-side cho GeoVina, KHÔNG đặt API key GeoVina trong file này.
  geovinaProxyUrl: "",
  geocoder: "https://nominatim.openstreetmap.org/search",
  geocodeCacheDays: 30,
  defaultMapType: "roadmap"
});

(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const PRIMARY = 'https://doanhnghiep.vn/api/v1';
  const VIETQR = 'https://api.vietqr.io/v2/business';
  const clean = (v) => String(v ?? '').trim();
  const statusVi = (v) => ({ active: 'Đang hoạt động', suspended: 'Tạm ngừng', dissolved: 'Đã giải thể' }[clean(v).toLowerCase()] || clean(v));

  function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  async function readJson(url, init) {
    const r = await nativeFetch(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers || {}) }, cache: 'no-store' });
    let body = null;
    try { body = await r.json(); } catch {}
    if (!r.ok) {
      const e = new Error(body?.detail || body?.desc || body?.error || `HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return body;
  }

  function normalizeCompany(d, fallbackMst = '') {
    const code = clean(d?.industry?.code).replace(/^[A-Za-z]+/, '');
    return {
      mst: clean(d?.mst || d?.id || fallbackMst),
      name: clean(d?.name_vi || d?.name),
      internationalName: clean(d?.name_en || d?.internationalName),
      shortName: clean(d?.shortName),
      address: clean(d?.address_full || d?.address),
      representative: clean(d?.legal_rep_name),
      startDate: clean(d?.registered_at),
      businessType: clean(d?.legal_form),
      status: statusVi(d?.status),
      province: clean(d?.province?.name_vi),
      industryCode: code,
      industryName: clean(d?.industry?.name_vi),
      freshness: clean(d?.data_freshness_at),
      sourceUrl: d?.mst ? `https://doanhnghiep.vn/dn/${encodeURIComponent(d.mst)}` : 'https://doanhnghiep.vn/'
    };
  }

  async function getCompany(mst, init) {
    try {
      const d = await readJson(`${PRIMARY}/companies/${encodeURIComponent(mst)}`, init);
      return normalizeCompany(d, mst);
    } catch (primaryError) {
      try {
        const d = await readJson(`${VIETQR}/${encodeURIComponent(mst)}`, init);
        if (!d?.data) throw primaryError;
        return normalizeCompany(d.data, mst);
      } catch {
        throw primaryError;
      }
    }
  }

  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fakePost(company) {
    const row = (label, value) => value ? `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>` : '';
    const industryTable = company.industryName
      ? `<table><thead><tr><th>Mã</th><th>Ngành</th></tr></thead><tbody><tr><td>${escapeHtml(company.industryCode || '0000')}</td><td>${escapeHtml(company.industryName)}<br><i>Ngành nghề chính theo nguồn API công khai.</i></td></tr></tbody></table>`
      : '';
    const updated = company.freshness
      ? `<span class="request-update-info-content">Dữ liệu nguồn cập nhật: ${escapeHtml(company.freshness)}</span>`
      : '';
    return {
      content: {
        rendered: `<h1 class="entry-title">${escapeHtml(company.name || company.mst)}</h1><table class="taxinfo"><tr><th colspan="2">${escapeHtml(company.name || company.mst)}</th></tr>${row('Tên quốc tế', company.internationalName)}${row('Tên viết tắt', company.shortName)}${row('Mã số thuế', company.mst)}${row('Địa chỉ', company.address)}${row('Người đại diện', company.representative)}${row('Ngày hoạt động', company.startDate)}${row('Loại hình DN', company.businessType)}${row('Tình trạng', company.status)}${row('Ngành nghề chính', company.industryName)}</table>${updated}${industryTable}`
      }
    };
  }

  async function adaptSearch(keyword, init) {
    const q = clean(keyword);
    try {
      const url = new URL(`${PRIMARY}/search`);
      url.searchParams.set('q', q);
      url.searchParams.set('limit', '10');
      const data = await readJson(url, init);
      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length) {
        return items.map((x) => ({
          id: clean(x.mst),
          title: `${clean(x.mst)} - ${clean(x.name_vi)}`,
          url: `https://doanhnghiep.vn/dn/${encodeURIComponent(clean(x.mst))}`
        }));
      }
    } catch (e) {
      if (!/^\d{10}(?:-?\d{3})?$/.test(q)) throw e;
    }

    if (/^\d{10}(?:-?\d{3})?$/.test(q)) {
      const company = await getCompany(q, init);
      return [{ id: company.mst, title: `${company.mst} - ${company.name || 'Doanh nghiệp'}`, url: company.sourceUrl }];
    }
    return [];
  }

  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input?.url;
    if (!raw) return nativeFetch(input, init);
    let url;
    try { url = new URL(raw, location.href); } catch { return nativeFetch(input, init); }

    if (url.hostname === 'topmst.com' && url.pathname === '/api/v1/search') {
      try { return jsonResponse(await adaptSearch(url.searchParams.get('s') || '', init)); }
      catch (e) { return jsonResponse({ error: e.message || 'Không thể tra cứu nguồn dữ liệu.' }, e.status || 502); }
    }

    if (url.hostname === 'topmst.com' && url.pathname.startsWith('/api/wp/v2/posts/')) {
      const mst = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
      try { return jsonResponse(fakePost(await getCompany(mst, init))); }
      catch (e) { return jsonResponse({ error: e.message || 'Không thể lấy chi tiết doanh nghiệp.' }, e.status || 502); }
    }

    return nativeFetch(input, init);
  };
})();
