"""Exercise the public activation boundary in serial tests, with a mock issuer."""

import time
import unittest
from unittest.mock import patch

from shroom_sdk import activate_license, clear_license


def online_response(**overrides):
    now = int(time.time() * 1000)
    response = {"time": now, "valid": True, "status": "ACTIVATED", "productType": "shroom-sdk",
                "expireTimestamp": now + 3_600_000, "leaseExpiresAt": now + 60_000,
                "sensorTypes": ["all"], "isAllTypes": True,
                "sdkFeatures": ["serial", "stream", "recording", "serial.raw"]}
    response.update(overrides)
    return response


def activate_online_fixture(**overrides):
    with patch("shroom_sdk.license._post", return_value=online_response(**overrides)):
        return activate_license("test-only-opaque-key")


class LicensedTestCase(unittest.TestCase):
    def setUp(self):
        activate_online_fixture()
        self.addCleanup(clear_license)
