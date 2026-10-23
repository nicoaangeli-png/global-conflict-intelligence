import { instrumentRoute } from "@/server/observability/http";
import { NextResponse } from "next/server";
import { getCountryIndicators } from "@/server/countryIndicators";
import { getCountryLeaders } from "@/server/leaders";
import { guardPublicApi } from "@/server/publicApi/limits";
import { validatePublicQuery } from "@/server/publicApi/parameters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = instrumentRoute("/api/country", GETHandler);
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const invalid = validatePublicQuery(params);
  if (invalid) return invalid;
  const iso = params.get("iso");
  const headers = { "Cache-Control": "no-store" };
  if (!iso || !/^[A-Z]{3}$/.test(iso)) {
    return NextResponse.json({ error: "iso must be an uppercase ISO alpha-3 code" }, { status: 400, headers });
  }
  const limited = await guardPublicApi(request, "country");
  if (limited) return limited;
  try {
    const [indicators, leaders] = await Promise.all([getCountryIndicators(iso), getCountryLeaders(iso)]);
    if (!indicators) {
      return NextResponse.json({ error: "Country not found in the country referential" }, { status: 404, headers });
    }
    const status = indicators.population.status === "error" && indicators.gdp.status === "error" ? 502 : 200;
    return NextResponse.json({ ...indicators, leaders }, { status, headers });
  } catch {
    return NextResponse.json({ error: "Country indicators service unavailable" }, { status: 503, headers });
  }
}
