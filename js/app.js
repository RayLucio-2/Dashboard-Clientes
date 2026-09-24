(function () {
  'use strict';

  /* ---------- Constantes e utilitários ---------- */
  const $ = id => document.getElementById(id);
  const PEND_SITS = ['FALTA ASSINAR', 'SEM PAGAR'];
  const STATUS_KEYS = ['ATIVO', 'PENDENCIA', 'INATIVO'];
  const C = { act: '#10b981', pend: '#f59e0b', exit: '#f43f5e', old: '#64748b', blue: '#3b82f6', violet: '#8b5cf6', ink: '#e2e8f0' };
  const TONE_ORDER = { act: 0, pend: 1, exit: 2, old: 3 };
  const SMALL_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

  // Coordenadas de municípios: deixadas vazias para não manter dados geográficos fixos no código.
  // As coordenadas dos municípios são carregadas de uma base pública; nenhum cliente é embutido no código.
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const brl = (v, d = 2) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: d, maximumFractionDigits: d });
  const num = v => v.toLocaleString('pt-BR');
  const pct = (a, b, d = 1) => b > 0 ? ((a / b) * 100).toFixed(d).replace('.', ',') + '%' : '0%';
  const titleCase = s => String(s).toLowerCase().split(' ').map((w, i) => (i > 0 && SMALL_WORDS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const sentence = s => { s = String(s).toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };
  // Rótulo curto para eixos de gráfico: nomes de ramo compostos ("X / Y / Z") vêm da planilha
  // e, por inteiro, estouram a largura que o Chart.js reserva no eixo — usa só o primeiro segmento
  // e mostra o nome completo no tooltip.
  const shortLabel = s => {
    s = String(s || '');
    const slash = s.indexOf(' / ');
    let out = slash > -1 ? s.slice(0, slash) : s;
    if (out.length > 26) out = out.slice(0, 25).trimEnd() + '…';
    return titleCase(out);
  };
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Nome do estado -> sigla (aceita a planilha vir com "Goiás" ou já com "GO")
  const UF_BY_NAME = {
    'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM', 'bahia': 'BA', 'ceara': 'CE',
    'distrito federal': 'DF', 'espirito santo': 'ES', 'goias': 'GO', 'maranhao': 'MA',
    'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', 'para': 'PA',
    'paraiba': 'PB', 'parana': 'PR', 'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ',
    'rio grande do norte': 'RN', 'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR',
    'santa catarina': 'SC', 'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO'
  };
  const UF_NAMES = { AC:'Acre', AL:'Alagoas', AP:'Amapá', AM:'Amazonas', BA:'Bahia', CE:'Ceará', DF:'Distrito Federal', ES:'Espírito Santo', GO:'Goiás', MA:'Maranhão', MT:'Mato Grosso', MS:'Mato Grosso do Sul', MG:'Minas Gerais', PA:'Pará', PB:'Paraíba', PR:'Paraná', PE:'Pernambuco', PI:'Piauí', RJ:'Rio de Janeiro', RN:'Rio Grande do Norte', RS:'Rio Grande do Sul', RO:'Rondônia', RR:'Roraima', SC:'Santa Catarina', SP:'São Paulo', SE:'Sergipe', TO:'Tocantins' };
  function normUF(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    const n = norm(s);
    if (n.length === 2) return n.toUpperCase();
    return UF_BY_NAME[n] || '';
  }
  const ufFullName = uf => UF_NAMES[uf] || '';
  // Chave única por cidade: o mesmo nome de cidade existe em mais de um estado
  // (ex.: Formosa-GO e Formosa do Rio Preto-BA), então cidade sozinha não basta.
  const gkey = (city, uf) => norm(city) + '|' + (uf || '');
  const cityDisplay = (cl, uf) => uf ? `${cl} (${uf})` : cl;
  const cityLabelFromKey = key => { const g = cityGroupsByKey[key]; return g ? cityDisplay(g.cl, g.uf) : key; };

  /* ---------- Base de dados ---------- */
  // Base inicial vazia. Os dados entram somente pela planilha carregada pelo usuário.
  const DATA_RAW = [];;

  // Nomes de coluna aceitos ao carregar uma planilha (sem acento e em minúsculas)
  const ALIASES = {
    id: ['id', 'cliid', 'codigo', 'cod', 'cod cliente', 'codigo cliente'],
    n:  ['n', 'nome', 'cliente', 'nome do cliente', 'razao social', 'nome fantasia'],
    c:  ['c', 'cidade', 'municipio'],
    uf: ['uf', 'estado', 'sigla uf', 'siglauf', 'sigla estado', 'estado (uf)'],
    s:  ['s', 'situacao', 'situacao cadastral', 'status'],
    r:  ['r', 'ramo', 'ramo de atuacao', 'segmento'],
    g:  ['g', 'grupo', 'grupo do sistema', 'plano', 'sistema'],
    m:  ['m', 'mensalidade', 'valor', 'valor mensalidade', 'mrr'],
    y:  ['y', 'ano', 'desde', 'cliente desde', 'ano de entrada', 'ano entrada', 'ano de cadastro', 'ano cadastro', 'cadastro', 'data cadastro'],
    x:  ['x', 'saida', 'ano de saida', 'ano saida', 'saiu em'],
    a:  ['a', 'endereco', 'endereço', 'endereco completo', 'logradouro', 'address']
  };

  // Texto "Null"/"NaN" vindo de exportações de CRM não é um valor de verdade
  const NULLISH = /^(null|nan|none|undefined)$/i;
  const denull = v => { const s = String(v == null ? '' : v).trim(); return NULLISH.test(s) ? '' : s; };

  function pick(row, colB) {
    const map = {};
    Object.keys(row).forEach(k => { map[norm(k)] = row[k]; });
    const get = f => { for (const a of ALIASES[f]) { if (map[a] !== undefined && map[a] !== '') return map[a]; } return ''; };
    // Regra fixa: se a planilha não tiver uma coluna de Situação reconhecível pelo nome,
    // a coluna B é sempre usada para decidir quem está ativo.
    let s = get('s');
    if (s === '' && colB !== undefined && denull(colB) !== '') s = colB;
    return { id: get('id'), n: get('n'), c: get('c'), uf: get('uf'), s, r: get('r'), g: get('g'), m: get('m'), y: get('y'), x: get('x'), a: get('a') };
  }

  // Aceita 1234.5, "1.234,56", "R$ 1.234,56"
  function parseMoney(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    let s = String(v == null ? '' : v).replace(/[^\d,.\-]/g, '');
    if (!s || s === '-') return 0;
    const hasC = s.includes(','), hasD = s.includes('.');
    if (hasC && hasD) s = s.replace(/\./g, '').replace(',', '.');
    else if (hasC) s = s.replace(',', '.');
    else if (hasD && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  // Aceita 2019, "2019", "12/03/2019" ou data do Excel
  function parseYear(v) {
    if (v instanceof Date) return isNaN(v) ? 0 : v.getFullYear();
    const m = String(v == null ? '' : v).match(/(?:19|20)\d{2}/);
    return m ? +m[0] : 0;
  }

  // Regra de negócio: ATIVO / PENDÊNCIA (falta assinar, sem pagar) / INATIVO (todo o resto)
  // colBValues (opcional): valor bruto da coluna B de cada linha, usado como reserva
  // para decidir quem está ativo quando a planilha não tem um cabeçalho de Situação reconhecível.
  function processData(items, colBValues) {
    const base = items.map((row, idx) => pick(row, colBValues ? colBValues[idx] : undefined))
      .filter(r => r.n !== '' || r.s !== '' || r.c !== '')
      .map((r, i) => {
        const sit = denull(r.s).toUpperCase() || 'SEM SITUAÇÃO';
        let x = parseYear(r.x);
        if (!x) { const mm = sit.match(/SAIU\s*(\d{4})/); if (mm) x = +mm[1]; }
        return { i, raw: r, sit, y: parseYear(r.y), x };
      });

    const Y0 = base.reduce((a, r) => Math.max(a, r.y, r.x), 0) || new Date().getFullYear();

    return base.map(({ i, raw: r, sit, y, x }) => {
      const cidade = denull(r.c).toUpperCase() || 'NÃO INFORMADA';
      const uf = normUF(r.uf);
      const isAtivo = sit === 'ATIVO';
      const isPend = PEND_SITS.includes(sit);
      const statusGeral = isAtivo ? 'ATIVO' : isPend ? 'PENDENCIA' : 'INATIVO';
      const tone = isAtivo ? 'act' : isPend ? 'pend' : (x && x >= Y0 - 1) ? 'exit' : 'old';
      const row = {
        k: i,
        id: r.id !== '' ? r.id : i + 1,
        n: denull(r.n) || `Cliente #${i + 1}`,
        c: cidade, cl: titleCase(cidade), uf,
        s: sit, sl: sentence(sit),
        isAtivo, isPend, statusGeral, tone,
        r: denull(r.r) || 'Sem ramo informado',
        g: denull(r.g) || 'Outros',
        m: parseMoney(r.m),
        address: denull(r.a),
        y, x
      };
      row._q = norm([row.id, row.n, row.cl, row.uf, row.sl, row.g, row.r, row.y || ''].join(' '));
      return row;
    });
  }

  /* ---------- Estado ---------- */
  let dataset = [];
  let filteredData = [];
  let cityContext = [];   // recorte sem o filtro de cidade (para comparar cidades)
  let mosaicRows = [];
  let stats = {};
  const charts = {};
  let animate = true;
  let map = null, markersLayer = null; // mapa (Leaflet), inicializado só quando a aba Mapa é aberta pela 1ª vez
  let mapAddressMarkers = {};
  let mapGeocodeRun = 0;
  let cityGeocodeRun = 0;
  let cityCoordsReady = false;
  let cityCoordsLoading = false;
  const CITY_COORDS = {};

  const cityKey = (city, uf) => norm(city).toUpperCase() + '|' + (uf || '');

  async function loadCityCoordinates() {
    if (cityCoordsReady || cityCoordsLoading) return;
    cityCoordsLoading = true;
    try {
      const url = 'https://raw.githubusercontent.com/facilita-tecnologia/Municipios-Brasileiros/master/Municipios_Brasileiros.csv';
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) throw new Error('Não foi possível carregar as coordenadas dos municípios.');
      const csv = await res.text();
      const lines = csv.split(/\r?\n/);
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(';').map(v => v.trim());
        if (parts.length < 7) continue;
        const lat = Number(parts[5]), lon = Number(parts[6]);
        if (Number.isFinite(lat) && Number.isFinite(lon)) CITY_COORDS[cityKey(parts[1], parts[3])] = [lat, lon];
      }
      cityCoordsReady = true;
    } catch (err) {
      console.warn('Não foi possível carregar a base pública de coordenadas:', err);
    } finally {
      cityCoordsLoading = false;
    }
  }
  const view = { page: 1, pageSize: 12, sortKey: 'id', sortDir: 1, mosaicSort: 'cadastro', ramoMetric: 'qtd', tone: null, cities: new Set() };
  let citiesReady = false;
  let cityGroups = [];           // [{key, c, cl, uf}] — um por combinação cidade+UF na base
  const cityGroupsByKey = {};    // key -> {c, cl, uf}

  /* ---------- Avisos ---------- */
  let noticeTimer;
  function hideNotice() { const el = $('notice'); el.className = 'hidden'; el.innerHTML = ''; }
  function notify(msg, type) {
    type = type || 'info';
    const tones = {
      ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
      error: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
      info: 'border-blue-500/40 bg-blue-500/10 text-blue-200'
    };
    const el = $('notice');
    clearTimeout(noticeTimer);
    el.className = 'flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ' + tones[type];
    el.innerHTML = '<span>' + esc(msg) + '</span><button type="button" class="shrink-0 opacity-70 hover:opacity-100" aria-label="Fechar aviso" data-action="close-notice"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>';
    if (type !== 'error') noticeTimer = setTimeout(hideNotice, 7000);
  }

  /* ---------- Filtros ---------- */
  function fillSelect(id, allValue, allLabel, values, labelFn) {
    const sel = $(id), prev = sel.value;
    sel.innerHTML = '';
    sel.add(new Option(allLabel, allValue));
    values.forEach(v => sel.add(new Option(labelFn ? labelFn(v) : v, v)));
    sel.value = [].some.call(sel.options, o => o.value === prev) ? prev : allValue;
  }

  function populateDropdowns() {
    const uniq = key => [...new Set(dataset.map(r => r[key]))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));

    const map = new Map();
    dataset.forEach(r => {
      const key = gkey(r.c, r.uf);
      if (!map.has(key)) map.set(key, { key, c: r.c, cl: r.cl, uf: r.uf });
    });
    cityGroups = [...map.values()].sort((a, b) => a.cl.localeCompare(b.cl, 'pt-BR') || (a.uf || '').localeCompare(b.uf || '', 'pt-BR'));
    Object.keys(cityGroupsByKey).forEach(k => delete cityGroupsByKey[k]);
    cityGroups.forEach(g => { cityGroupsByKey[g.key] = g; });

    if (!citiesReady) {
      view.cities = new Set();
      citiesReady = true;
    } else {
      const validKeys = new Set(cityGroups.map(g => g.key));
      view.cities = new Set([...view.cities].filter(k => validKeys.has(k)));
    }
    buildCidadeList(cityGroups);
    fillSelect('filter-situacao', 'TODOS', 'Todas as situações', uniq('s'), sentence);
    fillSelect('filter-ramo', 'TODOS', 'Todos os ramos', uniq('r'));
    fillSelect('filter-grupo', 'TODOS', 'Todos os grupos', uniq('g'));
  }

  // Painel de seleção múltipla de cidades
  function cidadeCounts() {
    const f = readFilters();
    const counts = {};
    dataset.forEach(r => { if (matches(r, f, 'city')) { const k = gkey(r.c, r.uf); counts[k] = (counts[k] || 0) + 1; } });
    return counts;
  }

  function buildCidadeList(groups) {
    const list = $('cidade-list');
    list.innerHTML = groups.map(g => `
      <label class="city-row" data-city="${esc(g.key)}" data-search="${esc(norm(g.cl + ' ' + (g.uf || '')))}">
        <input type="checkbox" value="${esc(g.key)}">
        <span class="truncate">${esc(cityDisplay(g.cl, g.uf))}</span>
        <span class="cnt"></span>
      </label>`).join('');
    list.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.checked ? view.cities.add(cb.value) : view.cities.delete(cb.value);
        view.page = 1;
        applyFilters();
      });
    });
    updateCidadeUI();
  }

  function updateCidadeUI() {
    const counts = cidadeCounts();
    $('cidade-list').querySelectorAll('.city-row').forEach(row => {
      const k = row.dataset.city;
      row.querySelector('input').checked = view.cities.has(k);
      row.querySelector('.cnt').textContent = `(${num(counts[k] || 0)})`;
    });
    const n = view.cities.size;
    const g = n === 1 ? cityGroupsByKey[[...view.cities][0]] : null;
    $('cidade-label').textContent = n === 0 ? 'Todas as cidades' : n === 1 && g ? cityDisplay(g.cl, g.uf) : `${n} cidades selecionadas`;
  }

  function toggleCidadePanel(open) {
    const willOpen = open !== undefined ? open : $('cidade-panel').classList.contains('hidden');
    $('cidade-panel').classList.toggle('hidden', !willOpen);
    $('btn-cidade').setAttribute('aria-expanded', String(willOpen));
    if (!willOpen) {
      $('cidade-search').value = '';
      $('cidade-list').querySelectorAll('.city-row').forEach(r => r.classList.remove('hide'));
    }
  }

  const readFilters = () => ({
    cities: view.cities, status: $('filter-status').value,
    sit: $('filter-situacao').value, ramo: $('filter-ramo').value, grupo: $('filter-grupo').value
  });

  function matches(r, f, skip) {
    return (skip === 'city' || f.cities.size === 0 || f.cities.has(gkey(r.c, r.uf)))
      && (f.status === 'TODOS' || r.statusGeral === f.status)
      && (f.sit === 'TODOS' || r.s === f.sit)
      && (f.ramo === 'TODOS' || r.r === f.ramo)
      && (f.grupo === 'TODOS' || r.g === f.grupo);
  }

  // Clicar de novo no mesmo valor desfaz o filtro
  function toggleFilter(id, value) {
    const sel = $(id);
    if (![].some.call(sel.options, o => o.value === value)) return;
    sel.value = sel.value === value ? 'TODOS' : value;
    view.page = 1;
    applyFilters();
  }

  // Clique num gráfico restringe a apenas 1 cidade (chave cidade+UF); clicar de novo na mesma desfaz
  function toggleCity(key) {
    view.cities = (view.cities.size === 1 && view.cities.has(key)) ? new Set() : new Set([key]);
    view.page = 1;
    applyFilters();
  }

  function resetFilters() {
    view.cities = new Set();
    ['filter-status', 'filter-situacao', 'filter-ramo', 'filter-grupo'].forEach(id => { $(id).value = 'TODOS'; });
    $('table-search').value = '';
    view.page = 1; view.tone = null;
    applyFilters();
  }

  function computeStats(rows) {
    const s = { total: rows.length, ativos: 0, pends: 0, inativos: 0, mrr: 0, risco: 0, pagantes: 0, zero: 0 };
    rows.forEach(r => {
      if (r.isAtivo) { s.ativos++; s.mrr += r.m; if (r.m > 0) s.pagantes++; else s.zero++; }
      else if (r.isPend) { s.pends++; s.risco += r.m; }
      else s.inativos++;
    });
    s.ticket = s.pagantes ? s.mrr / s.pagantes : 0;
    return s;
  }

  function applyFilters() {
    const f = readFilters();
    filteredData = dataset.filter(r => matches(r, f));
    cityContext = dataset.filter(r => matches(r, f, 'city'));
    stats = computeStats(filteredData);
    $('filter-summary').textContent = `Mostrando ${num(filteredData.length)} de ${num(dataset.length)} clientes da base`;
    updateCidadeUI();
    renderKPIs(f);
    renderMosaico();
    renderInsights(f);
    renderRiscoReceita();
    renderCharts(f);
    renderTable();
    if (map) renderMap(f); // só atualiza o mapa se a aba já foi aberta ao menos uma vez
  }

  /* ---------- Indicadores ---------- */
  function renderKPIs(f) {
    const s = stats;
    $('kpi-total').textContent = num(s.total);
    $('kpi-cidade-label').textContent = f.cities.size === 0 ? 'Todas as cidades' : f.cities.size === 1 ? cityLabelFromKey([...f.cities][0]) : `${f.cities.size} cidades`;
    $('kpi-ativos').textContent = num(s.ativos);
    $('kpi-pct-ativos').textContent = `${pct(s.ativos, s.total)} do recorte`;
    $('kpi-pendencias').textContent = num(s.pends);
    $('kpi-risco').textContent = s.pends ? `${brl(s.risco, 0)} por mês em risco` : 'Nenhuma pendência no recorte';
    $('kpi-inativos').textContent = num(s.inativos);
    $('kpi-pct-inativos').textContent = `${pct(s.inativos, s.total)} do recorte`;
    $('kpi-mrr').textContent = brl(s.mrr);
    $('kpi-ticket').textContent = brl(s.ticket);
    document.querySelectorAll('[data-kpi]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.kpi !== 'TODOS' && b.dataset.kpi === f.status));
    });
  }

  /* ---------- Mosaico ---------- */
  function renderMosaico() {
    const box = $('mosaico-container');
    const counts = { act: 0, pend: 0, exit: 0, old: 0 };
    filteredData.forEach(r => { counts[r.tone]++; });
    Object.keys(counts).forEach(t => { $('lg-' + t).textContent = `(${num(counts[t])})`; });

    if (!filteredData.length) {
      mosaicRows = [];
      box.innerHTML = '<p class="text-sm text-slate-400">Nenhum cliente com os filtros atuais. <button type="button" class="text-blue-300 underline" data-action="reset">Redefinir filtros</button></p>';
      return;
    }
    mosaicRows = filteredData.slice();
    if (view.mosaicSort === 'status') mosaicRows.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.k - b.k);

    const html = mosaicRows.map((r, i) => `<span class="sq f-${r.tone}" data-i="${i}" style="--i:${i}"></span>`).join('');
    const label = `Mosaico com ${num(filteredData.length)} clientes: ${counts.act} ativos, ${counts.pend} com pendência, ${counts.exit + counts.old} inativos.`;
    const n = filteredData.length, size = n <= 60 ? 26 : n <= 200 ? 18 : n <= 600 ? 14 : 11;   // poucos clientes = quadrados maiores
    box.innerHTML = `<div class="grid-mosaico" style="--sq:${size}px" role="img" aria-label="${esc(label)}">${html}</div>`;
    applyHighlight();
  }

  function applyHighlight() {
    document.querySelectorAll('#mosaico-container .sq').forEach(sq => {
      const r = mosaicRows[+sq.dataset.i];
      sq.classList.toggle('dim', !!(view.tone && r && r.tone !== view.tone));
    });
    document.querySelectorAll('[data-tone]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tone === view.tone)));
  }

  const tip = $('tip');
  function showTip(sq, x, y) {
    const r = mosaicRows[+sq.dataset.i];
    if (!r) return;
    tip.innerHTML = `<strong>${esc(r.n)}</strong> <span class="text-slate-400">${esc(cityDisplay(r.cl, r.uf))}</span><br>${esc(r.sl)}${r.y ? ', cliente desde ' + r.y : ''}<br>Mensalidade: <b>${brl(r.m)}</b>`;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(x + 14, window.innerWidth - w - 8)) + 'px';
    tip.style.top = ((y + 14 + h > window.innerHeight - 8) ? y - h - 14 : y + 14) + 'px';
  }
  function onPointer(e) {
    const sq = e.target instanceof Element ? e.target.closest('.sq') : null;
    if (sq) showTip(sq, e.clientX, e.clientY); else tip.hidden = true;
  }
  document.addEventListener('pointermove', onPointer);
  document.addEventListener('pointerdown', onPointer);
  document.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

  /* ---------- Leituras do recorte ---------- */
  function renderInsights(f) {
    const ul = $('readout-list'), s = stats;
    if (!s.total) { ul.innerHTML = '<li class="ins ins-info">Sem clientes neste recorte. Ajuste os filtros para ver as leituras.</li>'; return; }

    const where = f.cities.size === 0 ? 'na base toda' : f.cities.size === 1 ? 'em ' + cityLabelFromKey([...f.cities][0]) : `em ${f.cities.size} cidades selecionadas`;
    const items = [];
    items.push(['ok', `<b>${num(s.ativos)} de ${num(s.total)}</b> clientes ${where} estão ativos (${pct(s.ativos, s.total)}).`]);

    if (s.pends) {
      items.push(['warn', `<b>${num(s.pends)}</b> ${s.pends === 1 ? 'cliente com pendência' : 'clientes com pendência'} (falta assinar ou sem pagar): <b>${brl(s.risco, 0)}</b> por mês dependem de regularização${s.mrr ? `, o equivalente a ${pct(s.risco, s.mrr, 0)} do MRR atual` : ''}.`]);
    }

    const top3 = filteredData.filter(r => r.isAtivo && r.m > 0).sort((a, b) => b.m - a.m).slice(0, 3);
    if (s.mrr > 0 && s.pagantes > 3 && top3.length === 3) {
      const sum = top3.reduce((a, r) => a + r.m, 0);
      items.push([sum / s.mrr >= 0.4 ? 'warn' : 'info', `Os 3 maiores contratos (${top3.map(r => esc(r.n)).join(', ')}) somam <b>${pct(sum, s.mrr, 0)}</b> do MRR.`]);
    }

    if (s.zero) {
      items.push(['info', `<b>${num(s.zero)}</b> ${s.zero === 1 ? 'cliente ativo tem' : 'clientes ativos têm'} mensalidade zerada e ${s.zero === 1 ? 'fica' : 'ficam'} fora do ticket médio.`]);
    }

    const byR = {};
    filteredData.filter(r => r.isAtivo && r.r !== 'Sem ramo informado').forEach(r => { const o = byR[r.r] || (byR[r.r] = { q: 0, m: 0 }); o.q++; o.m += r.m; });
    const ks = Object.keys(byR);
    if (ks.length) {
      const tq = ks.slice().sort((a, b) => byR[b].q - byR[a].q)[0];
      const tm = ks.slice().sort((a, b) => byR[b].m - byR[a].m)[0];
      items.push(['info', tq === tm
        ? `<b>${esc(tq)}</b> lidera em clientes (${byR[tq].q}) e em receita (${brl(byR[tq].m, 0)}).`
        : `<b>${esc(tq)}</b> tem mais clientes ativos (${byR[tq].q}); <b>${esc(tm)}</b> gera mais receita (${brl(byR[tm].m, 0)}).`]);
    }

    const yr = {};
    filteredData.forEach(r => { if (r.y) yr[r.y] = (yr[r.y] || 0) + 1; });
    const yk = Object.keys(yr);
    if (yk.length > 1) {
      const best = yk.sort((a, b) => yr[b] - yr[a] || b - a)[0];
      items.push(['info', `<b>${best}</b> foi o ano com mais cadastros novos (${yr[best]}).`]);
    }

    ul.innerHTML = items.map(([t, h]) => `<li class="ins ins-${t}">${h}</li>`).join('');
  }

  /* ---------- Receita de clientes com pendência ou que saíram ---------- */
  function renderRiscoReceita() {
    const pendRows = filteredData.filter(r => r.isPend);
    const exitRows = filteredData.filter(r => !r.isAtivo && !r.isPend);
    const pendTotal = pendRows.reduce((a, r) => a + r.m, 0);
    const exitTotal = exitRows.reduce((a, r) => a + r.m, 0);
    $('risco-pend-valor').textContent = brl(pendTotal);
    $('risco-saida-valor').textContent = brl(exitTotal);
    $('risco-pend-count').textContent = num(pendRows.length);
    $('risco-saida-count').textContent = num(exitRows.length);
  }

  /* ---------- Gráficos ---------- */
  const centerText = {
    id: 'centerText',
    afterDatasetsDraw(chart) {
      const o = chart.options.plugins && chart.options.plugins.centerText;
      if (!o) return;
      const a = chart.chartArea, ctx = chart.ctx, cx = (a.left + a.right) / 2, cy = (a.top + a.bottom) / 2;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f8fafc'; ctx.font = "700 28px 'Bricolage Grotesque', 'Instrument Sans', sans-serif";
      ctx.fillText(o.main, cx, cy - 8);
      ctx.fillStyle = '#94a3b8'; ctx.font = "500 12px 'Instrument Sans', sans-serif";
      ctx.fillText(o.sub, cx, cy + 16);
      ctx.restore();
    }
  };
  const noData = {
    id: 'noData',
    afterDraw(chart) {
      if (chart.config.type === 'doughnut') return;
      if (chart.data.datasets.some(ds => ds.data.some(v => v))) return;
      const a = chart.chartArea; if (!a) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = '#64748b'; ctx.font = "500 13px 'Instrument Sans', sans-serif";
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Sem dados neste recorte', (a.left + a.right) / 2, (a.top + a.bottom) / 2);
      ctx.restore();
    }
  };

  function setupChartDefaults() {
    if (!window.Chart) return;
    if (window.ChartDataLabels) {
      Chart.register(window.ChartDataLabels);
      if (Chart.defaults.plugins.datalabels) Chart.defaults.plugins.datalabels.display = false;
    }
    Chart.register(noData);
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Instrument Sans', system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.borderColor = 'rgba(51,65,85,.6)';
    const tt = Chart.defaults.plugins.tooltip;
    tt.backgroundColor = '#0f172a'; tt.borderColor = '#334155'; tt.borderWidth = 1; tt.padding = 10;
    tt.titleColor = '#f8fafc'; tt.bodyColor = '#e2e8f0';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.legend.labels.color = '#cbd5e1';
  }

  function makeChart(id, cfg) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($(id).getContext('2d'), cfg);
  }
  const pointer = (e, els) => { if (e.native && e.native.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
  const baseOpts = () => ({ responsive: true, maintainAspectRatio: false, animation: animate ? { duration: 500 } : false, onHover: pointer });
  const barLabels = fmt => ({ display: true, anchor: 'end', align: 'end', color: '#e2e8f0', font: { weight: '600', size: 11 }, formatter: fmt });

  function renderCharts(f) {
    if (!window.Chart) return;
    const s = stats;

    // 1) Status (rosca). Clique filtra o status.
    makeChart('chart-status', {
      type: 'doughnut',
      plugins: [centerText],
      data: {
        labels: ['Ativos', 'Pendências', 'Inativos'],
        datasets: [{ data: [s.ativos, s.pends, s.inativos], backgroundColor: [C.act, C.pend, C.exit], borderColor: '#1e293b', borderWidth: 3, hoverOffset: 4 }]
      },
      options: Object.assign(baseOpts(), {
        cutout: '68%',
        onClick: (e, els) => { if (els.length) toggleFilter('filter-status', STATUS_KEYS[els[0].index]); },
        plugins: {
          legend: { position: 'bottom' },
          centerText: { main: num(s.total), sub: s.total === 1 ? 'cliente' : 'clientes' },
          datalabels: {
            display: c => { const v = c.dataset.data[c.dataIndex]; return v > 0 && v / s.total >= 0.06; },
            color: '#fff', font: { weight: '700', size: 11 },
            formatter: v => pct(v, s.total, 1)
          }
        }
      })
    });

    // 2) Cidades (ignora o filtro de cidade; destaca a cidade escolhida)
    const cMap = {};
    cityContext.forEach(r => {
      const k = gkey(r.c, r.uf);
      const o = cMap[k] || (cMap[k] = { a: 0, p: 0, i: 0, label: cityDisplay(r.cl, r.uf) });
      if (r.isAtivo) o.a++; else if (r.isPend) o.p++; else o.i++;
    });
    const tot = k => cMap[k].a + cMap[k].p + cMap[k].i;
    const topC = Object.keys(cMap).sort((p, q) => tot(q) - tot(p)).slice(0, 8);
    if (f.cities.size) {
      const faltando = [...f.cities].filter(k => cMap[k] && !topC.includes(k));
      faltando.forEach(k => { if (topC.length < 8) topC.push(k); else topC[topC.length - 1] = k; });
    }
    const tint = hex => topC.map(k => (f.cities.size === 0 || f.cities.has(k)) ? hex : hex + '55');
    makeChart('chart-cidades', {
      type: 'bar',
      data: {
        labels: topC.map(k => cMap[k].label),
        datasets: [
          { label: 'Ativos', data: topC.map(k => cMap[k].a), backgroundColor: tint(C.act) },
          { label: 'Pendências', data: topC.map(k => cMap[k].p), backgroundColor: tint(C.pend) },
          { label: 'Inativos', data: topC.map(k => cMap[k].i), backgroundColor: tint(C.exit) }
        ]
      },
      options: Object.assign(baseOpts(), {
        indexAxis: 'y',
        onClick: (e, els) => { if (els.length) toggleCity(topC[els[0].index]); },
        scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false } } },
        plugins: { legend: { position: 'bottom' } }
      })
    });

    // 3) Situação cadastral (cor segue o status)
    const sMap = {}, sTone = {};
    filteredData.forEach(r => { sMap[r.s] = (sMap[r.s] || 0) + 1; sTone[r.s] = r.statusGeral; });
    const topS = Object.keys(sMap).sort((a, b) => sMap[b] - sMap[a]).slice(0, 8);
    makeChart('chart-situacao', {
      type: 'bar',
      data: {
        labels: topS.map(sentence),
        datasets: [{
          label: 'Clientes', data: topS.map(k => sMap[k]), borderRadius: 4,
          backgroundColor: topS.map(k => sTone[k] === 'ATIVO' ? C.act : sTone[k] === 'PENDENCIA' ? C.pend : C.exit)
        }]
      },
      options: Object.assign(baseOpts(), {
        indexAxis: 'y',
        layout: { padding: { right: 32 } },
        onClick: (e, els) => { if (els.length) toggleFilter('filter-situacao', topS[els[0].index]); },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } },
        plugins: { legend: { display: false }, datalabels: barLabels(v => num(v)) }
      })
    });

    // 4) Ramos (clientes ou receita)
    const rMap = {};
    filteredData.filter(r => r.isAtivo).forEach(r => { const o = rMap[r.r] || (rMap[r.r] = { q: 0, m: 0 }); o.q++; o.m += r.m; });
    const key = view.ramoMetric === 'mrr' ? 'm' : 'q';
    const topR = Object.keys(rMap).sort((a, b) => rMap[b][key] - rMap[a][key]).slice(0, 7);
    makeChart('chart-ramos', {
      type: 'bar',
      data: {
        labels: topR.map(shortLabel),
        datasets: [{ label: key === 'm' ? 'Receita mensal' : 'Clientes ativos', data: topR.map(k => rMap[k][key]), backgroundColor: C.violet, borderRadius: 4 }]
      },
      options: Object.assign(baseOpts(), {
        indexAxis: 'y',
        layout: { padding: { right: key === 'm' ? 64 : 32 } },
        onClick: (e, els) => { if (els.length) toggleFilter('filter-ramo', topR[els[0].index]); },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0, callback: v => key === 'm' ? brl(v, 0) : v } },
          y: { grid: { display: false } }
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: items => titleCase(topR[items[0].dataIndex]), label: c => key === 'm' ? brl(c.parsed.x) : `${c.parsed.x} clientes` } },
          datalabels: barLabels(v => key === 'm' ? brl(v, 0) : num(v))
        }
      })
    });

    // 5) Evolução por ano: entradas, saídas e base acumulada
    const inMap = {}, outMap = {};
    let minY = 0, maxY = 0;
    filteredData.forEach(r => {
      if (!r.y) return;
      inMap[r.y] = (inMap[r.y] || 0) + 1;
      minY = minY ? Math.min(minY, r.y) : r.y; maxY = Math.max(maxY, r.y);
      if (r.x && r.x >= r.y) { outMap[r.x] = (outMap[r.x] || 0) + 1; maxY = Math.max(maxY, r.x); }
    });
    const years = [];
    if (minY && maxY - minY < 80) for (let y = minY; y <= maxY; y++) years.push(y);
    const ent = years.map(y => inMap[y] || 0), sai = years.map(y => outMap[y] || 0);
    let run = 0;
    const acc = years.map((y, i) => (run += ent[i] - sai[i]));
    makeChart('chart-evolucao', {
      type: 'bar',
      data: {
        labels: years,
        datasets: [
          { type: 'bar', label: 'Novos clientes', data: ent, backgroundColor: C.blue, borderRadius: 3, order: 2 },
          { type: 'bar', label: 'Saídas', data: sai, backgroundColor: C.exit, borderRadius: 3, order: 2 },
          { type: 'line', label: 'Base acumulada', data: acc, yAxisID: 'y1', borderColor: C.ink, backgroundColor: C.ink, borderWidth: 2, tension: 0.25, pointRadius: 2.5, order: 1 }
        ]
      },
      options: Object.assign(baseOpts(), {
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Entradas e saídas no ano' } },
          y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { precision: 0 }, title: { display: true, text: 'Base acumulada' } }
        },
        plugins: { legend: { position: 'bottom', labels: { sort: (a, b) => a.datasetIndex - b.datasetIndex } } }
      })
    });
  }

  /* ---------- Mapa ---------- */
  let mapMetric = 'clients';
  let mapMarkersByCity = {};

  // Endereços e coordenadas são obtidos somente da planilha carregada pelo usuário.

  let mapBaseLayer = null;
  let mapSatelliteLayer = null;
  let mapTerrainLayer = null;

  function createMapLayerControl() {
    if (!map || map._customLayerControl) return;
    const Control = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        const div = L.DomUtil.create('div', 'map-layer-control');
        div.innerHTML = `
          <button type="button" data-map-layer="road" class="active"><i class="fa-solid fa-map"></i> Mapa</button>
          <button type="button" data-map-layer="sat"><i class="fa-solid fa-satellite"></i> Satélite</button>
          <button type="button" data-map-layer="terrain"><i class="fa-solid fa-mountain-sun"></i> Relevo</button>`;
        L.DomEvent.disableClickPropagation(div);
        div.querySelectorAll('[data-map-layer]').forEach(btn => btn.addEventListener('click', () => {
          const mode = btn.dataset.mapLayer;
          if (mapBaseLayer) map.removeLayer(mapBaseLayer);
          if (mapSatelliteLayer) map.removeLayer(mapSatelliteLayer);
          if (mapTerrainLayer) map.removeLayer(mapTerrainLayer);
          if (mode === 'sat') mapSatelliteLayer.addTo(map);
          else if (mode === 'terrain') mapTerrainLayer.addTo(map);
          else mapBaseLayer.addTo(map);
          div.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
        }));
        return div;
      }
    });
    map.addControl(new Control());
    map._customLayerControl = true;
  }

  function initMap() {
    if (map || !window.L) return;
    map = L.map('map', {
      scrollWheelZoom: false,
      zoomControl: true,
      preferCanvas: false,
      attributionControl: true
    }).setView([-14.2, -51.9], 4.3);

    /* Base clara: mais próxima da leitura visual de um mapa comercial moderno. */
    mapBaseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);

    /* Alternativas visuais gratuitas para leitura territorial. */
    mapSatelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19
    });
    mapTerrainLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenTopoMap contributors',
      maxZoom: 17
    });

    createMapLayerControl();
    markersLayer = L.layerGroup().addTo(map);
    map.on('focus', () => map.scrollWheelZoom.enable());
    map.on('blur', () => map.scrollWheelZoom.disable());
    map.on('click', () => {
      document.querySelectorAll('.map-rank-row.active').forEach(el => el.classList.remove('active'));
    });
  }

  function mapDominant(o) {
    if (o.a >= o.p && o.a >= o.i) return 'act';
    if (o.p >= o.i) return 'pend';
    return 'exit';
  }

  function mapRadius(value, maxValue) {
    if (!value) return 8;
    return 18 + Math.sqrt(value / Math.max(maxValue, 1)) * 22;
  }

  function mapCityIcon(o, selected, searchHit) {
    const dominant = mapDominant(o);
    const total = o.a + o.p + o.i;
    const radius = mapRadius(mapMetric === 'mrr' ? o.mrr : total, mapMetric === 'mrr' ? o._maxMrr : o._maxTotal);
    const size = Math.round(radius * 2);
    const pAct = total ? (o.a / total) * 100 : 0;
    const pPend = total ? (o.p / total) * 100 : 0;
    const bg = `conic-gradient(${C.act} 0 ${pAct}%, ${C.pend} ${pAct}% ${pAct + pPend}%, ${C.exit} ${pAct + pPend}% 100%)`;
    return L.divIcon({
      className: '',
      html: `<div class="map-city-marker ${selected ? '' : 'dim'} ${searchHit ? 'search-hit' : ''}" style="width:${size}px;height:${size}px;background:${bg}" title="${esc(o.label)}"><span class="map-city-count">${num(total)}</span></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2 + 2]
    });
  }

  function mapPopup(cityLabel, o, addressRow = null) {
    if (addressRow) {
      const statusLabel = addressRow.isAtivo ? 'Ativo' : addressRow.isPend ? 'Pendência' : 'Inativo';
      return `<div>
        <div style="font-size:15px;font-weight:800;margin-bottom:5px;color:#fff">${esc(addressRow.n)}</div>
        <div style="color:#94a3b8;margin-bottom:8px">${esc(cityLabel)} · <b style="color:${C[addressRow.tone] || C.old}">${statusLabel}</b></div>
        <div style="font-size:12px;line-height:1.45;color:#cbd5e1;margin-bottom:8px">📍 ${esc(addressRow.address)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 12px">
          <span>💰 Mensalidade <b>${brl(addressRow.m)}</b></span>
          <span>🆔 Cliente <b>${esc(addressRow.id)}</b></span>
        </div>
        <div style="margin-top:8px;font-size:10px;color:#64748b">Localização obtida a partir do endereço informado na planilha.</div>
      </div>`;
    }
    const total = o.a + o.p + o.i;
    const dominant = mapDominant(o);
    const label = dominant === 'act' ? 'Ativos' : dominant === 'pend' ? 'Pendências' : 'Inativos';
    return `<div>
      <div style="font-size:15px;font-weight:800;margin-bottom:5px;color:#fff">${esc(cityLabel)}</div>
      <div style="color:#94a3b8;margin-bottom:8px">${num(total)} ${total === 1 ? 'cliente' : 'clientes'} · predominância: <b style="color:${C[dominant]}">${label}</b></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 12px">
        <span>🟢 Ativos <b>${num(o.a)}</b></span>
        <span>🟡 Pendências <b>${num(o.p)}</b></span>
        <span>🔴 Inativos <b>${num(o.i)}</b></span>
        <span>💰 MRR <b>${brl(o.mrr)}</b></span>
      </div>
    </div>`;
  }

  function mapAddressIcon(row) {
    const bg = row.isAtivo ? C.act : row.isPend ? C.pend : C.exit;
    return L.divIcon({
      className: '',
      html: `<div class="map-address-marker" style="background:${bg}" title="${esc(row.n)}"><i class="fa-solid fa-location-dot"></i></div>`,
      iconSize: [34, 40],
      iconAnchor: [17, 40],
      popupAnchor: [0, -38]
    });
  }

  function addAddressMarker(row, coord) {
    if (!map || !coord || !row.address) return null;
    const key = String(row.k) + '|' + String(row.id);
    if (mapAddressMarkers[key]) {
      mapAddressMarkers[key].setLatLng(coord);
      return mapAddressMarkers[key];
    }
    const marker = L.marker(coord, { icon: mapAddressIcon(row), keyboard: true, title: row.n });
    marker.bindPopup(mapPopup(cityDisplay(row.cl, row.uf), null, row), { closeButton: true, maxWidth: 320 });
    marker.addTo(markersLayer);
    mapAddressMarkers[key] = marker;
    return marker;
  }

  async function geocodeMapAddresses(rows) {
    const run = ++mapGeocodeRun;
    if (!rows.length || !map) return;

    // Um mesmo endereço pode pertencer a mais de um cliente. Geocodificamos
    // uma vez por endereço, mas criamos um pino para CADA cliente.
    const groups = new Map();
    rows.forEach(r => {
      const rawAddress = String(r.address || '').trim();
      if (!rawAddress) return;
      const query = [rawAddress, r.cl, ufFullName(r.uf) || r.uf, 'Brasil'].filter(Boolean).join(', ');
      const key = norm(query);
      if (!groups.has(key)) groups.set(key, { query, rows: [] });
      groups.get(key).rows.push(r);
    });
    if (!groups.size) return;

    let exactCount = 0;
    let locatedClients = 0;
    let unresolved = 0;

    for (const group of groups.values()) {
      if (run !== mapGeocodeRun || !map) return;

      const cacheKey = 'dashboard_geocode_v2_' + btoa(unescape(encodeURIComponent(group.query))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 100);
      let coord = null;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const p = JSON.parse(cached);
          if (Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) coord = p;
        }
      } catch (_) {}

      if (!coord) {
        try {
          const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&addressdetails=1&q=' + encodeURIComponent(group.query);
          const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
          if (res.ok) {
            const data = await res.json();
            if (data && data[0] && data[0].lat && data[0].lon) {
              coord = [Number(data[0].lat), Number(data[0].lon)];
              if (coord.every(Number.isFinite)) {
                try { localStorage.setItem(cacheKey, JSON.stringify(coord)); } catch (_) {}
              } else coord = null;
            }
          }
        } catch (_) {}
        // Respeita o limite público do Nominatim: uma consulta por segundo.
        await new Promise(resolve => setTimeout(resolve, 1050));
      }

      if (coord && coord.every(Number.isFinite)) {
        exactCount++;
        group.rows.forEach(row => {
          if (addAddressMarker(row, coord)) locatedClients++;
        });
      } else {
        unresolved += group.rows.length;
      }
    }

    if (run === mapGeocodeRun) {
      const totalWithAddress = rows.length;
      const el = $('mapa-sem-coord');
      if (el && totalWithAddress) {
        el.textContent = `${num(locatedClients)} de ${num(totalWithAddress)} clientes com endereço localizado · ${num(unresolved)} sem localização exata`;
      }
    }
  }

  async function geocodeCities(groups) {
    const run = ++cityGeocodeRun;
    await loadCityCoordinates();
    if (run !== cityGeocodeRun || !map) return;

    const unique = groups.filter(g => g.c && !CITY_COORDS[cityKey(g.c, g.uf)]);
    for (const g of unique) {
      if (run !== cityGeocodeRun || !map) return;
      const cacheKey = 'dashboard_city_geocode_v2_' + btoa(unescape(encodeURIComponent(g.c + '|' + g.uf))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 80);
      let coord = null;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) { const p = JSON.parse(cached); if (Array.isArray(p) && p.length === 2) coord = p; }
      } catch (_) {}
      if (!coord) {
        try {
          const q = [g.c, ufFullName(g.uf) || g.uf, 'Brasil'].filter(Boolean).join(', ');
          const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=' + encodeURIComponent(q);
          const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
          if (res.ok) {
            const data = await res.json();
            if (data && data[0] && data[0].lat && data[0].lon) {
              coord = [Number(data[0].lat), Number(data[0].lon)];
              try { localStorage.setItem(cacheKey, JSON.stringify(coord)); } catch (_) {}
            }
          }
        } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 1050));
      }
      if (coord && coord.every(Number.isFinite)) CITY_COORDS[cityKey(g.c, g.uf)] = coord;
    }
    if (run === cityGeocodeRun) renderMap(readFilters());
  }

  function renderMapRanking(byCity, f) {
    const q = norm($('map-city-search') ? $('map-city-search').value : '');
    const keys = Object.keys(byCity).filter(k => !q || norm(byCity[k].label).includes(q));
    const metric = mapMetric === 'mrr' ? 'mrr' : 'total';
    keys.sort((a, b) => (byCity[b][metric] - byCity[a][metric]) || byCity[a].label.localeCompare(byCity[b].label, 'pt-BR'));
    const top = keys.slice(0, 15);
    $('map-ranking-count').textContent = `${num(keys.length)} cidades`;
    const max = top.reduce((m, k) => Math.max(m, byCity[k][metric]), 1);
    $('map-ranking').innerHTML = top.length ? top.map((k, i) => {
      const o = byCity[k], total = o.total, dom = mapDominant(o), selected = f.cities.size === 0 || f.cities.has(k);
      const value = metric === 'mrr' ? brl(o.mrr, 0) : num(total);
      const width = Math.max(5, (o[metric] / max) * 100);
      return `<button type="button" class="map-rank-row w-full text-left ${selected ? '' : 'opacity-50'}" data-map-city="${esc(k)}">
        <span class="text-[10px] text-slate-500 w-4 text-right">${i + 1}</span>
        <span class="map-rank-dot" style="background:${C[dom]}"></span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-xs font-semibold text-slate-200">${esc(o.label)}</span>
          <span class="block map-rank-bar mt-1"><span style="width:${width}%;background:${C[dom]}"></span></span>
        </span>
        <span class="text-xs font-semibold text-slate-300 whitespace-nowrap">${value}</span>
      </button>`;
    }).join('') : '<div class="p-6 text-center text-xs text-slate-500">Nenhuma cidade encontrada.</div>';

    $('map-ranking').querySelectorAll('[data-map-city]').forEach(btn => btn.addEventListener('click', () => {
      const k = btn.dataset.mapCity;
      const marker = mapMarkersByCity[k];
      if (marker) {
        map.setView(marker.getLatLng(), Math.max(map.getZoom(), 8), { animate: !reduceMotion() });
        marker.openPopup();
      }
    }));
  }

  function renderMap(f) {
    if (!window.L || !map) return;
    markersLayer.clearLayers();
    mapMarkersByCity = {};
    mapAddressMarkers = {};

    const byCity = {};
    cityContext.forEach(r => {
      const k = gkey(r.c, r.uf);
      const o = byCity[k] || (byCity[k] = { c: r.c, cl: r.cl, uf: r.uf, label: cityDisplay(r.cl, r.uf), a: 0, p: 0, i: 0, mrr: 0, total: 0 });
      o.total++;
      if (r.isAtivo) { o.a++; o.mrr += r.m; }
      else if (r.isPend) o.p++;
      else o.i++;
    });

    const keys = Object.keys(byCity);
    const maxTotal = keys.reduce((mx, k) => Math.max(mx, byCity[k].total), 1);
    const maxMrr = keys.reduce((mx, k) => Math.max(mx, byCity[k].mrr), 1);
    keys.forEach(k => { byCity[k]._maxTotal = maxTotal; byCity[k]._maxMrr = maxMrr; });

    const q = norm($('map-city-search') ? $('map-city-search').value : '');
    let semCoordTotal = 0, semCoordCidades = 0, mapped = 0, mappedMrr = 0, mappedActive = 0;
    const bounds = [];
    const addressRows = cityContext.filter(r => r.address);

    const missingGroups = keys.filter(k => !CITY_COORDS[cityKey(byCity[k].c, byCity[k].uf)]).map(k => byCity[k]);
    if (missingGroups.length || !cityCoordsReady) {
      $('mapa-sem-coord').textContent = `Carregando coordenadas dos municípios...`;
      geocodeCities(missingGroups);
    }

    keys.forEach(k => {
      const o = byCity[k], coord = CITY_COORDS[cityKey(o.c, o.uf)];
      if (!coord) { semCoordTotal += o.total; semCoordCidades++; return; }
      mapped += o.total; mappedMrr += o.mrr; mappedActive += o.a;
      bounds.push(coord);
      const selected = f.cities.size === 0 || f.cities.has(k);
      const searchHit = !!q && norm(o.label).includes(q);
      const marker = L.marker(coord, { icon: mapCityIcon(o, selected, searchHit), keyboard: true, title: o.label });
      marker.bindPopup(mapPopup(o.label, o), { closeButton: true, maxWidth: 300 });
      marker.on('click', () => {
        toggleCity(k);
        setTimeout(() => {
          const fresh = mapMarkersByCity[k];
          if (fresh) fresh.openPopup();
        }, 30);
      });
      marker.addTo(markersLayer);
      mapMarkersByCity[k] = marker;
    });

    // Além dos pontos por município, tenta localizar individualmente os endereços
    // que existem na planilha, em qualquer estado.
    geocodeMapAddresses(addressRows);

    $('map-stat-cities').textContent = num(keys.filter(k => CITY_COORDS[cityKey(byCity[k].c, byCity[k].uf)]).length);
    $('map-stat-clients').textContent = num(mapped);
    $('map-stat-mrr').textContent = brl(mappedMrr);
    $('map-stat-active').textContent = pct(mappedActive, mapped);
    if (!missingGroups.length && cityCoordsReady) {
      $('mapa-sem-coord').textContent = addressRows.length
        ? `${num(addressRows.length)} ${addressRows.length === 1 ? 'cliente possui' : 'clientes possuem'} endereço informado · localizando endereços...`
        : (semCoordCidades
          ? `${num(semCoordTotal)} ${semCoordTotal === 1 ? 'cliente' : 'clientes'} em ${semCoordCidades} ${semCoordCidades === 1 ? 'cidade' : 'cidades'} sem coordenada conhecida`
          : `${num(mapped)} clientes georreferenciados`);
    }

    renderMapRanking(byCity, f);

    if (bounds.length && !map._mapHasBeenFitted) {
      map.fitBounds(bounds, { padding: [35, 35], maxZoom: 8 });
      map._mapHasBeenFitted = true;
    }
  }

  function fitMap() {
    if (!map) return;
    const points = Object.values(mapMarkersByCity).map(m => m.getLatLng()).concat(Object.values(mapAddressMarkers).map(m => m.getLatLng()));
    if (points.length === 1) map.setView(points[0], 9);
    else if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [35,35], maxZoom: 8 });
    else map.setView([-14.2, -51.9], 4.3);
  }

  function setupMapControls() {
    if ($('map-fit')) $('map-fit').addEventListener('click', fitMap);
    if ($('map-center-go')) $('map-center-go').addEventListener('click', () => {
      if (map) map.setView([-14.2, -51.9], 4.3, { animate: !reduceMotion() });
    });
    if ($('map-clear-city')) $('map-clear-city').addEventListener('click', () => {
      view.cities = new Set();
      view.page = 1;
      applyFilters();
      if (map) fitMap();
    });
    if ($('map-city-search')) $('map-city-search').addEventListener('input', () => {
      if (map) renderMap(readFilters());
    });
    if ($('map-metric-clients')) $('map-metric-clients').addEventListener('click', () => {
      mapMetric = 'clients';
      $('map-metric-clients').setAttribute('aria-pressed','true');
      $('map-metric-mrr').setAttribute('aria-pressed','false');
      if (map) renderMap(readFilters());
    });
    if ($('map-metric-mrr')) $('map-metric-mrr').addEventListener('click', () => {
      mapMetric = 'mrr';
      $('map-metric-clients').setAttribute('aria-pressed','false');
      $('map-metric-mrr').setAttribute('aria-pressed','true');
      if (map) renderMap(readFilters());
    });
  }

  function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach(b => {
      const active = b.dataset.tab === name;
      b.setAttribute('aria-selected', String(active));
      b.tabIndex = active ? 0 : -1;
    });
    $('panel-geral').classList.toggle('hidden', name !== 'geral');
    $('panel-mapa').classList.toggle('hidden', name !== 'mapa');
    if (name === 'mapa') {
      initMap();
      renderMap(readFilters());
      setTimeout(() => { if (map) { map.invalidateSize(); fitMap(); } }, 80);
    }
  }

  /* ---------- Tabela ---------- */
  function getSearchedData() {
    const terms = norm($('table-search').value).split(/\s+/).filter(Boolean);
    const rows = terms.length ? filteredData.filter(r => terms.every(t => r._q.includes(t))) : filteredData.slice();
    const k = view.sortKey, d = view.sortDir;
    rows.sort((a, b) => {
      const va = a[k], vb = b[k];
      const r = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true });
      return (r || a.k - b.k) * d;
    });
    return rows;
  }

  const BADGE = {
    act: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    pend: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    exit: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    old: 'bg-slate-700/60 text-slate-300 border-slate-600'
  };
  const MONEY = { act: 'text-emerald-400', pend: 'text-amber-400', exit: 'text-slate-400', old: 'text-slate-400' };

  function updateSortHeaders() {
    document.querySelectorAll('th[data-th]').forEach(th => {
      const on = th.dataset.th === view.sortKey;
      th.setAttribute('aria-sort', on ? (view.sortDir === 1 ? 'ascending' : 'descending') : 'none');
      const icon = th.querySelector('i');
      icon.className = 'fa-solid text-[10px] ' + (on ? (view.sortDir === 1 ? 'fa-sort-up text-blue-300' : 'fa-sort-down text-blue-300') : 'fa-sort opacity-60');
    });
  }

  function renderTable() {
    const tbody = $('table-body');
    const rows = getSearchedData();
    const tot = rows.length;
    const maxPage = Math.ceil(tot / view.pageSize) || 1;
    if (view.page > maxPage) view.page = maxPage;
    const start = (view.page - 1) * view.pageSize;
    const paginated = rows.slice(start, start + view.pageSize);

    if (!paginated.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center p-8 text-slate-400">Nenhum cliente encontrado. <button type="button" class="text-blue-300 underline" data-action="reset">Redefinir filtros e busca</button></td></tr>';
    } else {
      tbody.innerHTML = paginated.map(r => `
        <tr class="hover:bg-slate-700/30 transition">
          <td class="p-3 font-mono text-slate-400">${esc(r.id)}</td>
          <td class="p-3 font-semibold text-white">${esc(r.n)}</td>
          <td class="p-3">${esc(cityDisplay(r.cl, r.uf))}</td>
          <td class="p-3"><span class="inline-block px-2 py-0.5 text-[11px] font-semibold rounded border ${BADGE[r.tone]}">${esc(r.sl)}</span></td>
          <td class="p-3">${esc(r.g)}</td>
          <td class="p-3">${esc(r.r)}</td>
          <td class="p-3 text-slate-400">${r.y || '-'}</td>
          <td class="p-3 text-right font-mono ${r.m > 0 ? MONEY[r.tone] : 'text-slate-500'}">${brl(r.m)}</td>
        </tr>`).join('');
    }

    $('table-info').textContent = tot ? `Exibindo ${start + 1} a ${start + paginated.length} de ${num(tot)} clientes` : 'Nenhum cliente';
    $('table-total-mensalidade').textContent = brl(rows.reduce((a, r) => a + r.m, 0));
    $('page-indicator').textContent = `Página ${view.page} de ${maxPage}`;
    $('btn-prev-page').disabled = view.page <= 1;
    $('btn-next-page').disabled = view.page >= maxPage;
    updateSortHeaders();
  }

  /* ---------- Exportar CSV ---------- */
  function exportCSV() {
    const rows = getSearchedData();
    if (!rows.length) { notify('Não há clientes para exportar com os filtros atuais.', 'info'); return; }
    // Aspas duplicadas e proteção contra fórmulas (=, +, -, @) ao abrir no Excel
    const cell = v => { let t = String(v == null ? '' : v); if (/^[=+\-@]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const headers = ['ID', 'Cliente', 'Cidade', 'UF', 'Situação', 'Grupo', 'Ramo', 'Cliente desde', 'Mensalidade'];
    const lines = rows.map(r => [cell(r.id), cell(r.n), cell(r.cl), cell(r.uf), cell(r.sl), cell(r.g), cell(r.r), r.y || '', r.m.toFixed(2).replace('.', ',')].join(';'));
    const blob = new Blob(['\uFEFF' + [headers.join(';')].concat(lines).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clientes_filtrados_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- Planilha: carregar e baixar modelo ---------- */
  function setSource(name, n) {
    $('source-name').textContent = name;
    $('source-count').textContent = n ? `(${num(n)} registros)` : '';
    $('source-name').title = name;
  }

  function handleFileUpload(e) {
    const input = e.target, file = input.files && input.files[0];
    if (!file) return;
    if (!window.XLSX) { notify('A biblioteca de leitura de Excel não carregou. Verifique a conexão e recarregue a página.', 'error'); input.value = ''; return; }
    const reader = new FileReader();
    reader.onerror = () => { notify('Não consegui ler o arquivo. Tente salvá-lo de novo como .xlsx.', 'error'); input.value = ''; };
    reader.onload = evt => {
      try {
        const wb = XLSX.read(new Uint8Array(evt.target.result), { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (!json.length) throw new Error('A primeira aba da planilha está vazia.');
        // Coluna B bruta de cada linha (posição, não nome): reserva para a Situação quando o cabeçalho não é reconhecido
        const raw2d = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        const colBValues = json.map((_, i) => (raw2d[i + 1] ? raw2d[i + 1][1] : ''));
        const headers = Object.keys(json[0]).map(norm);
        if (!ALIASES.n.some(a => headers.includes(a))) throw new Error('Não encontrei a coluna "Cliente". Confira se a primeira linha da planilha tem os nomes das colunas.');
        const hasStatusHeader = ALIASES.s.some(a => headers.includes(a));
        const hasStatusColB = colBValues.some(v => denull(v) !== '');
        if (!hasStatusHeader && !hasStatusColB) throw new Error('Não encontrei a coluna "Situação" nem dados na coluna B. A situação de cada cliente (ATIVO, FALTA ASSINAR, SEM PAGAR, SAIU AAAA...) precisa estar numa coluna chamada "Situação" ou na coluna B da planilha.');
        const rows = processData(json, colBValues);
        if (!rows.length) throw new Error('Nenhuma linha com dados foi encontrada.');

        dataset = rows;
        setSource(file.name, rows.length);
        populateDropdowns();
        $('table-search').value = '';
        view.page = 1; view.tone = null;
        applyFilters();
        if (!rows.some(r => r.isAtivo)) {
          notify('Carreguei os dados, mas nenhum cliente está como "ATIVO". Confira a coluna Situação (use ATIVO, FALTA ASSINAR, SEM PAGAR ou SAIU AAAA).', 'error');
        } else {
          notify(`${num(rows.length)} clientes carregados de ${file.name}.`, 'ok');
        }
      } catch (err) {
        notify(err.message || 'Não foi possível ler a planilha.', 'error');
      } finally {
        input.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /* ---------- Eventos ---------- */
  function setupListeners() {
    setupMapControls();
    document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

    ['filter-status', 'filter-situacao', 'filter-ramo', 'filter-grupo'].forEach(id => {
      $(id).addEventListener('change', () => { view.page = 1; applyFilters(); });
    });
    $('btn-reset-filters').addEventListener('click', resetFilters);

    $('btn-cidade').addEventListener('click', () => toggleCidadePanel());
    document.addEventListener('click', e => {
      if (!$('cidade-panel').classList.contains('hidden') && !e.target.closest('#cidade-wrap')) toggleCidadePanel(false);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') toggleCidadePanel(false); });
    $('cidade-search').addEventListener('input', () => {
      const q = norm($('cidade-search').value);
      $('cidade-list').querySelectorAll('.city-row').forEach(row => row.classList.toggle('hide', !(!q || row.dataset.search.includes(q))));
    });
    $('cidade-marcar-visiveis').addEventListener('click', () => {
      $('cidade-list').querySelectorAll('.city-row:not(.hide)').forEach(row => view.cities.add(row.dataset.city));
      view.page = 1; applyFilters();
    });
    $('cidade-limpar').addEventListener('click', () => { view.cities = new Set(); view.page = 1; applyFilters(); });

    document.querySelectorAll('[data-kpi]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.kpi === 'TODOS') { $('filter-status').value = 'TODOS'; view.page = 1; applyFilters(); }
      else toggleFilter('filter-status', b.dataset.kpi);
    }));

    document.querySelectorAll('[data-msort]').forEach(b => b.addEventListener('click', () => {
      view.mosaicSort = b.dataset.msort;
      document.querySelectorAll('[data-msort]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      renderMosaico();
    }));
    document.querySelectorAll('[data-metric]').forEach(b => b.addEventListener('click', () => {
      view.ramoMetric = b.dataset.metric;
      document.querySelectorAll('[data-metric]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      animate = false;
      renderCharts(readFilters());
    }));
    document.querySelectorAll('[data-tone]').forEach(b => b.addEventListener('click', () => {
      view.tone = view.tone === b.dataset.tone ? null : b.dataset.tone;
      applyHighlight();
    }));

    $('mosaico-container').addEventListener('click', e => {
      if (e.target.closest('[data-action="reset"]')) { resetFilters(); return; }
      const sq = e.target.closest('.sq');
      const r = sq && mosaicRows[+sq.dataset.i];
      if (!r) return;
      $('table-search').value = r.n;
      view.page = 1;
      renderTable();
      tip.hidden = true;
      $('tabela').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    });
    $('table-body').addEventListener('click', e => { if (e.target.closest('[data-action="reset"]')) resetFilters(); });
    $('notice').addEventListener('click', e => { if (e.target.closest('[data-action="close-notice"]')) hideNotice(); });

    document.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.sort;
      if (view.sortKey === k) view.sortDir *= -1; else { view.sortKey = k; view.sortDir = 1; }
      view.page = 1;
      renderTable();
    }));

    $('table-search').addEventListener('input', () => { view.page = 1; renderTable(); });
    $('page-size').addEventListener('change', e => { view.pageSize = +e.target.value; view.page = 1; renderTable(); });
    $('btn-prev-page').addEventListener('click', () => { if (view.page > 1) { view.page--; renderTable(); } });
    $('btn-next-page').addEventListener('click', () => {
      const maxPage = Math.ceil(getSearchedData().length / view.pageSize) || 1;
      if (view.page < maxPage) { view.page++; renderTable(); }
    });

    $('btn-export-csv').addEventListener('click', exportCSV);
    $('excel-file').addEventListener('change', handleFileUpload);
  }

  /* ---------- Início ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    setupChartDefaults();
    dataset = processData(DATA_RAW);
    setSource('Nenhuma base carregada', dataset.length);
    populateDropdowns();
    setupListeners();
    applyFilters();
    animate = false;
    if (!window.Chart) notify('Os gráficos não carregaram (biblioteca Chart.js indisponível). Verifique a conexão; o restante do painel segue funcionando.', 'error');
    // Redesenha os gráficos quando as fontes terminarem de carregar, para o texto do canvas sair na fonte certa
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => renderCharts(readFilters()));
  });

})();

// Modelo de planilha embutido no próprio arquivo para permitir o download
// sem depender de servidor ou arquivo externo.
const CLIENT_TEMPLATE_XLSX_BASE64 = "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";

function downloadClientTemplate() {
  const binary = atob(CLIENT_TEMPLATE_XLSX_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const blob = new Blob(
    [bytes],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modelo_planilha_clientes.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.getElementById('btn-download-template')?.addEventListener('click', downloadClientTemplate);
