import { describe, expect, it } from "vitest";
import {
  accountAvatarColor,
  accountLimitsUsage,
  accountUpdatedAt,
  applyQuotaCooldownIfExhausted,
  canPollDmInbox,
  cooldownRemainingShort,
  isAccountUsable,
  relativeTimeRu,
  withDayLimitCooldown,
  withFrozenStatus,
  withSpamblockStatus,
} from "@/lib/telegram-accounts";

describe("менеджер аккаунтов · helpers", () => {
  it("считает дневные лимиты used/limit", () => {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const u = accountLimitsUsage({
      limits: { invite: 30, message: 10, chat: 10, memberInvite: 40 },
      joinsToday: 2,
      joinsDay: day,
      messagesToday: 0,
      messagesDay: day,
      memberInvitesToday: 1,
      memberInviteDay: day,
    });
    expect(u).toMatchObject({
      joins: 2,
      messages: 0,
      memberInvites: 1,
      inviteLimit: 30,
      messageLimit: 10,
    });
  });

  it("форматирует остаток отлёжки и относительное время", () => {
    const now = Date.parse("2026-09-18T12:00:00.000Z");
    expect(
      cooldownRemainingShort(new Date(now + 5 * 3600_000).toISOString(), now),
    ).toMatch(/5 час/);
    expect(cooldownRemainingShort("", now)).toBe("");
    expect(
      relativeTimeRu(new Date(now - 39 * 60_000).toISOString(), now),
    ).toMatch(/39 минут назад/);
  });

  it("выбирает самое свежее обновление и цвет аватара", () => {
    expect(
      accountUpdatedAt(
        { checkingAt: "2026-09-18T10:00:00.000Z", lastJoinAt: "2026-09-17T10:00:00.000Z" },
        "2026-09-01T00:00:00.000Z",
      ),
    ).toBe("2026-09-18T10:00:00.000Z");
    expect(accountAvatarColor("a")).toMatch(/^#/);
    expect(accountAvatarColor("a")).toBe(accountAvatarColor("a"));
  });

  it("spamblock/cooldown: inbox можно, отправку нельзя", () => {
    expect(isAccountUsable({ status: "spamblock" })).toBe(false);
    expect(canPollDmInbox({ status: "spamblock" })).toBe(true);
    expect(canPollDmInbox({ status: "cooldown" })).toBe(true);
    expect(canPollDmInbox({ status: "unauthorized" })).toBe(false);
    expect(canPollDmInbox({ status: "active" })).toBe(true);
  });

  it("отлёжка только по лимиту/спаму/заморозке — не по cooldownUntil без статуса", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    // Старый фейл коннекта: active + cooldownUntil — аккаунт рабочий
    expect(isAccountUsable({ status: "active", cooldownUntil: future })).toBe(true);
    expect(isAccountUsable({ status: "disconnected", cooldownUntil: future })).toBe(false);

    const limited = withDayLimitCooldown(
      { status: "active", limits: { invite: 1 }, joinsToday: 1, joinsDay: "2099-01-01" },
      "invite",
    );
    expect(limited.status).toBe("cooldown");
    expect(limited.cooldownReason).toBe("day_invite");
    expect(isAccountUsable(limited)).toBe(false);

    const spam = withSpamblockStatus({ status: "active" }, "PEER_FLOOD");
    expect(spam.status).toBe("spamblock");
    expect(isAccountUsable(spam)).toBe(false);

    const frozen = withFrozenStatus({ status: "active" });
    expect(frozen.status).toBe("frozen");
    expect(frozen.cooldownUntil).toBe("");
    expect(isAccountUsable(frozen)).toBe(false);
  });

  it("applyQuotaCooldownIfExhausted ставит отлёжку при исчерпании лимита", () => {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const out = applyQuotaCooldownIfExhausted({
      status: "active",
      limits: { invite: 2, message: 40, chat: 40, memberInvite: 40 },
      joinsToday: 2,
      joinsDay: day,
    });
    expect(out.status).toBe("cooldown");
    expect(String(out.error)).toMatch(/вступлений/);
  });
});
