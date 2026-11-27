// 后端函数共用的工具：响应、Supabase 访问、登录校验、问卷校验、CSV。
// 这个文件不在 functions/ 目录里，所以不会被当成一个网址。

export const CONSENT_VERSION = '2026-11-v1';
export const TYPES = ['single', 'multi', 'short_text', 'long_text', 'email', 'phone', 'date', 'info'];
export const STATUSES = ['pending', 'contacted', 'signed', 'closed'];
export const STATUS_LABELS = { pending: '待联系', contacted: '已联系', signed: '已签约', closed: '不合适' };

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

// 把一个处理函数包起来：统一把错误变成 JSON 响应。
export function handle(fn) {
  return async (context) => {
    try {
      return await fn(context);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, ...err.extra }, err.status);
      console.error(err);
      return json({ error: '服务器出了点问题，请稍后再试。' }, 500);
    }
  };
}

export async function readJson(request, maxBytes = 100_000) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) {
    throw new HttpError(415, '请求格式不正确。');
  }
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, '提交的内容太长了。');
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new HttpError(400, '请求格式不正确。');
  }
}

// ---------------------------------------------------------------- Supabase

function config(env) {
  const url = (env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new HttpError(500, '后端还没有配置数据库地址和密钥。');
  return { url, key };
}

// 新版密钥（sb_secret_ 开头）只能放在 apikey 头里；旧版 service_role 密钥两个头都要带。
function keyHeaders(key, userToken) {
  const headers = { apikey: key };
  if (userToken) headers.Authorization = `Bearer ${userToken}`;
  else if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

export async function rest(env, path, { method = 'GET', body, prefer } = {}) {
  const { url, key } = config(env);
  const headers = keyHeaders(key);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('Supabase REST error', res.status, path.split('?')[0], text.slice(0, 500));
    throw new HttpError(502, '数据库暂时无法访问，请稍后再试。');
  }
  return text ? JSON.parse(text) : null;
}

export const rpc = (env, name, args) => rest(env, `rpc/${name}`, { method: 'POST', body: args });

async function auth(env, path, { method = 'GET', body, token } = {}) {
  const { url, key } = config(env);
  const headers = keyHeaders(key, token);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${url}/auth/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }
  return { ok: res.ok, status: res.status, data };
}

// ---------------------------------------------------------------- 管理员登录

const COOKIE_PATH = '/api/admin';
const ACCESS = 'sf_at';
const REFRESH = 'sf_rt';

function adminEmails(env) {
  return (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function isAdmin(env, user) {
  const email = (user?.email || '').toLowerCase();
  return Boolean(email && user.email_confirmed_at && adminEmails(env).includes(email));
}

export function readCookies(request) {
  const out = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function sessionCookies(session) {
  return [
    cookie(ACCESS, session.access_token, session.expires_in || 3600),
    cookie(REFRESH, session.refresh_token, 60 * 60 * 24 * 30),
  ];
}

export const clearCookies = () => [cookie(ACCESS, '', 0), cookie(REFRESH, '', 0)];

export async function login(env, email, password) {
  if (!adminEmails(env).length) throw new HttpError(500, '后端还没有配置管理员邮箱。');
  const res = await auth(env, 'token?grant_type=password', { method: 'POST', body: { email, password } });
  // 不区分“密码错”和“不是管理员”，避免泄露哪些邮箱存在。
  if (!res.ok || !res.data?.access_token || !isAdmin(env, res.data.user)) {
    throw new HttpError(401, '邮箱或密码不正确。');
  }
  return res.data;
}

export async function logout(env, request) {
  const token = readCookies(request)[ACCESS];
  if (token) await auth(env, 'logout', { method: 'POST', token }).catch(() => {});
}

// 返回 { email, cookies }；cookies 非空表示登录状态刚被续期，需要写回浏览器。
export async function requireAdmin(env, request) {
  const jar = readCookies(request);
  if (jar[ACCESS]) {
    const res = await auth(env, 'user', { token: jar[ACCESS] });
    if (res.ok && isAdmin(env, res.data)) return { email: res.data.email, cookies: [] };
  }
  if (jar[REFRESH]) {
    const res = await auth(env, 'token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: jar[REFRESH] },
    });
    if (res.ok && res.data?.access_token && isAdmin(env, res.data.user)) {
      return { email: res.data.user.email, cookies: sessionCookies(res.data) };
    }
  }
  throw new HttpError(401, '请先登录。');
}

// 管理端的写操作必须来自本站页面，防止别的网站借用登录状态。
export function checkOrigin(request) {
  if (['GET', 'HEAD'].includes(request.method)) return;
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, '请求来源不正确。');
}

// ---------------------------------------------------------------- 问卷

export async function loadQuestions(env) {
  return rest(env, 'questions?select=*&order=created_at.asc,field_key.asc');
}

export async function loadCurrentVersion(env) {
  const rows = await rest(env, 'form_versions?is_current=eq.true&select=id,items,created_at&limit=1');
  if (!rows.length) throw new HttpError(503, '问卷还没有准备好。');
  return rows[0];
}

// ---- 问卷流程 ----
// 问卷是一张“节点和线”的图。每一项（节点）是某道题的一次出现，有自己的编号 id。
//   next   这一项的默认去向：另一项的 id，或 'end'（去确认提交）
//   routes 单选题里，个别选项自己的去向：{ 选项值: 另一项的 id 或 'end' }
// 第一项是起点。走法只有一条规则：答完一项，选项有自己的线就走那条，否则走默认的线。
// 线只能往前连，不能连成圈。

// 早期保存的问卷是“列表 + 显示条件”的写法（没有 next）。这里换算成节点和线。
function legacyToGraph(raw, questions) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const latestByField = new Map();
  const listed = raw.map((r, index) => {
    const id = typeof r.id === 'string' ? r.id : `i${index}`;
    let cond = null;
    if (r.show_if) cond = { item: r.show_if.item ?? latestByField.get(r.show_if.field) ?? 'missing', in: r.show_if.in };
    const q = byId.get(r.question_id);
    if (q) latestByField.set(q.field_key, id);
    return { id, question_id: r.question_id, cond };
  });
  // 先把每条分支挪到它依据的那一项正后面（同一条件的排在一起）。
  // 旧写法允许分支和它依据的题之间隔着别的题，那种顺序用“线”表达不了；挪过之后每个人被问到的题不变。
  const ids = new Set(listed.map((it) => it.id));
  const followers = new Map();
  const roots = [];
  for (const it of listed) {
    if (it.cond && ids.has(it.cond.item)) {
      if (!followers.has(it.cond.item)) followers.set(it.cond.item, []);
      followers.get(it.cond.item).push(it);
    } else {
      roots.push(it);
    }
  }
  const items = [];
  const place = (it) => {
    items.push(it);
    const list = followers.get(it.id) || [];
    const keyOf = (f) => [...f.cond.in].sort().join('\n');
    for (const key of new Set(list.map(keyOf))) for (const f of list) if (keyOf(f) === key) place(f);
  };
  roots.forEach(place);

  const at = new Map(items.map((it) => [it.id, it]));
  const overlap = (x, y) => x.some((v) => y.includes(v));
  // 站在 from 这一项、回答是 answer 的人，后面的 item 会不会被问到
  const shown = (item, from, answer) => {
    if (!item.cond) return true;
    if (item.cond.item === from.id) return answer !== undefined && item.cond.in.includes(answer);
    for (let cur = from; cur?.cond; cur = at.get(cur.cond.item)) {
      if (cur.cond.item === item.cond.item) return overlap(cur.cond.in, item.cond.in);
    }
    return false;
  };
  return items.map((from, index) => {
    const target = (answer) => items.slice(index + 1).find((it) => shown(it, from, answer))?.id ?? 'end';
    const out = { id: from.id, question_id: from.question_id, next: target(undefined) };
    const q = byId.get(from.question_id);
    if (q?.type === 'single') {
      const routes = {};
      for (const o of q.options) if (target(o.value) !== out.next) routes[o.value] = target(o.value);
      if (Object.keys(routes).length) out.routes = routes;
    }
    return out;
  });
}

// 统一成 [{ id, question_id, next, routes }]。
export function normalizeItems(raw, questions) {
  if (!Array.isArray(raw)) return [];
  const items = raw.some((r) => r && r.next === undefined) ? legacyToGraph(raw, questions) : raw;
  return items.map((it) => ({ id: it.id, question_id: it.question_id, next: it.next, routes: { ...(it.routes || {}) } }));
}

// 当前问卷：每一项带上题目内容、这一项的编号和去向。
export async function loadForm(env) {
  const [version, questions] = await Promise.all([loadCurrentVersion(env), loadQuestions(env)]);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const items = [];
  for (const item of normalizeItems(version.items, questions)) {
    const q = byId.get(item.question_id);
    if (q && !q.archived_at) items.push({ ...q, item_id: item.id, next: item.next, routes: item.routes });
  }
  return { version, items, questions };
}

// 一个人实际会被问到哪些项。前台 dist/app.js 里的 visible() 是同一套规则。
// onAsk(q) 返回这一项的回答（没有回答返回 undefined）。
export function walkForm(items, onAsk) {
  const index = new Map(items.map((q, i) => [q.item_id, i]));
  let at = items.length ? 0 : -1;
  for (let steps = 0; at >= 0 && steps < items.length; steps++) {
    const q = items[at];
    const answer = onAsk(q);
    const own = q.type === 'single' && typeof answer === 'string' ? q.routes?.[answer] : undefined;
    const target = own ?? q.next;
    at = index.has(target) ? index.get(target) : -1;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s().-]{5,29}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 校验一个人的全部回答。raw 的键是每一项的编号。返回要写入数据库的行；有问题就抛出带字段名的错误。
export function validateAnswers(items, raw) {
  const rows = [];
  const fail = (q, message) => { throw new HttpError(422, message, { field: q.field_key }); };

  walkForm(items, (q) => {
    if (q.type === 'info') return undefined;
    let value = raw[q.item_id];
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
    if (empty) {
      if (q.required) fail(q, `“${q.title}”还没有回答。`);
      return undefined;
    }

    if (q.type === 'multi') {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) fail(q, '回答格式不正确。');
      value = [...new Set(value)];
      const allowed = new Map(q.options.map((o) => [o.value, o]));
      if (value.some((v) => !allowed.has(v))) fail(q, '选择了不存在的选项。');
      if (value.length > 1 && value.some((v) => allowed.get(v).exclusive)) fail(q, '所选的选项不能同时选择。');
    } else {
      if (typeof value !== 'string') fail(q, '回答格式不正确。');
      value = value.trim();
      if (!value) {
        if (q.required) fail(q, `“${q.title}”还没有回答。`);
        return undefined;
      }
      if (q.type === 'single') {
        if (!q.options.some((o) => o.value === value)) fail(q, '选择了不存在的选项。');
      } else {
        if (value.length > q.max_length) fail(q, `“${q.title}”最多 ${q.max_length} 个字。`);
        if (q.type === 'email' && !EMAIL_RE.test(value)) fail(q, '邮箱格式不正确。');
        if (q.type === 'phone' && !PHONE_RE.test(value)) fail(q, '电话格式不正确。');
        if (q.type === 'date' && (!DATE_RE.test(value) || Number.isNaN(Date.parse(value)))) fail(q, '日期格式不正确。');
      }
    }
    rows.push({ question_id: q.id, item_id: q.item_id, field_key: q.field_key, question_title: q.title, value });
    return value;
  });
  if (!rows.length) throw new HttpError(422, '还没有填写任何内容。');
  return rows;
}

// 校验控制台里新建或修改的一道题。create 为 true 时才允许设置字段名和题型。
export function cleanQuestion(input, { create, existing } = {}) {
  const out = {};
  const str = (key, max, required = false) => {
    if (input[key] === undefined) {
      if (required) throw new HttpError(422, '缺少必要的内容。');
      return;
    }
    if (typeof input[key] !== 'string') throw new HttpError(422, '内容格式不正确。');
    const value = input[key].trim();
    if (required && !value) throw new HttpError(422, '题目文字不能为空。');
    if (value.length > max) throw new HttpError(422, `文字太长了（最多 ${max} 个字）。`);
    out[key] = value;
  };

  if (create) {
    if (typeof input.field_key !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(input.field_key)) {
      throw new HttpError(422, '字段名只能用小写英文字母、数字和下划线，并以字母开头。');
    }
    if (!TYPES.includes(input.type)) throw new HttpError(422, '题型不正确。');
    out.field_key = input.field_key;
    out.type = input.type;
  }
  const type = create ? out.type : existing.type;

  str('title', 500, create);
  str('hint', 500);
  str('reply', 500);
  str('placeholder', 200);
  if (input.required !== undefined) out.required = Boolean(input.required);
  if (input.max_length !== undefined) {
    const n = Number(input.max_length);
    if (!Number.isInteger(n) || n < 1 || n > 5000) throw new HttpError(422, '字数上限要在 1 到 5000 之间。');
    out.max_length = n;
  }

  const isChoice = type === 'single' || type === 'multi';
  if (input.options !== undefined || (create && isChoice)) {
    const list = Array.isArray(input.options) ? input.options : [];
    if (!isChoice && list.length) throw new HttpError(422, '只有选择题可以设置选项。');
    if (isChoice && (list.length < 2 || list.length > 30)) throw new HttpError(422, '选择题需要 2 到 30 个选项。');
    const seen = new Set();
    out.options = list.map((o) => {
      const label = typeof o?.label === 'string' ? o.label.trim() : '';
      const value = typeof o?.value === 'string' && o.value.trim() ? o.value.trim() : label;
      if (!label || label.length > 100 || value.length > 100) throw new HttpError(422, '每个选项都要有文字，且不超过 100 个字。');
      if (seen.has(value)) throw new HttpError(422, `选项“${value}”重复了。`);
      seen.add(value);
      const option = { value, label };
      if (typeof o.icon === 'string' && /^[a-z]{1,20}$/.test(o.icon)) option.icon = o.icon;
      if (type === 'multi' && o.exclusive) option.exclusive = true;
      return option;
    });
  }
  return out;
}

// 校验控制台保存的问卷：每一项是哪道题、去向是否有效、有没有连成圈。同一道题可以出现多次。
export function cleanFormItems(input, questions) {
  if (!Array.isArray(input) || !input.length) throw new HttpError(422, '问卷里至少要有一道题。');
  if (input.length > 300) throw new HttpError(422, '题目太多了。');
  const byId = new Map(questions.map((q) => [q.id, q]));
  const ids = new Set();
  for (const raw of input) {
    if (typeof raw?.id !== 'string' || !/^[a-z0-9]{2,20}$/.test(raw.id) || ids.has(raw.id) || raw.id === 'end') {
      throw new HttpError(422, '问卷数据的编号不正确，请刷新页面后重试。');
    }
    ids.add(raw.id);
  }
  const validTarget = (t) => t === 'end' || ids.has(t);
  const items = input.map((raw) => {
    const q = byId.get(raw.question_id);
    if (!q) throw new HttpError(422, '问卷里有一道不存在的题。');
    if (q.archived_at) throw new HttpError(422, `“${q.title}”已归档，不能放进问卷。`);
    if (!validTarget(raw.next)) throw new HttpError(422, `“${q.title}”的线没有连到有效的位置。`);
    const item = { id: raw.id, question_id: q.id, next: raw.next };
    const routes = raw.routes && typeof raw.routes === 'object' && !Array.isArray(raw.routes) ? raw.routes : {};
    const kept = {};
    for (const [value, target] of Object.entries(routes)) {
      if (q.type !== 'single') throw new HttpError(422, `只有单选题的选项可以有自己的去向（“${q.title}”不是单选题）。`);
      if (!q.options.some((o) => o.value === value)) throw new HttpError(422, `“${q.title}”有一条线对应的选项已经不存在。`);
      if (!validTarget(target)) throw new HttpError(422, `“${q.title}”的线没有连到有效的位置。`);
      if (target !== item.next) kept[value] = target;
    }
    if (Object.keys(kept).length) item.routes = kept;
    return item;
  });
  // 不能连成圈：从每一项出发，顺着线走不能回到自己。
  const at = new Map(items.map((it) => [it.id, it]));
  const state = new Map(); // 1 = 正在走，2 = 走完了
  const visit = (id) => {
    if (id === 'end' || state.get(id) === 2) return;
    if (state.get(id) === 1) throw new HttpError(422, '有几条线连成了一个圈，会让人一直答不完，请改一下去向。');
    state.set(id, 1);
    const item = at.get(id);
    for (const target of [item.next, ...Object.values(item.routes || {})]) visit(target);
    state.set(id, 2);
  };
  items.forEach((it) => visit(it.id));
  return items;
}

// ---------------------------------------------------------------- 填写记录与导出

const SUBMISSION_SELECT =
  'id,created_at,status,note,form_version_id,consent_version,consent_at,' +
  'answers(question_id,item_id,field_key,question_title,value)';

export function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function display(value) {
  return Array.isArray(value) ? value.join('、') : String(value ?? '');
}

function answerOf(submission, fieldKey) {
  const found = submission.answers.find((a) => a.field_key === fieldKey);
  return found ? display(found.value) : '';
}

// 读取填写记录，并按网址上的筛选条件过滤。一次最多 1000 条。
export async function loadSubmissions(env, params) {
  const query = [`select=${SUBMISSION_SELECT}`, 'order=created_at.desc', 'limit=1000'];
  const status = params.get('status');
  if (status && STATUSES.includes(status)) query.push(`status=eq.${status}`);
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const from = params.get('from');
  const to = params.get('to');
  if (from && day.test(from)) query.push(`created_at=gte.${from}T00:00:00Z`);
  if (to && day.test(to)) query.push(`created_at=lte.${to}T23:59:59.999Z`);
  let rows = await rest(env, `submissions?${query.join('&')}`);

  const path = params.get('path');
  if (path) rows = rows.filter((s) => answerOf(s, 'path') === path);
  const q = (params.get('q') || '').trim().toLowerCase();
  if (q) {
    rows = rows.filter((s) =>
      answerOf(s, 'name').toLowerCase().includes(q) || answerOf(s, 'email').toLowerCase().includes(q));
  }
  return rows;
}

export async function loadSubmission(env, id) {
  if (!isUuid(id)) throw new HttpError(404, '没有找到这条记录。');
  const rows = await rest(env, `submissions?id=eq.${id}&select=${SUBMISSION_SELECT}`);
  if (!rows.length) throw new HttpError(404, '没有找到这条记录。');
  return rows[0];
}

export function summarize(submission) {
  return {
    id: submission.id,
    created_at: submission.created_at,
    status: submission.status,
    name: answerOf(submission, 'name'),
    email: answerOf(submission, 'email'),
    path: answerOf(submission, 'path'),
  };
}

// 把回答按当前问卷的顺序排好。优先按“问卷里的哪一项”对，早期没有记录这一项的回答按题目对。
export function sortAnswers(answers, formItems) {
  const byItem = new Map(formItems.map((q, i) => [q.item_id, i]));
  const byQuestion = new Map();
  formItems.forEach((q, i) => { if (!byQuestion.has(q.id)) byQuestion.set(q.id, i); });
  const rank = (a) => byItem.get(a.item_id) ?? byQuestion.get(a.question_id) ?? 9999;
  return [...answers].sort((a, b) => rank(a) - rank(b));
}

function csvCell(value) {
  let text = String(value ?? '');
  // 以 = + - @ 开头的内容，表格软件会当成公式执行，前面加一个单引号避免。
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  // 开头的 BOM 让 Excel 和 WPS 正确识别中文。
  return '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function localTime(iso) {
  return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

// 一行一个人，一列一道题。列 = 当前问卷的题在前，其余被回答过的题在后。
export function csvAll(submissions, formItems, questions) {
  const columns = [];
  const seen = new Set();
  const add = (q) => { if (!seen.has(q.id) && q.type !== 'info') { seen.add(q.id); columns.push(q); } };
  formItems.forEach(add);
  const answered = new Set(submissions.flatMap((s) => s.answers.map((a) => a.question_id)));
  questions.filter((q) => answered.has(q.id)).forEach(add);

  const header = ['提交时间（北京时间）', '处理状态', '备注', ...columns.map((q) => q.title)];
  const body = submissions.map((s) => {
    // 同一道题被问到两次时，两次回答放在同一格里，用分号隔开。
    const byQuestion = new Map();
    for (const a of sortAnswers(s.answers, formItems)) {
      byQuestion.set(a.question_id, byQuestion.has(a.question_id) ? `${byQuestion.get(a.question_id)}；${display(a.value)}` : display(a.value));
    }
    return [localTime(s.created_at), STATUS_LABELS[s.status] || s.status, s.note,
      ...columns.map((q) => byQuestion.get(q.id) ?? '')];
  });
  return toCsv([header, ...body]);
}

// 一个人：竖着排，一行一道题，按当前问卷的顺序。
export function csvOne(submission, formItems) {
  const answers = sortAnswers(submission.answers, formItems);
  return toCsv([
    ['项目', '内容'],
    ['提交时间（北京时间）', localTime(submission.created_at)],
    ['处理状态', STATUS_LABELS[submission.status] || submission.status],
    ['备注', submission.note],
    ...answers.map((a) => [a.question_title, display(a.value)]),
  ]);
}

export function csvResponse(csv, filename) {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}
