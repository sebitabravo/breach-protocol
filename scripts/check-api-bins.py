#!/usr/bin/env python3
"""Check the executable artifacts from Cargo's --message-format=json stream."""

import json
import os
from pathlib import Path
import sys

artifacts = []
for line in sys.stdin:
    message = json.loads(line)
    if message["reason"] == "compiler-message" and message["message"]["rendered"]:
        print(message["message"]["rendered"], file=sys.stderr, end="")
    if message["reason"] == "compiler-artifact" and "bin" in message["target"]["kind"]:
        artifacts.append((message["target"]["name"], Path(message["executable"])))

expected = ["leaderboard", "runs"]
names = sorted(name for name, _ in artifacts)
if names != expected:
    sys.exit(f"Expected only {expected}; Cargo reported {names}")
for name, executable in artifacts:
    if executable.name != name or not executable.is_file() or not os.access(executable, os.X_OK):
        sys.exit(f"Missing or misnamed executable for {name}: {executable}")
print(f"Verified release executables: {', '.join(names)}")
