"""Context Hub entrypoint."""

import uvicorn

if __name__ == "__main__":
    uvicorn.run("hub.app:app", host="127.0.0.1", port=8000, reload=False)
