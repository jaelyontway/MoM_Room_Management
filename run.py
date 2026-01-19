#!/usr/bin/env python
"""Simple script to run the FastAPI application."""
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=False  # Disabled to avoid caching issues
    )

