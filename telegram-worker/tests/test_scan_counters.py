"""scan_group reports its funnel counters (fetched / skippedMinus / skippedKw / skippedNotUser) in every mode.

Run: telegram-worker/.venv/bin/python -m unittest discover -s telegram-worker/tests
"""
from __future__ import annotations

import asyncio
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import check_account as ca  # noqa: E402
from telethon.tl.types import User  # noqa: E402

PERSON = User(id=1, first_name="Анна", bot=False)
NOT_A_PERSON = SimpleNamespace(id=2, title="Канал")

GROUP = SimpleNamespace(id=10, title="G", broadcast=False, megagroup=True)
CHANNEL = SimpleNamespace(id=20, title="C", broadcast=True, megagroup=False)
DISCUSSION = SimpleNamespace(id=30, title="D", broadcast=False, megagroup=True)


def msg(mid: int, text: str, sender: Any = PERSON) -> SimpleNamespace:
    async def get_sender() -> Any:
        return sender

    return SimpleNamespace(
        id=mid,
        message=text,
        date=datetime.now(timezone.utc),
        reply_to=None,
        get_sender=get_sender,
    )


def funnel(base: int) -> list[SimpleNamespace]:
    """One message per outcome: stop-list hit, no keyword, non-person sender, lead."""
    return [
        msg(base + 1, "Лучшее казино онлайн"),
        msg(base + 2, "Всем привет, как погода"),
        msg(base + 3, "Ищу сервис для остатков", sender=NOT_A_PERSON),
        msg(base + 4, "Ищу сервис для остатков на WB"),
    ]


class FakeClient:
    def __init__(self, linked: SimpleNamespace | None, feeds: dict[str, list[SimpleNamespace]]) -> None:
        self.linked = linked
        self.feeds = feeds

    async def __call__(self, request: Any) -> Any:
        if type(request).__name__ == "JoinChannelRequest":
            raise RuntimeError("join refused")
        linked_id = self.linked.id if self.linked else None
        return SimpleNamespace(full_chat=SimpleNamespace(linked_chat_id=linked_id))

    async def get_entity(self, _peer: Any) -> Any:
        return self.linked

    async def iter_messages(self, entity: Any, limit: int = 0, reply_to: int | None = None):
        if reply_to is not None:
            key = f"replies:{reply_to}"
        elif entity is self.linked:
            key = "discussion"
        else:
            key = "feed"
        for m in self.feeds.get(key, []):
            yield m


async def resolve_to(entity: Any):
    return entity, None


def scan(client: FakeClient, entity: Any) -> dict[str, Any]:
    async def run() -> dict[str, Any]:
        with mock.patch.object(ca, "_resolve_entity", lambda _c, _u: resolve_to(entity)), mock.patch.object(
            ca, "_is_member", mock.AsyncMock(return_value=True)
        ):
            return await ca.scan_group(client, "https://t.me/example", ["остатк"], ["казино"])

    return asyncio.run(run())


class ScanCountersTest(unittest.TestCase):
    def assert_funnel(self, result: dict[str, Any], mode: str, rounds: int) -> None:
        self.assertEqual(result["scanMode"], mode)
        self.assertEqual(
            {k: result[k] for k in ("fetched", "skippedMinus", "skippedKw", "skippedNotUser")},
            {"fetched": 4 * rounds, "skippedMinus": rounds, "skippedKw": rounds, "skippedNotUser": rounds},
        )
        self.assertEqual(len(result["messages"]), rounds)

    def test_group_messages_mode_reports_counters(self) -> None:
        result = scan(FakeClient(None, {"feed": funnel(0)}), GROUP)
        self.assert_funnel(result, "group_messages", 1)

    def test_channel_comments_mode_reports_counters(self) -> None:
        post = msg(100, "Пост канала")
        result = scan(FakeClient(None, {"feed": [post], "replies:100": funnel(0)}), CHANNEL)
        self.assert_funnel(result, "channel_comments", 1)

    def test_discussion_and_comments_mode_reports_counters(self) -> None:
        post = msg(100, "Пост канала")
        feeds = {"discussion": funnel(0), "feed": [post], "replies:100": funnel(10)}
        result = scan(FakeClient(DISCUSSION, feeds), CHANNEL)
        self.assert_funnel(result, "discussion_and_comments", 2)

    def test_need_discussion_join_still_reports_counters(self) -> None:
        async def member_of_channel_only(_c: Any, entity: Any) -> bool:
            return entity is not DISCUSSION

        async def run() -> dict[str, Any]:
            with mock.patch.object(ca, "_resolve_entity", lambda _c, _u: resolve_to(CHANNEL)), mock.patch.object(
                ca, "_is_member", member_of_channel_only
            ):
                return await ca.scan_group(FakeClient(DISCUSSION, {}), "https://t.me/example", ["остатк"], ["казино"])

        result = asyncio.run(run())
        self.assertTrue(result["needDiscussionJoin"])
        self.assertEqual(
            {k: result[k] for k in ("fetched", "skippedMinus", "skippedKw", "skippedNotUser")},
            {"fetched": 0, "skippedMinus": 0, "skippedKw": 0, "skippedNotUser": 0},
        )

if __name__ == "__main__":
    unittest.main()
