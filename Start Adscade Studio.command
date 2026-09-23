#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  if [ -s "$HOME/.nvm/nvm.sh" ]; then source "$HOME/.nvm/nvm.sh"; fi
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Install Node.js 20.19 or newer, then open this launcher again."
  read -r "reply?Press Enter to close."
  exit 1
fi
npm run edit
