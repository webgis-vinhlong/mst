(() => {
  'use strict';

  const API_SEARCH = 'https://topmst.com/api/v1/search';
  const API_POST = 'https://topmst.com/api/wp/v2/posts';
  const MAX_RESULTS = 10;
  const DETAIL_CONCURRENCY = 4;

  const $ = s => document.querySelector(s);
  const els = {
    form: $('#searchForm'), keyword: $('#keyword'), clear: $('#clearSearch'), button: $('#searchBtn'),
    status: $('#statusRegion'), results: $('#resultsRegion'), toast: $('#toast')
  };
  let activeController = null;
  let toastTimer = null;

  const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const normalize = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const safeUrl = value => {
    try {
      const u = new URL(value, location.href);
      return /^(https?):$/.test(u.protocol) ? u.href : '';
    } catch { return ''; }
  };

  function node(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value == null || value === false) return;
      if (key === 'class') n.className = value;
      else if (key === 'text') n.textContent = value;
      else if (key === 'dataset') Object.assign(n.dataset, value);
      else n.setAttribute(key, value === true ? '' : String(value));
    });
    children.flat().filter(Boolean).forEach(child => n.append(child instanceof Node ? child : document.createTextNode(String(child))));
    return n;
  }

  function icon(path) {
    const svg = node('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' });
    svg.append(node('path', { d: path, stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    return svg;
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1800);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const ta = node('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      showToast('Đã sao chép');
    } catch { showToast('Không thể sao chép'); }
  }

  function setBusy(busy) {
    els.button.disabled = busy;
    els.button.textContent = busy ? 'Đang tra cứu…' : 'Tra cứu';
    els.keyword.setAttribute('aria-busy', String(busy));
  }

  function clearStatus() { els.status.replaceChildren(); }
  function clearResults() { els.results.replaceChildren(); }

  function showAlert(message, type = 'error') {
    clearStatus();
    const box = node('div', { class: `alert ${type}` });
    box.append(icon(type === 'error' ? 'M12 9v4m0 4h.01M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z' : 'M12 8v4m0 4h.01M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z'));
    box.append(node('div', { text: message }));
    els.status.append(box);
  }

  function showLoading() {
    clearStatus(); clearResults();
    const card = node('div', { class: 'loading-card' });
    ['w35','w75','w55','','w75'].forEach(w => card.append(node('div', { class: `loading-line ${w}` })));
    els.status.append(card);
  }

  async function fetchJson(url, signal) {
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function searchBusiness(keyword, signal) {
    const data = await fetchJson(`${API_SEARCH}?s=${encodeURIComponent(keyword)}`, signal);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.results)) return data.results;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  }

  async function getPostDetail(id, signal) {
    if (!id) throw new Error('Thiếu mã bản ghi');
    return fetchJson(`${API_POST}/${encodeURIComponent(id)}`, signal);
  }

  function textFromHtml(html) {
    const d = document.createElement('div'); d.innerHTML = html; return clean(d.textContent);
  }

  function findRowByIcon(table, iconId) {
    if (!table) return null;
    for (const use of table.querySelectorAll('use')) {
      const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
      if (href === `#${iconId}`) return use.closest('tr');
    }
    return null;
  }

  function rowValueByIcon(table, iconId) {
    const row = findRowByIcon(table, iconId);
    if (!row) return '';
    const cells = row.querySelectorAll('th,td');
    return clean(cells[cells.length - 1]?.textContent);
  }

  function getFieldFromRows(table, aliases) {
    if (!table) return '';
    const wanted = aliases.map(normalize);
    for (const row of table.querySelectorAll('tr')) {
      const cells = row.querySelectorAll('th,td');
      if (cells.length < 2) continue;
      const label = normalize(cells[0].textContent).replace(/[:：]+$/g, '').trim();
      if (wanted.some(a => label === a || label.includes(a))) return clean(cells[cells.length - 1].textContent);
    }
    return '';
  }

  function parseIndustryTable(table) {
    const industries = [];
    if (!table) return industries;
    for (const row of table.querySelectorAll('tr')) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) continue;
      const code = clean(cells[0].textContent);
      if (!/^\d{3,5}$/.test(code)) continue;
      const cell = cells[1];
      const link = cell.querySelector('a');
      let name = clean(link?.textContent || cell.childNodes[0]?.textContent || cell.textContent);
      let detail = '';
      if (link) {
        const clone = cell.cloneNode(true);
        clone.querySelectorAll('a').forEach(a => a.remove());
        detail = clean(clone.textContent).replace(/^[-–—:;\s]+/, '');
      } else {
        const parts = Array.from(cell.childNodes).map(n => clean(n.textContent)).filter(Boolean);
        if (parts.length > 1) { name = parts[0]; detail = clean(parts.slice(1).join(' ')); }
      }
      if (/^(chi tiết|ghi chú)\s*[:：]/i.test(name) && !detail) continue;
      detail = detail.replace(/^(chi tiết|ghi chú)\s*[:：]\s*/i, '');
      industries.push({ code, name: name || clean(cell.textContent), detail, url: safeUrl(link?.href || '') });
    }
    return industries;
  }

  function parseCompanyDetail(html, fallback = {}) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const tables = Array.from(doc.querySelectorAll('table'));
    const mainTable = doc.querySelector('table.taxinfo') || tables.find(t => !parseIndustryTable(t).length) || tables[0] || null;
    const industryTable = tables.find(t => t !== mainTable && parseIndustryTable(t).length) || tables.find(t => parseIndustryTable(t).length) || null;

    const name = clean(doc.querySelector('.entry-title')?.textContent || mainTable?.querySelector('th[colspan],th')?.textContent || fallback.title).replace(/^\d{10,13}\s*[-–—]\s*/, '');
    const taxId = rowValueByIcon(mainTable, 'topmst_ico_hashtag') || getFieldFromRows(mainTable, ['Mã số thuế','MST']) || clean((fallback.title || '').match(/\b\d{10,13}\b/)?.[0]);
    const address = rowValueByIcon(mainTable, 'topmst_ico_location_dot') || getFieldFromRows(mainTable, ['Địa chỉ','Địa chỉ trụ sở','Trụ sở']);
    const representative = rowValueByIcon(mainTable, 'topmst_ico_user_tie') || getFieldFromRows(mainTable, ['Người đại diện','Đại diện pháp luật','Người đại diện theo pháp luật']);
    const mainIndustry = rowValueByIcon(mainTable, 'topmst_ico_book_atlas') || getFieldFromRows(mainTable, ['Ngành nghề chính','Ngành chính']);
    const internationalName = getFieldFromRows(mainTable, ['Tên quốc tế','Tên giao dịch quốc tế']);
    const shortName = getFieldFromRows(mainTable, ['Tên viết tắt']);
    const startDate = getFieldFromRows(mainTable, ['Ngày hoạt động','Ngày cấp','Ngày bắt đầu hoạt động']);
    const managingAuthority = getFieldFromRows(mainTable, ['Quản lý bởi','Cơ quan quản lý','Cơ quan thuế quản lý']);
    const businessType = getFieldFromRows(mainTable, ['Loại hình DN','Loại hình doanh nghiệp']);
    const status = getFieldFromRows(mainTable, ['Tình trạng','Trạng thái']);

    let invoiceInfo = getFieldFromRows(mainTable, ['Thông tin xuất hóa đơn','Thông tin hóa đơn']);
    if (!invoiceInfo) invoiceInfo = clean(doc.querySelector('.invoice-info-hidden,.info-invoice')?.textContent);
    if (/^thông tin xuất hóa đơn$/i.test(invoiceInfo)) invoiceInfo = '';

    let lastUpdated = clean(doc.querySelector('.request-update-info-content')?.textContent);
    if (!lastUpdated) {
      const body = clean(doc.body.textContent);
      const m = body.match(/Mã số thuế\s+\d{10,13}[^.]{0,220}?được cập nhật thông tin lần cuối[^.]*\./i);
      if (m) lastUpdated = clean(m[0]);
    }

    const known = new Set(['mã số thuế','mst','địa chỉ','địa chỉ trụ sở','trụ sở','người đại diện','đại diện pháp luật','người đại diện theo pháp luật','ngành nghề chính','ngành chính','tên quốc tế','tên giao dịch quốc tế','tên viết tắt','ngày hoạt động','ngày cấp','ngày bắt đầu hoạt động','quản lý bởi','cơ quan quản lý','cơ quan thuế quản lý','loại hình dn','loại hình doanh nghiệp','tình trạng','trạng thái','thông tin xuất hóa đơn','thông tin hóa đơn']);
    const extraFields = [];
    if (mainTable) for (const row of mainTable.querySelectorAll('tr')) {
      const cells = row.querySelectorAll('th,td');
      if (cells.length < 2) continue;
      const label = clean(cells[0].textContent).replace(/[:：]+$/,'');
      const value = clean(cells[cells.length - 1].textContent);
      const key = normalize(label);
      if (label && value && !known.has(key) && !/^\d+$/.test(label) && label.length < 70) extraFields.push({ label, value });
    }

    return {
      name: name || clean(fallback.title) || 'Doanh nghiệp', taxId, address, representative, mainIndustry,
      internationalName, shortName, startDate, managingAuthority, businessType, status, invoiceInfo,
      industries: parseIndustryTable(industryTable), lastUpdated, extraFields, url: safeUrl(fallback.url || '')
    };
  }

  async function mapConcurrent(items, limit, worker) {
    const out = new Array(items.length); let cursor = 0;
    async function run() {
      while (cursor < items.length) {
        const i = cursor++;
        try { out[i] = await worker(items[i], i); }
        catch (error) { out[i] = { __error: error }; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return out;
  }

  function appendInfoRow(grid, label, value, opts = {}) {
    if (!clean(value)) return;
    const row = node('div', { class: 'info-row' });
    row.append(node('div', { class: 'info-label', text: label }));
    const cell = node('div', { class: `info-value${opts.strong ? ' strong' : ''}` });
    if (opts.copy) {
      const wrap = node('div', { class: 'value-with-action' });
      wrap.append(node('span', { text: clean(value) }));
      const copy = node('button', { class: 'copy-mini', type: 'button', text: 'Sao chép' });
      copy.addEventListener('click', () => copyText(clean(value)));
      wrap.append(copy); cell.append(wrap);
    } else cell.textContent = clean(value);
    row.append(cell); grid.append(row);
  }

  function buildIndustryTable(info) {
    const section = node('section', { class: 'industry-section' });
    const head = node('div', { class: 'industry-head' });
    head.append(node('h4', { class: 'section-title', text: 'Ngành nghề kinh doanh' }));
    const count = node('div', { class: 'industry-count', text: `${info.industries.length} ngành nghề` });
    head.append(count); section.append(head);

    const tools = node('div', { class: 'industry-tools' });
    const search = node('input', { class: 'industry-search', type: 'search', placeholder: 'Lọc theo mã ngành hoặc tên ngành…', 'aria-label': 'Lọc ngành nghề' });
    tools.append(search); section.append(tools);

    const wrap = node('div', { class: 'table-wrap' });
    const table = node('table', { class: 'industry-table' });
    const thead = node('thead'); const trh = node('tr');
    trh.append(node('th', { text: 'Mã ngành' }), node('th', { text: 'Ngành nghề / chi tiết' })); thead.append(trh);
    const tbody = node('tbody');

    const render = query => {
      const q = normalize(query);
      const rows = q ? info.industries.filter(ind => normalize(`${ind.code} ${ind.name} ${ind.detail}`).includes(q)) : info.industries;
      tbody.replaceChildren();
      rows.forEach(ind => {
        const tr = node('tr'); tr.append(node('td', { class: 'industry-code', text: ind.code }));
        const cell = node('td'); const name = node('div', { class: 'industry-name' });
        if (ind.url) name.append(node('a', { href: ind.url, target: '_blank', rel: 'noopener noreferrer', text: ind.name }));
        else name.textContent = ind.name;
        cell.append(name); if (ind.detail) cell.append(node('div', { class: 'industry-detail', text: ind.detail }));
        tr.append(cell); tbody.append(tr);
      });
      count.textContent = q ? `${rows.length}/${info.industries.length} ngành nghề` : `${info.industries.length} ngành nghề`;
      if (!rows.length) {
        const tr = node('tr'); const td = node('td', { colspan: '2' });
        td.append(node('div', { class: 'empty-filter', text: 'Không có ngành nghề phù hợp bộ lọc.' })); tr.append(td); tbody.append(tr);
      }
    };
    search.addEventListener('input', () => render(search.value)); render('');
    table.append(thead, tbody); wrap.append(table); section.append(wrap); return section;
  }

  function buildCard(info, index) {
    const card = node('article', { class: 'company-card', id: `company-${index + 1}` });
    const head = node('div', { class: 'company-head' }); const titleWrap = node('div', { class: 'company-title-wrap' });
    titleWrap.append(node('div', { class: 'company-kicker', text: 'Hồ sơ doanh nghiệp' }), node('h3', { class: 'company-name', text: info.name }));
    const badges = node('div', { class: 'badges' });
    if (info.taxId) badges.append(node('span', { class: 'badge mst', text: `MST ${info.taxId}` }));
    if (info.status) badges.append(node('span', { class: 'badge status', text: info.status }));
    if (info.industries.length) badges.append(node('span', { class: 'badge neutral', text: `${info.industries.length} ngành nghề` }));
    titleWrap.append(badges);

    const actions = node('div', { class: 'actions' });
    const copy = node('button', { type: 'button', class: 'btn btn-ghost', text: 'Sao chép thông tin' });
    copy.addEventListener('click', () => copyText([info.name, info.taxId && `Mã số thuế: ${info.taxId}`, info.address && `Địa chỉ: ${info.address}`, info.representative && `Người đại diện: ${info.representative}`, info.mainIndustry && `Ngành nghề chính: ${info.mainIndustry}`].filter(Boolean).join('\n')));
    const print = node('button', { type: 'button', class: 'btn btn-ghost', text: 'In hồ sơ' }); print.addEventListener('click', () => window.print());
    actions.append(copy, print); if (info.url) actions.append(node('a', { class: 'btn btn-outline', href: info.url, target: '_blank', rel: 'noopener noreferrer', text: 'Nguồn TopMST ↗' }));
    head.append(titleWrap, actions); card.append(head);

    const body = node('div', { class: 'company-body' }); body.append(node('h4', { class: 'section-title', text: 'Thông tin doanh nghiệp' }));
    const grid = node('div', { class: 'info-grid', style: 'margin-top:12px' });
    appendInfoRow(grid, 'Tên doanh nghiệp', info.name, { strong: true });
    appendInfoRow(grid, 'Tên quốc tế', info.internationalName);
    appendInfoRow(grid, 'Tên viết tắt', info.shortName);
    appendInfoRow(grid, 'Mã số thuế', info.taxId, { strong: true, copy: true });
    appendInfoRow(grid, 'Địa chỉ trụ sở', info.address, { copy: true });
    appendInfoRow(grid, 'Người đại diện', info.representative);
    appendInfoRow(grid, 'Ngày hoạt động / ngày cấp', info.startDate);
    appendInfoRow(grid, 'Cơ quan quản lý', info.managingAuthority);
    appendInfoRow(grid, 'Loại hình doanh nghiệp', info.businessType);
    appendInfoRow(grid, 'Tình trạng', info.status);
    appendInfoRow(grid, 'Ngành nghề chính', info.mainIndustry);
    appendInfoRow(grid, 'Thông tin xuất hóa đơn', info.invoiceInfo);
    info.extraFields.forEach(f => appendInfoRow(grid, f.label, f.value));
    body.append(grid);

    if (info.industries.length) body.append(buildIndustryTable(info));
    else {
      const warning = node('div', { class: 'alert warning', style: 'margin-top:20px' });
      warning.append(icon('M12 9v4m0 4h.01M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z'), node('div', { text: 'Nguồn dữ liệu không trả về bảng ngành nghề cho hồ sơ này.' })); body.append(warning);
    }
    if (info.lastUpdated) {
      const updated = node('div', { class: 'updated' }); updated.append(icon('M12 6v6l4 2M21 12a9 9 0 1 1-3-6.7'), document.createTextNode(info.lastUpdated)); body.append(updated);
    }
    card.append(body); return card;
  }

  function renderResults(items, query, total) {
    clearStatus(); clearResults(); const valid = items.filter(x => !x.__error);
    if (!valid.length) {
      const box = node('div', { class: 'no-result' }); box.append(node('strong', { text: 'Không đọc được chi tiết kết quả' }), document.createTextNode('API có trả kết quả nhưng phần hồ sơ chi tiết không tải được. Vui lòng thử lại hoặc mở nguồn dữ liệu.')); els.results.append(box); return;
    }
    const head = node('div', { class: 'results-head' }); const left = node('div');
    left.append(node('h2', { text: `Kết quả cho “${query}”` }), node('div', { class: 'results-meta', text: `Hiển thị ${valid.length}${total > valid.length ? ` trên ${total}` : ''} kết quả` })); head.append(left); els.results.append(head);
    valid.forEach((info, i) => els.results.append(buildCard(info, i)));
    const failed = items.length - valid.length;
    if (failed) showAlert(`${failed} kết quả không tải được phần chi tiết. Các kết quả còn lại vẫn được hiển thị.`, 'warning');
  }

  async function runSearch(raw) {
    const keyword = clean(raw);
    if (!keyword) { clearResults(); showAlert('Vui lòng nhập mã số thuế, tên doanh nghiệp hoặc người đại diện.'); els.keyword.focus(); return; }
    if (activeController) activeController.abort(); activeController = new AbortController(); const { signal } = activeController;
    setBusy(true); showLoading();
    try {
      const searchResults = await searchBusiness(keyword, signal); if (signal.aborted) return;
      history.replaceState(null, '', `${location.pathname}?q=${encodeURIComponent(keyword)}`);
      if (!searchResults.length) {
        clearStatus(); clearResults(); const box = node('div', { class: 'no-result' });
        box.append(node('strong', { text: 'Không tìm thấy doanh nghiệp phù hợp' }), document.createTextNode('Kiểm tra lại mã số thuế hoặc thử rút gọn tên doanh nghiệp.')); els.results.append(box); return;
      }
      const limited = searchResults.slice(0, MAX_RESULTS);
      const details = await mapConcurrent(limited, DETAIL_CONCURRENCY, async item => {
        const id = item?.id ?? item?.ID ?? item?.post_id;
        const post = await getPostDetail(id, signal);
        const content = post?.content?.rendered ?? post?.content ?? '';
        const titleRaw = item?.title?.rendered ?? item?.title ?? post?.title?.rendered ?? post?.title ?? '';
        const title = typeof titleRaw === 'string' && /<[^>]+>/.test(titleRaw) ? textFromHtml(titleRaw) : clean(titleRaw);
        const url = item?.url ?? item?.link ?? post?.link ?? '';
        return parseCompanyDetail(content, { title, url });
      });
      if (!signal.aborted) renderResults(details, keyword, searchResults.length);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      clearResults();
      showAlert(error instanceof TypeError ? 'Không thể kết nối API TopMST từ trình duyệt. Có thể do mạng, CORS hoặc dịch vụ nguồn đang tạm gián đoạn.' : `Không thể hoàn tất tra cứu (${error.message}).`);
    } finally { if (!signal.aborted) setBusy(false); }
  }

  els.form.addEventListener('submit', e => { e.preventDefault(); runSearch(els.keyword.value); });
  els.keyword.addEventListener('input', () => els.clear.classList.toggle('show', Boolean(els.keyword.value)));
  els.clear.addEventListener('click', () => { els.keyword.value = ''; els.clear.classList.remove('show'); clearStatus(); clearResults(); history.replaceState(null, '', location.pathname); els.keyword.focus(); });
  document.querySelectorAll('.example-chip').forEach(btn => btn.addEventListener('click', () => { els.keyword.value = btn.dataset.query || ''; els.clear.classList.add('show'); runSearch(els.keyword.value); }));
  const initial = new URLSearchParams(location.search).get('q');
  if (initial) { els.keyword.value = initial; els.clear.classList.add('show'); runSearch(initial); } else els.keyword.focus();
})();
