#!/usr/bin/env sh
set -eu
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"

VENV_DIR="$ROOT/.venv"
VENV_PYTHON="$VENV_DIR/bin/python"

if [ ! -x "$VENV_PYTHON" ]; then
  printf '%s\n' '[IMAS] Создание изолированного окружения Python...'
  if command -v python3 >/dev/null 2>&1; then
    python3 -m venv "$VENV_DIR"
  elif command -v python >/dev/null 2>&1; then
    python -m venv "$VENV_DIR"
  else
    printf '%s\n' '[ОШИБКА] Python 3.11 или новее не найден.' >&2
    exit 1
  fi
fi

printf '%s\n' '[IMAS] Проверка и установка зависимостей Python...'
"$VENV_PYTHON" -m pip install --disable-pip-version-check --upgrade pip
"$VENV_PYTHON" -m pip install --disable-pip-version-check -r "$ROOT/requirements.txt"
"$VENV_PYTHON" -X utf8 "$ROOT/check_environment.py"
"$VENV_PYTHON" -X utf8 "$ROOT/encoding_audit.py"
export PYTHON="$VENV_PYTHON"

if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' '[ОШИБКА] npm не найден. Установите Node.js 20.19 или новее.' >&2
  exit 1
fi

cd "$ROOT/gui"
if [ ! -d node_modules ]; then
  printf '%s\n' '[IMAS] Установка зависимостей интерфейса...'
  npm ci
fi
printf '%s\n' '[IMAS] Сборка интерфейса...'
npm run build
printf '%s\n' '[IMAS] Запуск: http://127.0.0.1:4173'
npm start
