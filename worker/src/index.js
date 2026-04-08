import { buildPushHTTPRequest } from "@pushforge/builder";

// Bin collection dates (same as in index.html)
const greenDates = [
  [2026,2,4],[2026,2,18],
  [2026,3,4],[2026,3,18],
  [2026,4,1],[2026,4,15],[2026,4,29],
  [2026,5,13],[2026,5,28],
  [2026,6,10],[2026,6,24],
  [2026,7,8],[2026,7,22],
  [2026,8,5],[2026,8,19],
  [2026,9,3],[2026,9,16],[2026,9,30],
  [2026,10,14],[2026,10,28],
  [2026,11,11],[2026,11,25],
  [2026,12,9],[2026,12,23],
  [2027,1,8],[2027,1,20],
  [2027,2,3],[2027,2,17],
  [2027,3,3],[2027,3,17],
];

const blackDates = [
  [2026,2,11],[2026,2,25],
  [2026,3,11],[2026,3,25],
  [2026,4,9],[2026,4,22],
  [2026,5,7],[2026,5,20],
  [2026,6,3],[2026,6,17],
  [2026,7,1],[2026,7,15],[2026,7,29],
  [2026,8,12],[2026,8,26],
  [2026,9,9],[2026,9,23],
  [2026,10,7],[2026,10,21],
  [2026,11,4],[2026,11,18],
  [2026,12,2],[2026,12,16],
  [2027,1,2],[2027,1,14],[2027,1,27],
  [2027,2,10],[2027,2,24],
  [2027,3,10],[2027,3,24],
];

function getTomorrowBinType() {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(now);
  const y = +parts.find(p => p.type === "year").value;
  const m = +parts.find(p => p.type === "month").value;
  const d = +parts.find(p => p.type === "day").value;

  for (const [gy, gm, gd] of greenDates) {
    if (gy === y && gm === m && gd === d) return "green";
  }
  for (const [by, bm, bd] of blackDates) {
    if (by === y && bm === m && bd === d) return "black";
  }
  return null;
}

function isUK7pm() {
  const now = new Date();
  const ukHour = parseInt(now.toLocaleString("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }));
  return ukHour === 19;
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function handleSubscribe(request, env) {
  const subscription = await request.json();
  const key = await hashEndpoint(subscription.endpoint);
  await env.PUSH_SUBS.put(key, JSON.stringify(subscription));
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

async function handleUnsubscribe(request, env) {
  const { endpoint } = await request.json();
  const key = await hashEndpoint(endpoint);
  await env.PUSH_SUBS.delete(key);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

async function hashEndpoint(endpoint) {
  const data = new TextEncoder().encode(endpoint);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sendPushToAll(env, binType) {
  const label = binType === "green" ? "Green (Waste)" : "Black (Recycling)";
  const payload = {
    title: "Bin Day Tomorrow",
    body: `Put your ${label} bin out tonight!`,
    icon: "/bin-collection/icon-192.png",
    url: "/bin-collection/",
  };

  const list = await env.PUSH_SUBS.list();
  const results = [];

  for (const key of list.keys) {
    const subJson = await env.PUSH_SUBS.get(key.name);
    if (!subJson) continue;
    const subscription = JSON.parse(subJson);

    try {
      const { endpoint, headers, body } = await buildPushHTTPRequest({
        privateJWK: JSON.parse(env.VAPID_PRIVATE_KEY),
        subscription,
        message: {
          payload,
          adminContact: "mailto:noreply@timhoare.github.io",
          options: { ttl: 3600, urgency: "high" },
        },
      });

      const resp = await fetch(endpoint, { method: "POST", headers, body });

      if (resp.status === 410 || resp.status === 404) {
        // Subscription expired — clean up
        await env.PUSH_SUBS.delete(key.name);
        results.push({ endpoint: subscription.endpoint, status: "expired, removed" });
      } else {
        results.push({ endpoint: subscription.endpoint, status: resp.status });
      }
    } catch (err) {
      results.push({ endpoint: subscription.endpoint, error: err.message });
    }
  }

  return results;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    const url = new URL(request.url);

    if (url.pathname === "/subscribe" && request.method === "POST") {
      return handleSubscribe(request, env);
    }

    if (url.pathname === "/unsubscribe" && request.method === "POST") {
      return handleUnsubscribe(request, env);
    }

    if (url.pathname === "/test-push" && request.method === "POST") {
      const binType = "green"; // test with green bin
      const results = await sendPushToAll(env, binType);
      return new Response(JSON.stringify(results, null, 2), {
        headers: { "Content-Type": "application/json", ...corsHeaders(env) },
      });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    // Only send at 7pm UK time (cron fires at both 18:00 and 19:00 UTC to cover BST/GMT)
    if (!isUK7pm()) return;

    const binType = getTomorrowBinType();
    if (!binType) return;

    ctx.waitUntil(sendPushToAll(env, binType));
  },
};
