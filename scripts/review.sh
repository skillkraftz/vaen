#!/usr/bin/env bash
set -euo pipefail

# ============================================
# vaen review — start site, capture screenshots, stop site
# ============================================
#
# Usage:
#   bash scripts/review.sh --target <client-slug>
#   pnpm -w review -- --target <client-slug>
#
# The target must be a directory under generated/, e.g.:
#   generated/<client-slug>/

PORT=""
TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --port)   PORT="$2";   shift 2 ;;
    --)       shift ;;  # skip pnpm's -- separator
    --help)
      echo ""
      echo "Usage: pnpm -w review -- --target <client-slug>"
      echo ""
      echo "Options:"
      echo "  --target   Client slug (directory name under generated/)"
      echo "  --port     Port for local server (default: auto-select free port)"
      echo "  --help     Show this help"
      echo ""
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -z "$TARGET" ]; then
  echo "Error: --target is required."
  echo "Usage: pnpm -w review -- --target <client-slug>"
  exit 1
fi

WORKSPACE="generated/$TARGET"
SITE_DIR="$WORKSPACE/site"
SCREENSHOTS_DIR="$WORKSPACE/artifacts/screenshots"

if [ ! -d "$SITE_DIR" ]; then
  echo "Error: $SITE_DIR does not exist."
  echo "Run the generator first:"
  echo "  pnpm generate -- --template service-core --input examples/fake-clients/$TARGET/client-request.json --output $WORKSPACE"
  exit 1
fi

if [ -z "$PORT" ]; then
  PORT=$(node -e 'const net=require("node:net"); const server=net.createServer(); server.listen(0, "127.0.0.1", () => { const address=server.address(); console.log(address.port); server.close(); });')
fi

echo ""
echo "📸 vaen review"
echo "   Target:      $TARGET"
echo "   Site dir:    $SITE_DIR"
echo "   Screenshots: $SCREENSHOTS_DIR"
echo "   Port:        $PORT"
echo "   Manifest:    ${REVIEW_MANIFEST_PATH:-$SCREENSHOTS_DIR/manifest.json}"
echo "   Config path: ${VAEN_SITE_CONFIG_PATH:-$SITE_DIR/config.json}"
echo "   Runtime:     ${VAEN_RUNTIME_PROBE_PATH:-$WORKSPACE/artifacts/runtime-config-probe.json}"
echo ""

# Step 1: Install site dependencies if needed
if [ ! -d "$SITE_DIR/node_modules" ]; then
  echo "1. Installing site dependencies..."
  (cd "$SITE_DIR" && npm install --silent)
  echo "   ✓ Dependencies installed"
else
  echo "1. Dependencies already installed"
fi

# Step 2: Clean stale .next cache (prevents "Html should not be imported" errors)
echo "2. Cleaning previous build cache..."
rm -rf "$SITE_DIR/.next"
echo "   ✓ Cache cleaned"

# Step 3: Build the site
# NODE_ENV must be "production" for next build. When the portal worker spawns
# this script, it inherits NODE_ENV=development from the Next.js dev server.
# That causes Next.js to fall back to the Pages Router 404 rendering path,
# which calls useHtmlContext() without a provider → fatal error:
#   "<Html> should not be imported outside of pages/_document"
# See: .next/server/chunks/611.js module 92 → HtmlContext
echo "3. Building site..."
BUILD_LOG=$(mktemp)
if (cd "$SITE_DIR" && NODE_ENV=production npm run build 2>&1) > "$BUILD_LOG" 2>&1; then
  echo "   ✓ Site built"
else
  BUILD_EXIT=$?
  echo "   ✗ Build failed (exit code $BUILD_EXIT)"
  echo ""
  echo "── Build output (last 40 lines) ──"
  tail -40 "$BUILD_LOG"
  echo "──────────────────────────────────"
  rm -f "$BUILD_LOG"
  exit $BUILD_EXIT
fi
rm -f "$BUILD_LOG"

# Step 4: Kill any stale server on PORT, then start the site
echo "4. Starting site on port $PORT..."

# Kill any process already holding this port (stale from a previous run)
PORT_PIDS=$(
  {
    lsof -ti :"$PORT" 2>/dev/null || true
    ss -ltnp "( sport = :$PORT )" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p'
  } | sort -u
)
if [ -n "$PORT_PIDS" ]; then
  echo "   ⚠ Killing stale process(es) on port $PORT: $PORT_PIDS"
  while read -r STALE_PID; do
    [ -z "$STALE_PID" ] && continue
    kill "$STALE_PID" 2>/dev/null || true
  done <<< "$PORT_PIDS"
  sleep 1
  while read -r STALE_PID; do
    [ -z "$STALE_PID" ] && continue
    if kill -0 "$STALE_PID" 2>/dev/null; then
      kill -9 "$STALE_PID" 2>/dev/null || true
    fi
  done <<< "$PORT_PIDS"
  sleep 1
fi

SERVER_LOG=$(mktemp)
cd "$SITE_DIR"
PORT="$PORT" npm run dev -- -p "$PORT" > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
cd - > /dev/null

cleanup() {
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "${SERVER_LOG:-}"
}
trap cleanup EXIT

echo "   Waiting for server (PID $SERVER_PID)..."
for i in $(seq 1 30); do
  # Check the server process is still alive (detect EADDRINUSE or crash)
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "   ✗ Server process exited unexpectedly"
    echo "── Server log ──"
    cat "$SERVER_LOG"
    echo "────────────────"
    exit 1
  fi
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
    echo "   ✓ Server ready (PID $SERVER_PID)"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "   ✗ Server did not start within 30 seconds"
    echo "── Server log ──"
    cat "$SERVER_LOG"
    echo "────────────────"
    exit 1
  fi
  sleep 1
done

RUNTIME_URL="http://127.0.0.1:$PORT/api/vaen-runtime?route=/"
RUNTIME_RESPONSE=$(curl -s "$RUNTIME_URL" || true)
if [[ "$RUNTIME_RESPONSE" != \{* ]]; then
  echo "   ✗ Runtime probe endpoint did not return JSON"
  echo "   Probe URL: $RUNTIME_URL"
  echo "── Runtime response ──"
  echo "$RUNTIME_RESPONSE" | head -40
  echo "──────────────────────"
  exit 1
fi

if [ -n "${VAEN_EXPECTED_BUSINESS_NAME:-}" ]; then
  if ! echo "$RUNTIME_RESPONSE" | grep -F "\"business_name\":\"${VAEN_EXPECTED_BUSINESS_NAME}\"" >/dev/null; then
    echo "   ✗ Runtime business name mismatch before screenshot capture"
    echo "   Expected: ${VAEN_EXPECTED_BUSINESS_NAME}"
    echo "── Runtime response ──"
    echo "$RUNTIME_RESPONSE"
    echo "──────────────────────"
    exit 1
  fi
fi

# Verify we're serving the correct site by checking the page title
SERVED_TITLE=$(curl -s "http://127.0.0.1:$PORT/" | grep -oP '<title>\K[^<]+' || echo "unknown")
SERVED_URL="http://127.0.0.1:$PORT"
echo "   Served URL:   $SERVED_URL"
echo "   Served title: $SERVED_TITLE"
echo "   Runtime URL:  $RUNTIME_URL"

# Brief stabilization — let the server fully warm up (JIT, caches, etc.)
echo "   Waiting 3s for server stabilization..."
sleep 3

# Step 5: Capture screenshots
echo "5. Capturing screenshots..."
# Clean old screenshots so stale images never persist across reruns
rm -rf "$SCREENSHOTS_DIR"
mkdir -p "$SCREENSHOTS_DIR"
node packages/review-tools/dist/cli.js \
  --url "http://localhost:$PORT" \
  --output "$SCREENSHOTS_DIR" \
  --site-dir "$SITE_DIR"

echo ""
echo "✅ Review complete!"
echo "   Screenshots: $SCREENSHOTS_DIR/"
ls -1 "$SCREENSHOTS_DIR/"*.png 2>/dev/null | while read -r f; do
  echo "     $(basename "$f")"
done
echo ""

# Server is killed by the EXIT trap
