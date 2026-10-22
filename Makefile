.PHONY: demo up down reset test venv

export DATABASE_URL := postgresql://hub:hub@127.0.0.1:54329/contexthub
export MOCK_BASE_URL := http://127.0.0.1:8001
export HUB_BASE_URL := http://127.0.0.1:8000
export BLOB_DIR := $(CURDIR)/data/raw

venv:
	test -x .venv/bin/python || python3 -m venv .venv
	.venv/bin/pip install -q -r requirements.txt

up: venv
	docker compose up -d
	.venv/bin/python scripts/wait_for_db.py

demo: up
	cd dashboard && npm install
	bash scripts/demo.sh

test: up
	.venv/bin/python -m pytest -q

down:
	docker compose down

reset:
	docker compose down -v
	rm -rf data
