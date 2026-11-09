"""Agent API v1 client. Standard library only; no model or agent runtime."""
from __future__ import annotations

import base64
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
        self.host_responses: dict[str, dict] = {}

    def connect(self) -> None:
        if self.socket is not None:
            return
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
            try:
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
            except (OSError, ValueError, AgentError):
                self._disconnect()
                raise
            if error := response.get("error"):
                raise AgentError(error["code"], error["message"])
            return response.get("result")

    def upload(self, key: str, data: bytes, mime: str = "application/json") -> dict:
        if len(data) > 256 * 1024 * 1024:
            raise AgentError(-32602, "O arquivo excede o limite de transferência. A origem foi preservada.")
        transfer = self.call("transfers.begin", {"key": key, "size": len(data),
                             "sha256": hashlib.sha256(data).hexdigest(), "mime": mime})
        cursor = transfer["received"]
        while cursor < len(data):
            end = min(cursor + 512 * 1024, len(data))
            transfer = self.call("transfers.append", {"id": transfer["id"], "offset": cursor,
                                 "data": base64.b64encode(data[cursor:end]).decode("ascii")})
            if not end <= transfer["received"] <= len(data):
                raise AgentError(-32600, "Confirmação de transferência inválida.")
            cursor = transfer["received"]
        return self.call("transfers.commit", {"id": transfer["id"]})

    def download(self, identifier: str) -> bytes:
        transfer = self.call("transfers.get", {"id": identifier})
        if not transfer["committed"] or not 0 <= transfer["size"] <= 256 * 1024 * 1024:
            raise AgentError(-32600, "Metadados de transferência inválidos.")
        data = bytearray()
        while len(data) < transfer["size"]:
            part = self.call("transfers.read", {"id": identifier, "offset": len(data)})
            chunk = base64.b64decode(part["data"], validate=True)
            if not 0 < len(chunk) <= 512 * 1024 or part["nextOffset"] != len(data) + len(chunk) or part["nextOffset"] > transfer["size"]:
                raise AgentError(-32600, "Parte de transferência inválida.")
            data.extend(chunk)
        if hashlib.sha256(data).hexdigest() != transfer["sha256"]:
            raise AgentError(-32600, "A transferência não corresponde à impressão SHA-256.")
        return bytes(data)

    def import_session(self, key: str, domain: object) -> dict:
        data = json.dumps(domain, ensure_ascii=False, separators=(",", ":")).encode()
        transfer = self.upload("import:" + hashlib.sha256(data).hexdigest(), data)
        return self.call("sessions.import", {"key": key, "transferId": transfer["id"]})

    def start_run(self, session_id: str, key: str, spec: dict) -> dict:
        data = json.dumps(spec, ensure_ascii=False, separators=(",", ":")).encode()
        if len(data) < 512 * 1024:
            return self.call("runs.start", {"sessionId": session_id, "key": key, "spec": spec})
        transfer = self.upload("run:" + hashlib.sha256(data).hexdigest(), data)
        return self.call("runs.start", {"sessionId": session_id, "key": key, "specTransferId": transfer["id"]})

    def assist_model(self, request: dict) -> dict:
        """Read-only model assistance. A protected KidOS client cannot use this route."""
        data = json.dumps(request, separators=(",", ":"), ensure_ascii=False).encode()
        params = request if len(data) <= MAX_FRAME_BYTES - 2048 else {
            "transferId": self.upload("model-assistance:" + str(uuid.uuid4()), data)["id"]}
        with self.lock:
            previous_timeout = self.socket.gettimeout() if self.socket else None
            if self.socket:
                self.socket.settimeout(100)
            try:
                return self.call("models.assist", params)
            finally:
                if self.socket:
                    self.socket.settimeout(previous_timeout)

    def export_session(self, identifier: str) -> object:
        transfer = self.call("sessions.export", {"id": identifier})
        return json.loads(self.download(transfer["id"]))

    def snapshot_session(self, identifier: str) -> dict:
        transfer = self.call("sessions.snapshot", {"id": identifier})
        snapshot = json.loads(self.download(transfer["id"]))
        self._hydrate_events(snapshot["events"])
        return snapshot

    def read_events(self, session_id: str, cursor: int = 0) -> list[dict]:
        events = self.call("events.read", {"sessionId": session_id, "cursor": cursor})
        self._hydrate_events(events)
        return events

    def _hydrate_events(self, events: list[dict]) -> None:
        for event in events:
            data = event.get("data")
            if isinstance(data, dict) and data.get("kind") == "agent-event-transfer":
                event["data"] = json.loads(self.download(data["id"]))

    def wait(self, run: dict, on_event: Callable[[dict], None], host: Callable[[dict], object] | None = None, *, cursor: int = 0) -> dict:
        while True:
            events = self.read_events(run["sessionId"], cursor)
            for event in events:
                if event["sequence"] <= cursor:
                    continue
                cursor = event["sequence"]
                if event.get("runId") == run["id"]:
                    on_event(event)
            if host:
                for request in self.call("host.poll"):
                    if request["runId"] != run["id"]:
                        continue
                    payload = dict(request["payload"])
                    payload.pop("id", None)
                    signature = hashlib.sha256(json.dumps({"kind": request["kind"], "payload": payload}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
                    response = self.host_responses.get(request["id"])
                    if response is not None and response["signature"] != signature:
                        raise AgentError(-32009, "O identificador do pedido mudou de conteúdo.")
                    if response is None:
                        try:
                            response = {"signature": signature, "value": host(request), "run": run["id"]}
                        except Exception:
                            if request["kind"] != "tool" or not payload.get("callId"):
                                raise
                            response = {"signature": signature, "failed": True, "run": run["id"]}
                        self.host_responses[request["id"]] = response
                    if response.get("failed"):
                        self.call("host.failed", {"id": request["id"]})
                    else:
                        self.call("host.respond", {"id": request["id"], "value": response["value"]})
            current = self.call("runs.get", {"id": run["id"]})
            if current["state"] in TERMINAL and not events:
                if isinstance(current.get("result"), dict) and current["result"].get("kind") == "agent-result-transfer":
                    current["result"] = json.loads(self.download(current["result"]["id"]))
                self.host_responses = {key: value for key, value in self.host_responses.items() if value["run"] != run["id"]}
                return current
            time.sleep(0.1)

    def _disconnect(self) -> None:
        if self.socket:
            self.socket.close()
            self.socket = None
        self.buffer.clear()

    def close(self) -> None:
        self._disconnect()
        self.host_responses.clear()

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *_args):
        self.close()
