"""Utility functions for Fibonacci numbers.

This module provides a single public function :func:`is_fibonacci` that checks
whether a given non‑negative integer belongs to the Fibonacci sequence.

The implementation uses the classic mathematical test: a number *n* is a
Fibonacci number iff one (or both) of ``5*n*n + 4`` or ``5*n*n - 4`` is a perfect
square.  This runs in O(1) time and avoids generating the sequence.
"""

from __future__ import annotations

import math
from typing import Any

__all__ = ["is_fibonacci", "is_in_fibonacci"]

def is_in_fibonacci(n: int | float) -> bool:
    """Return ``True`` if *n* is a Fibonacci number, ``False`` otherwise.

    This is a convenience alias for :func:`is_fibonacci`.
    """
    return is_fibonacci(n)


def _is_perfect_square(x: int) -> bool:
    """Return ``True`` if *x* is a perfect square.

    The function works for non‑negative integers only; negative input returns
    ``False``.
    """
    if x < 0:
        return False
    # ``math.isqrt`` returns the integer square root truncating toward zero.
    root = math.isqrt(x)
    return root * root == x


def is_fibonacci(n: int | float) -> bool:
    """Return ``True`` if *n* is a Fibonacci number, ``False`` otherwise.

    Parameters
    ----------
    n: int | float
        The value to test.  Floats are accepted for convenience but must
        represent an integer value (e.g., ``5.0``).  Negative numbers are not
        Fibonacci numbers.

    Notes
    -----
    The function follows the mathematical property:

    ``n`` is Fibonacci ⇔ ``5*n*n + 4`` or ``5*n*n - 4`` is a perfect square.
    """
    # Reject non‑integral floats early.
    if isinstance(n, float):
        if not n.is_integer():
            return False
        n = int(n)
    if not isinstance(n, int) or n < 0:
        return False

    test1 = 5 * n * n + 4
    test2 = 5 * n * n - 4
    return _is_perfect_square(test1) or _is_perfect_square(test2)
