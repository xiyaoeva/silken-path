-- 示范 · 问卷系统数据库结构
-- 在 Supabase 控制台的 SQL Editor 里整段粘贴并运行一次即可。
-- 所有表都开启行级安全且不设任何策略：浏览器无法直接读写，
-- 只有 Cloudflare 后端函数使用 service role key 才能访问。

create extension if not exists pgcrypto;

-- 1. 题库：建立过的所有题目。停用的题仍保留在这里。
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  -- 固定的内部字段名，导出表格的列以它为准；题目文字可以随时改。
  field_key text not null unique check (field_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  type text not null check (type in ('single','multi','short_text','long_text','email','phone','date','info')),
  title text not null check (char_length(title) between 1 and 500),
  hint text not null default '',
  reply text not null default '',          -- 承接语：显示在这道题之前的一句话
  placeholder text not null default '',
  required boolean not null default true,
  max_length integer not null default 200 check (max_length between 1 and 5000),
  -- 选择题的选项：[{"value":"…","label":"…","icon":"work","exclusive":false}]
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  archived_at timestamptz,                 -- 归档时间；有人答过的题只能归档，不能删除
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. 问卷版本：每次在控制台保存，都新增一行，记录当时选用了哪些题及顺序。
create table public.form_versions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  is_current boolean not null default false,
  -- 问卷流程，一张“节点和线”的图：[{"id":"…","question_id":"…","next":"下一项的 id 或 end","routes":{"选项值":"去向"}}]
  -- 早期的写法是 [{"question_id":"…","show_if":{…}}]，后端读取时会自动换算。
  items jsonb not null check (jsonb_typeof(items) = 'array')
);
create unique index form_versions_one_current on public.form_versions (is_current) where is_current;

-- 3. 填写记录：一个人的一次提交。
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  form_version_id uuid not null references public.form_versions (id),
  consent_version text not null,
  consent_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','contacted','signed','closed')),
  note text not null default ''
);
create index submissions_created_at on public.submissions (created_at desc);

-- 4. 回答：某条记录对某道题的答案。
create table public.answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete restrict,
  field_key text not null,                 -- 提交时的字段名快照
  question_title text not null,            -- 提交时的题目文字快照
  value jsonb not null,                    -- 文本题为字符串，多选题为字符串数组
  item_id text                             -- 回答的是问卷流程里的哪一项；同一道题可以在流程里出现多次
);
create index answers_submission on public.answers (submission_id);

-- 5. 导出留痕：谁在什么时候导出过数据。
create table public.export_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  admin_email text not null,
  scope text not null check (scope in ('all','one')),
  submission_id uuid references public.submissions (id) on delete set null,
  row_count integer not null default 0
);

alter table public.questions enable row level security;
alter table public.form_versions enable row level security;
alter table public.submissions enable row level security;
alter table public.answers enable row level security;
alter table public.export_logs enable row level security;
-- 有意不创建任何 anon / authenticated 策略。

-- 只把表的访问权授予后端使用的 service_role，浏览器使用的两个角色一律收回。
-- 这样无论新建项目时是否勾选“自动授予 API 访问权”，结果都一致。
revoke all on public.questions, public.form_versions, public.submissions, public.answers, public.export_logs
  from anon, authenticated;
grant usage on schema public to service_role;
grant all on public.questions, public.form_versions, public.submissions, public.answers, public.export_logs
  to service_role;

-- ---------------------------------------------------------------------------
-- 初始题目：与目前演示页上的问答一致。
-- ---------------------------------------------------------------------------
insert into public.questions (field_key, type, title, hint, reply, placeholder, required, max_length, options) values
('name', 'short_text', '怎么称呼你？', '名字、昵称，都可以。', '你好！', '你喜欢的称呼', true, 200, '[]'),
('location', 'single', '你现在住在哪里？', '', '很高兴认识你。', '', true, 200,
 '[{"value":"美国境内","label":"我在美国","icon":"compass"},
   {"value":"中国大陆","label":"我在中国大陆","icon":"work"},
   {"value":"其他国家或地区","label":"我在其他地方","icon":"spark"}]'),
('status', 'single', '你目前是什么签证或身份？', '', '', '', true, 200,
 '[{"value":"F-1 / OPT","label":"F-1 / OPT"},
   {"value":"H-1B","label":"H-1B"},
   {"value":"O-1","label":"O-1"},
   {"value":"L-1","label":"L-1"},
   {"value":"其他 / 不确定","label":"其他 / 不确定"}]'),
('status_other', 'short_text', '可以说说你目前的身份情况吗？', '不确定也没关系，按你知道的写就好。', '', '请填写你的情况', true, 200, '[]'),
('path', 'single', '你想了解哪种申请？', '还没想好也没关系，我会陪你一起梳理。', '了解了。接下来，聊聊你想去的方向。', '', true, 200,
 '[{"value":"H-1B","label":"H-1B 工作签证","icon":"work"},
   {"value":"EB-1A","label":"EB-1A 杰出人才","icon":"star"},
   {"value":"O-1","label":"O-1 杰出能力","icon":"spark"},
   {"value":"探索方向","label":"还不确定","icon":"compass"}]'),
('profession', 'short_text', '你平时从事什么工作？', '用你自己的话说就好，不需要专业术语。', '', '例如：软件工程师、研究员、设计师', true, 200, '[]'),
('employer', 'single', '聊聊你的工作机会。', '这能帮助律师了解雇主支持情况。不确定也没关系。', '接下来，了解一点你的职业经历。', '', true, 200,
 '[{"value":"已有雇主支持","label":"已有雇主支持","icon":"work"},
   {"value":"正在找工作","label":"正在寻找机会","icon":"compass"},
   {"value":"需要讨论","label":"情况比较特殊","icon":"chat"}]'),
('achievements', 'multi', '哪些成就最能代表你？', '可以多选。这里只收集线索，具体证据由律师进一步审核。', '接下来，了解一点你的职业经历。', '', true, 200,
 '[{"value":"奖项","label":"专业奖项","icon":"star"},
   {"value":"发表与报道","label":"发表与媒体报道","icon":"chat"},
   {"value":"评审与贡献","label":"评审与原创贡献","icon":"spark"},
   {"value":"领导与薪酬","label":"领导角色与薪酬","icon":"work"},
   {"value":"暂不确定","label":"暂不确定","icon":"compass","exclusive":true}]'),
('timeline', 'single', '你希望什么时候解决这次签证或移民需求？', '按你的节奏来。', '谢谢，这些线索会让后续沟通更有方向。', '', true, 200,
 '[{"value":"尽快","label":"越快越好","icon":"spark"},
   {"value":"3个月内","label":"3 个月内","icon":"work"},
   {"value":"半年内","label":"半年内","icon":"compass"},
   {"value":"先了解","label":"暂时只是了解一下","icon":"chat"}]'),
('notes', 'long_text', '还有需要补充的吗？', '比如身份到期、工作变动，或家人的安排。也可以先跳过。', '你的故事，已经渐渐清晰了。', '想说什么，都可以写在这里。', false, 2000, '[]'),
('email', 'email', '你的联系邮箱是？', '', '差不多了。', 'you@example.com', true, 200, '[]');

-- 第一版问卷：按上面的顺序启用全部题目，并带上现有的分支。
insert into public.form_versions (is_current, items)
select true, jsonb_agg(
         jsonb_strip_nulls(jsonb_build_object('question_id', q.id, 'show_if', s.show_if))
         order by s.pos)
from (values
  ('name',          1, null::jsonb),
  ('location',      2, null),
  ('status',        3, null),
  ('status_other',  4, '{"field":"status","in":["其他 / 不确定"]}'),
  ('path',          5, null),
  ('profession',    6, null),
  ('employer',      7, '{"field":"path","in":["H-1B"]}'),
  ('achievements',  8, '{"field":"path","in":["EB-1A","O-1","探索方向"]}'),
  ('timeline',      9, null),
  ('notes',        10, null),
  ('email',        11, null)
) as s(field_key, pos, show_if)
join public.questions q using (field_key);

-- ---------------------------------------------------------------------------
-- 后端函数调用的两个数据库函数：保证“一次提交”和“一次保存问卷”要么全部成功，要么全部不生效。
-- 只有 service_role 可以执行。
-- ---------------------------------------------------------------------------
create or replace function public.submit_form(p_form_version_id uuid, p_consent_version text, p_answers jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.submissions (form_version_id, consent_version, consent_at)
  values (p_form_version_id, p_consent_version, now())
  returning id into v_id;
  insert into public.answers (submission_id, question_id, item_id, field_key, question_title, value)
  select v_id, (a->>'question_id')::uuid, a->>'item_id', a->>'field_key', a->>'question_title', a->'value'
  from jsonb_array_elements(p_answers) as a;
  return v_id;
end $$;

create or replace function public.publish_form(p_items jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  update public.form_versions set is_current = false where is_current;
  insert into public.form_versions (is_current, items) values (true, p_items) returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.submit_form(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.publish_form(jsonb) from public, anon, authenticated;
grant execute on function public.submit_form(uuid, text, jsonb) to service_role;
grant execute on function public.publish_form(jsonb) to service_role;
