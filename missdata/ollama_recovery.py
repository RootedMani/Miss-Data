"""Safe, local repair helpers for Ollama availability failures.

This module only starts an Ollama server for loopback URLs, uses argument lists
instead of a shell, and leaves user consent to the caller.  Downloading models
is intentionally a separate, explicit action because it can consume substantial
disk space, bandwidth, and time.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass


@dataclass(frozen=True)
class OllamaDiagnosis:
    kind: str  # connection | model_missing | unknown
    message: str


@dataclass(frozen=True)
class OllamaRepairResult:
    repaired: bool
    action: str
    detail: str


def diagnose_ollama_error(error: Exception) -> OllamaDiagnosis:
    """Classify known Ollama failures without depending on SDK error classes."""
    message = str(error)
    lowered = message.lower()
    if any(marker in lowered for marker in (
        "could not reach ollama", "connection refused", "urlopen error",
        "econnrefused", "connection reset", "connection timed out",
    )):
        return OllamaDiagnosis("connection", "The local Ollama server is not reachable.")
    if any(marker in lowered for marker in (
        "ollama returned 404", "model not found", "model '" , "model \"",
        "pull the model", "isn't pulled yet", "is not pulled",
    )):
        return OllamaDiagnosis("model_missing", "The selected Ollama model may not be installed.")
    return OllamaDiagnosis("unknown", "The Ollama error is not safe to repair automatically.")


def is_loopback_url(base_url: str) -> bool:
    """Only self-start Ollama for a local loopback endpoint."""
    try:
        parsed = urllib.parse.urlparse(base_url)
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"}


def ollama_executable() -> str | None:
    return shutil.which("ollama")


def server_reachable(base_url: str, timeout: float = 3.0) -> bool:
    """Probe Ollama's inexpensive local tags endpoint."""
    url = base_url.rstrip("/") + "/api/tags"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return 200 <= getattr(response, "status", 200) < 500
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return False


def _start_ollama_server(base_url: str, wait_seconds: float = 12.0) -> OllamaRepairResult:
    executable = ollama_executable()
    if not executable:
        return OllamaRepairResult(False, "server_start", "The `ollama` command was not found on PATH.")
    if not is_loopback_url(base_url):
        return OllamaRepairResult(False, "server_start", "Refusing to start a server for a non-local Ollama URL.")
    if server_reachable(base_url):
        return OllamaRepairResult(True, "server_already_running", "Ollama is already reachable.")

    popen_kwargs: dict = {
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "stdin": subprocess.DEVNULL,
    }
    if os.name == "nt":
        popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        popen_kwargs["start_new_session"] = True
    try:
        subprocess.Popen([executable, "serve"], **popen_kwargs)
    except OSError as error:
        return OllamaRepairResult(False, "server_start", f"Could not start Ollama: {error}")

    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        if server_reachable(base_url, timeout=1.0):
            return OllamaRepairResult(True, "server_started", "Started Ollama and confirmed it is reachable.")
        time.sleep(0.5)
    return OllamaRepairResult(False, "server_start", "Started `ollama serve`, but it did not become reachable in time.")


def _pull_model(model: str, timeout: float = 1800.0) -> OllamaRepairResult:
    executable = ollama_executable()
    if not executable:
        return OllamaRepairResult(False, "model_pull", "The `ollama` command was not found on PATH.")
    if not model.strip():
        return OllamaRepairResult(False, "model_pull", "No Ollama model name is configured.")
    try:
        completed = subprocess.run(
            [executable, "pull", model],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return OllamaRepairResult(False, "model_pull", "Model download did not finish before the timeout.")
    except OSError as error:
        return OllamaRepairResult(False, "model_pull", f"Could not run `ollama pull`: {error}")

    if completed.returncode == 0:
        return OllamaRepairResult(True, "model_pulled", f"Model '{model}' is available locally.")
    detail = (completed.stdout or "Ollama returned a non-zero exit status.").strip().replace("\n", " ")[:500]
    return OllamaRepairResult(False, "model_pull", detail)


def repair_ollama(base_url: str, model: str, diagnosis: OllamaDiagnosis) -> OllamaRepairResult:
    """Carry out one diagnostic repair action after caller-approved consent."""
    if diagnosis.kind == "connection":
        return _start_ollama_server(base_url)
    if diagnosis.kind == "model_missing":
        if not server_reachable(base_url):
            started = _start_ollama_server(base_url)
            if not started.repaired:
                return started
        return _pull_model(model)
    return OllamaRepairResult(False, "none", "No supported automatic repair is available for this error.")
