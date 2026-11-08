"""Agent API v1 client. Standard library only; no model or agent runtime."""
from __future__ import annotations

import hashlib
import json
import socket
import ssl
import threading
import time
import uuid
from pathlib import Path
from typing import Callable

PROTOCOL_VERSION = "1.0"
MAX_FRAME_BYTES = 8 * 1024 * 1024
TERMINAL = {"completed", "failed", "cancelled"}


class AgentError(RuntimeError):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


class AgentClient:
    def __init__(self, address: str, certificate: Path, credential: Path, *, timeout: float = 30):
        self.address, self.certificate, self.credential = address, certificate, credential
        self.timeout = timeout
        self.socket: ssl.SSLSocket | None = None
        self.buffer = bytearray()
        self.lock = threading.RLock()

    def connect(self) -> None:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.minimum_version = ssl.TLSVersion.TLSv1_3
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        raw = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        raw.settimeout(self.timeout)
        try:
            raw.connect(self.address)
            self.socket = context.wrap_socket(raw)
            expected = ssl.PEM_cert_to_DER_cert(self.certificate.read_text())
            if hashlib.sha256(self.socket.getpeercert(binary_form=True)).digest() != hashlib.sha256(expected).digest():
                raise AgentError(-32003, "O certificado do motor local mudou. Repare a instalação antes de reconectar.")
            identity = json.loads(self.credential.read_text())
            self.call("authenticate", {"id": identity["registration"]["id"], "token": identity["token"], "protocol": PROTOCOL_VERSION})
        except Exception:
            raw.close()
            self.close()
            raise

    def call(self, method: str, params: dict | None = None):
        with self.lock:
            if self.socket is None:
                raise AgentError(-32011, "Motor local indisponível. Reconecte para continuar.")
            identifier = str(uuid.uuid4())
            frame = (json.dumps({"jsonrpc": "2.0", "id": identifier, "method": method, "params": params or {}}, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
            if len(frame) > MAX_FRAME_BYTES:
                raise AgentError(-32602, "Pedido excede o limite do motor local.")
            self.socket.sendall(frame)
            while b"\n" not in self.buffer:
                chunk = self.socket.recv(65536)
                if not chunk:
                    raise AgentError(-32011, "A conexão local foi interrompida. O trabalho permanece no serviço.")
                self.buffer.extend(chunk)
                if len(self.buffer) > MAX_FRAME_BYTES:
                    raise AgentError(-32602, "Resposta excede o limite do motor local.")
            line, _, remaining = self.buffer.partition(b"\n")
            self.buffer = bytearray(remaining)
            response = json.loads(line)
            if response.get("jsonrpc") != "2.0" or response.get("id") != identifier:
                raise AgentError(-32600, "Resposta inválida do motor local.")
            if error := response.get("error"):
                raise AgentError(error["code"], error["message"])
            return response.get("result")

    def wait(self, run: dict, on_event: Callable[[dict], None], host: Callable[[dict], object] | None = None, *, cursor: int = 0) -> dict:
        while True:
            events = self.call("events.read", {"sessionId": run["sessionId"], "cursor": cursor})
            for event in events:
                if event["sequence"] <= cursor:
                    continue
                cursor = event["sequence"]
                if event.get("runId") == run["id"]:
                    on_event(event)
            if host:
                for request in self.call("host.poll"):
                    if request["runId"] == run["id"]:
                        self.call("host.respond", {"id": request["id"], "value": host(request)})
            current = self.call("runs.get", {"id": run["id"]})
            if current["state"] in TERMINAL:
                return current
            time.sleep(0.1)

    def close(self) -> None:
        if self.socket:
            self.socket.close()
            self.socket = None
        self.buffer.clear()

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *_args):
        self.close()
