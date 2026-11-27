// GET /api/admin/me —— 控制台打开时确认是否已登录。
import { handle, json } from '../../../server/lib.js';

export const onRequestGet = handle(async ({ data }) => json({ email: data.admin.email }));
