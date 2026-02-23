from typing import Optional
from pydantic import BaseModel


class InferRequest(BaseModel):
    patient_id: str
    target_model_version: str
    source_write_time: Optional[str] = None


class InferResponse(BaseModel):
    ok: bool
    status: str
    patient_id: str
    model_version: str
    detail: Optional[str] = None
