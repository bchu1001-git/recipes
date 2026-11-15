#!/bin/bash
# Runs the app on this computer for trying changes before publishing. Stop it with Control-C.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Recipes is running at http://localhost:8787  (make the window narrow to see the phone layout)"
python3 -m http.server 8787 --bind 127.0.0.1
