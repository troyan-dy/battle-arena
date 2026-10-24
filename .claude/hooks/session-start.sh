#!/bin/bash
# Подготовка облачной сессии Claude Code: игра (live/) зависимостей не имеет,
# пайплайну ассетов (tools/*.py) и его линтеру нужно то, что в requirements-dev.txt.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

command -v node >/dev/null || { echo "session-start: node не найден" >&2; exit 1; }

pip_install() {
  python3 -m pip install --quiet --disable-pip-version-check "$@" \
    || python3 -m pip install --quiet --disable-pip-version-check --break-system-packages "$@"
}
pip_install -r requirements-dev.txt   # уже стоящее pip не трогает
python3 - <<'PY'
from importlib.metadata import entry_points

import numpy, PIL, scipy  # noqa: F401 — the asset tools need them
assert any(ep.name == 'WPS' for ep in entry_points(group='flake8.extension')), 'flake8 не видит wemake-python-styleguide'
PY

echo "session-start: готово (проверки: node live/tune.cjs, python3 -m flake8 .)"
