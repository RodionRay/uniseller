import { NextResponse } from "next/server";
import { authProviders } from "@/lib/oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(authProviders(), {
    headers: { "Cache-Control": "no-store" },
  });
}
