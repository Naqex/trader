"""Fixed read-only graph. All inference crosses the Rust-owned pipe boundary.

No provider SDK, credentials, network client, broker or dynamically supplied tool.
The process stays warm; graph state is fresh per run. Public durable observations
belong to Rust/PostgreSQL. This pilot deliberately does not resume interrupted calls.
"""
import asyncio
import json
import sys
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

LIMIT = 900_000


class ReviewState(TypedDict, total=False):
    facts: str
    gaps: str
    text: str


def build_graph(call):
    async def facts(_state: ReviewState):
        return {"facts": await call("facts")}

    async def gaps(_state: ReviewState):
        return {"gaps": await call("gaps")}

    async def reviewer(state: ReviewState):
        return {"text": await call("reviewer")}

    graph = StateGraph(ReviewState)
    graph.add_node("facts", facts)
    graph.add_node("gaps", gaps)
    graph.add_node("reviewer", reviewer)
    graph.add_edge(START, "facts")
    graph.add_edge(START, "gaps")
    graph.add_edge(["facts", "gaps"], "reviewer")
    graph.add_edge("reviewer", END)
    return graph.compile()


def emit(value):
    wire = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(wire.encode("utf-8")) > LIMIT:
        raise ValueError("protocol_limit")
    print(wire, flush=True)


async def read():
    # One reader only; bound readline itself instead of validating after allocation.
    line = await asyncio.to_thread(sys.stdin.buffer.readline, LIMIT + 1)
    if not line:
        raise EOFError
    if len(line) > LIMIT or not line.endswith(b"\n"):
        raise ValueError("protocol_limit")
    return json.loads(line)


async def main():
    emit({"type": "ready", "protocol": 1})
    while True:
        start = await read()
        if set(start) != {"type", "run"} or start["type"] != "start":
            raise ValueError("protocol_start")
        run = start["run"]
        pending = {}

        async def call(node):
            future = asyncio.get_running_loop().create_future()
            pending[node] = future
            emit({"type": "call", "run": run, "node": node})
            return await future

        task = asyncio.create_task(build_graph(call).ainvoke({}, {"recursion_limit": 5}))
        reader = asyncio.create_task(read())
        try:
            while not task.done():
                done, _ = await asyncio.wait([task, reader], return_when=asyncio.FIRST_COMPLETED)
                if reader in done:
                    response = reader.result()
                    if set(response) != {"type", "run", "node", "text"} or response["type"] != "result" or response["run"] != run:
                        raise ValueError("protocol_result")
                    node = response["node"]
                    future = pending.pop(node)
                    if not isinstance(response["text"], str) or len(response["text"].encode("utf-8")) > 262_144:
                        raise ValueError("protocol_text")
                    future.set_result(response["text"])
                    # Do not leave a blocking stdin reader behind between runs.
                    reader = asyncio.create_task(read()) if node != "reviewer" else None
                if reader is None:
                    await task
            await task
            if pending:
                raise ValueError("protocol_pending")
            emit({"type": "completed", "run": run})
        finally:
            if reader is not None and not reader.done():
                reader.cancel()
            if not task.done():
                task.cancel()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        asyncio.run(main())
    except EOFError:
        pass
    except Exception:
        # Never put source text, prompt or credentials in stderr/protocol errors.
        emit({"type": "failed"})
        sys.exit(2)
