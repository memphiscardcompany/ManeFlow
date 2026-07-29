"""Isolate the worker test suite from a real ManeFlow desktop data directory."""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path


_TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="maneflow-worker-tests-"))
os.environ["MANEFLOW_DATA_DIR"] = str(_TEST_DATA_DIR)
os.environ["DEV_DATABASE_PATH"] = str(_TEST_DATA_DIR / "maneflow-tests.sqlite3")
os.environ.pop("OPENAI_API_KEY", None)
os.environ.pop("PSA_API_KEY", None)
os.environ.pop("EBAY_CLIENT_ID", None)
os.environ.pop("EBAY_CLIENT_SECRET", None)


def pytest_sessionfinish(session, exitstatus):  # type: ignore[no-untyped-def]
    shutil.rmtree(_TEST_DATA_DIR, ignore_errors=True)
