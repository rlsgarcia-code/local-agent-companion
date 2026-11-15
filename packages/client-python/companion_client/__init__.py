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

    def _game_request(self, method: str, request: dict):
        data = json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode()
        if len(data) < 512 * 1024:
            return self.call(method, request)
        transfer = self.upload("game-request:" + hashlib.sha256(data).hexdigest(), data)
        return self.call(method, {"requestTransferId": transfer["id"]})

    def create_game_project(self, request_id: str, document: dict) -> dict:
        return self._game_request("games.projects.create", {"requestId": request_id, "document": document})

    def list_game_projects(self, cursor: int = 0, limit: int = 30) -> dict:
        return self.call("games.projects.list", {"cursor": cursor, "limit": limit})

    def get_game_project(self, identifier: str) -> dict:
        return self.call("games.projects.get", {"id": identifier})

    def snapshot_game_project(self, identifier: str) -> dict:
        transfer = self.call("games.projects.snapshot", {"id": identifier})
        return json.loads(self.download(transfer["id"]))

    def get_game_revision(self, project_id: str, revision: int | None = None) -> dict:
        request = {"projectId": project_id}
        if revision is not None:
            request["revision"] = revision
        transfer = self.call("games.revisions.get", request)
        return json.loads(self.download(transfer["id"]))

    def commit_game_revision(self, project_id: str, request_id: str, expected_revision: int, document: dict, message: str) -> dict:
        return self._game_request("games.revisions.commit", {"projectId": project_id, "requestId": request_id,
                                  "expectedRevision": expected_revision, "document": document, "message": message})

    def inspect_game_mutation(self, project_id: str, request_id: str) -> dict:
        """Read the original domain receipt; missing is not an absence proof.

        bindingHash is opaque. This call does not retry, reconcile tools, grant
        approval, or compute a JavaScript canonical hash from Python floats.
        """
        result = self.call("games.mutations.inspect", {"projectId": project_id, "requestId": request_id})
        if (not isinstance(result, dict) or result.get("projectId") != project_id or result.get("requestId") != request_id
                or result.get("state") not in ("missing", "acknowledged")):
            raise AgentError(-32602, "Game receipt identity differs from its requested mutation.")
        expected = {"state", "projectId", "requestId"}
        if result["state"] == "acknowledged":
            expected |= {"bindingHash", "revision", "contentHash"}
            def valid_hash(value):
                return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value)
            if (not valid_hash(result.get("bindingHash")) or not valid_hash(result.get("contentHash"))
                    or type(result.get("revision")) is not int or result["revision"] < 1 or result["revision"] > 2**53 - 1):
                raise AgentError(-32602, "Invalid acknowledged game mutation receipt.")
        if set(result) != expected:
            raise AgentError(-32602, "Unexpected game mutation receipt fields.")
        return result

    def list_game_revisions(self, project_id: str, cursor: int = 0, limit: int = 30, order: str = "asc") -> dict:
        return self.call("games.revisions.list", {"projectId": project_id, "cursor": cursor, "limit": limit, "order": order})

    def compare_game_revisions(self, project_id: str, base_revision: int, target_revision: int, section: str = "all", cursor: int = 0, limit: int = 30) -> dict:
        """Read a paged structural comparison of two exact revisions; never restore or approve them."""
        result = self.call("games.revisions.compare", {"projectId": project_id, "baseRevision": base_revision,
                           "targetRevision": target_revision, "section": section, "cursor": cursor, "limit": limit})
        if (not isinstance(result, dict) or not isinstance(result.get("base"), dict) or not isinstance(result.get("target"), dict)
                or result.get("projectId") != project_id or result["base"].get("revision") != base_revision
                or result["target"].get("revision") != target_revision or result.get("section") != section):
            raise AgentError(-32602, "Comparison identity differs from the selected immutable revisions.")
        return result

    def compare_game_file(self, project_id: str, base_revision: int, target_revision: int, path: str,
                          context: int = 3, cursor: int = 0, limit: int = 50, binding_hash: str | None = None) -> dict:
        """Read exact UTF-8 lines; unavailable projections never truncate original files."""
        request = {"projectId": project_id, "baseRevision": base_revision, "targetRevision": target_revision,
                   "path": path, "context": context, "cursor": cursor, "limit": limit}
        if binding_hash is not None:
            request["bindingHash"] = binding_hash
        result = self.call("games.revisions.compareFile", request)
        if (not isinstance(result, dict) or not isinstance(result.get("base"), dict) or not isinstance(result.get("target"), dict)
                or result.get("projectId") != project_id or result["base"].get("revision") != base_revision
                or result["target"].get("revision") != target_revision or result.get("path") != path
                or result.get("context") != context or not isinstance(result.get("rows"), list)
                or result.get("cursor") != cursor + len(result["rows"])
                or binding_hash is not None and result.get("bindingHash") != binding_hash):
            raise AgentError(-32602, "File comparison identity differs from the selected immutable revisions.")
        return result

    def convert_legacy_game_design(self, design: dict) -> dict:
        transfer = self._game_request("games.design.convertLegacy", {"design": design})
        return json.loads(self.download(transfer["id"]))

    def read_game_events(self, project_id: str, cursor: int = 0, limit: int = 100) -> dict:
        return self.call("games.events.read", {"projectId": project_id, "cursor": cursor, "limit": limit})

    def upload_game_file(self, path: str, data: bytes, mime: str = "application/octet-stream") -> dict:
        sha = hashlib.sha256(data).hexdigest()
        transfer = self.upload("game-file:" + sha, data, "application/octet-stream")
        return {"path": path, "sha256": sha, "size": len(data), "mime": mime, "transferId": transfer["id"]}

    def download_game_file(self, project_id: str, path: str, revision: int | None = None) -> bytes:
        request = {"projectId": project_id, "path": path}
        if revision is not None:
            request["revision"] = revision
        transfer = self.call("games.files.get", request)
        return self.download(transfer["id"])

    def export_game_project(self, identifier: str) -> dict:
        transfer = self.call("games.projects.export", {"id": identifier})
        return json.loads(self.download(transfer["id"]))

    def import_game_project(self, request_id: str, archive: dict, blobs: dict[str, bytes]) -> dict:
        needed = dict.fromkeys(file["sha256"] for row in archive["revisions"] for file in row["document"]["files"])
        references = []
        for sha in needed:
            data = blobs.get(sha)
            if data is None or hashlib.sha256(data).hexdigest() != sha:
                raise AgentError(-32602, "Faltam os arquivos originais ou o SHA-256 não corresponde.")
            transfer = self.upload("game-file:" + sha, data, "application/octet-stream")
            references.append({"sha256": sha, "transferId": transfer["id"]})
        data = json.dumps(archive, ensure_ascii=False, separators=(",", ":")).encode()
        transfer = self.upload("game-archive:" + hashlib.sha256(data).hexdigest(), data)
        return self._game_request("games.projects.import", {"requestId": request_id, "transferId": transfer["id"], "blobs": references})

    def game_production_capabilities(self) -> dict:
        return self.call("games.production.capabilities", {})

    def create_game_playtest(self, request: dict) -> dict:
        return self.call("games.playtests.create", request)

    def record_game_playtest(self, request: dict) -> dict:
        return self.call("games.playtests.record", request)

    def withdraw_game_playtest(self, request: dict) -> dict:
        return self.call("games.playtests.withdraw", request)

    def correct_game_playtest(self, request: dict) -> dict:
        return self.call("games.playtests.correct", request)

    def get_game_playtest_corrections(self, study_id: str, participant_id: str, cursor: int = 0, limit: int = 30) -> dict:
        return self.call("games.playtests.corrections", {"studyId": study_id, "participantId": participant_id, "cursor": cursor, "limit": limit})

    def get_game_playtest(self, study_id: str, cursor: int = 0, limit: int = 30) -> dict:
        return self.call("games.playtests.read", {"studyId": study_id, "cursor": cursor, "limit": limit})

    def inspect_game_playtest(self, request_id: str) -> dict:
        return self.call("games.playtests.inspect", {"requestId": request_id})

    def export_game_playtest(self, study_id: str, include_responses: bool = False) -> dict:
        transfer = self.call("games.playtests.export", {"studyId": study_id, "includeResponses": include_responses})
        return json.loads(self.download(transfer["id"]))

    def list_game_playtests(self, project_id: str, cursor: int = 0, limit: int = 30) -> dict:
        return self.call("games.playtests.list", {"projectId": project_id, "cursor": cursor, "limit": limit})

    def get_inference_budgets(self, session_id: str) -> dict:
        return self.call("inference.budgets.get", {"sessionId": session_id})

    def get_game_workflow(self, project_id: str) -> dict:
        transfer = self.call("games.workflows.get", {"projectId": project_id})
        return json.loads(self.download(transfer["id"]))

    def advance_game_stage(self, request_id: str, project_id: str, expected_version: int, expected_revision: int) -> dict:
        return self.call("games.workflows.advance", {"requestId": request_id, "projectId": project_id, "expectedVersion": expected_version, "expectedRevision": expected_revision})

    def continue_game_production(self, request_id: str, project_id: str, expected_version: int, expected_revision: int) -> dict:
        return self.call("games.workflows.continue", {"requestId": request_id, "projectId": project_id, "expectedVersion": expected_version, "expectedRevision": expected_revision})

    def reopen_game_production(self, request_id: str, project_id: str, expected_version: int, expected_revision: int) -> dict:
        return self.call("games.workflows.reopen", {"requestId": request_id, "projectId": project_id, "expectedVersion": expected_version, "expectedRevision": expected_revision})

    def read_game_workflow_events(self, project_id: str, cursor: int = 0, limit: int = 30, until: int | None = None) -> dict:
        request = {"projectId": project_id, "cursor": cursor, "limit": limit}
        if until is not None:
            request["until"] = until
        transfer = self.call("games.workflows.events", request)
        return json.loads(self.download(transfer["id"]))

    def process_game_asset(self, request_id: str, project_id: str, revision: int, spec: dict) -> dict:
        return self._game_request("games.assets.process", {"requestId": request_id, "projectId": project_id, "revision": revision, "spec": spec})

    def inspect_game_asset_request(self, request_id: str, project_id: str, revision: int, spec: dict) -> dict:
        """Read the exact server-bound request, never dispatch/replay a processor.

        Missing is not absence/cancellation proof. Keep requestHash as the
        service's canonical digest; do not recreate JavaScript float hashing.
        """
        result = self._game_request("games.assets.inspect", {"requestId": request_id, "projectId": project_id, "revision": revision, "spec": spec})
        allowed = {"requestId", "projectId", "revision", "requestHash", "state"}
        if isinstance(result, dict) and result.get("state") == "acknowledged":
            allowed.add("jobId")
        if (not isinstance(result, dict) or set(result) != allowed or result.get("requestId") != request_id
                or result.get("projectId") != project_id or type(result.get("revision")) is not int or result.get("revision") != revision
                or result.get("state") not in ("missing", "acknowledged")
                or not isinstance(result.get("requestHash"), str) or len(result["requestHash"]) != 64
                or any(c not in "0123456789abcdef" for c in result["requestHash"])
                or result["state"] == "acknowledged" and (not isinstance(result.get("jobId"), str) or not 1 <= len(result["jobId"]) <= 160)):
            raise RuntimeError("Asset request inspection differs from its exact request")
        return result

    def list_game_libraries(self, query: dict | None = None) -> dict:
        return self.call("games.assets.libraries", query or {})

    def get_game_asset_result(self, identifier: str) -> dict:
        transfer = self.call("games.assets.result", {"id": identifier})
        return json.loads(self.download(transfer["id"]))

    def apply_game_asset(self, request_id: str, job_id: str, expected_revision: int) -> dict:
        return self._game_request("games.assets.apply", {"requestId": request_id, "jobId": job_id, "expectedRevision": expected_revision})

    def download_game_asset_file(self, job_id: str, path: str) -> bytes:
        transfer = self.call("games.assets.file", {"jobId": job_id, "path": path})
        return self.download(transfer["id"])

    def linked_game_project(self, session_id: str) -> dict | None:
        return self.call("games.projects.linked", {"sessionId": session_id})

    def select_game_project(self, session_id: str, project_id: str) -> dict:
        return self.call("games.projects.select", {"sessionId": session_id, "projectId": project_id})

    def start_game_build(self, request_id: str, project_id: str, revision: int) -> dict:
        return self.call("games.builds.start", {"requestId": request_id, "projectId": project_id, "revision": revision})

    def start_game_validation(self, request_id: str, build_id: str, collector_id: str, test_suite: str | None = None) -> dict:
        return self.call("games.validation.start", {"requestId": request_id, "buildId": build_id, "collectorId": collector_id, **({"testSuite": test_suite} if test_suite else {})})

    def download_game_report_file(self, report_id: str, path: str) -> bytes:
        transfer = self.call("games.validation.file", {"reportId": report_id, "path": path})
        return self.download(transfer["id"])

    def get_game_production(self, identifier: str) -> dict:
        return self.call("games.production.get", {"id": identifier})

    def cancel_game_production(self, identifier: str) -> dict:
        return self.call("games.production.cancel", {"id": identifier})

    def reconcile_game_production(self, identifier: str) -> dict:
        return self.call("games.production.reconcile", {"id": identifier})

    def list_game_production(self, project_id: str, cursor: int = 0, limit: int = 30, order: str = "asc") -> dict:
        return self.call("games.production.list", {"projectId": project_id, "cursor": cursor, "limit": limit, "order": order})

    def read_game_production_events(self, project_id: str, cursor: int = 0, limit: int = 100) -> dict:
        return self.call("games.production.events", {"projectId": project_id, "cursor": cursor, "limit": limit})

    def get_game_artifact(self, identifier: str) -> dict:
        transfer = self.call("games.builds.artifact", {"id": identifier})
        return json.loads(self.download(transfer["id"]))

    def download_game_artifact_file(self, build_id: str, path: str) -> bytes:
        transfer = self.call("games.builds.file", {"buildId": build_id, "path": path})
        return self.download(transfer["id"])

    def get_game_reports(self, identifier: str) -> list[dict]:
        transfer = self.call("games.validation.reports", {"id": identifier})
        return json.loads(self.download(transfer["id"]))

    def get_game_quality(self, project_id: str, revision: int | None = None) -> dict:
        params = {"projectId": project_id}
        if revision is not None:
            params["revision"] = revision
        transfer = self.call("games.quality.get", params)
        return json.loads(self.download(transfer["id"]))

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

    def inspect_tool(self, run_id: str, call_id: str) -> dict:
        """Ask the installed authority to inspect the original effect, without a UI result."""
        return self.call("tools.inspect", {"runId": run_id, "callId": call_id})

    def inspect_inference(self, run_id: str) -> dict:
        """Inspect the original provider receipt without supplying a result or usage."""
        return self.call("inference.inspect", {"runId": run_id})

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
