import { createHash } from "node:crypto";
import { createClient } from "npm:@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

const defaultCarrierCodes: Record<string, string> = {
  "顺丰": "shunfeng",
  "顺丰速运": "shunfeng",
  "韵达": "yunda",
  "韵达快递": "yunda",
  "加运美": "jiayunmeiwuliu",
  "德邦": "debangwuliu",
  "德邦物流": "debangwuliu",
  "德邦快递": "debangkuaidi",
  "壹米滴答": "yimidida",
  "壹米滴答快运": "yimidida",
  "中通": "zhongtong",
  "中通快递": "zhongtong",
  "圆通": "yuantong",
  "圆通速递": "yuantong",
  "申通": "shentong",
  "申通快递": "shentong",
  "京东": "jd",
  "京东物流": "jd",
  "极兔": "jtexpress",
  "极兔速递": "jtexpress",
  "邮政EMS": "ems",
  "EMS": "ems",
  "跨越速运": "kuayue",
};

const stateLabels: Record<string, string> = {
  "0": "运输中",
  "1": "已揽收",
  "2": "物流异常",
  "3": "已签收",
  "4": "退签",
  "5": "派送中",
  "6": "退回中",
  "7": "已转单",
  "8": "清关中",
  "10": "待清关",
  "11": "清关中",
  "12": "已清关",
  "13": "清关异常",
  "14": "拒签",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function getCarrierCodes() {
  const custom = Deno.env.get("KUAIDI100_CARRIER_CODES");
  if (!custom) return defaultCarrierCodes;
  try {
    return { ...defaultCarrierCodes, ...JSON.parse(custom) };
  } catch {
    return defaultCarrierCodes;
  }
}

function normalizeEvents(data: unknown) {
  if (!Array.isArray(data)) return [];
  return data.slice(0, 60).map((item: Record<string, unknown>) => ({
    time: String(item.ftime || item.time || ""),
    context: String(item.context || ""),
    location: String(item.location || ""),
    status: String(item.statusCode || item.status || ""),
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "仅支持 POST 请求" });

  try {
    const { orderId } = await req.json();
    if (!Number(orderId)) return json(400, { error: "缺少有效订单编号" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: shipment, error: shipmentError } = await supabase
      .from("shipments")
      .select("*")
      .eq("order_id", Number(orderId))
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (shipmentError) throw shipmentError;
    if (!shipment) return json(404, { error: "该订单尚未填写物流信息" });

    const lastQueryAt = shipment.tracking_updated_at
      ? new Date(shipment.tracking_updated_at).getTime()
      : 0;
    if (lastQueryAt && Date.now() - lastQueryAt < 30 * 60 * 1000) {
      return json(200, { shipment, cached: true });
    }

    const key = Deno.env.get("KUAIDI100_KEY") || "";
    const customer = Deno.env.get("KUAIDI100_CUSTOMER") || "";
    if (!key || !customer) {
      return json(503, {
        error: "物流查询尚未配置，请先设置 KUAIDI100_KEY 和 KUAIDI100_CUSTOMER",
      });
    }

    const carrier = String(shipment.carrier || "").trim();
    const companyCode = getCarrierCodes()[carrier];
    if (!companyCode) {
      return json(400, { error: `暂不支持自动查询“${carrier}”，请检查快递公司名称` });
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("customer_id")
      .eq("id", Number(orderId))
      .single();
    if (orderError) throw orderError;

    let phone = "";
    if (order?.customer_id) {
      const { data: customerRow } = await supabase
        .from("customers")
        .select("phone")
        .eq("id", order.customer_id)
        .maybeSingle();
      phone = String(customerRow?.phone || "").replace(/\s/g, "");
    }

    const paramObject: Record<string, string> = {
      com: companyCode,
      num: String(shipment.tracking_no || "").trim(),
      resultv2: "4",
      show: "0",
      order: "desc",
      lang: "zh",
    };
    if (phone) paramObject.phone = phone;

    const param = JSON.stringify(paramObject);
    const sign = createHash("md5").update(param + key + customer).digest("hex").toUpperCase();
    const form = new URLSearchParams({ customer, sign, param });
    const response = await fetch("https://poll.kuaidi100.com/poll/query.do", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const payload = await response.json();
    const updatedAt = new Date().toISOString();

    if (!response.ok || String(payload.status || "") !== "200") {
      const message = String(payload.message || "物流服务暂时未返回轨迹，请稍后再试");
      await supabase.from("shipments").update({
        tracking_message: message,
        tracking_updated_at: updatedAt,
      }).eq("id", shipment.id);
      return json(502, { error: message });
    }

    const events = normalizeEvents(payload.data);
    const stateCode = String(payload.state || "0");
    const state = stateLabels[stateCode] || "运输中";
    const latestMessage = events[0]?.context || String(payload.message || state);
    const patch = {
      tracking_state: state,
      tracking_state_code: stateCode,
      tracking_message: latestMessage,
      tracking_events: events,
      tracking_updated_at: updatedAt,
    };
    const { data: updatedShipment, error: updateError } = await supabase
      .from("shipments")
      .update(patch)
      .eq("id", shipment.id)
      .select("*")
      .single();
    if (updateError) throw updateError;

    return json(200, { shipment: updatedShipment, cached: false });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : "物流查询失败" });
  }
});
