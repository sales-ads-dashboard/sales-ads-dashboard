"use strict";

const DATA_URL = window.DASHBOARD_DATA_URL || "data/sales_ads_dashboard_data.json";
const WEEKLY_DATA_URL = window.WEEKLY_REPORT_DATA_URL || "亚马逊周报月报/output/latest.json";

const PAGE_CONFIG = {
  monthly_review: {
    title: "月度广告数据复盘看板",
    sections: [
      ["monthly-overview", "整体大盘"],
      ["monthly-category", "品类视角"],
      ["monthly-owner", "运营组长视角"],
      ["monthly-sd-spend", "SD花费核对"],
    ],
  },
  weekly_review: {
    title: "周度广告复盘看板",
    sections: [
      ["weekly-overview", "总体概览"],
      ["weekly-category", "重点品类"],
      ["weekly-self-invest", "自投广告"],
      ["weekly-detail", "数据明细"],
    ],
  },
  invalid_low_efficiency: {
    title: "无效低效广告看板",
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
      ["rule-query", "领星自动化规则"],
    ],
  },
  batch_launch: {
    title: "批量投放看板",
    sections: [
      ["batch-scale", "批量投放规模"],
      ["batch-coverage", "活动覆盖率"],
      ["batch-acos", "批量 ACOS 对比"],
      ["batch-summary", "批量投放汇总明细"],
      ["batch-operation-detail", "批量投放批次查询"],
    ],
  },
};

const state = {
  data: null,
  weeklyReport: null,
  weeklyLoadError: "",
  page: "monthly_review",
  filterDraft: {},
  filterApplied: {},
  searchDraft: {},
  searchApplied: {},
  detailFilters: {},
  invalidDetailSearch: {
    draft: "",
    applied: "",
  },
  invalidDetailDays: {
    minDraft: "",
    maxDraft: "",
    minApplied: null,
    maxApplied: null,
  },
  pagination: {},
  ui: {
    monthlyCategoryTab: "all",
    weeklySelfTab: "overall",
    invalidDetailTab: "all",
    batchSummaryTab: "category",
    batchAcosSort: "desc",
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
const yuanFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
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

function formatYuan(value) {
  return yuanFormatter.format(asNumber(value));
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

function kpiCard({ label, value, previous, valueType = "number", tone = "primary", inverse = false, note = "较上月", description = "" }) {
  let display = formatNumber(value, 2);
  if (valueType === "integer") display = formatNumber(value, 0);
  if (valueType === "currency") display = formatCurrency(value, true);
  if (valueType === "yuan") display = formatYuan(value);
  if (valueType === "percent") display = formatPercent(value, false, 2);
  if (valueType === "fractionPercent") display = formatPercent(value, true, 2);
  const compare = previous === undefined || previous === null
    ? escapeHtml(note)
    : `${note ? `${escapeHtml(note)} ` : ""}${formatChange(value, previous, valueType === "fractionPercent" ? "number" : valueType, inverse)}`;
  return `
    <article class="kpi-card" data-tone="${escapeHtml(tone)}">
      <p class="kpi-card__label">${escapeHtml(label)}</p>
      ${description ? `<p class="kpi-card__description">${escapeHtml(description)}</p>` : ""}
      <p class="kpi-card__value">${display}</p>
      <p class="kpi-card__compare">${compare}</p>
    </article>`;
}

function detailMetricCard(label, value, valueType = "number", note = "当前筛选明细") {
  let display = formatNumber(value, 2);
  if (valueType === "integer") display = formatNumber(value, 0);
  if (valueType === "currency") display = formatCurrency(value);
  return `
    <article class="detail-metric">
      <p>${escapeHtml(label)}</p>
      <strong>${display}</strong>
      <span>${escapeHtml(note)}</span>
    </article>`;
}

function introMarkup(title, description, period = "2026年5月 vs 6月", note = "") {
  return `
    <div class="page-intro">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
        ${note ? `<p class="page-intro__note">${escapeHtml(note)}</p>` : ""}
      </div>
      <span class="period-badge">${escapeHtml(period)}</span>
    </div>`;
}

function sectionHead(title, description = "", meta = "", action = null) {
  return `
    <div class="section-head">
      <div>
        <h3>${escapeHtml(title)}</h3>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
      </div>
      ${(meta || action) ? `
        <div class="section-head__actions">
          ${action ? `<a class="section-action" href="${escapeHtml(action.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(action.label)}</a>` : ""}
          ${meta ? `<span class="section-meta">${escapeHtml(meta)}</span>` : ""}
        </div>` : ""}
    </div>`;
}

function emptyState(message = "当前筛选条件下暂无数据") {
  return `<div class="empty-state"><div><strong>暂无结果</strong>${escapeHtml(message)}</div></div>`;
}

function weeklyValue(value, type = "number") {
  if (value === null || value === undefined || value === "") return "数据不足";
  if (type === "integer") return formatNumber(value, 0);
  if (type === "currency") return formatCurrency(value);
  if (type === "percent") return formatPercent(value, true);
  return formatNumber(value, 2);
}

function weeklyMetricType(metric) {
  if (metric?.unit === "count") return "integer";
  if (metric?.unit === "USD") return "currency";
  if (metric?.unit === "ratio") return "percent";
  return "number";
}

function weeklyMetricRule(metricId) {
  if (["front_units", "front_sales", "ad_sales", "cvr"].includes(metricId)) return "higher-good";
  if (["acos", "cpc"].includes(metricId)) return "lower-good";
  return "neutral";
}

function weeklyDelta(metric, rule = "neutral") {
  if (!metric || metric.available === false || [metric.current, metric.previous].some((value) => value === null || value === undefined || value === "")) {
    return `<span class="weekly-delta is-neutral">数据不足</span>`;
  }
  const delta = Number(metric.delta);
  if (!Number.isFinite(delta)) return `<span class="weekly-delta is-neutral">数据不足</span>`;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  let tone = "is-neutral";
  if (rule === "higher-good" && delta !== 0) tone = delta > 0 ? "is-good" : "is-bad";
  if (rule === "lower-good" && delta !== 0) tone = delta < 0 ? "is-good" : "is-bad";
  const withinTolerance = metric.id === "acos" && delta > 0 && metric.within_attribution_tolerance === true;
  if (withinTolerance) tone = "is-neutral";
  let text = "持平";
  if (delta !== 0 && metric.unit === "ratio") {
    const percentagePoints = Math.abs(delta) * 100;
    const digits = percentagePoints > 0 && percentagePoints < 0.01 ? 3 : 2;
    text = `${formatNumber(percentagePoints, digits)} 个百分点`;
  } else if (delta !== 0 && metric.delta_rate !== null && metric.delta_rate !== undefined) {
    text = formatPercent(Math.abs(metric.delta_rate), true, 1);
  } else if (delta !== 0) {
    text = weeklyValue(Math.abs(delta), weeklyMetricType(metric));
  }
  const toleranceText = withinTolerance ? `<em>归因容忍内</em>` : "";
  return `<span class="weekly-delta ${tone}">${arrow} ${text}${toleranceText}</span>`;
}

function weeklyKpiCard(metric, tone, rule = "neutral") {
  const type = weeklyMetricType(metric);
  const currentDisplay = type === "currency" && metric?.current !== null && metric?.current !== undefined
    ? formatCurrency(metric.current, true)
    : weeklyValue(metric?.current, type);
  const previousDisplay = type === "currency" && metric?.previous !== null && metric?.previous !== undefined
    ? formatCurrency(metric.previous, true)
    : weeklyValue(metric?.previous, type);
  return `<article class="kpi-card weekly-kpi" data-tone="${escapeHtml(tone)}">
    <p class="kpi-card__label">${escapeHtml(metric?.label || "-")}</p>
    <p class="kpi-card__value">${currentDisplay}</p>
    <div class="weekly-kpi__compare">
      <span>上期 ${previousDisplay}</span>
      ${weeklyDelta(metric, rule)}
    </div>
  </article>`;
}

function weeklyMetricCell(metric, rule = "neutral") {
  const type = weeklyMetricType(metric);
  return `<div class="weekly-metric">
    <span>${escapeHtml(metric?.label || "-")}</span>
    <strong>${weeklyValue(metric?.current, type)}</strong>
    <small><span>上期 ${weeklyValue(metric?.previous, type)}</span>${weeklyDelta(metric, rule)}</small>
  </div>`;
}

function weeklyFactList(findings, emptyMessage = "当前没有达到提示阈值的已确认变化") {
  if (!Array.isArray(findings) || findings.length === 0) {
    return `<p class="weekly-facts-empty">${escapeHtml(emptyMessage)}</p>`;
  }
  return `<ul class="weekly-fact-list">${findings.map((finding) => `<li>${escapeHtml(finding)}</li>`).join("")}</ul>`;
}

function weeklyCategoryCard(category, options = {}) {
  const metrics = category.metrics || {};
  const metricIds = [
    "front_units",
    "front_sales",
    "ad_spend",
    "ad_sales",
    "coupon_promotion_cost",
    "coupon_promotion_rate",
    "acos",
    "cvr",
  ];
  const isHighRisk = options.isHighRisk === true;
  const riskScore = Number(category.risk?.score);
  const badge = isHighRisk
    ? `高风险 #${options.rank}${Number.isFinite(riskScore) ? ` · ${formatNumber(riskScore, 2)}分` : ""}`
    : "固定关注";
  const typeLabel = category.is_required ? "固定品类" : "非固定品类";
  return `<details class="weekly-category-card" open>
    <summary>
      <span class="weekly-category-card__title">
        <strong>${escapeHtml(category.category)}</strong>
        <span>${escapeHtml(typeLabel)}</span>
      </span>
      <span class="weekly-status ${isHighRisk ? "is-danger" : "is-neutral"}">${escapeHtml(badge)}</span>
    </summary>
    <div class="weekly-category-card__body">
      <div class="weekly-metric-grid">
        ${metricIds.map((metricId) => weeklyMetricCell(metrics[metricId], weeklyMetricRule(metricId))).join("")}
      </div>
      <div class="weekly-confirmed-block">
        <strong>已确认现象</strong>
        ${weeklyFactList(category.confirmed_findings)}
      </div>
    </div>
  </details>`;
}

function weeklyOverviewRows(data) {
  const period = data.period || {};
  const rows = [
    ["current", period.current_label, data.overview?.current || {}],
    ["previous", period.previous_label, data.overview?.previous || {}],
  ];
  return rows.map(([periodKey, periodLabel, values]) => ({
    period_key: periodKey,
    period_label: periodLabel,
    ...values,
  }));
}

function weeklyCategoryRows(categories, highRiskNames) {
  return categories.map((category) => ({
    category: category.category,
    attention_type: highRiskNames.has(category.category) ? "高风险 Top 4" : "固定关注",
    risk_score: category.risk?.score,
    ...category.current,
  }));
}

function weeklySelfRows(section, period) {
  return (section?.rows || []).map((row) => ({
    ...row,
    period_label: row.period_key === "current" ? period.current_label : period.previous_label,
  }));
}

function weeklyGeneratedLabel(value) {
  const generated = value ? new Date(value) : null;
  if (!generated || Number.isNaN(generated.valueOf())) return "生成时间未知";
  return generated.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderWeekly() {
  const data = state.weeklyReport;
  if (!data) {
    const detail = state.weeklyLoadError ? `（${state.weeklyLoadError}）` : "";
    root.innerHTML = emptyState(`尚未读取到独立周报 JSON ${detail}`);
    return;
  }
  const period = data.period || {};
  const periodLabel = `${period.current_label || "-"} vs ${period.previous_label || "-"}`;
  const overviewMetrics = data.overview?.metrics || {};
  const highRisk = data.categories?.high_risk || [];
  const fixedRemaining = data.categories?.fixed_remaining || [];
  const displayedCategories = data.categories?.all_displayed || [...highRisk, ...fixedRemaining];
  const highRiskNames = new Set(highRisk.map((category) => category.category));
  const sections = data.self_invest?.sections || {};
  const selfTabs = [
    ["overall", "整体"],
    ["advantage", "优势引流"],
    ["auto", "自动捡漏"],
    ["sb", "SB"],
    ["sd", "SD"],
  ].filter(([key]) => sections[key]);
  if (!sections[state.ui.weeklySelfTab]) state.ui.weeklySelfTab = selfTabs[0]?.[0] || "overall";
  const activeSelf = sections[state.ui.weeklySelfTab] || {};
  const activeSelfMetrics = activeSelf.metrics || {};
  const selfRows = weeklySelfRows(activeSelf, period);
  const overallRows = weeklyOverviewRows(data);
  const categoryDetailRows = weeklyCategoryRows(displayedCategories, highRiskNames);
  const quality = data.data_quality?.reconciliation_summary || {};
  const overallColumns = [
    { field: "period_label", label: "周期" },
    { field: "front_units", label: "前台销量", numeric: true, render: (v) => weeklyValue(v, "integer") },
    { field: "front_sales", label: "前台销售额", numeric: true, render: (v) => weeklyValue(v, "currency") },
    { field: "ad_spend", label: "广告花费", numeric: true, render: (v) => weeklyValue(v, "currency") },
    { field: "ad_sales", label: "广告销售额", numeric: true, render: (v) => weeklyValue(v, "currency") },
    { field: "coupon_promotion_cost", label: "coupon和促销费用", numeric: true, render: (v) => weeklyValue(v, "currency") },
    { field: "coupon_promotion_rate", label: "coupon和促销费用率", numeric: true, render: (v) => weeklyValue(v, "percent") },
    { field: "acos", label: "ACOS", numeric: true, render: (v) => weeklyValue(v, "percent") },
    { field: "cvr", label: "CVR", numeric: true, render: (v) => weeklyValue(v, "percent") },
    { field: "cpc", label: "CPC", numeric: true, render: (v) => weeklyValue(v, "currency") },
  ];
  const categoryColumns = [
    { field: "category", label: "品类" },
    { field: "attention_type", label: "关注类型" },
    { field: "risk_score", label: "风险分", numeric: true, render: (v) => weeklyValue(v, "number") },
    { field: "front_units", label: "本期销量", numeric: true, render: (v) => weeklyValue(v, "integer") },
    { field: "front_sales", label: "本期销售额", numeric: true, render: (v) => weeklyValue(v, "currency") },
    { field: "ad_spend", label: "本期广告花费", numeric: true, render: (v) => weeklyValue(v, "currency") },
    { field: "ad_sales", label: "本期广告销售额", numeric: true, render: (v) => weeklyValue(v, "currency") },
    { field: "coupon_promotion_cost", label: "coupon和促销费用", numeric: true, render: (v) => weeklyValue(v, "currency") },
    { field: "coupon_promotion_rate", label: "coupon和促销费用率", numeric: true, render: (v) => weeklyValue(v, "percent") },
    { field: "acos", label: "本期 ACOS", numeric: true, render: (v) => weeklyValue(v, "percent") },
    { field: "cvr", label: "本期 CVR", numeric: true, render: (v) => weeklyValue(v, "percent") },
  ];
  const selfColumns = [
    { field: "period_label", label: "时期" },
    { field: "parent_tag", label: "父标签" },
    { field: "child_tag", label: "子标签" },
    { field: "creator", label: "创建人" },
    { field: "campaign_count", label: "活动数", numeric: true, render: (v) => weeklyValue(v, "integer") },
    { field: "impressions", label: "曝光", numeric: true, render: (v) => weeklyValue(v, "integer") },
    { field: "clicks", label: "点击", numeric: true, render: (v) => weeklyValue(v, "integer") },
    { field: "spend", label: "花费", numeric: true, render: (v) => weeklyValue(v, "currency") },
    { field: "ad_sales", label: "广告销售额", numeric: true, render: (v) => weeklyValue(v, "currency") },
    { field: "ad_orders", label: "广告订单", numeric: true, render: (v) => weeklyValue(v, "integer") },
    { field: "acos", label: "ACOS", numeric: true, render: (v) => weeklyValue(v, "percent") },
    { field: "cvr", label: "CVR", numeric: true, render: (v) => weeklyValue(v, "percent") },
  ];
  const sourceNames = (data.source?.files || []).map((file) => file.name).join("、");
  const exchangeRate = data.meta?.exchange_rate_rmb_to_usd;
  const introNote = `JSON生成：${weeklyGeneratedLabel(data.meta?.generated_at)}${exchangeRate ? `；换算汇率 1 USD = ${formatNumber(exchangeRate, 2)} RMB` : ""}`;

  root.innerHTML = `
    ${introMarkup("周度广告复盘", "聚焦销售、广告效率、coupon与促销费用、重点品类和自投广告；页面仅展示脚本已确认的事实。", periodLabel, introNote)}
    <section class="dashboard-section" id="weekly-overview">
      ${sectionHead("总体概览", "六项核心指标同时展示本期、上期和环比；广告花费与coupon和促销费用只显示方向。", periodLabel)}
      <div class="kpi-grid kpi-grid--six">
        ${weeklyKpiCard(overviewMetrics.front_units, "primary", "higher-good")}
        ${weeklyKpiCard(overviewMetrics.front_sales, "teal", "higher-good")}
        ${weeklyKpiCard(overviewMetrics.ad_spend, "orange", "neutral")}
        ${weeklyKpiCard(overviewMetrics.coupon_promotion_cost, "orange", "neutral")}
        ${weeklyKpiCard(overviewMetrics.acos, "red", "lower-good")}
        ${weeklyKpiCard(overviewMetrics.cvr, "primary", "higher-good")}
      </div>
      <div class="weekly-overview-findings">
        <strong>本期已确认现象</strong>
        ${weeklyFactList(data.overview?.confirmed_findings)}
      </div>
    </section>
    <section class="dashboard-section" id="weekly-category">
      ${sectionHead("重点品类", "先展示全部品类中风险最高的4个，再展示去重后的固定关注品类；卡片可折叠。", `${displayedCategories.length} 个品类`)}
      <div class="weekly-category-group">
        <div class="weekly-category-group__head">
          <div><strong>高风险 Top 4</strong><span>来自全部品类，按脚本风险分排序</span></div>
          <span>${highRisk.length} 个</span>
        </div>
        <div class="weekly-category-list">${highRisk.map((category, index) => weeklyCategoryCard(category, { isHighRisk: true, rank: index + 1 })).join("")}</div>
      </div>
      <div class="weekly-category-group">
        <div class="weekly-category-group__head">
          <div><strong>固定关注品类</strong><span>已剔除与高风险 Top 4 重复的品类</span></div>
          <span>${fixedRemaining.length} 个</span>
        </div>
        <div class="weekly-category-list">${fixedRemaining.map((category) => weeklyCategoryCard(category)).join("")}</div>
      </div>
    </section>
    <section class="dashboard-section" id="weekly-self-invest">
      ${sectionHead("自投广告", "按整体、优势引流、自动捡漏、SB 和 SD 切换；比例指标由两期基础数据重新计算。", `${selfRows.length} 条记录`)}
      ${segmentControl("weekly-self-invest", selfTabs, state.ui.weeklySelfTab)}
      <div class="weekly-self-summary">
        ${weeklyMetricCell(activeSelfMetrics.spend, "neutral")}
        ${weeklyMetricCell(activeSelfMetrics.ad_sales, "higher-good")}
        ${weeklyMetricCell(activeSelfMetrics.ad_orders, "higher-good")}
        ${weeklyMetricCell(activeSelfMetrics.acos, "lower-good")}
        ${weeklyMetricCell(activeSelfMetrics.cpc, "lower-good")}
        ${weeklyMetricCell(activeSelfMetrics.cvr, "higher-good")}
      </div>
      <div class="weekly-self-note">
        <strong>已确认现象</strong>
        ${weeklyFactList(activeSelf.confirmed_findings)}
      </div>
      ${tableMarkup(`weekly-self-${state.ui.weeklySelfTab}`, selfRows, selfColumns, 30)}
    </section>
    <section class="dashboard-section" id="weekly-detail">
      ${sectionHead("数据明细", "保留总体两期数据、当前重点品类和当前自投标签明细，便于逐项复核。", `Schema ${data.schema_version || "-"}`, { label: "查看最新 JSON", href: WEEKLY_DATA_URL })}
      <div class="weekly-quality-grid">
        <article class="weekly-quality-card"><span>对账检查</span><strong>${weeklyValue(quality.total_checks, "integer")}</strong><small>全部检查项</small></article>
        <article class="weekly-quality-card is-good"><span>校验通过</span><strong>${weeklyValue(quality.passed, "integer")}</strong><small>允许范围内一致</small></article>
        <article class="weekly-quality-card ${asNumber(quality.mismatches) > 0 ? "is-bad" : "is-good"}"><span>不一致</span><strong>${weeklyValue(quality.mismatches, "integer")}</strong><small>核心不一致会阻止生成</small></article>
        <article class="weekly-quality-card ${asNumber(quality.missing_compare_rows) > 0 ? "is-bad" : "is-good"}"><span>缺少对比行</span><strong>${weeklyValue(quality.missing_compare_rows, "integer")}</strong><small>对比工作簿缺失</small></article>
        <article class="weekly-quality-card is-neutral"><span>无法核验</span><strong>${weeklyValue(quality.unverifiable, "integer")}</strong><small>零分母或原表缺值</small></article>
      </div>
      <div class="weekly-detail-block"><h4>总体两期数据</h4>${tableMarkup("weekly-overall-detail", overallRows, overallColumns, 10)}</div>
      <div class="weekly-detail-block"><h4>品类数据</h4>${tableMarkup("weekly-category-detail", categoryDetailRows, categoryColumns, 30)}</div>
      <div class="weekly-detail-block"><h4>当前自投标签数据</h4>${tableMarkup("weekly-self-detail", selfRows, selfColumns, 30)}</div>
      <div class="weekly-source-note">
        <strong>数据范围说明</strong>
        ${weeklyFactList(data.data_quality?.data_gaps, "暂无已知数据缺口")}
        <p>输入来源：${escapeHtml(sourceNames || "-")}</p>
      </div>
    </section>`;
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

function filterOptions(pageId, config, draft = false) {
  const options = unique(config.options);
  if (!config.linkedTo || !config.ownerCategoryMap) return options;
  const selectedOwners = selectedSet(pageId, config.linkedTo, draft);
  if (selectedOwners.size === 0) return [];
  return options.filter((category) => {
    const categoryOwners = config.ownerCategoryMap.get(category) || new Set();
    return [...categoryOwners].some((owner) => selectedOwners.has(owner));
  });
}

function isAllSelected(pageId, config, draft = false) {
  const options = filterOptions(pageId, config, draft);
  const selected = selectedSet(pageId, config.id, draft);
  return selected.size === options.length && options.every((option) => selected.has(option));
}

function selectedLabel(pageId, config) {
  const set = selectedSet(pageId, config.id, true);
  const options = filterOptions(pageId, config, true);
  if (set.size === options.length && options.every((option) => set.has(option))) return "全部";
  if (set.size === 0) return "已清除";
  if (set.size === 1) return [...set][0];
  return `已选 ${set.size} 项`;
}

const MULTI_SELECT_SEARCH_THRESHOLD = 7;

function normalizeFuzzyText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/规则/g, "")
    .replace(/运营组长|组长|负责人/g, "")
    .replace(/[\s()（）[\]【】{}<>《》/\\._\-·]+/g, "");
}

function fuzzyOptionMatch(option, query) {
  const candidate = normalizeFuzzyText(option);
  const needle = normalizeFuzzyText(query);
  if (!needle) return true;
  if (candidate.includes(needle) || needle.includes(candidate)) return true;
  let matched = 0;
  for (const character of candidate) {
    if (character === needle[matched]) matched += 1;
    if (matched === needle.length) return true;
  }
  return false;
}

function multiSelectSearchMarkup(options) {
  if (options.length < MULTI_SELECT_SEARCH_THRESHOLD) return "";
  return `
    <div class="multi-select__search-wrap">
      <input class="multi-select__search" type="search" placeholder="搜索选项" aria-label="搜索筛选选项" autocomplete="off" />
      <span class="multi-select__search-count">${options.length} 项</span>
    </div>`;
}

function multiSelectMenuMarkup(options, selected) {
  return `
    ${multiSelectSearchMarkup(options)}
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
    <div class="multi-select__empty is-hidden">未找到匹配选项</div>`;
}

function filterMarkup(pageId, configs, searchConfig = null, note = "") {
  initializeFilters(pageId, configs);
  const fields = configs.map((config) => {
    const options = filterOptions(pageId, config, true);
    const selected = selectedSet(pageId, config.id, true);
    return `
      <div class="filter-field">
        <span class="filter-field__label">${escapeHtml(config.label)}</span>
        <div class="multi-select" data-filter-id="${escapeHtml(config.id)}">
          <button type="button" class="multi-select__button" aria-expanded="false">
            ${escapeHtml(selectedLabel(pageId, config))}
          </button>
          <div class="multi-select__menu is-hidden">
            ${multiSelectMenuMarkup(options, selected)}
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

function detailSearchMarkup(pageId, { label, placeholder }) {
  return `
    <div class="detail-search" data-page-filter="${escapeHtml(pageId)}">
      <div class="filter-field">
        <label for="${pageId}-detail-search">${escapeHtml(label)}</label>
        <input class="search-input" id="${pageId}-detail-search" type="search"
          placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(state.searchDraft[pageId] || "")}" />
      </div>
      <button type="button" class="button button--primary" data-filter-query>查询</button>
      <button type="button" class="button" data-search-clear>清除关键词</button>
    </div>`;
}

function invalidDetailFilterMarkup() {
  const pageId = "invalid_low_efficiency";
  const range = state.invalidDetailDays;
  return `
    <div class="detail-search invalid-detail-combined-filter"
      data-page-filter="${pageId}" data-invalid-detail-filter>
      <div class="filter-field invalid-detail-keyword-field">
        <label for="${pageId}-detail-search">广告活动关键词</label>
        <input class="search-input" id="${pageId}-detail-search" data-invalid-detail-keyword type="search"
          placeholder="搜索广告活动、广告组合或标签"
          value="${escapeHtml(state.invalidDetailSearch.draft)}" />
      </div>
      <div class="filter-field">
        <label for="invalid-days-min">投放天数大于</label>
        <input class="search-input" id="invalid-days-min" data-invalid-days-min type="number"
          min="0" step="1" placeholder="输入天数" value="${escapeHtml(range.minDraft)}" />
      </div>
      <div class="filter-field">
        <label for="invalid-days-max">投放天数小于</label>
        <input class="search-input" id="invalid-days-max" data-invalid-days-max type="number"
          min="0" step="1" placeholder="输入天数" value="${escapeHtml(range.maxDraft)}" />
      </div>
      <button type="button" class="button button--primary" data-invalid-detail-query>查询</button>
      <button type="button" class="button" data-invalid-detail-clear>清除</button>
      <span class="invalid-detail-filter__note">关键词和投放天数仅应用于本明细及下载结果</span>
    </div>`;
}

function initializeDetailFilter(filterId, options) {
  if (state.detailFilters[filterId]) return state.detailFilters[filterId];
  const values = [...new Set(options.filter((value) => value !== null && value !== undefined && value !== ""))];
  state.detailFilters[filterId] = {
    options: values,
    ruleDraft: new Set(values),
    ruleApplied: new Set(values),
    searchDraft: "",
    searchApplied: "",
  };
  return state.detailFilters[filterId];
}

function detailSelectedLabel(detailState) {
  if (detailState.ruleDraft.size === detailState.options.length) return "全部";
  if (detailState.ruleDraft.size === 0) return "已清除";
  if (detailState.ruleDraft.size === 1) return [...detailState.ruleDraft][0];
  return `已选 ${detailState.ruleDraft.size} 项`;
}

function detailFilterMarkup(filterId, { options, searchLabel, placeholder }) {
  const detailState = initializeDetailFilter(filterId, options);
  return `
    <div class="detail-search detail-filter-bar" data-detail-filter="${escapeHtml(filterId)}">
      <div class="filter-field">
        <span class="filter-field__label">规则类别（多选）</span>
        <div class="multi-select" data-filter-id="rule">
          <button type="button" class="multi-select__button" aria-expanded="false">${escapeHtml(detailSelectedLabel(detailState))}</button>
          <div class="multi-select__menu is-hidden">
            ${multiSelectSearchMarkup(detailState.options)}
            <div class="multi-select__tools">
              <button type="button" class="link-button" data-select-action="all">全选</button>
              <button type="button" class="link-button" data-select-action="clear">清除</button>
            </div>
            <div class="multi-select__options">
              ${detailState.options.map((option) => `
                <label class="check-option">
                  <input type="checkbox" value="${escapeHtml(option)}" ${detailState.ruleDraft.has(option) ? "checked" : ""} />
                  <span>${escapeHtml(option)}</span>
                </label>`).join("")}
            </div>
            <div class="multi-select__empty is-hidden">未找到匹配选项</div>
          </div>
        </div>
      </div>
      <div class="filter-field">
        <label for="${escapeHtml(filterId)}-detail-search">${escapeHtml(searchLabel)}</label>
        <input class="search-input" id="${escapeHtml(filterId)}-detail-search" type="search"
          placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(detailState.searchDraft)}" />
      </div>
      <button type="button" class="button button--primary" data-detail-query>查询</button>
      <button type="button" class="button" data-detail-search-clear>清除关键词</button>
    </div>`;
}

function detailSearchMatches(filterId, row, fields) {
  const query = (state.detailFilters[filterId]?.searchApplied || "").trim().toLowerCase();
  if (!query) return true;
  return fields.some((field) => String(row[field] ?? "").toLowerCase().includes(query));
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
  return `<div class="compare-list ${options.wrapLabels ? "compare-list--wrap-labels" : ""}">${rows.map((row) => {
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
  const scaleMax = options.scaleMax ? asNumber(options.scaleMax) : max / (options.maxFillRatio || 0.86);
  const formatter = options.formatter || ((value) => formatCompact(value));
  const chart = `<div class="vertical-chart ${escapeHtml(options.className || "")}">${rows.map((row) => {
    const previous = asNumber(row.previous);
    const current = asNumber(row.current);
    const previousLabelClass = options.staggerLabelsByValue && previous >= current ? "is-label-high" : "";
    const currentLabelClass = options.staggerLabelsByValue && current > previous ? "is-label-high" : "";
    return `
      <div class="vertical-group">
        <div class="vertical-bars">
          ${previousVisible ? `<div class="vertical-bar ${previousLabelClass}" style="height:${Math.max(2, Math.abs(previous) / scaleMax * 100)}%"><span>${formatter(previous)}</span></div>` : ""}
          ${currentVisible ? `<div class="vertical-bar is-current ${currentLabelClass}" style="height:${Math.max(2, Math.abs(current) / scaleMax * 100)}%"><span>${formatter(current)}</span></div>` : ""}
        </div>
        <div class="vertical-group__label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</div>
      </div>`;
  }).join("")}</div>`;
  if (!options.showYAxis) return chart;
  const axisFormatter = options.axisFormatter || formatter;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return `<div class="vertical-chart-frame">
    <div class="vertical-axis" aria-hidden="true">
      ${ticks.map((ratio) => `<span style="bottom:${ratio * 100}%">${axisFormatter(scaleMax * ratio)}</span>`).join("")}
    </div>
    ${chart}
  </div>`;
}

function horizontalBarChart(rows, options = {}) {
  if (!rows.length) return emptyState();
  const max = options.max || Math.max(...rows.map((row) => Math.abs(asNumber(row.value))), 1);
  const formatter = options.formatter || ((value) => formatNumber(value, 2));
  const axisFormatter = options.axisFormatter || formatter;
  const axis = options.showAxis ? `<div class="chart-axis chart-axis--hbar">
    <span></span>
    <div class="chart-axis__ticks">${[0, 0.25, 0.5, 0.75, 1].map((ratio) => `<span style="left:${ratio * 100}%">${axisFormatter(max * ratio)}</span>`).join("")}</div>
    <span></span>
  </div>` : "";
  return `<div class="hbar-chart">${axis}${rows.map((row) => `
    <div class="hbar-row">
      <div class="hbar-row__label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(0, Math.min(100, Math.abs(asNumber(row.value)) / max * 100))}%"></div></div>
      <div class="hbar-value">${formatter(row.value)}</div>
    </div>`).join("")}</div>`;
}

function dumbbellChart(rows, options = {}) {
  if (!rows.length) return emptyState();
  const isValid = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && (!options.hideNonPositive || Number(value) > 0);
  const allValues = rows.flatMap((row) => [row.previous, row.current]).filter(isValid).map(Number);
  const min = options.min ?? Math.min(0, ...allValues);
  const max = options.max ?? Math.max(...allValues, 1);
  const range = max - min || 1;
  const formatter = options.formatter || ((value) => formatNumber(value, 2));
  const differenceFormatter = options.differenceFormatter || formatter;
  const axisFormatter = options.axisFormatter || formatter;
  const valueLabels = options.valueLabels || ["批量", "品类平均", "差值"];
  const axisTrack = options.adaptiveRowScale
    ? '<div class="adaptive-axis">各行按自身 ACoS 区间自适应缩放</div>'
    : `<div class="chart-axis__ticks">${[0, 0.25, 0.5, 0.75, 1].map((ratio) => `<span style="left:${ratio * 100}%">${axisFormatter(min + range * ratio)}</span>`).join("")}</div>`;
  const axis = options.showAxis ? `<div class="chart-axis chart-axis--dumbbell">
    <span></span>
    ${axisTrack}
    <div class="dumbbell-axis__values"><span>${escapeHtml(valueLabels[0])}</span><span>${escapeHtml(valueLabels[1])}</span><strong>${escapeHtml(valueLabels[2])}</strong></div>
  </div>` : "";
  return `<div class="dumbbell-chart">${axis}${rows.map((row) => {
    const previousValid = isValid(row.previous);
    const currentValid = isValid(row.current);
    const previous = previousValid ? Number(row.previous) : null;
    const current = currentValid ? Number(row.current) : null;
    const difference = previousValid && currentValid
      ? (row.difference === undefined ? current - previous : Number(row.difference))
      : null;
    let previousPos = previousValid ? (previous - min) / range * 100 : 0;
    let currentPos = currentValid ? (current - min) / range * 100 : 0;
    if (options.adaptiveRowScale) {
      if (previousValid && currentValid) {
        const rowMinimum = Math.min(previous, current);
        const rowMaximum = Math.max(previous, current);
        const delta = rowMaximum - rowMinimum;
        const padding = Math.max(delta * 0.5, rowMaximum * 0.01, options.adaptiveMinPadding || 0.05);
        const rowMin = Math.max(options.adaptiveFloor ?? -Infinity, rowMinimum - padding);
        const rowMax = rowMaximum + padding;
        const rowRange = rowMax - rowMin || 1;
        previousPos = (previous - rowMin) / rowRange * 100;
        currentPos = (current - rowMin) / rowRange * 100;
      } else {
        previousPos = previousValid ? 50 : 0;
        currentPos = currentValid ? 50 : 0;
      }
    }
    const overlap = previousValid && currentValid && Math.abs(previousPos - currentPos) < 2;
    const left = Math.min(previousPos, currentPos);
    const width = Math.abs(previousPos - currentPos);
    let differenceClass = difference === null ? "is-neutral" : difference > 0 ? "is-good" : difference < 0 ? "is-bad" : "is-neutral";
    if (options.differenceTone === "higher-is-bad") differenceClass = difference > 0 ? "is-bad" : "is-dark";
    return `
      <div class="dumbbell-row">
        <div class="dumbbell-row__label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</div>
        <div class="dumbbell-track">
          ${previousValid && currentValid ? `<span class="dumbbell-line" style="left:${left}%;width:${width}%"></span>` : ""}
          ${previousValid ? `<span class="dumbbell-dot ${overlap ? "is-offset-up" : ""}" style="left:${previousPos}%"></span>` : ""}
          ${currentValid ? `<span class="dumbbell-dot is-current ${overlap ? "is-offset-down" : ""}" style="left:${currentPos}%"></span>` : ""}
        </div>
        <div class="dumbbell-values">
          <span>${previousValid ? formatter(previous) : "-"}</span>
          <span>${currentValid ? formatter(current) : "-"}</span>
          <strong class="acos-difference ${differenceClass}">${difference === null ? "-" : differenceFormatter(difference)}</strong>
        </div>
      </div>`;
  }).join("")}</div>`;
}

function numericComparisonTable(rows, options = {}) {
  if (!rows.length) return emptyState();
  const formatter = options.formatter || ((value) => formatNumber(value, 2));
  const differenceFormatter = options.differenceFormatter || formatter;
  const labels = options.valueLabels || ["5月", "6月", "变化"];
  return `<div class="numeric-compare-table">
    <div class="numeric-compare-row is-header">
      <span>运营组长</span><span>${escapeHtml(labels[0])}</span><span>${escapeHtml(labels[1])}</span><span>${escapeHtml(labels[2])}</span>
    </div>
    ${rows.map((row) => {
      const previous = asNumber(row.previous);
      const current = asNumber(row.current);
      const difference = row.difference === undefined ? current - previous : asNumber(row.difference);
      const differenceClass = options.differenceTone === "higher-is-bad"
        ? (difference > 0 ? "is-bad" : difference < 0 ? "is-dark" : "is-neutral")
        : (difference > 0 ? "is-good" : difference < 0 ? "is-bad" : "is-neutral");
      return `<div class="numeric-compare-row">
        <strong>${escapeHtml(row.label)}</strong>
        <span class="is-previous">${formatter(previous)}</span>
        <span class="is-current">${formatter(current)}</span>
        <span class="acos-difference ${differenceClass}">${differenceFormatter(difference)}</span>
      </div>`;
    }).join("")}
  </div>`;
}

function triggerReason(row) {
  const previous = asNumber(row.上周期触发次数);
  const current = asNumber(row.本周期触发次数);
  if (current > previous) return "规则触发次数大幅增长";
  if (current < previous) return "规则触发次数大幅下降";
  return "规则触发次数变化较大";
}

function niceFractionMax(values) {
  const maximum = Math.max(...values.map((value) => Math.max(0, asNumber(value))), 0);
  const percent = maximum * 100;
  const step = percent <= 20 ? 5 : percent <= 50 ? 10 : 20;
  return Math.min(1, Math.max(step / 100, Math.ceil(percent / step) * step / 100));
}

function formatSignedFractionPercent(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = asNumber(value) * 100;
  const sign = number > 0 ? "+" : number < 0 ? "-" : "";
  return `${sign}${formatNumber(Math.abs(number), 2)}%`;
}

function formatSignedPercentPoints(value) {
  if (value === null || value === undefined || value === "") return "-";
  const number = asNumber(value);
  const sign = number > 0 ? "+" : number < 0 ? "-" : "";
  return `${sign}${formatNumber(Math.abs(number), 2)}%`;
}

function segmentControl(id, options, active) {
  return `<div class="segment-control" data-segment="${escapeHtml(id)}">${options.map(([value, label]) => `
    <button type="button" class="segment-button ${value === active ? "is-active" : ""}" data-segment-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join("")}</div>`;
}

function tagMarkup(value) {
  const text = String(value ?? "-");
  let className = "";
  if (["异常升高", "无效", "广告活动超预算", "广告组合超预算"].includes(text)) className = "is-danger";
  if (["触发偏低", "触发次数变化较大", "低效", "广告活动已暂停"].includes(text)) className = "is-warning";
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
    const classes = [
      column.numeric ? "cell-number" : "",
      column.long ? "cell-long" : "",
      column.wrap ? "cell-wrap" : "",
    ].filter(Boolean).join(" ");
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

function categoryOwnerMap(rows, categoryField, ownerField, splitter = null) {
  const mapping = new Map();
  rows.forEach((row) => {
    const owner = row[ownerField];
    const categories = splitter
      ? String(row[categoryField] || "").split(splitter).map((value) => value.trim()).filter(Boolean)
      : [row[categoryField]];
    categories.forEach((category) => {
      if (!category || !owner) return;
      if (!mapping.has(category)) mapping.set(category, new Set());
      mapping.get(category).add(owner);
    });
  });
  return mapping;
}

function monthlyFilterConfig(data) {
  const ownerCategoryMap = categoryOwnerMap(data.category_overview || [], "品类", "运营组长");
  return [
    { id: "owner", label: "运营组长", options: data.filters?.运营组长 || data.category_overview.map((row) => row.运营组长) },
    { id: "category", label: "业务品类", options: data.filters?.品类 || data.category_overview.map((row) => row.品类), linkedTo: "owner", ownerCategoryMap },
  ];
}

function sdSpendFilterConfig(data) {
  const sdData = data.sd_spend || {};
  return [
    { id: "month", label: "月份", options: sdData.filters?.月份 || [] },
    {
      id: "owner",
      label: "运营组长",
      options: sdData.filters?.运营组长 || unique((sdData.rows || []).map((row) => row.运营组长).filter(Boolean)),
    },
  ];
}

function formatMonth(value) {
  const text = String(value || "");
  return /^\d{6}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4)}` : text;
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
  const salesCategories = [...categoryRows].sort((a, b) => b.本月销售额 - a.本月销售额).slice(0, 15);
  const totalCategorySpend = sum(categoryRows, "本月花费");
  const spendChart = verticalCompareChart(topCategories.map((row) => ({ label: row.品类, previous: row.上月花费, current: row.本月花费 })), {
    formatter: (v) => formatCurrency(v, true),
    axisFormatter: (v) => formatCurrency(v, true),
    className: "vertical-chart--category",
    showYAxis: true,
    staggerLabelsByValue: true,
  });
  const salesChart = verticalCompareChart(salesCategories.map((row) => ({ label: row.品类, previous: row.上月销售额, current: row.本月销售额 })), {
    formatter: (v) => formatCurrency(v, true),
    axisFormatter: (v) => formatCurrency(v, true),
    className: "vertical-chart--category",
    showYAxis: true,
    staggerLabelsByValue: true,
  });
  const shareChart = horizontalBarChart(topCategories.map((row) => ({ label: row.品类, value: safeDivide(row.本月花费, totalCategorySpend) })), { max: niceFractionMax(topCategories.map((row) => safeDivide(row.本月花费, totalCategorySpend))), showAxis: true, formatter: (v) => formatPercent(v, true), axisFormatter: (v) => formatPercent(v, true, 0) });
  let categoryChart = "";
  let categoryTitle = "全部品类对比";
  if (state.ui.monthlyCategoryTab === "spend") {
    categoryTitle = "品类广告花费对比";
    categoryChart = spendChart;
  } else if (state.ui.monthlyCategoryTab === "sales") {
    categoryTitle = "品类广告销售额对比";
    categoryChart = salesChart;
  } else if (state.ui.monthlyCategoryTab === "share") {
    categoryTitle = "本月品类花费占比";
    categoryChart = shareChart;
  } else {
    categoryChart = `<div class="category-chart-stack">
      <div class="category-chart-block"><h4>花费对比</h4>${spendChart}</div>
      <div class="category-chart-block"><h4>销售额对比</h4>${salesChart}</div>
      <div class="category-chart-block"><h4>花费占比</h4>${shareChart}</div>
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
    { field: "花费环比", label: "花费环比", numeric: true, render: (v) => v === null ? "新增" : formatSignedFractionPercent(v) },
  ];
  const sdData = data.sd_spend || { rows: [], filters: {} };
  const sdConfigs = sdSpendFilterConfig(data);
  initializeFilters("sd_spend", sdConfigs);
  const sdRows = (sdData.rows || []).filter((row) => rowMatches("sd_spend", row, {
    month: "时间月",
    owner: "运营组长",
  })).sort((a, b) => String(b.时间日).localeCompare(String(a.时间日)) || asNumber(b.金额) - asNumber(a.金额));
  const sdOwnerSummary = aggregateBy(sdRows, "运营组长", {
    金额: (row) => row.金额,
  }).sort((a, b) => b.金额 - a.金额);
  const sdKpis = [
    kpiCard({ label: "SD总花费", value: sum(sdRows, "金额"), valueType: "yuan", tone: "primary", note: "当前筛选范围" }),
    kpiCard({ label: "覆盖 SKU", value: unique(sdRows.map((row) => row.平台SKU)).length, valueType: "integer", tone: "teal", note: "平台SKU去重" }),
    kpiCard({ label: "运营组长数", value: unique(sdRows.map((row) => row.运营组长)).length, valueType: "integer", tone: "orange", note: "当前筛选范围" }),
    kpiCard({ label: "覆盖品类", value: unique(sdRows.map((row) => row.品类)).length, valueType: "integer", tone: "red", note: "品类去重" }),
    kpiCard({ label: "覆盖天数", value: unique(sdRows.map((row) => row.时间日)).length, valueType: "integer", tone: "green", note: "有SD花费记录的日期" }),
  ].join("");
  const sdColumns = [
    { field: "时间月", label: "月份", render: (v) => escapeHtml(formatMonth(v)) },
    { field: "时间日", label: "日期" },
    { field: "店铺", label: "店铺" },
    { field: "平台SKU", label: "平台 SKU", long: true },
    { field: "渠道", label: "渠道" },
    { field: "金额", label: "SD花费", numeric: true, render: (v) => formatYuan(v) },
    { field: "币种", label: "币种" },
    { field: "运营", label: "运营" },
    { field: "运营组长", label: "运营组长" },
    { field: "品类", label: "品类", long: true },
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
          <div class="chart-title-row"><div><h4>ACoS 数值对比</h4><p>直接比较两个月数值及百分点变化</p></div></div>
          ${numericComparisonTable(ownerRows.map((row) => ({ label: row.运营组长, previous: row.上月ACOS, current: row.本月ACOS })), {
            valueLabels: ["5月", "6月", "变化"],
            formatter: (v) => formatPercent(v),
            differenceFormatter: formatSignedPercentPoints,
            differenceTone: "higher-is-bad",
          })}
        </div>
      </div>
      <div style="height:14px"></div>
      ${tableMarkup("monthly-owner-table", ownerRows, ownerColumns, 30)}
    </section>
    <section class="dashboard-section" id="monthly-sd-spend">
      ${sectionHead("SD花费核对", "固定统计损益科目为“广告花费-SD”的流水，用于按月份和运营组长核对花费。", `${sdRows.length} 条`)}
      ${filterMarkup("sd_spend", sdConfigs, null, `${sdRows.length} 条SD花费记录`)}
      <div class="kpi-grid">${sdRows.length ? sdKpis : emptyState()}</div>
      <div class="chart-panel chart-panel--full">
        <div class="chart-title-row"><div><h4>运营组长SD花费排名</h4><p>按当前筛选范围汇总，金额单位为人民币</p></div></div>
        ${horizontalBarChart(sdOwnerSummary.slice(0, 15).map((row) => ({ label: row.运营组长, value: row.金额 })), { formatter: (v) => formatYuan(v) })}
      </div>
      <div style="height:14px"></div>
      ${tableMarkup("monthly-sd-spend-table", sdRows, sdColumns, 50)}
      <div class="method-note">数据源：SD花费提取.xlsx；固定筛选“损益科目 = 广告花费-SD”。页面金额统一保留两位小数。</div>
    </section>`;
}

function invalidFilterConfig(data) {
  const ownerCategoryMap = categoryOwnerMap([
    ...(data.invalid_details || []),
    ...(data.inefficient_details || []),
    ...(data.savings_by_category || []),
  ], "父标签", "运营组长");
  return [
    { id: "owner", label: "运营组长", options: data.filters.运营组长 || [] },
    { id: "category", label: "品类", options: data.filters.品类 || [], linkedTo: "owner", ownerCategoryMap },
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
  }));
}

function selectedInvalidDetailRows(invalidRows, inefficientRows) {
  const rows = [];
  if (state.ui.invalidDetailTab !== "inefficient") rows.push(...invalidRows);
  if (state.ui.invalidDetailTab !== "invalid") rows.push(...inefficientRows);
  const query = state.invalidDetailSearch.applied.trim().toLowerCase();
  const { minApplied, maxApplied } = state.invalidDetailDays;
  return rows.filter((row) => {
    if (query && !["广告活动", "广告组合", "标签"].some(
      (field) => String(row[field] ?? "").toLowerCase().includes(query),
    )) return false;
    if (minApplied === null && maxApplied === null) return true;
    const days = Number(row.投放天数);
    if (!Number.isFinite(days)) return false;
    if (minApplied !== null && days <= minApplied) return false;
    if (maxApplied !== null && days >= maxApplied) return false;
    return true;
  }).sort((a, b) => asNumber(b.花费) - asNumber(a.花费));
}

const INVALID_DETAIL_EXPORT_COLUMNS = [
  { field: "复盘标签", label: "复盘标签" },
  { field: "父标签", label: "品类" },
  { field: "运营组长", label: "运营组长" },
  { field: "类型", label: "广告类型" },
  { field: "服务状态", label: "服务状态" },
  { field: "投放天数", label: "投放天数", integer: true },
  { field: "广告活动", label: "广告活动" },
  { field: "花费", label: "花费", digits: 2 },
  { field: "曝光量", label: "曝光量", integer: true },
  { field: "点击", label: "点击", integer: true },
  { field: "广告订单", label: "广告订单", integer: true },
  { field: "广告销售额", label: "广告销售额", digits: 2 },
  { field: "ACoS", label: "ACoS" },
];

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportDetailValue(row, column) {
  const value = row[column.field];
  if (column.integer) return Math.round(asNumber(value));
  if (column.digits !== undefined) return asNumber(value).toFixed(column.digits);
  return value ?? "";
}

function downloadInvalidDetailCsv() {
  const data = state.data?.invalid_low_efficiency;
  if (!data) return;
  const invalidRows = filterInvalidDetail(data.invalid_details || []);
  const inefficientRows = filterInvalidDetail(data.inefficient_details || []);
  const rows = selectedInvalidDetailRows(invalidRows, inefficientRows);
  if (!rows.length) {
    showToast("当前筛选条件下没有可下载的明细");
    return;
  }

  const header = INVALID_DETAIL_EXPORT_COLUMNS.map((column) => csvCell(column.label)).join(",");
  const body = rows.map((row) => INVALID_DETAIL_EXPORT_COLUMNS
    .map((column) => csvCell(exportDetailValue(row, column)))
    .join(","));
  const blob = new Blob([`\ufeff${[header, ...body].join("\r\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const scope = { all: "全部", invalid: "无效", inefficient: "低效" }[state.ui.invalidDetailTab] || "全部";
  const link = document.createElement("a");
  link.href = url;
  link.download = `无效低效广告活动明细_${scope}_${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`已下载 ${formatNumber(rows.length, 0)} 条明细`);
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

  const detailRows = selectedInvalidDetailRows(invalidRows, inefficientRows);

  const detailColumns = [
    { field: "复盘标签", label: "复盘标签", render: (v) => tagMarkup(v) },
    { field: "父标签", label: "品类" },
    { field: "运营组长", label: "运营组长" },
    { field: "类型", label: "广告类型" },
    { field: "服务状态", label: "服务状态", render: (v) => tagMarkup(v) },
    { field: "投放天数", label: "投放天数", numeric: true, render: (v) => `${formatNumber(v, 0)} 天` },
    { field: "广告活动", label: "广告活动", long: true },
    { field: "花费", label: "花费", numeric: true, render: (v) => formatCurrency(v) },
    { field: "曝光量", label: "曝光量", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "点击", label: "点击", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "广告订单", label: "广告订单", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "广告销售额", label: "广告销售额", numeric: true, render: (v) => formatCurrency(v) },
    { field: "ACoS", label: "ACoS", numeric: true, wrap: true },
  ];

  root.innerHTML = `
    ${introMarkup("无效低效广告复盘", "低效定义：有效状态=enabled 且 投放天数>14天 且 ACOS>50%；无效定义：有效状态=enabled 且 投放天数>7天 且 花费>0 且 订单=0", "2026年6月")}
    <div class="kpi-grid kpi-grid--six">
      ${kpiCard({ label: "无效广告活动", value: invalidRows.length, valueType: "integer", tone: "red", note: `花费 ${formatCurrency(invalidSpend)}` })}
      ${kpiCard({ label: "低效广告活动", value: inefficientRows.length, valueType: "integer", tone: "orange", note: `花费 ${formatCurrency(inefficientSpend)}` })}
      ${kpiCard({ label: "节约广告花费", value: saving, valueType: "currency", tone: "green", note: "按品类与运营组长筛选" })}
      ${kpiCard({ label: "节约占总花费比例", value: safeDivide(saving, totalSpend) * 100, valueType: "percent", tone: "teal", note: `本月总花费 ${formatCurrency(totalSpend, true)}` })}
      ${kpiCard({ label: "关停/归档活动", value: data.totals["本月关停/归档广告活动数量"], valueType: "integer", tone: "primary", note: "本月汇总" })}
      ${kpiCard({ label: "无效与低效花费", value: invalidSpend + inefficientSpend, valueType: "currency", tone: "orange", note: "当前筛选范围" })}
    </div>
    ${filterMarkup("invalid_low_efficiency", configs, null, `${invalidRows.length + inefficientRows.length} 条活动`)}
    <section class="dashboard-section" id="invalid-analysis">
      ${sectionHead("无效广告分析", "有花费无销售额的广告活动。", `${invalidRows.length} 条`)}
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
      ${sectionHead("低效广告分析", "有订单但 ACoS 偏高的广告活动。", `${inefficientRows.length} 条`)}
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
      ${sectionHead("节约花费视角", "本区块不受广告类型与服务状态筛选影响。", `${filteredSavingsCategory.length} 个品类`)}
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
      <div class="invalid-detail-toolbar">
        <div class="invalid-detail-toolbar__main">
          ${sectionHead("广告活动明细", "无效与低效结果分页展示，便于定位广告活动。", `${detailRows.length} 条`)}
          ${invalidDetailFilterMarkup()}
        </div>
        <div class="invalid-detail-download">
          <div>
            <strong>下载筛选结果</strong>
            <span>导出当前筛选命中的全部 ${formatNumber(detailRows.length, 0)} 条明细，不受分页限制。</span>
          </div>
          <button type="button" class="button button--download" data-invalid-detail-download ${detailRows.length ? "" : "disabled"}>下载表格</button>
        </div>
      </div>
      <div class="chart-title-row">
        <div></div>
        ${segmentControl("invalid-detail", [["all", "全部"], ["invalid", "无效"], ["inefficient", "低效"]], state.ui.invalidDetailTab)}
      </div>
      ${tableMarkup("invalid-detail-table", detailRows, detailColumns, 50)}
    </section>`;
}

function lingxingFilterConfig(data) {
  const filters = data.summary.filters;
  const ownerCategoryMap = categoryOwnerMap(data.summary.trigger_monitor.detail || [], "品类", "运营组长");
  return [
    { id: "month", label: "月份", options: filters.月份 || ["5月", "6月"] },
    { id: "owner", label: "运营组长", options: filters.运营组长 || [] },
    { id: "category", label: "品类", options: filters.品类 || [], linkedTo: "owner", ownerCategoryMap },
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

function ruleQueryFilterConfig(data) {
  const ruleQuery = data.rule_query || { rows: [], filters: {} };
  const filters = ruleQuery.filters || {};
  const ownerCategoryMap = categoryOwnerMap(ruleQuery.rows || [], "品类", "运营组长");
  return [
    { id: "owner", label: "运营组长", options: filters.运营组长 || [] },
    { id: "category", label: "品类", options: filters.品类 || [], linkedTo: "owner", ownerCategoryMap },
    { id: "adType", label: "广告类型", options: filters.广告类型 || [] },
    { id: "ruleCategory", label: "规则类别", options: filters.规则类别 || [] },
  ];
}

function filteredRuleQueryRows(data) {
  return (data.rule_query?.rows || []).filter((row) => rowMatches("lingxing_rule_query", row, {
    owner: "运营组长",
    category: "品类",
    adType: "广告类型",
    ruleCategory: "规则类别",
  })).sort((a, b) => String(a.品类).localeCompare(String(b.品类), "zh-CN")
    || String(a.广告类型).localeCompare(String(b.广告类型), "zh-CN")
    || String(a.规则类别).localeCompare(String(b.规则类别), "zh-CN"));
}

function renderLingxing() {
  const data = state.data.lingxing_rules;
  const configs = lingxingFilterConfig(data);
  initializeFilters("lingxing_rules", configs);
  const ruleQueryConfigs = ruleQueryFilterConfig(data);
  initializeFilters("lingxing_rule_query", ruleQueryConfigs);
  const detailFilter = initializeDetailFilter("lingxing_rules_detail", ["关键词/PAT暂停", "产品(ASIN)暂停", "否词"]);
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
  const alerts = triggerRows.filter((row) => asNumber(row.上周期触发次数) > 0
      && ["触发偏低", "异常升高", "异常降低", "无触发"].includes(row.状态))
    .sort((a, b) => Math.abs(asNumber(b.增长偏离基准)) - Math.abs(asNumber(a.增长偏离基准)));

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
    }) && detailFilter.ruleApplied.size > 0
      && detailFilter.ruleApplied.has(row.规则类别)
      && detailSearchMatches("lingxing_rules_detail", row, ["广告活动", "标签"]);
  }).sort((a, b) => String(b.触发日期).localeCompare(String(a.触发日期)));

  const detailSummary = {
    campaigns: new Set(detailRows.map((row) => row.广告活动).filter(Boolean)).size,
    spend: sum(detailRows, "花费"),
    orders: sum(detailRows, "订单"),
    sales: sum(detailRows, "销售额"),
    saving: sum(detailRows, "主理论节费"),
  };

  const detailColumns = [
    { field: "月份", label: "月份" },
    { field: "触发日期", label: "触发日期" },
    { field: "品类", label: "品类" },
    { field: "运营组长", label: "运营组长" },
    { field: "规则类别", label: "规则类别", render: (v) => tagMarkup(v) },
    { field: "规则大类", label: "规则大类" },
    { field: "原始规则名", label: "原始规则名", long: true },
    { field: "广告活动", label: "广告活动", long: true },
    { field: "标签", label: "标签", long: true },
    { field: "优化对象", label: "优化对象" },
    { field: "对象明细", label: "对象明细", long: true },
    { field: "命中取值", label: "命中取值", long: true },
    { field: "主理论节费", label: "主理论节费", numeric: true, render: (v) => v === "-" ? "-" : formatCurrency(v) },
    { field: "节费去重状态", label: "节费去重状态", render: (v) => tagMarkup(v) },
    { field: "节费来源口径", label: "节费来源口径", long: true },
  ];
  const ruleQueryRows = filteredRuleQueryRows(data);
  const ruleQueryColumns = [
    { field: "品类", label: "品类" },
    { field: "广告类型", label: "广告类型" },
    { field: "运营组长", label: "运营组长" },
    { field: "广告组负责人", label: "广告组负责人" },
    { field: "规则", label: "规则", long: true },
    { field: "规则类别", label: "规则类别" },
    { field: "针对标签", label: "针对标签（默认全部）", long: true, render: (v) => v ? escapeHtml(v) : "默认全部" },
    { field: "覆盖周期", label: "覆盖周期" },
    { field: "通知邮箱", label: "通知邮箱", long: true },
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
    description: "仅计算产品和关键词/PAT暂停的理论节费",
    value: currentVisible ? mainSaving.current : mainSaving.previous,
    previous: previousVisible && currentVisible ? mainSaving.previous : null,
    valueType: "currency",
    tone: "green",
    note: "",
  });

  root.innerHTML = `
    ${introMarkup("领星自动化规则复盘", "监控规则触发变化、理论控费规模和异常品类，理论节费不等同实际利润。", "2026年5月 vs 6月", "规则触发总数、Top 排名及异常监控默认剔除指定低曝光 CPC 增投触发。")}
    <div class="kpi-grid kpi-grid--six">${kpis}</div>
    ${filterMarkup("lingxing_rules", configs, null, `${triggerRows.length} 个监控组合`)}
    <section class="dashboard-section" id="trigger-monitor">
      ${sectionHead("规则触发监控", "对比同品类、同规则与整体变化基准，关注触发次数明显偏离的规则。", `${alerts.length} 个待关注组合`)}
      <div class="chart-grid">
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>触发次数 Top 品类</h4></div>${legendMarkup()}</div>
          ${verticalCompareChart(categoryRows.slice(0, 14).map((row) => ({ label: row.品类, previous: row.previous, current: row.current })), { previousVisible, currentVisible, formatter: (v) => formatCompact(v) })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>规则类别触发对比</h4></div>${legendMarkup()}</div>
          ${compareList(ruleRows.slice(0, 12).map((row) => ({ label: row.规则类别, previous: row.previous, current: row.current, formatter: (v) => formatNumber(v, 0) })), { previousVisible, currentVisible, wrapLabels: true })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>运营组长触发对比</h4></div>${legendMarkup()}</div>
          ${verticalCompareChart(ownerRows.map((row) => ({ label: row.运营组长, previous: row.previous, current: row.current })), { previousVisible, currentVisible, formatter: (v) => formatCompact(v) })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>触发次数变化较大的规则</h4><p>不包含上周期未触发、本周期新增触发的规则</p></div></div>
          <div class="alert-list">
            ${alerts.length ? alerts.slice(0, 10).map((row) => `
              <div class="alert-item">
                ${tagMarkup("触发次数变化较大")}
                <div><strong>${escapeHtml(row.品类)} · ${escapeHtml(row.规则类别)}</strong><p>${escapeHtml(triggerReason(row))}</p></div>
                <span>${formatNumber(row.上周期触发次数, 0)} → ${formatNumber(row.本周期触发次数, 0)}</span>
              </div>`).join("") : emptyState()}
          </div>
        </div>
      </div>
    </section>
    <section class="dashboard-section" id="saving-dashboard">
      ${sectionHead("节费规则看板", "主节费仅统计产品(ASIN)暂停和关键词/PAT暂停；否词只展示触发次数，理论节费金额和广告活动/广告组暂停金额有部分重叠，仅供参考。", `${formatCurrency(mainSaving.current)} 本周期理论节费`)}
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
          ]), { previousVisible, currentVisible, wrapLabels: true })}
        </div>
        <div class="chart-panel">
          <div class="chart-title-row"><div><h4>否词触发观察</h4><p>仅统计动作次数，不计入主理论节费</p></div>${legendMarkup()}</div>
          ${verticalCompareChart(negativeObservation.slice(0, 12).map((row) => ({ label: row.品类, previous: row.上周期触发次数, current: row.本周期触发次数 })), { previousVisible, currentVisible, formatter: (v) => formatNumber(v, 0) })}
        </div>
      </div>
      <div class="method-note">理论节费为规则识别出的低效花费规模，采用去重后、按取数周期折算的月化口径，不等同于实际利润提升。</div>
    </section>
    <section class="dashboard-section" id="saving-detail">
      ${sectionHead("节费规则触发明细", "产品(ASIN)暂停、关键词/PAT暂停展示月化去重理论节费；否词金额以横杠标记。", `${detailRows.length} 条`)}
      ${detailFilterMarkup("lingxing_rules_detail", {
        options: ["关键词/PAT暂停", "产品(ASIN)暂停", "否词"],
        searchLabel: "节费明细关键词",
        placeholder: "搜索广告活动名称或标签关键词",
      })}
      <div class="detail-summary-grid">
        ${detailMetricCard("广告活动数量", detailSummary.campaigns, "integer", "广告活动去重计数")}
        ${detailMetricCard("花费", detailSummary.spend, "currency")}
        ${detailMetricCard("订单", detailSummary.orders, "integer")}
        ${detailMetricCard("销售额", detailSummary.sales, "currency")}
        ${detailMetricCard("主理论节费", detailSummary.saving, "currency", "月化去重后")}
      </div>
      ${tableMarkup("lingxing-detail-table", detailRows, detailColumns, 50)}
      <div class="method-note">花费、订单与销售额为当前筛选触发记录的取数窗口字段汇总，不等同整月广告表现。重复触发保留在明细中，但仅代表记录承载月化去重理论节费；CPC调整、广告位调优、库存类规则、广告活动暂停和广告组暂停不纳入本明细。</div>
    </section>
    <section class="dashboard-section" id="rule-query">
      ${sectionHead(
        "领星自动化规则",
        "查询当前已配置的领星自动化规则及通知信息。",
        `${ruleQueryRows.length} 条`,
        {
          label: "新增/修改规则需求收集表",
          href: "https://alidocs.dingtalk.com/i/nodes/YMyQA2dXW79wl46vhZMAP7aaJzlwrZgb?utm_scene=person_space&iframeQuery=viewId%3D1qX0QQ0%26sheetId%3Ddv19yqvsgs3oebp3pcjys",
        },
      )}
      ${filterMarkup("lingxing_rule_query", ruleQueryConfigs, null, `${ruleQueryRows.length} 条规则`)}
      ${tableMarkup("lingxing-rule-query-table", ruleQueryRows, ruleQueryColumns, 50)}
      <div class="method-note">数据源：${escapeHtml(data.rule_query?.source || "未找到规则表")}；规则配置与规则触发记录为独立数据源，表内空白字段以横杠显示。</div>
    </section>`;
}

function batchFilterConfig(data) {
  const ownerCategoryMap = categoryOwnerMap(data.summary_cross || [], "品类", "品类负责人");
  const categoryOptions = unique([
    ...(data.filters.品类 || []),
    ...(data.operation_filters?.品类 || []),
  ]);
  return [
    { id: "month", label: "月份", options: (data.filters.月份 || []).map(String) },
    { id: "owner", label: "运营组长", options: data.filters.品类负责人 || [] },
    { id: "category", label: "品类", options: categoryOptions, linkedTo: "owner", ownerCategoryMap },
    { id: "team", label: "团队", options: data.filters.团队 || [] },
  ];
}

function batchAggregate(rows) {
  const batchCount = sum(rows, "批量活动数量");
  const allCount = sum(rows, "全部活动数量");
  const spend = sum(rows, "批量广告花费");
  const sales = sum(rows, "批量销售额");
  const totalSpend = sum(rows, "品类总花费");
  const totalSales = sum(rows, "品类总销售额");
  return {
    batchCount,
    allCount,
    coverage: safeDivide(batchCount, allCount),
    spend,
    sales,
    totalSpend,
    totalSales,
    acos: spend > 0 && sales > 0 ? spend / sales : null,
    categoryAcos: totalSpend > 0 && totalSales > 0 ? totalSpend / totalSales : null,
    salesContribution: totalSales > 0 ? sales / totalSales : null,
  };
}

function batchRowsByDimension(rows, dimensionField, options = {}) {
  const grouped = new Map();
  rows.forEach((row) => {
    const dimension = row[dimensionField] || "未匹配";
    const key = options.combineMonths ? dimension : `${row.月份}::${dimension}`;
    if (!grouped.has(key)) grouped.set(key, { 月份: options.periodLabel || row.月份, 维度: dimension });
    const target = grouped.get(key);
    ["批量活动数量", "全部活动数量", "批量广告花费", "批量销售额", "品类总花费", "品类总销售额"].forEach((field) => {
      target[field] = asNumber(target[field]) + asNumber(row[field]);
    });
  });
  return [...grouped.values()].map((row) => {
    const aggregate = batchAggregate([row]);
    return {
      ...row,
      活动覆盖率: aggregate.coverage,
      批量ACOS: aggregate.acos,
      品类平均ACOS: aggregate.categoryAcos,
      ACOS差异: aggregate.acos !== null && aggregate.categoryAcos !== null ? aggregate.categoryAcos - aggregate.acos : null,
      批量销售贡献率: aggregate.salesContribution,
    };
  });
}

function renderBatch() {
  const data = state.data.batch_launch;
  const configs = batchFilterConfig(data);
  initializeFilters("batch_launch", configs);
  initializeFilters("batch_operation_detail", []);
  const monthSet = selectedSet("batch_launch", "month");
  const categorySet = selectedSet("batch_launch", "category");
  const teamSet = selectedSet("batch_launch", "team");
  const ownerSet = selectedSet("batch_launch", "owner");
  const operationQuery = (state.searchApplied.batch_operation_detail || "").trim();
  const selectedMonths = [...monthSet].sort((a, b) => Number(a) - Number(b));
  const periodLabel = selectedMonths.join("+");
  const categoryAllSelected = isAllSelected("batch_launch", configs.find((config) => config.id === "category"));
  const crossRows = (data.summary_cross || []).filter((row) => monthSet.has(String(row.月份))
    && (categoryAllSelected || categorySet.has(row.品类))
    && teamSet.has(row.团队)
    && ownerSet.has(row.品类负责人));
  const monthlyCategoryRows = batchRowsByDimension(crossRows, "品类");
  const eligibleCategoryMonths = new Set(monthlyCategoryRows
    .filter((row) => row.批量广告花费 > 0)
    .map((row) => `${row.月份}::${row.维度}`));
  const eligibleCrossRows = crossRows.filter((row) => eligibleCategoryMonths.has(`${row.月份}::${row.品类}`));
  const categoryRows = batchRowsByDimension(eligibleCrossRows, "品类", { combineMonths: true, periodLabel });
  const teamRows = batchRowsByDimension(eligibleCrossRows, "团队", { combineMonths: true, periodLabel }).filter((row) => row.批量广告花费 > 0);
  const ownerRows = batchRowsByDimension(eligibleCrossRows, "品类负责人", { combineMonths: true, periodLabel }).filter((row) => row.批量广告花费 > 0);
  const latestMonth = selectedMonths.at(-1);
  const previousMonth = selectedMonths.length > 1 ? selectedMonths.at(-2) : null;
  const currentRows = monthlyCategoryRows.filter((row) => String(row.月份) === latestMonth && row.批量广告花费 > 0);
  const current = batchAggregate(crossRows.filter((row) => String(row.月份) === latestMonth));
  const previous = previousMonth ? batchAggregate(crossRows.filter((row) => String(row.月份) === previousMonth)) : null;
  const coverageRows = [...categoryRows].filter((row) => row.全部活动数量 > 0).sort((a, b) => b.活动覆盖率 - a.活动覆盖率);
  const coverageMax = niceFractionMax(coverageRows.map((row) => row.活动覆盖率));
  const acosRows = categoryRows.map((row) => ({
    ...row,
    ACoS差值: row.批量ACOS !== null && row.品类平均ACOS !== null ? row.品类平均ACOS - row.批量ACOS : null,
  })).sort((a, b) => {
    if (a.ACoS差值 === null) return 1;
    if (b.ACoS差值 === null) return -1;
    return state.ui.batchAcosSort === "asc" ? a.ACoS差值 - b.ACoS差值 : b.ACoS差值 - a.ACoS差值;
  });
  const acosMax = niceFractionMax(acosRows.flatMap((row) => [row.批量ACOS, row.品类平均ACOS].filter((value) => value !== null && value > 0)));

  const monthScale = selectedMonths.map((month) => {
    const aggregate = batchAggregate(crossRows.filter((row) => String(row.月份) === month));
    return { label: month === "202605" ? "5月" : month === "202606" ? "6月" : month, value: aggregate.batchCount };
  });

  const operationScopeKeys = new Set(crossRows.map((row) => `${row.月份}::${row.品类负责人}::${row.品类}`));
  const operationRows = (data.operation_batch_rows || [])
    .filter((row) => String(row.品类名称 || "").split("、").some((category) => operationScopeKeys.has(`${row.月份}::${row.运营组长}::${category}`))
      && fuzzyOptionMatch(row.运营, operationQuery))
    .sort((a, b) => String(b.月份).localeCompare(String(a.月份))
      || String(a.运营).localeCompare(String(b.运营), "zh-CN")
      || String(a.运营批次号).localeCompare(String(b.运营批次号), "zh-CN"));
  const operationColumns = [
    { field: "月份", label: "月份", render: (v) => String(v) === "202605" ? "2026-05" : String(v) === "202606" ? "2026-06" : escapeHtml(v) },
    { field: "运营", label: "运营" },
    { field: "运营组长", label: "运营组长" },
    { field: "运营批次号", label: "运营批次号" },
    { field: "品类名称", label: "品类名称", long: true },
    { field: "活动数量", label: "活动数量", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "广告花费", label: "广告花费", numeric: true, render: (v) => v === null ? "-" : formatCurrency(v) },
    { field: "广告销售额", label: "广告销售额", numeric: true, render: (v) => v === null ? "-" : formatCurrency(v) },
    { field: "广告订单", label: "广告订单", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "平均CPC", label: "平均 CPC", numeric: true, render: (v) => v === null ? "-" : formatCurrency(v) },
    { field: "平均CVR", label: "平均 CVR", numeric: true, render: (v) => v === null || v === "" || !Number.isFinite(Number(v)) ? "-" : `${formatNumber(v, 2)}%` },
    { field: "ACOS", label: "ACoS", numeric: true, render: (v) => v === null ? "-" : formatPercent(v, true) },
  ];

  let summaryRows = categoryRows;
  let summaryColumns = [
    { field: "月份", label: "所选月份", render: (v) => String(v).split("+").map((month) => month === "202605" ? "2026-05" : month === "202606" ? "2026-06" : month).join(" + ") },
    { field: "维度", label: "品类" },
    { field: "批量活动数量", label: "批量活动数量", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "全部活动数量", label: "全部活动数量", numeric: true, render: (v) => formatNumber(v, 0) },
    { field: "活动覆盖率", label: "活动覆盖率", numeric: true, render: (v) => formatPercent(v, true) },
    { field: "批量广告花费", label: "批量广告花费", numeric: true, render: (v) => formatCurrency(v) },
    { field: "批量ACOS", label: "批量 ACoS", numeric: true, render: (v) => v === null || asNumber(v) <= 0 ? "-" : formatPercent(v, true) },
    { field: "品类平均ACOS", label: "品类平均 ACoS", numeric: true, render: (v) => v === null || asNumber(v) <= 0 ? "-" : formatPercent(v, true) },
    { field: "ACOS差异", label: "品类平均 - 批量", numeric: true, render: (v) => v === null ? "-" : formatSignedFractionPercent(v) },
    { field: "批量销售贡献率", label: "批量销售贡献率", numeric: true, render: (v) => v === null ? "-" : formatPercent(v, true) },
  ];
  if (state.ui.batchSummaryTab === "team") {
    summaryRows = teamRows;
    summaryColumns = summaryColumns.map((column) => column.field === "维度" ? { ...column, label: "团队" } : column);
  }
  if (state.ui.batchSummaryTab === "owner") {
    summaryRows = ownerRows;
    summaryColumns = summaryColumns.map((column) => column.field === "维度" ? { ...column, label: "运营组长" } : column);
  }
  summaryRows = [...summaryRows].sort((a, b) => b.批量活动数量 - a.批量活动数量);

  root.innerHTML = `
    ${introMarkup("批量投放系统运营看板", "查看批量活动创建规模、活动覆盖率及批量 ACoS 与品类平均的差异。")}
    <div class="kpi-grid">
      ${kpiCard({ label: "批量广告活动数量", value: current.batchCount, previous: previous?.batchCount, valueType: "integer", tone: "primary", note: latestMonth ? `${String(latestMonth).slice(0, 4)}年${String(latestMonth).slice(4)}月` : "当前筛选" })}
      ${kpiCard({ label: "活动覆盖率", value: current.coverage, previous: previous?.coverage, valueType: "fractionPercent", tone: "teal", note: "批量活动数 / 全部活动数" })}
      ${kpiCard({ label: "批量广告花费", value: current.spend, previous: previous?.spend, valueType: "currency", tone: "orange", inverse: true })}
      ${kpiCard({ label: "批量 ACoS", value: current.acos, previous: previous?.acos, valueType: "fractionPercent", tone: "red", inverse: true })}
      ${kpiCard({ label: "当前覆盖品类", value: currentRows.length, valueType: "integer", tone: "green", note: "当前月份且批量花费大于 0" })}
    </div>
    ${filterMarkup("batch_launch", configs, null, `${categoryRows.length} 个有批量花费的品类`)}
    <section class="dashboard-section" id="batch-scale">
      ${sectionHead("批量投放规模", "按月比较批量活动数量，不展示花费趋势。", "5月 vs 6月")}
      <div class="chart-panel chart-panel--full">
        ${horizontalBarChart(monthScale, { formatter: (v) => formatNumber(v, 0) })}
      </div>
    </section>
    <section class="dashboard-section" id="batch-coverage">
      ${sectionHead("活动覆盖率", "数量覆盖率 = 所选月份批量活动数量 / 全部活动数量；多月选择时合并计算。", `${coverageRows.length} 个品类`)}
      <div class="chart-panel chart-panel--full">
        ${verticalCompareChart(coverageRows.map((row) => ({ label: row.维度, previous: 0, current: row.活动覆盖率 })), { previousVisible: false, currentVisible: true, scaleMax: coverageMax, showYAxis: true, className: "vertical-chart--coverage", formatter: (v) => formatPercent(v, true), axisFormatter: (v) => formatPercent(v, true, 0) })}
      </div>
    </section>
    <section class="dashboard-section" id="batch-acos">
      ${sectionHead("批量 ACoS vs 品类平均", "所选月份合并花费与销售额后重算 ACoS；无批量销售额时，右侧批量 ACoS 数值显示横杠。", `${acosRows.length} 个品类`)}
      <div class="chart-panel chart-panel--full">
        <div class="chart-title-row">
          ${segmentControl("batch-acos-sort", [["desc", "差值从高到低"], ["asc", "差值从低到高"]], state.ui.batchAcosSort)}
          ${legendMarkup("批量 ACoS", "品类平均 ACoS")}
        </div>
        ${dumbbellChart(acosRows.map((row) => ({ label: row.维度, previous: row.批量ACOS, current: row.品类平均ACOS, difference: row.ACoS差值 })), { min: 0, max: acosMax, showAxis: true, hideNonPositive: true, formatter: (v) => formatPercent(v, true), axisFormatter: (v) => formatPercent(v, true, 0), differenceFormatter: formatSignedFractionPercent })}
      </div>
    </section>
    <section class="dashboard-section" id="batch-summary">
      ${sectionHead("批量投放汇总明细", "按所选月份合并汇总；无批量花费的品类不展示。", `${summaryRows.length} 条`)}
      <div class="chart-title-row">
        <div></div>
        ${segmentControl("batch-summary", [["category", "按品类"], ["team", "按团队"], ["owner", "按运营组长"]], state.ui.batchSummaryTab)}
      </div>
      ${tableMarkup("batch-summary-table", summaryRows, summaryColumns, 50)}
      <div class="method-note">月份、运营组长、品类与团队均会联动更新顶部 KPI、投放规模、覆盖率、ACoS 对比和汇总明细。</div>
    </section>
    <section class="dashboard-section" id="batch-operation-detail">
      ${sectionHead("批量投放批次查询", "批量投放批次查询表只提供批次整体数据，运营可以筛选自己名下的批次号，使用批次号到领星平台筛选活动，查看单条活动详情", `${operationRows.length} 条`)}
      ${detailSearchMarkup("batch_operation_detail", { label: "运营姓名", placeholder: "输入运营姓名，支持模糊搜索" })}
      ${tableMarkup("batch-operation-table", operationRows, operationColumns, 50)}
      <div class="method-note">本查询表沿用页面上方的月份、运营组长、品类和团队筛选；运营姓名搜索仅作用于本表。</div>
    </section>`;
}

function renderSubnav() {
  const config = PAGE_CONFIG[state.page];
  const sectionLinks = config.sections.map(([id, label], index) => {
    const lingxingRuleRequestLink = state.page === "lingxing_rules" && id === "rule-query"
      ? `<a class="subnav-action" href="https://alidocs.dingtalk.com/i/nodes/YMyQA2dXW79wl46vhZMAP7aaJzlwrZgb?utm_scene=person_space&amp;iframeQuery=viewId%3D1qX0QQ0%26sheetId%3Ddv19yqvsgs3oebp3pcjys" target="_blank" rel="noopener noreferrer">新增/修改规则需求收集表</a>`
      : "";
    return `<a class="subnav-link ${index === 0 ? "is-active" : ""}" href="#${escapeHtml(id)}">${escapeHtml(label)}</a>
      ${lingxingRuleRequestLink}`;
  }).join("");
  const batchApplicationLink = state.page === "batch_launch"
    ? `<a class="subnav-action" href="https://alidocs.dingtalk.com/notable/share/form/v01v9kqDejxQXkZ3OVx_tblZw1SF2hzdPvpj_vew40qPDRC?source=link" target="_blank" rel="noopener noreferrer">批量投放申请表</a>`
    : "";
  subnav.innerHTML = sectionLinks + batchApplicationLink;
}

function updateDataStatusForCurrentPage() {
  if (state.page === "weekly_review") {
    if (!state.weeklyReport) {
      dataStatus.className = "data-status is-error";
      dataStatus.innerHTML = '<span class="status-dot"></span><span>周报数据未加载</span>';
      return;
    }
    dataStatus.className = "data-status is-ready";
    dataStatus.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(weeklyGeneratedLabel(state.weeklyReport.meta?.generated_at))}</span>`;
    return;
  }
  const generated = state.data?.meta?.generated_at ? new Date(state.data.meta.generated_at) : null;
  const freshness = generated && !Number.isNaN(generated.valueOf())
    ? `${generated.toLocaleDateString("zh-CN")} ${generated.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
    : "数据已就绪";
  dataStatus.className = "data-status is-ready";
  dataStatus.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(freshness)}</span>`;
}

function renderCurrentPage() {
  pageTitle.textContent = PAGE_CONFIG[state.page].title;
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.page === state.page);
  });
  updateDataStatusForCurrentPage();
  renderSubnav();
  if (state.page === "monthly_review") renderMonthly();
  if (state.page === "weekly_review") renderWeekly();
  if (state.page === "invalid_low_efficiency") renderInvalid();
  if (state.page === "lingxing_rules") renderLingxing();
  if (state.page === "batch_launch") renderBatch();
  bindSectionObserver();
}

function renderCurrentPageAtSection(sectionId) {
  renderCurrentPage();
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.scrollIntoView({ block: "start" });
  setActiveSubnav(sectionId);
}

function pageFilterConfigs(pageId) {
  if (pageId === "monthly_review") return monthlyFilterConfig(state.data.monthly_review);
  if (pageId === "sd_spend") return sdSpendFilterConfig(state.data.monthly_review);
  if (pageId === "invalid_low_efficiency") return invalidFilterConfig(state.data.invalid_low_efficiency);
  if (pageId === "lingxing_rules") return lingxingFilterConfig(state.data.lingxing_rules);
  if (pageId === "lingxing_rule_query") return ruleQueryFilterConfig(state.data.lingxing_rules);
  if (pageId === "batch_launch") return batchFilterConfig(state.data.batch_launch);
  return [];
}

function syncLinkedCategoryFilter(pageId, ownerFilterId) {
  const configs = pageFilterConfigs(pageId);
  const categoryConfig = configs.find((config) => config.linkedTo === ownerFilterId);
  if (!categoryConfig) return;
  const options = filterOptions(pageId, categoryConfig, true);
  const selected = new Set(options);
  state.filterDraft[pageId][categoryConfig.id] = selected;

  const panel = [...document.querySelectorAll("[data-page-filter]")]
    .find((element) => element.dataset.pageFilter === pageId);
  const select = panel
    ? [...panel.querySelectorAll(".multi-select")].find((element) => element.dataset.filterId === categoryConfig.id)
    : null;
  if (!select) return;
  select.querySelector(".multi-select__button").textContent = selectedLabel(pageId, categoryConfig);
  const menu = select.querySelector(".multi-select__menu");
  if (menu) menu.innerHTML = multiSelectMenuMarkup(options, selected);
}

function updateMultiSelectButton(select) {
  const detailPanel = select.closest("[data-detail-filter]");
  if (detailPanel) {
    const detailState = state.detailFilters[detailPanel.dataset.detailFilter];
    select.querySelector(".multi-select__button").textContent = detailSelectedLabel(detailState);
    return;
  }
  const pageId = select.closest("[data-page-filter]").dataset.pageFilter;
  const filterId = select.dataset.filterId;
  const configs = pageFilterConfigs(pageId);
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

function filterMultiSelectOptions(input) {
  const select = input.closest(".multi-select");
  const labels = [...select.querySelectorAll(".check-option")];
  const query = input.value.trim();
  let visibleCount = 0;
  labels.forEach((label) => {
    const option = label.querySelector('input[type="checkbox"]')?.value || "";
    const isVisible = fuzzyOptionMatch(option, query);
    label.classList.toggle("is-option-hidden", !isVisible);
    if (isVisible) visibleCount += 1;
  });
  const count = select.querySelector(".multi-select__search-count");
  if (count) count.textContent = query ? `${visibleCount}/${labels.length} 项` : `${labels.length} 项`;
  select.querySelector(".multi-select__empty")?.classList.toggle("is-hidden", visibleCount > 0);
  const allButton = select.querySelector('[data-select-action="all"]');
  const clearButton = select.querySelector('[data-select-action="clear"]');
  if (allButton) allButton.textContent = query ? "全选匹配" : "全选";
  if (clearButton) clearButton.textContent = query ? "清除匹配" : "清除";
}

function applyFilters(pageId) {
  const sectionId = document.querySelector(`[data-page-filter="${CSS.escape(pageId)}"]`)?.closest(".dashboard-section")?.id;
  Object.entries(state.filterDraft[pageId]).forEach(([id, values]) => {
    state.filterApplied[pageId][id] = cloneSet(values);
  });
  const search = document.getElementById(`${pageId}-search`);
  if (search) state.searchDraft[pageId] = search.value;
  state.searchApplied[pageId] = state.searchDraft[pageId] || "";
  Object.keys(state.pagination).forEach((key) => { state.pagination[key] = 1; });
  closeMultiSelects();
  if (sectionId) renderCurrentPageAtSection(sectionId);
  else renderCurrentPage();
  showToast("筛选已应用");
}

function resetFilters(pageId) {
  const sectionId = document.querySelector(`[data-page-filter="${CSS.escape(pageId)}"]`)?.closest(".dashboard-section")?.id;
  const configs = pageFilterConfigs(pageId);
  configs.forEach((config) => {
    const all = new Set(unique(config.options));
    state.filterDraft[pageId][config.id] = cloneSet(all);
    state.filterApplied[pageId][config.id] = cloneSet(all);
  });
  state.searchDraft[pageId] = "";
  state.searchApplied[pageId] = "";
  Object.keys(state.pagination).forEach((key) => { state.pagination[key] = 1; });
  if (sectionId) renderCurrentPageAtSection(sectionId);
  else renderCurrentPage();
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
    if (shouldOpen) window.requestAnimationFrame(() => select.querySelector(".multi-select__search")?.focus());
    return;
  }

  const selectAction = event.target.closest("[data-select-action]");
  if (selectAction) {
    const select = selectAction.closest(".multi-select");
    const checkboxes = [...select.querySelectorAll('input[type="checkbox"]')];
    const isAll = selectAction.dataset.selectAction === "all";
    const optionSearch = select.querySelector(".multi-select__search");
    const hasOptionSearch = Boolean(optionSearch?.value.trim());
    const targetCheckboxes = hasOptionSearch
      ? checkboxes.filter((box) => !box.closest(".check-option").classList.contains("is-option-hidden"))
      : checkboxes;
    const detailPanel = select.closest("[data-detail-filter]");
    let values;
    if (detailPanel) {
      const detailState = state.detailFilters[detailPanel.dataset.detailFilter];
      values = hasOptionSearch ? cloneSet(detailState.ruleDraft) : new Set();
      targetCheckboxes.forEach((box) => isAll ? values.add(box.value) : values.delete(box.value));
      detailState.ruleDraft = values;
    } else {
      const pageId = select.closest("[data-page-filter]").dataset.pageFilter;
      const filterId = select.dataset.filterId;
      values = hasOptionSearch ? cloneSet(state.filterDraft[pageId][filterId]) : new Set();
      targetCheckboxes.forEach((box) => isAll ? values.add(box.value) : values.delete(box.value));
      state.filterDraft[pageId][select.dataset.filterId] = values;
      syncLinkedCategoryFilter(pageId, filterId);
    }
    checkboxes.forEach((box) => { box.checked = values.has(box.value); });
    updateMultiSelectButton(select);
    return;
  }

  const detailQueryButton = event.target.closest("[data-detail-query]");
  if (detailQueryButton) {
    const panel = detailQueryButton.closest("[data-detail-filter]");
    const sectionId = panel.closest(".dashboard-section")?.id;
    const detailState = state.detailFilters[panel.dataset.detailFilter];
    detailState.ruleApplied = cloneSet(detailState.ruleDraft);
    const search = panel.querySelector(".search-input");
    detailState.searchDraft = search?.value || "";
    detailState.searchApplied = detailState.searchDraft;
    Object.keys(state.pagination).forEach((key) => { state.pagination[key] = 1; });
    closeMultiSelects();
    if (sectionId) renderCurrentPageAtSection(sectionId);
    else renderCurrentPage();
    showToast("明细筛选已应用");
    return;
  }

  const detailClearButton = event.target.closest("[data-detail-search-clear]");
  if (detailClearButton) {
    const panel = detailClearButton.closest("[data-detail-filter]");
    const sectionId = panel.closest(".dashboard-section")?.id;
    const detailState = state.detailFilters[panel.dataset.detailFilter];
    detailState.searchDraft = "";
    detailState.searchApplied = "";
    Object.keys(state.pagination).forEach((key) => { state.pagination[key] = 1; });
    if (sectionId) renderCurrentPageAtSection(sectionId);
    else renderCurrentPage();
    showToast("明细关键词已清除");
    return;
  }

  const queryButton = event.target.closest("[data-filter-query]");
  if (queryButton) {
    applyFilters(queryButton.closest("[data-page-filter]").dataset.pageFilter);
    return;
  }

  const clearSearchButton = event.target.closest("[data-search-clear]");
  if (clearSearchButton) {
    const pageId = clearSearchButton.closest("[data-page-filter]").dataset.pageFilter;
    state.searchDraft[pageId] = "";
    state.searchApplied[pageId] = "";
    Object.keys(state.pagination).forEach((key) => { state.pagination[key] = 1; });
    renderCurrentPage();
    showToast("关键词已清除");
    return;
  }

  const resetButton = event.target.closest("[data-filter-reset]");
  if (resetButton) {
    resetFilters(resetButton.closest("[data-page-filter]").dataset.pageFilter);
    return;
  }

  const invalidDetailQueryButton = event.target.closest("[data-invalid-detail-query]");
  if (invalidDetailQueryButton) {
    const panel = invalidDetailQueryButton.closest("[data-invalid-detail-filter]");
    const keyword = panel.querySelector("[data-invalid-detail-keyword]")?.value || "";
    const minText = panel.querySelector("[data-invalid-days-min]")?.value.trim() || "";
    const maxText = panel.querySelector("[data-invalid-days-max]")?.value.trim() || "";
    const minValue = minText === "" ? null : Number(minText);
    const maxValue = maxText === "" ? null : Number(maxText);
    if ((minValue !== null && (!Number.isFinite(minValue) || minValue < 0))
      || (maxValue !== null && (!Number.isFinite(maxValue) || maxValue < 0))) {
      showToast("投放天数请输入大于或等于 0 的数字");
      return;
    }
    if (minValue !== null && maxValue !== null && minValue >= maxValue) {
      showToast("“大于”天数必须小于“小于”天数");
      return;
    }
    state.invalidDetailSearch.draft = keyword;
    state.invalidDetailSearch.applied = keyword;
    state.invalidDetailDays.minDraft = minText;
    state.invalidDetailDays.maxDraft = maxText;
    state.invalidDetailDays.minApplied = minValue;
    state.invalidDetailDays.maxApplied = maxValue;
    Object.keys(state.pagination).forEach((key) => { state.pagination[key] = 1; });
    closeMultiSelects();
    renderCurrentPageAtSection("invalid-detail");
    showToast("明细筛选已应用");
    return;
  }

  const invalidDetailClearButton = event.target.closest("[data-invalid-detail-clear]");
  if (invalidDetailClearButton) {
    state.invalidDetailSearch.draft = "";
    state.invalidDetailSearch.applied = "";
    state.invalidDetailDays.minDraft = "";
    state.invalidDetailDays.maxDraft = "";
    state.invalidDetailDays.minApplied = null;
    state.invalidDetailDays.maxApplied = null;
    state.pagination["invalid-detail-table"] = 1;
    renderCurrentPageAtSection("invalid-detail");
    showToast("明细筛选已清除");
    return;
  }

  const invalidDetailDownloadButton = event.target.closest("[data-invalid-detail-download]");
  if (invalidDetailDownloadButton) {
    downloadInvalidDetailCsv();
    return;
  }

  const segmentButton = event.target.closest("[data-segment-value]");
  if (segmentButton) {
    const segment = segmentButton.closest("[data-segment]").dataset.segment;
    const value = segmentButton.dataset.segmentValue;
    if (segment === "monthly-category") state.ui.monthlyCategoryTab = value;
    if (segment === "weekly-self-invest") state.ui.weeklySelfTab = value;
    if (segment === "invalid-detail") state.ui.invalidDetailTab = value;
    if (segment === "batch-summary") state.ui.batchSummaryTab = value;
    if (segment === "batch-acos-sort") state.ui.batchAcosSort = value;
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
  const detailPanel = select.closest("[data-detail-filter]");
  if (detailPanel) {
    const selected = state.detailFilters[detailPanel.dataset.detailFilter].ruleDraft;
    if (checkbox.checked) selected.add(checkbox.value);
    else selected.delete(checkbox.value);
    updateMultiSelectButton(select);
    return;
  }
  const pageId = select.closest("[data-page-filter]").dataset.pageFilter;
  const filterId = select.dataset.filterId;
  const selected = state.filterDraft[pageId][filterId];
  if (checkbox.checked) selected.add(checkbox.value);
  else selected.delete(checkbox.value);
  updateMultiSelectButton(select);
  syncLinkedCategoryFilter(pageId, filterId);
}

function handleRootInput(event) {
  if (event.target.matches("[data-invalid-detail-keyword]")) {
    state.invalidDetailSearch.draft = event.target.value;
    return;
  }
  if (event.target.matches("[data-invalid-days-min]")) {
    state.invalidDetailDays.minDraft = event.target.value;
    return;
  }
  if (event.target.matches("[data-invalid-days-max]")) {
    state.invalidDetailDays.maxDraft = event.target.value;
    return;
  }
  if (event.target.matches(".multi-select__search")) {
    filterMultiSelectOptions(event.target);
    return;
  }
  if (!event.target.matches(".search-input")) return;
  const detailPanel = event.target.closest("[data-detail-filter]");
  if (detailPanel) {
    state.detailFilters[detailPanel.dataset.detailFilter].searchDraft = event.target.value;
    return;
  }
  const pageId = event.target.closest("[data-page-filter]").dataset.pageFilter;
  state.searchDraft[pageId] = event.target.value;
}

let sectionScrollHandler;

function setActiveSubnav(targetId) {
  subnav.querySelectorAll(".subnav-link").forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("href") === `#${targetId}`);
  });
}

function updateActiveSubnav() {
  const links = [...subnav.querySelectorAll(".subnav-link")];
  const targets = links.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
  if (!targets.length) return;
  const marker = Math.max(210, subnav.getBoundingClientRect().bottom + 14);
  let active = targets[0];
  targets.forEach((target) => {
    if (target.getBoundingClientRect().top <= marker) active = target;
  });
  const pageBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
  if (pageBottom) active = targets[targets.length - 1];
  setActiveSubnav(active.id);
}

function bindSectionObserver() {
  if (sectionScrollHandler) window.removeEventListener("scroll", sectionScrollHandler);
  let scheduled = false;
  sectionScrollHandler = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      updateActiveSubnav();
    });
  };
  window.addEventListener("scroll", sectionScrollHandler, { passive: true });
  updateActiveSubnav();
}

async function loadData() {
  loading.classList.remove("is-hidden");
  errorState.classList.add("is-hidden");
  root.innerHTML = "";
  state.weeklyReport = null;
  state.weeklyLoadError = "";
  dataStatus.className = "data-status";
  dataStatus.innerHTML = '<span class="status-dot"></span><span>正在读取数据</span>';
  try {
    const weeklyRequest = fetch(WEEKLY_DATA_URL, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { data: await response.json(), error: "" };
      })
      .catch((error) => ({ data: null, error: error.message || "读取失败" }));
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    const weeklyResult = await weeklyRequest;
    state.weeklyReport = weeklyResult.data;
    state.weeklyLoadError = weeklyResult.error;
    loading.classList.add("is-hidden");
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
  if (!button || button.dataset.page === state.page || !state.data) return;
  state.page = button.dataset.page;
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderCurrentPage();
});

root.addEventListener("click", handleRootClick);
root.addEventListener("change", handleRootChange);
root.addEventListener("input", handleRootInput);
subnav.addEventListener("click", (event) => {
  const link = event.target.closest(".subnav-link");
  if (!link) return;
  setActiveSubnav(link.getAttribute("href").slice(1));
  window.setTimeout(updateActiveSubnav, 50);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".multi-select")) closeMultiSelects();
});
document.getElementById("retry-button").addEventListener("click", loadData);

loadData();
