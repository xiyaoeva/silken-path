// 前台问答页：题目从 /api/form 读取，答完后提交到 /api/submit。
const state = {
  form: null,      // { version_id, consent_version, questions }
  answers: {},     // 这一项的编号 → 回答
  pos: 0,          // 当前在“可见题目”里的位置；等于题目数时是确认页
  selected: null,  // 当前选择题的临时选择
  done: false,
  sending: false,
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const icons = {
  work: '<rect x="5" y="10" width="25" height="20" rx="3"/><path d="M12 10V5h11v5M5 18h25M16 17v5h5v-5"/>',
  star: '<path d="m18 3 5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2Z"/>',
  spark: '<path d="m18 3 4 11 11 4-11 4-4 11-4-11-11-4 11-4ZM29 1v8M25 5h8"/>',
  compass: '<circle cx="18" cy="18" r="14"/><path d="m24 11-4 10-9 4 4-10Z"/>',
  chat: '<path d="M5 5h26v20H17L9 32v-7H5ZM11 12h14M11 18h9"/>',
};
const icon = (key) => `<svg class="icon" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">${icons[key] || icons.compass}</svg>`;

const PRIVACY = `
<p>我们通过这份问卷收集你填写的称呼、联系方式和移民相关背景，用于了解你的情况并与你联系。</p>
<p>请不要填写护照号码、社会安全号码，也不要上传证件原件。</p>
<p>你的回答只有本站的管理人员可以查看，不会出售或用于其他用途。如需查看、更正或删除你提交的内容，可以回复我们发给你的邮件提出。</p>
<p>填写本问卷不构成法律意见，也不代表已经建立委托关系。</p>`;

let moving = false;
let timer;

// ---------------------------------------------------------------- 题目流程

// 一个人实际会被问到哪些题，和后端 server/lib.js 里的 walkForm 是同一套规则：
// 从第一项开始；答完一项，单选题的选项有自己的线就走那条，否则走这一项默认的线；走到 'end' 就是确认提交。
// 还没回答的那一项先按默认的线往后排，等回答了再重新算。
function visible() {
  const items = state.form.questions;
  const index = new Map(items.map((q, i) => [q.id, i]));
  const list = [];
  let at = items.length ? 0 : -1;
  for (let steps = 0; at >= 0 && steps < items.length; steps++) {
    const q = items[at];
    list.push(q);
    const answer = state.answers[q.id];
    const own = q.type === 'single' && typeof answer === 'string' ? q.routes?.[answer] : undefined;
    const target = own ?? q.next;
    at = index.has(target) ? index.get(target) : -1;
  }
  return list;
}

function labelOf(q, value) {
  const option = (q.options || []).find((o) => o.value === value);
  return option ? option.label : value;
}

function answerText(q) {
  const value = state.answers[q.id];
  if (q.type === 'info') return '';
  if (value === undefined || value === '') return '跳过';
  if (Array.isArray(value)) return value.map((v) => labelOf(q, v)).join('、');
  return q.type === 'single' ? labelOf(q, value) : value;
}

// ---------------------------------------------------------------- 画面

function optionButtons(q) {
  const multi = q.type === 'multi';
  const cards = multi || q.options.some((o) => o.icon);
  const chosen = (v) => (multi ? (state.selected || []).includes(v) : state.selected === v);
  return `<div class="${cards ? 'options' : 'bars'}">${q.options.map((o) => `
    <button type="button" class="${cards ? 'option' : 'bar'} ${chosen(o.value) ? 'selected' : ''}" data-value="${esc(o.value)}" aria-pressed="${chosen(o.value)}">
      ${cards ? `${multi ? '<span class="choice-check" aria-hidden="true"></span>' : ''}${icon(o.icon)}` : ''}
      <span><strong>${esc(o.label)}</strong></span>
    </button>`).join('')}</div>`;
}

function inputField(q) {
  const value = esc(state.answers[q.id]);
  const common = `id="answer" name="answer" placeholder="${esc(q.placeholder)}" maxlength="${q.max_length}" ${q.required ? 'required' : ''}`;
  if (q.type === 'long_text') {
    return `<form id="step-form" novalidate><label class="sr-only" for="answer">${esc(q.title)}</label><textarea ${common}>${value}</textarea></form>`;
  }
  const type = { email: 'email', phone: 'tel', date: 'date' }[q.type] || 'text';
  const auto = q.field_key === 'name' ? 'given-name' : q.type === 'email' ? 'email' : q.type === 'phone' ? 'tel' : 'off';
  return `<form id="step-form" novalidate><label class="sr-only" for="answer">${esc(q.title)}</label><input ${common} type="${type}" value="${value}" autocomplete="${auto}"></form>`;
}

function history(list) {
  return `<div class="chat-history">${list.slice(0, state.pos).map((q) => `
    <div class="past-question">${esc(q.title)}</div>
    ${q.type === 'info' ? '' : `<div class="answer-row"><span class="answer-bubble">${esc(answerText(q))}</span></div>`}`).join('')}</div>`;
}

function render() {
  moving = false;
  const list = visible();
  const content = $('#content');

  if (state.done) {
    content.innerHTML = `${history(list)}<div class="conversation fade" id="current-question"><h2 tabindex="-1">谢谢，已经收到你的信息。</h2><p class="hint">请留意你的邮箱。</p></div>`;
    focusCurrent();
    return;
  }

  // 全部答完：确认隐私说明并提交
  if (state.pos >= list.length) {
    content.innerHTML = `${history(list)}<div class="conversation fade" id="current-question">
      <h2 tabindex="-1">最后一步，确认后提交。</h2>
      <label class="check"><input type="checkbox" id="consent"><span>我已阅读并同意<button type="button" class="text-link" id="open-privacy">隐私说明</button>，同意提交以上信息用于咨询联系。</span></label>
      <input class="trap" id="website" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p id="error" class="error" role="alert"></p>
      <div class="actions"><button class="primary" id="submit">提交</button></div>
      <div class="quiet-controls"><button id="back" class="back">返回</button></div>
    </div>`;
    $('#open-privacy').onclick = showPrivacy;
    $('#back').onclick = back;
    $('#submit').onclick = submit;
    focusCurrent();
    return;
  }

  const q = list[state.pos];
  const choice = q.type === 'single' || q.type === 'multi';
  const saved = state.answers[q.id];
  state.selected = q.type === 'multi' ? (Array.isArray(saved) ? saved : []) : q.type === 'single' ? (saved ?? null) : null;

  const body = choice ? optionButtons(q) : q.type === 'info' ? '' : inputField(q);
  const needsButton = q.type !== 'single';
  content.innerHTML = `${history(list)}<div class="conversation fade" id="current-question">
    ${q.reply ? `<p class="reply">${esc(q.reply)}</p>` : ''}
    <h2 tabindex="-1">${esc(q.title)}</h2>
    ${q.hint ? `<p class="hint">${esc(q.hint)}</p>` : ''}
    ${body}
    <p id="error" class="error" role="alert"></p>
    ${needsButton ? '<div class="actions"><button class="primary" id="next">继续</button></div>' : ''}
    <div class="quiet-controls">
      ${state.pos > 0 ? '<button id="back" class="back">返回</button>' : ''}
      ${!q.required && q.type !== 'info' ? '<button id="skip" class="back">跳过</button>' : ''}
    </div>
  </div>`;

  content.querySelectorAll('[data-value]').forEach((el) => {
    el.onclick = () => {
      if (moving) return;
      const v = el.dataset.value;
      if (q.type === 'multi') {
        const exclusive = (value) => q.options.find((o) => o.value === value)?.exclusive;
        const now = state.selected;
        state.selected = exclusive(v)
          ? (now.includes(v) ? [] : [v])
          : now.includes(v) ? now.filter((x) => x !== v) : [...now.filter((x) => !exclusive(x)), v];
      } else {
        state.selected = v;
      }
      content.querySelectorAll('[data-value]').forEach((e) => {
        const yes = Array.isArray(state.selected) ? state.selected.includes(e.dataset.value) : state.selected === e.dataset.value;
        e.classList.toggle('selected', yes);
        e.setAttribute('aria-pressed', yes);
      });
      if (q.type === 'single') {
        moving = true;
        timer = setTimeout(() => { moving = false; next(); }, 380);
      }
    };
  });
  if ($('#next')) $('#next').onclick = () => { if (!moving) next(); };
  if ($('#back')) $('#back').onclick = back;
  if ($('#skip')) $('#skip').onclick = () => { delete state.answers[q.id]; state.pos++; render(); };
  if ($('#step-form')) $('#step-form').onsubmit = (e) => { e.preventDefault(); if (!moving) next(); };
  focusCurrent();
}

function focusCurrent() {
  requestAnimationFrame(() => {
    const field = $('#answer');
    const heading = $('#current-question h2');
    if (state.pos > 0 || state.done) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      $('#current-question')?.scrollIntoView({ behavior: reduce ? 'instant' : 'smooth', block: 'start' });
    }
    (field || heading)?.focus({ preventScroll: true });
  });
}

function fail(message) {
  $('#error').textContent = message;
}

// ---------------------------------------------------------------- 动作

function next() {
  const q = visible()[state.pos];
  if (q.type === 'single' || q.type === 'multi') {
    const empty = q.type === 'multi' ? !state.selected.length : !state.selected;
    if (empty && q.required) return fail('选一个最接近你的情况就好。');
    if (empty) delete state.answers[q.id];
    else state.answers[q.id] = state.selected;
  } else if (q.type !== 'info') {
    const field = $('#answer');
    const value = field.value.trim();
    if (!value && q.required) { field.focus(); return fail('在这里写一点，再继续吧。'); }
    if (value && q.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { field.focus(); return fail('邮箱格式好像不对，再看一下？'); }
    if (value && q.type === 'phone' && !/^[+\d][\d\s().-]{5,29}$/.test(value)) { field.focus(); return fail('电话格式好像不对，再看一下？'); }
    if (value) state.answers[q.id] = value;
    else delete state.answers[q.id];
  }
  state.pos++;
  render();
}

function back() {
  clearTimeout(timer);
  if (state.sending || state.pos === 0) return;
  state.pos--;
  render();
}

async function submit() {
  if (state.sending) return;
  if (!$('#consent').checked) return fail('请先勾选同意隐私说明。');
  const answers = {};
  for (const q of visible()) {
    if (state.answers[q.id] !== undefined) answers[q.id] = state.answers[q.id];
  }
  state.sending = true;
  const button = $('#submit');
  button.disabled = true;
  button.textContent = '正在提交…';
  fail('');
  try {
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version_id: state.form.version_id,
        consent: true,
        consent_version: state.form.consent_version,
        website: $('#website').value,
        answers,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '提交没有成功，请稍后再试。');
    state.done = true;
    state.sending = false;
    render();
  } catch (err) {
    state.sending = false;
    button.disabled = false;
    button.textContent = '提交';
    fail(err instanceof TypeError ? '网络好像断了，请检查后再试一次。' : err.message);
  }
}

function showPrivacy() {
  $('#dialog-content').innerHTML = `<h2>隐私说明</h2>${PRIVACY}`;
  $('#dialog').showModal();
}

async function start() {
  try {
    const res = await fetch('/api/form');
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(data.questions) || !data.questions.length) throw new Error();
    state.form = data;
    render();
  } catch {
    $('#content').innerHTML = '<div class="conversation"><h2>问卷暂时打不开。</h2><p class="hint">请稍后刷新页面再试。</p></div>';
  }
}

$('#menu').onclick = showPrivacy;
$('.close').onclick = () => $('#dialog').close();
start();
