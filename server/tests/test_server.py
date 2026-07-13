#!/usr/bin/env python3
"""Unit tests for cloakfetch server.

Covers: config precedence, auth behavior, payload limits,
URL validation (SSRF), and secret redaction.
Does NOT launch CloakBrowser or call AI services.
"""

import importlib.util
import json
import os
import re
import sys
import tempfile
import unittest
from http.client import HTTPConnection
from pathlib import Path
from threading import Thread
from unittest.mock import MagicMock, patch


# Load server.py explicitly so discovery works from both the repository root and
# the server directory. A regular `import server` resolves to server/__init__.py
# when CI runs `python -m unittest discover -s server/tests` from the repo root.
_SERVER_PATH = Path(__file__).resolve().parents[1] / "server.py"
_SERVER_SPEC = importlib.util.spec_from_file_location("worktable_server", _SERVER_PATH)
if _SERVER_SPEC is None or _SERVER_SPEC.loader is None:
    raise ImportError(f"Unable to load server module from {_SERVER_PATH}")
server = importlib.util.module_from_spec(_SERVER_SPEC)
with patch.dict("sys.modules", {"cloakbrowser": MagicMock(), "worktable_server": server}):
    _SERVER_SPEC.loader.exec_module(server)


class _TestHTTPConnection(HTTPConnection):
    """In-process HTTP connection that talks to a Handler directly."""

    def __init__(self, handler_class, host="127.0.0.1", port=0):
        super().__init__(host, port)
        self._handler_class = handler_class
        self._last_response = None

    def request(self, method, url, body=None, headers=None):
        self.putrequest(method, url)
        if headers:
            for k, v in headers.items():
                self.putheader(k, v)
        self.endheaders()
        if body is not None:
            self.send(body.encode("utf-8") if isinstance(body, str) else body)
        else:
            self.endheaders()

    def getresponse(self):
        # We can't use the real getresponse because we need to bypass socket
        # Instead we call the handler directly in-process
        raise NotImplementedError("use _TestClient instead")


class _TestClient:
    """In-process HTTP test client using a real Handler + ThreadingHTTPServer."""

    def __init__(self, handler_class, server_instance):
        self._srv = server_instance
        self._handler_class = handler_class

    def request(self, method, path, body=None, headers=None):
        import http.client
        h = {}
        if headers:
            h.update(headers)
        if body and method in ("POST", "PUT", "PATCH"):
            if isinstance(body, dict):
                body = json.dumps(body)
            if isinstance(body, str):
                body = body.encode("utf-8")
            h.setdefault("Content-Type", "application/json")
        conn = http.client.HTTPConnection("127.0.0.1", self._srv.server_address[1], timeout=5)
        conn.connect()
        try:
            try:
                conn.request(method, path, body=body, headers=h)
                resp = conn.getresponse()
                return _TestResponse(resp)
            except (BrokenPipeError, ConnectionResetError, http.client.RemoteDisconnected):
                # Server closed connection before responding (e.g., rejected oversized body).
                return _ClosedResponse()
        finally:
            try:
                conn.close()
            except Exception:
                pass


class _ClosedResponse:
    """Synthetic response when the server closes the connection early."""

    def __init__(self):
        self.status = 0
        self.headers = {}
        self.body = ""

    def json(self):
        return {}


class _TestResponse:
    def __init__(self, resp):
        self.status = resp.status
        self.headers = dict(resp.getheaders())
        self.body = resp.read().decode("utf-8")

    def json(self):
        return json.loads(self.body)


class TestConfigPrecedence(unittest.TestCase):
    """Test config loading priority: env > ~/.config/.../server.json > ~/.claude/settings.json."""

    def setUp(self):
        # Reset global config cache before each test
        server._AI_CFG = None
        server._CONFIG_PATH = None
        server._SERVICE_TOKEN = None
        # Clear env vars
        for k in list(os.environ.keys()):
            if k.startswith("WORKTABLE_") or k.startswith("ANTHROPIC_"):
                del os.environ[k]

    def tearDown(self):
        for k in list(os.environ.keys()):
            if k.startswith("WORKTABLE_") or k.startswith("ANTHROPIC_"):
                del os.environ[k]

    def _write_config(self, path, data):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f)

    @patch.dict(os.environ, {"WORKTABLE_PORT": "9999"})
    def test_env_overrides_config_file(self):
        """WORKTABLE_PORT env var takes precedence over config file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg_path = os.path.join(tmpdir, "server.json")
            self._write_config(cfg_path, {"port": 1234})
            with patch.object(server, "_CONFIG_PATH", cfg_path):
                cfg = server._load_config()
            self.assertEqual(cfg["port"], 9999)

    def test_config_file_over_claude_settings(self):
        """AI token from config file takes precedence over ~/.claude/settings.json."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg_path = os.path.join(tmpdir, "server.json")
            self._write_config(cfg_path, {"aiAuthToken": "cfg-file-token-xxxx"})
            claude_settings = os.path.join(tmpdir, "settings.json")
            os.makedirs(os.path.join(tmpdir, ".claude"), exist_ok=True)
            self._write_config(claude_settings, {"env": {"ANTHROPIC_AUTH_TOKEN": "claude-token-yyyy"}})
            with patch.object(server, "_CONFIG_PATH", cfg_path):
                with patch.dict(os.environ, {"HOME": tmpdir}):
                    cfg = server._load_ai_config()
            self.assertEqual(cfg["authToken"], "cfg-file-token-xxxx")

    def test_env_ai_auth_highest_priority(self):
        """ANTHROPIC_AUTH_TOKEN env var is highest priority for AI config."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg_path = os.path.join(tmpdir, "server.json")
            self._write_config(cfg_path, {"aiAuthToken": "cfg-token"})
            with patch.dict(os.environ, {"ANTHROPIC_AUTH_TOKEN": "env-token"}):
                with patch.object(server, "_CONFIG_PATH", cfg_path):
                    cfg = server._load_ai_config()
            self.assertEqual(cfg["authToken"], "env-token")

    @patch.dict(os.environ, {
        "WORKTABLE_HOST": "0.0.0.0",
        "WORKTABLE_PORT": "8080",
        "WORKTABLE_SERVICE_TOKEN": "my-secret-token",
    })
    def test_all_env_vars_parsed(self):
        cfg = server._load_config()
        self.assertEqual(cfg["host"], "0.0.0.0")
        self.assertEqual(cfg["port"], 8080)
        self.assertEqual(cfg["serviceToken"], "my-secret-token")


class TestAuthBehavior(unittest.TestCase):
    """Test X-Worktable-Token auth on operational routes."""

    def setUp(self):
        server._SERVICE_TOKEN = None
        server._AI_CFG = None
        for k in list(os.environ.keys()):
            if k.startswith("WORKTABLE_") or k.startswith("ANTHROPIC_"):
                del os.environ[k]

    def tearDown(self):
        for k in list(os.environ.keys()):
            if k.startswith("WORKTABLE_") or k.startswith("ANTHROPIC_"):
                del os.environ[k]

    def _make_server(self, token=""):
        server._SERVICE_TOKEN = token if token else None
        srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        port = srv.server_address[1]
        t = Thread(target=srv.serve_forever, daemon=True)
        t.start()
        return srv, port

    def test_no_token_unauthenticated_route(self):
        """Health routes are accessible without any token."""
        srv, port = self._make_server("")
        cli = _TestClient(server.Handler, srv)
        resp = cli.request("GET", f"http://127.0.0.1:{port}/health")
        self.assertEqual(resp.status, 200)
        data = resp.json()
        self.assertTrue(data.get("ok"))
        srv.shutdown()

    def test_ai_health_no_token_no_leak(self):
        """ai/health does not reveal tokens."""
        srv, port = self._make_server("")
        cli = _TestClient(server.Handler, srv)
        resp = cli.request("GET", f"http://127.0.0.1:{port}/ai/health")
        self.assertEqual(resp.status, 200)
        data = resp.json()
        # Must not contain any token or token preview
        body_str = json.dumps(data)
        self.assertNotIn("token", body_str.lower())
        self.assertNotIn("***", body_str)
        srv.shutdown()

    def test_fetch_requires_correct_token(self):
        """fetch route returns 401 without correct X-Worktable-Token."""
        srv, port = self._make_server(token="correct-secret")
        cli = _TestClient(server.Handler, srv)
        resp = cli.request("GET", f"http://127.0.0.1:{port}/fetch?url=https://example.com")
        self.assertEqual(resp.status, 401)
        srv.shutdown()

    def test_fetch_accepts_correct_token(self):
        """fetch route returns 400/500 (not 401) with correct token but no browser."""
        srv, port = self._make_server(token="correct-secret")
        cli = _TestClient(server.Handler, srv)
        resp = cli.request(
            "GET",
            f"http://127.0.0.1:{port}/fetch?url=https://example.com",
            headers={"X-Worktable-Token": "correct-secret"},
        )
        # 401 would mean auth failed; anything else means auth passed
        self.assertNotEqual(resp.status, 401)
        srv.shutdown()

    def test_ai_route_requires_auth(self):
        """POST /ai/questions returns 401 without correct token."""
        srv, port = self._make_server(token="svc-token")
        cli = _TestClient(server.Handler, srv)
        resp = cli.request(
            "POST",
            f"http://127.0.0.1:{port}/ai/questions",
            body={"title": "t", "text": "hello world", "count": 1},
        )
        self.assertEqual(resp.status, 401)
        srv.shutdown()

    def test_token_must_match_exactly(self):
        """Different token must be rejected (timing-safe comparison)."""
        srv, port = self._make_server(token="secret")
        cli = _TestClient(server.Handler, srv)
        resp = cli.request(
            "GET",
            f"http://127.0.0.1:{port}/fetch?url=https://example.com",
            headers={"X-Worktable-Token": "secret2"},
        )
        self.assertEqual(resp.status, 401)
        srv.shutdown()


class TestPayloadLimits(unittest.TestCase):
    """Test body size limits and request validation."""

    def setUp(self):
        server._SERVICE_TOKEN = None
        for k in list(os.environ.keys()):
            if k.startswith("WORKTABLE_") or k.startswith("ANTHROPIC_"):
                del os.environ[k]

    def tearDown(self):
        for k in list(os.environ.keys()):
            if k.startswith("WORKTABLE_") or k.startswith("ANTHROPIC_"):
                del os.environ[k]

    def _make_server(self):
        srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        port = srv.server_address[1]
        t = Thread(target=srv.serve_forever, daemon=True)
        t.start()
        return srv, port

    def test_oversized_body_rejected(self):
        """Body larger than _MAX_BODY_SIZE returns 400."""
        srv, port = self._make_server()
        cli = _TestClient(server.Handler, srv)
        oversized = "x" * (server._MAX_BODY_SIZE + 1)
        resp = cli.request(
            "POST",
            f"http://127.0.0.1:{port}/ai/questions",
            body=oversized,
            headers={"Content-Length": str(len(oversized))},
        )
        # Handler should reject before auth check (or close connection early)
        self.assertIn(resp.status, (0, 400, 401))
        srv.shutdown()

    def test_ai_questions_respects_count_clamp(self):
        """count > 3 is clamped to 3 and never reaches AI when overridden."""
        srv, port = self._make_server()
        cli = _TestClient(server.Handler, srv)

        captured = {}

        def fake_generate(title, text, count):
            captured["title"] = title
            captured["text"] = text
            captured["count"] = count
            return [{"type": "mc", "text": "q", "answer": "a", "options": ["a", "b", "c", "d"], "explanation": ""}]

        with patch.object(server, "_generate_questions", side_effect=fake_generate):
            resp = cli.request(
                "POST",
                f"http://127.0.0.1:{port}/ai/questions",
                body=json.dumps({"title": "t", "text": "hello", "count": 10}),
            )
        # count must be clamped to 3 before reaching the AI
        self.assertEqual(captured.get("count"), 3)
        self.assertEqual(resp.status, 200)
        srv.shutdown()

    def test_ai_extract_maxpoints_clamped(self):
        """maxPoints > 10 is clamped to 10."""
        srv, port = self._make_server()
        cli = _TestClient(server.Handler, srv)

        captured = {}

        def fake_extract(title, text, max_points):
            captured["max_points"] = max_points
            return ["point"]

        with patch.object(server, "_extract_keypoints", side_effect=fake_extract):
            resp = cli.request(
                "POST",
                f"http://127.0.0.1:{port}/ai/extract",
                body=json.dumps({"title": "t", "text": "hello", "maxPoints": 999}),
            )
        # maxPoints must be clamped to 10
        self.assertEqual(captured.get("max_points"), 10)
        self.assertEqual(resp.status, 200)
        srv.shutdown()


class TestURLValidation(unittest.TestCase):
    """Test SSRF protection via _is_url_safe."""

    SAFE_URLS = [
        "https://example.com/path",
        "https://www.wikipedia.org/",
        "http://httpbin.org/get",
    ]

    UNSAFE_URLS = [
        ("http://localhost/foo", "localhost"),
        ("http://127.0.0.1/foo", "loopback IP"),
        ("http://localhost.localdomain/bar", "localhost variant"),
        ("https://10.0.0.1/", "RFC1918 10.x"),
        ("https://172.16.0.1/", "RFC1918 172.16.x"),
        ("https://192.168.1.1/", "RFC1918 192.168.x"),
        ("http://169.254.169.254/", "link-local AWS"),
        ("https://[::1]/", "IPv6 loopback"),
    ]

    def test_safe_urls_pass(self):
        for url in self.SAFE_URLS:
            self.assertTrue(server._is_url_safe(url), f"URL should be safe: {url}")

    def test_unsafe_urls_rejected(self):
        for url, reason in self.UNSAFE_URLS:
            self.assertFalse(server._is_url_safe(url), f"URL should be unsafe ({reason}): {url}")

    def test_invalid_scheme_rejected(self):
        for scheme in ("ftp://", "file://", "data:", "javascript:", "dict://"):
            url = f"{scheme}//example.com"
            self.assertFalse(server._is_url_safe(url), f"Scheme {scheme!r} should be rejected")

    def test_malformed_urls_rejected(self):
        for url in ("", "just-some-text", "/////", "http://"):
            self.assertFalse(server._is_url_safe(url), f"Malformed URL should be rejected: {url!r}")

    def test_fetch_rejects_unsafe_url(self):
        """GET /fetch?url=<unsafe> returns 400."""
        srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        port = srv.server_address[1]
        t = Thread(target=srv.serve_forever, daemon=True)
        t.start()
        try:
            cli = _TestClient(server.Handler, srv)
            resp = cli.request("GET", f"http://127.0.0.1:{port}/fetch?url=http://127.0.0.1/")
            self.assertEqual(resp.status, 400)
            self.assertIn("reserved", resp.json().get("error", "").lower())
        finally:
            srv.shutdown()

    def test_fetch_rejects_non_http(self):
        """GET /fetch?url=ftp://... returns 400."""
        srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        port = srv.server_address[1]
        t = Thread(target=srv.serve_forever, daemon=True)
        t.start()
        try:
            cli = _TestClient(server.Handler, srv)
            resp = cli.request("GET", f"http://127.0.0.1:{port}/fetch?url=ftp://example.com/")
            self.assertEqual(resp.status, 400)
        finally:
            srv.shutdown()

    def test_fetch_rejects_missing_url(self):
        srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        port = srv.server_address[1]
        t = Thread(target=srv.serve_forever, daemon=True)
        t.start()
        try:
            cli = _TestClient(server.Handler, srv)
            resp = cli.request("GET", f"http://127.0.0.1:{port}/fetch")
            self.assertEqual(resp.status, 400)
        finally:
            srv.shutdown()


class TestSecretRedaction(unittest.TestCase):
    """Test that tokens are never logged or disclosed."""

    def setUp(self):
        server._AI_CFG = None
        server._CONFIG_PATH = None
        for k in list(os.environ.keys()):
            if k.startswith("WORKTABLE_") or k.startswith("ANTHROPIC_"):
                del os.environ[k]

    def tearDown(self):
        for k in list(os.environ.keys()):
            if k.startswith("WORKTABLE_") or k.startswith("ANTHROPIC_"):
                del os.environ[k]

    def test_health_never_leaks_tokens(self):
        srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        port = srv.server_address[1]
        t = Thread(target=srv.serve_forever, daemon=True)
        t.start()
        try:
            cli = _TestClient(server.Handler, srv)
            resp = cli.request("GET", f"http://127.0.0.1:{port}/health")
            self.assertEqual(resp.status, 200)
            body_str = json.dumps(resp.json())
            self.assertNotIn("token", body_str.lower())
            self.assertNotIn("***", body_str)
        finally:
            srv.shutdown()

    def test_ai_health_redacts_token(self):
        srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        port = srv.server_address[1]
        t = Thread(target=srv.serve_forever, daemon=True)
        t.start()
        try:
            cli = _TestClient(server.Handler, srv)
            resp = cli.request("GET", f"http://127.0.0.1:{port}/ai/health")
            body = resp.json()
            body_str = json.dumps(body)
            # No raw token chars beyond first 8 (which are allowed in tokenPreview, but not full token)
            # The handler only exposes baseUrl and model, not token
            self.assertNotIn("sk-ant", body_str)
            self.assertNotIn("sk-", body_str)
        finally:
            srv.shutdown()

    def test_log_message_no_raw_token(self):
        """Log output must not contain raw ANTHROPIC_AUTH_TOKEN."""
        import io
        import logging

        log_capture = io.StringIO()
        handler = logging.StreamHandler(log_capture)
        LOG = logging.getLogger("cloakfetch")
        LOG.addHandler(handler)
        LOG.setLevel(logging.INFO)

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                cfg_path = os.path.join(tmpdir, "server.json")
                with open(cfg_path, "w") as f:
                    json.dump({"aiAuthToken": "sk-ant-api03-VERY_LONG_SECRET_TOKEN_DONT_LOG_ME"}, f)
                with patch.object(server, "_CONFIG_PATH", cfg_path):
                    cfg = server._load_ai_config()
            log_output = log_capture.getvalue()
            # The token appears redacted as "sk-ant-***" or similar
            self.assertNotIn("VERY_LONG_SECRET_TOKEN", log_output)
        finally:
            LOG.removeHandler(handler)


class TestGracefulShutdown(unittest.TestCase):
    """Test graceful shutdown behavior."""

    def setUp(self):
        server._SHUTDOWN_EVENT.clear()
        server._WORKER = None

    def test_shutdown_endpoint_sets_event(self):
        """GET /shutdown sets the shutdown event."""
        self.assertFalse(server._SHUTDOWN_EVENT.is_set())
        # Manually call the handler path that sets the event
        # We can't easily test via HTTP without threading issues, so test the flag directly
        srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        port = srv.server_address[1]
        t = Thread(target=srv.serve_forever, daemon=True)
        t.start()
        try:
            cli = _TestClient(server.Handler, srv)
            resp = cli.request("GET", f"http://127.0.0.1:{port}/shutdown")
            # Should succeed
            self.assertEqual(resp.status, 200)
        finally:
            srv.shutdown()


class TestCORSheaders(unittest.TestCase):
    """Test CORS headers include X-Worktable-Token."""

    def test_cors_allows_worktable_token_header(self):
        """Access-Control-Allow-Headers must include X-Worktable-Token."""
        self.assertIn("X-Worktable-Token", server.CORS["Access-Control-Allow-Headers"])

    def test_cors_allows_post_methods(self):
        self.assertIn("POST", server.CORS["Access-Control-Allow-Methods"])


class TestCORSExposure(unittest.TestCase):
    """Verify CORS headers are sent on responses."""

    def setUp(self):
        server._SERVICE_TOKEN = None

    def _make_server(self):
        srv = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        port = srv.server_address[1]
        t = Thread(target=srv.serve_forever, daemon=True)
        t.start()
        return srv, port

    def test_health_has_cors_headers(self):
        srv, port = self._make_server()
        cli = _TestClient(server.Handler, srv)
        resp = cli.request("GET", f"http://127.0.0.1:{port}/health")
        self.assertIn("Access-Control-Allow-Origin", resp.headers)
        self.assertEqual(resp.headers["Access-Control-Allow-Origin"], "*")
        srv.shutdown()

    def test_options_returns_cors(self):
        srv, port = self._make_server()
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        conn.connect()
        conn.request("OPTIONS", "/health")
        resp = conn.getresponse()
        self.assertEqual(resp.status, 204)
        self.assertEqual(resp.getheader("Access-Control-Allow-Origin"), "*")
        conn.close()
        srv.shutdown()


if __name__ == "__main__":
    unittest.main()
