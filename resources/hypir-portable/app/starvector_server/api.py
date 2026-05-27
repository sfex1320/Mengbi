"""StarVector FastAPI + 任务队列(端口 7867)。

复用 hypir/supir 完全一致的接口形态:
   GET  /api/status            服务 + 模型 probe
   POST /api/tasks             提交任务(返回 task_id)
   GET  /api/tasks/{id}        查询任务(进度 / 结果 / 错误码)
   POST /api/tasks/{id}/cancel 取消任务
   POST /api/unload            从显存卸载模型
   POST /api/cleanup           清 GPU cache(可选同时 unload)
   POST /api/shutdown          关进程
"""
from __future__ import annotations

import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from queue import Queue, Empty
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .adapter import StarVectorAdapter
from .config import StarVectorConfig
from .errors import (
    StarVectorError,
    E_TASK_NOT_FOUND,
    map_runtime_exception,
)


@dataclass
class TaskRecord:
    task_id: str
    status: str
    progress: int = 0
    message: str = ""
    output_path: str = ""
    error_code: Optional[str] = None
    error_message_zh: Optional[str] = None
    error_hint: Optional[str] = None
    error_detail: Optional[str] = None
    submitted_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    params: dict = field(default_factory=dict)
    result_info: dict = field(default_factory=dict)
    cancel_event: threading.Event = field(default_factory=threading.Event)


class SubmitTaskInput(BaseModel):
    input_path: str = Field(min_length=1)
    max_new_tokens: int = Field(default=8192, ge=64, le=16384)
    temperature: float = Field(default=0.1, ge=0.0, le=2.0)
    do_sample: bool = False


def create_app(cfg: StarVectorConfig) -> FastAPI:
    app = FastAPI(title="StarVector Portable", version="1.0")
    adapter = StarVectorAdapter(cfg)

    tasks: Dict[str, TaskRecord] = {}
    task_queue: "Queue[str]" = Queue()
    shutdown_event = threading.Event()

    def worker():
        while not shutdown_event.is_set():
            try:
                task_id = task_queue.get(timeout=0.5)
            except Empty:
                continue
            task = tasks.get(task_id)
            if not task or task.status == "cancelled":
                continue
            task.status = "running"
            task.started_at = time.time()

            def progress_cb(pct: int, msg: str):
                if task.cancel_event.is_set():
                    raise StarVectorError(code="CANCELLED", message_zh="任务已取消")
                task.progress = pct
                task.message = msg

            try:
                result = adapter.vectorize(
                    input_path=task.params["input_path"],
                    max_new_tokens=task.params.get("max_new_tokens", 8192),
                    temperature=task.params.get("temperature", 0.1),
                    do_sample=task.params.get("do_sample", False),
                    progress_cb=progress_cb,
                )
                task.result_info = result
                task.status = "done"
                task.progress = 100
                duration = result.get("duration_seconds", 0)
                task.message = f"完成({duration:.1f}s)"
            except StarVectorError as e:
                if e.code == "CANCELLED":
                    task.status = "cancelled"
                    task.message = "已取消"
                else:
                    task.status = "failed"
                    task.error_code = e.code
                    task.error_message_zh = e.message_zh
                    task.error_hint = e.hint
                    task.error_detail = e.detail or ""
                    task.message = e.message_zh
            except Exception as e:
                mapped = map_runtime_exception(e)
                task.status = "failed"
                task.error_code = mapped.code
                task.error_message_zh = mapped.message_zh
                task.error_hint = mapped.hint
                task.error_detail = (mapped.detail or "") + "\n" + traceback.format_exc()
                task.message = mapped.message_zh
            finally:
                task.finished_at = time.time()
                task_queue.task_done()

    worker_thread = threading.Thread(target=worker, daemon=True, name="starvector-worker")
    worker_thread.start()

    if cfg.eager_load_models:
        def warm():
            try:
                adapter.ensure_loaded()
            except Exception:
                pass

        threading.Thread(target=warm, daemon=True, name="starvector-warm").start()

    # ── routes ─────────────────────────────────────────

    @app.get("/api/status")
    def status():
        probe = adapter.probe()
        return {
            "server": "running",
            "engine": "StarVector",
            "model_loaded": probe.get("model_loaded"),
            "loaded_path": probe.get("loaded_path"),
            "port": cfg.port,
            "host": cfg.host,
            "queue_size": task_queue.qsize(),
            "active_tasks": len([t for t in tasks.values() if t.status in ("queued", "running")]),
            "probe": probe,
            "version": "1.0",
        }

    @app.post("/api/tasks")
    def submit_task(payload: SubmitTaskInput):
        task_id = uuid.uuid4().hex
        rec = TaskRecord(task_id=task_id, status="queued", params=payload.dict())
        tasks[task_id] = rec
        task_queue.put(task_id)
        return {"success": True, "task_id": task_id, "status": "queued"}

    @app.get("/api/tasks/{task_id}")
    def get_task(task_id: str):
        t = tasks.get(task_id)
        if not t:
            raise HTTPException(
                404, detail={"error_code": E_TASK_NOT_FOUND, "error_message_zh": "任务不存在"}
            )
        dur = None
        if t.started_at and t.finished_at:
            dur = round(t.finished_at - t.started_at, 2)
        return {
            "task_id": t.task_id,
            "status": t.status,
            "progress": t.progress,
            "message": t.message,
            "output_path": t.output_path,
            "error_code": t.error_code,
            "error_message_zh": t.error_message_zh,
            "error_hint": t.error_hint,
            "error_detail": t.error_detail,
            "submitted_at": t.submitted_at,
            "started_at": t.started_at,
            "finished_at": t.finished_at,
            "duration_seconds": dur or t.result_info.get("duration_seconds"),
            "result_info": t.result_info,
        }

    @app.post("/api/tasks/{task_id}/cancel")
    def cancel_task(task_id: str):
        t = tasks.get(task_id)
        if not t:
            raise HTTPException(
                404, detail={"error_code": E_TASK_NOT_FOUND, "error_message_zh": "任务不存在"}
            )
        t.cancel_event.set()
        if t.status == "queued":
            t.status = "cancelled"
            t.message = "已取消"
        return {"success": True, "task_id": task_id, "status": t.status}

    @app.post("/api/unload")
    def unload_model():
        acted = adapter.unload()
        probe = adapter.probe()
        return {
            "success": True,
            "unloaded": acted,
            "model_loaded": probe.get("model_loaded"),
            "vram_used_mb": probe.get("vram_used_mb"),
        }

    @app.post("/api/cleanup")
    def cleanup(payload: dict = None):  # type: ignore[assignment]
        unload_model_flag = bool((payload or {}).get("unload_model", False))
        unloaded = False
        if unload_model_flag:
            unloaded = adapter.unload()
        info = adapter.clear_cache()
        return {"success": True, "unloaded": unloaded, **info}

    @app.post("/api/shutdown")
    def shutdown():
        shutdown_event.set()
        import threading as _t

        def stop_later():
            import os
            import signal
            os.kill(os.getpid(), signal.SIGTERM if hasattr(signal, "SIGTERM") else signal.SIGINT)

        _t.Timer(0.3, stop_later).start()
        return {"success": True, "message": "shutting down"}

    return app
