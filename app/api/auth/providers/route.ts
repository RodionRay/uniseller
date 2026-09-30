import { NextResponse } from "next/server";
import { authProviders, makeTelegramState } from "@/lib/oauth";
import { registrationOpen } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Also issues the Telegram login state (cookie + nonce for data-auth-url). */
export async function GET(req: Request) {
  const providers = { ...authProviders(), registrationOpen: registrationOpen() };
  if (!providers.telegram) {
    return NextResponse.json(
      { ...providers, telegramState: "" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const state = await makeTelegramState(req.url);
  const res = NextResponse.json(
    { ...providers, telegramState: state.nonce },
    { headers: { "Cache-Control": "no-store" } },
  );
  res.cookies.set(state.cookie.name, state.cookie.value, state.cookie.options);
  return res;
}
