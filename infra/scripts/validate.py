"""Compile with non-secret fixtures and run stdlib policy/preflight tests, without Azure."""

import argparse
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bicep", default=os.environ.get("BICEP", "bicep"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    env = {**os.environ, "BICEP": args.bicep, "PYTHONDONTWRITEBYTECODE": "1"}
    result = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", "infra/tests", "-v"],
        cwd=root, env=env, check=False,
    )
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
