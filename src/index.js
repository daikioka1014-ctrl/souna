const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const VALID_SIDES = new Set(["男性", "女性", "共用", "不明"]);
const VALID_CROWD = new Set(["", "空いていた", "普通", "混雑していた"]);
const VALID_TAGS = new Set([
  "外気浴あり",
  "ロウリュあり",
  "設備故障・停止",
  "営業情報の変更",
  "その他",
]);
const VALID_STATUSES = new Set(["pending", "approved", "rejected"]);

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function fail(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function todayInJapan() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

function parseTags(value) {
  let tags = value;
  if (typeof tags === "string") {
    try { tags = JSON.parse(tags); } catch { tags = []; }
  }
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.filter((tag) => typeof tag === "string" && VALID_TAGS.has(tag)))];
}

function validateReport(input, partial = false) {
  const errors = [];
  const out = {};

  if (!partial || Object.hasOwn(input, "nickname")) {
    out.nickname = cleanText(input.nickname, 24);
  }
  if (!partial || Object.hasOwn(input, "visitDate") || Object.hasOwn(input, "visit_date")) {
    const date = input.visitDate ?? input.visit_date;
    if (!isValidDate(date) || date > todayInJapan()) errors.push("訪問日を正しく入力してください。");
    else out.visit_date = date;
  }
  if (!partial || Object.hasOwn(input, "side")) {
    const side = input.side;
    if (!VALID_SIDES.has(side)) errors.push("利用した浴場を選択してください。");
    else out.side = side;
  }

  for (const [source, target, min, max, label] of [
    ["saunaTemp", "sauna_temp", 0, 130, "サウナ温度"],
    ["waterTemp", "water_temp", 0, 40, "水風呂温度"],
  ]) {
    const raw = input[source] ?? input[target];
    const supplied = Object.hasOwn(input, source) || Object.hasOwn(input, target);
    if (!partial || supplied) {
      if (raw === "" || raw === null || raw === undefined) out[target] = null;
      else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < min || n > max) errors.push(`${label}は${min}〜${max}の整数で入力してください。`);
        else out[target] = n;
      }
    }
  }

  if (!partial || Object.hasOwn(input, "crowd")) {
    const crowd = input.crowd ?? "";
    if (!VALID_CROWD.has(crowd)) errors.push("混雑状況の選択内容が正しくありません。");
    else out.crowd = crowd;
  }
  if (!partial || Object.hasOwn(input, "tags")) out.tags = parseTags(input.tags);
  if (!partial || Object.hasOwn(input, "comment")) out.comment = cleanText(input.comment, 700);

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out };
}

async function readJson(request, maxBytes = 12000) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new Error("投稿内容が大きすぎます。");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new Error("投稿内容が大きすぎます。");
  try { return JSON.parse(text); } catch { throw new Error("送信データの形式が正しくありません。"); }
}

function sameOrigin(request, url) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === url.origin; } catch { return false; }
}

function secureEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(request, env) {
  const expected = env.ADMIN_TOKEN;
  if (typeof expected !== "string" || expected.length < 32) return false;
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return false;
  return secureEquals(header.slice(7), expected);
}

async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY || String(env.TURNSTILE_SITE_KEY).startsWith("REPLACE_")) {
    return { ok: false, reason: "投稿受付のセキュリティ設定が完了していません。" };
  }
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) {
    return { ok: false, reason: "スパム対策の確認を完了してください。" };
  }
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token }),
    });
    if (!response.ok) return { ok: false, reason: "スパム対策の確認に失敗しました。もう一度お試しください。" };
    const result = await response.json();
    const hostname = new URL(request.url).hostname;
    if (!result.success || result.hostname !== hostname || result.action !== "report_submit") {
      return { ok: false, reason: "スパム対策の確認に失敗しました。画面を更新して再度お試しください。" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "スパム対策サービスに接続できませんでした。" };
  }
}

async function findFacility(facilityId, url, env) {
  if (typeof facilityId !== "string" || !/^n\d{3,}$/.test(facilityId)) return null;
  const assetUrl = new URL("/sauna_data.json", url);
  const response = await env.ASSETS.fetch(new Request(assetUrl));
  if (!response.ok) return null;
  const data = await response.json();
  return (data.facilities || []).find((facility) => facility.id === facilityId) || null;
}

function mapReport(row) {
  return {
    id: row.id,
    facilityId: row.facility_id,
    facilityName: row.facility_name,
    visitDate: row.visit_date,
    side: row.side,
    saunaTemp: row.sauna_temp,
    waterTemp: row.water_temp,
    crowd: row.crowd || "",
    tags: parseTags(row.tags_json),
    comment: row.comment || "",
    nickname: row.nickname || "",
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function publicReports(request, env, url) {
  if (request.method !== "GET") return fail("この操作は利用できません。", 405);
  const facilityId = url.searchParams.get("facilityId");
  if (!facilityId) return fail("施設IDが指定されていません。");
  const facility = await findFacility(facilityId, url, env);
  if (!facility) return fail("施設が見つかりません。", 404);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 8), 1), 30);
  const result = await env.DB.prepare(
    `SELECT id, facility_id, facility_name, visit_date, side, sauna_temp, water_temp,
            crowd, tags_json, comment, nickname, status, created_at, reviewed_at, updated_at
       FROM reports
      WHERE facility_id = ? AND status = 'approved'
      ORDER BY visit_date DESC, created_at DESC
      LIMIT ?`
  ).bind(facilityId, limit).all();
  return json({ ok: true, reports: (result.results || []).map(mapReport) });
}

async function createReport(request, env, url) {
  if (request.method !== "POST") return fail("この操作は利用できません。", 405);
  if (!sameOrigin(request, url)) return fail("不正な送信元です。", 403);
  let input;
  try { input = await readJson(request); } catch (error) { return fail(error.message); }

  // Honeypot: silently accept automated form fills without storing them.
  if (cleanText(input.website, 200)) return json({ ok: true, message: "投稿を受け付けました。" }, 202);

  const captcha = await verifyTurnstile(input.turnstileToken, request, env);
  if (!captcha.ok) return fail(captcha.reason, 403);

  const facility = await findFacility(input.facilityId, url, env);
  if (!facility) return fail("施設が見つかりません。", 404);
  const checked = validateReport(input);
  if (!checked.ok) return fail(checked.errors.join(" "));
  const v = checked.value;
  if (v.sauna_temp === null && v.water_temp === null && !v.crowd && !v.tags.length && !v.comment) {
    return fail("温度・混雑状況・設備・コメントのいずれかを入力してください。");
  }

  await env.DB.prepare(
    `INSERT INTO reports
      (facility_id, facility_name, visit_date, side, sauna_temp, water_temp, crowd,
       tags_json, comment, nickname, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(
    facility.id,
    cleanText(facility.name, 120),
    v.visit_date,
    v.side,
    v.sauna_temp,
    v.water_temp,
    v.crowd,
    JSON.stringify(v.tags),
    v.comment,
    v.nickname,
  ).run();

  return json({ ok: true, message: "投稿を受け付けました。管理者の確認後に公開されます。" }, 201);
}

async function adminApi(request, env, url) {
  if (!authorized(request, env)) return fail("管理者認証に失敗しました。", 401);
  if (!sameOrigin(request, url)) return fail("不正な送信元です。", 403);

  if (url.pathname === "/api/admin/reports" && request.method === "GET") {
    const status = url.searchParams.get("status") || "pending";
    const allowed = new Set(["pending", "approved", "rejected", "all"]);
    if (!allowed.has(status)) return fail("状態の指定が正しくありません。");
    const rows = status === "all"
      ? await env.DB.prepare(
          `SELECT * FROM reports ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
           created_at DESC LIMIT 250`
        ).all()
      : await env.DB.prepare("SELECT * FROM reports WHERE status = ? ORDER BY created_at DESC LIMIT 250").bind(status).all();
    return json({ ok: true, reports: (rows.results || []).map(mapReport) });
  }

  const match = url.pathname.match(/^\/api\/admin\/reports\/(\d+)$/);
  if (!match) return fail("管理APIが見つかりません。", 404);
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id < 1) return fail("投稿IDが正しくありません。");

  if (request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM reports WHERE id = ?").bind(id).run();
    if (!result.meta?.changes) return fail("投稿が見つかりません。", 404);
    return json({ ok: true });
  }

  if (request.method !== "PATCH") return fail("この操作は利用できません。", 405);
  let input;
  try { input = await readJson(request); } catch (error) { return fail(error.message); }
  const current = await env.DB.prepare("SELECT * FROM reports WHERE id = ?").bind(id).first();
  if (!current) return fail("投稿が見つかりません。", 404);

  const nextStatus = input.status ?? current.status;
  if (!VALID_STATUSES.has(nextStatus)) return fail("公開状態が正しくありません。");
  const merged = {
    nickname: input.nickname ?? current.nickname,
    visit_date: input.visitDate ?? input.visit_date ?? current.visit_date,
    side: input.side ?? current.side,
    sauna_temp: Object.hasOwn(input, "saunaTemp") ? input.saunaTemp : (Object.hasOwn(input, "sauna_temp") ? input.sauna_temp : current.sauna_temp),
    water_temp: Object.hasOwn(input, "waterTemp") ? input.waterTemp : (Object.hasOwn(input, "water_temp") ? input.water_temp : current.water_temp),
    crowd: input.crowd ?? current.crowd ?? "",
    tags: Object.hasOwn(input, "tags") ? input.tags : parseTags(current.tags_json),
    comment: input.comment ?? current.comment ?? "",
  };
  const checked = validateReport(merged);
  if (!checked.ok) return fail(checked.errors.join(" "));
  const v = checked.value;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE reports SET nickname=?, visit_date=?, side=?, sauna_temp=?, water_temp=?, crowd=?,
       tags_json=?, comment=?, status=?, updated_at=?,
       reviewed_at=CASE WHEN ? IN ('approved','rejected') THEN ? ELSE reviewed_at END
     WHERE id=?`
  ).bind(
    v.nickname, v.visit_date, v.side, v.sauna_temp, v.water_temp, v.crowd,
    JSON.stringify(v.tags), v.comment, nextStatus, now, nextStatus, now, id,
  ).run();
  return json({ ok: true });
}

async function handleApi(request, env, url) {
  if (url.pathname === "/api/config" && request.method === "GET") {
    const siteKey = env.TURNSTILE_SITE_KEY && !String(env.TURNSTILE_SITE_KEY).startsWith("REPLACE_")
      ? env.TURNSTILE_SITE_KEY
      : null;
    return json({ ok: true, turnstileSiteKey: siteKey, postingEnabled: Boolean(siteKey && env.TURNSTILE_SECRET && env.DB) });
  }
  if (!env.DB) return fail("共有レポート機能のデータベース設定が完了していません。", 503);
  if (url.pathname === "/api/reports") return publicReports(request, env, url);
  if (url.pathname === "/api/reports" && request.method === "POST") return createReport(request, env, url);
  if (url.pathname === "/api/admin/reports" || url.pathname.startsWith("/api/admin/reports/")) {
    return adminApi(request, env, url);
  }
  return fail("APIが見つかりません。", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        // Public submission uses POST /api/reports; GET is handled by publicReports.
        if (url.pathname === "/api/reports" && request.method === "POST") {
          if (!env.DB) return fail("共有レポート機能のデータベース設定が完了していません。", 503);
          return await createReport(request, env, url);
        }
        return await handleApi(request, env, url);
      } catch (error) {
        console.error("API error", error);
        return fail("サーバー側でエラーが発生しました。時間をおいて再度お試しください。", 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
