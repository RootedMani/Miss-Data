#!/usr/bin/env python3
"""
Run Miss Data directly without installing the package:

    python run.py
    python run.py --dir /path/to/project
    python run.py --provider anthropic

This just calls into missdata.cli.main().
"""

from missdata.cli import main

if __name__ == "__main__":
    main()
