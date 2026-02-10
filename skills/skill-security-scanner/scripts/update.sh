#!/bin/bash
# automated-dependency-update.sh

set -euo pipefail

ECOSYSTEM="$1"
UPDATE_TYPE="${2:-patch}"

update_npm() {
    npm audit --audit-level=moderate || true

    if [ "$UPDATE_TYPE" = "patch" ]; then
        npm update --save
    elif [ "$UPDATE_TYPE" = "minor" ]; then
        npx npm-check-updates -u --target minor
        npm install
    fi

    npm test
    npm audit --audit-level=moderate
}

update_python() {
    pip install --upgrade pip
    pip-audit --fix
    safety check
    pytest
}

update_go() {
    go get -u ./...
    go mod tidy
    govulncheck ./...
    go test ./...
}

case "$ECOSYSTEM" in
    npm) update_npm ;;
    python) update_python ;;
    go) update_go ;;
    *)
        echo "Unknown ecosystem: $ECOSYSTEM"
        exit 1
        ;;
esac
