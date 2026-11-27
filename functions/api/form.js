// GET /api/form —— 前台打开时读取当前问卷。
import { handle, json, loadForm, CONSENT_VERSION } from '../../server/lib.js';

export const onRequestGet = handle(async ({ env }) => {
  const { version, items } = await loadForm(env);
  return json({
    version_id: version.id,
    consent_version: CONSENT_VERSION,
    questions: items.map((q) => ({
      id: q.item_id,
      field_key: q.field_key,
      type: q.type,
      title: q.title,
      hint: q.hint,
      reply: q.reply,
      placeholder: q.placeholder,
      required: q.required,
      max_length: q.max_length,
      options: q.options,
      next: q.next,
      routes: q.routes,
    })),
  });
});
