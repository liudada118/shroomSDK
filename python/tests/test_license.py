"""Product isolation, signed offline keys and live serial authorization guards."""

import base64
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import time
import unittest
from unittest.mock import Mock, patch

from shroom_sdk import (DEFAULT_DELIMITER, Shroom, ShroomLicenseError,
                        activate_license, clear_license, get_license_status)
from shroom_sdk.__main__ import main
from shroom_sdk.license import _manager
from license_fixture import activate_online_fixture, online_response
from test_reliability import MemoryPort, serial_device


@contextmanager
def key_server(response=None, redirect=False):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            requests.append((self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
            if redirect:
                self.send_response(302)
                self.send_header("Location", "/should-not-receive-key")
                self.end_headers()
                return
            data = json.dumps(response if response is not None else online_response()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=lambda: server.serve_forever(poll_interval=0.01), daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


class OnlineLicenseTests(unittest.TestCase):
    def setUp(self):
        clear_license()
        self.addCleanup(clear_license)

    def test_unlicensed_real_port_is_never_loaded_and_mock_is_free(self):
        with patch("shroom_sdk.device._serial_module") as loader:
            with self.assertRaises(ShroomLicenseError) as caught:
                Shroom.connect("COM1")
        loader.assert_not_called()
        self.assertEqual((caught.exception.code, caught.exception.stage), ("LICENSE_REQUIRED", "license"))
        self.assertIsInstance(caught.exception, PermissionError)
        with Shroom.mock(rows=1, cols=1) as mock:
            self.assertIsNotNone(mock.read_frame())

    def test_online_http_contract_and_status_do_not_expose_key(self):
        key, device_id = "opaque-secret-key", "a" * 64
        with key_server() as (url, requests):
            status = Shroom.activate_license(key, server_url=url, device_id=device_id)
        self.assertTrue(status["valid"])
        self.assertIn("serial.raw", status["sdk_features"])
        self.assertTrue(status["all_products"])
        self.assertEqual(status["sensor_types"], ["all"])
        self.assertNotIn(key, json.dumps(status))
        self.assertEqual(requests[0][0], "/licenseCheck")
        self.assertEqual(requests[0][1]["productType"], "shroom-sdk")
        self.assertEqual(requests[0][1]["deviceId"], device_id)
        self.assertIsInstance(requests[0][1]["clientTime"], int)
        status["sdk_features"].clear()
        self.assertIn("serial.raw", get_license_status()["sdk_features"])
        with serial_device() as device:
            self.assertEqual(device.write(b"command"), 7)

    def test_redirect_never_forwards_the_key(self):
        with key_server(redirect=True) as (url, requests):
            with self.assertRaises(ShroomLicenseError) as caught:
                activate_license("secret", server_url=url)
        self.assertEqual(caught.exception.code, "LICENSE_UNAVAILABLE")
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0][0], "/licenseCheck")

    def test_missing_or_desktop_product_even_with_all_is_rejected(self):
        for product in (None, "shroom-desktop", "unknown"):
            with self.subTest(product=product), patch("shroom_sdk.license._post", return_value=online_response(productType=product)):
                with self.assertRaises(ShroomLicenseError) as caught:
                    activate_license("desktop-all-key")
                self.assertEqual(caught.exception.code, "LICENSE_PRODUCT_MISMATCH")
                self.assertFalse(get_license_status()["valid"])

    def test_server_rejections_and_malformed_grants_fail_closed(self):
        cases = [({"valid": False}, "LICENSE_REJECTED"),
                 ({"status": "SUSPENDED"}, "LICENSE_REJECTED"),
                 ({"status": "DEVICE_ID_REQUIRED", "valid": False}, "LICENSE_DEVICE_REQUIRED"),
                 ({"status": "DEVICE_LIMIT_REACHED", "valid": False}, "LICENSE_REJECTED"),
                 ({"leaseExpiresAt": None}, "LICENSE_INVALID"),
                 ({"sdkFeatures": None}, "LICENSE_INVALID"),
                 ({"time": True}, "LICENSE_INVALID"),
                 ({"expireTimestamp": float("nan")}, "LICENSE_INVALID")]
        for changes, code in cases:
            with self.subTest(changes=changes), patch("shroom_sdk.license._post", return_value=online_response(**changes)):
                with self.assertRaises(ShroomLicenseError) as caught:
                    activate_license("key")
                self.assertEqual(caught.exception.code, code)

    def test_old_sdk_device_scope_does_not_restrict_generic_serial(self):
        for scope in (["hand"], ["@group:mat"], None, []):
            with self.subTest(scope=scope):
                status = activate_online_fixture(sensorTypes=scope, isAllTypes=False,
                                                 sdkFeatures=["serial", "stream", "recording"])
                self.assertTrue(status["all_products"])
                self.assertEqual(status["sensor_types"], ["all"])
                self.assertIn("serial.raw", status["sdk_features"])
                with serial_device() as device:
                    self.assertEqual(device.write(b"hand,glove,custom"), 17)

    def test_raw_permission_does_not_bypass_missing_serial_feature(self):
        for features in (["stream"], ["recording"], ["serial.raw"], []):
            activate_online_fixture(sdkFeatures=features)
            with self.subTest(features=features), patch("shroom_sdk.device._serial_module") as loader, self.assertRaises(ShroomLicenseError) as caught:
                Shroom.connect("COM1")
            loader.assert_not_called()
            self.assertEqual(caught.exception.code, "LICENSE_FEATURE_DENIED")

    def test_clear_closes_real_device_and_preserves_mock(self):
        activate_online_fixture()
        port = MemoryPort()
        device = serial_device(port)
        with Shroom.mock(rows=1, cols=1) as mock:
            clear_license()
            self.assertTrue(device.closed)
            self.assertFalse(port.is_open)
            self.assertEqual(device.get_diagnostics()["last_error"]["code"], "LICENSE_REQUIRED")
            self.assertIsNotNone(mock.read_frame())

    def test_idle_port_closes_when_short_lease_expires(self):
        now = int(time.time() * 1000)
        activate_online_fixture(time=now, leaseExpiresAt=now + 150)
        port, device = MemoryPort(), None
        device = serial_device(port)
        until = time.monotonic() + 1
        while not device.closed and time.monotonic() < until:
            time.sleep(0.005)
        self.assertTrue(device.closed)
        self.assertFalse(port.is_open)
        self.assertEqual(device.state, "error")
        self.assertEqual(device.get_diagnostics()["last_error"]["code"], "LICENSE_EXPIRED")
        for call in (device.read_frame, lambda: device.write(b"x")):
            with self.assertRaises(ShroomLicenseError) as caught:
                call()
            self.assertEqual(caught.exception.code, "LICENSE_EXPIRED")

    def test_online_lease_never_exceeds_60_seconds_despite_server_value(self):
        now = int(time.time() * 1000)
        activate_online_fixture(time=now, leaseExpiresAt=now + 10 * 60_000)
        device = serial_device()
        later = time.monotonic() + 61
        with patch("shroom_sdk.license.time.monotonic", return_value=later):
            self.assertFalse(get_license_status()["valid"])
        self.assertTrue(device.closed)

    def test_network_failure_does_not_extend_last_verified_lease(self):
        activate_online_fixture()
        device = serial_device()
        with _manager._lock:
            previous_deadline = _manager._grant["deadline"]
            _manager._online["next_check"] = time.monotonic() - 1
        error = ShroomLicenseError("network unavailable", code="LICENSE_UNAVAILABLE", stage="license", suggestion="retry")
        with patch("shroom_sdk.license._post", side_effect=error):
            _manager._tick()
        self.assertTrue(get_license_status()["valid"])
        self.assertEqual(_manager._grant["deadline"], previous_deadline)
        with patch("shroom_sdk.license.time.monotonic", return_value=previous_deadline + 1):
            self.assertFalse(get_license_status()["valid"])
        self.assertTrue(device.closed)

    def test_revocation_or_reduced_features_on_recheck_closes_port(self):
        for changed in ({"valid": False, "status": "REVOKED"},
                        {"sdkFeatures": ["stream", "recording"]}):
            activate_online_fixture()
            device = serial_device()
            with _manager._lock:
                _manager._online["next_check"] = time.monotonic() - 1
            with self.subTest(changed=changed), patch("shroom_sdk.license._post", return_value=online_response(**changed)):
                _manager._tick()
                self.assertTrue(device.closed)
                self.assertEqual(device.state, "error")

    def test_inflight_read_cannot_emit_after_license_is_cleared(self):
        activate_online_fixture()
        wire = DEFAULT_DELIMITER + bytes(8) + DEFAULT_DELIMITER
        port = MemoryPort([wire])
        device = serial_device(port)
        original_read = port.read

        def read_and_revoke(count):
            result = original_read(count)
            clear_license()
            return result

        port.read = read_and_revoke
        with self.assertRaises(ShroomLicenseError) as caught:
            device.read_frame()
        self.assertEqual(caught.exception.code, "LICENSE_REQUIRED")
        self.assertEqual(device.frame_count, 0)
        self.assertTrue(device.closed)

    def test_failed_key_replacement_removes_previous_grant(self):
        activate_online_fixture()
        device = serial_device()
        with patch("shroom_sdk.license._post", return_value=online_response(valid=False)):
            with self.assertRaises(ShroomLicenseError):
                activate_license("invalid-key")
        self.assertFalse(get_license_status()["valid"])
        self.assertTrue(device.closed)

    def test_server_url_and_device_id_are_validated_before_request(self):
        for options in ({"server_url": "http://example.com"}, {"server_url": "https://name:pass@example.com"},
                        {"server_url": "https://example.com?key=secret"}, {"device_id": "random"},
                        {"device_id": "A" * 64}, {"mode": "automatic"}):
            with self.subTest(options=options), patch("shroom_sdk.license._post") as request:
                with self.assertRaises(ValueError):
                    activate_license("key", **options)
                request.assert_not_called()

    def test_cli_loads_key_from_file_after_validating_timeout(self):
        port = MemoryPort()
        wire = DEFAULT_DELIMITER + bytes(8) + DEFAULT_DELIMITER
        port.chunks.append(wire)
        with TemporaryDirectory() as folder:
            key_file = Path(folder) / "sdk.license"
            key_file.write_text("test-key", encoding="utf-8")
            serial = Mock(serial_for_url=Mock(return_value=port))
            with patch("shroom_sdk.license._post", return_value=online_response()), patch(
                    "shroom_sdk.device._serial_module", return_value=serial), patch("builtins.print"):
                self.assertEqual(main(["memory", "--license-file", str(key_file), "--frames", "1"]), 0)
        self.assertTrue(port.is_open is False)


@unittest.skipUnless(importlib.util.find_spec("cryptography"), "Install the [license] extra for RSA signature tests")
class OfflineLicenseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        cls.signer = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.public_key = cls.signer.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()

    def setUp(self):
        clear_license()
        self.addCleanup(clear_license)

    def sign(self, **changes):
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding
        payload = {"productType": "shroom-sdk", "boundSensorTypes": ["all"],
                   "expireDate": int(time.time() * 1000) + 3_600_000,
                   "sdkFeatures": ["serial", "stream", "recording", "serial.raw"]}
        payload.update(changes)
        payload_text = base64.b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
        signature = self.signer.sign(payload_text.encode(), padding.PKCS1v15(), hashes.SHA256())
        return base64.b64encode(json.dumps({"payload": payload_text, "signature": base64.b64encode(signature).decode()}).encode()).decode()

    def activate(self, key=None, **options):
        return activate_license(key or self.sign(), mode="offline", public_key=self.public_key, **options)

    def test_signed_unlimited_sdk_key_works_without_network(self):
        with patch("shroom_sdk.license._post") as request:
            status = self.activate()
            request.assert_not_called()
        self.assertTrue(status["valid"])
        self.assertEqual(status["mode"], "offline")
        with serial_device() as device:
            self.assertEqual(device.write(b"x"), 1)

    def test_old_signed_sdk_scope_and_missing_raw_feature_cover_any_serial(self):
        for scope in (["hand"], ["@group:mat"], None, []):
            with self.subTest(scope=scope), patch("shroom_sdk.license._post") as request:
                key = self.sign(boundSensorTypes=scope, sdkFeatures=["serial"])
                status = self.activate(key)
                request.assert_not_called()
                self.assertTrue(status["all_products"])
                self.assertEqual(status["sensor_types"], ["all"])
                self.assertIn("serial.raw", status["sdk_features"])
                with serial_device() as device:
                    self.assertEqual(device.write(b"x"), 1)

    def test_legacy_desktop_all_and_missing_product_are_rejected(self):
        for product in (None, "shroom-desktop"):
            with self.subTest(product=product), self.assertRaises(ShroomLicenseError) as caught:
                self.activate(self.sign(productType=product, sensorTypes=["all"]))
            self.assertEqual(caught.exception.code, "LICENSE_PRODUCT_MISMATCH")

    def test_payload_tampering_cannot_change_signed_product(self):
        key = self.sign(productType="shroom-desktop", sdkFeatures=["serial"])
        envelope = json.loads(base64.b64decode(key))
        payload = json.loads(base64.b64decode(envelope["payload"]))
        payload["productType"] = "shroom-sdk"
        payload["sdkFeatures"].append("serial.raw")
        envelope["payload"] = base64.b64encode(json.dumps(payload).encode()).decode()
        tampered = base64.b64encode(json.dumps(envelope).encode()).decode()
        with self.assertRaises(ShroomLicenseError) as caught:
            self.activate(tampered)
        self.assertEqual(caught.exception.code, "LICENSE_INVALID")

    def test_signed_missing_features_and_expired_key_are_rejected(self):
        for changes, code in (({"sdkFeatures": None}, "LICENSE_INVALID"),
                              ({"expireDate": int(time.time() * 1000) - 1}, "LICENSE_EXPIRED"),
                              ({"expireDate": "2030-01-01T00:00:00"}, "LICENSE_INVALID"),
                              ({"deviceLimit": True}, "LICENSE_INVALID")):
            with self.subTest(changes=changes), self.assertRaises(ShroomLicenseError) as caught:
                self.activate(self.sign(**changes))
            self.assertEqual(caught.exception.code, code)

    def test_untrusted_public_key_in_envelope_is_not_used(self):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        other_public = rsa.generate_private_key(public_exponent=65537, key_size=2048).public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        envelope = json.loads(base64.b64decode(self.sign()))
        envelope["publicKey"] = self.public_key
        key = base64.b64encode(json.dumps(envelope).encode()).decode()
        with self.assertRaises(ShroomLicenseError) as caught:
            activate_license(key, mode="offline", public_key=other_public)
        self.assertEqual(caught.exception.code, "LICENSE_INVALID")

    def test_limited_offline_requires_stable_device_id_before_network(self):
        with patch("shroom_sdk.license._post") as request, self.assertRaises(ShroomLicenseError) as caught:
            self.activate(self.sign(deviceLimit=2))
        request.assert_not_called()
        self.assertEqual(caught.exception.code, "LICENSE_DEVICE_REQUIRED")

    def test_limited_offline_uses_device_endpoint_and_short_online_lease(self):
        with key_server() as (url, requests):
            self.activate(self.sign(deviceLimit=2), server_url=url, device_id="b" * 64)
        self.assertEqual(requests[0][0], "/api/license/devices/check")
        self.assertEqual(requests[0][1]["deviceId"], "b" * 64)
        self.assertEqual(requests[0][1]["productType"], "shroom-sdk")
        self.assertTrue(get_license_status()["valid"])
        self.assertIsNotNone(get_license_status()["lease_expires_at"])

    def test_device_endpoint_cannot_extend_signed_expiry_or_features(self):
        expiry = int(time.time() * 1000) + 10_000
        with patch("shroom_sdk.license._post", return_value=online_response(sensorTypes=["handGloveFullPacket"], isAllTypes=False)):
            status = self.activate(self.sign(deviceLimit=1, boundSensorTypes=["hand"], expireDate=expiry,
                                             sdkFeatures=["serial"]), device_id="c" * 64)
        self.assertEqual(status["expires_at"], expiry)
        self.assertTrue(status["all_products"])
        self.assertIn("serial.raw", status["sdk_features"])
        self.assertNotIn("stream", status["sdk_features"])
        self.assertNotIn("recording", status["sdk_features"])
        with serial_device() as device:
            self.assertEqual(device.write(b"x"), 1)
        for feature in ("stream", "recording"):
            with self.assertRaises(ShroomLicenseError) as caught:
                _manager.assert_feature(feature)
            self.assertEqual(caught.exception.code, "LICENSE_FEATURE_DENIED")
        with patch("shroom_sdk.license.time.monotonic", return_value=time.monotonic() + 11):
            self.assertFalse(get_license_status()["valid"])


if __name__ == "__main__":
    unittest.main()
