"use strict";

const DATA_URL = window.DASHBOARD_DATA_URL || "data/sales_ads_dashboard_data.json";

const PAGE_CONFIG = {
  monthly_review: {
    title: "月度广告数据复盘看板",
    sections: [
      ["monthly-overview", "整体大盘"],
      ["monthly-category", "品类视角"],
      ["monthly-owner", "运营组长视角"],
    ],
  },
  invalid_low_efficiency: {
    title: "无效低效看板",
    sections: [
      ["invalid-analysis", "无效广告分析"],
      ["inefficient-analysis", "低效广告分析"],
      ["saving-analysis", "节约花费视角"],
      ["invalid-detail", "广告活动明细"],
    ],
  },
  lingxing_rules: {
    title: "领星规则看板",
    sections: [
      ["trigger-monitor", "规则触发监控"],
      ["saving-dashboard", "节费规则看板"],
      ["saving-detail", "节费规则触发明细"],
    ],
  },
  batch_launch: {
    title: "批量投放看板",
    sections: [
      ["batch-scale", "批量投放规模"],
      ["batch-coverage", "活动覆盖率"],
      ["batch-acos", "批量 ACOS 对比"],
      ["batch-summary", "批量投放汇总明细"],
    ],
  },
};

const state = {
  data: null,
  page: "monthly_review",
  filterDraft: {},
  filterApplied: {},
  searchDraft: {},
  searchApplied: {},
  pagination: {},
  ui: {
    monthlyCategoryTab: "all",
    invalidDetailTab: "all",
    batchSummaryTab: "category",
  },
};

const root = document.getElementById("page-root");
const loading = document.getElementById("loading-state");
const errorState = document.getElementById("error-state");
const dataStatus = document.getElementById("data-status");
const subnav = document.getElementById("subnav");
const pageTitle = document.getElementById("page-title");

const numberFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + asNumber(row[field]), 0);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((asNumber(value) + Number.EPSILON) * factor) / factor;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return escapeHtml(value);
  if (digits === 0) return integerFormatter.format(number);
  return number.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatCompact(value) {
  const number = asNumber(value);
  const absolute = Math.abs(number);
  if (absolute >= 100000000) return `${round(number / 100000000, 1)}亿`;
  if (absolute >= 10000) return `${round(number / 10000, 1)}万`;
  return formatNumber(number, absolute >= 100 ? 0 : 2);
}

function formatCurrency(value, compact = false) {
  const number = asNumber(value);
  if (compact && Math.abs(number) >= 10000) return `$${formatCompact(number)}`;
  return currencyFormatter.format(number);
}

function formatPercent(value, fraction = false, digits = 2) {
  const number = asNumber(value) * (fraction ? 100 : 1);
  return `${formatNumber(number, digits)}%`;
}

function safeDivide(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function changeRate(current, previous) {
  return previous ? (current - previous) / Math.abs(previous) : current ? null : 0;
}

function formatChange(current, previous, format = "number", inverse = false) {
  const delta = asNumber(current) - asNumber(previous);
  const rate = changeRate(current, previous);
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "neutral";
  const favorable = inverse ? delta < 0 : delta > 0;
  const className = direction === "neutral" ? "is-neutral" : favorable ? "is-good" : "is-bad";
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  let deltaText = formatNumber(Math.abs(delta), 2);
  if (format === "currency") deltaText = formatCurrency(Math.abs(delta));
  if (format === "percent") deltaText = `${formatNumber(Math.abs(delta), 2)} 个百分点`;
  const rateText = rate === null ? "新增" : formatPercent(Math.abs(rate), true, 1);
  return `<span class="delta ${className}">${arrow} ${deltaText} (${rateText})</span>`;
}

function kpiCard({ label, value, previous, valueType = "number", tone = "primary", inverse = false, note = "较上月" }) {
  let display = formatNumber(value, 2);
  if (valueType === "integer") display = formatNumber(value, 0);
  if (valueType === "currency") display = formatCurrency(value, true);
  if (valueType === "percent") display = formatPercent(value, false, 2);
  if (valueType === "fractionPercent") display = formatPercent(value, true, 2);
  const compare = previous === undefined || previous === null
    ? note
    : `${note} ${formatChange(value, previous, valueType === "fractionPercent" ? "number" : valueType, inverse)}`;
  return `
    <article class="kpi-card" data-tone="${escapeHtml(tone)}">
      <p class="kpi-card__label">${escapeHtml(label)}</p>
      <p class="kpi-card__value">${display}</p>
      <p class="kpi-card__compare">${compare}</p>
    </article>`;
}

function introMarkup(title, description, period = "2026年5月 vs 6月") {
  return `
    <div class="page-intro">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </div>
      <span class="period-badge">${escapeHtml(period)}</span>
    </div>`;
}

function sectionHead(title, description = "", meta = "") {
  return `
    <div class="section-head">
      <div>
        <h3>${escapeHtml(title)}</h3>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
      </div>
      ${meta ? `<span class="section-meta">${escapeHtml(meta)}</span>` : ""}
    </div>`;
}

function emptyState(message = "当前筛选条件下暂无数据") {
  return `<div class="empty-state"><div><strong>暂无结果</strong>${escapeHtml(message)}</div></div>`;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))]
    .sort((a, b) => String(a).localeCompare(String(b), "zh-CN"));
}

function cloneSet(set) {
  return new Set([...set]);
}

function initializeFilters(pageId, configs) {
  if (state.filterDraft[pageId]) return;
  state.filterDraft[pageId] = {};
  state.filterApplied[pageId] = {};
  configs.forEach((config) => {
    const values = unique(config.options);
    state.filterDraft[pageId][config.id] = new Set(values);
    state.filterApplied[pageId][config.id] = new Set(values);
  });
  state.searchDraft[pageId] = "";
  state.searchApplied[pageId] = "";
}

function selectedSet(pageId, id, draft = false) {
  const source = draft ? state.filterDraft : state.filterApplied;
  return source[pageId]?.[id] || new Set();
}

function isAllSelected(pageId, config, draft = false) {
  return selectedSet(pageId, config.id, draft).size === unique(config.options).length;
}

function selectedLabel(pageId, config) {
  const set = selectedSet(pageId, config.id, true);
  const total = unique(config.options).length;
  if (set.size === total) return "全部";
  if (set.size === 0) return "已清除";
  if (set.size === 1) return [...set][0];
  return `已选 ${set.size} 项`;
}

function filterMarkup(pageId, configs, searchConfig = null, note = "") {
  initializeFilters(pageId, configs);
  const fields = configs.map((config) => {
    const options = unique(config.options);
    const selected = selectedSet(pageId, config.id, true);
    return `
      <div class="filter-field">
        <span class="filter-field__label">${escapeHtml(config.label)}</span>
        <div class="multi-select" data-filter-id="${escapeHtml(config.id)}">
          <button type="button" class="multi-select__button" aria-expanded="false">
            ${escapeHtml(selectedLabel(pageId, config))}
          </button>
          <div class="multi-select__menu is-hidden">
            <div class="multi-select__tools">
              <button type="button" class="link-button" data-select-action="all">全选</button>
              <button type="button" class="link-button" data-select-action="clear">清除</button>
            </div>
            <div class="multi-select__options">
              ${options.map((option) => `
                <label class="check-option">
                  <input type="checkbox" value="${escapeHtml(option)}" ${selected.has(option) ? "checked" : ""} />
                  <span>${escapeHtml(option)}</span>
                </label>`).join("")}
            </div>
          </div>
        </div>
      </div>`;
  }).join("");

  const search = searchConfig ? `
    <div class="filter-field">
      <label for="${pageId}-search">${escapeHtml(searchConfig.label)}</label>
      <input class="search-input" id="${pageId}-search" type="search"
        placeholder="${escapeHtml(searchConfig.placeholder || "输入关键词")}" value="${escapeHtml(state.searchDraft[pageId] || "")}" />
    </div>` : "";

  return `
    <section class="filter-panel" data-page-filter="${pageId}">
      <div class="filter-panel__head">
        <h3>数据筛选</h3>
        <span class="filter-summary">${escapeHtml(note)}</span>
      </div>
      <div class="filter-grid">
        ${fields}
        ${search}
        <div class="filter-actions">
          <button type="button" class="button button--primary" data-filter-query>查询</button>
          <button type="button" class="button" data-filter-reset>重置</button>
        </div>
      </div>
    </section>`;
}

function rowMatches(pageId, row, mapping) {
  return Object.entries(mapping).every(([filterId, field]) => {
    const set = selectedSet(pageId, filterId);
    return set.size > 0 && set.has(row[field]);
  });
}

function allFiltersAtDefault(pageId, configs) {
  return configs.every((config) => isAllSelected(pageId, config));
}

function searchMatches(pageId, row, fields) {
  const query = (state.searchApplied[pageId] || "").trim().toLowerCase();
  if (!query) return true;
  return fields.some((field) => String(row[field] ?? "").toLowerCase().includes(query));
}

function legendMarkup(previousLabel = "5月", currentLabel = "6月") {
  return `<div class="legend">
    <span class="legend-item"><i class="legend-swatch"></i>${escapeHtml(previousLabel)}</span>
    <span class="legend-item"><i class="legend-swatch is-current"></i>${escapeHtml(currentLabel)}</span>
  </div>`;
}

function compareList(rows, options = {}) {
  if (!rows.length) return emptyState();
  const previousVisible = options.previousVisible !== false;
  const currentVisible = options.currentVisible !== false;
  return `<div class="compare-list">${rows.map((row) => {
    const previous = asNumber(row.previous);
    const current = asNumber(row.current);
    const max = Math.max(Math.abs(previous), Math.abs(current), 1);
    const formatter = row.formatter || ((value) => formatNumber(value, 2));
    return `
      <div class="compare-row">
        <div class="compare-row__label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</div>
        <div class="compare-bars">
          ${previousVisible ? `<div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, Math.abs(previous) / max * 100))}%"></div></div>` : ""}
          ${currentVisible ? `<div class="bar-track"><div class="bar-fill is-current" style="width:${Math.max(0, Math.min(100, Math.abs(current) / max * 100))}%"></div></div>` : ""}
        </div>
        <div class="compare-values">
          ${previousVisible ? `<span>${formatter(previous)}</span>` : ""}
          ${currentVisible ? `<strong>${formatter(current)}</strong>` : ""}
        </div>
      </div>`;
  }).join("")}</div>`;
}

function verticalCompareChart(rows, options = {}) {
  if (!rows.length) return emptyState();
  const previousVisible = options.previousVisible !== false;
  const currentVisible = options.currentVisible !== false;
  const values = rows.flatMap((row) => [asNumber(row.previous), asNumber(row.current)]);
  const max = Math.max(...values.map(Math.abs), 1);
  const formatter = options.formatter || ((value) => formatCompact(value));
  return `<div class="vertical-chart">${rows.map((row) => {
    const previous = asNumber(row.previous);
    const current = asNumber(row.current);
    return `
      <div class="vertical-group">
        <div class="vertical-bars">
          ${previousVisible ? `<div class="vertical-bar" style="height:${Math.max(2, Math.abs(previous) / max * 100)}%"><span>${formatter(previous)}</span></div>` : ""}
          ${currentVisible ? `<div class="vertical-bar is-current" style="height:${Math.max(2, Math.abs(current) / max * 100)}%"><span>${formatter(current)}</span></div>` : ""}
        </div>
        <div class="vertical-group__label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</div>
      </div>`;
  }).join("")}</div>`;
}

function horizontalBarChart(rows, options = {}) {
  if (!rows.length) return emptyState();
  const max = options.max || Math.max(...rows.map((row) => Math.abs(asNumber(row.value))), 1);
  const formatter = options.formatter || ((value) => formatNumber(value, 2));
  return `<div class="hbar-chart">${rows.map((row) => `
    <div class="hbar-row">
      <div class="hbar-row__label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(0, Math.min(100, Math.abs(asNumber(row.value)) / max * 100))}%"></div></div>
      <div class="hbar-value">${formatter(row.value)}</div>
    </div>`).join("")}</div>`;
}

function dumbbellChart(rows, options = {}) {
  if (!rows.length) return emptyState();
  const allValues = rows.flatMap((row) => [asNumber(row.previous), asNumber(row.current)]);
  const min = options.min ?? Math.min(0, ...allValues);
  const max = options.max ?? Math.max(...allValues, 1);
  const range = max - min || 1;
  const formatter = options.formatter || ((value) => formatNumber(value, 2));
  return `<div class="dumbbell-chart">${rows.map((row) => {
    const previous = asNumber(row.previous);
    const current = asNumber(row.current);
    const previousPos = (previous - min) / range * 100;
    const currentPos = (current - min) / range * 100;
    const left = Math.min(previousPos, currentPos);
    const width = Math.abs(previousPos - currentPos);
    return `
      <div class="dumbbell-row">
        <div class="dumbbell-row__label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</div>
        <div class="dumbbell-track">
          <span class="dumbbell-line" style="left:${left}%;width:${width}%"></span>
          <span class="dumbbell-dot" style="left:${previousPos}%"></span>
          <span class="dumbbell-dot is-current" style="left:${currentPos}%"></span>
        </div>
        <div class="dumbbell-values"><span>${formatter(previous)}</span><span>${formatter(current)}</span></div>
      </div>`;
  }).join("")}</div>`;
}

function segmentControl(id, options, active) {
  return `<div class="segment-control" data-segment="${escapeHtml(id)}">${options.map(([value, label]) => `
    <button type="button" class="segment-button ${value === active ? "is-active" : ""}" data-segment-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join("")}</div>`;
}

function tagMarkup(value) {
  const text = String(value ?? "-");
  let className = "";
  if (["异常升高", "无效", "广告活动超预算", "广告组合超预算"].includes(text)) className = "is-danger";
  if (["触发偏低", "低效", "广告活动已暂停"].includes(text)) className = "is-warning";
  if (["正常", "投放中"].includes(text)) className = "is-good";
  return `<span class="tag ${className}">${escapeHtml(text)}</span>`;
}

function tableMarkup(id, rows, columns, pageSize = 50) {
  if (!rows.length) return `<div class="table-shell">${emptyState()}</div>`;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(state.pagination[id] || 1, totalPages);
  state.pagination[id] = currentPage;
  const start = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const head = columns.map((column) => `<th class="${column.numeric ? "cell-number" : ""}">${escapeHtml(column.label)}</th>`).join("");
  const body = pageRows.map((row) => `<tr>${columns.map((column) => {
    let content;
    if (column.render) content = column.render(row[column.field], row);
    else content = escapeHtml(row[column.field] ?? "-");
    const classes = [column.numeric ? "cell-number" : "", column.long ? "cell-long" : ""].filter(Boolean).join(" ");
    return `<td class="${classes}">${content}</td>`;
  }).join("")}</tr>`).join("");
  return `
    <div class="table-shell" data-table-id="${escapeHtml(id)}">
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <div class="table-footer">
        <span>共 ${formatNumber(rows.length, 0)} 条，第 ${currentPage} / ${totalPages} 页</span>
        <div class="pagination">
          <button type="button" class="page-button" data-page-action="prev" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
          <button type="button" class="page-button" data-page-action="next" ${currentPage >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
      </div>
    </div>`;
}

function aggregateBy(rows, keyField, aggregators) {
  const map = new Map();
  rows.forEach((row) => {
    const key = row[keyField] || "未分类";
    if (!map.has(key)) map.set(key, { [keyField]: key });
    const target = map.get(key);
    Object.entries(aggregators).forEach(([name, getter]) => {
      target[name] = asNumber(target[name]) + asNumber(getter(row));
    });
  });
  return [...map.values()];
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 1800);
}

function monthlyFilterConfig(data) {
  return [
    { id: "category", label: "业务品类", options: data.filters?.品类 || data.category_overview.map((row) => row.品类) },
    { id: "owner", label: "运营组长", options: data.filters?.运营组长 || data.category_overview.map((row) => row.运营组长) },
  ];
}

function monthlyDataModel(data, configs) {
  const currentRows = data.category_overview.filter((row) => rowMatches("monthly_review", row, {
    category: "品类",
    owner: "运营组长",
  }));
  const compareRows = data.category_compare.filter((row) => rowMatches("monthly_review", row, {
    category: "品类",
    owner: "运营组长",
  }));
  const current = {
    impressions: sum(currentRows, "总曝光量"),
    clicks: sum(currentRows, "总点击量"),
    spend: sum(currentRows, "总花费"),
    sales: sum(currentRows, "总销售额"),
    orders: sum(currentRows, "总订单量"),
  };
  const previous = compareRows.reduce((metrics, row) => {
    const spend = asNumber(row["上月_总花费"]);
    const acos = asNumber(row["上月_ACoS(%)"]);
    const cpc = asNumber(row["上月_CPC"]);
    metrics.impressions += asNumber(row["上月_总曝光量"]);
    metrics.clicks += cpc ? spend / cpc : 0;
    metrics.spend += spend;
    metrics.sales += acos ? spend / (acos / 100) : 0;
    metrics.orders += asNumber(row["上月_总订单量"]);
    return metrics;
  }, { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 });

  const overview = Object.fromEntries(data.overview.map((row) => [row.指标, row]));
  if (allFiltersAtDefault("monthly_review", configs)) {
    previous.impressions = asNumber(overview.总曝光量?.上月);
    current.impressions = asNumber(overview.总曝光量?.本月);
    previous.clicks = asNumber(overview.总点击量?.上月);
    current.clicks = asNumber(overview.总点击量?.本月);
    previous.spend = asNumber(overview.总花费?.上月);
    current.spend = asNumber(overview.总花费?.本月);
    previous.sales = asNumber(overview.总销售额?.上月);
    current.sales = asNumber(overview.总销售额?.本月);
    previous.orders = asNumber(overview.总订单量?.上月);
    current.orders = asNumber(overview.总订单量?.本月);
  }

  [previous, current].forEach((metrics) => {
    metrics.ctr = safeDivide(metrics.clicks, metrics.impressions) * 100;
    metrics.cpc = safeDivide(metrics.spend, metrics.clicks);
    metrics.acos = safeDivide(metrics.spend, metrics.sales) * 100;
    metrics.cvr = safeDivide(metrics.orders, metrics.clicks) * 100;
    metrics.cpa = safeDivide(metrics.spend, metrics.orders);
  });
  if (allFiltersAtDefault("monthly_review", configs)) {
    previous.ctr = asNumber(overview["CTR(%)"]?.上月);
    current.ctr = asNumber(overview["CTR(%)"]?.本月);
    previous.cpc = asNumber(overview.CPC?.上月);
    current.cpc = asNumber(overview.CPC?.本月);
    previous.acos = asNumber(overview["ACoS(%)"]?.上月);
    current.acos = asNumber(overview["ACoS(%)"]?.本月);
    previous.cvr = asNumber(overview["CVR(%)"]?.上月);
    current.cvr = asNumber(overview["CVR(%)"]?.本月);
  }
  return { currentRows, compareRows, current, previous };
}

function monthlyCategoryRows(model) {
  const currentMap = new Map(model.currentRows.map((row) => [row.品类, row]));
  return model.compareRows.map((row) => {
    const current = currentMap.get(row.品类) || {};
    const previousSpend = asNumber(row["上月_总花费"]);
    const previousAcos = asNumber(row["上月_ACoS(%)"]);
    return {
      品类: row.品类,
      运营组长: row.运营组长,
      上月花费: previousSpend,
      本月花费: asNumber(row["本月_总花费"]),
      上月销售额: previousAcos ? previousSpend / (previousAcos / 100) : 0,
      本月销售额: asNumber(current.总销售额),
      上月订单量: asNumber(row["上月_总订单量"]),
      本月订单量: asNumber(row["本月_总订单量"]),
      上月ACOS: previousAcos,
      本月ACOS: asNumber(row["本月_ACoS(%)"]),
      上月CPC: asNumber(row["上月_CPC"]),
      本月CPC: asNumber(row["本月_CPC"]),
      上月CVR: asNumber(row["上月_CVR(%)"]),
      本月CVR: asNumber(row["本月_CVR(%)"]),
    };
  });
}

function renderMonthly() {
  const data = state.data.monthly_review;
  const configs = monthlyFilterConfig(data);
  initializeFilters("monthly_review", configs);
  const model = monthlyDataModel(data, configs);
  const categoryRows = monthlyCategoryRows(model);
  const hasData = model.currentRows.length > 0 || model.compareRows.length > 0;
  const kpis = hasData ? [
    kpiCard({ label: "总花费", value: model.current.spend, previous: model.previous.spend, valueType: "currency", tone: "primary", inverse: true }),
    kpiCard({ label: "总销售额", value: model.current.sales, previous: model.previous.sales, valueType: "currency", tone: "teal" }),
    kpiCard({ label: "总订单量", value: model.current.orders, previous: model.previous.orders, valueType: "integer", tone: "orange" }),
    kpiCard({ label: "ACoS", value: model.current.acos, previous: model.previous.acos, valueType: "percent", tone: "red", inverse: true }),
    kpiCard({ label: "CTR", value: model.current.ctr, previous: model.previous.ctr, valueType: "percent", tone: "green" }),
  ].join("") : emptyState();

  const volumeRows = [
    { label: "总花费", previous: model.previous.spend, current: model.current.spend, formatter: (v) => formatCurrency(v, true) },
    { label: "总销售额", previous: model.previous.sales, current: model.current.sales, formatter: (v) => formatCurrency(v, true) },
    { label: "总订单量", previous: model.previous.orders, current: model.current.orders, formatter: (v) => formatNumber(v, 0) },
    { label: "总点击量", previous: model.previous.clicks, current: model.current.clicks, formatter: (v) => formatCompact(v) },
    { label: "总曝光量", previous: model.previous.impressions, current: model.current.impressions, formatter: (v) => formatCompact(v) },
  ];
  const efficiencyRows = [
    { label: "CTR", previous: model.previous.ctr, current: model.current.ctr, formatter: (v) => formatPercent(v) },
    { label: "CVR", previous: model.previous.cvr, current: model.current.cvr, formatter: (v) => formatPercent(v) },
    { label: "ACoS", previous: model.previous.acos, current: model.current.acos, formatter: (v) => formatPercent(v) },
    { label: "CPC", previous: model.previous.cpc, current: model.current.cpc, formatter: (v) => formatCurrency(v) },
    { label: "CPA", previous: model.previous.cpa, current: model.current.cpa, formatter: (v) => formatCurrency(v) },
  ];

  const sortedBySpend = [...categoryRows].sort((a, b) => b.本月花费 - a.本月花费);
  const topCategories = sortedBySpend.slice(0, 15);
  let categoryChart = "";
  let categoryTitle = "重点品类花费与销售额";
  if (state.ui.monthlyCategoryTab === "spend") {
    categoryTitle = "品类广告花费对比";
    categoryChart = verticalCompareChart(topCategories.map((row) => ({ label: row.品类, previous: row.上月花费, current: row.本月花费 })), { formatter: (v) => formatCurrency(v, true) });
  } else if (state.ui.monthlyCategoryTab === "sales") {
    categoryTitle = "品类广告销售额对比";
    categoryChart = verticalCompareChart([...categoryRows].sort((a, b) => b.本月销售额 - a.本月销售额).slice(0, 15).map((row) => ({ label: row.品类, previous: row.上月销售额, current: row.本月销售额 })), { formatter: (v) => formatCurrency(v, true) });
  } else if (state.ui.monthlyCategoryTab === "share") {
    categoryTitle = "本月品类花费占比";
    const totalSpend = sum(categoryRows, "本月花费");
    categoryChart = horizontalBarChart(topCategories.map((row) => ({ label: row.品类, value: safeDivide(row.本月花费, totalSpend) })), { max: 1, formatter: (v) => formatPercent(v, true) });
  } else {
    categoryChart = `<div class="chart-grid">
      <div>${verticalCompareChart(topCategories.slice(0, 10).map((row) => ({ label: row.品类, previous: row.上月花费, current: row.本月花费 })), { formatter: (v) => formatCurrency(v, true) })}</div>
      <div>${dumbbellChart(topCategories.slice(0, 10).map((row) => ({ label: row.品类, previous: row.上月ACOS, current: row.本月ACOS })), { formatter: (v) => formatPercent(v) })}</div>
    </div>`;
  }

  const ownerRows = aggregateBy(categoryRows, "运营组长", {
    上月花费: (row) => row.上月花费,
    本月花费: (row) => row.本月花费,
    上月销售额: (row) => row.上月销售额,
    本月销售额: (row) => row.本月销售额,
    上月订单量: (row) => row.上月订单量,
    本月订单量: (row) => row.本月订单量,
  }).map((row) => ({
    ...row,
    上月ACOS: safeDivide(row.上月花费, row.上月销售额) * 100,
    本月ACOS: safeDivide(row.本月花费, row.本月销售额) * 100,
    花费环比: changeRate(row.本月花费, row.上月花费),
  })).sort((a, b) => b.本月花费 - a.本月花费);

  const categoryColumns = [
    { field: "品类", label: "品类" },
    { field: "运营组长", label: "运营组长" },
    { field: "上月花费", label: "5月花费", numeric: true, render: (v) => formatCurrency(v) },
    { field: "本月花费", label: "6月花费", numeric: true, render: (v) => formatCurrency(v) },
    { field: "上月销售额", label: "5月销售额", numeric: true, render: (v) => formatCurrency(v) },
    { field: "本月销售额", label: "6月销售额", numeric: true, render: (v) => formatCurrency(v) },
    { field: "上月订单量", label: "5月订单", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "本月订单量", label: "6月订单", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "上月ACOS", label: "5月 ACoS", numeric: true, render: (v) => formatPercent(v) },
    { field: "本月ACOS", label: "6月 ACoS", numeric: true, render: (v) => formatPercent(v) },
  ];
  const ownerColumns = [
    { field: "运营组长", label: "运营组长" },
    { field: "本月花费", label: "6月花费", numeric: true, render: (v) => formatCurrency(v) },
    { field: "本月销售额", label: "6月销售额", numeric: true, render: (v) => formatCurrency(v) },
    { field: "本月订单量", label: "6月订单", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "本月ACOS", label: "6月 ACoS", numeric: true, render: (v) => formatPercent(v) },
    { field: "花费环比", label: "花费环比", numeric: true, render: (v) => v === null ? "新增" : formatPercent(v, true) },
  ];

  root.innerHTML = `
    ${introMarkup("月度广告数据复盘", "整体规模、效率变化及品类与运营组长表现，用于月度经营复盘。")}
    <div class="kpi-grid">${kpis}</div>
    ${filterMarkup("monthly_review", configs, null, `${model.currentRows.length} 个品类`) }
    <section class="dashboard-section" id="monthly-overview">
      ${sectionHead("整体大盘", "规模与效率指标分别比较，避免不同单位混在同一坐标中。", "5月 vs 6月")}
      <div class="chart-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>规模指标对比</h4><p>花费、销售、订单、点击与曝光</p></div>${legendMarkup()}</div>
          ${hasData ? compareList(volumeRows) : emptyState()}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>效率指标对比</h4><p>CTR、CVR、ACoS、CPC 与 CPA</p></div>${legendMarkup()}</div>
          ${hasData ? compareList(efficiencyRows) : emptyState()}
        </div>
      </div>
    </section>
    <section class="dashboard-section" id="monthly-category">
      ${sectionHead("品类视角", "查看重点品类的花费、销售额、花费占比和 ACoS 变化。", `${categoryRows.length} 个品类`)}
      <div class="chart-title-row">
        <div><h4>${escapeHtml(categoryTitle)}</h4></div>
        ${segmentControl("monthly-category", [["all", "全部"], ["spend", "花费对比"], ["sales", "销售额对比"], ["share", "花费占比"]], state.ui.monthlyCategoryTab)}
      </div>
      <div class="chart-panel chart-panel--full">${categoryChart}</div>
      <div style="height:14px"></div>
      ${tableMarkup("monthly-category-table", sortedBySpend, categoryColumns, 30)}
    </section>
    <section class="dashboard-section" id="monthly-owner">
      ${sectionHead("运营组长视角", "按运营组长汇总负责品类的花费、销售、订单与 ACoS。", `${ownerRows.length} 位运营组长`)}
      <div class="chart-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>广告花费对比</h4></div>${legendMarkup()}</div>
          ${verticalCompareChart(ownerRows.map((row) => ({ label: row.运营组长, previous: row.上月花费, current: row.本月花费 })), { formatter: (v) => formatCurrency(v, true) })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>ACoS 对比</h4></div>${legendMarkup()}</div>
          ${dumbbellChart(ownerRows.map((row) => ({ label: row.运营组长, previous: row.上月ACOS, current: row.本月ACOS })), { formatter: (v) => formatPercent(v) })}
        </div>
      </div>
      <div style="height:14px"></div>
      ${tableMarkup("monthly-owner-table", ownerRows, ownerColumns, 30)}
    </section>`;
}

function invalidFilterConfig(data) {
  return [
    { id: "category", label: "品类", options: data.filters.品类 || [] },
    { id: "owner", label: "运营组长", options: data.filters.运营组长 || [] },
    { id: "adType", label: "广告类型", options: data.filters.广告类型 || [] },
    { id: "service", label: "服务状态", options: data.filters.服务状态 || [] },
  ];
}

function filterInvalidDetail(rows) {
  return rows.filter((row) => rowMatches("invalid_low_efficiency", row, {
    category: "父标签",
    owner: "运营组长",
    adType: "类型",
    service: "服务状态",
  }) && searchMatches("invalid_low_efficiency", row, ["广告活动", "广告组合", "标签"]));
}

function renderInvalid() {
  const data = state.data.invalid_low_efficiency;
  const configs = invalidFilterConfig(data);
  initializeFilters("invalid_low_efficiency", configs);
  const invalidRows = filterInvalidDetail(data.invalid_details || []);
  const inefficientRows = filterInvalidDetail(data.inefficient_details || []);
  const savingDimensionDefault = isAllSelected("invalid_low_efficiency", configs[0]) && isAllSelected("invalid_low_efficiency", configs[1]);
  const filteredSavingsCategory = (data.savings_by_category || []).filter((row) => {
    if (savingDimensionDefault) return true;
    const categorySet = selectedSet("invalid_low_efficiency", "category");
    const ownerSet = selectedSet("invalid_low_efficiency", "owner");
    return categorySet.size > 0 && ownerSet.size > 0 && categorySet.has(row.父标签) && ownerSet.has(row.运营组长);
  });
  const filteredSavingsOwner = (data.savings_by_owner || []).filter((row) => savingDimensionDefault || selectedSet("invalid_low_efficiency", "owner").has(row.运营组长));
  const invalidSpend = sum(invalidRows, "花费");
  const inefficientSpend = sum(inefficientRows, "花费");
  const saving = savingDimensionDefault
    ? asNumber(data.totals["本月节约总广告花费"])
    : sum(filteredSavingsCategory, "节约广告花费");
  const totalSpend = asNumber(data.totals["本月总花费"]);
  const categoryInvalid = aggregateBy(invalidRows, "父标签", {
    广告活动数量: () => 1,
    总花费: (row) => row.花费,
    总曝光量: (row) => row.曝光量,
    总点击: (row) => row.点击,
  }).sort((a, b) => b.总花费 - a.总花费);
  const categoryInefficient = aggregateBy(inefficientRows, "父标签", {
    广告活动数量: () => 1,
    总花费: (row) => row.花费,
    总广告销售额: (row) => row.广告销售额,
    总广告订单: (row) => row.广告订单,
  }).map((row) => ({ ...row, 平均ACoS: safeDivide(row.总花费, row.总广告销售额) * 100 })).sort((a, b) => b.总花费 - a.总花费);

  let detailRows = [];
  if (state.ui.invalidDetailTab !== "inefficient") detailRows.push(...invalidRows);
  if (state.ui.invalidDetailTab !== "invalid") detailRows.push(...inefficientRows);
  detailRows = detailRows.sort((a, b) => asNumber(b.花费) - asNumber(a.花费));

  const detailColumns = [
    { field: "复盘标签", label: "复盘标签", render: (v) => tagMarkup(v) },
    { field: "父标签", label: "品类" },
    { field: "运营组长", label: "运营组长" },
    { field: "类型", label: "广告类型" },
    { field: "服务状态", label: "服务状态", render: (v) => tagMarkup(v) },
    { field: "广告活动", label: "广告活动", long: true },
    { field: "花费", label: "花费", numeric: true, render: (v) => formatCurrency(v) },
    { field: "曝光量", label: "曝光量", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "点击", label: "点击", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "广告订单", label: "广告订单", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "广告销售额", label: "广告销售额", numeric: true, render: (v) => formatCurrency(v) },
    { field: "ACoS", label: "ACoS", numeric: true },
  ];

  root.innerHTML = `
    ${introMarkup("无效低效广告复盘", "按既有清洗结果查看无效、低效广告活动及可节约花费，不在前端重新判定。", "2026年6月")}
    <div class="kpi-grid kpi-grid--six">
      ${kpiCard({ label: "无效广告活动", value: invalidRows.length, valueType: "integer", tone: "red", note: `花费 ${formatCurrency(invalidSpend)}` })}
      ${kpiCard({ label: "低效广告活动", value: inefficientRows.length, valueType: "integer", tone: "orange", note: `花费 ${formatCurrency(inefficientSpend)}` })}
      ${kpiCard({ label: "节约广告花费", value: saving, valueType: "currency", tone: "green", note: "按品类与运营组长筛选" })}
      ${kpiCard({ label: "节约占总花费比例", value: safeDivide(saving, totalSpend) * 100, valueType: "percent", tone: "teal", note: `本月总花费 ${formatCurrency(totalSpend, true)}` })}
      ${kpiCard({ label: "关停/归档活动", value: data.totals["本月关停/归档广告活动数量"], valueType: "integer", tone: "primary", note: "本月汇总口径" })}
      ${kpiCard({ label: "无效与低效花费", value: invalidSpend + inefficientSpend, valueType: "currency", tone: "orange", note: "当前筛选范围" })}
    </div>
    ${filterMarkup("invalid_low_efficiency", configs, { label: "广告活动关键词", placeholder: "搜索广告活动、广告组合或标签" }, `${invalidRows.length + inefficientRows.length} 条活动`)}
    <section class="dashboard-section" id="invalid-analysis">
      ${sectionHead("无效广告分析", "有花费无销售额的广告活动，沿用源表复盘标签。", `${invalidRows.length} 条`)}
      <div class="chart-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>无效花费 Top 品类</h4></div></div>
          ${horizontalBarChart(categoryInvalid.slice(0, 12).map((row) => ({ label: row.父标签, value: row.总花费 })), { formatter: (v) => formatCurrency(v, true) })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>无效活动数量 Top 品类</h4></div></div>
          ${horizontalBarChart([...categoryInvalid].sort((a, b) => b.广告活动数量 - a.广告活动数量).slice(0, 12).map((row) => ({ label: row.父标签, value: row.广告活动数量 })), { formatter: (v) => formatNumber(v, 0) })}
        </div>
      </div>
    </section>
    <section class="dashboard-section" id="inefficient-analysis">
      ${sectionHead("低效广告分析", "有订单但 ACoS 偏高的广告活动，沿用源表复盘标签。", `${inefficientRows.length} 条`)}
      <div class="chart-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>低效花费 Top 品类</h4></div></div>
          ${horizontalBarChart(categoryInefficient.slice(0, 12).map((row) => ({ label: row.父标签, value: row.总花费 })), { formatter: (v) => formatCurrency(v, true) })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>低效品类 ACoS</h4></div></div>
          ${horizontalBarChart([...categoryInefficient].sort((a, b) => b.平均ACoS - a.平均ACoS).slice(0, 12).map((row) => ({ label: row.父标签, value: row.平均ACoS })), { formatter: (v) => formatPercent(v) })}
        </div>
      </div>
    </section>
    <section class="dashboard-section" id="saving-analysis">
      ${sectionHead("节约花费视角", "节约花费来源表仅包含品类和运营组长维度，因此本区块不受广告类型与服务状态筛选影响。", `${filteredSavingsCategory.length} 个品类`)}
      <div class="chart-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>节约花费 Top 品类</h4></div></div>
          ${horizontalBarChart([...filteredSavingsCategory].sort((a, b) => b.节约广告花费 - a.节约广告花费).slice(0, 12).map((row) => ({ label: row.父标签 || "未匹配品类", value: row.节约广告花费 })), { formatter: (v) => formatCurrency(v, true) })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>节约花费按运营组长</h4></div></div>
          ${horizontalBarChart([...filteredSavingsOwner].sort((a, b) => b.节约广告花费 - a.节约广告花费).map((row) => ({ label: row.运营组长 || "未匹配负责人", value: row.节约广告花费 })), { formatter: (v) => formatCurrency(v, true) })}
        </div>
      </div>
    </section>
    <section class="dashboard-section" id="invalid-detail">
      ${sectionHead("广告活动明细", "无效与低效结果分页展示，便于定位广告活动。", `${detailRows.length} 条`)}
      <div class="chart-title-row">
        <div></div>
        ${segmentControl("invalid-detail", [["all", "全部"], ["invalid", "无效"], ["inefficient", "低效"]], state.ui.invalidDetailTab)}
      </div>
      ${tableMarkup("invalid-detail-table", detailRows, detailColumns, 50)}
    </section>`;
}

function lingxingFilterConfig(data) {
  const filters = data.summary.filters;
  return [
    { id: "month", label: "月份", options: filters.月份 || ["5月", "6月"] },
    { id: "category", label: "品类", options: filters.品类 || [] },
    { id: "owner", label: "运营组长", options: filters.运营组长 || [] },
    { id: "rule", label: "规则类别", options: filters.规则类别 || [] },
    { id: "ruleGroup", label: "规则大类", options: filters.规则大类 || [] },
  ];
}

function filteredTriggerRows(data) {
  return (data.summary.trigger_monitor.detail || []).filter((row) => rowMatches("lingxing_rules", row, {
    category: "品类",
    owner: "运营组长",
    rule: "规则类别",
    ruleGroup: "规则大类",
  }));
}

function renderLingxing() {
  const data = state.data.lingxing_rules;
  const configs = lingxingFilterConfig(data);
  initializeFilters("lingxing_rules", configs);
  const triggerRows = filteredTriggerRows(data);
  const monthSet = selectedSet("lingxing_rules", "month");
  const previousVisible = monthSet.has("5月");
  const currentVisible = monthSet.has("6月");
  const ruleTotal = {
    previous: sum(triggerRows, "上周期触发次数"),
    current: sum(triggerRows, "本周期触发次数"),
  };
  const controlRows = triggerRows.filter((row) => row.规则大类 === "控费类");
  const investRows = triggerRows.filter((row) => row.规则大类 === "增投类");
  const negativeRows = triggerRows.filter((row) => row.规则类别 === "否词");
  const pauseRows = triggerRows.filter((row) => ["产品(ASIN)暂停", "关键词/PAT暂停"].includes(row.规则类别));
  const mainSaving = {
    previous: sum(triggerRows, "主理论节费") - sum(triggerRows, "主理论节费变化"),
    current: sum(triggerRows, "主理论节费"),
  };

  const categoryRows = aggregateBy(triggerRows, "品类", {
    previous: (row) => row.上周期触发次数,
    current: (row) => row.本周期触发次数,
  }).sort((a, b) => b.current - a.current);
  const ruleRows = aggregateBy(triggerRows, "规则类别", {
    previous: (row) => row.上周期触发次数,
    current: (row) => row.本周期触发次数,
  }).sort((a, b) => b.current - a.current);
  const ownerRows = aggregateBy(triggerRows, "运营组长", {
    previous: (row) => row.上周期触发次数,
    current: (row) => row.本周期触发次数,
  }).sort((a, b) => b.current - a.current);
  const alerts = triggerRows.filter((row) => ["触发偏低", "异常升高", "无触发"].includes(row.状态))
    .sort((a, b) => Math.abs(asNumber(b.触发次数变化)) - Math.abs(asNumber(a.触发次数变化)));

  const savingCategory = (data.summary.saving_dashboard.by_category || []).filter((row) => {
    const categories = selectedSet("lingxing_rules", "category");
    const owners = selectedSet("lingxing_rules", "owner");
    return categories.size > 0 && owners.size > 0 && categories.has(row.品类) && owners.has(row.运营组长);
  }).sort((a, b) => b.本周期理论节费 - a.本周期理论节费);
  const savingRules = (data.summary.saving_dashboard.by_rule || []).filter((row) => selectedSet("lingxing_rules", "rule").has(row.标准规则类别));
  const negativeObservation = (data.summary.saving_dashboard.negative_keyword_observation || []).filter((row) => {
    const categories = selectedSet("lingxing_rules", "category");
    const owners = selectedSet("lingxing_rules", "owner");
    return categories.size > 0 && owners.size > 0 && categories.has(row.品类) && owners.has(row.运营组长);
  }).sort((a, b) => b.本周期触发次数 - a.本周期触发次数);

  const detailRows = (data.action_detail.rows || []).filter((row) => {
    const month = row.月份 === "2026-05" ? "5月" : row.月份 === "2026-06" ? "6月" : row.月份;
    const mapped = { ...row, 筛选月份: month };
    return rowMatches("lingxing_rules", mapped, {
      month: "筛选月份",
      category: "品类",
      owner: "运营组长",
      rule: "规则类别",
      ruleGroup: "规则大类",
    }) && searchMatches("lingxing_rules", row, ["广告活动", "广告组", "对象明细", "原始规则名"]);
  }).sort((a, b) => String(b.触发日期).localeCompare(String(a.触发日期)));

  const detailColumns = [
    { field: "月份", label: "月份" },
    { field: "触发日期", label: "触发日期" },
    { field: "品类", label: "品类" },
    { field: "运营组长", label: "运营组长" },
    { field: "规则类别", label: "规则类别", render: (v) => tagMarkup(v) },
    { field: "规则大类", label: "规则大类" },
    { field: "原始规则名", label: "原始规则名", long: true },
    { field: "广告活动", label: "广告活动", long: true },
    { field: "优化对象", label: "优化对象" },
    { field: "对象明细", label: "对象明细", long: true },
    { field: "花费", label: "花费", numeric: true, render: (v) => formatCurrency(v) },
    { field: "订单", label: "订单", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "销售额", label: "销售额", numeric: true, render: (v) => formatCurrency(v) },
    { field: "主理论节费", label: "主理论节费", numeric: true, render: (v) => v === "-" ? "-" : formatCurrency(v) },
    { field: "节费来源口径", label: "节费来源口径", long: true },
  ];

  const kpiRows = [
    { label: "规则触发总数", rows: triggerRows, tone: "primary" },
    { label: "控费类触发数", rows: controlRows, tone: "teal" },
    { label: "增投类触发数", rows: investRows, tone: "orange" },
    { label: "否词触发数", rows: negativeRows, tone: "primary" },
    { label: "关键词/产品暂停触发数", rows: pauseRows, tone: "green" },
  ];
  const kpis = kpiRows.map((item) => kpiCard({
    label: item.label,
    value: currentVisible ? sum(item.rows, "本周期触发次数") : sum(item.rows, "上周期触发次数"),
    previous: previousVisible && currentVisible ? sum(item.rows, "上周期触发次数") : null,
    valueType: "integer",
    tone: item.tone,
    note: currentVisible ? "6月" : "5月",
  })).join("") + kpiCard({
    label: "理论月化节费",
    value: currentVisible ? mainSaving.current : mainSaving.previous,
    previous: previousVisible && currentVisible ? mainSaving.previous : null,
    valueType: "currency",
    tone: "green",
    note: "仅产品与关键词/PAT暂停",
  });

  root.innerHTML = `
    ${introMarkup("领星自动化规则复盘", "监控规则触发变化、理论控费规模和异常品类，理论节费不等同实际利润。")}
    <div class="kpi-grid kpi-grid--six">${kpis}</div>
    ${filterMarkup("lingxing_rules", configs, { label: "广告活动 / 对象明细关键词", placeholder: "搜索活动、广告组、对象或规则名" }, `${triggerRows.length} 个监控组合`)}
    <section class="dashboard-section" id="trigger-monitor">
      ${sectionHead("规则触发监控", "触发偏低或异常升高参照同品类、同规则与整体增长幅度判断。", `${alerts.length} 个待关注组合`)}
      <div class="chart-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>触发次数 Top 品类</h4></div>${legendMarkup()}</div>
          ${verticalCompareChart(categoryRows.slice(0, 14).map((row) => ({ label: row.品类, previous: row.previous, current: row.current })), { previousVisible, currentVisible, formatter: (v) => formatCompact(v) })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>规则类别触发对比</h4></div>${legendMarkup()}</div>
          ${compareList(ruleRows.slice(0, 12).map((row) => ({ label: row.规则类别, previous: row.previous, current: row.current, formatter: (v) => formatNumber(v, 0) })), { previousVisible, currentVisible })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>运营组长触发对比</h4></div>${legendMarkup()}</div>
          ${verticalCompareChart(ownerRows.map((row) => ({ label: row.运营组长, previous: row.previous, current: row.current })), { previousVisible, currentVisible, formatter: (v) => formatCompact(v) })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>触发异常与偏低</h4><p>按触发次数变化绝对值排序</p></div></div>
          <div class="alert-list">
            ${alerts.length ? alerts.slice(0, 10).map((row) => `
              <div class="alert-item">
                ${tagMarkup(row.状态)}
                <div><strong>${escapeHtml(row.品类)} · ${escapeHtml(row.规则类别)}</strong><p>${escapeHtml(row.判断依据 || "-")}</p></div>
                <span>${formatNumber(row.上周期触发次数, 0)} → ${formatNumber(row.本周期触发次数, 0)}</span>
              </div>`).join("") : emptyState()}
          </div>
        </div>
      </div>
    </section>
    <section class="dashboard-section" id="saving-dashboard">
      ${sectionHead("节费规则看板", "主节费仅统计产品(ASIN)暂停和关键词/PAT暂停；否词只展示触发次数。", `${formatCurrency(mainSaving.current)} 本周期理论节费`)}
      <div class="chart-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>节费 Top 品类</h4></div>${legendMarkup()}</div>
          ${verticalCompareChart(savingCategory.slice(0, 14).map((row) => ({ label: row.品类, previous: row.上周期理论节费, current: row.本周期理论节费 })), { previousVisible, currentVisible, formatter: (v) => formatCurrency(v, true) })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>主节费规则贡献</h4></div>${legendMarkup()}</div>
          ${compareList(savingRules.map((row) => ({ label: row.标准规则类别, previous: row.上周期理论节费, current: row.本周期理论节费, formatter: (v) => formatCurrency(v, true) })), { previousVisible, currentVisible })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>无出单 vs ACoS 高节费</h4></div></div>
          ${compareList(savingRules.flatMap((row) => [
            { label: `${row.标准规则类别} · 无出单`, previous: row.上周期无出单节费, current: row.本周期无出单节费, formatter: (v) => formatCurrency(v, true) },
            { label: `${row.标准规则类别} · ACoS高`, previous: row.上周期ACOS节费, current: row.本周期ACOS节费, formatter: (v) => formatCurrency(v, true) },
          ]), { previousVisible, currentVisible })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>否词触发观察</h4><p>仅统计动作次数，不计入主理论节费</p></div>${legendMarkup()}</div>
          ${verticalCompareChart(negativeObservation.slice(0, 12).map((row) => ({ label: row.品类, previous: row.上周期触发次数, current: row.本周期触发次数 })), { previousVisible, currentVisible, formatter: (v) => formatNumber(v, 0) })}
        </div>
      </div>
      <div class="method-note">理论节费为规则识别出的低效花费规模，采用去重后、按取数周期折算的月化口径，不等同于实际利润提升。</div>
    </section>
    <section class="dashboard-section" id="saving-detail">
      ${sectionHead("节费规则触发明细", "产品(ASIN)暂停、关键词/PAT暂停展示月化理论节费；否词金额以横杠标记。", `${detailRows.length} 条`)}
      ${tableMarkup("lingxing-detail-table", detailRows, detailColumns, 50)}
      <div class="method-note">仅展示产品(ASIN)暂停、关键词/PAT暂停及否词类触发；CPC调整、广告位调优、库存类规则不纳入本明细。</div>
    </section>`;
}

function batchFilterConfig(data) {
  return [
    { id: "month", label: "月份", options: data.filters.月份 || [] },
    { id: "category", label: "品类", options: data.filters.品类 || [] },
    { id: "team", label: "团队", options: data.filters.团队 || [] },
    { id: "owner", label: "品类负责人", options: data.filters.品类负责人 || [] },
  ];
}

function batchAggregate(rows) {
  const batchCount = sum(rows, "批量活动数量");
  const allCount = sum(rows, "全部活动数量");
  const spend = sum(rows, "批量广告花费");
  const sales = rows.reduce((total, row) => {
    const acos = asNumber(row.批量ACOS);
    return total + (acos ? asNumber(row.批量广告花费) / acos : 0);
  }, 0);
  return {
    batchCount,
    allCount,
    coverage: safeDivide(batchCount, allCount),
    spend,
    acos: safeDivide(spend, sales),
  };
}

function renderBatch() {
  const data = state.data.batch_launch;
  const configs = batchFilterConfig(data);
  initializeFilters("batch_launch", configs);
  const monthSet = selectedSet("batch_launch", "month");
  const categorySet = selectedSet("batch_launch", "category");
  const teamSet = selectedSet("batch_launch", "team");
  const ownerSet = selectedSet("batch_launch", "owner");
  const query = (state.searchApplied.batch_launch || "").trim().toLowerCase();
  const categoryRows = (data.summary_by_category || []).filter((row) => monthSet.has(row.月份) && categorySet.has(row.维度) && (!query || String(row.维度).toLowerCase().includes(query)));
  const teamRows = (data.summary_by_team || []).filter((row) => monthSet.has(row.月份) && teamSet.has(row.维度));
  const ownerRows = (data.summary_by_owner || []).filter((row) => monthSet.has(row.月份) && ownerSet.has(row.维度));
  const latestMonth = [...monthSet].sort((a, b) => Number(b) - Number(a))[0];
  const previousMonth = [...monthSet].sort((a, b) => Number(a) - Number(b))[0];
  const currentRows = categoryRows.filter((row) => row.月份 === latestMonth);
  const previousRows = categoryRows.filter((row) => row.月份 === previousMonth && previousMonth !== latestMonth);
  const current = batchAggregate(currentRows);
  const previous = previousRows.length ? batchAggregate(previousRows) : null;
  const coverageRows = [...currentRows].sort((a, b) => b.活动覆盖率 - a.活动覆盖率);
  const acosRows = [...currentRows].sort((a, b) => b.批量广告花费 - a.批量广告花费);

  const monthScale = unique((data.summary_by_category || []).map((row) => row.月份)).filter((month) => monthSet.has(month)).map((month) => {
    const rows = (data.summary_by_category || []).filter((row) => row.月份 === month && categorySet.has(row.维度) && (!query || String(row.维度).toLowerCase().includes(query)));
    return { label: month === 202605 ? "5月" : month === 202606 ? "6月" : String(month), value: sum(rows, "批量活动数量") };
  });

  let summaryRows = categoryRows;
  let summaryColumns = [
    { field: "月份", label: "月份", render: (v) => v === 202605 ? "2026-05" : v === 202606 ? "2026-06" : escapeHtml(v) },
    { field: "维度", label: "品类" },
    { field: "批量活动数量", label: "批量活动数量", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "全部活动数量", label: "全部活动数量", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "活动覆盖率", label: "活动覆盖率", numeric: true, render: (v) => formatPercent(v, true) },
    { field: "批量广告花费", label: "批量广告花费", numeric: true, render: (v) => formatCurrency(v) },
    { field: "批量ACOS", label: "批量 ACoS", numeric: true, render: (v) => formatPercent(v, true) },
    { field: "品类平均ACOS", label: "品类平均 ACoS", numeric: true, render: (v) => formatPercent(v, true) },
    { field: "ACOS差异", label: "ACoS 差异", numeric: true, render: (v) => formatPercent(v, true) },
    { field: "批量销售贡献率", label: "批量销售贡献率", numeric: true, render: (v) => formatPercent(v, true) },
  ];
  if (state.ui.batchSummaryTab === "team") {
    summaryRows = teamRows;
    summaryColumns = summaryColumns.map((column) => column.field === "维度" ? { ...column, label: "团队" } : column);
  }
  if (state.ui.batchSummaryTab === "owner") {
    summaryRows = ownerRows;
    summaryColumns = summaryColumns.map((column) => column.field === "维度" ? { ...column, label: "品类负责人" } : column);
  }
  summaryRows = [...summaryRows].sort((a, b) => b.月份 - a.月份 || b.批量活动数量 - a.批量活动数量);

  root.innerHTML = `
    ${introMarkup("批量投放系统运营看板", "查看批量活动创建规模、活动覆盖率及批量 ACoS 与品类平均的差异。")}
    <div class="kpi-grid">
      ${kpiCard({ label: "创建广告数量", value: current.batchCount, previous: previous?.batchCount, valueType: "integer", tone: "primary", note: latestMonth ? `${String(latestMonth).slice(0, 4)}年${String(latestMonth).slice(4)}月` : "当前筛选" })}
      ${kpiCard({ label: "活动覆盖率", value: current.coverage, previous: previous?.coverage, valueType: "fractionPercent", tone: "teal", note: "批量活动数 / 全部活动数" })}
      ${kpiCard({ label: "批量广告花费", value: current.spend, previous: previous?.spend, valueType: "currency", tone: "orange", inverse: true })}
      ${kpiCard({ label: "批量 ACoS", value: current.acos, previous: previous?.acos, valueType: "fractionPercent", tone: "red", inverse: true })}
      ${kpiCard({ label: "当前覆盖品类", value: currentRows.length, valueType: "integer", tone: "green", note: "当前月份与品类筛选" })}
    </div>
    ${filterMarkup("batch_launch", configs, { label: "品类关键词", placeholder: "搜索品类" }, `${categoryRows.length} 条品类月度汇总`)}
    <section class="dashboard-section" id="batch-scale">
      ${sectionHead("批量投放规模", "按月比较批量活动数量，不展示花费趋势。", "5月 vs 6月")}
      <div class="chart-panel chart-panel--full">
        ${horizontalBarChart(monthScale, { formatter: (v) => formatNumber(v, 0) })}
      </div>
    </section>
    <section class="dashboard-section" id="batch-coverage">
      ${sectionHead("活动覆盖率", "数量覆盖率 = 批量活动数量 / 全部活动数量。", `${coverageRows.length} 个品类`)}
      <div class="chart-panel chart-panel--full">
        ${horizontalBarChart(coverageRows.map((row) => ({ label: row.维度, value: row.活动覆盖率 })), { max: 1, formatter: (v) => formatPercent(v, true) })}
      </div>
    </section>
    <section class="dashboard-section" id="batch-acos">
      ${sectionHead("批量 ACoS vs 品类平均", "点位越靠左表示 ACoS 越低；同品类直接比较批量活动与品类平均。", `${acosRows.length} 个品类`)}
      <div class="chart-panel chart-panel--full">
        <div class="chart-title-row"><div></div>${legendMarkup("批量 ACoS", "品类平均 ACoS")}</div>
        ${dumbbellChart(acosRows.map((row) => ({ label: row.维度, previous: row.批量ACOS, current: row.品类平均ACOS })), { formatter: (v) => formatPercent(v, true) })}
      </div>
    </section>
    <section class="dashboard-section" id="batch-summary">
      ${sectionHead("批量投放汇总明细", "使用月度汇总表，不读取活动级大底表。", `${summaryRows.length} 条`)}
      <div class="chart-title-row">
        <div></div>
        ${segmentControl("batch-summary", [["category", "按品类"], ["team", "按团队"], ["owner", "按负责人"]], state.ui.batchSummaryTab)}
      </div>
      ${tableMarkup("batch-summary-table", summaryRows, summaryColumns, 50)}
      <div class="method-note">顶部 KPI、投放规模、覆盖率和 ACoS 图响应月份与品类筛选；团队和负责人筛选用于对应汇总明细。</div>
    </section>`;
}

function renderSubnav() {
  const config = PAGE_CONFIG[state.page];
  subnav.innerHTML = config.sections.map(([id, label], index) => `
    <a class="subnav-link ${index === 0 ? "is-active" : ""}" href="#${escapeHtml(id)}">${escapeHtml(label)}</a>`).join("");
}

function renderCurrentPage() {
  pageTitle.textContent = PAGE_CONFIG[state.page].title;
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.page === state.page);
  });
  renderSubnav();
  if (state.page === "monthly_review") renderMonthly();
  if (state.page === "invalid_low_efficiency") renderInvalid();
  if (state.page === "lingxing_rules") renderLingxing();
  if (state.page === "batch_launch") renderBatch();
  bindSectionObserver();
}

function updateMultiSelectButton(select) {
  const pageId = select.closest("[data-page-filter]").dataset.pageFilter;
  const filterId = select.dataset.filterId;
  let configs;
  if (pageId === "monthly_review") configs = monthlyFilterConfig(state.data.monthly_review);
  if (pageId === "invalid_low_efficiency") configs = invalidFilterConfig(state.data.invalid_low_efficiency);
  if (pageId === "lingxing_rules") configs = lingxingFilterConfig(state.data.lingxing_rules);
  if (pageId === "batch_launch") configs = batchFilterConfig(state.data.batch_launch);
  const config = configs.find((item) => item.id === filterId);
  select.querySelector(".multi-select__button").textContent = selectedLabel(pageId, config);
}

function closeMultiSelects(except = null) {
  document.querySelectorAll(".multi-select.is-open").forEach((select) => {
    if (select === except) return;
    select.classList.remove("is-open");
    select.querySelector(".multi-select__menu")?.classList.add("is-hidden");
    select.querySelector(".multi-select__button")?.setAttribute("aria-expanded", "false");
  });
}

function applyFilters(pageId) {
  Object.entries(state.filterDraft[pageId]).forEach(([id, values]) => {
    state.filterApplied[pageId][id] = cloneSet(values);
  });
  const search = document.getElementById(`${pageId}-search`);
  if (search) state.searchDraft[pageId] = search.value;
  state.searchApplied[pageId] = state.searchDraft[pageId] || "";
  Object.keys(state.pagination).forEach((key) => { state.pagination[key] = 1; });
  closeMultiSelects();
  renderCurrentPage();
  showToast("筛选已应用");
}

function resetFilters(pageId) {
  let configs;
  if (pageId === "monthly_review") configs = monthlyFilterConfig(state.data.monthly_review);
  if (pageId === "invalid_low_efficiency") configs = invalidFilterConfig(state.data.invalid_low_efficiency);
  if (pageId === "lingxing_rules") configs = lingxingFilterConfig(state.data.lingxing_rules);
  if (pageId === "batch_launch") configs = batchFilterConfig(state.data.batch_launch);
  configs.forEach((config) => {
    const all = new Set(unique(config.options));
    state.filterDraft[pageId][config.id] = cloneSet(all);
    state.filterApplied[pageId][config.id] = cloneSet(all);
  });
  state.searchDraft[pageId] = "";
  state.searchApplied[pageId] = "";
  Object.keys(state.pagination).forEach((key) => { state.pagination[key] = 1; });
  renderCurrentPage();
  showToast("筛选已重置");
}

function handleRootClick(event) {
  const selectButton = event.target.closest(".multi-select__button");
  if (selectButton) {
    const select = selectButton.closest(".multi-select");
    const shouldOpen = !select.classList.contains("is-open");
    closeMultiSelects(select);
    select.classList.toggle("is-open", shouldOpen);
    select.querySelector(".multi-select__menu").classList.toggle("is-hidden", !shouldOpen);
    selectButton.setAttribute("aria-expanded", String(shouldOpen));
    return;
  }

  const selectAction = event.target.closest("[data-select-action]");
  if (selectAction) {
    const select = selectAction.closest(".multi-select");
    const pageId = select.closest("[data-page-filter]").dataset.pageFilter;
    const filterId = select.dataset.filterId;
    const checkboxes = [...select.querySelectorAll('input[type="checkbox"]')];
    const isAll = selectAction.dataset.selectAction === "all";
    state.filterDraft[pageId][filterId] = new Set(isAll ? checkboxes.map((box) => box.value) : []);
    checkboxes.forEach((box) => { box.checked = isAll; });
    updateMultiSelectButton(select);
    return;
  }

  const queryButton = event.target.closest("[data-filter-query]");
  if (queryButton) {
    applyFilters(queryButton.closest("[data-page-filter]").dataset.pageFilter);
    return;
  }

  const resetButton = event.target.closest("[data-filter-reset]");
  if (resetButton) {
    resetFilters(resetButton.closest("[data-page-filter]").dataset.pageFilter);
    return;
  }

  const segmentButton = event.target.closest("[data-segment-value]");
  if (segmentButton) {
    const segment = segmentButton.closest("[data-segment]").dataset.segment;
    const value = segmentButton.dataset.segmentValue;
    if (segment === "monthly-category") state.ui.monthlyCategoryTab = value;
    if (segment === "invalid-detail") state.ui.invalidDetailTab = value;
    if (segment === "batch-summary") state.ui.batchSummaryTab = value;
    renderCurrentPage();
    document.getElementById(segment)?.scrollIntoView({ block: "start" });
    return;
  }

  const pageButton = event.target.closest("[data-page-action]");
  if (pageButton) {
    const table = pageButton.closest("[data-table-id]");
    const id = table.dataset.tableId;
    const delta = pageButton.dataset.pageAction === "next" ? 1 : -1;
    state.pagination[id] = Math.max(1, (state.pagination[id] || 1) + delta);
    renderCurrentPage();
    document.querySelector(`[data-table-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center" });
  }
}

function handleRootChange(event) {
  const checkbox = event.target.closest('.multi-select input[type="checkbox"]');
  if (!checkbox) return;
  const select = checkbox.closest(".multi-select");
  const pageId = select.closest("[data-page-filter]").dataset.pageFilter;
  const filterId = select.dataset.filterId;
  const selected = state.filterDraft[pageId][filterId];
  if (checkbox.checked) selected.add(checkbox.value);
  else selected.delete(checkbox.value);
  updateMultiSelectButton(select);
}

function handleRootInput(event) {
  if (!event.target.matches(".search-input")) return;
  const pageId = event.target.closest("[data-page-filter]").dataset.pageFilter;
  state.searchDraft[pageId] = event.target.value;
}

let sectionObserver;
function bindSectionObserver() {
  sectionObserver?.disconnect();
  const links = [...subnav.querySelectorAll(".subnav-link")];
  const targets = links.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
  if (!targets.length || !("IntersectionObserver" in window)) return;
  sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    links.forEach((link) => link.classList.toggle("is-active", link.getAttribute("href") === `#${visible.target.id}`));
  }, { rootMargin: "-150px 0px -60% 0px", threshold: [0.05, 0.25, 0.6] });
  targets.forEach((target) => sectionObserver.observe(target));
}

async function loadData() {
  loading.classList.remove("is-hidden");
  errorState.classList.add("is-hidden");
  root.innerHTML = "";
  dataStatus.className = "data-status";
  dataStatus.innerHTML = '<span class="status-dot"></span><span>正在读取数据</span>';
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    loading.classList.add("is-hidden");
    dataStatus.classList.add("is-ready");
    const generated = state.data.meta?.generated_at ? new Date(state.data.meta.generated_at) : null;
    const freshness = generated && !Number.isNaN(generated.valueOf())
      ? `${generated.toLocaleDateString("zh-CN")} ${generated.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
      : "数据已就绪";
    dataStatus.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(freshness)}</span>`;
    renderCurrentPage();
  } catch (error) {
    loading.classList.add("is-hidden");
    errorState.classList.remove("is-hidden");
    document.getElementById("error-message").textContent = `无法读取 ${DATA_URL}。请通过 GitHub Pages 或本地 HTTP 服务打开页面。${error.message ? ` (${error.message})` : ""}`;
    dataStatus.classList.add("is-error");
    dataStatus.innerHTML = '<span class="status-dot"></span><span>数据加载失败</span>';
  }
}

document.querySelector(".primary-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button || button.dataset.page === state.page) return;
  state.page = button.dataset.page;
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderCurrentPage();
});

root.addEventListener("click", handleRootClick);
root.addEventListener("change", handleRootChange);
root.addEventListener("input", handleRootInput);
document.addEventListener("click", (event) => {
  if (!event.target.closest(".multi-select")) closeMultiSelects();
});
document.getElementById("retry-button").addEventListener("click", loadData);

loadData();
