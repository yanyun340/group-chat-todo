(function () {
  'use strict';

  // ===== 提取规则：集中在这里，改规则只动这一处 =====
  const ACTION_WORDS = ['提交', '别忘了', '别忘', '报名', '完成', '通知', '安排', '参加', '回复', '填写', '上传', '打印', '准备', '开会', '考试', '截止', '提醒', '缴费', '领取', '收集', '签到', '必须', '须', '交', '做', '写', '带'];
  const WEAK_WORDS = ['到时候', '要不要', '再说', '记得', '可能', '有空', '考虑', '要不', '也许', '大概', '想', '看看', '如果', '以后'];
  const TIME_RE = /((?:今天|明天|后天|今晚|明早|明晚|这周|下周|周末|周[一二三四五六日天]|星期[一二三四五六日天])(?:上午|下午|晚上|中午|早|晚)?(?:\d{1,2}[:：]\d{2}|\d{1,2}点|\d{1,2}[日号])?|\d{1,2}[.月/]\d{1,2}[日号]?|\d{1,2}[日号])(?:之前|前|截止)?/;
  const MENTION_RE = /@(?:我|全体成员|全体|所有人|大家|all)/i;
  const COLLECTIVE_WORDS = ['我班', '我们班', '全班', '本班', '各位同学', '同学们', '全体同学', '全体成员', '请大家', '所有人', '各位'];
  const REQUEST_WORDS = ['谁有', '帮忙', '帮我', '帮一下', '借我', '借一下', '发我', '发一下', '请问', '麻烦', '谁能', '有没有人'];
  const STORAGE_KEY = 'group-chat-todo:v1';

  const SAMPLE_CHAT = [
    '班长 09:12 大家早上好，降温注意保暖',
    '同学甲 09:13 收到',
    '班长 09:15 明天下午5点前交高数作业，别忘',
    '同学乙 09:16 好的',
    '文体委员 09:20 周五之前报名运动会，@全体成员',
    '同学丙 09:21 我要报名100米',
    '学习委员 09:30 记得把实验报告提交到系统',
    '小明 09:33 中午一起吃饭吗',
    '班长 09:40 明天下午5点前交高数作业，别忘',
    '同学丁 09:41 周末可能要去实验室，到时候再说',
    '老师 09:50 @我 下课后交一下作业本',
    '辅导员 09:55 我班学生须在10.21心理普查，请大家按照通知要求完成，谢谢',
    '同学甲 10:00 今晚的选修课取消了',
    '小红 10:05 谁有上学期的高数笔记'
  ].join('\n');

  const chatEl = document.getElementById('chat');
  const extractBtn = document.getElementById('extract');
  const sampleBtn = document.getElementById('sample');
  const clearBtn = document.getElementById('clear');
  const hintEl = document.getElementById('hint');
  const resultEl = document.getElementById('result');
  const summaryEl = document.getElementById('summary');
  const listEl = document.getElementById('list');
  const placeholderEl = document.getElementById('placeholder');
  const statOpenEl = document.getElementById('stat-open');
  const statRelevantEl = document.getElementById('stat-relevant');
  const statConfirmEl = document.getElementById('stat-confirm');
  const statDoneEl = document.getElementById('stat-done');
  const tabEls = Array.from(document.querySelectorAll('.tab'));

  let items = [];
  let filter = 'todo';

  // ---- 解析一行：昵称 时间 内容 / 昵称: 内容 / 纯内容 ----
  function parseLine(line) {
    line = line.trim();
    if (!line) return null;
    let m = line.match(/^(.+?)\s+(\d{1,2}:\d{2})\s+(.+)$/);
    if (m) return { speaker: m[1], content: m[3].trim() };
    m = line.match(/^(.+?)[:：]\s*(.+)$/);
    if (m) return { speaker: m[1], content: m[2].trim() };
    return { speaker: '', content: line };
  }

  function normalize(s) {
    return s.replace(/[\s，。！？、,.!?：:；;（）()「」『』]/g, '');
  }

  function escapeHTML(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function extract(line) {
    const info = parseLine(line);
    if (!info) return null;
    const content = info.content;
    const reasons = [];
    const highlights = [];

    const tm = content.match(TIME_RE);
    let deadline = null;
    if (tm) { deadline = tm[1]; reasons.push('时间「' + deadline + '」'); highlights.push(deadline); }

    let action = null;
    for (const w of ACTION_WORDS) { if (content.includes(w)) { action = w; break; } }
    if (action) { reasons.push('关键词「' + action + '」'); highlights.push(action); }

    let reqWord = null;
    for (const w of REQUEST_WORDS) { if (content.includes(w)) { reqWord = w; break; } }
    if (reqWord) { reasons.push('请求「' + reqWord + '」'); highlights.push(reqWord); }

    const mention = content.match(MENTION_RE);
    let collective = null;
    for (const w of COLLECTIVE_WORDS) { if (content.includes(w)) { collective = w; break; } }
    const relevant = !!mention || !!collective;
    if (mention) { reasons.push('提到你(@我)'); highlights.push(mention[0]); }
    else if (collective) { reasons.push('面向全班「' + collective + '」'); highlights.push(collective); }

    let weak = null;
    for (const w of WEAK_WORDS) { if (content.includes(w)) { weak = w; break; } }
    if (weak) { reasons.push('措辞「' + weak + '」不确定'); highlights.push(weak); }

    if (!action && !deadline && !relevant && !reqWord) return null;

    let type;
    if (action) type = 'task';
    else if (reqWord) type = 'request';
    else type = 'reminder';

    let state;
    if (weak) state = 'confirm';
    else if (action && (deadline || relevant)) state = 'todo';
    else state = 'confirm';

    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: content,
      deadline: deadline,
      source: info.speaker,
      relevant: relevant,
      type: type,
      state: state,
      done: false,
      reasons: reasons,
      highlights: highlights
    };
  }

  function extractAll(text) {
    const out = [];
    const seen = new Set();
    let deduped = 0;
    for (const line of text.split(/\r?\n/)) {
      const item = extract(line);
      if (!item) continue;
      const key = normalize(item.text);
      if (seen.has(key)) { deduped++; continue; }
      seen.add(key);
      out.push(item);
    }
    return { items: out, deduped: deduped };
  }

  function highlightedSource(item) {
    let html = escapeHTML(item.text);
    item.highlights.forEach(function (h) {
      if (!h) return;
      const esc = escapeHTML(h);
      html = html.replace(esc, '<mark>' + esc + '</mark>');
    });
    return html;
  }

  const TYPE_LABEL = { task: '任务', reminder: '提醒', request: '请求' };

  function itemHTML(item) {
    const cls = item.done ? 'done' : item.state;
    const typeKey = item.type || 'task';
    const type = '<span class="chip chip--type chip--type-' + typeKey + '">' + TYPE_LABEL[typeKey] + '</span>';
    const deadline = item.deadline ? '<span class="chip chip--deadline">' + escapeHTML(item.deadline) + '</span>' : '';
    const source = item.source ? '<span class="source">' + escapeHTML(item.source) + '</span>' : '';
    const me = item.relevant ? '<span class="chip chip--me">与你相关</span>' : '';
    const why = item.reasons.length ? '<span class="why-reason">' + escapeHTML(item.reasons.join(' · ')) + '</span>' : '';
    return '' +
      '<li class="item item--' + cls + '" data-id="' + item.id + '">' +
        '<input type="checkbox" class="done-toggle"' + (item.done ? ' checked' : '') + '>' +
        '<div class="body">' +
          '<div class="text">' + escapeHTML(item.text) + '</div>' +
          '<div class="meta">' + type + deadline + me + source +
            '<button type="button" class="why-toggle">为什么</button>' +
          '</div>' +
          '<div class="why" hidden>' + why +
            '<p class="why-source">原文：' + highlightedSource(item) + '</p>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="del" title="删除">删除</button>' +
      '</li>';
  }

  function renderList() {
    const visible = items.filter(function (i) {
      if (filter === 'done') return i.done;
      return !i.done && i.state === filter;
    });
    if (visible.length === 0) {
      const empty = filter === 'done' ? '还没有已完成的待办' : (filter === 'confirm' ? '没有待确认的条目' : '没有待办');
      listEl.innerHTML = '<li class="empty">' + empty + '</li>';
      return;
    }
    listEl.innerHTML = visible.map(itemHTML).join('');
  }

  function renderSummary() {
    const open = items.filter(function (i) { return !i.done; });
    const todo = open.filter(function (i) { return i.state === 'todo'; }).length;
    const confirm = open.filter(function (i) { return i.state === 'confirm'; }).length;
    const relevant = open.filter(function (i) { return i.relevant; }).length;
    const done = items.filter(function (i) { return i.done; }).length;
    statOpenEl.textContent = todo;
    statRelevantEl.textContent = relevant;
    statConfirmEl.textContent = confirm;
    statDoneEl.textContent = done;
    summaryEl.textContent = open.length === 0
      ? '都清完了。'
      : (confirm > 0 ? '有 ' + confirm + ' 条拿不准，已单独放进「待确认」' : '全部条目都可以直接执行');
  }

  function renderAll() {
    const empty = items.length === 0;
    placeholderEl.hidden = !empty;
    resultEl.hidden = empty;
    renderSummary();
    renderList();
  }

  function setHint(msg, kind) {
    hintEl.textContent = msg || '';
    hintEl.className = 'hint' + (kind ? ' hint--' + kind : '');
  }

  function setActiveTab() {
    tabEls.forEach(function (t) { t.classList.toggle('active', t.dataset.filter === filter); });
  }

  // ---- 持久化 ----
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ chat: chatEl.value, items: items }));
    } catch (e) { /* 隐私模式等场景忽略 */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.chat != null) chatEl.value = data.chat;
      if (Array.isArray(data.items)) items = data.items;
    } catch (e) { /* 损坏则忽略 */ }
  }

  // ---- 事件 ----
  function doExtract() {
    const text = chatEl.value;
    if (!text.trim()) {
      items = [];
      renderAll();
      setActiveTab();
      setHint('先把群聊记录贴进来，再点提取。', 'warn');
      return;
    }
    const r = extractAll(text);
    items = r.items;
    filter = 'todo';
    renderAll();
    setActiveTab();
    if (items.length === 0) {
      setHint('没识别到待办：这段文字里没有明显的待办、截止时间或 @你。', 'warn');
      return;
    }
    listEl.classList.add('list--enter');
    window.setTimeout(function () { listEl.classList.remove('list--enter'); }, 900);
    setHint('已提取 ' + items.length + ' 件待办' + (r.deduped ? '，' + r.deduped + ' 条重复已合并' : '') + '。', 'ok');
    save();
  }

  extractBtn.addEventListener('click', doExtract);
  sampleBtn.addEventListener('click', function () { chatEl.value = SAMPLE_CHAT; setHint(''); save(); });
  clearBtn.addEventListener('click', function () {
    chatEl.value = '';
    items = [];
    filter = 'todo';
    setHint('');
    renderAll();
    setActiveTab();
    save();
  });

  tabEls.forEach(function (t) {
    t.addEventListener('click', function () {
      filter = t.dataset.filter;
      setActiveTab();
      renderList();
    });
  });

  listEl.addEventListener('click', function (e) {
    const itemEl = e.target.closest('.item');
    if (!itemEl) return;
    const id = itemEl.dataset.id;
    const item = items.find(function (i) { return i.id === id; });
    if (!item) return;

    if (e.target.classList.contains('done-toggle')) {
      item.done = e.target.checked;
      save();
      renderSummary();
      renderList();
      return;
    }
    if (e.target.classList.contains('why-toggle')) {
      const why = itemEl.querySelector('.why');
      why.hidden = !why.hidden;
      e.target.textContent = why.hidden ? '为什么' : '收起';
      return;
    }
    if (e.target.classList.contains('del')) {
      if (!window.confirm('删除这条待办？')) return;
      items = items.filter(function (i) { return i.id !== id; });
      save();
      renderAll();
    }
  });

  const exportBtn = document.getElementById('export');
  exportBtn.addEventListener('click', function () {
    const data = items.map(function (i) {
      return {
        text: i.text,
        deadline: i.deadline,
        source: i.source,
        relevant: i.relevant,
        type: i.type || 'task',
        state: i.done ? 'done' : i.state,
        why: i.reasons
      };
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '待办导出.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // ---- 启动 ----
  load();
  renderAll();
  setActiveTab();
})();
