#!/usr/bin/env bash
# Sets up a virtual environment and installs Miss Data on Linux/macOS.
set -e

cd "$(dirname "$0")"

if ! command -v python3 &> /dev/null; then
    echo "python3 not found. Please install Python 3.9+ first."
    exit 1
fi

echo "Creating virtual environment (.venv)..."
python3 -m venv .venv

echo "Installing dependencies..."
./.venv/bin/pip install --upgrade pip > /dev/null
./.venv/bin/pip install -e .

echo ""
echo "Done. To start Miss Data, run:"
echo ""
echo "    source .venv/bin/activate"
echo "    missdata"
echo ""
echo "Or without activating the venv:"
echo ""
echo "    ./.venv/bin/missdata"
echo ""
