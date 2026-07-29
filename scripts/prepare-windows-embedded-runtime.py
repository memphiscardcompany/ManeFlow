from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path


def run(command: list[str]) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare the self-contained Windows Python runtime for ManeFlow.")
    parser.add_argument("--python-version", default="3.12.10")
    parser.add_argument("--root", default=None, help="Repository root; defaults from this script.")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).resolve() if args.root else Path(__file__).resolve().parents[1]
    build_root = root / ".runtime-build"
    destination = build_root / "windows-python"
    cache = build_root / "downloads"
    cache.mkdir(parents=True, exist_ok=True)

    version = args.python_version
    archive = cache / f"python-{version}-embed-amd64.zip"
    url = f"https://www.python.org/ftp/python/{version}/python-{version}-embed-amd64.zip"
    if args.force and destination.exists():
        shutil.rmtree(destination)
    if destination.exists() and (destination / "python.exe").exists() and (destination / "Lib" / "site-packages" / "fastapi").exists():
        print(f"Embedded Windows runtime already prepared: {destination}")
        return 0

    if not archive.exists():
        print(f"Downloading official Python embeddable runtime: {url}")
        urllib.request.urlretrieve(url, archive)

    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    with zipfile.ZipFile(archive) as bundle:
        bundle.extractall(destination)

    site_packages = destination / "Lib" / "site-packages"
    site_packages.mkdir(parents=True, exist_ok=True)
    requirements = root / "vision-worker" / "requirements-runtime.txt"
    run([
        sys.executable,
        "-m",
        "pip",
        "install",
        "--upgrade",
        "--target",
        str(site_packages),
        "--platform",
        "win_amd64",
        "--implementation",
        "cp",
        "--python-version",
        "3.12",
        "--abi",
        "cp312",
        "--only-binary=:all:",
        "--requirement",
        str(requirements),
    ])

    pth_files = sorted(destination.glob("python*._pth"))
    if not pth_files:
        raise RuntimeError("Embedded Python _pth file was not found.")
    pth_files[0].write_text(
        "python312.zip\n.\nLib\\site-packages\n..\\..\\vision-worker\nimport site\n",
        encoding="utf-8",
    )

    # Remove caches and package tests that provide no runtime value.
    for path in list(destination.rglob("__pycache__")):
        shutil.rmtree(path, ignore_errors=True)
    for path in list(site_packages.rglob("tests")) + list(site_packages.rglob("test")):
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)

    required = [
        destination / "python.exe",
        destination / "python312.dll",
        site_packages / "fastapi",
        site_packages / "uvicorn",
        site_packages / "cv2",
        site_packages / "numpy",
        site_packages / "zxingcpp.pyd",
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise RuntimeError("Embedded runtime validation failed; missing:\n" + "\n".join(missing))

    print(f"Prepared embedded Windows runtime: {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
