"""Public contract for private note templates and trade images."""

def extend_note_library(schema):
    workspace = {"name": "X-Workspace-Id", "in": "header", "required": True, "schema": {"type": "string"}}
    idem = {"name": "Idempotency-Key", "in": "header", "required": False, "schema": {"type": "string", "minLength": 1, "maxLength": 200}}
    text = {"type": "string"}
    uid = {"type": "string", "format": "uuid"}
    revision = {"type": "integer", "minimum": 0}
    document = {"type": "object", "additionalProperties": False, "required": ["format", "version", "blocks"], "properties": {"format": {"const": "blocknote"}, "version": {"const": 1}, "blocks": {"type": "array", "minItems": 1, "maxItems": 256, "items": {"type": "object"}}}}
    name = {"type": "string", "minLength": 1, "maxLength": 160}
    item = {"type": "object", "required": ["id", "name", "document", "revision", "updated_at_utc"], "properties": {"id": uid, "name": name, "document": document, "revision": revision, "updated_at_utc": {"type": "string", "format": "date-time"}}}
    preferences = {"type": "object", "required": ["revision", "favorites", "defaults"], "properties": {"revision": revision, "favorites": {"type": "array", "maxItems": 202, "uniqueItems": True, "items": text}, "defaults": {"type": "object", "additionalProperties": False, "properties": {key: text for key in ("testing-trades", "live-trades", "live-notes")}}}}
    catalog = {"type": "object", "required": ["version", "items", "preferences"], "properties": {"version": {"const": "note-templates-v1"}, "items": {"type": "array", "items": item}, "preferences": preferences, "saved_id": uid}}
    def operation(identifier, response):
        return {"operationId": identifier, "parameters": [workspace.copy()], "responses": {"200": {"description": "Workspace-scoped result", "content": {"application/json": {"schema": response}}}, "403": {"description": "Workspace denied"}, "404": {"description": "Item not in scope"}, "409": {"description": "Revision conflict, duplicate, or quota; read again"}, "422": {"description": "Invalid request"}, "503": {"description": "Unavailable or unknown commit outcome; reconcile receipt"}}}
    def draft(action, fields):
        properties = {"action": {"const": action}, **fields}
        return {"type": "object", "additionalProperties": False, "required": list(properties), "properties": properties}
    read = operation("note_templates_read", catalog)
    write = operation("note_templates_write", catalog)
    write["parameters"].append(idem)
    write["requestBody"] = {"required": True, "content": {"application/json": {"schema": {"oneOf": [draft("create", {"name": name, "document": document}), draft("update", {"id": uid, "expected_revision": revision, "name": name, "document": document}), draft("delete", {"id": uid, "expected_revision": revision}), draft("preferences", {"expected_revision": revision, "favorites": preferences["properties"]["favorites"], "defaults": preferences["properties"]["defaults"]})]}}}}
    write["description"] = "Identity-private templates and preferences within a workspace. Built-in IDs beginner/daily-report are immutable. Deletion clears dependent favorites/defaults atomically. Native idempotency and revision guards apply."
    schema["paths"]["/api/v2/note-templates"] = {"get": read, "post": write}
    media_item = {"type": "object", "required": ["id", "name", "mime_type", "bytes", "created_at_utc"], "properties": {"id": uid, "name": name, "mime_type": text, "bytes": {"type": "integer"}, "created_at_utc": {"type": "string", "format": "date-time"}}}
    read = operation("trade_media_list", {"type": "object", "required": ["items"], "properties": {"items": {"type": "array", "items": media_item}}})
    read["parameters"] += [{"name": "session_id", "in": "query", "required": True, "schema": {"type": "string", "maxLength": 128}}, {"name": "trade_id", "in": "query", "required": True, "schema": {"type": "string", "maxLength": 512}}]
    write = operation("trade_media_write", {"type": "object", "properties": {"id": uid, "removed_id": uid}})
    write["parameters"].append(idem)
    write["requestBody"] = {"required": True, "content": {"application/json": {"schema": {"oneOf": [draft("upload", {"session_id": text, "trade_id": text, "name": name, "mime_type": {"enum": ["image/png", "image/jpeg", "image/webp", "image/gif"]}, "data": {"type": "string", "contentEncoding": "base64"}}), draft("remove_media", {"id": uid})]}}}}
    write["description"] = "Local PostgreSQL images: max 5 MiB each, 50 per persisted trade, 200 MiB per workspace. Signatures checked, SVG/HTML rejected. Same trade+digest deduplicates. No filesystem paths or broker writes."
    schema["paths"]["/api/v2/trade-media"] = {"get": read, "post": write}
    image = operation("trade_media_image", {})
    image["parameters"].append({"name": "media_id", "in": "path", "required": True, "schema": uid})
    image["responses"]["200"] = {"description": "Workspace-authorized bytes; private no-store and nosniff", "content": {kind: {"schema": {"type": "string", "format": "binary"}} for kind in ("image/png", "image/jpeg", "image/webp", "image/gif")}}
    schema["paths"]["/api/v2/trade-media/{media_id}"] = {"get": image}

    note_type = {"type":"object","additionalProperties":False,"required":["id","name","color","archived"],"properties":{"id":{"type":"string"},"name":{"type":"string","minLength":1,"maxLength":64},"color":{"enum":["green","blue","orange","red","purple","cyan","gray"]},"archived":{"type":"boolean"}}}
    types = {"type":"array","minItems":4,"maxItems":100,"items":note_type}
    result = {"type":"object","required":["version","revision","items"],"properties":{"version":{"const":"note-types-v1"},"revision":revision,"items":types}}
    read = operation("note_types_read",result)
    write = operation("note_types_write",result)
    write["parameters"].append(idem.copy())
    write["requestBody"] = {"required":True,"content":{"application/json":{"schema":{"type":"object","additionalProperties":False,"required":["expected_revision","items"],"properties":{"expected_revision":revision,"items":types}}}}}
    write["description"] = "Workspace note types with optimistic revisions and idempotency. Four built-in identities cannot be archived or removed. Custom types use custom_<UUID>. Deletion archives the type so existing note references remain readable. Names, colors and active type IDs are persisted. Display order is a browser preference."
    schema["paths"]["/api/v2/note-types"]={"get":read,"post":write}
