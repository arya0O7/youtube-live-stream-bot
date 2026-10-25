#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"
if [ "$1" == "--ui" ] || [ "$1" == "ui" ]; then
    exec ./run_ui.sh "${@:2}"
fi

exec ./venv/bin/python3 YouTube-Livestream-bot.py "$@"
