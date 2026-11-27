// 控制台：登录、填写记录与导出、题库与问卷。所有数据都经 /api/admin/ 读写。
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS = { pending: '待联系', contacted: '已联系', signed: '已签约', closed: '不合适' };
const TYPE = {
  single: '单选', multi: '多选', short_text: '短问答', long_text: '长问答',
  email: '邮箱', phone: '电话', date: '日期', info: '纯说明',
};
const ICONS = { '': '无图标', work: '公文包', star: '星星', spark: '闪光', compass: '指南针', chat: '对话' };

const state = {
  questions: [],   // 题库里的全部题目
  items: [],       // 正在编辑的问卷：[{ id, question_id, next, routes }]
  savedItems: '[]',
  submissions: [],
  openId: null,
};

// ---------------------------------------------------------------- 通用

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/admin/${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'login') {
    showLogin();
    throw new Error('登录已过期，请重新登录。');
  }
  if (!res.ok) throw new Error(data.error || '操作没有成功，请稍后再试。');
  return data;
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

const time = (iso) => new Date(iso).toLocaleString('zh-CN', { hour12: false });
const show = (value) => (Array.isArray(value) ? value.join('、') : String(value ?? ''));
const byId = (id) => state.questions.find((q) => q.id === id);
const byKey = (key) => state.questions.find((q) => q.field_key === key);

function openDialog(html) {
  $('#dialog-body').innerHTML = html;
  $('#dialog').showModal();
}
const closeDialog = () => $('#dialog').close();

// ---------------------------------------------------------------- 登录

function showLogin() {
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
}

async function enter(email) {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#who').textContent = email;
  await loadBank();
  await loadRecords();
}

$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  $('#login-error').textContent = '';
  form.querySelector('button').disabled = true;
  try {
    const me = await api('login', {
      method: 'POST',
      body: { email: form.elements.email.value, password: form.elements.password.value },
    });
    form.elements.password.value = '';
    await enter(me.email);
  } catch (err) {
    $('#login-error').textContent = err.message;
  } finally {
    form.querySelector('button').disabled = false;
  }
};

$('#logout').onclick = async () => {
  await api('logout', { method: 'POST' }).catch(() => {});
  showLogin();
};

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('#records-tab').hidden = tab.dataset.tab !== 'records';
    $('#bank-tab').hidden = tab.dataset.tab !== 'bank';
  };
});

// ---------------------------------------------------------------- 填写记录

function filterParams() {
  const params = new URLSearchParams();
  const add = (key, value) => { if (value) params.set(key, value); };
  add('q', $('#f-q').value.trim());
  add('status', $('#f-status').value);
  add('path', $('#f-path').value);
  add('from', $('#f-from').value);
  add('to', $('#f-to').value);
  return params;
}

async function loadRecords() {
  try {
    const data = await api(`submissions?${filterParams()}`);
    state.submissions = data.submissions;
    $('#count').textContent = `${data.submissions.length} 条${data.capped ? '（只显示最近 1000 条）' : ''}`;
    renderRecords();
  } catch (err) {
    toast(err.message);
  }
}

function renderRecords() {
  $('#rows').innerHTML = state.submissions.map((s) => `
    <tr data-id="${s.id}" class="${s.id === state.openId ? 'active' : ''}" tabindex="0">
      <td>${esc(time(s.created_at))}</td>
      <td>${esc(s.name)}</td>
      <td>${esc(s.email)}</td>
      <td>${esc(s.path)}</td>
      <td><span class="badge ${s.status}">${STATUS[s.status] || esc(s.status)}</span></td>
    </tr>`).join('');
  $('#empty').hidden = state.submissions.length > 0;
  document.querySelectorAll('#rows tr').forEach((row) => {
    row.onclick = () => openRecord(row.dataset.id);
    row.onkeydown = (e) => { if (e.key === 'Enter') openRecord(row.dataset.id); };
  });
}

async function openRecord(id) {
  try {
    renderDetail(await api(`submissions/${id}`));
  } catch (err) {
    toast(err.message);
  }
}

function renderDetail(s) {
  state.openId = s.id;
  const el = $('#detail');
  el.hidden = false;
  el.innerHTML = `
    <div class="head"><h2>填写详情</h2><button class="link" id="d-close">关闭</button></div>
    <p class="muted">${esc(time(s.created_at))} 提交</p>
    <dl>${s.answers.map((a) => `<dt>${esc(a.question_title)}</dt><dd>${esc(show(a.value))}</dd>`).join('')}</dl>
    <div class="row">
      <label class="inline">处理状态
        <select id="d-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === s.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </label>
    </div>
    <label class="muted" for="d-note">内部备注</label>
    <textarea id="d-note" maxlength="5000">${esc(s.note)}</textarea>
    <div class="row">
      <button class="primary" id="d-save">保存</button>
      <button id="d-export">导出这个人</button>
    </div>`;
  $('#d-close').onclick = () => { el.hidden = true; state.openId = null; renderRecords(); };
  $('#d-export').onclick = () => { window.location.href = `/api/admin/export?scope=one&id=${s.id}`; };
  $('#d-save').onclick = async () => {
    try {
      const updated = await api(`submissions/${s.id}`, {
        method: 'PATCH',
        body: { status: $('#d-status').value, note: $('#d-note').value },
      });
      const row = state.submissions.find((x) => x.id === s.id);
      if (row) row.status = updated.status;
      renderRecords();
      toast('已保存');
    } catch (err) {
      toast(err.message);
    }
  };
  renderRecords();
}

let searchTimer;
$('#f-q').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadRecords, 300); };
['#f-status', '#f-path', '#f-from', '#f-to'].forEach((id) => { $(id).onchange = loadRecords; });
$('#export-all').onclick = () => {
  const params = filterParams();
  params.set('scope', 'all');
  window.location.href = `/api/admin/export?${params}`;
};
$('#f-status').innerHTML += Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

// ---------------------------------------------------------------- 题库与问卷

// 问卷是一张“节点和线”的图。每一项（节点）是某道题的一次出现，同一道题可以出现多次。
//   next   这一项的默认去向：另一项的 id，或 'end'（去确认提交）
//   routes 单选题里，个别选项自己的去向：{ 选项值: 另一项的 id 或 'end' }
// 列表里的第一项是起点。走法只有一条规则：选项有自己的线就走那条，否则走默认的线。
const START = 'start';
const END = 'end';
const cleanItem = (i) => ({ id: i.id, question_id: i.question_id, next: i.next, routes: { ...(i.routes || {}) } });
const newId = () => `i${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;
const itemById = (id) => state.items.find((i) => i.id === id);
const qOf = (item) => byId(item?.question_id);
const usage = (questionId) => state.items.filter((i) => i.question_id === questionId).length;
const startId = () => state.items[0]?.id ?? END;
const EDGE_COLORS = ['#d84180', '#2f7fd1', '#1d9e75', '#e08a1e', '#7f5ad6', '#c0392b', '#0f8b8d', '#9a7b12'];
const DEFAULT_COLOR = '#8a8a95';

async function loadBank() {
  try {
    const data = await api('questions');
    state.questions = data.questions;
    state.items = data.items.map(cleanItem);
    state.savedItems = JSON.stringify(state.items);
    resetTimeline();
    const path = byKey('path');
    const current = $('#f-path').value;
    $('#f-path').innerHTML = '<option value="">全部方向</option>' +
      (path ? path.options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('') : '');
    $('#f-path').value = current;
    renderBank();
  } catch (err) {
    toast(err.message);
  }
}

// ---- 历史记录 ----
// 每一步改动后的样子都留着，不会因为撤销后又做了新改动而丢掉。
// 每条记录记着它是从哪一条改出来的（parent），所以撤销总是回到“改之前”的那一条。
let timeline = [];   // [{ items, label, time, parent, redo }]
let cursor = 0;      // 现在显示的是第几条
let savedAt = 0;     // 数据库里保存的是第几条
let sel = null;      // 选中的东西：{ type:'exit', src, key } 或 { type:'node', id }
let drawn = { edges: [] };

function resetTimeline() {
  timeline = [{ items: JSON.stringify(state.items), label: '打开时的问卷', time: Date.now(), parent: null }];
  cursor = 0;
  savedAt = 0;
  sel = null;
}

// 所有对流程的修改都经过这里，这样才能撤销，也才会出现在历史记录里。
function change(label, fn) {
  const before = JSON.stringify(state.items);
  fn();
  repair();
  sortItems();
  const after = JSON.stringify(state.items);
  if (after !== before) {
    timeline.push({ items: after, label, time: Date.now(), parent: cursor });
    cursor = timeline.length - 1;
  }
  renderBank();
}

function goTo(index) {
  if (index === cursor || !timeline[index]) return;
  cursor = index;
  state.items = JSON.parse(timeline[index].items);
  sel = null;
  renderBank();
}

function redoTarget() {
  const entry = timeline[cursor];
  if (entry.redo !== undefined) return entry.redo;
  for (let i = timeline.length - 1; i > cursor; i--) if (timeline[i].parent === cursor) return i;
  return null;
}

function undo() {
  const parent = timeline[cursor].parent;
  if (parent === null) return;
  timeline[parent].redo = cursor;
  goTo(parent);
}

function redo() {
  const target = redoTarget();
  if (target !== null) goTo(target);
}

function renderHistory() {
  const onPath = new Set();
  for (let i = cursor; i !== null; i = timeline[i].parent) onPath.add(i);
  const clock = (t) => new Date(t).toLocaleTimeString('zh-CN', { hour12: false });
  $('#history-count').textContent = timeline.length - 1;
  $('#history-list').innerHTML = timeline.map((entry, i) => `
    <button class="h-item ${i === cursor ? 'current' : ''} ${onPath.has(i) ? '' : 'aside'}" data-step="${i}" ${i === cursor ? 'aria-current="step"' : ''}>
      <span class="h-label">${i === 0 ? '' : `${i}. `}${esc(entry.label)}</span>
      <span class="h-meta">${clock(entry.time)}${i === savedAt ? ' · 已保存' : ''}${i === cursor ? ' · 现在' : onPath.has(i) ? '' : ' · 已撤销'}</span>
    </button>`).reverse().join('');
}

// ---- 图的基本操作 ----

// 一项伸出去的线。单选题：每个有自己去向的选项一条；还有选项没有自己的线时，再加一条默认的线。
function exitsOf(item) {
  const q = qOf(item);
  const list = [];
  const single = q?.type === 'single';
  if (single) {
    q.options.forEach((o, i) => {
      if (item.routes[o.value] !== undefined) {
        list.push({ src: item.id, key: o.value, label: o.label, target: item.routes[o.value], color: EDGE_COLORS[i % EDGE_COLORS.length], row: i });
      }
    });
  }
  if (!single || q.options.some((o) => item.routes[o.value] === undefined)) {
    list.push({ src: item.id, key: 'default', label: single ? '其余选项' : '', target: item.next, color: DEFAULT_COLOR, row: -1 });
  }
  return list;
}

const targetOf = (src, key) => {
  if (src === START) return startId();
  const item = itemById(src);
  return key === 'default' ? item.next : (item.routes[key] ?? item.next);
};

// 从某一项出发，顺着线能走到的所有项。
function reachFrom(id, seen = new Set()) {
  if (id === END || seen.has(id)) return seen;
  const item = itemById(id);
  if (!item) return seen;
  seen.add(id);
  for (const target of [item.next, ...Object.values(item.routes)]) reachFrom(target, seen);
  return seen;
}

// 这条线能不能连到 target：不能连自己，不能连成圈。
function canConnect(src, target) {
  if (src === START) return target !== END;
  if (target === END) return true;
  return target !== src && !reachFrom(target).has(src);
}

function setTarget(src, key, target) {
  if (src === START) {
    const item = itemById(target);
    state.items = [item, ...state.items.filter((i) => i !== item)];
    return;
  }
  const item = itemById(src);
  if (key === 'default') item.next = target;
  else item.routes[key] = target;
  for (const [value, t] of Object.entries(item.routes)) if (t === item.next) delete item.routes[value];
}

// 在一条线上加一道题：线先到新题，新题再去这条线原来去的地方。
function insertOn(src, key, questionId) {
  const node = { id: newId(), question_id: questionId, next: targetOf(src, key), routes: {} };
  if (src === START) state.items.unshift(node);
  else { state.items.push(node); setTarget(src, key, node.id); }
  return node;
}

// 把一项移出流程：原来连到它的线，改连到它的默认去向。
function removeNode(id) {
  const gone = itemById(id);
  const wasFirst = state.items[0] === gone;
  state.items = state.items.filter((i) => i !== gone);
  for (const item of state.items) {
    if (item.next === id) item.next = gone.next;
    for (const value of Object.keys(item.routes)) if (item.routes[value] === id) item.routes[value] = gone.next;
  }
  if (wasFirst && itemById(gone.next)) setTarget(START, 'start', gone.next);
}

// 题目的选项改过之后，清掉对应不上的线；指向不存在位置的线改去确认提交。
function repair() {
  const ids = new Set(state.items.map((i) => i.id));
  for (const item of state.items) {
    const q = qOf(item);
    if (!ids.has(item.next)) item.next = END;
    for (const [value, target] of Object.entries(item.routes)) {
      const valid = q?.type === 'single' && q.options.some((o) => o.value === value);
      if (!valid || target === item.next) delete item.routes[value];
      else if (target !== END && !ids.has(target)) item.routes[value] = END;
    }
  }
}

// ---- 排版 ----
// 自动排版：从“开始”往下分层，一项排在所有连到它的项的下面一层；同一层从左到右排开。
const NODE_W = 250;
const GAP_X = 64;
const ROW_H = 30;

// 量一下标题有多宽，决定它占一行还是两行（格子的高度要提前算好，线才能对准）。
const ruler = document.createElement('canvas').getContext('2d');
function titleWidth(text) {
  ruler.font = `500 14px ${getComputedStyle(document.body).fontFamily}`;
  return ruler.measureText(text).width;
}

function nodeSize(item) {
  const q = qOf(item);
  const lines = titleWidth(q?.title || '') + 27 > NODE_W - 26 ? 2 : 1; // 27 = 题号圆点占的宽度
  const head = 38 + lines * 20;
  const rows = q?.type === 'single' ? q.options.length : 0;
  return { w: NODE_W, h: head + rows * ROW_H + 16, head };
}

function layout() {
  const reachable = [...reachFrom(startId())];
  const edges = [{ src: START, key: 'start', label: '', target: startId(), color: DEFAULT_COLOR, row: -1 }];
  for (const id of reachable) edges.push(...exitsOf(itemById(id)));

  // 分层：一项的层数 = 连到它的项里最深的一层 + 1
  const layerOf = new Map([[START, 0]]);
  const order = [];
  const seen = new Set();
  const visit = (id) => {
    if (id === END || seen.has(id)) return;
    seen.add(id);
    for (const e of exitsOf(itemById(id))) visit(e.target);
    order.push(id);
  };
  visit(startId());
  order.reverse();
  for (const id of order) if (!layerOf.has(id)) layerOf.set(id, 1);
  for (const id of order) {
    for (const e of exitsOf(itemById(id))) {
      if (e.target !== END) layerOf.set(e.target, Math.max(layerOf.get(e.target), layerOf.get(id) + 1));
    }
  }
  const lastLayer = Math.max(0, ...layerOf.values()) + 1;
  layerOf.set(END, lastLayer);

  const boxes = new Map([[START, { w: 84, h: 32 }], [END, { w: 190, h: 34 }]]);
  for (const id of order) boxes.set(id, nodeSize(itemById(id)));
  const layers = Array.from({ length: lastLayer + 1 }, () => []);
  layers[0].push(START);
  for (const id of order) layers[layerOf.get(id)].push(id);
  layers[lastLayer].push(END);

  // 横向：尽量排在连到它的项的正下方，挤在一起时向右让开
  const incoming = new Map();
  for (const e of edges) { if (!incoming.has(e.target)) incoming.set(e.target, []); incoming.get(e.target).push(e); }
  const cx = new Map([[START, 0]]);
  for (let l = 1; l <= lastLayer; l++) {
    const want = layers[l].map((id) => {
      const from = (incoming.get(id) || []).map((e) => cx.get(e.src)).filter((v) => v !== undefined);
      return { id, x: from.length ? from.reduce((a, b) => a + b, 0) / from.length : 0 };
    }).sort((a, b) => a.x - b.x);
    let prev = null;
    const placed = want.map((n) => {
      const min = prev ? prev.x + (boxes.get(prev.id).w + boxes.get(n.id).w) / 2 + GAP_X : -Infinity;
      prev = { id: n.id, x: Math.max(n.x, min) };
      return prev;
    });
    const shift = want.reduce((a, n) => a + n.x, 0) / want.length - placed.reduce((a, n) => a + n.x, 0) / placed.length;
    placed.forEach((n) => cx.set(n.id, n.x + shift));
    layers[l] = placed.map((n) => n.id);
  }

  // 每条线在层与层之间的空隙里占一条“车道”，互相错开
  const gapLanes = Array.from({ length: lastLayer + 1 }, () => 0);
  let channels = 0;
  for (const e of edges) {
    e.sl = layerOf.get(e.src);
    e.tl = layerOf.get(e.target);
    e.laneA = gapLanes[e.sl]++;
    if (e.tl > e.sl + 1) { e.laneB = gapLanes[e.tl - 1]++; e.channel = channels++; }
  }

  // 纵向
  const top = [];
  const bottom = [];
  let y = 16;
  for (let l = 0; l <= lastLayer; l++) {
    top[l] = y;
    bottom[l] = y + Math.max(...layers[l].map((id) => boxes.get(id).h));
    y = bottom[l] + 40 + gapLanes[l] * 9;
  }

  const minLeft = Math.min(...[...cx].map(([id, x]) => x - boxes.get(id).w / 2));
  const pos = new Map();
  for (const [id, x] of cx) {
    const box = boxes.get(id);
    pos.set(id, { ...box, x: x - box.w / 2 - minLeft + 24, y: top[layerOf.get(id)], layer: layerOf.get(id) });
  }
  const maxRight = Math.max(...[...pos.values()].map((p) => p.x + p.w)) + 12 + 4 * 9;

  // 线的走法：出口 → 向下到空隙里的车道 → 横着走 → 向下进入目标。隔了几层的线从右侧绕过去。
  const stubs = new Map();
  const entries = new Map();
  for (const e of edges) {
    const s = pos.get(e.src);
    const t = pos.get(e.target);
    const into = incoming.get(e.target);
    const tx = t.x + t.w / 2 + (into.indexOf(e) - (into.length - 1) / 2) * 12;
    const laneY = bottom[e.sl] + 16 + e.laneA * 9;
    const points = [];
    if (e.row >= 0) {
      const n = stubs.get(e.src) || 0;
      stubs.set(e.src, n + 1);
      const py = s.y + s.head + e.row * ROW_H + ROW_H / 2;
      const sx = s.x + s.w + 12 + (n % 4) * 9;
      points.push([s.x + s.w, py], [sx, py], [sx, laneY]);
    } else {
      points.push([s.x + s.w / 2, s.y + s.h], [s.x + s.w / 2, laneY]);
    }
    if (e.channel !== undefined) {
      const chX = maxRight + 16 + e.channel * 11;
      const laneY2 = bottom[e.tl - 1] + 16 + e.laneB * 9;
      points.push([chX, laneY], [chX, laneY2], [tx, laneY2]);
    } else {
      points.push([tx, laneY]);
    }
    points.push([tx, t.y]);
    e.points = points;
    entries.set(e, tx);
  }
  const width = Math.max(maxRight, ...edges.flatMap((e) => e.points.map((p) => p[0]))) + 24;
  return { pos, edges, order, width, height: bottom[lastLayer] + 20 };
}

// 保存和编号用的顺序：起点在最前，其余按图上从上到下、从左到右；没有线连到的排在最后。
function sortItems() {
  if (!state.items.length) return;
  const { pos, order } = layout();
  const rank = (id) => (pos.has(id) ? pos.get(id).layer * 1e6 + pos.get(id).x : Infinity);
  const first = state.items[0];
  const reachable = order.map(itemById).sort((a, b) => rank(a.id) - rank(b.id));
  const orphans = state.items.filter((i) => !pos.has(i.id));
  state.items = [first, ...reachable.filter((i) => i !== first), ...orphans];
}

// ---- 画面 ----

const numberOf = (id) => state.items.findIndex((i) => i.id === id) + 1;
const nameOf = (id) => (id === END ? '确认隐私说明并提交' : id === START ? '开始' : `第 ${numberOf(id)} 题“${qOf(itemById(id))?.title}”`);
const sameExit = (e) => sel?.type === 'exit' && sel.src === e.src && (sel.key === e.key || (e.key === 'default' && sel.key !== 'start' && e.src !== START && itemById(e.src)?.routes[sel.key] === undefined));

function renderFlow() {
  if (!timeline.length) return; // 题库还没读出来
  const { pos, edges, width, height } = layout();
  drawn = { edges };
  const reachable = new Set(pos.keys());
  const picking = sel?.type === 'exit';
  const lit = (e) => {
    if (!sel) return true;
    if (sel.type === 'exit') return sameExit(e);
    return e.src === sel.id || e.target === sel.id;
  };
  const selectedEdge = picking ? edges.find(sameExit) : null;

  const lines = edges.map((e, i) => {
    const d = e.points.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const [ax, ay] = e.points[e.points.length - 1];
    const on = lit(e);
    return `<g class="edge ${on ? '' : 'dim'} ${sel && on ? 'lit' : ''}" data-edge="${i}">
      <path d="${d}" fill="none" stroke="${e.color}" stroke-width="${sel && on ? 3.5 : 2}" stroke-linejoin="round" stroke-linecap="round"/>
      <polygon points="${ax - 5},${ay - 8} ${ax + 5},${ay - 8} ${ax},${ay}" fill="${e.color}"/>
      <path class="hit" d="${d}" fill="none" stroke="transparent" stroke-width="14"/>
    </g>`;
  }).join('');

  const targetClass = (id) => {
    if (!picking) return '';
    if (selectedEdge?.target === id) return 'goal';
    return canConnect(sel.src, id) ? 'can' : 'cannot';
  };

  const nodes = [...pos].map(([id, p]) => {
    const style = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px`;
    if (id === START) {
      return `<div class="gpill" style="${style}">开始<button class="port bottom ${sel?.src === START ? 'on' : ''}" data-exit="${START}|start" title="起点的线" aria-label="起点的线"></button></div>`;
    }
    if (id === END) return `<div class="gpill end ${targetClass(END)}" style="${style}" data-node="${END}">确认隐私说明并提交</div>`;
    const item = itemById(id);
    const q = qOf(item);
    const single = q.type === 'single';
    const used = usage(q.id);
    const hasDefault = !single || q.options.some((o) => item.routes[o.value] === undefined);
    const picked = sel?.type === 'node' && sel.id === id;
    return `<div class="gnode ${picked ? 'selected' : ''} ${targetClass(id)}" style="${style}" data-node="${id}" tabindex="0">
      <div class="g-head" style="height:${p.head}px">
        <div class="g-title"><span class="num">${numberOf(id)}</span>${esc(q.title)}</div>
        <div class="g-meta">${TYPE[q.type]}${q.type === 'info' ? '' : q.required ? ' · 必填' : ' · 可跳过'}${used > 1 ? ` · <span class="uses">共 ${used} 处</span>` : ''}</div>
      </div>
      ${single ? q.options.map((o, i) => {
        const own = item.routes[o.value] !== undefined;
        const on = sel?.type === 'exit' && sel.src === id && sel.key === o.value;
        return `<div class="g-opt ${on ? 'on' : ''}" data-exit="${id}|${esc(o.value)}" title="点一下选中这个选项的线">
          <span class="g-lab">${esc(o.label)}</span>
          <span class="port ${own ? 'own' : ''} ${on ? 'on' : ''}" style="--c:${EDGE_COLORS[i % EDGE_COLORS.length]}"></span>
        </div>`;
      }).join('') : ''}
      ${hasDefault ? `<button class="port bottom ${sel?.type === 'exit' && sel.src === id && sel.key === 'default' ? 'on' : ''}" data-exit="${id}|default" title="${single ? '其余选项的线' : '这道题的线'}" aria-label="这道题的线"></button>` : ''}
    </div>`;
  }).join('');

  $('#flow').style.width = `${width}px`;
  $('#flow').style.height = `${height}px`;
  $('#flow').innerHTML = `<svg width="${width}" height="${height}" aria-hidden="true">${lines}</svg>${nodes}`;

  const orphans = state.items.filter((i) => !reachable.has(i.id));
  $('#orphans').hidden = !orphans.length;
  $('#orphans').innerHTML = orphans.length ? `<div class="group">没有线连到的题（不会被问到）· 选中一条线后点这里的题，可以把线连过来</div>
    <div class="orphan-list">${orphans.map((item) => `<div class="gnode loose ${sel?.type === 'node' && sel.id === item.id ? 'selected' : ''} ${targetClass(item.id)}" data-node="${item.id}" tabindex="0">
      <div class="g-title">${esc(qOf(item)?.title)}</div><div class="g-meta">${TYPE[qOf(item)?.type]}</div></div>`).join('')}</div>` : '';

  renderBar();
  $('#undo').disabled = timeline[cursor].parent === null;
  $('#redo').disabled = redoTarget() === null;
  renderHistory();
}

// 流程图上方的一条：说明现在选中了什么，以及能做什么。
function renderBar() {
  const bar = $('#flow-bar');
  if (!sel) {
    bar.innerHTML = '<span class="muted">点一条线或一个选项，可以看它去哪、改它的去向，或在这条线上加一道题。点一道题可以编辑或移出。</span>';
    return;
  }
  if (sel.type === 'node') {
    const item = itemById(sel.id);
    bar.innerHTML = `<strong>${esc(numberOf(sel.id) && drawnHas(sel.id) ? `第 ${numberOf(sel.id)} 题` : '未连线的题')}“${esc(qOf(item)?.title)}”</strong>
      <span class="grow"></span>
      <button class="small" data-bar="edit">编辑题目</button>
      <button class="small" data-bar="remove">移出流程</button>
      <button class="small" data-bar="clear">取消选中</button>`;
    return;
  }
  const item = sel.src === START ? null : itemById(sel.src);
  const q = qOf(item);
  const own = item && sel.key !== 'default' && item.routes[sel.key] !== undefined;
  const label = sel.src === START ? '开始'
    : sel.key === 'default' ? `第 ${numberOf(sel.src)} 题${q.type === 'single' ? ' · 其余选项' : ''}`
      : `第 ${numberOf(sel.src)} 题 · 选“${q.options.find((o) => o.value === sel.key)?.label}”`;
  const follows = item && sel.key !== 'default' && !own;
  bar.innerHTML = `<strong>${esc(label)}</strong>
    <span class="arrow-to">→</span>
    <strong>${esc(nameOf(targetOf(sel.src, sel.key)))}</strong>
    ${follows ? '<span class="muted">（没有自己的线，跟着“其余选项”走）</span>' : ''}
    <span class="grow"></span>
    <span class="muted">点任意一个亮着的格子，把线改连过去</span>
    <button class="small primary" data-bar="insert">在这条线上加一道题</button>
    ${own ? '<button class="small" data-bar="unroute">去掉这条线，跟其余选项走</button>' : ''}
    <button class="small" data-bar="clear">取消选中</button>`;
}

const drawnHas = (id) => reachFrom(startId()).has(id);

function pickable() {
  return state.questions.filter((q) => !q.archived_at).sort((a, b) => usage(a.id) - usage(b.id));
}

const usageText = (q) => (usage(q.id) ? `已用 ${usage(q.id)} 次` : '没用过');

function insertDialog() {
  const list = pickable();
  if (!list.length) return toast('题库里还没有题。先点右上角“新建题目”。');
  const { src, key } = sel;
  openDialog(`<form class="form" id="pick-form">
    <h2>在这条线上加一道题</h2>
    <p class="muted">线会先到新加的这道题，再去“${esc(nameOf(targetOf(src, key)))}”。</p>
    <div class="checks pick">${list.map((q, i) => `
      <label><input type="radio" name="question" value="${q.id}" ${i === 0 ? 'checked' : ''}>${esc(q.title)}<span class="muted">${TYPE[q.type]} · ${usageText(q)}</span></label>`).join('')}</div>
    <p class="help">同一道题可以放在多个位置，走到哪个位置就在哪里问。</p>
    <div class="buttons"><button type="button" id="pick-cancel">取消</button><button class="primary">加进去</button></div>
  </form>`);
  $('#pick-cancel').onclick = closeDialog;
  $('#pick-form').onsubmit = (e) => {
    e.preventDefault();
    const questionId = e.target.elements.question.value;
    closeDialog();
    change(`在“${exitName(src, key)}”的线上加入“${byId(questionId).title}”`, () => {
      const node = insertOn(src, key, questionId);
      sel = { type: 'node', id: node.id };
    });
  };
}

function exitName(src, key) {
  if (src === START) return '开始';
  const q = qOf(itemById(src));
  if (key === 'default') return q.title;
  return `${q.title} · ${q.options.find((o) => o.value === key)?.label}`;
}

function connectTo(target) {
  const { src, key } = sel;
  if (targetOf(src, key) === target) return;
  if (!canConnect(src, target)) {
    return toast(target === src ? '不能连到它自己。' : src === START ? '起点必须连到一道题。' : '不能这样连：这条线会绕回到前面的题，形成一个圈。');
  }
  change(`把“${exitName(src, key)}”的线连到${nameOf(target)}`, () => setTarget(src, key, target));
}

$('#flow-bar').onclick = (e) => {
  const act = e.target.closest('[data-bar]')?.dataset.bar;
  if (!act) return;
  if (act === 'clear') { sel = null; return renderFlow(); }
  if (act === 'insert') return insertDialog();
  if (act === 'edit') return editQuestion(qOf(itemById(sel.id)));
  if (act === 'unroute') {
    const { src, key } = sel;
    return change(`去掉“${exitName(src, key)}”自己的线`, () => { delete itemById(src).routes[key]; });
  }
  if (act === 'remove') {
    const id = sel.id;
    const title = qOf(itemById(id))?.title;
    if (state.items.length === 1) return toast('问卷里至少要留一道题。');
    sel = null;
    change(`移出“${title}”`, () => removeNode(id));
  }
};

function flowClick(e) {
  const exit = e.target.closest('[data-exit]');
  if (exit) {
    const [src, key] = [exit.dataset.exit.slice(0, exit.dataset.exit.indexOf('|')), exit.dataset.exit.slice(exit.dataset.exit.indexOf('|') + 1)];
    sel = sel?.type === 'exit' && sel.src === src && sel.key === key ? null : { type: 'exit', src, key };
    return renderFlow();
  }
  const edge = e.target.closest('[data-edge]');
  if (edge) {
    const hit = drawn.edges[Number(edge.dataset.edge)];
    sel = sel?.type === 'exit' && sel.src === hit.src && sel.key === hit.key ? null : { type: 'exit', src: hit.src, key: hit.key };
    return renderFlow();
  }
  const node = e.target.closest('[data-node]');
  if (node) {
    const id = node.dataset.node;
    if (sel?.type === 'exit') return connectTo(id);
    if (id === END) return;
    sel = sel?.type === 'node' && sel.id === id ? null : { type: 'node', id };
    return renderFlow();
  }
  if (sel) { sel = null; renderFlow(); }
}
$('#flow').onclick = flowClick;
$('#orphans').onclick = flowClick;
$('#flow').onkeydown = (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.gnode')) { e.preventDefault(); e.target.click(); }
};
$('#undo').onclick = undo;
$('#redo').onclick = redo;
$('#history-toggle').onclick = () => { $('#history').hidden = !$('#history').hidden; };
$('#history-list').onclick = (e) => {
  const step = e.target.closest('[data-step]');
  if (step) goTo(Number(step.dataset.step));
};
document.addEventListener('keydown', (e) => {
  if ($('#bank-tab').hidden || $('#dialog').open || e.target.matches?.('input, textarea, select')) return;
  if (e.key === 'Escape' && sel) { sel = null; return renderFlow(); }
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
  e.preventDefault();
  if (e.shiftKey) redo(); else undo();
});

function renderBank() {
  renderFlow();
  const search = $('#b-q').value.trim().toLowerCase();
  const type = $('#b-type').value;
  const match = (q) => (!type || q.type === type) && (!search || q.title.toLowerCase().includes(search));

  const row = (q) => {
    const used = usage(q.id);
    return `
    <div class="q ${used ? '' : 'off'} ${q.archived_at ? 'archived' : ''}" data-id="${q.id}">
      <div class="main">
        <div class="title">${esc(q.title)}</div>
        <div class="meta">
          <span class="used ${used ? 'on' : ''}">${q.archived_at ? '已归档' : usageText(q)}</span>
          <span>${TYPE[q.type]}</span><code>${esc(q.field_key)}</code><span>${q.type === 'info' ? '' : q.required ? '必填' : '可跳过'}</span>
        </div>
      </div>
      <div class="ops">
        ${q.archived_at ? '<button class="small" data-act="restore">恢复</button>'
          : `<button class="small" data-act="edit">编辑</button>${used ? '' : '<button class="small" data-act="archive">归档</button>'}`}
      </div>
    </div>`;
  };

  const active = state.questions.filter((q) => !q.archived_at && match(q));
  const archived = $('#b-archived').checked ? state.questions.filter((q) => q.archived_at && match(q)) : [];
  $('#bank').innerHTML =
    `<div class="group">题库（${active.length} 道）· 要把题放进流程：先点流程图里的一条线，再点“在这条线上加一道题”</div>` +
    (active.map(row).join('') || '<p class="muted pad">没有符合条件的题。</p>') +
    (archived.length ? `<div class="group">已归档（${archived.length} 道）</div>${archived.map(row).join('')}` : '');

  const dirty = JSON.stringify(state.items) !== state.savedItems;
  $('#dirty').hidden = !dirty;
  $('#save-form').disabled = !dirty;

  document.querySelectorAll('#bank [data-act]').forEach((el) => {
    el.onclick = () => bankAction(el.dataset.act, el.closest('.q').dataset.id);
  });
}

async function bankAction(act, id) {
  if (act === 'edit') return editQuestion(byId(id));
  try {
    const updated = await api(`questions/${id}`, { method: 'PATCH', body: { archived: act === 'archive' } });
    Object.assign(byId(id), updated);
    toast(act === 'archive' ? '已归档，旧的填写记录不受影响。' : '已恢复到题库。');
  } catch (err) {
    toast(err.message);
  }
  renderBank();
}

function optionRow(option, multi) {
  return `<div class="opt" data-value="${esc(option.value || '')}">
    <input name="label" placeholder="选项文字" value="${esc(option.label || '')}" maxlength="100" aria-label="选项文字">
    <select name="icon" aria-label="图标">${Object.entries(ICONS).map(([k, v]) => `<option value="${k}" ${k === (option.icon || '') ? 'selected' : ''}>${v}</option>`).join('')}</select>
    ${multi ? `<label title="选了它就不能再选别的，比如“暂不确定”"><input type="checkbox" name="exclusive" ${option.exclusive ? 'checked' : ''}>互斥</label>` : '<span></span>'}
    <button type="button" class="small" data-remove aria-label="删除这个选项">删除</button>
  </div>`;
}

function editQuestion(q) {
  const creating = !q;
  const draw = (type) => {
    const choice = type === 'single' || type === 'multi';
    const text = ['short_text', 'long_text', 'email', 'phone'].includes(type);
    const options = q?.options?.length ? q.options : [{}, {}];
    openDialog(`
      <form class="form" id="q-form">
        <h2>${creating ? '新建题目' : '编辑题目'}</h2>
        ${creating ? `<div class="two">
          <label>题型<select name="type">${Object.entries(TYPE).map(([k, v]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>字段名<input name="field_key" pattern="[a-z][a-z0-9_]{0,39}" required placeholder="例如 expiry_date"></label>
        </div><p class="help">字段名是这道题在导出表格里的固定标识，只能用小写英文、数字和下划线。题型和字段名建好后不能再改。</p>`
        : `<p class="muted">${TYPE[type]} · 字段名 ${esc(q.field_key)}</p>`}
        <label>题目文字<input name="title" required maxlength="500" value="${esc(q?.title)}"></label>
        <label>提示语（题目下方的小字，可不填）<input name="hint" maxlength="500" value="${esc(q?.hint)}"></label>
        <label>承接语（显示在这道题之前的一句话，可不填）<input name="reply" maxlength="500" value="${esc(q?.reply)}"></label>
        ${text || type === 'date' ? `<div class="two">
          <label>输入框里的示例文字<input name="placeholder" maxlength="200" value="${esc(q?.placeholder)}"></label>
          ${text ? `<label>字数上限<input name="max_length" type="number" min="1" max="5000" value="${q?.max_length ?? (type === 'long_text' ? 2000 : 200)}"></label>` : '<span></span>'}
        </div>` : ''}
        ${type === 'info' ? '' : `<label class="inline"><input type="checkbox" name="required" ${q ? (q.required ? 'checked' : '') : 'checked'}> 必填</label>`}
        ${choice ? `<div><span class="muted">选项</span><div id="opts">${options.map((o) => optionRow(o, type === 'multi')).join('')}</div>
          <button type="button" class="small" id="add-opt">添加选项</button></div>` : ''}
        <p class="error" id="q-error"></p>
        <div class="buttons"><button type="button" id="q-cancel">取消</button><button class="primary">保存</button></div>
      </form>`);
    const form = $('#q-form');
    if (creating) form.elements.type.onchange = () => draw(form.elements.type.value);
    $('#q-cancel').onclick = closeDialog;
    if (choice) {
      $('#add-opt').onclick = () => $('#opts').insertAdjacentHTML('beforeend', optionRow({}, type === 'multi'));
      $('#opts').onclick = (e) => { if (e.target.matches('[data-remove]')) e.target.closest('.opt').remove(); };
    }
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = { title: form.elements.title.value, hint: form.elements.hint.value, reply: form.elements.reply.value };
      if (form.elements.placeholder) body.placeholder = form.elements.placeholder.value;
      if (form.elements.max_length) body.max_length = Number(form.elements.max_length.value);
      if (form.elements.required) body.required = form.elements.required.checked;
      if (creating) { body.type = type; body.field_key = form.elements.field_key.value.trim(); }
      if (choice) {
        body.options = [...form.querySelectorAll('.opt')].map((el) => ({
          label: el.querySelector('[name=label]').value.trim(),
          value: el.dataset.value || undefined,
          icon: el.querySelector('[name=icon]').value || undefined,
          exclusive: el.querySelector('[name=exclusive]')?.checked || undefined,
        })).filter((o) => o.label);
      }
      try {
        if (creating) {
          state.questions.push(await api('questions', { method: 'POST', body }));
          toast('已加入题库。在流程图里点一条线，再点“在这条线上加一道题”，就能把它放进去。');
        } else {
          Object.assign(q, await api(`questions/${q.id}`, { method: 'PATCH', body }));
          toast('已保存，前台立即生效。');
        }
        closeDialog();
        // 选项改了以后，原来从这个选项伸出去的线可能对应不上；清掉时也记进历史记录。
        change('题目选项变了，清掉对应不上的线', () => {});
      } catch (err) {
        $('#q-error').textContent = err.message;
      }
    };
  };
  draw(q?.type || 'single');
}

$('#new-question').onclick = () => editQuestion(null);
$('#b-q').oninput = renderBank;
$('#b-type').onchange = renderBank;
$('#b-archived').onchange = renderBank;
$('#b-type').innerHTML += Object.entries(TYPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

$('#save-form').onclick = async () => {
  if (!state.items.length) return toast('问卷里至少要有一道题。');
  try {
    const data = await api('form', { method: 'PUT', body: { items: state.items } });
    state.items = data.items.map(cleanItem);
    state.savedItems = JSON.stringify(state.items);
    timeline[cursor].items = state.savedItems;
    savedAt = cursor;
    renderBank();
    toast('问卷已保存，前台已更新。');
  } catch (err) {
    toast(err.message);
  }
};

window.addEventListener('beforeunload', (e) => {
  if (JSON.stringify(state.items) !== state.savedItems) e.preventDefault();
});

// ---------------------------------------------------------------- 启动

(async () => {
  try {
    const res = await fetch('/api/admin/me');
    if (!res.ok) return showLogin();
    await enter((await res.json()).email);
  } catch {
    showLogin();
  }
})();
