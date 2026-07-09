"""Workflow templates router - checkbox-based automation."""
import json
from fastapi import APIRouter, HTTPException, Depends

from app.database import get_db
from app.utils.auth import get_current_user, generate_id

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


@router.get("/templates")
async def list_templates(
    case_type: str = None,
    current_user: dict = Depends(get_current_user)
):
    """List available workflow templates."""
    with get_db() as db:
        if case_type:
            templates = db.execute(
                "SELECT * FROM workflow_templates WHERE case_type = ?",
                (case_type,)
            ).fetchall()
        else:
            templates = db.execute("SELECT * FROM workflow_templates").fetchall()

        result = []
        for t in templates:
            td = dict(t)
            td["tasks"] = json.loads(td["tasks_json"])
            del td["tasks_json"]
            result.append(td)
        return result


@router.post("/templates")
async def create_template(
    name: str,
    case_type: str,
    tasks: list[str],
    current_user: dict = Depends(get_current_user)
):
    """Create a new workflow template."""
    template_id = generate_id()
    with get_db() as db:
        db.execute(
            "INSERT INTO workflow_templates (id, name, case_type, tasks_json) VALUES (?, ?, ?, ?)",
            (template_id, name, case_type, json.dumps(tasks))
        )
        return {"id": template_id, "name": name, "case_type": case_type, "tasks": tasks}


@router.post("/apply/{template_id}/{case_id}")
async def apply_template(
    template_id: str,
    case_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Apply a workflow template to a case, creating all tasks."""
    tenant_id = current_user["tenant_id"]
    with get_db() as db:
        template = db.execute(
            "SELECT * FROM workflow_templates WHERE id = ?", (template_id,)
        ).fetchone()
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")

        case = db.execute(
            "SELECT * FROM cases WHERE id = ? AND tenant_id = ?",
            (case_id, tenant_id)
        ).fetchone()
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        tasks = json.loads(template["tasks_json"])
        created_tasks = []
        for task_title in tasks:
            task_id = generate_id()
            db.execute(
                """INSERT INTO tasks (id, case_id, tenant_id, title, status, priority)
                   VALUES (?, ?, ?, ?, 'pending', 'medium')""",
                (task_id, case_id, tenant_id, task_title)
            )
            created_tasks.append({"id": task_id, "title": task_title, "status": "pending"})

        return {"case_id": case_id, "template": template["name"], "tasks_created": len(created_tasks), "tasks": created_tasks}
