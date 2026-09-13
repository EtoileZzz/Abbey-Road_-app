/* ──────────────────────────────────────────────────────────────
   Abbey Road · 桌面卡片数据

   网页是唯一真源：这里把「今天 / 本周 / 下一节课」渲染成一份快照，
   交给原生外壳（Android 桌面小组件读它；Windows 端可以忽略）。
   卡片本身不做任何业务计算，所以两端永远一致。
   ────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var AR = window.AR || (window.AR = {});
  var timer = null;

  function plain(t) { return /^\d{1,2}:\d{2}$/.test(t || '') ? t : ''; }

  function rangeText(item) {
    var a = plain(item.start), b = plain(item.end);
    if (a && b) { return a + ' – ' + b; }
    return item.periodLabel || '时间待定';
  }

  function buildPayload() {
    var U = AR.Util;
    var sem = AR.Store.currentSemester();
    var now = new Date();
    var weekday = U.WEEKDAY_NAMES[U.weekdayOf(now)];
    var weekNo = sem ? Math.max(1, AR.Schedule.weekNumber(now, sem)) : 0;
    var items = sem ? AR.Schedule.dayItems(now, sem) : [];

    var payload = {
      v: AR.Const.APP_VERSION,
      dateText: (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + weekday,
      weekNo: weekNo,
      weekRange: '',
      todayTitle: '今天 · ' + weekday,
      todaySub: items.length ? (items.length + ' 节课 · ' + rangeText(items[0])) : '今天没有课',
      todayBadge: items.length ? (plain(items[0].start) || items[0].periodLabel || '—') : '休息',
      todayIdx: U.weekdayOf(now),
      dates: [],
      today: [],
      week: [],
      weekTotalText: '',
      nextLabel: '下一节课',
      nextIn: '',
      nextName: '',
      nextTime: '',
      nextPlace: ''
    };

    /* 今日清单（卡片最多画 4 条） */
    for (var i = 0; i < items.length && i < 4; i++) {
      var it = items[i];
      payload.today.push({
        time: rangeText(it) + (it.periodLabel ? ' · ' + it.periodLabel : ''),
        name: it.course.name,
        place: it.location ? it.location.raw : '',
        color: it.color || '#5B8DEF'
      });
    }

    /* 本周：迷你课表色块 + 日期行 */
    if (sem && weekNo) {
      var monday = U.addDays(U.mondayOf(U.parseDateKey(sem.startDate)), (weekNo - 1) * 7);
      var sunday = U.addDays(monday, 6);
      payload.weekRange = (monday.getMonth() + 1) + '月' + monday.getDate() + '日 – '
        + (sunday.getMonth() + 1) + '月' + sunday.getDate() + '日';
      var total = 0;
      for (var d = 1; d <= 7; d++) {
        var dd = U.addDays(monday, d - 1);
        payload.dates.push(String(dd.getDate()));
        var list = AR.Schedule.weekItems(weekNo, d);
        total += list.length;
        for (var k = 0; k < list.length; k++) {
          payload.week.push({
            d: d,
            s: AR.UI.itemStartPeriod(list[k]),
            e: AR.UI.itemEndPeriod(list[k]),
            color: list[k].color || '#5B8DEF',
            name: list[k].course.name
          });
        }
      }
      payload.weekTotalText = total + ' 节 · 共 ' + (sem.weekCount || 20) + ' 周';
    }

    /* 下一节课（含进行中） */
    try {
      var ongoing = AR.Schedule.ongoingItem(now);
      var next = AR.Schedule.nextItem(now);
      var target = ongoing ? { item: ongoing, day: U.startOfDay(now), offsetDays: 0, ongoing: true } : next;
      if (target) {
        var item = target.item;
        payload.nextLabel = target.ongoing ? '正在上课' : '下一节课';
        payload.nextName = item.course.name;
        payload.nextTime = rangeText(item) + (item.periodLabel ? ' · ' + item.periodLabel : '');
        payload.nextPlace = item.location ? item.location.raw : '';
        if (target.ongoing) {
          payload.nextIn = item.end ? ('到 ' + plain(item.end)) : '';
        } else if (target.offsetDays === 0) {
          var mins = item.startMin - (now.getHours() * 60 + now.getMinutes());
          payload.nextIn = mins > 0 ? (mins < 60 ? (mins + ' 分钟后') : (Math.floor(mins / 60) + ' 小时 ' + (mins % 60) + ' 分后')) : '';
        } else if (target.offsetDays === 1) {
          payload.nextIn = '明天';
        } else {
          payload.nextIn = target.offsetDays + ' 天后';
        }
      }
    } catch (e) { }

    return payload;
  }

  function sync(immediate) {
    if (timer) { clearTimeout(timer); timer = null; }
    var run = function () {
      timer = null;
      try {
        if (!AR.Bridge || !AR.Bridge.syncWidget) { return; }
        AR.Bridge.syncWidget(JSON.stringify(buildPayload()));
      } catch (e) { }
    };
    if (immediate) { run(); return; }
    timer = setTimeout(run, 400);
  }

  AR.WidgetData = { build: buildPayload, sync: sync };
})();
