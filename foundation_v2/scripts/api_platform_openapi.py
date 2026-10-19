"""Add the native operational surface to the frozen Python domain data contract."""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

from export_api_command_contracts import export_contracts

ROOT = Path(__file__).resolve().parents[1]


def platform_contract():
    schema = copy.deepcopy(export_contracts()["openapi.json"])
    schema["info"]["title"] = "TradingWorkspace API platform"
    schema["info"]["description"] = (
        "Local trusted identity on loopback. HTTP is served by Axum; domain commands "
        "execute in Python workers. Hosted identity and TLS are not enabled. "
        "Mutations accept Idempotency-Key (1-200 characters, workspace/identity scoped, "
        "retained up to 24 hours). A 503 command_commit_outcome_unknown or 504 "
        "command_pending returns command_id/status_url: reconcile instead of creating "
        "a new command. Unknown mutation outcomes are never automatically replayed."
    )
    error = {"description": "Unavailable or untrusted state", "content": {
        "application/json": {"schema": {"type": "object", "properties": {"detail": {}}}}}}
    def operation(identifier, response, *, scoped=False):
        value = {"operationId": identifier, "responses": {"200": response, "503": copy.deepcopy(error)}}
        if scoped:
            value["parameters"] = [{"name": "X-Workspace-Id", "in": "header", "required": True,
                                    "schema": {"type": "string"}}]
            value["responses"]["403"] = {"description": "Workspace membership denied"}
            value["responses"]["422"] = {"description": "Workspace header required"}
        return value
    json_response = lambda description, body: {"description": description, "content": {
        "application/json": {"schema": body}}}
    health = json_response("Liveness; does not assert database/worker readiness", {"type": "object"})
    schema["paths"]["/health/live"] = {"get": operation("platform_liveness", health)}
    schema["paths"]["/health/ready"] = {"get": operation("platform_readiness", json_response(
        "Database and fresh command-worker contract readiness", {"type": "object"}))}
    status = operation("platform_command_status", json_response("Durable command reconciliation", {
        "type": "object", "required": ["contract_version", "command_id", "workspace_id", "status"],
        "properties": {
            "contract_version": {"const": "api-command-v1"}, "command_id": {"type": "string", "format": "uuid"},
            "workspace_id": {"type": "string"},
            "status": {"enum": ["queued", "running", "completed", "failed"]},
            "result_status": {"type": ["integer", "null"]}, "result_body": {},
            "result_text": {"type": ["string", "null"]}, "result_headers": {"type": "object"},
            "created_at_utc": {"type": "string", "format": "date-time"},
            "updated_at_utc": {"type": "string", "format": "date-time"},
        }}), scoped=True)
    status["parameters"].append({"name": "command_id", "in": "path", "required": True,
                                  "schema": {"type": "string", "format": "uuid"}})
    status["responses"]["404"] = {"description": "Not found, foreign identity/workspace, or expired"}
    schema["paths"]["/api/v2/commands/{command_id}"] = {"get": status}
    events = operation("platform_workspace_events", {
        "description": "Latest workspace snapshot; reconnect resynchronizes, not an event-history replay. "
                       "8 streams/workspace, 64 per API process, 256 KiB snapshots, 10-minute connection lifetime.",
        "content": {"text/event-stream": {"schema": {"type": "string"}}}}, scoped=True)
    events["responses"]["429"] = {"description": "Stream admission limit reached"}
    schema["paths"]["/api/v2/events"] = {"get": events}
    metrics = operation("platform_internal_metrics", {"description": "Bounded Prometheus metrics",
        "content": {"text/plain": {"schema": {"type": "string"}}}})
    metrics["parameters"] = [{"name": "Authorization", "in": "header", "required": True,
                              "schema": {"type": "string"}, "description": "Bearer configured metrics token"}]
    metrics["responses"]["404"] = {"description": "Disabled or token mismatch"}
    schema["paths"]["/internal/metrics"] = {"get": metrics}
    account = json_response("Sanitized machine-local ChatGPT browser connection; no credentials. A saved login marker is not a live model test.", {"type": "object"})
    schema["paths"]["/api/v2/ai/chatgpt/account"] = {"get": operation("chatgpt_account_status", account, scoped=True)}
    action = operation("chatgpt_account_action", account, scoped=True)
    action["parameters"].extend([
        {"name": "action", "in": "path", "required": True, "schema": {"enum": ["start", "login", "probe", "selection", "cancel", "disconnect"]}},
        {"name": "Origin", "in": "header", "required": True, "schema": {"type": "string"}, "description": "Same loopback origin as Host; foreign/absent origins denied."},
    ])
    action["requestBody"] = {"required": True, "content": {"application/json": {"schema": {"oneOf": [
        {"type": "object", "maxProperties": 0},
        {"type": "object", "additionalProperties": False, "required": ["model", "effort"], "properties": {"model": {"type": "string"}, "effort": {"type": "string"}}},
    ]}}}}
    action["responses"]["409"] = {"description": "An account or inference operation is already running"}
    action["responses"]["400"] = {"description": "Invalid selection or unavailable account action"}
    action["description"] = "Login/probe return promptly with an operation; poll GET account. Probe sends only a fixed test prompt. Disconnect clears this app's private local browser state. Strategy jobs remain disabled."
    schema["paths"]["/api/v2/ai/chatgpt/account/{action}"] = {"post": action}
    chat_response = json_response("Ephemeral text chat turn, scoped to workspace and identity. No tools or strategy actions.", {"type": "object"})
    chat = operation("chatgpt_chat_start", chat_response, scoped=True)
    chat["responses"]["202"] = chat["responses"].pop("200")
    chat["responses"]["409"] = {"description": "One account or inference operation is already running; never retried automatically"}
    chat["parameters"].append(copy.deepcopy(action["parameters"][-1]))
    chat["requestBody"] = {"required": True, "content": {"application/json": {"schema": {
        "type": "object", "additionalProperties": False, "required": ["messages"], "properties": {
            "messages": {"type": "array", "minItems": 1, "maxItems": 63, "items": {
                "type": "object", "additionalProperties": False, "required": ["role", "content"], "properties": {
                    "role": {"enum": ["user", "assistant"]}, "content": {"type": "string", "minLength": 1}}}}}}}}}
    chat["description"] = "Alternating user/assistant text, ending with user; max 48 KiB JSON. Uses current upstream model/effort selection. Returns promptly; poll by ID. In-memory result expires after 10 minutes or the next turn/API restart. No database history, page context, tools, agents or automatic retry."
    schema["paths"]["/api/v2/ai/chatgpt/chat"] = {"post": chat}
    turn = operation("chatgpt_chat_status", chat_response, scoped=True)
    turn["parameters"].append({"name": "id", "in": "path", "required": True, "schema": {"type": "string", "format": "uuid"}})
    turn["responses"]["404"] = {"description": "Turn expired, unknown or belongs to a different workspace/identity"}
    cancel = copy.deepcopy(turn)
    cancel["operationId"] = "chatgpt_chat_cancel"
    cancel["parameters"].append(copy.deepcopy(action["parameters"][-1]))
    cancel["description"] = "Abort this turn's upstream HTTP request. Already completed results remain completed. Does not disconnect the account."
    schema["paths"]["/api/v2/ai/chatgpt/chat/{id}"] = {"get": turn, "delete": cancel}
    return schema


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Replace the public snapshot after review.")
    args = parser.parse_args()
    target = ROOT / "contracts/openapi.json"
    generated = platform_contract()
    if args.write:
        target.write_text(json.dumps(generated, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    elif json.loads(target.read_text(encoding="utf-8")) != generated:
        raise SystemExit("Native platform OpenAPI drift; regenerate and review the contract.")
    print("PASS: frozen domain shapes and native platform OpenAPI")


if __name__ == "__main__":
    main()
