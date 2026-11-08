"""Entry point for the packaged (PyInstaller) backend used by the desktop app.

Dev runs keep using `python -m uvicorn server:app`.
"""
import os

import uvicorn

from server import app

if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("LUMIO_BACKEND_PORT", "8000")),
        log_level="info",
    )
