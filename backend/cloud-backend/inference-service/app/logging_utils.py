import json
import logging
from typing import Any, Dict

from .config import settings


logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(message)s",
)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def log_event(logger: logging.Logger, event: str, **fields: Any) -> None:
    payload: Dict[str, Any] = {"event": event, **fields}
    logger.info(json.dumps(payload, default=str))
