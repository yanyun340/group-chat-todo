(function () {
  'use strict';

  // ===== 提取规则：集中在这里，改规则只动这一处 =====
  const ACTION_WORDS = ['提交', '别忘了', '别忘', '报名', '完成', '通知', '安排', '参加', '回复', '填写', '上传', '打印', '准备', '开会', '考试', '截止', '提醒', '缴费', '领取', '收集', '签到', '必须', '须', '交', '做', '写', '带'];
  const WEAK_WORDS = ['到时候', '要不要', '再说', '记得', '可能', '有空', '考虑', '要不', '也许', '大概', '想', '看看', '如果', '以后'];
  // 时间识别。三块：① 相对时长 ② 星期/今天明天这类 ③ 具体日期。
  // ① 是补的：「提交之后24小时后查询成绩」这种依赖型截止没有绝对日期，
  //   旧正则完全不认，整句只能掉进「待确认」——而它恰恰是群里最常见的说法。
  // ② 里补了「本周」（旧正则只有这周/下周/上周，「本周六周日」会退化成只吃到「周六」），
  //   并允许「周六周日」「周六、周日」「周一到周五」这种连写区间。
  const TIME_RE = /([一二三四五六七八九十两\d]{1,3}\s*个?(?:小时|分钟|天|日|周|星期|个月|月|年|工作日)\s*(?:之后|以后|后|以内|之内|内)|(?:今天|明天|后天|今晚|明早|明晚|周末|(?:这|本|下|上)周[一二三四五六日天]?|星期[一二三四五六日天]|周[一二三四五六日天])(?:[、和到至~-]?周[一二三四五六日天])?(?:上午|下午|晚上|中午|早|晚)?(?:\d{1,2}[:：]\d{2}|\d{1,2}点|\d{1,2}[日号])?|\d{1,2}[.月/]\d{1,2}[日号]?|\d{1,2}[日号])(?:之前|前|截止)?/;
  // 「@我」和「@所有人」是两回事：前者是点你一个人，后者是广播给全班。
  // 早先把它们并成一个 MENTION_RE，解析面板于是把 @所有人 也说成"提到你(@我)"——
  // 这个 app 的卖点就是可解释，解释本身说错话比不解释更糟。拆开，各说各的。
  const MENTION_RE = /@我/i;                                        // 直接点到你
  const AT_ALL_RE = /@(?:全体成员|全体|所有人|大家|all)/i;          // 广播 @，算"面向全班"

  const COLLECTIVE_WORDS = ['我班', '我们班', '全班', '本班', '各位同学', '同学们', '全体同学', '全体成员', '请大家', '所有人', '各位'];
  const REQUEST_WORDS = ['谁有', '帮忙', '帮我', '帮一下', '借我', '借一下', '发我', '发一下', '请问', '麻烦', '谁能', '有没有人'];
  const CHOICE_RE = /[一二三四五六七八九十两\d]+选[一二三四五六七八九十两\d]+/g;  // 「三选一 / 五选一」这类选一约束

  // 「注：」「截止时间：」这类行开头的不是昵称，是标签。
  // 当成昵称的后果不是少显示一个字，是**来源列写成"注"、解析面板说这是某人说的**——
  // 可解释面板说错话，比不说话更糟。
  const LABEL_RE = /^(?:注|注意|说明|备注|附注|提示|温馨提示|补充|规则|格式|条件|方式|要求|截止时间|时间|地点|对象|提醒|PS|ps)$/;
  // 行首的「注：」这类前缀，显示的时候剥掉——它是标签，不是内容
  const LABEL_PREFIX_RE = /^(?:注|注意|说明|备注|附注|提示|温馨提示|补充|规则|格式|条件|方式|要求|截止时间|时间|地点|对象|提醒|PS)\s*[:：]\s*/;
  // 其中这几个标签本身就是「这是说明，不是让你去做」，判成任务就错了。
  const NOTE_LABELS = ['注', '说明', '备注', '附注', '补充', '规则', '格式', '条件', '方式', '温馨提示'];
  // 昵称长什么样：短，而且不含句读。
  // 「昵称: 内容」原来是 `^(.+?)[:：]` 取到第一个冒号为止——整行连着写时
  //（"@所有人，请大家…之中。注：每人3次…"）它会**一路把一整句话吃成昵称**，
  // 因为第一个冒号在句子中段。来源列于是写着那一整句，两条真待办当场消失。
  // 句读是判断"这不可能是个名字"最硬的信号：没有人在群里叫「请大家…完成考试」。
  const NAME_RE = /^[^，。！？；、,;!?]{1,18}$/;
  // 括号里常是假设和举例：「（如果同学参加了三次考试，就填报3次…）」。
  // 藏在假设句里的动作词不算"交代你做的事"。
  const PAREN_RE = /[（(][^）)]*[）)]/g;

  // ---- 行内切句 ----
  // 「一行一条」是**导入格式**的约定，不是真实群聊的写法。真人一句话常塞两件事：
  //「@所有人，请大家在本周六周日尽快完成考试，并且在提交之后24小时后查询成绩填进…」
  // 拆开之后两件都立得住，这才是它该有的样子。规则取保守：
  //   · 。；！？ 一律切（真句号，没有歧义）；
  //   · 逗号只在**后面紧跟连接词**时切——「，如果…就…」不切，否则
  //     「三选一」那种一整句的约束会被逗号切碎；
  //   · 切完每段都要**自己过一遍 extract 的门槛**，过不了的直接丢，不造半截待办。
  const SPLIT_HARD_RE = /[。；！？!?;]/;
  const SPLIT_SOFT_RE = /，(?=(?:并且|然后|还要|而且|另外|同时|以及|再(?!说)|并))/;
  const LEAD_CONJ_RE = /^(?:并且|然后|还要|而且|另外|同时|以及|并|再)[，,]?/;

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
  const quickstartBtn = document.getElementById('quickstart');
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
  const sideEl = document.getElementById('side');
  const consoleEl = document.getElementById('console');
  const detailEl = document.getElementById('detail');
  const detailTextEl = document.getElementById('detail-text');
  const detailMetaEl = document.getElementById('detail-meta');
  const detailReasonsEl = document.getElementById('detail-reasons');
  const detailSourceEl = document.getElementById('detail-source');
  const detailCloseBtn = document.getElementById('detail-close');
  const detailCondBlockEl = document.getElementById('detail-cond-block');
  const detailCondsEl = document.getElementById('detail-conds');
  const detailRawBtn = document.getElementById('detail-raw-btn');
  const detailRawEl = document.getElementById('detail-raw');
  const detailRawLabelEl = document.getElementById('detail-raw-label');
  const detailRawTextEl = document.getElementById('detail-raw-text');
  const doneAllBtn = document.getElementById('done-all');
  const selectModeBtn = document.getElementById('select-mode');
  const batchbarEl = document.getElementById('batchbar');
  const batchCountEl = document.getElementById('batch-count');
  const batchAllBtn = document.getElementById('batch-all');
  const batchDoneBtn = document.getElementById('batch-done');
  const batchDeleteBtn = document.getElementById('batch-delete');
  const batchExitBtn = document.getElementById('batch-exit');
  const trashEl = document.getElementById('trash');
  const undoEl = document.getElementById('undo');
  const undoTextEl = document.getElementById('undo-text');
  const undoBtn = document.getElementById('undo-btn');
  const deleteTitleEl = document.getElementById('delete-dialog__title');
  const tabEls = Array.from(document.querySelectorAll('.tab'));

  let items = [];
  let filter = 'todo';
  let selectedId = null;
  let importedAt = null; // 最近一次成功导入（提取）的时间戳
  let selectMode = false;
  const picked = new Set();   // 多选模式下被勾中的条目 id
  let lastPickId = null;      // Shift 连选的锚点
  // 撤销按「批次」累积：连删几次，一次「撤销」把它们全部还回来，而不是只还最后一条。
  // 每个批次是 removeItems 返回的 [{item, index}]，批次内索引已按升序。
  let undoBatches = [];
  let undoTimer = null;

  // 这一段开头是标签吗？不是 → null；是说明性标签 → 标签本身；是「要求/截止时间」这类 → ''
  function labelKind(head) {
    const h = String(head).trim();
    if (!LABEL_RE.test(h)) return null;
    return NOTE_LABELS.indexOf(h) >= 0 ? h : '';
  }

  // ---- 解析一行：昵称 时间 内容 / 昵称: 内容 / 纯内容 ----
  // 返回 { speaker, content, note }：note 是这个标签行本身（没有标签就是 null）。
  // 标签行的标签保留在 content 里——「注：」这三个字带着信息，不该被剥掉。
  function parseLine(line) {
    line = line.trim();
    if (!line) return null;
    let m = line.match(/^(.+?)\s+(\d{1,2}:\d{2})\s+(.+)$/);
    if (m && NAME_RE.test(m[1].trim())) return { speaker: m[1].trim(), content: m[3].trim(), note: null };
    m = line.match(/^(.+?)[:：]\s*(.+)$/);
    if (m) {
      const head = m[1].trim();
      const kind = labelKind(head);
      // 标签行：发言人留空，标签留在正文里（它带着信息），note 决定要不要判成「说明」
      if (kind !== null) return { speaker: '', content: line, note: kind || null };
      // 不像昵称的头（含句读、或太长）就不认——宁可没有发言人，也不能把一句话当名字
      if (NAME_RE.test(head)) return { speaker: head, content: m[2].trim(), note: null };
    }
    return { speaker: '', content: line, note: null };
  }

  // 一行切成一段或几段（见 SPLIT_* 上方说明）
  function splitSegments(content) {
    const out = [];
    for (const hard of content.split(SPLIT_HARD_RE)) {
      for (const soft of hard.split(SPLIT_SOFT_RE)) {
        // 连接词留在后一段开头会读不通（"并且在提交之后…"），剥掉
        const seg = soft.trim().replace(LEAD_CONJ_RE, '').trim();
        if (seg) out.push(seg);
      }
    }
    return out;
  }

  // 括号里的「如果…就…」是规则的骨架，不是可以一截了之的括号废话。
  // 规则：按逗号/分号切，以「就」开头的段并到前一段上；**至少凑出两对**才算数，
  // 凑不出来就说明它不是这个形状，整段当一条补充说明，不硬拆。
  function extractConditions(content) {
    const out = [];
    const parens = content.match(PAREN_RE) || [];
    parens.forEach(function (p) {
      const inner = p.slice(1, -1);
      const parts = inner.split(/[，,；;]/).map(function (s) { return s.trim(); }).filter(Boolean);
      const pairs = [];
      parts.forEach(function (part) {
        if (/^就/.test(part)) {
          if (pairs.length) pairs[pairs.length - 1].then = part.replace(/^就[，,]?\s*/, '');
        } else {
          pairs.push({ when: part, then: '' });
        }
      });
      const complete = pairs.filter(function (x) { return x.when && x.then; });
      if (complete.length >= 2) out.push.apply(out, complete);
    });
    return out;
  }

  // 显示用的「主干」：剥掉行首标签、剥掉括号，留下能一眼扫完的那句。
  // 这不是改写，只是**删**——括号里的条件另外在解析里单列，一个字都没丢。
  // 列表和解析标题都用它；「原文」块永远还是完整那句。
  function displayText(item) {
    let s = String(item.text || '').replace(LABEL_PREFIX_RE, '');
    s = s.replace(PAREN_RE, '').replace(/\s{2,}/g, ' ').trim();
    // 括号剥完可能只剩标点（"（注）：交作业" → "：交作业"），清掉两头的标点
    s = s.replace(/^[，,、；;：:\s]+/, '').replace(/[，,、；;：:\s]+$/, '');
    // 剥完什么都不剩就退回完整正文——宁可长一点，也不能给一行空白
    return s || item.text;
  }

  function normalize(s) {
    return s.replace(/[\s，。！？、,.!?：:；;（）()「」『』]/g, '');
  }

  function escapeHTML(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // content 是一条已经切好的句子；source 是发言人；noteIn 是整行带下来的标签判定
  function extract(content, source, noteIn) {
    const reasons = [];
    const highlights = [];

    // 段首也可能是标签：一行里「……。注：……」被句号切开后，「注」落在后一段的开头，
    // 这时整行的 note 管不到它，得就地再认一次。
    let note = noteIn === undefined ? null : noteIn;
    if (!note) {
      const lm = content.match(/^(.{1,6}?)[:：]/);
      if (lm) note = labelKind(lm[1]);
    }
    // 说明类先自报家门。原来的顺序把它排在依据最后，于是整块依据读起来
    // 全是"它为什么不是任务"，而第一条其实就该说"它是什么"。
    if (note) reasons.push('说明性文字「' + note + '」');

    const tm = content.match(TIME_RE);
    let deadline = null;
    if (tm) { deadline = tm[1]; reasons.push('时间「' + deadline + '」'); highlights.push(deadline); }

    // 取「信息量最大」的动作词，而不是数组里第一个命中的。
    // 旧写法按 ACTION_WORDS 的顺序取首个，而「提交」恰好排在「完成」前面，
    // 于是"尽快完成考试，并且在提交之后…"报出来的关键词是「提交」，主次颠倒。
    // 规则：先比长度（「别忘了」胜过其子串「别忘」），同长再比谁在原文里出现得早。
    function pickAction(text) {
      let w = null;
      let at = -1;
      for (const cand of ACTION_WORDS) {
        const i = text.indexOf(cand);
        if (i < 0) continue;
        if (w === null || cand.length > w.length || (cand.length === w.length && i < at)) {
          w = cand;
          at = i;
        }
      }
      return w;
    }
    // 先在没有括号的正文里找。找不到才看括号里——括号里的命中另作解释。
    const bare = content.replace(PAREN_RE, '');
    let action = pickAction(bare);
    let actionInParen = false;
    if (!action) {
      const inParen = pickAction(content);
      if (inParen) { action = inParen; actionInParen = true; }
    }
    if (action) {
      reasons.push(actionInParen
        ? '关键词「' + action + '」出现在括号里的假设句中，不算交代你做的事'
        : '关键词「' + action + '」');
      // 括号里的命中不当作"命中了原文关键片段"高亮——高亮是给"为什么留下这条"作证的，
      // 一个被判定为"不算数"的词不该被标黄。
      if (!actionInParen) highlights.push(action);
    }

    // 规则骨架：括号里的「如果…就…」成对拎出来，解析里单列。
    // 这条是**正面**信息——它规定了什么，而不只是"它为什么不是任务"。
    const conditions = extractConditions(content);
    if (conditions.length) reasons.push('识别到 ' + conditions.length + ' 条「如果…就…」条件');

    // 「三选一 / 五选一」这类选一约束：列进解析，帮人看懂这条任务到底要几选几
    const choices = content.match(CHOICE_RE);
    if (choices) {
      choices.forEach(function (c) {
        reasons.push('选择「' + c + '」');
        highlights.push(c);
      });
    }

    let reqWord = null;
    for (const w of REQUEST_WORDS) { if (content.includes(w)) { reqWord = w; break; } }
    if (reqWord) { reasons.push('请求「' + reqWord + '」'); highlights.push(reqWord); }

    const mention = content.match(MENTION_RE);
    const atAll = content.match(AT_ALL_RE);
    let collective = null;
    for (const w of COLLECTIVE_WORDS) { if (content.includes(w)) { collective = w; break; } }
    const relevant = !!mention || !!atAll || !!collective;
    // 依据一律**引用实际命中的那几个字**，不再写死标签——
    // 写死的标签一旦和原文不符，整块「提取依据」就不可信了。
    if (mention) { reasons.push('提到你「' + mention[0] + '」'); highlights.push(mention[0]); }
    else if (atAll) { reasons.push('面向全班「' + atAll[0] + '」'); highlights.push(atAll[0]); }
    else if (collective) { reasons.push('面向全班「' + collective + '」'); highlights.push(collective); }

    let weak = null;
    for (const w of WEAK_WORDS) {
      if (!content.includes(w)) continue;
      // 「如果…就…」是**确定的条件**，不是"可能 / 到时候"那种犹豫。
      // 一刀切把"如果"判成措辞含糊，等于把一条明确规则说成拿不准的事。
      //（真的含糊的"如果有空"仍然会被 WEAK_WORDS 里的"有空"抓住。）
      if (w === '如果' && /如果[^。；]{1,40}就/.test(content)) continue;
      weak = w;
      break;
    }
    if (weak) { reasons.push('措辞「' + weak + '」不确定'); highlights.push(weak); }

    if (!action && !deadline && !relevant && !reqWord) return null;

    // 两条"这是说明、不是任务"的信号：行首标签（注/说明/规则…），
    // 或唯一的动作词躲在括号的假设句里。二者只改**类型**，不加动状态——
    //"注：明天下午5点前交作业"仍然是实打实有截止时间的待办。
    const isNote = !!note || actionInParen;

    let type;
    if (isNote) type = 'note';
    else if (action) type = 'task';
    else if (reqWord) type = 'request';
    else type = 'reminder';

    let state;
    if (weak) state = 'confirm';
    else if (action && !actionInParen && (deadline || relevant)) state = 'todo';
    else state = 'confirm';

    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: content,
      deadline: deadline,
      source: source,
      relevant: relevant,
      type: type,
      state: state,
      done: false,
      conditions: conditions,
      reasons: reasons,
      highlights: highlights
    };
  }

  function extractAll(text) {
    const out = [];
    const seen = new Set();
    let deduped = 0;
    const lines = text.split(/\r?\n/);
    for (let n = 0; n < lines.length; n++) {
      const info = parseLine(lines[n]);
      if (!info) continue;
      // 一行可能切出好几段，每段独立过 extract 的门槛；发言人对整行都一样。
      // 整行的 note 只给第一段——「注：明天交作业，并且后天交报告」里的「后天交报告」
      // 不是说明，是被注带出来的第二件事，把它也标成「说明」就错了。
      const segs = splitSegments(info.content);
      for (let i = 0; i < segs.length; i++) {
        const item = extract(segs[i], info.speaker, i === 0 ? info.note : null);
        if (!item) continue;
        const key = normalize(item.text);
        if (seen.has(key)) { deduped++; continue; }
        seen.add(key);
        // 记下它打哪儿来：粘贴内容里的第几行、那一行的原文。
        // 列表为了扫得快只留两行，被截掉的字得有个地方看全；
        // 而且一行切成两段时，光看条目本身看不出"这句话里还有另一半"。
        item.line = n + 1;
        item.raw = lines[n].trim();
        out.push(item);
      }
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

  // 「说明」是第四类：它既不是让你去做，也不是知道一下就行——它是**规则**，
  // 是"这件事该怎么做"的补充（"每人 3 次成绩，按最高、次高、第三次填"）。
  // 早先这种行会被判成任务，因为它里面恰好有个动作词，还是藏在括号的假设句里。
  const TYPE_LABEL = { task: '任务', reminder: '提醒', request: '请求', note: '说明' };

  // 在整行原文里，把「抽出来的那一段」标出来。
  // 先各自转义再定位：转义是逐字符的，转义后仍是子串，所以能直接 indexOf 找。
  function markSegment(text, seg) {
    const html = escapeHTML(text);
    const esc = escapeHTML(seg);
    if (!esc) return html;
    const i = html.indexOf(esc);
    if (i < 0) return html;
    return html.slice(0, i) + '<mark>' + esc + '</mark>' + html.slice(i + esc.length);
  }

  function itemHTML(item) {
    const cls = item.done ? 'done' : item.state;
    const isSelected = item.id === selectedId;
    const isPicked = picked.has(item.id);
    const typeKey = item.type || 'task';
    const type = '<span class="chip chip--type chip--type-' + typeKey + '">' + TYPE_LABEL[typeKey] + '</span>';
    const deadline = item.deadline ? '<span class="chip chip--deadline">' + escapeHTML(item.deadline) + '</span>' : '';
    const source = item.source ? '<span class="source">' + escapeHTML(item.source) + '</span>' : '';
    const me = item.relevant ? '<span class="chip chip--me">与你相关</span>' : '';
    const imported = importedAt ? '<span class="imported">导入于 ' + fmtDate(importedAt) + '</span>' : '';
    // 多选模式下，左边的框换成"选中"而不是"完成"——整行点击的含义也跟着变
    const toggle = selectMode
      ? '<input type="checkbox" class="pick"' + (isPicked ? ' checked' : '') + ' aria-label="选中这条待办">'
      : '<input type="checkbox" class="done-toggle"' + (item.done ? ' checked' : '') + ' aria-label="标记完成">';
    const more = selectMode ? '' : '<span class="item__more">' + (isSelected ? '收起 ⌃' : '解析 ›') + '</span>';
    const rowCls = 'item item--' + cls
      + (isSelected ? ' item--selected' : '')
      + (isPicked ? ' item--picked' : '')
      + (selectMode ? ' item--select' : '');
    return '' +
      '<li class="' + rowCls + '" data-id="' + item.id + '">' +
        '<span class="drag" role="button" tabindex="0" aria-label="拖动排序" title="拖动排序"></span>' +
        toggle +
        '<div class="body">' +
          '<div class="text">' + escapeHTML(displayText(item)) + '</div>' +
          '<div class="meta">' + type + deadline + me + source + imported + more +
          '</div>' +
        '</div>' +
        '<button type="button" class="del" title="删除">删除</button>' +
      '</li>';
  }

  function chipHTML(label, cls) {
    return '<span class="chip ' + cls + '">' + escapeHTML(label) + '</span>';
  }

  // 右侧「解析」：把这条为什么被抽出来的依据摊开
  function renderDetail(item) {
    const typeKey = item.type || 'task';
    const stateLabel = item.done ? '已完成' : (item.state === 'todo' ? '待办' : '待确认');

    // 标题用主干，下面「原文」用完整那句——两者分工，33 字的大标题才不像一堵墙
    detailTextEl.textContent = displayText(item);

    const meta = [
      chipHTML(TYPE_LABEL[typeKey], 'chip--type chip--type-' + typeKey),
      chipHTML(stateLabel, 'chip--state' + (item.done ? ' chip--state-done' : ''))
    ];
    if (item.deadline) meta.push(chipHTML('截止 ' + item.deadline, 'chip--deadline'));
    if (item.relevant) meta.push(chipHTML('与你相关', 'chip--me'));
    if (item.source) meta.push('<span class="source">' + escapeHTML(item.source) + '</span>');
    detailMetaEl.innerHTML = meta.join('');

    const reasons = item.reasons.length ? item.reasons : ['未命中特定规则，按时间或相关性保留'];
    detailReasonsEl.innerHTML = reasons.map(function (r) {
      return '<li>' + escapeHTML(r) + '</li>';
    }).join('');

    // 条件块：规则类的正经内容在这里，而不是在依据里用"它为什么不是任务"绕一圈。
    // 老数据没有这个字段，就地算一遍，不至于因为版本不同就不显示。
    const conds = item.conditions || extractConditions(item.text);
    detailCondBlockEl.hidden = !conds || !conds.length;
    detailCondsEl.innerHTML = (conds || []).map(function (c) {
      return '<li><span class="cond__when">' + escapeHTML(c.when) + '</span>'
        + '<span class="cond__arrow" aria-hidden="true">→</span>'
        + '<span class="cond__then">' + escapeHTML(c.then) + '</span></li>';
    }).join('');

    detailSourceEl.innerHTML = highlightedSource(item);

    // 「打开原文」：这条是从粘贴内容的哪一行抠出来的。
    // 只有一个字的差别时不留这个按钮——原文跟正文一模一样的话，
    // 点开等于什么都没给，那是个骗人的开关。
    // 只差两头的标点（切句时句号被切走了）不算"有原文可看"——
    // 弹出一个只多一个句号的开关，和没有开关一样没用。
    const normRaw = function (s) {
      return String(s || '').replace(/^[\s，,。.、；;：:]+|[\s，,。.、；;：:]+$/g, '');
    };
    const hasRaw = !!item.raw && normRaw(item.raw) !== normRaw(item.text);
    closeRaw(true);
    detailRawBtn.hidden = !hasRaw;
    if (hasRaw) {
      detailRawBtn.textContent = '打开原文 · 第 ' + item.line + ' 行';
      detailRawLabelEl.textContent = '粘贴的第 ' + item.line + ' 行';
      detailRawTextEl.innerHTML = markSegment(item.raw, item.text);
    } else {
      detailRawLabelEl.textContent = '';
      detailRawTextEl.textContent = '';
    }
  }

  // ---- 「打开原文」的展开 / 收起 ----
  // 收起要走回展开来的那条路（淡出 + 上移），只是快一点；
  // 收起后延迟挂 hidden，动画才播得完——和撤销条一个套路。
  let rawTimer = null;
  function closeRaw(instant) {
    window.clearTimeout(rawTimer);
    detailRawEl.classList.remove('raw--on');
    detailRawBtn.classList.remove('is-on');
    detailRawBtn.setAttribute('aria-expanded', 'false');
    if (instant) { detailRawEl.hidden = true; return; }
    rawTimer = window.setTimeout(function () {
      if (!detailRawEl.classList.contains('raw--on')) detailRawEl.hidden = true;
    }, 200);
  }

  function toggleRaw() {
    const item = items.find(function (i) { return i.id === selectedId; });
    if (!item || !item.raw) return;
    if (detailRawEl.classList.contains('raw--on')) {
      closeRaw(false);
      detailRawBtn.textContent = '打开原文 · 第 ' + item.line + ' 行';
      return;
    }
    detailRawBtn.textContent = '收起原文';
    detailRawBtn.classList.add('is-on');
    detailRawBtn.setAttribute('aria-expanded', 'true');
    detailRawEl.hidden = false;
    requestAnimationFrame(function () { detailRawEl.classList.add('raw--on'); });
  }

  function revealSide() {
    if (!window.matchMedia('(max-width: 919px)').matches) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    sideEl.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  // 点某条 → 输入台换成解析；再点一次（或点返回）换回来
  function selectItem(id) {
    const item = items.find(function (i) { return i.id === id; });
    if (!item) return;
    selectedId = id;
    renderDetail(item);
    consoleEl.hidden = true;
    detailEl.hidden = false;
    renderList();
    revealSide();
  }

  function closeDetail() {
    selectedId = null;
    detailEl.hidden = true;
    consoleEl.hidden = false;
    renderList();
    revealSide();
  }

  // 重新提取/清空时收起解析
  function resetSelection() {
    selectedId = null;
    detailEl.hidden = true;
    consoleEl.hidden = false;
  }

  // 当前标签下可见的条目，按 items 里的顺序
  function visibleItems() {
    return items.filter(function (i) {
      if (filter === 'done') return i.done;
      return !i.done && i.state === filter;
    });
  }

  function renderList() {
    const visible = visibleItems();
    // 「全部完成」只对当前标签下还没完成的条目有意义，没有可完成的就置灰
    if (doneAllBtn) {
      doneAllBtn.disabled = !visible.some(function (i) { return !i.done; });
    }
    // 垃圾桶只在真有东西可拖的时候出现
    if (trashEl) trashEl.hidden = visible.length === 0;
    if (visible.length === 0) {
      const empty = filter === 'done' ? '还没有已完成的待办' : (filter === 'confirm' ? '没有待确认的条目' : '没有待办');
      listEl.innerHTML = '<li class="empty">' + empty + '</li>';
      updateBatchBar();
      return;
    }
    listEl.innerHTML = visible.map(itemHTML).join('');
    updateBatchBar();
  }

  // ---- 多选 ----
  function updateBatchBar() {
    if (!batchbarEl) return;
    const n = picked.size;
    batchCountEl.textContent = '已选 ' + n + ' 条';
    batchDoneBtn.disabled = n === 0;
    batchDeleteBtn.disabled = n === 0;
    const vis = visibleItems();
    const all = vis.length > 0 && vis.every(function (i) { return picked.has(i.id); });
    batchAllBtn.textContent = all ? '取消全选' : '全选';
    batchAllBtn.disabled = vis.length === 0;
  }

  // 只改这一行，不整列重渲染——重渲染会把悬停/过渡状态一并打断
  function setPicked(id, on, silent) {
    if (on) picked.add(id); else picked.delete(id);
    const el = listEl.querySelector('.item[data-id="' + id + '"]');
    if (el) {
      el.classList.toggle('item--picked', on);
      const cb = el.querySelector('.pick');
      if (cb) cb.checked = on;
    }
    if (!silent) updateBatchBar();
  }

  function enterSelectMode() {
    selectMode = true;
    picked.clear();
    lastPickId = null;
    if (selectedId) resetSelection();
    selectModeBtn.classList.add('is-on');
    selectModeBtn.setAttribute('aria-pressed', 'true');
    selectModeBtn.textContent = '退出多选';
    batchbarEl.hidden = false;
    renderList();
    announce('多选已开启，点条目即可选中，Shift 点击可连选');
  }

  function exitSelectMode() {
    selectMode = false;
    picked.clear();
    lastPickId = null;
    selectModeBtn.classList.remove('is-on');
    selectModeBtn.setAttribute('aria-pressed', 'false');
    selectModeBtn.textContent = '多选';
    batchbarEl.hidden = true;
    renderList();
  }

  function batchSelectAll() {
    const vis = visibleItems();
    if (!vis.length) return;
    const all = vis.every(function (i) { return picked.has(i.id); });
    vis.forEach(function (i) { setPicked(i.id, !all, true); });
    updateBatchBar();
    announce(all ? '已取消全选' : '已选中全部 ' + vis.length + ' 条');
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
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
    const base = open.length === 0
      ? '都清完了。'
      : (confirm > 0 ? '有 ' + confirm + ' 条拿不准，已单独放进「待确认」' : '全部条目都可以直接执行');
    summaryEl.textContent = base;
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ chat: chatEl.value, items: items, importedAt: importedAt }));
    } catch (e) { /* 隐私模式等场景忽略 */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.chat != null) chatEl.value = data.chat;
      if (Array.isArray(data.items)) items = data.items;
      if (data.importedAt != null) importedAt = data.importedAt;
    } catch (e) { /* 损坏则忽略 */ }
  }

  // ---- 事件 ----
  function doExtract() {
    // 重新提取会换掉整批条目，多选的选中项全部失效，顺手退出多选
    if (selectMode) exitSelectMode();
    const text = chatEl.value;
    if (!text.trim()) {
      items = [];
      resetSelection();
      renderAll();
      setActiveTab();
      setHint('先把群聊记录贴进来，再点提取。', 'warn');
      return;
    }
    const r = extractAll(text);
    items = r.items;
    filter = 'todo';
    resetSelection();
    importedAt = items.length ? Date.now() : null; // 有结果才记录导入时间
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
  quickstartBtn.addEventListener('click', function () { chatEl.value = SAMPLE_CHAT; doExtract(); });
  clearBtn.addEventListener('click', function () {
    chatEl.value = '';
    setHint('');
    save();
  });

  tabEls.forEach(function (t) {
    t.addEventListener('click', function () {
      filter = t.dataset.filter;
      // 切标签后选中项可能不在当前列表里，收起解析避免「面板有内容但没选中项」
      if (selectedId) resetSelection();
      // 同理：多选的选中项也跟着标签走，换了标签就当重新选
      if (selectMode) { picked.clear(); lastPickId = null; }
      setActiveTab();
      renderList();
    });
  });

  listEl.addEventListener('click', function (e) {
    if (suppressClick) { suppressClick = false; return; } // 刚拖完的那一次 click 不算数
    if (e.target.closest('.drag')) return;                // 拖拽把手不触发选中/解析
    const itemEl = e.target.closest('.item');
    if (!itemEl) return;
    const id = itemEl.dataset.id;
    const item = items.find(function (i) { return i.id === id; });
    if (!item) return;

    // 删除按钮：无论是否在多选模式，都是删这一条（走二次确认）
    if (e.target.classList.contains('del')) {
      lastDelBtn = e.target;
      openDeleteDialog([id]);
      return;
    }

    // 多选模式：整行点击 = 切换选中，不再展开解析
    if (selectMode) {
      const on = e.target.classList.contains('pick') ? e.target.checked : !picked.has(id);
      if (e.shiftKey && lastPickId && lastPickId !== id) {
        const vis = visibleItems();
        const a = vis.findIndex(function (i) { return i.id === lastPickId; });
        const b = vis.findIndex(function (i) { return i.id === id; });
        if (a >= 0 && b >= 0) {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          for (let k = lo; k <= hi; k++) setPicked(vis[k].id, on, true);
          updateBatchBar();
          lastPickId = id;
          return;
        }
      }
      setPicked(id, on);
      lastPickId = id;
      return;
    }

    if (e.target.classList.contains('done-toggle')) {
      item.done = e.target.checked;
      save();
      renderSummary();
      if (selectedId === id) renderDetail(item);
      renderList();
      return;
    }
    if (selectedId === id) closeDetail();
    else selectItem(id);
  });

  detailCloseBtn.addEventListener('click', closeDetail);
  detailRawBtn.addEventListener('click', toggleRaw);

  // ---- 删除确认：先弹警告，确认后条目「跳出去」再移除 ----
  const deleteDialogEl = document.getElementById('delete-dialog');
  const deletePreviewEl = document.getElementById('delete-dialog__preview');
  const deleteCancelBtn = document.getElementById('delete-cancel');
  const deleteConfirmBtn = document.getElementById('delete-confirm');
  let pendingDeleteIds = null;
  let lastDelBtn = null;
  // 读取时机很关键：不能在加载时把结果快照成常量。
  // 用户可能开着页面才去系统里打开动画效果——那时 CSS 媒体查询会实时恢复，
  // 但快照常量仍是旧值，就会出现"其他动效都好了、只有删除直接瞬逝"。
  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  function prefersReduce() { return reduceMQ.matches; }
  const ITEM_OUT_MS = 400;

  // ids: 要删除的条目 id 数组（单条删除和批量删除共用同一个弹窗）
  function openDeleteDialog(ids) {
    if (!ids || !ids.length) return;
    pendingDeleteIds = ids.slice();
    const n = ids.length;
    deleteTitleEl.textContent = n === 1 ? '删除这条待办？' : '删除选中的 ' + n + ' 条待办？';
    const texts = ids.slice(0, 3).map(function (id) {
      const it = items.find(function (i) { return i.id === id; });
      return it ? it.text : '';
    }).filter(Boolean);
    deletePreviewEl.textContent = texts.join(' ／ ') + (n > 3 ? ' …等 ' + n + ' 条' : '');
    deleteDialogEl.hidden = false;
    deleteCancelBtn.focus(); // 危险操作：默认焦点落在「取消」上，避免误触回车即删
  }

  function closeDeleteDialog() {
    deleteDialogEl.hidden = true;
    pendingDeleteIds = null;
    if (lastDelBtn) { lastDelBtn.focus(); lastDelBtn = null; }
  }

  // 返回被删掉的 {item, index}，调用方可用它做撤销
  function removeItems(ids) {
    const set = new Set(ids);
    const removed = [];
    const next = [];
    items.forEach(function (it, idx) {
      if (set.has(it.id)) removed.push({ item: it, index: idx });
      else next.push(it);
    });
    if (!removed.length) return [];
    items = next;
    ids.forEach(function (id) { picked.delete(id); });
    if (selectedId && set.has(selectedId)) resetSelection();
    save();
    renderAll();
    return removed;
  }

  // ---- 撤销（只给「拖进垃圾桶」用）----
  // 按钮删除有二次确认，确认过就是终局；拖拽删除没有确认，所以补一条限时撤回。
  function showUndo(removed) {
    if (!removed.length) return;
    const wasOn = undoEl.classList.contains('undo--on');
    undoBatches.push(removed);   // 累加而不是替换：连删几次能一次全撤销
    const total = undoBatches.reduce(function (n, b) { return n + b.length; }, 0);
    undoTextEl.textContent = '已删除 ' + total + ' 条';
    undoEl.hidden = false;
    if (wasOn) {
      // 条子已经在台上了就别再播一遍入场——那样每删一条都要重新滑进来打断人。
      // 只让数字轻轻跳一下，说清"又多了一条"。
      pulseUndoCount();
    } else {
      requestAnimationFrame(function () { undoEl.classList.add('undo--on'); });
    }
    window.clearTimeout(undoTimer);   // 每删一次重新给 6 秒
    undoTimer = window.setTimeout(hideUndo, 6000);
  }

  // 数字跳动用 WAAPI：不必靠"摘 class → 强制回流 → 加回 class"去重播过渡，
  // 连删时每次调用都从头播一遍，互不打断。
  function pulseUndoCount() {
    if (prefersReduce() || !undoTextEl.animate) return;
    undoTextEl.animate(
      [{ transform: 'scale(1.14)' }, { transform: 'scale(1)' }],
      { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }
    );
  }

  function hideUndo() {
    window.clearTimeout(undoTimer);
    undoBatches = [];
    undoEl.classList.remove('undo--on');
    window.setTimeout(function () {
      // 期间又删了一次的话，别把新的那条一起藏了
      if (!undoEl.classList.contains('undo--on')) undoEl.hidden = true;
    }, 220);
  }

  function undoDelete() {
    if (!undoBatches.length) return;
    const total = undoBatches.reduce(function (n, b) { return n + b.length; }, 0);
    const next = items.slice();
    // 批次要倒着走（后删的先还原），批次内按索引升序——
    // 这样每个记录下来的索引在被用到的那一刻都还是有效的，条目各自回到原位。
    undoBatches.slice().reverse().forEach(function (batch) {
      batch.forEach(function (r) {
        next.splice(Math.min(r.index, next.length), 0, r.item);
      });
    });
    items = next;
    save();
    renderAll();
    setActiveTab();
    announce('已撤销，恢复了 ' + total + ' 条');
    hideUndo();
  }

  // 剩余条目平滑让位（FLIP）：先记下各自位置 → 重排 → 从旧位置补间回新位置
  function captureTops() {
    const map = new Map();
    listEl.querySelectorAll('.item').forEach(function (el) {
      map.set(el.dataset.id, el.getBoundingClientRect().top);
    });
    return map;
  }

  // opts.skip: 正在被拖拽的条目——它的 transform 由拖拽逻辑逐帧接管，不能让 FLIP 覆写
  // opts.ms:   补间时长。删除让位 340ms（看得清），拖拽换位 200ms（跟手）
  function flipItems(before, opts) {
    opts = opts || {};
    const skip = opts.skip || null;
    const ms = opts.ms || 340;
    const els = Array.from(listEl.querySelectorAll('.item'));
    const moved = [];
    // 1) 批量读：量出每条要走的位移（读写分开，避免 layout thrashing）
    els.forEach(function (el) {
      if (el === skip) return;
      const prev = before.get(el.dataset.id);
      if (prev == null) return;
      const r = el.getBoundingClientRect();
      if (!r.height) return; // 已经 display:none 的条目没有位置可言
      const dy = prev - r.top;
      if (Math.abs(dy) >= 1) moved.push({ el: el, dy: dy });
    });
    if (!moved.length) return;
    // 2) 批量写：瞬时挪回旧位置（先关掉过渡）
    const token = (flipItems.n = (flipItems.n || 0) + 1);
    moved.forEach(function (m) {
      m.el.__flipToken = token;
      m.el.style.transition = 'none';
      m.el.style.transform = 'translateY(' + m.dy + 'px)';
    });
    // 3) 强制一次重排，让"旧位置"这一帧真正落实。
    //    否则最后一条写完后没有读操作去 flush，浏览器认为它没有起始值，直接瞬移。
    void listEl.offsetHeight;
    // 4) 下一帧打开过渡、清掉位移，补间回真实位置
    requestAnimationFrame(function () {
      moved.forEach(function (m) {
        m.el.style.transition = 'transform ' + ms + 'ms cubic-bezier(0.23, 1, 0.32, 1)';
        m.el.style.transform = '';
      });
      window.setTimeout(function () {
        moved.forEach(function (m) {
          // 拖拽时换位很快，上一轮的清理不能把这一轮的过渡顺手抹掉
          if (m.el.__flipToken !== token) return;
          m.el.style.transition = '';
          m.el.style.transform = '';
        });
      }, ms + 40);
    });
  }

  function animateLetWay(before) {
    flipItems(before, { ms: 340 });
  }

  function confirmDelete() {
    const ids = pendingDeleteIds;
    if (!ids || !ids.length) return;
    lastDelBtn = null; // 条目即将移除，无需把焦点还给已消失的按钮
    closeDeleteDialog();
    const reduce = prefersReduce();
    const els = ids.map(function (id) {
      return listEl.querySelector('.item[data-id="' + id + '"]');
    }).filter(Boolean);

    if (!els.length) { removeItems(ids); return; }

    // 多条时错开一点：一条条甩出去，读起来才是"这些东西一起没了"而不是"列表闪了一下"
    const step = reduce ? 0 : Math.min(40, Math.round(240 / els.length));
    els.forEach(function (el, i) {
      window.setTimeout(function () { el.classList.add('item--leaving'); }, i * step);
    });
    window.setTimeout(function () {
      const before = reduce ? null : captureTops();
      removeItems(ids);
      if (before) animateLetWay(before);
    }, reduce ? 0 : (els.length - 1) * step + ITEM_OUT_MS);
  }

  deleteCancelBtn.addEventListener('click', closeDeleteDialog);
  deleteConfirmBtn.addEventListener('click', confirmDelete);
  deleteDialogEl.addEventListener('click', function (e) {
    if (e.target.hasAttribute('data-close')) closeDeleteDialog();
  });
  document.addEventListener('keydown', function (e) {
    if (!deleteDialogEl.hidden && e.key === 'Escape') closeDeleteDialog();
  });

  // ---- 拖拽排序 ----
  // 交互判定：排序是「偶发、有明确意图」的操作，不是高频动作，
  // 所以给足动效——被拖的那条抬起跟随指针，其余条目让开空位（spring 手感靠 200ms 强缓出）。
  let suppressClick = false;
  let drag = null;

  function announce(msg) {
    const el = document.getElementById('list-status');
    if (el) el.textContent = msg;
  }

  function visibleIds() {
    return Array.from(listEl.querySelectorAll('.item')).map(function (el) { return el.dataset.id; });
  }

  function moveBefore(el, ref) { listEl.insertBefore(el, ref); }

  // 只把「可见项」按新顺序填回它们在 items 里原本占用的那些槽位；
  // 其他标签下的条目位置不动，避免拖了「待办」却把「已完成」的顺序搅乱。
  function reorderVisible(orderedIds) {
    const byId = new Map(items.map(function (i) { return [i.id, i]; }));
    const visibleSet = new Set(orderedIds);
    const slots = [];
    items.forEach(function (it, idx) { if (visibleSet.has(it.id)) slots.push(idx); });
    const next = items.slice();
    slots.forEach(function (slot, k) { next[slot] = byId.get(orderedIds[k]); });
    items = next;
  }

  // 拖拽的一帧：一次批量读 → 一次批量写 →（必要时）换位。
  // 严格避免读写交错，否则每个 pointermove 都要付出多次强制重排。
  // 两个轴都跟手：只跟 Y 的话，条目永远出不了列表盒子的左右边界，也就够不到左下角的垃圾桶。
  function dragFrame(clientX, clientY) {
    const el = drag.el;
    const visualTop = clientY - drag.grabOffset;    // 目标视觉位置（不受当前 transform 影响）
    const visualLeft = clientX - drag.grabOffsetX;

    // —— 批量读 ——
    const rect = el.getBoundingClientRect();
    const sibs = [];
    Array.from(listEl.children).forEach(function (c) {
      if (c === el || !c.classList.contains('item')) return;
      const r = c.getBoundingClientRect();
      sibs.push({ el: c, center: r.top + r.height / 2 });
    });
    const trashRect = (trashEl && !trashEl.hidden) ? trashEl.getBoundingClientRect() : null;

    // —— 批量写 ——
    drag.tx += visualLeft - rect.left;
    drag.ty += visualTop - rect.top;
    el.style.transform = 'translate(' + drag.tx + 'px, ' + drag.ty + 'px)';

    // 垃圾桶命中判定用「指针坐标」而不是「元素坐标」：
    // 条目是宽而扁的，拿它的矩形去判断，指针还在桶外时会先一步命中。
    let overTrash = false;
    if (trashRect) {
      const pad = 10; // 稍微宽容一点，差一点点也算进去
      overTrash = clientX >= trashRect.left - pad && clientX <= trashRect.right + pad &&
                  clientY >= trashRect.top - pad && clientY <= trashRect.bottom + pad;
    }
    if (overTrash !== drag.overTrash) {
      drag.overTrash = overTrash;
      if (trashEl) trashEl.classList.toggle('trash--over', overTrash);
    }
    // 已经在瞄准垃圾桶了，就别再顺手换位——那会让整列在你瞄准时抖来抖去
    if (overTrash) return;

    // 换位判定：拿"目标视觉位置"跟兄弟的中线比。
    // 越过后继项的中线 → 往后挪一格；退到前驱项的中线之上 → 往前挪一格。
    const centerY = visualTop + rect.height / 2;
    let hit = null;
    for (let i = 0; i < sibs.length; i++) {
      const s = sibs[i];
      const elIsBefore = !!(el.compareDocumentPosition(s.el) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (elIsBefore && centerY > s.center) { hit = { ref: s.el, after: true }; break; }
      if (!elIsBefore && centerY < s.center) { hit = { ref: s.el, after: false }; break; }
    }
    if (!hit) return;

    // 真的换位：其它条目从旧位置补间到新位置（被拖的那条跳过，它由指针逐帧接管）
    const before = captureTops();
    if (hit.after) moveBefore(el, hit.ref.nextSibling);
    else moveBefore(el, hit.ref);
    flipItems(before, { skip: el, ms: 200 });

    // 换位改变了布局基准，重算位移，让被拖的那条视觉位置纹丝不动
    drag.ty += visualTop - el.getBoundingClientRect().top;
    drag.tx += visualLeft - el.getBoundingClientRect().left;
    el.style.transform = 'translate(' + drag.tx + 'px, ' + drag.ty + 'px)';
  }

  listEl.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const handle = e.target.closest && e.target.closest('.drag');
    if (!handle) return;
    const itemEl = handle.closest('.item');
    if (!itemEl) return;
    if (drag) return; // 多指保护：拖动中忽略新的指针
    const r = itemEl.getBoundingClientRect();
    drag = {
      el: itemEl,
      id: itemEl.dataset.id,
      pointerId: e.pointerId,
      handle: handle,
      startX: e.clientX,
      startY: e.clientY,
      grabOffsetX: e.clientX - r.left,
      grabOffset: e.clientY - r.top,
      tx: 0,
      ty: 0,
      overTrash: false,
      moved: false
    };
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  });

  listEl.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      // 阈值：避免把点击误判成拖拽。任一轴越过阈值即算拖拽。
      if (Math.abs(e.clientY - drag.startY) < 4 && Math.abs(e.clientX - drag.startX) < 4) return;
      drag.moved = true;
      // 拾起这一刻元素可能正带着 :hover 的位移（translate(-2px,-2px)）。
      // 内联 transform 会整个盖掉它，不补偿的话抓起来会瞬跳 2px。以当前实际位移为起点。
      const cur = getComputedStyle(drag.el).transform;
      if (cur && cur !== 'none') {
        try {
          const m = new DOMMatrixReadOnly(cur);
          drag.tx = m.m41;
          drag.ty = m.m42;
        } catch (err) { /* 忽略 */ }
      }
      drag.el.classList.add('item--dragging');
      drag.el.style.transition = 'none'; // 跟手，不能有补间延迟
      document.body.classList.add('is-dragging');
      // 入场动画的 fill-mode: both 会把动画值一直挂着，而 CSS 动画的优先级高于内联样式——
      // 提取后 0.9 秒内开始拖拽的话，下面 dragFrame 写的内联 transform 会被动画压住，
      // 条目根本不跟指针。拖拽一开始就把入场动画整个撤掉。
      listEl.classList.remove('list--enter');
    }
    e.preventDefault();
    dragFrame(e.clientX, e.clientY);
  });

  // 松手后飞进垃圾桶：位移由「当前拖到的位置」补到「桶心」，同时缩小 + 淡出。
  // 缩小到 0.2 而不是 0——没有任何东西是真的"消失成一个点"的。
  function dropIntoTrash(el, id) {
    const reduce = prefersReduce();
    const finish = function () {
      document.body.classList.remove('is-dropping');
      const before = reduce ? null : captureTops();
      const removed = removeItems([id]);
      if (before) animateLetWay(before);
      el.classList.remove('item--dragging');
      if (removed.length) showUndo(removed);
      announce('已删除 1 条，可以撤销');
    };

    if (reduce || !trashEl || !el.isConnected) { finish(); return; }

    const r = el.getBoundingClientRect();
    const t = trashEl.getBoundingClientRect();
    const dx = (t.left + t.width / 2) - (r.left + r.width / 2);
    const dy = (t.top + t.height / 2) - (r.top + r.height / 2);
    let nx = dx;
    let ny = dy;
    try {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      nx = m.m41 + dx;
      ny = m.m42 + dy;
    } catch (err) { /* 拿不到就用纯差值 */ }

    document.body.classList.add('is-dropping'); // 这一路上别被 .listbox 裁掉
    // 先亮着走，最后一段才淡出——这样"被丢进桶里"是看得见的
    el.style.transition = 'transform 300ms var(--ease-in-out), opacity 180ms linear 120ms';
    el.style.transform = 'translate(' + nx + 'px, ' + ny + 'px) scale(0.2) rotate(-6deg)';
    el.style.opacity = '0';
    window.setTimeout(finish, 300);
  }

  function endDrag(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    try { d.handle.releasePointerCapture(d.pointerId); } catch (err) { /* 忽略 */ }
    if (trashEl) trashEl.classList.remove('trash--over');

    // 拖进垃圾桶 = 明确的删除意图，不再弹窗问一遍；改为删除后给一条可撤销的提示
    if (d.moved && d.overTrash) {
      document.body.classList.remove('is-dragging');
      suppressClick = true;
      window.setTimeout(function () { suppressClick = false; }, 250);
      dropIntoTrash(d.el, d.id);
      return;
    }

    d.el.style.transition = '';
    d.el.style.transform = '';
    d.el.classList.remove('item--dragging');
    document.body.classList.remove('is-dragging');
    if (!d.moved) return;
    if (commit) {
      reorderVisible(visibleIds());
      save();
      announce('顺序已更新');
    }
    // 拖拽结束紧跟一次 click，得吞掉，否则会被当成"选中该条"
    suppressClick = true;
    window.setTimeout(function () { suppressClick = false; }, 250);
  }

  listEl.addEventListener('pointerup', function (e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag(true);
  });
  listEl.addEventListener('pointercancel', function (e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag(false);
  });

  // 键盘也能排序：把手可 Tab 聚焦，回车/空格拾起，上下方向键移动，回车放下，Esc 取消
  let kbDrag = null;

  function endKbDrag(commit) {
    if (!kbDrag) return;
    const id = kbDrag.dataset.id;
    const el = kbDrag;
    kbDrag = null;
    el.classList.remove('item--dragging');
    const old = el.querySelector('.drag');
    if (old) old.setAttribute('aria-pressed', 'false');
    if (commit) {
      reorderVisible(visibleIds());
      save();
      announce('顺序已更新');
    } else {
      renderList(); // 中途取消：items 没动过，重渲染即回到原顺序
    }
    // 取消时 renderList 把整列节点换掉了，得按 id 重新找把手；提交时原节点还在。
    // 总之焦点要留在把手上，否则用户下一次按方向键就没人接了。
    const h = listEl.querySelector('.item[data-id="' + id + '"] .drag') || old;
    if (h) h.focus();
  }

  listEl.addEventListener('keydown', function (e) {
    const handle = e.target.closest && e.target.closest('.drag');
    if (!handle) return;
    const itemEl = handle.closest('.item');
    if (!itemEl) return;
    const pick = e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';

    if (pick && kbDrag === itemEl) { e.preventDefault(); endKbDrag(true); return; }
    if (pick && !kbDrag) {
      e.preventDefault();
      kbDrag = itemEl;
      itemEl.classList.add('item--dragging');
      handle.setAttribute('aria-pressed', 'true');
      announce('已拾起，用上下方向键移动，回车放下，Esc 取消');
      return;
    }
    if (e.key === 'Escape' && kbDrag) { e.preventDefault(); endKbDrag(false); return; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && kbDrag) {
      e.preventDefault();
      const up = e.key === 'ArrowUp';
      let sib = up ? kbDrag.previousElementSibling : kbDrag.nextElementSibling;
      while (sib && !sib.classList.contains('item')) sib = up ? sib.previousElementSibling : sib.nextElementSibling;
      if (!sib) return;
      const before = captureTops();
      if (up) moveBefore(kbDrag, sib); else moveBefore(kbDrag, sib.nextSibling);
      flipItems(before, { ms: 200 });
      // 在 DOM 里挪动一个持有焦点的元素会让焦点掉回 body，
      // 不补回来的话，接下来的回车/Esc 就再也进不到这个处理器里了。
      handle.focus();
      announce('已移动到第 ' + (Array.from(listEl.children).indexOf(kbDrag) + 1) + ' 位');
    }
  });

  // ---- 批量完成 ----
  // 交互判定：这是「批量操作」而非高频单条勾选，所以值得给一个错峰动效——
  // 让多条待办依次进入完成态（每条约 70ms 间隔），把"一次操作影响了很多条"讲清楚。
  // 单条勾选保持零动画：那是高频动作，加了只会觉得卡。
  const BULK_STEP_MS = 70;

  function markAllDone() {
    if (doneAllBtn.disabled) return;
    const targets = Array.from(listEl.querySelectorAll('.item')).filter(function (el) {
      const it = items.find(function (i) { return i.id === el.dataset.id; });
      return it && !it.done;
    });
    const n = targets.length;
    if (!n) return;

    const reduce = prefersReduce();
    // 错峰间隔随条数自适应：整段"依次落下"封顶在 ~520ms，
    // 不然条目一多就变成一段漫长的等待，动效反而成了负担。
    const step = reduce ? 0 : Math.max(24, Math.min(BULK_STEP_MS, Math.round(520 / n)));
    const exitStep = reduce ? 0 : Math.max(20, Math.round(320 / n));
    const OUT_MS = 200; // 与 CSS 里 itemDoneOut 的时长一致

    doneAllBtn.disabled = true;
    targets.forEach(function (el, i) {
      window.setTimeout(function () {
        const it = items.find(function (x) { return x.id === el.dataset.id; });
        if (!it) return;
        it.done = true;
        const cb = el.querySelector('.done-toggle');
        if (cb) cb.checked = true;
        el.classList.add('item--done', 'item--checking');
      }, reduce ? 0 : i * step);
    });

    // 全部勾完之后再按同样的次序退场。
    // 四条同时消失会让整块列表"塌"一下；依次退场才跟前面的依次勾选讲的是同一件事。
    // 每条先淡出、淡完再从文档流里摘掉并让下面的条目补间上移——
    // 否则淡出的行仍然占着高度，一列"空壳"看起来像列表破了洞。
    window.setTimeout(function () {
      save();
      targets.forEach(function (el, i) {
        window.setTimeout(function () {
          el.classList.remove('item--checking');
          el.classList.add('item--leaving-done');
          window.setTimeout(function () {
            if (!el.isConnected) return;
            const before = captureTops();
            el.style.display = 'none';
            flipItems(before, { ms: 200 });
          }, reduce ? 0 : OUT_MS);
        }, reduce ? 0 : i * exitStep);
      });
      window.setTimeout(function () {
        renderAll();
        setActiveTab();
      }, reduce ? 0 : (n - 1) * exitStep + OUT_MS + 260);
    }, (reduce ? 0 : (n - 1) * step) + (reduce ? 0 : 120));

    announce('正在把 ' + n + ' 条标为已完成');
  }

  if (doneAllBtn) doneAllBtn.addEventListener('click', markAllDone);

  // ---- 多选：批量完成 / 批量删除 ----
  function batchComplete() {
    const ids = Array.from(picked);
    if (!ids.length) return;
    const reduce = prefersReduce();
    const els = ids.map(function (id) {
      return listEl.querySelector('.item[data-id="' + id + '"]');
    }).filter(Boolean);
    // 先一条条淡出，再统一落到「已完成」。
    // 纯淡出（不带位移）是必须的：淡出期间下面的条目要靠 FLIP 的 transform 补位，
    // CSS 动画的 transform 会盖掉内联的 FLIP 位移，行会"啪"地跳一格。
    const step = reduce ? 0 : Math.min(30, Math.round(240 / els.length));
    els.forEach(function (el, i) {
      window.setTimeout(function () { el.classList.add('item--leaving-done'); }, i * step);
    });
    window.setTimeout(function () {
      ids.forEach(function (id) {
        const it = items.find(function (i) { return i.id === id; });
        if (it) it.done = true;
      });
      picked.clear();
      lastPickId = null;
      save();
      renderAll();
      setActiveTab();
    }, els.length ? (els.length - 1) * step + 200 : 0);
    announce('已把 ' + ids.length + ' 条标为已完成');
  }

  function batchDelete() {
    if (!picked.size) return;
    openDeleteDialog(Array.from(picked));
  }

  selectModeBtn.addEventListener('click', function () {
    if (selectMode) exitSelectMode(); else enterSelectMode();
  });
  batchAllBtn.addEventListener('click', batchSelectAll);
  batchDoneBtn.addEventListener('click', batchComplete);
  batchDeleteBtn.addEventListener('click', batchDelete);
  batchExitBtn.addEventListener('click', exitSelectMode);
  undoBtn.addEventListener('click', undoDelete);

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
