#!/bin/bash
# Подготовка облачной сессии Claude Code: игра (live/) зависимостей не имеет,
# пайплайну ассетов (tools/*.py) нужны Pillow, numpy и scipy.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

command -v node >/dev/null || { echo "session-start: node не найден" >&2; exit 1; }

if ! python3 -c 'import PIL, numpy, scipy' 2>/dev/null; then
  python3 -m pip install --quiet --disable-pip-version-check pillow numpy scipy \
    || python3 -m pip install --quiet --disable-pip-version-check --break-system-packages pillow numpy scipy
fi

echo "session-start: готово (проверка: node live/tune.cjs)"
