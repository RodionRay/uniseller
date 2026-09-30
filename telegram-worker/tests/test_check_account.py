"""Unit tests for pure helpers of check_account.py (stdlib only: python3 -m unittest)."""
from __future__ import annotations

import asyncio
import base64
import io
import os
import sys
import tempfile
import types
import unittest
import zipfile
from pathlib import Path
from unittest import mock

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


class FloodResultTest(unittest.TestCase):
    def test_flood_result_has_status_wait_and_legacy_field(self) -> None:
        out = ca.flood_result(FloodWaitError(45), join="flood")
        self.assertEqual(out["status"], "flood")
        self.assertEqual(out["waitSec"], 45)
        self.assertEqual(out["floodWait"], 45)
        self.assertEqual(out["join"], "flood")
        self.assertFalse(out["ok"])

    def test_invite_flood_keeps_legacy_status_and_adds_flood_flag(self) -> None:
        out = ca.invite_flood_result(FloodWaitError(90), results=[{"ok": True}], title="G")
        self.assertEqual(out["status"], "floodwait")
        self.assertTrue(out["flood"])
        self.assertEqual(out["waitSec"], 90)
        self.assertEqual(out["floodWait"], 90)
        self.assertEqual(out["results"], [{"ok": True}])
        self.assertEqual(out["title"], "G")


class SendRpcErrorResultTest(unittest.TestCase):
    def test_flood_wait_class_is_flood_with_wait(self) -> None:
        out = ca.send_rpc_error_result(FloodWaitError(30))
        self.assertEqual((out["status"], out["waitSec"]), ("flood", 30))

    def test_rpc_text_mentioning_flood_is_not_a_flood_wait(self) -> None:
        out = ca.send_rpc_error_result(BadRequestError("CHAT_FLOOD_PROTECTION_ENABLED"))
        self.assertNotEqual(out.get("status"), "flood")
        self.assertNotIn("waitSec", out)

    def test_peer_flood_is_spamblock(self) -> None:
        out = ca.send_rpc_error_result(PeerFloodError("PEER_FLOOD"))
        self.assertEqual(out["status"], "spamblock")
        self.assertIn("PEER_FLOOD", out["error"])
        self.assertNotIn("waitSec", out)

    def test_frozen_method_is_frozen(self) -> None:
        self.assertEqual(ca.send_rpc_error_result(FloodError("FROZEN_METHOD_INVALID"))["status"], "frozen")

    def test_write_forbidden_is_spamblock(self) -> None:
        self.assertEqual(ca.send_rpc_error_result(BadRequestError("CHAT_WRITE_FORBIDDEN"))["status"], "spamblock")

    def test_other_rpc_error_has_no_status(self) -> None:
        out = ca.send_rpc_error_result(BadRequestError("MESSAGE_EMPTY"))
        self.assertEqual(out, {"ok": False, "error": "MESSAGE_EMPTY (caused by SomeRequest)"})


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


class _OpenTeleException(BaseException):
    """Mirror of opentele.exception.OpenTeleException: a BaseException, not an Exception."""


class _TDesktopUnauthorized(_OpenTeleException):
    pass


class _AuthClient:
    def __init__(self, authorized: bool) -> None:
        self.authorized = authorized

    async def connect(self) -> None:
        return None

    async def is_user_authorized(self) -> bool:
        return self.authorized

    async def disconnect(self) -> None:
        return None


def _fake_opentele(*, current_authorized: bool = False) -> dict[str, types.ModuleType]:
    """opentele stand-in: CreateNewSession raises TDesktopUnauthorized, as opentele does for a dead tdata."""
    use_current, create_new = object(), object()

    class TDesktop:
        def __init__(self, path: str) -> None:
            self.path = path

        def isLoaded(self) -> bool:
            return True

        async def ToTelethon(self, **kwargs: object) -> _AuthClient:
            if kwargs["flag"] is create_new:
                raise _TDesktopUnauthorized("TDesktop client is unauthorized")
            return _AuthClient(current_authorized)

    root = types.ModuleType("opentele")
    td = types.ModuleType("opentele.td")
    td.TDesktop = TDesktop  # type: ignore[attr-defined]
    api = types.ModuleType("opentele.api")
    api.UseCurrentSession = use_current  # type: ignore[attr-defined]
    api.CreateNewSession = create_new  # type: ignore[attr-defined]
    api.API = types.SimpleNamespace(TelegramDesktop=object())  # type: ignore[attr-defined]
    exc = types.ModuleType("opentele.exception")
    exc.OpenTeleException = _OpenTeleException  # type: ignore[attr-defined]
    exc.TDesktopUnauthorized = _TDesktopUnauthorized  # type: ignore[attr-defined]
    return {"opentele": root, "opentele.td": td, "opentele.api": api, "opentele.exception": exc}


class DeadTdataTest(unittest.TestCase):
    """Logged-out tdata: opentele raises TDesktopUnauthorized (BaseException) from CreateNewSession."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="ca-dead-"))
        self.payload = {
            "format": "tdata",
            "zipBase64": _zip_b64({"acc/tdata/key_datas": b"K", "acc/acc.session": b"S"}),
        }

    def _open(self, session_authorized: bool):
        async def fake_session_file(*_args: object) -> _AuthClient:
            return _AuthClient(session_authorized)

        with mock.patch.dict(sys.modules, _fake_opentele()), mock.patch.object(
            ca, "load_client_from_session_file", fake_session_file
        ):
            return asyncio.run(ca.open_client(self.payload, self.tmp))

    def test_dead_tdata_is_classified_unauthorized(self) -> None:
        with mock.patch.dict(sys.modules, _fake_opentele()):
            with self.assertRaises(Exception) as ctx:
                asyncio.run(ca.load_client_from_tdata(self.tmp, None, ""))
        self.assertEqual(ca.classify_error(ctx.exception), "unauthorized")

    def test_dead_tdata_falls_back_to_live_session_file(self) -> None:
        client = self._open(session_authorized=True)
        self.assertTrue(client.authorized)

    def test_dead_tdata_and_session_report_unauthorized_status(self) -> None:
        with self.assertRaises(Exception) as ctx:
            self._open(session_authorized=False)
        self.assertEqual(ca.error_result(ctx.exception)["status"], "unauthorized")


if __name__ == "__main__":
    unittest.main()
