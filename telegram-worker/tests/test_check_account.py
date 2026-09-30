"""Unit tests for pure helpers of check_account.py (stdlib only: python3 -m unittest)."""
from __future__ import annotations

import base64
import io
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import check_account as ca  # noqa: E402


# Mirrors of Telethon's hierarchy (telethon.errors): matching is by class name + RPC message.
class RPCError(Exception):
    code: int | None = None

    def __init__(self, message: str, code: int | None = None) -> None:
        super().__init__(f"{message} (caused by SomeRequest)")
        self.message = message
        if code is not None:
            self.code = code


class FloodError(RPCError):
    code = 420


class FloodWaitError(FloodError):
    def __init__(self, seconds: int) -> None:
        super().__init__(f"FLOOD_WAIT_{seconds}")
        self.seconds = seconds

    def __str__(self) -> str:
        return f"A wait of {self.seconds} seconds is required (caused by UpdateUsernameRequest)"


class UnauthorizedError(RPCError):
    code = 401


class AuthKeyUnregisteredError(UnauthorizedError):
    pass


class UserDeactivatedBanError(UnauthorizedError):
    pass


class BadRequestError(RPCError):
    code = 400


class PeerFloodError(BadRequestError):
    pass


class ClassifyErrorTest(unittest.TestCase):
    def test_flood_wait_is_flood_with_wait_seconds(self) -> None:
        exc = FloodWaitError(30)
        self.assertEqual(ca.classify_error(exc), "flood")
        self.assertEqual(ca.flood_wait_seconds(exc), 30)
        self.assertEqual(ca.error_result(exc)["waitSec"], 30)

    def test_flood_wait_is_not_frozen_despite_code_420(self) -> None:
        self.assertFalse(ca.is_frozen_rpc(FloodWaitError(5)))

    def test_frozen_method_invalid_with_code_420_is_frozen(self) -> None:
        exc = FloodError("FROZEN_METHOD_INVALID")
        self.assertEqual(ca.classify_error(exc), "frozen")
        self.assertTrue(ca.is_frozen_rpc(exc))
        self.assertNotIn("waitSec", ca.error_result(exc))

    def test_text_containing_420_is_not_frozen(self) -> None:
        exc = RuntimeError("proxy 10.0.0.420:1080 refused")
        self.assertEqual(ca.classify_error(exc), "proxy_error")

    def test_peer_flood_is_not_a_flood_wait(self) -> None:
        exc = PeerFloodError("PEER_FLOOD")
        self.assertIsNone(ca.flood_wait_seconds(exc))
        self.assertEqual(ca.classify_error(exc), "disconnected")

    def test_wrapped_flood_wait_text_is_flood(self) -> None:
        exc = RuntimeError("A wait of 120 seconds is required (caused by GetMeRequest)")
        self.assertEqual(ca.classify_error(exc), "flood")
        self.assertEqual(ca.flood_wait_seconds(exc), 120)

    def test_auth_key_unregistered_is_unauthorized(self) -> None:
        self.assertEqual(ca.classify_error(AuthKeyUnregisteredError("AUTH_KEY_UNREGISTERED")), "unauthorized")

    def test_deactivated_ban_is_frozen(self) -> None:
        self.assertEqual(ca.classify_error(UserDeactivatedBanError("USER_DEACTIVATED_BAN")), "frozen")

    def test_connection_failure_without_proxy_is_disconnected(self) -> None:
        self.assertEqual(ca.classify_error(OSError("[Errno 61] Connect call failed")), "disconnected")

    def test_error_result_keeps_output_shape(self) -> None:
        out = ca.error_result(RuntimeError("boom"), messages=[])
        self.assertEqual(out, {"ok": False, "status": "disconnected", "error": "boom", "messages": []})


def _zip_b64(files: dict[str, bytes]) -> str:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return base64.b64encode(buf.getvalue()).decode("ascii")


class _FakeClient:
    pass


class RefreshedSessionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="ca-test-"))
        self.session = self.tmp / "uniseller_new.session"
        self.session.write_bytes(b"NEW-SESSION")
        self.payload = {"zipBase64": _zip_b64({"tdata/key_datas": b"K", ca.REFRESHED_SESSION_NAME: b"OLD"})}

    def test_refreshed_archive_keeps_tdata_and_replaces_session(self) -> None:
        client = _FakeClient()
        client._uniseller_refreshed_file = str(self.session)
        out = ca.attach_refreshed_session({"ok": True}, client, self.payload)

        self.assertTrue(out["sessionRefreshed"])
        self.assertEqual(out["refreshedSession"]["apiId"], ca.TDESKTOP_API_ID)
        raw = base64.b64decode(out["refreshedSession"]["zipBase64"])
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            self.assertEqual(sorted(zf.namelist()), sorted([ca.REFRESHED_SESSION_NAME, "tdata/key_datas"]))
            self.assertEqual(zf.read(ca.REFRESHED_SESSION_NAME), b"NEW-SESSION")

    def test_not_refreshed_without_new_session(self) -> None:
        out = ca.attach_refreshed_session({"ok": True}, _FakeClient(), self.payload)
        self.assertEqual(out, {"ok": True, "sessionRefreshed": False})

    def test_never_reports_refreshed_when_archive_cannot_be_built(self) -> None:
        client = _FakeClient()
        client._uniseller_refreshed_file = str(self.tmp / "missing.session")
        out = ca.attach_refreshed_session({"ok": True}, client, self.payload)
        self.assertFalse(out["sessionRefreshed"])
        self.assertNotIn("refreshedSession", out)
        self.assertIn("sessionRefreshError", out)


class WorkDirTest(unittest.TestCase):
    def test_work_dir_lives_inside_node_provided_dir(self) -> None:
        parent = tempfile.mkdtemp(prefix="uniseller-acc-parent-")
        os.environ["UNISELLER_WORK_DIR"] = parent
        try:
            work = ca.make_work_dir()
        finally:
            del os.environ["UNISELLER_WORK_DIR"]
        self.assertEqual(work.parent, Path(parent))
        self.assertTrue(work.name.startswith("uniseller-acc-"))


if __name__ == "__main__":
    unittest.main()
