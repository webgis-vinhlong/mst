/**
 * GeoVina security proxy for the MST static site.
 *
 * Deploy on Cloudflare Workers and store the API key as a secret:
 *   npx wrangler secret put GEOVINA_API_KEY
 *
 * Never commit the GeoVina key to this repository.
 */
const UPSTREAM = "https://geovina.io.vn";

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "https://webgis-vinhlong.github.io")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "Cache-Control": "public, max-age=300"
  };
}

function json(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request, env)
    }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env)
      });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, request, env);
    }

    if (!env.GEOVINA_API_KEY) {
      return json({ error: "Server missing GEOVINA_API_KEY" }, 500, request, env);
    }

    const incoming = new URL(request.url);
    const path = incoming.pathname.replace(/\/+$/, "") || "/";
    const allowedPaths = new Set(["/parse", "/new-boundaries"]);

    if (!allowedPaths.has(path)) {
      return json({ error: "Not found" }, 404, request, env);
    }

    let target;

    if (path === "/parse") {
      const address = (incoming.searchParams.get("address") || "").trim();
      if (address.length < 3 || address.length > 300) {
        return json({ error: "Invalid address" }, 400, request, env);
      }

      target = new URL(`${UPSTREAM}/api/parse`);
      target.searchParams.set("address", address);
    } else {
      const type = incoming.searchParams.get("type") || "";
      const ids = incoming.searchParams.get("province_ids") || "";

      if (!["new-province", "new-ward"].includes(type) || !/^\d{2}(,\d{2}){0,2}$/.test(ids)) {
        return json({ error: "Invalid boundary query" }, 400, request, env);
      }

      target = new URL(`${UPSTREAM}/new-boundaries`);
      target.searchParams.set("type", type);
      target.searchParams.set("province_ids", ids);
    }

    try {
      const upstream = await fetch(target, {
        headers: {
          "Accept": "application/json",
          "X-Api-Key": env.GEOVINA_API_KEY
        },
        cf: {
          cacheTtl: 3600,
          cacheEverything: true
        }
      });

      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
          ...corsHeaders(request, env)
        }
      });
    } catch (error) {
      return json(
        {
          error: "GeoVina upstream unavailable",
          detail: String(error?.message || error)
        },
        502,
        request,
        env
      );
    }
  }
};
