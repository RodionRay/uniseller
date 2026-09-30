import { NextResponse } from "next/server";
import { authProviders } from "@/lib/oauth";
import { registrationOpen } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ...authProviders(), registrationOpen: registrationOpen() }, {
    headers: { "Cache-Control": "no-store" },
  });
}
