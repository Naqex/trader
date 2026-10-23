"""Offline graph/protocol tests; run with the optional workflow environment."""
import asyncio
import json
import subprocess
import sys
from pathlib import Path

import pytest

from trading_workspace_v2.ai_workflow import build_graph


def test_parallel_branches_isolate_state_and_reviewer_waits_for_both():
    async def run():
        arrived = set()
        both = asyncio.Event()
        done = set()

        async def call(node):
            if node == "reviewer":
                assert done == {"facts", "gaps"}
            else:
                arrived.add(node)
                if len(arrived) == 2:
                    both.set()
                await asyncio.wait_for(both.wait(), 1)
                done.add(node)
            return node + " evidence"

        return await build_graph(call).ainvoke({}, {"recursion_limit": 5})

    assert asyncio.run(run()) == {"facts": "facts evidence", "gaps": "gaps evidence", "text": "reviewer evidence"}


def test_branch_failure_never_runs_reviewer():
    async def run():
        called = []

        async def call(node):
            called.append(node)
            if node == "facts":
                raise ValueError("synthetic")
            await asyncio.sleep(0.01)
            return "evidence"

        with pytest.raises(ValueError, match="synthetic"):
            await build_graph(call).ainvoke({})
        assert "reviewer" not in called

    asyncio.run(run())


def test_warm_pipe_handles_two_runs_without_transcript_leak():
    script = Path(__file__).resolve().parents[1] / "trading_workspace_v2/ai_workflow.py"
    process = subprocess.Popen([sys.executable, "-I", "-u", str(script)], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    def read():
        return json.loads(process.stdout.readline())
    def write(value):
        process.stdin.write((json.dumps(value) + "\n").encode())
        process.stdin.flush()
    try:
        assert read() == {"type": "ready", "protocol": 1}
        for run in ["one", "two"]:
            write({"type": "start", "run": run})
            nodes = [read(), read()]
            assert {m["node"] for m in nodes} == {"facts", "gaps"}
            for message in nodes:
                assert message["run"] == run
                write({"type": "result", "run": run, "node": message["node"], "text": "dữ liệu " + run})
            assert read() == {"type": "call", "run": run, "node": "reviewer"}
            write({"type": "result", "run": run, "node": "reviewer", "text": "summary " + run})
            assert read() == {"type": "completed", "run": run}
        process.stdin.close()
        assert process.wait(timeout=5) == 0
        assert process.stderr.read() == b""
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
