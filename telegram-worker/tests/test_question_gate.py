"""Seller-question gate in scan_group: a question about marketplace ops passes without a plus keyword.

Run: telegram-worker/.venv/bin/python -m unittest discover -s telegram-worker/tests
"""
from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import check_account as ca  # noqa: E402
from test_scan_counters import GROUP, FakeClient, msg, resolve_to  # noqa: E402

FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "lead-question-gate.json"


class SharedFixtureTest(unittest.TestCase):
    """Same vocabulary and cases as tests/lead-question-gate.test.ts runs against lib/lead-question-gate.ts."""

    def setUp(self) -> None:
        self.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def test_code_vocabulary_equals_fixture(self) -> None:
        self.assertEqual(list(ca.QUESTION_STEMS), self.fixture["questionStems"])
        self.assertEqual(list(ca.QUESTION_WORDS), self.fixture["questionWords"])
        self.assertEqual(list(ca.TOPIC_STEMS), self.fixture["topicStems"])
        self.assertEqual(list(ca.TOPIC_WORDS), self.fixture["topicWords"])

    def test_python_matches_ts_fixture(self) -> None:
        cases = self.fixture["cases"]
        self.assertGreater(len(cases), 10)
        for case in cases:
            with self.subTest(text=case["text"][:40]):
                self.assertEqual(ca.has_question(case["text"]), case["question"])
                self.assertEqual(ca.seller_topic_hits(case["text"]), case["topics"])
                self.assertEqual(
                    ca.is_seller_question(case["text"]), case["question"] and bool(case["topics"])
                )


def scan(messages: list[Any], keywords: list[str]) -> dict[str, Any]:
    async def run() -> dict[str, Any]:
        with mock.patch.object(ca, "_resolve_entity", lambda _c, _u: resolve_to(GROUP)), mock.patch.object(
            ca, "_is_member", mock.AsyncMock(return_value=True)
        ):
            return await ca.scan_group(FakeClient(None, {"feed": messages}), "https://t.me/example", keywords, ["казино"])

    return asyncio.run(run())


class ScanQuestionGateTest(unittest.TestCase):
    def test_seller_question_without_plus_keyword_passes(self) -> None:
        result = scan([msg(1, "Как вы грузите остатки на три кабинета?")], ["мойсклад"])
        self.assertEqual([m["message"] for m in result["messages"]], ["Как вы грузите остатки на три кабинета?"])
        self.assertEqual(result["skippedKw"], 0)

    def test_seller_question_passes_without_any_settings_keywords(self) -> None:
        result = scan([msg(1, "Подскажите, как у вас с выгрузкой заказов в 1С")], [])
        self.assertEqual(len(result["messages"]), 1)

    def test_question_without_topic_word_is_dropped(self) -> None:
        result = scan([msg(1, "Нашёл пачку сигарет, нужны кому то??")], ["мойсклад"])
        self.assertEqual(result["messages"], [])
        self.assertEqual(result["skippedKw"], 1)

    def test_topic_statement_without_question_is_dropped(self) -> None:
        result = scan([msg(1, "Нуждаюсь в помощнице на ведение ЛК WB! Подробности в ЛС!")], ["мойсклад"])
        self.assertEqual(result["messages"], [])
        self.assertEqual(result["skippedKw"], 1)

    def test_stop_list_still_wins_over_a_seller_question(self) -> None:
        result = scan([msg(1, "Казино для селлеров WB, где взять бонус?")], ["мойсклад"])
        self.assertEqual(result["messages"], [])
        self.assertEqual(result["skippedMinus"], 1)


if __name__ == "__main__":
    unittest.main()
