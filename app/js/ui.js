/* ──────────────────────────────────────────────────────────────
   Abbey Road · 界面主体
   外壳导航 / 布局引擎（三预设 + 拖拽 + 聚焦态）/ 今日页 / 周表 / 毛玻璃弹窗
   ────────────────────────────────────────────────────────────── */

var AR = window.AR || (window.AR = {});

(function () {
  'use strict';

  var U = null;
  var S = null;
  var cursorDate = new Date();
  var currentView = 'today';
  var weekCursor = null;   // 周表当前周次
  var weekDaySel = null;   // 窄屏周表选中的星期（1-7）
  var weekPageMode = 'week';   // 周表页：week | month
  var weekMonthCursor = null;  // 周表页月视图：当前月份

  function $(id) { return document.getElementById(id); }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  /* ── 布局引擎 ─────────────────────────────────────────────── */

  var Layout = {
    el: null,
    preset: 'triple-horizontal',
    expanded: null,          // null | 'week' | 'today' | 'next'
    profileKey: 'wide',
    profiles: null
  };

  var monthCursor = null;    // 月视图当前月份（Date，取每月 1 号）
  var weekZoneMode = 'week'; // 展开本周概览时的视图：week | month
  var conflictOpen = false;  // 周表页「冲突检测」是否展开
  var lastTodayKey = '';     // 上次渲染时「今天」是哪天，用于跨天/回前台时自动翻页

  /**
   * 尺寸一律用「占比（%）」而不再是像素。
   * 早期版本写死 px，在窄屏手机上会把另一栏挤成一条竖缝（文字竖排、错位），
   * 改成比例后任何屏幕宽度都不会塌陷，设置里的滑块也直接显示百分比。
   *
   *   triple-horizontal：week.w / next.w = 左右两栏的宽度占比
   *   dual-horizontal  ：next.w = 右侧「最近的课」宽度占比，week.h = 左上「本周概览」高度占比
   *   stacked-vertical ：week.h / next.h = 上下两栏的高度占比
   */
  var DEFAULT_PROFILES = {
    wide: { preset: 'dual-horizontal', week: { w: 34, h: 32 }, next: { w: 34, h: 34 } },
    medium: { preset: 'dual-horizontal', week: { w: 34, h: 32 }, next: { w: 40, h: 34 } },
    // 直板手机默认「左右」布局（左上：本周概览，左下：今日日程，右侧：最近的课）
    narrow: { preset: 'dual-horizontal', week: { w: 36, h: 30 }, next: { w: 44, h: 34 } }
  };

  function breakpointKey(w) {
    if (w >= 1024) { return 'wide'; }
    if (w >= 720) { return 'medium'; }
    return 'narrow';
  }

  function loadProfiles() {
    var raw = null;
    try { raw = localStorage.getItem(AR.Const.LAYOUT_KEY); } catch (e) { raw = null; }
    var p = raw ? JSON.parse(raw) : {};
    var out = {};
    var keys = ['wide', 'medium', 'narrow'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var base = U.deepCopy(DEFAULT_PROFILES[k]);
      if (p && p[k]) {
        // v0.1.8 起只有「左右 / 上中下」两种布局，旧的 auto / 左中右一律折算成「左右」
        if (p[k].preset) {
          base.preset = (p[k].preset === 'stacked-vertical') ? 'stacked-vertical' : 'dual-horizontal';
        }
        // 旧版本存的是像素（~200–400），比 90 大的值一律视为旧数据并回落到默认百分比
        if (p[k].week) {
          base.week = { w: asPercent(p[k].week.w, base.week.w), h: asPercent(p[k].week.h, base.week.h) };
        }
        if (p[k].next) {
          base.next = { w: asPercent(p[k].next.w, base.next.w), h: asPercent(p[k].next.h, base.next.h) };
        }
      }
      out[k] = base;
    }
    return out;
  }

  /** 把存的尺寸归一化成百分比：非法值 / 旧像素值都用默认值顶替 */
  function asPercent(v, fallback) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) { return fallback; }
    if (n > 90) { return fallback; }        // 旧版像素值
    return Math.round(U.clamp(n, 10, 90));
  }

  function saveProfiles() {
    try { localStorage.setItem(AR.Const.LAYOUT_KEY, JSON.stringify(Layout.profiles)); } catch (e) { }
  }

  function resolvedPreset() {
    // v0.1.8：设置里只有「左右」与「上中下」两种，旧的 auto / 左中右都折算成「左右」
    var pref = (S.settings.layout && S.settings.layout.preset) || 'dual-horizontal';
    return (pref === 'stacked-vertical') ? 'stacked-vertical' : 'dual-horizontal';
  }

  function sizeOf(which) {
    return Layout.profiles[Layout.profileKey][which];
  }

  /**
   * 按「期望高度」分配纵向空间：保证每栏不低于最小值，总和等于 total，
   * 富余空间给弹性栏（通常是「今日日程」）。
   */
  function fitSizes(total, wants, mins, elastic) {
    var n = wants.length;
    var w = wants.slice(0);
    var sum = 0, i;
    for (i = 0; i < n; i++) { sum += w[i]; }
    if (sum > total) {
      var slack = 0;
      for (i = 0; i < n; i++) { slack += Math.max(0, w[i] - mins[i]); }
      var over = sum - total;
      if (slack > 0) {
        for (i = 0; i < n; i++) {
          var can = Math.max(0, w[i] - mins[i]);
          if (can > 0) { w[i] -= over * (can / slack); }
        }
      }
      var s2 = 0;
      for (i = 0; i < n; i++) { s2 += w[i]; }
      if (s2 > total && s2 > 0) {
        var k = total / s2;
        for (i = 0; i < n; i++) { w[i] = Math.max(64, w[i] * k); }
      }
    } else if (sum < total) {
      var idx = (elastic == null ? n - 1 : elastic);
      w[idx] += (total - sum);
    }
    var out = [];
    for (i = 0; i < n; i++) { out.push(Math.round(w[i])); }
    return out;
  }

  /**
   * 计算当前应该用的 Grid 轨道。
   *
   * 全部用 fr 权重写，不用 px：这样无论屏幕多宽，每一栏都保持设定的比例，
   * 绝不会出现「某栏被挤成一条缝、文字竖着排」的错位。
   * 展开时：被点的那栏拿到 ~60%+ 的空间，其余栏位进入 compact（只留一行摘要）。
   */
  function gridTemplate(preset, ex, p) {
    var f = function (n) { return Math.max(1, Math.round(n * 10) / 10) + 'fr'; };
    var cols, rows;

    if (preset === 'triple-horizontal') {
      var l = p.week.w, r = p.next.w;
      if (!ex && l + r > 74) { var kk = 74 / (l + r); l *= kk; r *= kk; }   // 中间那栏至少留 26%
      var m = Math.max(26, 100 - l - r);
      if (ex === 'week') { l = 58; m = 22; r = 20; }
      else if (ex === 'today') { l = 15; m = 70; r = 15; }
      else if (ex === 'next') { l = 15; m = 23; r = 62; }
      cols = [f(l), f(m), f(r)];
      rows = ['minmax(0, 1fr)'];
    } else if (preset === 'dual-horizontal') {
      var right = Math.max(28, Math.min(p.next.w, 62));
      var left = 100 - right;
      if (ex === 'week' || ex === 'today') { left = 70; right = 30; }
      else if (ex === 'next') { left = 32; right = 68; }
      cols = [f(left), f(right)];
      if (ex === 'week') { rows = ['minmax(0, 1fr)', 'auto']; }
      else if (ex === 'today') { rows = ['auto', 'minmax(0, 1fr)']; }
      else if (ex === 'next') { rows = ['minmax(0, 1fr)', 'minmax(0, 1fr)']; }
      else { rows = [f(p.week.h), f(Math.max(30, 100 - p.week.h))]; }
    } else {
      var t = p.week.h, b = p.next.h;
      if (!ex && t + b > 70) { var kb = 70 / (t + b); t *= kb; b *= kb; }
      var mid = Math.max(30, 100 - t - b);
      if (ex === 'week') { t = 58; mid = 24; b = 18; }
      else if (ex === 'today') { t = 16; mid = 66; b = 18; }
      else if (ex === 'next') { t = 16; mid = 24; b = 60; }
      cols = ['minmax(0, 1fr)'];
      rows = [f(t), f(mid), f(b)];
    }
    return { cols: cols, rows: rows };
  }

  /**
   * 展开态下，另外两栏里哪些要切成 compact（只留一行摘要）。
   * 规则：被挤到很窄的才 compact；「左右」布局右侧那栏还有 38% 宽度，保持完整内容。
   */
  function compactZones(ex, preset) {
    var isDual = (preset === 'dual-horizontal');
    return {
      week: !!ex && ex !== 'week',
      today: !!ex && ex !== 'today',
      next: !!ex && ex !== 'next' && !isDual
    };
  }

  /**
   * 布局完全交给 CSS Grid：JS 只负责
   *   ① 写轨道比例（设置页滑块）；② 标记预设、展开态与 compact 态。
   * 这样在真实手机上（系统字号 / 显示缩放 / 刘海安全区）也不会错位或重叠。
   */
  function applyLayout() {
    var el = Layout.el;
    if (!el) { return; }
    var preset = resolvedPreset();
    Layout.preset = preset;
    var p = Layout.profiles[Layout.profileKey];
    var ex = Layout.expanded;

    var g = gridTemplate(preset, ex, p);
    el.style.gridTemplateColumns = g.cols.join(' ');
    el.style.gridTemplateRows = g.rows.join(' ');
    el.setAttribute('data-preset', preset);
    el.setAttribute('data-expand', ex || 'none');

    var compactMap = compactZones(ex, preset);
    var zones = { week: $('zoneWeek'), today: $('zoneToday'), next: $('zoneNext') };
    for (var key in zones) {
      if (!Object.prototype.hasOwnProperty.call(zones, key)) { continue; }
      var z = zones[key];
      var isOpen = (ex === key);
      z.classList.toggle('expanded', isOpen);
      z.classList.toggle('dimmed', !!ex && !isOpen);
      z.classList.toggle('compact', compactMap[key]);
      z.style.setProperty('--fs-scale', isOpen ? '1.06' : '1');
      var btn = z.querySelector('.zone-toggle');
      if (btn) { btn.textContent = isOpen ? '✕' : '⤢'; }
    }
  }

  /**
   * 展开/收起的内容过渡（规格书规则 1：只动 opacity / translate / scale）。
   * 模板切换是瞬时的，观感由"新内容浮入 + 旧内容淡出"承担，因此不掉帧。
   */
  function animateZoneChange(prev, next) {
    var map = { week: 'zoneWeek', today: 'zoneToday', next: 'zoneNext' };
    var cleanup = [];
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) { continue; }
      var node = $(map[k]);
      if (!node) { continue; }
      node.classList.remove('z-in', 'z-out');
      void node.offsetWidth;                       // 强制刷新，保证连续点击也能重放
      if (k === next) { node.classList.add('z-in'); cleanup.push(node); }
      else if (k === prev) { node.classList.add('z-out'); cleanup.push(node); }
    }
    setTimeout(function () {
      for (var i = 0; i < cleanup.length; i++) { cleanup[i].classList.remove('z-in', 'z-out'); }
    }, 540);
  }

  /** 切换布局预设（带一次轻量淡入，避免"跳版"） */
  function setPreset(name, silent) {
    S.settings.layout.preset = name;
    AR.Store.save();
    if (name !== 'auto') {
      Layout.profiles[Layout.profileKey].preset = name;
      saveProfiles();
    }
    var layoutEl = Layout.el;
    layoutEl.classList.add('switching');
    setTimeout(function () {
      layoutEl.classList.remove('switching');
      applyLayout(true);
      AR.UI.renderSettings();
      if (!silent) { AR.Bridge.haptic('light', $('zoneNext')); }
    }, 120);
  }

  function setSize(which, axis, value) {
    var p = Layout.profiles[Layout.profileKey];
    p[which][axis] = Math.round(U.clamp(value, 10, 90));
    saveProfiles();
    applyLayout(true);
  }

  /**
   * 展开/收起某一栏（'week' | 'today' | 'next' | null）。
   * 展开的栏会放大细化，另外两栏同时缩小简略，全过程沿用同一套动效曲线。
   */
  function setExpanded(zone) {
    if (Layout.expanded === zone) { zone = null; }   // 再点一次同一栏 = 收起
    var prev = Layout.expanded;
    var before = captureZoneRects();                 // FLIP 第一步：先量三栏旧位置
    Layout.expanded = zone;
    document.body.setAttribute('data-expand', zone || 'off');
    AR.Bridge.haptic(zone ? 'medium' : 'light', $('zoneNext'));
    applyLayout();
    renderToday();                    // 先把内容换成新状态
    morphZones(before);               // 再让三栏从旧位置长到新位置（只动 transform）
    animateZoneChange(prev, zone);    // 再播放"浮入/淡出"（纯 transform + opacity）
  }

  var ZONE_IDS = { week: 'zoneWeek', today: 'zoneToday', next: 'zoneNext' };

  /** 量出三栏当前的屏幕矩形（FLIP 的 First） */
  function captureZoneRects() {
    var out = {};
    for (var k in ZONE_IDS) {
      if (!Object.prototype.hasOwnProperty.call(ZONE_IDS, k)) { continue; }
      var n = $(ZONE_IDS[k]);
      if (n) { out[k] = n.getBoundingClientRect(); }
    }
    return out;
  }

  /**
   * 聚焦放大 / 收起时的位移动画（FLIP）。
   *
   * 布局是 CSS Grid 的轨道比例，浏览器不保证能补间，所以这里用
   * 「按旧位置反算一个初始 transform → 播放回 identity」的做法：先把元素
   * translate + scale 到旧位置，再用一条强缓出（非线性）曲线回到自然位置。
   * 全程只动 transform（合成层），不触发重排，连续点击也不会跳。
   */
  function morphZones(before) {
    if (!before || !AR.Bridge) { return; }
    var speed = Number((S.settings.appearance && S.settings.appearance.animationSpeed) || 1) || 1;
    var dur = Math.round(460 / speed);            // 与「动画速度」设置联动
    var ease = 'cubic-bezier(.22,1,.36,1)';       // 规格书里的 FADE_OUT 曲线（强缓出）
    for (var k in ZONE_IDS) {
      if (!Object.prototype.hasOwnProperty.call(ZONE_IDS, k)) { continue; }
      var node = $(ZONE_IDS[k]);
      var from = before[k];
      if (!node || !from || !node.animate) { continue; }
      var to = node.getBoundingClientRect();
      if (!to.width || !to.height) { continue; }
      var sx = from.width / to.width;
      var sy = from.height / to.height;
      var dx = from.left - to.left;
      var dy = from.top - to.top;
      if (node.__morph) { try { node.__morph.cancel(); } catch (e) { } node.__morph = null; }
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5
          && Math.abs(sx - 1) < 0.004 && Math.abs(sy - 1) < 0.004) {
        continue;                                  // 没变化的一栏不参与，少一次合成
      }
      node.style.transformOrigin = '0 0';
      node.style.willChange = 'transform';
      node.__morph = node.animate(
        [
          {
            transform: 'translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px) scale('
              + sx.toFixed(4) + ',' + sy.toFixed(4) + ')'
          },
          { transform: 'translate(0px,0px) scale(1,1)' }
        ],
        { duration: dur, easing: ease, fill: 'both' }
      );
      node.__morph.onfinish = (function (target) {
        return function () {
          try { if (target.__morph) { target.__morph.cancel(); } } catch (e) { }
          target.__morph = null;
          target.style.willChange = '';
        };
      })(node);
    }
  }

  /* ── 外壳：导航 / 视图切换 ───────────────────────────────── */

  function show(view) {
    currentView = view;
    var views = ['today', 'week', 'import', 'settings'];
    for (var i = 0; i < views.length; i++) {
      var node = $('view-' + views[i]);
      if (node) { node.hidden = (views[i] !== view); }
    }
    var btns = document.querySelectorAll('.nav-btn');
    for (var b = 0; b < btns.length; b++) {
      if (btns[b].getAttribute('data-nav') === view) { btns[b].classList.add('active'); }
      else { btns[b].classList.remove('active'); }
    }
    if (view === 'today') { AR.Bridge.haptic('light', $('zoneNext')); applyLayout(false); renderToday(); }
    if (view === 'week') { renderWeek(); }
    if (view === 'settings' && AR.Panels) { AR.Panels.renderSettings(); }
    if (view === 'import' && AR.Panels) { AR.Panels.renderImport(); }
    // 规格书 4.1：整屏区块 60ms 错峰入场
    var viewEl = $('view-' + view);
    enterRise(viewEl);
    enhanceSegmented(viewEl);
  }

  /* ── 今日页 ───────────────────────────────────────────────── */

  function fmtRange(item) {
    if (!item.start || !item.end) { return item.periodLabel || '时间待定'; }
    return item.start + ' – ' + item.end;
  }

  /**
   * 与「现在」的相对描述。
   * 注意要带上日期：早期版本只看时分，第二天早上的课会被算成「已结束」。
   */
  function relativeText(item, now, day) {
    if (item.startMin == null) { return ''; }
    var target = day || item.date || now;
    var dayDiff = U.daysBetween(now, target);
    if (dayDiff > 0) {
      if (dayDiff === 1) { return '明天'; }
      if (dayDiff === 2) { return '后天'; }
      return dayDiff + ' 天后';
    }
    if (dayDiff < 0) { return Math.abs(dayDiff) + ' 天前'; }
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var diff = item.startMin - nowMin;
    if (diff > 0) {
      if (diff < 60) { return diff + ' 分钟后开始'; }
      return Math.floor(diff / 60) + ' 小时 ' + (diff % 60) + ' 分钟后开始';
    }
    if (item.endMin != null && nowMin <= item.endMin) { return '正在进行'; }
    return '已结束';
  }

  /** compact 态的摘要块：收起的那一栏只显示一两行，绝不出现被挤成竖排的文字 */
  function compactBlock(big, small, hint, accent) {
    var bar = accent ? '<span class="zc-bar" style="background:' + accent + '"></span>' : '';
    return el('<div class="zone-compact' + (accent ? ' has-accent' : '') + '">' + bar
      + '<div class="zc-big">' + U.escapeHtml(big) + '</div>'
      + '<div class="zc-small">' + U.escapeHtml(small || '') + '</div>'
      + (hint ? '<div class="zc-hint">' + U.escapeHtml(hint) + '</div>' : '')
      + '</div>');
  }

  /**
   * 「最近的课」的时间状态色（阈值与颜色都能在设置里改）：
   *   live  正在上课        → 默认蓝
   *   near  距上课 ≤ 15 分钟 → 默认红
   *   soon  距上课 ≤ 30 分钟 → 默认黄
   *   其它  null（保持课程原色、边框不加粗）
   */
  function nextStatusOf(target, now) {
    var cfg = (S.settings && S.settings.nextAlert) || {};
    if (cfg.enabled === false || !target || !target.item) { return null; }
    var colors = cfg.colors || {};
    var thick = cfg.thickBorder !== false;
    var day = target.day || U.startOfDay(now);
    var item = target.item;
    var startMs = toMs(day, item.start);
    var endMs = toMs(day, item.end);
    if (!startMs) { return null; }
    if (endMs && now.getTime() >= startMs && now.getTime() < endMs) {
      return { key: 'live', label: '正在上课', color: colors.live || '#5B8DEF', thick: thick };
    }
    var mins = (startMs - now.getTime()) / 60000;
    var near = Number(cfg.nearMin) || 15;
    var soon = Number(cfg.soonMin) || 30;
    if (mins > 0 && mins <= near) {
      return { key: 'near', label: near + ' 分钟内上课', color: colors.near || '#E5484D', thick: thick };
    }
    if (mins > 0 && mins <= soon) {
      return { key: 'soon', label: soon + ' 分钟内上课', color: colors.soon || '#D9A22B', thick: thick };
    }
    return null;
  }

  function renderToday() {
    var now = new Date();
    var isToday = U.sameDay(cursorDate, now);
    var sem = AR.Store.currentSemester();
    var weekNo = AR.Schedule.weekNumber(cursorDate, sem);
    var ex = Layout.expanded;

    $('todayTitle').textContent = isToday ? '今日' : (cursorDate.getMonth() + 1) + ' 月 ' + cursorDate.getDate() + ' 日';
    var sub = U.WEEKDAY_NAMES[U.weekdayOf(cursorDate)];
    if (sem) { sub += ' · ' + sem.name + ' 第 ' + Math.max(weekNo, 1) + ' 周'; }
    $('todaySub').textContent = sub;
    $('railWeekInfo').textContent = sem ? ('第 ' + Math.max(weekNo, 1) + ' 周') : '';
    $('railVersion').textContent = 'v' + AR.Const.APP_VERSION;
    updateClock();

    var items = AR.Schedule.dayItems(cursorDate, sem);
    $('todayBadge').textContent = items.length ? (items.length + ' 节课') : '无课';
    $('weekBadge').textContent = '第 ' + Math.max(weekNo, 1) + ' 周';

    /* 今日时间线 */
    var body = $('todayBody');
    body.innerHTML = '';
    var detailed = (ex === 'today');
    /**
     * 展开态下另外两栏的呈现层级：
     *   compact —— 被挤到很窄（≤1/3），只留一行摘要，点一下切过来
     *   普通    —— 左右布局里右侧那栏仍然有 38% 宽度，继续显示完整内容
     */
    var compactMap = compactZones(ex, Layout.preset);
    var weekCompact = compactMap.week;
    var nextCompact = compactMap.next;

    if (ex && !detailed) {
      var lastEnd = items.length ? (items[items.length - 1].end || '—') : '';
      body.appendChild(compactBlock(items.length ? (items.length + ' 节课') : '今天没有课',
        items.length ? ((items[0].start || '—') + ' – ' + lastEnd) : '', '点开看今日安排'));
      renderWeekRail(weekNo, sem, ex === 'week', weekCompact);
      renderNextPanel(now, ex === 'next', nextCompact);
      return;
    }
    if (!items.length) {
      body.appendChild(el('<div class="empty"><div class="big">☕</div><div class="t">今天没有课</div><div class="muted">去「导入」把课表加进来吧</div></div>'));
    } else {
      if (detailed) {
        // 展开态补充：整日快捷操作
        var tools = el('<div class="zone-tools">'
          + '<button class="chip-btn" type="button" data-act="copy">复制今日安排</button>'
          + '<button class="chip-btn" type="button" data-act="cal">第一节加入日历</button>'
          + '<span class="zone-stat">共 ' + items.length + ' 节</span></div>');
        tools.querySelector('[data-act="copy"]').addEventListener('click', function () {
          var lines = [];
          for (var q = 0; q < items.length; q++) {
            lines.push(fmtRange(items[q]) + ' ' + items[q].course.name
              + (items[q].location ? ' @ ' + items[q].location.raw : ''));
          }
          AR.Bridge.copy((U.dateKey(cursorDate) + ' ' + U.WEEKDAY_NAMES[U.weekdayOf(cursorDate)] + '\n') + lines.join('\n'));
        });
        tools.querySelector('[data-act="cal"]').addEventListener('click', function () {
          var first = items[0];
          var startMs = toMs(cursorDate, first.start) || Date.now();
          var endMs = toMs(cursorDate, first.end) || (startMs + 45 * 60000);
          AR.Bridge.addCalendarEvent(first.course.name, first.location ? first.location.raw : '',
            'Abbey Road 课表 · ' + first.periodLabel, startMs, endMs);
          AR.Bridge.haptic('medium', tools);
        });
        body.appendChild(tools);
      }
      if (isToday) {
        body.appendChild(el('<div class="now-line"><span class="dot"></span><span class="line"></span><span class="label">现在 '
          + U.timeKey(now) + '</span></div>'));
      }
      for (var i = 0; i < items.length; i++) {
        body.appendChild(detailed ? todayDetailCard(items[i], now, isToday) : todayCard(items[i], now, isToday));
      }
      /* 特殊事件（考试 / 讲座 / 活动）也按长条卡片列在今天里 */
      var dayEvents = AR.Store.eventsOf ? AR.Store.eventsOf(cursorDate) : [];
      for (var ei = 0; ei < dayEvents.length; ei++) {
        body.appendChild(eventStrip(dayEvents[ei]));
      }
      fadeInList(body, '.card');                    // 规格书 4.2：列表只做淡入
    }

    /* 左侧：本周概览 */
    renderWeekRail(weekNo, sem, ex === 'week', weekCompact);

    /* 右侧：最近的课 */
    renderNextPanel(now, ex === 'next', nextCompact);

    /* 桌面卡片：把最新快照交给原生外壳（防抖 400ms，渲染期间不打扰） */
    if (AR.WidgetData && AR.WidgetData.sync) { AR.WidgetData.sync(); }
  }

  function todayCard(item, now, isToday) {
    var status = isToday ? relativeText(item, now) : '';
    var dim = status === '已结束' ? ' style="opacity:.55"' : '';
    var loc = item.location ? U.escapeHtml(item.location.raw) : '地点待补全';
    var teachers = item.teachers.length ? item.teachers.map(function (t) { return t.name; }).join('、') : '老师待补全';
    var tags = '';
    if (status) { tags += '<span class="tag' + (status === '正在进行' ? ' success' : '') + '">' + status + '</span>'; }
    if (item.isConsecutive) { tags += '<span class="tag">连堂</span>'; }
    if (item.kind === 'move' || item.kind === 'moved-in') { tags += '<span class="tag warn">调课</span>'; }
    if (item.kind === 'room') { tags += '<span class="tag warn">换教室</span>'; }
    if (item.kind === 'time') { tags += '<span class="tag warn">换时间</span>'; }
    if (item.kind === 'makeup' || item.kind === 'add') { tags += '<span class="tag warn">补课</span>'; }
    var node = el('<div class="strip"' + dim + '>'
      + '<span class="st-bar" style="background:' + item.color + '"></span>'
      + '<div class="st-body">'
      + '<div class="st-head"><span class="st-title">' + U.escapeHtml(item.course.name) + '</span>'
      + '<span class="st-when">' + U.escapeHtml(item.periodLabel) + '</span></div>'
      + '<div class="st-meta"><span class="st-time">' + U.escapeHtml(fmtRange(item)) + '</span>'
      + ' · ' + loc + ' · ' + U.escapeHtml(teachers) + '</div>'
      + (tags ? '<div class="st-tags">' + tags + '</div>' : '')
      + '</div></div>');
    node.addEventListener('click', function () {
      // 所在栏收起时，点击是"展开这一栏"，不进详情
      if (expandOwningZone(node)) { return; }
      openCourseModal(item);
    });
    return node;
  }

  /** 展开态下的今日卡片：把老师、地点、周次、备注一次列全，并带四个可点模块 */
  function todayDetailCard(item, now, isToday) {
    var status = isToday ? relativeText(item, now) : '';
    var teachers = item.teachers.length ? item.teachers.map(function (t) { return t.name; }).join('、') : '—';
    var sem = AR.Store.currentSemester();
    var node = el('<div class="card flat">'
      + '<span class="card-accent" style="background:' + item.color + '"></span>'
      + '<div class="card-row between">'
      + '<span class="time-chip">' + U.escapeHtml(fmtRange(item)) + '</span>'
      + '<span class="muted">' + U.escapeHtml(item.periodLabel)
      + (item.isConsecutive ? ' · 连堂' : '') + (status ? ' · ' + status : '') + '</span>'
      + '</div>'
      + '<div class="card-title" style="margin-top:6px;font-size:15.5px">' + U.escapeHtml(item.course.name) + '</div>'
      + '<div class="card-meta">' + U.escapeHtml(item.location ? item.location.raw : '地点待补全')
      + ' · ' + U.escapeHtml(teachers) + '</div>'
      + '<div class="detail-grid" style="margin-top:8px">'
      + '<div class="detail-key">老师</div><div class="detail-val">' + U.escapeHtml(teachers) + '</div>'
      + '<div class="detail-key">地点</div><div class="detail-val">'
      + U.escapeHtml(item.location ? item.location.raw : '待补全') + '</div>'
      + '<div class="detail-key">周次</div><div class="detail-val">'
      + U.escapeHtml(AR.Schedule.weeksLabel(item.block, sem ? sem.weekCount : 20)) + '</div>'
      + (item.note ? '<div class="detail-key">备注</div><div class="detail-val">' + U.escapeHtml(item.note) + '</div>' : '')
      + (item.kind !== 'normal' ? '<div class="detail-key">变动</div><div class="detail-val">'
          + kindLabel(item.kind) + '</div>' : '')
      + '</div></div>');
    var mods = el('<div class="mod-grid"></div>');
    mods.appendChild(moduleBtn('位置', item.location ? item.location.raw : '未填写', function () { openLocationModal(item); }));
    mods.appendChild(moduleBtn('时间', U.WEEKDAY_NAMES[U.weekdayOf(item.date)] + ' · ' + fmtRange(item), function () { openTimeModal(item, item.date); }));
    mods.appendChild(moduleBtn('老师', item.teachers.length ? item.teachers.map(function (t) { return t.name; }).join('、') : '未填写', function () { openTeacherModal(item); }));
    mods.appendChild(moduleBtn('备注', item.note || '（空）', function () { openNoteModal(item); }));
    node.appendChild(mods);
    return node;
  }

  function kindLabel(kind) {
    return kind === 'move' ? '调课' : (kind === 'moved-in' ? '调课（补到本日）' : (kind === 'room' ? '换教室'
      : (kind === 'time' ? '换时间' : (kind === 'makeup' ? '补课' : (kind === 'add' ? '加课' : '—')))));
  }

  /* ── 特殊事件（考试 / 讲座 / 活动）───────────────────────── */

  function eventWhenText(ev) {
    var s = ev.date || '';
    if (ev.start) { s += ' ' + ev.start + (ev.end ? '–' + ev.end : ''); }
    return s;
  }

  /** 今日列表里的事件长条：颜色来自事件类型 */
  function eventStrip(ev) {
    var t = AR.Store.eventType(ev.type);
    var node = el('<div class="strip ev-strip">'
      + '<span class="st-bar" style="background:' + t.hex + '"></span>'
      + '<div class="st-body">'
      + '<div class="st-head"><span class="st-title">' + U.escapeHtml(ev.title) + '</span>'
      + '<span class="ev-tag" style="background:' + t.hex + '">' + t.label + '</span></div>'
      + '<div class="st-meta"><span class="st-time">' + U.escapeHtml(eventWhenText(ev)) + '</span>'
      + (ev.place ? ' · ' + U.escapeHtml(ev.place) : '')
      + (ev.note ? ' · ' + U.escapeHtml(ev.note) : '') + '</div>'
      + '</div></div>');
    node.addEventListener('click', function () { openEventModal(ev); });
    return node;
  }

  /** 事件详情：可以加入系统日历 / 删除 */
  function openEventModal(ev) {
    var t = AR.Store.eventType(ev.type);
    var body = '<div class="detail-grid">'
      + '<div class="detail-key">类型</div><div class="detail-val">' + t.label + '</div>'
      + '<div class="detail-key">日期</div><div class="detail-val">' + U.escapeHtml(ev.date) + '</div>'
      + (ev.start ? '<div class="detail-key">时间</div><div class="detail-val">' + U.escapeHtml(ev.start)
          + (ev.end ? ' – ' + U.escapeHtml(ev.end) : '') + '</div>' : '')
      + (ev.place ? '<div class="detail-key">地点</div><div class="detail-val">' + U.escapeHtml(ev.place) + '</div>' : '')
      + (ev.note ? '<div class="detail-key">备注</div><div class="detail-val">' + U.escapeHtml(ev.note) + '</div>' : '')
      + '</div>';
    openModal({
      title: ev.title, sub: '特殊事件 · ' + t.label, body: body,
      actions: [
        {
          label: '加入系统日历',
          onClick: function () {
            var day = U.parseDateKey(ev.date) || new Date();
            var startMs = toMs(day, ev.start) || (day.getTime() + 9 * 3600000);
            var endMs = toMs(day, ev.end) || (startMs + 90 * 60000);
            AR.Bridge.addCalendarEvent(ev.title, ev.place || '', t.label + (ev.note ? ' · ' + ev.note : ''), startMs, endMs);
          }
        },
        {
          label: '删除事件', kind: 'danger',
          onClick: function (close) {
            AR.Store.removeEvent(ev.id);
            close();
            renderToday();
            if (currentView === 'week') { renderWeek(); }
            toast('已删除事件');
          }
        },
        { label: '关闭', kind: 'primary', onClick: function (close) { close(); } }
      ]
    });
  }

  /** 展开的「本周概览」里，把这一周的考试/讲座列出来（可点开详情） */
  function weekEventList(sem, weekNo) {
    var wrap = el('<div class="ev-list"></div>');
    var evs = AR.Store.eventsInWeek ? AR.Store.eventsInWeek(weekNo, sem) : [];
    if (!evs.length) { return wrap; }
    wrap.appendChild(el('<div class="ev-list-title">本周特殊事件</div>'));
    for (var i = 0; i < evs.length; i++) {
      (function (ev) {
        var t = AR.Store.eventType(ev.type);
        var row = el('<div class="ev-row"><span class="ev-tag" style="background:' + t.hex + '">'
          + t.label + '</span><span class="ev-name">' + U.escapeHtml(ev.title) + '</span>'
          + '<span class="ev-when">' + U.escapeHtml(eventWhenText(ev)) + '</span></div>');
        row.addEventListener('click', function () { openEventModal(ev); });
        wrap.appendChild(row);
      })(evs[i]);
    }
    return wrap;
  }

  /** 顶栏时钟：精确到秒（每秒刷新，秒数用弱一点的颜色，读数更清楚） */
  function updateClock() {
    var now = new Date();
    var t = $('todayClock');
    if (t) {
      t.innerHTML = U.pad2(now.getHours()) + ':' + U.pad2(now.getMinutes())
        + '<span class="clock-sec">:' + U.pad2(now.getSeconds()) + '</span>';
    }
    var d = $('todayClockDate');
    if (d) {
      d.textContent = (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 · '
        + U.WEEKDAY_NAMES[U.weekdayOf(now)];
    }
  }

  function renderWeekRail(weekNo, sem, expanded, compact) {
    var body = $('weekBody');
    body.innerHTML = '';
    var monday = U.mondayOf(cursorDate);
    var today = U.startOfDay(new Date());

    // compact：这一栏没被展开 → 只显示一行摘要，避免被挤成竖排乱码
    if (compact) {
      var sum = 0, busyDays = 0;
      for (var sc = 1; sc <= 7; sc++) {
        var scCount = AR.Schedule.dayItems(U.addDays(monday, sc - 1), sem).length;
        sum += scCount;
        if (scCount) { busyDays++; }
      }
      body.appendChild(compactBlock('第 ' + Math.max(weekNo, 1) + ' 周',
        sum ? (sum + ' 节 · ' + busyDays + ' 天有课') : '这周没有课', '点开看整周'));
      return;
    }

    // 展开后顶部多一个「本周课表 / 月视图」切换
    if (expanded) {
      var seg = el('<div class="segmented" style="margin-bottom:10px"></div>');
      var modes = [{ k: 'week', t: '本周课表' }, { k: 'month', t: '月视图' }];
      for (var m = 0; m < modes.length; m++) {
        (function (mo) {
          var b = el('<button class="seg' + (weekZoneMode === mo.k ? ' active' : '') + '" type="button">' + mo.t + '</button>');
          b.addEventListener('click', function () {
            weekZoneMode = mo.k;
            AR.Bridge.haptic('light', b);
            renderWeekRail(weekNo, sem, true, false);
          });
          seg.appendChild(b);
        })(modes[m]);
      }
      body.appendChild(seg);
      // 展开态补充：本周统计
      var counts = [], totalWeek = 0, busiest = -1, busiestDay = 1;
      for (var wc = 1; wc <= 7; wc++) {
        var cCount = AR.Schedule.dayItems(U.addDays(monday, wc - 1), sem).length;
        counts.push(cCount);
        totalWeek += cCount;
        if (cCount > busiest) { busiest = cCount; busiestDay = wc; }
      }
      body.appendChild(el('<div class="zone-tools">'
        + '<span class="zone-stat">本周 ' + totalWeek + ' 节</span>'
        + '<span class="zone-stat">有课 ' + counts.filter(function (x) { return x > 0; }).length + ' 天</span>'
        + (totalWeek ? '<span class="zone-stat">最多 ' + U.WEEKDAY_NAMES[busiestDay] + ' ' + busiest + ' 节</span>' : '')
        + '</div>'));
      if (weekZoneMode === 'month') { renderMonthView(body, sem); return; }
      // 展开态：整张周表（和「周表」页同一套结构，只是窄一点）
      body.appendChild(weekTableNode(sem, Math.max(weekNo, 1), { narrow: true, clickDays: true }));
      body.appendChild(weekEventList(sem, Math.max(weekNo, 1)));
      body.appendChild(el('<div class="mini-foot">点课程块看详情；点日期切换「今日」。</div>'));
      return;
    }

    /**
     * 折叠态：迷你周表（和「周表」同构：日期在上、节次在左、课程是色块）
     * + 选中那一日的长条卡片。
     */
    var mini = weekTableNode(sem, Math.max(weekNo, 1), { mini: true });
    mini.classList.add('rail-mini');
    body.appendChild(mini);
    body.appendChild(el('<div class="mini-foot">' + U.WEEKDAY_NAMES[U.weekdayOf(cursorDate)] + ' '
      + (cursorDate.getMonth() + 1) + '/' + cursorDate.getDate()
      + ' · 点日期切换，点色块展开整周</div>'));
    return;
  }

  /** 本周条目：简洁长条卡片（时间、地点、老师都在，文字自动换行不省略） */
  function weekRailRowRich(item) {
    var node = el('<div class="strip">'
      + '<span class="st-bar" style="background:' + item.color + '"></span>'
      + '<div class="st-body">'
      + '<div class="st-head"><span class="st-title">' + U.escapeHtml(item.course.name) + '</span>'
      + '<span class="st-when">' + U.escapeHtml(item.periodLabel) + '</span></div>'
      + '<div class="st-meta"><span class="st-time">' + U.escapeHtml(fmtRange(item)) + '</span>'
      + (item.isConsecutive ? ' · 连堂' : '')
      + ' · ' + U.escapeHtml(item.location ? item.location.raw : '地点待补全')
      + ' · ' + U.escapeHtml(item.teachers.length ? item.teachers.map(function (t) { return t.name; }).join('、') : '老师待补全')
      + '</div></div></div>');
    node.addEventListener('click', function () {
      if (expandOwningZone(node)) { return; }
      openCourseModal(item);
    });
    return node;
  }

  /** 月视图：整月的课表密度 + 点日期直接跳转 */
  function renderMonthView(container, sem) {
    if (!monthCursor) { monthCursor = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1); }
    var today = U.startOfDay(new Date());

    var bar = el('<div class="month-nav">'
      + '<button class="icon-btn" data-m="-1" type="button" title="上个月">‹</button>'
      + '<span class="month-title">' + monthCursor.getFullYear() + ' 年 ' + (monthCursor.getMonth() + 1) + ' 月</span>'
      + '<button class="icon-btn" data-m="1" type="button" title="下个月">›</button>'
      + '</div>');
    var shiftBtns = bar.querySelectorAll('[data-m]');
    for (var s = 0; s < shiftBtns.length; s++) {
      (function (b) {
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var delta = Number(b.getAttribute('data-m'));
          monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + delta, 1);
          AR.Bridge.haptic('light', b);
          renderWeekRail(AR.Schedule.weekNumber(cursorDate, sem), sem, true, false);
        });
      })(shiftBtns[s]);
    }
    container.appendChild(bar);

    var back = el('<button class="chip-btn" type="button" style="margin-bottom:10px">回到今天</button>');
    back.addEventListener('click', function () {
      cursorDate = new Date();
      monthCursor = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
      renderToday();
    });
    container.appendChild(back);

    var head = el('<div class="month-head"></div>');
    for (var h = 1; h <= 7; h++) { head.appendChild(el('<span>' + U.WEEKDAY_NAMES[h].replace('周', '') + '</span>')); }
    container.appendChild(head);

    var grid = el('<div class="month-grid"></div>');
    var first = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
    var start = U.addDays(first, 1 - U.weekdayOf(first));
    for (var i = 0; i < 42; i++) {
      var d = U.addDays(start, i);
      var inMonth = d.getMonth() === monthCursor.getMonth();
      var items = AR.Schedule.dayItems(d, sem);
      var dots = '';
      for (var k = 0; k < Math.min(items.length, 3); k++) { dots += '<i></i>'; }
      var cls = 'month-cell' + (inMonth ? '' : ' out')
        + (U.sameDay(d, today) ? ' today' : '')
        + (U.sameDay(d, cursorDate) ? ' selected' : '');
      var cell = el('<button class="' + cls + '" type="button"><span>' + d.getDate()
        + '</span><span class="dots">' + dots + '</span></button>');
      (function (dd, node) {
        node.addEventListener('click', function (ev) {
          ev.stopPropagation();
          cursorDate = dd;
          AR.Bridge.haptic('light', node);
          renderToday();
        });
      })(d, cell);
      grid.appendChild(cell);
    }
    container.appendChild(grid);
    container.appendChild(el('<div class="muted" style="margin-top:10px">点日期即可切换；小圆点表示当天有课。</div>'));
  }

  function weekRailRow(item) {
    var node = el('<div class="week-course">'
      + '<span class="bar" style="background:' + item.color + '"></span>'
      + '<span class="txt"><b>' + U.escapeHtml(item.course.name) + '</b><br>'
      + U.escapeHtml(item.periodLabel) + ' · ' + U.escapeHtml(item.start || '') + '</span></div>');
    node.addEventListener('click', function () {
      if (expandOwningZone(node)) { return; }
      openCourseModal(item);
    });
    return node;
  }

  function renderNextPanel(now, expanded, compact) {
    var body = $('nextBody');
    body.innerHTML = '';
    var semNow = AR.Store.currentSemester();
    var next = AR.Schedule.nextItem(now);
    var ongoing = AR.Schedule.ongoingItem(now);
    var target = ongoing ? { item: ongoing, day: U.startOfDay(now), offsetDays: 0, ongoing: true } : next;

    if (!target) {
      $('nextBadge').textContent = '—';
      if (compact) {
        body.appendChild(compactBlock('最近没有安排', '未来两周都没有课', '点开看看'));
        return;
      }
      body.appendChild(el('<div class="empty"><div class="big">🌤</div><div class="t">最近没有安排</div><div class="muted">未来两周都没有课</div></div>'));
      return;
    }
    var item = target.item;
    var whenText = target.ongoing ? '正在进行' : (target.offsetDays === 0 ? '就在今天'
      : (target.offsetDays === 1 ? '明天' : target.offsetDays + ' 天后'));
    $('nextBadge').textContent = whenText;
    var st = nextStatusOf(target, now);      // 按离上课时间决定状态色（设置里可改）

    if (compact) {
      body.appendChild(compactBlock(whenText, item.course.name + ' · ' + (item.start || '时间待定'),
        st ? st.label : '点开看课程详情', st ? st.color : null));
      return;
    }

    // 状态色：只改边框（可选加粗）+ 一层很淡的同色底，不动课程本来颜色
    var cardStyle = 'margin-bottom:12px';
    if (st) {
      cardStyle += ';border:' + (st.thick ? 2 : 1) + 'px solid ' + st.color
        + ';box-shadow:0 0 0 3px ' + hexA(st.color, 0.16) + ', var(--shadow-card)';
    }
    var stateTag = st
      ? '<span class="tag" style="background:' + st.color + ';color:#fff;border-color:transparent">' + U.escapeHtml(st.label) + '</span>'
      : '';
    body.appendChild(el('<div class="card flat' + (st ? ' next-state' : '') + '" style="' + cardStyle + '">'
      + '<span class="card-accent" style="background:' + item.color + '"></span>'
      + '<div class="card-row between"><span class="time-chip">' + U.escapeHtml(fmtRange(item)) + '</span>'
      + '<span class="muted">' + (target.offsetDays === 0 ? '今天' : ((target.day.getMonth() + 1) + '/' + target.day.getDate()))
      + ' ' + U.WEEKDAY_NAMES[U.weekdayOf(target.day)] + '</span></div>'
      + (stateTag ? '<div class="card-row" style="margin-top:6px">' + stateTag + '</div>' : '')
      + '<div class="card-title" style="font-size:' + (expanded ? '20px' : '17px') + ';margin-top:6px">'
      + U.escapeHtml(item.course.name) + '</div>'
      + '<div class="card-meta">' + U.escapeHtml(item.periodLabel) + ' · '
      + U.escapeHtml(relativeText(item, now, target.day) || '') + '</div>'
      + '</div>'));

    // 四个可点模块：位置 / 时间 / 老师 / 备注
    body.appendChild(moduleBtn('位置', item.location ? item.location.raw : '未填写', function () { openLocationModal(item); }));
    body.appendChild(moduleBtn('时间', (target.day.getMonth() + 1) + '月' + target.day.getDate() + '日 · ' + fmtRange(item), function () { openTimeModal(item, target.day); }));
    body.appendChild(moduleBtn('老师', item.teachers.length ? item.teachers.map(function (t) { return t.name; }).join('、') : '未填写', function () { openTeacherModal(item); }));
    body.appendChild(moduleBtn('备注', item.note || '（空）', function () { openNoteModal(item); }));

    // 展开态补充：常用操作一步到位
    if (expanded) {
      var nextTools = el('<div class="zone-tools">'
        + '<button class="chip-btn" type="button" data-act="nav">打开导航</button>'
        + '<button class="chip-btn" type="button" data-act="cal">加入系统日历</button>'
        + '<button class="chip-btn" type="button" data-act="alarm">设闹钟</button>'
        + '<button class="chip-btn" type="button" data-act="copy">复制课程信息</button></div>');
      nextTools.querySelector('[data-act="nav"]').addEventListener('click', function () {
        var q = AR.Location.navQuery(item.location ? item.location.raw : '', S.settings).query;
        if (!q) { toast('这节课还没有地点'); return; }
        AR.Bridge.openMap(S.settings.integration.navApp, q, AR.Location.navWebUrl(q, S.settings.integration.navApp));
      });
      nextTools.querySelector('[data-act="cal"]').addEventListener('click', function () {
        var startMs = toMs(target.day, item.start) || Date.now();
        var endMs = toMs(target.day, item.end) || (startMs + 45 * 60000);
        AR.Bridge.addCalendarEvent(item.course.name, item.location ? item.location.raw : '',
          'Abbey Road 课表 · ' + item.periodLabel + (item.note ? ' · ' + item.note : ''), startMs, endMs);
      });
      nextTools.querySelector('[data-act="alarm"]').addEventListener('click', function () {
        var hm = (item.start || '08:00').split(':');
        AR.Bridge.setAlarm(Number(hm[0]), Number(hm[1]),
          item.course.name + ' ' + (item.location ? item.location.raw : ''));
      });
      nextTools.querySelector('[data-act="copy"]').addEventListener('click', function () {
        AR.Bridge.copy(item.course.name + ' ' + fmtRange(item)
          + (item.location ? ' @ ' + item.location.raw : '')
          + (item.teachers.length ? ' · ' + item.teachers.map(function (t) { return t.name; }).join('、') : ''));
      });
      body.appendChild(nextTools);
    }

    // 聚焦态才出现的补充信息
    var extra = el('<div class="focus-only">'
      + '<div class="muted" style="margin:10px 0 4px">课程信息</div>'
      + '<div class="detail-grid">'
      + '<div class="detail-key">周次</div><div class="detail-val">' + U.escapeHtml(AR.Schedule.weeksLabel(item.block, semNow ? semNow.weekCount : 20)) + '</div>'
      + '<div class="detail-key">地点</div><div class="detail-val">' + U.escapeHtml(item.location ? item.location.raw : '—') + '</div>'
      + '<div class="detail-key">备注</div><div class="detail-val">' + U.escapeHtml(item.note || '—') + '</div>'
      + (item.isConsecutive ? '<div class="detail-key">连堂</div><div class="detail-val">'
          + (item.segments ? item.segments.map(function (s) { return s[0] + '-' + s[1]; }).join(' + ') : '是') + '（自动识别）</div>' : '')
      + '</div></div>');
    body.appendChild(extra);
  }

  function moduleBtn(k, v, onClick) {
    var node = el('<button class="module" type="button"><div class="k">' + k + '</div><div class="v">'
      + U.escapeHtml(v) + '</div></button>');
    node.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (expandOwningZone(node)) { return; }   // 收起状态下先展开这一栏
      AR.Bridge.haptic('light', node);
      onClick();
    });
    return node;
  }

  /* ── 周表 ─────────────────────────────────────────────────── */

  function renderWeek(opts) {
    var sem = AR.Store.currentSemester();
    if (!sem) { return; }
    var weekCount = sem.weekCount || 20;
    if (weekCursor == null) { weekCursor = Math.max(1, AR.Schedule.weekNumber(new Date(), sem)); }
    $('weekSub').textContent = sem.name + ' · 第 ' + weekCursor + ' / ' + weekCount + ' 周';

    /**
     * 周视图 / 月视图切换（设置里可以关掉这个功能）。
     * 月视图按整月铺课程与事件，点某天直接跳回那一周。
     */
    var monthAllowed = !(S.settings.schedule && S.settings.schedule.weekMonthView === false);
    var modeBox = $('weekMode');
    if (modeBox) {
      modeBox.hidden = !monthAllowed;
      modeBox.innerHTML = '';
      if (monthAllowed) {
        var seg = el('<div class="segmented"></div>');
        var modes = [{ k: 'week', t: '周视图' }, { k: 'month', t: '月视图' }];
        for (var mi = 0; mi < modes.length; mi++) {
          (function (mo) {
            var b = el('<button class="seg' + (weekPageMode === mo.k ? ' active' : '') + '" type="button">' + mo.t + '</button>');
            b.addEventListener('click', function () {
              if (weekPageMode === mo.k) { return; }
              weekPageMode = mo.k;
              AR.Bridge.haptic('light', b);
              renderWeek({ swap: 0 });     // 周视图 ↔ 月视图：原地淡入 + 轻微缩放
            });
            seg.appendChild(b);
          })(modes[mi]);
        }
        modeBox.appendChild(seg);
        enhanceSegmented(modeBox);
      }
    }
    var strip0 = $('weekStrip');
    if (monthAllowed && weekPageMode === 'month') {
      if (strip0) { strip0.hidden = true; }
      renderWeekMonth($('weekGridWrap'), sem);
      renderConflicts();
      if (opts && typeof opts.swap === 'number') { animateWeekSwap(opts.swap); }
      return;
    }
    if (strip0) { strip0.hidden = false; }

    renderWeekStrip(sem);
    renderWeekTable(sem);
    renderConflicts();
    if (opts && typeof opts.swap === 'number') { animateWeekSwap(opts.swap); }
  }

  /**
   * 周表「上一周 / 本周 / 下一周」与视图切换的过渡。
   * 规格书：只动 opacity / translate / scale。
   *   dir > 0 → 下一周，内容从右侧浮入
   *   dir < 0 → 上一周，内容从左侧浮入
   *   dir = 0 → 原地淡入（周视图 ↔ 月视图）
   */
  function animateWeekSwap(dir) {
    var wrap = $('weekGridWrap');
    if (wrap && wrap.animate) {
      var dx = (dir === 0) ? 0 : (dir > 0 ? 26 : -26);
      if (wrap.__swap) { try { wrap.__swap.cancel(); } catch (e) { } }
      wrap.__swap = wrap.animate(
        [
          { opacity: 0, transform: 'translateX(' + dx + 'px) scale(' + (dir === 0 ? '0.99' : '0.995') + ')' },
          { opacity: 1, transform: 'translateX(0px) scale(1)' }
        ],
        { duration: 340, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' }
      );
    }
    var strip = $('weekStrip');
    if (strip) { fadeInList(strip, '.week-chip'); }     // 周次条：30ms 错峰淡入
    var sub = $('weekSub');
    if (sub && sub.animate) {
      if (sub.__swap) { try { sub.__swap.cancel(); } catch (e) { } }
      sub.__swap = sub.animate(
        [{ opacity: 0.2 }, { opacity: 1 }],
        { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' }
      );
    }
  }

  /** 月视图：整月的课程密度 + 点某天跳回那一周 */
  function renderWeekMonth(container, sem) {
    container.innerHTML = '';
    if (!weekMonthCursor) {
      weekMonthCursor = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
    }
    var today = U.startOfDay(new Date());

    var bar = el('<div class="month-nav">'
      + '<button class="icon-btn" data-m="-1" type="button" title="上个月">‹</button>'
      + '<span class="month-title">' + weekMonthCursor.getFullYear() + ' 年 '
      + (weekMonthCursor.getMonth() + 1) + ' 月</span>'
      + '<button class="icon-btn" data-m="1" type="button" title="下个月">›</button>'
      + '<button class="chip-btn" data-m="0" type="button">回到本周</button></div>');
    var navBtns = bar.querySelectorAll('[data-m]');
    for (var n = 0; n < navBtns.length; n++) {
      (function (b) {
        b.addEventListener('click', function () {
          var delta = Number(b.getAttribute('data-m'));
          if (delta === 0) {
            weekCursor = Math.max(1, AR.Schedule.weekNumber(new Date(), sem));
            cursorDate = new Date();
            weekMonthCursor = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
          } else {
            weekMonthCursor = new Date(weekMonthCursor.getFullYear(), weekMonthCursor.getMonth() + delta, 1);
          }
          AR.Bridge.haptic('light', b);
          // 月视图翻页也走同一套过渡：下个月从右侧浮入，上个月从左侧，回到本月原地淡入
          renderWeek({ swap: delta === 0 ? 0 : (delta > 0 ? 1 : -1) });
        });
      })(navBtns[n]);
    }
    container.appendChild(bar);

    var head = el('<div class="month-head"></div>');
    for (var h = 1; h <= 7; h++) { head.appendChild(el('<span>' + U.WEEKDAY_NAMES[h].replace('周', '') + '</span>')); }
    container.appendChild(head);

    var grid = el('<div class="month-cal"></div>');
    var first = new Date(weekMonthCursor.getFullYear(), weekMonthCursor.getMonth(), 1);
    var start = U.addDays(first, 1 - U.weekdayOf(first));
    for (var i = 0; i < 42; i++) {
      var d = U.addDays(start, i);
      var inMonth = d.getMonth() === weekMonthCursor.getMonth();
      var items = AR.Schedule.dayItems(d, sem);
      var events = AR.Store.eventsOf ? AR.Store.eventsOf(d) : [];
      var cls = 'mc-cell' + (inMonth ? '' : ' out') + (U.sameDay(d, today) ? ' today' : '')
        + (U.sameDay(d, cursorDate) ? ' selected' : '');
      var cell = el('<button class="' + cls + '" type="button"><span class="mc-d">' + d.getDate() + '</span></button>');
      var chips = el('<div class="mc-chips"></div>');
      for (var c = 0; c < items.length && c < 3; c++) {
        chips.appendChild(el('<span class="mc-chip" style="background:' + items[c].color + '">'
          + U.escapeHtml(items[c].course.name) + '</span>'));
      }
      if (items.length > 3) { chips.appendChild(el('<span class="mc-more">+' + (items.length - 3) + '</span>')); }
      for (var e2 = 0; e2 < events.length; e2++) {
        var t2 = AR.Store.eventType(events[e2].type);
        chips.appendChild(el('<span class="mc-ev" style="background:' + t2.hex + '">'
          + t2.mark + ' ' + U.escapeHtml(events[e2].title) + '</span>'));
      }
      cell.appendChild(chips);
      (function (dd, node) {
        node.addEventListener('click', function () {
          cursorDate = dd;
          weekCursor = Math.max(1, AR.Schedule.weekNumber(dd, sem));
          weekPageMode = 'week';        // 点日期 = 看那一周
          AR.Bridge.haptic('light', node);
          renderToday();
          renderWeek({ swap: 0 });      // 月 → 周：原地淡入
        });
      })(d, cell);
      grid.appendChild(cell);
    }
    container.appendChild(grid);
    container.appendChild(el('<div class="muted" style="margin-top:10px">点任意一天即可跳到那一周的课表。</div>'));
  }

  /** 冲突检测面板（周视图 / 月视图共用） */
  function renderConflicts() {

    // 冲突面板
    var conflicts = AR.Schedule.conflicts();
    var panel = $('conflictPanel');
    if (conflicts.length) {
      panel.hidden = false;
      $('conflictCount').textContent = conflicts.length + ' 处';
      var list = $('conflictList');
      list.innerHTML = '';
      for (var c = 0; c < conflicts.length; c++) {
        list.appendChild(el('<div class="list-item ' + (conflicts[c].level === 'danger' ? 'danger' : '')
          + '"><span class="code-badge">' + conflicts[c].code + '</span><span class="msg">'
          + U.escapeHtml(conflicts[c].message) + '</span></div>'));
      }
      // 默认收起：冲突多的时候不能把周表挤成一条缝
      list.hidden = !conflictOpen;
      panel.classList.toggle('open', conflictOpen);
      var ct = $('conflictToggle');
      if (ct) { ct.textContent = conflictOpen ? '收起' : '查看'; }
    } else {
      panel.hidden = true;
    }
  }

  /** 周次快切：1…总周数，点一下换周 */
  function renderWeekStrip(sem) {
    var strip = $('weekStrip');
    if (!strip) { return; }
    strip.innerHTML = '';
    var weekCount = sem.weekCount || 20;
    var nowWeek = Math.max(1, AR.Schedule.weekNumber(new Date(), sem));
    for (var w = 1; w <= weekCount; w++) {
      (function (n) {
        var chip = el('<button class="week-chip' + (n === weekCursor ? ' active' : '')
          + (n === nowWeek ? ' now' : '') + '" type="button">' + n + '</button>');
        chip.title = '第 ' + n + ' 周';
        chip.addEventListener('click', function () {
          weekCursor = n;
          weekDaySel = null;
          AR.Bridge.haptic('light', chip);
          renderWeek();
        });
        strip.appendChild(chip);
      })(w);
    }
    var active = strip.querySelector('.week-chip.active');
    if (active && active.scrollIntoView) {
      try { active.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { }
    }
  }

  /**
   * 整周课表格：一周 7 天的日期在上，节次与上课时间在左列，课程块按节次跨行。
   * 同一套结构复用在三处：周表页、本周概览展开态、本周概览迷你态（mini：只画色块）。
   */
  function weekTableNode(sem, weekNo, opts) {
    opts = opts || {};
    var mini = !!opts.mini;
    var narrow = !!opts.narrow;      // 放在「本周概览」这种窄栏里：时间列更细、字号更小
    var periods = AR.Store.periodsOf(sem.id);
    var monday = U.addDays(U.mondayOf(U.parseDateKey(sem.startDate)), (weekNo - 1) * 7);
    var today = U.startOfDay(new Date());

    // 这一周实际用到多少节
    var byIndex = {};
    for (var pi = 0; pi < periods.length; pi++) { byIndex[periods[pi].index] = periods[pi]; }
    var maxUsed = 0, weekTotal = 0;
    var dayItems = [];
    for (var d = 1; d <= 7; d++) {
      var its = AR.Schedule.weekItems(weekNo, d);
      dayItems.push(its);
      weekTotal += its.length;
      for (var i = 0; i < its.length; i++) {
        var endIdx = itemEndPeriod(its[i]);
        if (endIdx > maxUsed) { maxUsed = endIdx; }
      }
    }
    if (!maxUsed) { maxUsed = Math.min(periods.length || 8, mini ? 5 : 8); }
    var rows = Math.max(Math.min(maxUsed, mini ? 6 : maxUsed), 1);

    // 特殊事件（考试 / 讲座 / 活动）：在日期下面单独占一行，用专属颜色显示
    var weekEvents = AR.Store.eventsInWeek ? AR.Store.eventsInWeek(weekNo, sem) : [];
    var evRow = weekEvents.length ? 1 : 0;

    var table = el('<div class="week-table' + (mini ? ' mini-table' : '') + '"></div>');
    if (mini) {
      table.style.gridTemplateColumns = '16px repeat(7, minmax(0, 1fr))';
      table.style.gridTemplateRows = 'auto ' + (evRow ? 'auto ' : '') + 'repeat(' + rows + ', minmax(9px, 1fr))';
    } else if (narrow) {
      table.classList.add('rail-table');
      table.style.gridTemplateColumns = '38px repeat(7, minmax(0, 1fr))';
      table.style.gridTemplateRows = 'auto ' + (evRow ? 'auto ' : '') + 'repeat(' + rows + ', minmax(46px, 1fr))';
    } else {
      table.style.gridTemplateColumns = '46px repeat(7, minmax(42px, 1fr))';
      table.style.gridTemplateRows = 'auto ' + (evRow ? 'auto ' : '') + 'repeat(' + rows + ', minmax(58px, 1fr))';
    }

    // 表头：左上角显示月份，其余 7 列是「周X + 日期」（迷你版只留日期）
    table.appendChild(el('<div class="' + (mini ? 'mg-corner' : 'wt-corner') + '" style="grid-row:1;grid-column:1">'
      + (monday.getMonth() + 1) + ' 月</div>'));
    for (var dh = 1; dh <= 7; dh++) {
      var dDate = U.addDays(monday, dh - 1);
      var head = el('<div class="' + (mini ? 'mg-day' : 'wt-day') + (U.sameDay(dDate, today) ? ' today' : '')
        + '" style="grid-row:1;grid-column:' + (dh + 1) + '">'
        + (mini ? '' : '<span class="w">' + U.WEEKDAY_NAMES[dh] + '</span>')
        + '<span class="n">' + dDate.getDate() + '</span></div>');
      if (mini || opts.clickDays) {
        (function (dd) {
          head.addEventListener('click', function (ev) {
            ev.stopPropagation();
            cursorDate = dd;
            AR.Bridge.haptic('tap', head);      // 切换日期：轻点震动 + 重播浮入动画
            renderToday();
            replayZoneContent('zoneWeek');     // 每次切换日期都重播一遍浮入动画
          });
        })(dDate);
      }
      table.appendChild(head);
    }

    // 事件行（第 2 行）：每天最多显示 2 条，颜色按类型区分
    if (evRow) {
      table.appendChild(el('<div class="' + (mini ? 'mg-evlabel' : 'wt-evlabel')
        + '" style="grid-row:2;grid-column:1">' + (mini ? '事' : '事件') + '</div>'));
      for (var ed = 1; ed <= 7; ed++) {
        var cellBox = el('<div class="' + (mini ? 'mg-evcell' : 'wt-evcell')
          + '" style="grid-row:2;grid-column:' + (ed + 1) + '"></div>');
        var mine = [];
        for (var we = 0; we < weekEvents.length; we++) {
          var wd = window.AR && U.weekdayOf(U.parseDateKey(weekEvents[we].date));
          if (wd === ed) { mine.push(weekEvents[we]); }
        }
        for (var mi = 0; mi < Math.min(mine.length, 2); mi++) {
          (function (ev) {
            var t = AR.Store.eventType(ev.type);
            var chip = el('<button class="ev-chip' + (mini ? ' mini' : '') + '" type="button"'
              + ' style="background:' + t.hex + ';border-color:' + t.hex + '" title="'
              + U.escapeHtml(t.label + ' · ' + ev.title) + '">'
              + '<span class="mark">' + t.mark + '</span>'
              + (mini ? '' : '<span class="txt">' + U.escapeHtml(ev.title) + '</span>')
              + '</button>');
            chip.addEventListener('click', function (ev2) {
              ev2.stopPropagation();
              openEventModal(ev);
            });
            cellBox.appendChild(chip);
          })(mine[mi]);
        }
        if (mine.length > 2) { cellBox.appendChild(el('<span class="ev-more">+' + (mine.length - 2) + '</span>')); }
        table.appendChild(cellBox);
      }
    }

    // 占用表：被跨行课程块盖住的格子不再单独画
    var occupied = {};
    for (var r0 = 0; r0 < rows; r0++) {
      for (var c0 = 1; c0 <= 7; c0++) { occupied[r0 + '_' + c0] = false; }
    }

    for (var row = 0; row < rows; row++) {
      var pIdx = row + 1;
      var per = byIndex[pIdx];
      table.appendChild(el('<div class="' + (mini ? 'mg-time' : 'wt-time') + '" style="grid-row:' + (row + 2 + evRow) + ';grid-column:1">'
        + (mini ? '<span class="p">' + pIdx + '</span>'
                : '<span class="p">第' + pIdx + '节</span><span class="t">' + (per ? U.escapeHtml(per.start) : '') + '</span>')
        + '</div>'));

      for (var day = 1; day <= 7; day++) {
        if (occupied[row + '_' + day]) { continue; }
        var list = dayItems[day - 1];
        var hit = null;
        for (var k = 0; k < list.length; k++) {
          if (itemStartPeriod(list[k]) === pIdx) { hit = list[k]; break; }
        }
        if (!hit) {
          table.appendChild(el('<div class="' + (mini ? 'mg-empty' : 'wt-empty') + '" style="grid-row:'
            + (row + 2 + evRow) + ';grid-column:' + (day + 1) + '"></div>'));
          continue;
        }
        var span = Math.max(1, itemEndPeriod(hit) - itemStartPeriod(hit) + 1);
        if (row + span > rows) { span = rows - row; }
        for (var s2 = 0; s2 < span; s2++) { occupied[(row + s2) + '_' + day] = true; }
        var block;
        if (mini) {
          block = el('<div class="mg-block" style="grid-row:' + (row + 2 + evRow) + ' / span ' + span
            + ';grid-column:' + (day + 1) + ';background:' + hit.color + '"></div>');
        } else {
          block = el('<div class="wt-block" style="grid-row:' + (row + 2 + evRow) + ' / span ' + span
            + ';grid-column:' + (day + 1) + ';background:' + hit.color + '">'
            + '<span class="n">' + U.escapeHtml(hit.course.name) + '</span>'
            + (hit.location ? '<span class="l">' + U.escapeHtml(hit.location.raw) + '</span>' : '')
            + (hit.teachers.length ? '<span class="k">' + U.escapeHtml(hit.teachers.map(function (t) { return t.name; }).join('、')) + '</span>' : '')
            + '</div>');
        }
        (function (item) {
          block.addEventListener('click', function (ev) {
            if (mini) { ev.stopPropagation(); setExpanded('week'); return; }
            openCourseModal(item);
          });
        })(hit);
        table.appendChild(block);
      }
    }
    table.__total = weekTotal;
    table.__rows = rows;
    return table;
  }

  /** 周表页：把整周表格塞进面板，行多时在面板内部滚动 */
  function renderWeekTable(sem) {
    var wrap = $('weekGridWrap');
    wrap.innerHTML = '';
    var node = weekTableNode(sem, weekCursor, {});
    wrap.appendChild(node);
    if (!node.__total) {
      wrap.appendChild(el('<div class="empty" style="padding:18px"><div class="t">这一周没有安排</div>'
        + '<div class="muted">用上面的周次条切换到别的周看看</div></div>'));
    }
    fadeInList(wrap, '.wt-block');
  }

  /** 课程块落在第几节开始 / 结束（用时间反查节次，兼容调课改时间） */
  function itemStartPeriod(item) {
    var sem = AR.Store.currentSemester();
    var ps = AR.Store.periodsOf(sem ? sem.id : null);
    if (item.start) {
      for (var i = 0; i < ps.length; i++) { if (ps[i].start === item.start) { return ps[i].index; } }
    }
    return item.block.periodStart || 1;
  }

  function itemEndPeriod(item) {
    var sem = AR.Store.currentSemester();
    var ps = AR.Store.periodsOf(sem ? sem.id : null);
    if (item.end) {
      for (var i = 0; i < ps.length; i++) { if (ps[i].end === item.end) { return ps[i].index; } }
    }
    return item.block.periodEnd || item.block.periodStart || 1;
  }

  /** 某 item 在节次表里的行下标 */
  function periodIndexIn(periods, item) {
    for (var i = 0; i < periods.length; i++) {
      if (item.start && periods[i].start === item.start) { return i; }
    }
    for (var j = 0; j < periods.length; j++) {
      if (periods[j].index === item.block.periodStart) { return j; }
    }
    return -1;
  }

  function shortPlace(s) {
    var t = String(s || '');
    return t.length > 10 ? t.slice(0, 10) + '…' : t;
  }

  /* ── 弹窗 ─────────────────────────────────────────────────── */

  var modalStack = [];
  var modalCloseTimer = null;

  function openModal(opts) {
    var root = $('modalRoot');
    var card = $('modalCard');
    if (modalCloseTimer) { clearTimeout(modalCloseTimer); modalCloseTimer = null; }
    root.classList.remove('closing');
    card.innerHTML = '';
    var head = el('<div class="modal-head"><div><h3 class="modal-title">' + U.escapeHtml(opts.title || '') + '</h3>'
      + (opts.sub ? '<p class="modal-sub">' + U.escapeHtml(opts.sub) + '</p>' : '') + '</div>'
      + '<button class="modal-close" type="button">✕</button></div>');
    head.querySelector('.modal-close').addEventListener('click', closeModal);
    card.appendChild(head);
    var bodyNode = el('<div class="modal-body"></div>');
    if (typeof opts.body === 'string') { bodyNode.innerHTML = opts.body; }
    else if (opts.body) { bodyNode.appendChild(opts.body); }
    card.appendChild(bodyNode);
    if (opts.actions && opts.actions.length) {
      var actions = el('<div class="modal-actions"></div>');
      for (var i = 0; i < opts.actions.length; i++) {
        (function (a) {
          var b = el('<button class="btn ' + (a.kind || '') + '" type="button">' + U.escapeHtml(a.label) + '</button>');
          b.addEventListener('click', function () {
            AR.Bridge.haptic(a.kind === 'danger' ? 'warn' : 'light', $('modalCard'));
            a.onClick && a.onClick(closeModal);
          });
          actions.appendChild(b);
        })(opts.actions[i]);
      }
      card.appendChild(actions);
    }
    root.hidden = false;
    modalStack.push(opts);
    /**
     * 规格书规则 2：取消 → 复位 → 强制刷新 → 启动。
     * 弹窗容器刚才是 display:none，浏览器还没算过 .modal-card 的 transform，
     * 少了这一步就会拿 translate(0,0) scale(1) 当起点，出场变成"从右下角斜着滑进来"。
     * 这里再把起点显式写死一次（scale .92 居中），双保险。
     */
    card.style.transition = 'none';
    card.style.transform = 'scale(0.92)';
    card.style.opacity = '0';
    void card.offsetWidth;
    card.style.transition = '';
    card.style.transform = '';
    card.style.opacity = '';
    void card.offsetWidth;
    requestAnimationFrame(function () { root.classList.add('open'); });
    AR.Bridge.haptic('light', card);
  }

  function closeModal() {
    var root = $('modalRoot');
    if (root.hidden) { return false; }
    root.classList.remove('open');
    root.classList.add('closing');                 // 规格书：出场 200ms / scale .96
    modalStack.pop();
    if (modalCloseTimer) { clearTimeout(modalCloseTimer); }
    modalCloseTimer = setTimeout(function () {
      modalCloseTimer = null;
      root.classList.remove('closing');
      if (!modalStack.length) { root.hidden = true; }
    }, 200);
    return true;
  }

  /** 课程详情：设置里可改颜色、备注，也可删除 */
  function openCourseModal(item) {
    var sem = AR.Store.currentSemester();
    var body = '<div class="detail-grid">'
      + '<div class="detail-key">时间</div><div class="detail-val">' + U.WEEKDAY_NAMES[U.weekdayOf(item.date)] + ' '
      + U.escapeHtml(fmtRange(item)) + '（' + U.escapeHtml(item.periodLabel) + '）</div>'
      + '<div class="detail-key">周次</div><div class="detail-val">' + U.escapeHtml(AR.Schedule.weeksLabel(item.block, sem.weekCount)) + '</div>'
      + '<div class="detail-key">老师</div><div class="detail-val">' + U.escapeHtml(item.teachers.map(function (t) { return t.name; }).join('、') || '—') + '</div>'
      + '<div class="detail-key">地点</div><div class="detail-val">' + U.escapeHtml(item.location ? item.location.raw : '—') + '</div>'
      + '<div class="detail-key">备注</div><div class="detail-val">' + U.escapeHtml(item.note || '—') + '</div>'
      + '</div>'
      + '<div class="field" style="margin-top:14px">'
      + '<label class="field-label">改课程名（同名课会合并成同一门，并统一颜色）</label>'
      + '<div class="row gap"><input class="input" id="renameCourseInput" value="'
      + U.escapeHtml(item.course.name) + '">'
      + '<button class="btn primary" type="button" id="renameCourseBtn">保存</button></div></div>';
    openModal({
      title: item.course.name,
      sub: '课程详情',
      body: body,
      actions: [
        { label: '设置颜色', onClick: function () { openColorModal(item); } },
        { label: '编辑备注', onClick: function () { openNoteModal(item); } },
        { label: '删除这门课', kind: 'danger', onClick: function (close) { deleteCourse(item.course.id, close); } },
        { label: '关闭', kind: 'primary', onClick: function (close) { close(); } }
      ]
    });
    var input = $('renameCourseInput');
    var btn = $('renameCourseBtn');
    if (btn && input) {
      var doRename = function () {
        var name = (input.value || '').trim();
        if (!name || name === item.course.name) { closeModal(); return; }
        var res = AR.Store.renameCourse(item.course.id, name);
        if (!res.ok) { toast(res.message || '改名失败'); return; }
        AR.Bridge.haptic('medium', btn);
        closeModal();
        renderToday();
        if (currentView === 'week') { renderWeek(); }
        toast(res.merged ? ('已合并到「' + name + '」，颜色也统一了') : ('已改名为「' + name + '」'));
      };
      btn.addEventListener('click', doRename);
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); doRename(); }
      });
    }
  }

  function openColorModal(item) {
    var box = el('<div class="swatches"></div>');
    for (var i = 0; i < U.PALETTE.length; i++) {
      (function (p) {
        var sw = el('<div class="swatch' + (item.course.colorKey === p.key ? ' active' : '')
          + '" title="' + p.name + '" style="background:' + p.hex + '"></div>');
        sw.addEventListener('click', function () {
          item.course.colorKey = p.key;
          item.course.updatedAt = new Date().toISOString();
          AR.Store.save(true);
          AR.Bridge.haptic('light', sw);
          closeModal();
          renderToday();
          renderWeek();
          toast('颜色已改为' + p.name);
        });
        box.appendChild(sw);
      })(U.PALETTE[i]);
    }
    openModal({ title: '课程颜色', sub: item.course.name, body: box, actions: [{ label: '取消', onClick: function (c) { c(); } }] });
  }

  function deleteCourse(courseId, close) {
    var blocks = AR.Store.blocksOfCourse(courseId);
    for (var i = 0; i < blocks.length; i++) { AR.Store.markDeleted('blocks', blocks[i].id); }
    var list = S.blocks;
    S.blocks = list.filter(function (b) { return b.courseId !== courseId; });
    S.courses = S.courses.filter(function (c) { return c.id !== courseId; });
    AR.Store.save(true);
    close();
    AR.Bridge.haptic('warn', $('zoneNext'));
    renderToday();
    renderWeek();
    toast('已删除该课程');
  }

  /* 位置模块 */
  function openLocationModal(item) {
    var raw = item.location ? item.location.raw : '';
    var nav = AR.Location.navQuery(raw, S.settings);
    var body = el('<div></div>');
    body.appendChild(el('<div class="detail-grid">'
      + '<div class="detail-key">原始地点</div><div class="detail-val">' + U.escapeHtml(raw || '未填写') + '</div>'
      + '<div class="detail-key">裁剪后</div><div class="detail-val">' + U.escapeHtml(nav.trimmed || '—') + '</div>'
      + '<div class="detail-key">解析</div><div class="detail-val">'
      + (nav.steps.length ? nav.steps.map(function (s) { return U.escapeHtml(s); }).join(' · ') : '未做调整') + '</div>'
      + '</div>'));
    var field = el('<div class="field" style="margin-top:14px"><label class="field-label">最终导航查询词（可修改）</label>'
      + '<input class="input" id="navQueryInput" value="' + U.escapeHtml(nav.query) + '"></div>');
    body.appendChild(field);
    if (nav.online) {
      body.appendChild(el('<div class="issue info"><span class="msg">识别为线上课程，按规则不打开地图，可复制会议信息。</span></div>'));
    }
    body.appendChild(el('<div class="muted" style="margin-top:8px">导航偏好：'
      + navAppName(S.settings.integration.navApp) + '（可在 设置 → 系统集成 修改）</div>'));

    openModal({
      title: '位置',
      sub: item.course.name,
      body: body,
      actions: [
        { label: '复制地址', onClick: function () { AR.Bridge.copy(raw || nav.query); } },
        {
          label: '打开导航', kind: 'primary', onClick: function () {
            var q = ($('navQueryInput') && $('navQueryInput').value || '').trim() || nav.query;
            if (!q) { toast('请先填写地点'); return; }
            if (nav.online && S.settings.integration.onlineTreatAsNoNav) { toast('线上课程不导航，已复制'); AR.Bridge.copy(raw); return; }
            AR.Bridge.openMap(S.settings.integration.navApp, q, AR.Location.navWebUrl(q, S.settings.integration.navApp));
          }
        },
        {
          label: '编辑地点', onClick: function () {
            openEditPlaceModal(item);
          }
        }
      ]
    });
  }

  function navAppName(key) {
    return key === 'amap' ? '高德地图' : (key === 'baidu' ? '百度地图' : (key === 'google' ? 'Google 地图' : '系统地图'));
  }

  function openEditPlaceModal(item) {
    var body = el('<div class="field"><label class="field-label">地点（原样保存，导航时自动裁剪）</label>'
      + '<input class="input" id="placeEditInput" value="'
      + U.escapeHtml(item.location ? item.location.raw : '') + '"></div>');
    openModal({
      title: '编辑地点', sub: item.course.name, body: body,
      actions: [{
        label: '保存', kind: 'primary', onClick: function (close) {
          var v = ($('placeEditInput') && $('placeEditInput').value || '').trim();
          if (item.location) {
            item.location.raw = v;
            item.location.updatedAt = new Date().toISOString();
          } else {
            var parts = AR.MdParse.parsePlaceParts(v, S.settings.integration);
            var loc = {
              id: U.uid(), raw: v, building: parts.building, campus: parts.campus,
              university: parts.university, city: parts.city, room: parts.room,
              navQueryOverride: '', updatedAt: new Date().toISOString()
            };
            S.locations.push(loc);
            item.block.locationIds = [loc.id];
          }
          AR.Store.save(true);
          close();
          AR.Bridge.haptic('medium', $('zoneNext'));
          renderToday();
          toast('地点已保存');
        }
      }]
    });
  }

  /** 时间模块：系统日历 / 闹钟 */
  function openTimeModal(item, day) {
    var startMs = toMs(day, item.start);
    var endMs = toMs(day, item.end) || (startMs + 45 * 60000);
    var body = '<div class="detail-grid">'
      + '<div class="detail-key">日期</div><div class="detail-val">' + (day.getFullYear()) + ' 年 '
      + (day.getMonth() + 1) + ' 月 ' + day.getDate() + ' 日 ' + U.WEEKDAY_NAMES[U.weekdayOf(day)] + '</div>'
      + '<div class="detail-key">节次</div><div class="detail-val">' + U.escapeHtml(item.periodLabel) + '</div>'
      + '<div class="detail-key">时间</div><div class="detail-val">' + U.escapeHtml(fmtRange(item)) + '</div>'
      + '<div class="detail-key">时长</div><div class="detail-val">'
      + (item.startMin != null && item.endMin != null ? (item.endMin - item.startMin) + ' 分钟' : '—') + '</div>'
      + '</div>'
      + '<p class="panel-sub" style="margin-top:12px">课前进度提醒：'
      + (S.settings.notifications.enabled ? ('提前 ' + S.settings.notifications.defaultOffset + ' 分钟通知') : '未开启（可在设置里打开）')
      + '</p>';
    openModal({
      title: '时间', sub: item.course.name, body: body,
      actions: [
        {
          label: '添加到系统日历', kind: 'primary', onClick: function () {
            AR.Bridge.addCalendarEvent(
              item.course.name,
              item.location ? item.location.raw : '',
              'Abbey Road 课表 · ' + item.periodLabel + (item.note ? ' · ' + item.note : ''),
              startMs, endMs);
            AR.Bridge.haptic('medium', $('modalCard'));
          }
        },
        {
          label: '设置闹钟', onClick: function () {
            var hm = (item.start || '08:00').split(':');
            AR.Bridge.setAlarm(Number(hm[0]), Number(hm[1]), item.course.name + ' ' + (item.location ? item.location.raw : ''));
            AR.Bridge.haptic('medium', $('modalCard'));
          }
        },
        {
          label: '修改提醒', onClick: function () {
            S.settings.notifications.enabled = true;
            S.settings.notifications.defaultOffset = S.settings.notifications.defaultOffset || 15;
            AR.Store.save(true);
            AR.Panels.renderSettings();
            toast('已开启课前提醒：提前 ' + S.settings.notifications.defaultOffset + ' 分钟（可在设置里调整）');
          }
        }
      ]
    });
  }

  function toMs(day, hm) {
    if (!hm) { return null; }
    var parts = hm.split(':');
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(parts[0]), Number(parts[1]), 0, 0).getTime();
  }

  /* 老师模块 */
  function openTeacherModal(item) {
    var body = el('<div></div>');
    if (!item.teachers.length) {
      body.appendChild(el('<p class="muted">还没有老师信息，可以在导入的 Markdown 里补充「老师」列。</p>'));
    }
    for (var i = 0; i < item.teachers.length; i++) {
      var t = item.teachers[i];
      var field = el('<div class="field"><label class="field-label">' + U.escapeHtml(t.name) + '</label>'
        + '<input class="input" data-teacher="' + t.id + '" data-field="note" placeholder="备注（如：办公室 / 答疑时间）" value="'
        + U.escapeHtml(t.note || '') + '">'
        + '<input class="input" style="margin-top:8px" data-teacher="' + t.id + '" data-field="contact" placeholder="联系方式（电话 / 邮箱 / 微信）" value="'
        + U.escapeHtml(t.contact || '') + '"></div>');
      body.appendChild(field);
    }
    openModal({
      title: '老师', sub: item.course.name, body: body,
      actions: [
        {
          label: '复制姓名', onClick: function () {
            AR.Bridge.copy(item.teachers.map(function (x) { return x.name; }).join('、') || '');
          }
        },
        {
          label: '保存', kind: 'primary', onClick: function (close) {
            var inputs = document.querySelectorAll('[data-teacher]');
            for (var i = 0; i < inputs.length; i++) {
              var id = inputs[i].getAttribute('data-teacher');
              var f = inputs[i].getAttribute('data-field');
              var t = AR.Store.teacherById(id);
              if (t) { t[f] = inputs[i].value; t.updatedAt = new Date().toISOString(); }
            }
            AR.Store.save(true);
            close();
            AR.Bridge.haptic('medium', $('zoneNext'));
            toast('已保存老师信息');
          }
        }
      ]
    });
  }

  /* 备注模块 */
  function openNoteModal(item) {
    var body = el('<div class="field"><label class="field-label">备注（会显示在课程详情里）</label>'
      + '<textarea class="input" id="noteEditInput" rows="6">' + U.escapeHtml(item.note || '') + '</textarea></div>');
    openModal({
      title: '备注', sub: item.course.name, body: body,
      actions: [
        { label: '复制', onClick: function () { AR.Bridge.copy(item.note || ''); } },
        {
          label: '保存', kind: 'primary', onClick: function (close) {
            var v = ($('noteEditInput') && $('noteEditInput').value || '');
            item.block.note = v;
            item.block.updatedAt = new Date().toISOString();
            AR.Store.save(true);
            close();
            AR.Bridge.haptic('medium', $('zoneNext'));
            renderToday();
            toast('备注已保存');
          }
        }
      ]
    });
  }

  /* ── Toast ────────────────────────────────────────────────── */

  function toast(msg) {
    var host = $('toastHost');
    var node = el('<div class="toast">' + U.escapeHtml(msg) + '</div>');
    host.appendChild(node);
    setTimeout(function () {
      node.classList.add('out');
      setTimeout(function () { if (node.parentNode) { node.parentNode.removeChild(node); } }, 220);
    }, 1800);
  }

  /* ── 拆分隔条 ─────────────────────────────────────────────── */

  /** 三个区域：收起状态点哪都能展开；展开状态把点击让给里面的卡片/按钮 */
  function bindZone(id, zone) {
    var node = $(id);
    if (!node) { return; }
    node.addEventListener('click', function (ev) {
      if (Layout.expanded === zone) { return; }
      setExpanded(zone);
    });
    node.addEventListener('keydown', function (ev) {
      if (ev.target !== node) { return; }
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        setExpanded(zone);
      }
    });
  }

  /**
   * 收起状态下点到栏内的卡片 / 模块时：先把这一栏展开，而不是"点了没反应"。
   * 返回 true 表示这次点击已经被当成"展开"处理掉了。
   */
  function expandOwningZone(node) {
    var z = node && node.closest ? node.closest('.zone') : null;
    if (!z || z.classList.contains('expanded')) { return false; }
    var map = { zoneWeek: 'week', zoneToday: 'today', zoneNext: 'next' };
    var key = map[z.id];
    if (!key) { return false; }
    setExpanded(key);
    return true;
  }

  /** 正在编辑输入框？（键盘弹出会触发 resize，此时绝不能重建页面） */
  function isEditingField() {
    var a = document.activeElement;
    if (!a) { return false; }
    var tag = String(a.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!a.isContentEditable;
  }

  /**
   * 重新播一遍某一栏的内容浮入动画。
   * 规格书规则 2：取消 → 复位 → 强制刷新 → 启动，所以连续点日期也能每次都看到动画。
   */
  function replayZoneContent(id) {
    var z = $(id);
    if (!z) { return; }
    z.classList.remove('z-in');
    void z.offsetWidth;
    z.classList.add('z-in');
    setTimeout(function () { z.classList.remove('z-in'); }, 560);
  }

  /**
   * 规格书 4.7：按钮点击 = 整颗均匀高光（不是涟漪、不是外发光）。
   * 颜色 92% 白 + 8% 主题色；峰值不透明度 0.30；500ms 衰减；
   * 重启动画遵守"取消 → 复位 → 强制刷新 → 启动"。
   */
  function flashButton(el) {
    if (!el || !el.appendChild) { return; }
    var f = el.__flash;
    if (!f || !f.isConnected) {
      f = document.createElement('span');
      f.className = 'flash';
      el.appendChild(f);
      el.__flash = f;
    }
    if (f.getAnimations) {
      var olds = f.getAnimations();
      for (var i = 0; i < olds.length; i++) { olds[i].cancel(); }
    }
    f.style.opacity = '0';                 // 复位
    void f.offsetWidth;                    // 强制刷新
    var accent = (AR.Store.get().settings.appearance.accent) || '#5B8DEF';
    f.style.background = mixWithWhite(accent, 0.08);
    if (f.animate) {
      f.animate(
        [{ opacity: 0 }, { opacity: 0.30, offset: 0.12 }, { opacity: 0 }],
        { duration: 500, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'none' }
      );
    } else {
      f.style.opacity = '0.30';
      setTimeout(function () { f.style.opacity = '0'; }, 120);
    }
  }

  /** 92% 白 + 8% 目标色的实心高光（Chromium 101 不支持 color-mix，这里手算） */
  function mixWithWhite(hex, t) {
    var h = String(hex || '#5B8DEF').replace('#', '');
    if (h.length === 3) { h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2); }
    var r = parseInt(h.substring(0, 2), 16) || 0;
    var g = parseInt(h.substring(2, 4), 16) || 0;
    var b = parseInt(h.substring(4, 6), 16) || 0;
    var m = function (c) { return Math.round(255 * (1 - t) + c * t); };
    return 'rgba(' + m(r) + ',' + m(g) + ',' + m(b) + ',1)';
  }

  function bindFlash() {
    document.addEventListener('pointerdown', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) { return; }
      // 滑块（.seg）按规格书明确不做点击高光
      var el = t.closest('.btn, .chip-btn, .module, .preset-card, .icon-btn, .week-chip, .zone-toggle');
      if (el) { flashButton(el); }
    }, true);
  }

  /**
   * 规格书 4.1：区块入场 rise（60ms 错峰；头部 -24px 自上下落，其余 +12px 自下浮起；
   * 500ms CUBIC；只动 opacity / translate / scale）。
   */
  function enterRise(viewEl) {
    if (!viewEl || !viewEl.querySelectorAll) { return; }
    var nodes = viewEl.querySelectorAll('.view-head, .zone, .glass.panel, .week-strip, .settings-nav, .set-section');
    var delay = 50;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.animate) { continue; }
      var fromY = (i === 0) ? -24 : 12;
      if (n.__rise) { n.__rise.cancel(); }
      n.__rise = n.animate(
        [
          { opacity: 0, transform: 'translateY(' + fromY + 'px) scale(0.97)' },
          { opacity: 1, transform: 'translateY(0px) scale(1)' }
        ],
        { duration: 500, delay: delay, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' }
      );
      delay += 60;
    }
  }

  /** 规格书 4.2：列表子项只做透明度淡入，30ms 错峰、180ms、FADE_OUT */
  function fadeInList(container, selector) {
    if (!container || !container.querySelectorAll) { return; }
    var nodes = container.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.animate) { continue; }
      if (n.__fade) { n.__fade.cancel(); }
      n.__fade = n.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 180, delay: i * 30, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' }
      );
    }
  }

  /** 规格书 4.9/4.10：分段控件的胶囊滑动（420ms SMOOTH），禁止高光 */
  function enhanceSegmented(root) {
    var segs = (root || document).querySelectorAll('.segmented');
    for (var i = 0; i < segs.length; i++) { syncSegPill(segs[i], false); }
  }

  function syncSegPill(seg, animate) {
    if (!seg) { return; }
    var active = seg.querySelector('.seg.active') || seg.querySelector('.seg');
    if (!active) { return; }
    var pill = seg.querySelector('.seg-pill');
    if (!pill) {
      pill = document.createElement('span');
      pill.className = 'seg-pill';
      seg.insertBefore(pill, seg.firstChild);
    }
    var nx = active.offsetLeft, nw = active.offsetWidth, nh = active.offsetHeight, ny = active.offsetTop;
    if (!nw) { return; }
    var prevX = pill.__x, prevW = pill.__w;
    pill.style.height = nh + 'px';
    pill.style.width = nw + 'px';
    pill.style.top = ny + 'px';
    pill.style.transformOrigin = '0 0';
    pill.style.transform = 'translateX(' + nx + 'px)';
    pill.__x = nx; pill.__w = nw;
    if (!animate || prevX == null || !prevW) { return; }
    var sx = prevW / nw, tx = prevX - nx;
    if (pill.__anim) { pill.__anim.cancel(); }
    pill.style.transform = 'translateX(' + tx + 'px) scaleX(' + sx + ')';   // 复位到旧几何
    void pill.offsetWidth;                                                 // 强制刷新
    pill.__anim = pill.animate(
      [
        { transform: 'translateX(' + tx + 'px) scaleX(' + sx + ')' },
        { transform: 'translateX(' + nx + 'px) scaleX(1)' }
      ],
      { duration: 420, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'none' }
    );
    pill.style.transform = 'translateX(' + nx + 'px) scaleX(1)';
  }


  /* ── 初始化 ───────────────────────────────────────────────── */

  function init() {
    U = AR.Util;
    S = AR.Store.load();
    Layout.el = $('todayLayout');
    Layout.profiles = loadProfiles();

    var btns = document.querySelectorAll('.nav-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (ev) {
        show(ev.currentTarget.getAttribute('data-nav'));
      });
    }
    $('btnPrevDay').addEventListener('click', function () { cursorDate = U.addDays(cursorDate, -1); AR.Bridge.haptic('light', $('zoneNext')); renderToday(); });
    $('btnNextDay').addEventListener('click', function () { cursorDate = U.addDays(cursorDate, 1); AR.Bridge.haptic('light', $('zoneNext')); renderToday(); });
    $('btnToday').addEventListener('click', function () { cursorDate = new Date(); renderToday(); });
    $('btnPrevWeek').addEventListener('click', function () {
      var before = weekCursor || 1;
      weekCursor = Math.max(1, before - 1);
      AR.Bridge.haptic('light', $('btnPrevWeek'));
      renderWeek({ swap: weekCursor === before ? 0 : -1 });
    });
    $('btnNextWeek').addEventListener('click', function () {
      var before = weekCursor || 1;
      var max = AR.Store.currentSemester().weekCount;
      weekCursor = Math.min(max, before + 1);
      AR.Bridge.haptic('light', $('btnNextWeek'));
      renderWeek({ swap: weekCursor === before ? 0 : 1 });
    });
    $('btnThisWeek').addEventListener('click', function () {
      var target = Math.max(1, AR.Schedule.weekNumber(new Date()));
      var dir = target === (weekCursor || 1) ? 0 : (target > (weekCursor || 1) ? 1 : -1);
      weekCursor = target;
      AR.Bridge.haptic('medium', $('btnThisWeek'));
      renderWeek({ swap: dir });
    });

    // 三个区域都能点开（右下角 ⤢ 按钮同理）；展开后 ✕ 或 Esc 收起
    bindZone('zoneWeek', 'week');
    bindZone('zoneToday', 'today');
    bindZone('zoneNext', 'next');
    var toggles = document.querySelectorAll('[data-zone-toggle]');
    for (var tg = 0; tg < toggles.length; tg++) {
      (function (btn) {
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          setExpanded(btn.getAttribute('data-zone-toggle'));
        });
      })(toggles[tg]);
    }
    $('modalScrim').addEventListener('click', closeModal);

    // 冲突检测默认收起，点「查看」再展开
    var ctBtn = $('conflictToggle');
    if (ctBtn) {
      ctBtn.addEventListener('click', function () {
        conflictOpen = !conflictOpen;
        AR.Bridge.haptic('light', ctBtn);
        var list = $('conflictList');
        if (list) { list.hidden = !conflictOpen; }
        var panel = $('conflictPanel');
        if (panel) { panel.classList.toggle('open', conflictOpen); }
        ctBtn.textContent = conflictOpen ? '收起' : '查看';
      });
    }

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        if (!closeModal()) { if (Layout.expanded) { setExpanded(null); } }
      }
    });
    bindFlash();

    var resize = U.debounce(function () {
      var key = breakpointKey(document.documentElement.clientWidth);
      var changed = key !== Layout.profileKey;
      Layout.profileKey = key;
      applyLayout(false);
      if (changed && currentView === 'week') { renderWeek(); }
      /**
       * 设置页只在「断点真的变了」且「没有正在输入」时才重建。
       * 否则软键盘弹出/收起会触发 resize → 整页重建 → 输入框被换掉，用户就打不进字。
       */
      if (changed && currentView === 'settings' && !isEditingField() && AR.Panels) {
        AR.Panels.renderSettings();
      }
    }, 120);
    window.addEventListener('resize', resize);
    AR.onResize = resize;

    // 顶栏时钟：精确到秒，每秒刷新（页面在后台时跳过，回来立刻补上）
    updateClock();
    setInterval(function () {
      if (document.hidden) { return; }
      updateClock();
    }, 1000);

    // 系统主题
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq && mq.addEventListener) { mq.addEventListener('change', function () { applyTheme(); }); }
    AR.onSystemTheme = applyTheme;

    applyTheme();
    applyMotion();
    applyGlass();
    Layout.profileKey = breakpointKey(document.documentElement.clientWidth);
    lastTodayKey = U.dateKey(new Date());
    show('today');
    applyLayout(false);
    setTimeout(function () { applyLayout(false); }, 60);

    // 回到前台 / 系统换天：如果用户本来就在看「今天」，自动跟到新的今天
    AR.onResume = onResume;
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { onResume(); } });
    window.addEventListener('focus', onResume);
  }

  function onResume() {
    var now = new Date();
    var key = U.dateKey(now);
    var prevToday = lastTodayKey ? U.parseDateKey(lastTodayKey) : null;
    var wasOnToday = !prevToday || U.sameDay(cursorDate, prevToday);
    if (key !== lastTodayKey) {
      if (wasOnToday) { cursorDate = now; }
      var sem = AR.Store.currentSemester();
      if (sem && currentView === 'week') {
        weekCursor = Math.max(1, AR.Schedule.weekNumber(now, sem));
        renderWeek();
      } else if (currentView === 'today') {
        renderToday();
      }
      lastTodayKey = key;
    }
    updateClock();
    if (AR.WidgetData && AR.WidgetData.sync) { AR.WidgetData.sync(true); }
  }

  /* ── 主题 / 动效 / 毛玻璃 ─────────────────────────────────── */

  function effectiveDark() {
    var mode = S.settings.appearance.theme;
    if (mode === 'dark') { return true; }
    if (mode === 'light') { return false; }
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function applyTheme() {
    var dark = effectiveDark();
    document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
    var accent = S.settings.appearance.accent || '#5B8DEF';
    // 主题色写在 <body> 上（而不是 :root）：
    // tokens.css 里 body[data-theme="dark"] 也定义了 --accent，写在 :root 上会被它盖住，
    // 这就是之前"暗色模式下换主题色没反应"的原因。写在 body 的行内样式优先级更高，浅色/深色都生效。
    var bs = document.body.style;
    bs.setProperty('--accent', accent);
    bs.setProperty('--accent-soft', hexA(accent, 0.14));
    bs.setProperty('--accent-glow', hexA(accent, 0.22));
    bs.setProperty('--accent-contrast', '#ffffff');
    // 背景柔光斑跟着主题色走，毛玻璃后面才有对应的色相（暗色下更亮一点）
    bs.setProperty('--blob-a', hexA(accent, dark ? 0.30 : 0.26));
    bs.setProperty('--blob-b', hexA(accent, dark ? 0.20 : 0.16));
    AR.Bridge.setSystemBars(dark ? '#0E1116' : '#FFFFFF', !dark);
  }

  function hexA(hex, a) {
    var h = String(hex || '#5B8DEF').replace('#', '');
    if (h.length === 3) { h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2); }
    var r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function applyGlass() {
    var lvl = S.settings.appearance.glassLevel || 'medium';
    var degraded = AR.Bridge.sdkInt && AR.Bridge.sdkInt() > 0 && AR.Bridge.sdkInt() < 31;
    document.body.setAttribute('data-degraded', degraded && lvl !== 'off' ? 'on' : 'off');
    document.body.setAttribute('data-glass', lvl);
    AR.Bridge.setBackdrop(lvl !== 'off');
  }

  function applyMotion() {
    var ap = S.settings.appearance;
    var speed = Number(ap.animationSpeed) || 1;
    var root = document.documentElement;
    document.body.removeAttribute('data-motion');
    // 规格书里的时长令牌全是 calc(... * var(--motion-scale))，所以「动画速度」必须改
    // --motion-scale 才会真的生效；之前只改了旧的 --dur-* 变量，等于没生效。
    root.style.setProperty('--motion-scale', String(Math.round((1 / speed) * 1000) / 1000));
    root.style.setProperty('--dur-instant', Math.round(120 / speed) + 'ms');
    root.style.setProperty('--dur-quick', Math.round(180 / speed) + 'ms');
    root.style.setProperty('--dur-standard', Math.round(240 / speed) + 'ms');
    root.style.setProperty('--dur-focus', Math.round(300 / speed) + 'ms');
  }

  AR.UI = {
    init: init,
    show: show,
    toast: toast,
    renderToday: renderToday,
    renderWeek: renderWeek,
    renderSettings: function () { if (AR.Panels && AR.Panels.renderSettings) { AR.Panels.renderSettings(); } },
    renderImport: function () { if (AR.Panels && AR.Panels.renderImport) { AR.Panels.renderImport(); } },
    openModal: openModal,
    closeModal: closeModal,
    openCourseModal: openCourseModal,
    openLocationModal: openLocationModal,
    openTimeModal: openTimeModal,
    openTeacherModal: openTeacherModal,
    openNoteModal: openNoteModal,
    applyTheme: applyTheme,
    applyGlass: applyGlass,
    applyMotion: applyMotion,
    applyLayout: applyLayout,
    setPreset: setPreset,
    setSize: setSize,
    setExpanded: setExpanded,
    expanded: function () { return Layout.expanded; },
    syncSegPill: syncSegPill,
    flashButton: flashButton,
    sizeOf: sizeOf,
    itemStartPeriod: itemStartPeriod,
    itemEndPeriod: itemEndPeriod,
    saveProfiles: saveProfiles,
    defaultProfiles: function () { return U.deepCopy(DEFAULT_PROFILES); },
    breakpointKey: breakpointKey,
    layoutState: Layout,
    currentView: function () { return currentView; },
    modalOpen: function () { return modalStack.length > 0; }
  };
})();
