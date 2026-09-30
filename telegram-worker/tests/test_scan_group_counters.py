"""scan_group reports why fetched messages were dropped (a 0-lead scan must name its filter).

Run: telegram-worker/.venv/bin/python -m unittest discover -s telegram-worker/tests
"""
from __future__ import annotations

import asyncio
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import check_account as ca  # noqa: E402
from telethon.tl.types import User  # noqa: E402


def _msg(mid: int, text: str, age_days: float) -> SimpleNamespace:
    sender = User(id=1000 + mid, first_name="U", bot=False)

    async def get_sender() -> User:
        return sender

    return SimpleNamespace(
        id=mid,
        message=text,
        date=datetime.now(timezone.utc) - timedelta(days=age_days),
        reply_to=None,
        get_sender=get_sender,
    )


class _Client:
    def __init__(self, messages: list[SimpleNamespace]) -> None:
        self._messages = messages

    async def iter_messages(self, _entity, limit: int = 0, **_kw):
        for m in self._messages[:limit]:
            yield m


def _scan(messages: list[SimpleNamespace], days: int, minus: list[str] | None = None) -> dict:
    entity = SimpleNamespace(id=42, title="G", broadcast=False, megagroup=True)
    with mock.patch.object(ca, "_resolve_entity", mock.AsyncMock(return_value=(entity, None))), mock.patch.object(
        ca, "_is_member", mock.AsyncMock(return_value=True)
    ):
        return asyncio.run(
            ca.scan_group(_Client(messages), "https://t.me/grp_one", ["ищу сервис"], minus or [], limit=40, days=days)
        )


class ScanGroupCountersTest(unittest.TestCase):
    def test_messages_older_than_depth_are_counted_with_date_range(self) -> None:
        msgs = [_msg(i, "ищу сервис для остатков", 200 + i) for i in range(1, 4)]
        res = _scan(msgs, days=90)
        self.assertEqual(res["messages"], [])
        self.assertEqual(res["fetched"], 3)
        self.assertEqual(res["skippedOld"], 3)
        self.assertEqual(res["newestAt"], msgs[0].date.isoformat())
        self.assertEqual(res["oldestAt"], msgs[-1].date.isoformat())

    def test_fresh_intent_message_passes_and_nothing_counted_old(self) -> None:
        res = _scan([_msg(1, "ищу сервис для остатков", 1)], days=90)
        self.assertEqual(len(res["messages"]), 1)
        self.assertEqual(res["skippedOld"], 0)

    def test_minus_hits_name_the_terms_that_dropped_messages(self) -> None:
        msgs = [
            _msg(1, "Штраф за карточки, ищу сервис", 1),
            _msg(2, "Опять штраф, ищу сервис", 1),
            _msg(3, "Продам карточки, ищу сервис", 1),
            _msg(4, "Таро расклад, ищу сервис", 1),
        ]
        res = _scan(msgs, days=90, minus=["штраф", "карточки"])
        self.assertEqual(res["skippedMinus"], 4)
        # Owner terms by count desc; AD_MARKERS hits are reported under their own term too.
        self.assertEqual(res["minusHits"], [["штраф", 2], ["карточки", 1], ["таро", 1]])


if __name__ == "__main__":
    unittest.main()
