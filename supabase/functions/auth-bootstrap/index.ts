import { createClient } from "npm:@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizePhone(value: unknown) {
  const original = String(value || "").trim();
  const digits = original.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new Error("请输入有效手机号");
  if (original.startsWith("+")) return `+${digits}`;
  if (/^1[3-9]\d{9}$/.test(digits)) return `+86${digits}`;
  if (/^86[1-9]\d{10}$/.test(digits)) return `+${digits}`;
  return `+${digits}`;
}

function authEmailForPhone(phone: string) {
  const digits = normalizePhone(phone).replace(/\D/g, "");
  return `phone.${digits}@eylrztkwmpgaawdvdcjj.supabase.co`;
}

async function findAuthUser(admin: ReturnType<typeof createClient>, email: string, phone: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((user) => user.email === email || user.phone === phone);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "仅支持 POST 请求" });

  try {
    const { phone, password } = await req.json();
    if (!String(phone || "").trim() || !String(password || "")) {
      return json(400, { error: "请输入手机号和密码" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "云端登录配置缺失" });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const normalizedPhone = normalizePhone(phone);
    const authEmail = authEmailForPhone(normalizedPhone);
    const { data: profile, error: lookupError } = await admin.rpc("zidu_legacy_auth_lookup", {
      p_phone: String(phone).trim(),
      p_password: String(password),
    });
    if (lookupError) throw lookupError;
    if (profile?.error) return json(401, { error: profile.error });

    let authUser = profile.authUserId
      ? (await admin.auth.admin.getUserById(profile.authUserId)).data.user
      : null;
    let createdNow = false;

    if (!authUser) authUser = await findAuthUser(admin, authEmail, normalizedPhone);
    if (!authUser) {
      const { data, error } = await admin.auth.admin.createUser({
        email: authEmail,
        password: String(password),
        email_confirm: true,
        app_metadata: { zidu_user_id: profile.id, zidu_role: profile.role },
        user_metadata: { name: profile.name },
      });
      if (error) throw error;
      authUser = data.user;
      createdNow = true;
    } else {
      const { data, error } = await admin.auth.admin.updateUserById(authUser.id, {
        email: authEmail,
        email_confirm: true,
        password: String(password),
        app_metadata: { ...authUser.app_metadata, zidu_user_id: profile.id, zidu_role: profile.role },
        user_metadata: { ...authUser.user_metadata, name: profile.name },
      });
      if (error) throw error;
      authUser = data.user;
    }

    if (!authUser) throw new Error("登录身份创建失败");
    const { data: linked, error: linkError } = await admin.rpc("zidu_link_auth_user", {
      p_user_id: profile.id,
      p_auth_user_id: authUser.id,
      p_auth_phone: normalizedPhone,
    });
    if (linkError || linked?.error) {
      if (createdNow) await admin.auth.admin.deleteUser(authUser.id);
      throw linkError || new Error(linked.error);
    }

    return json(200, { success: true, phone: normalizedPhone, email: authEmail });
  } catch (error) {
    const message = error instanceof Error ? error.message : "账号升级失败";
    return json(500, { error: message });
  }
});
