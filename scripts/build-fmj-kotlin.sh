#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
KOTLIN_HOME="${KOTLIN_HOME:-$HOME/.codex/toolchains/kotlin-1.6.21-maven}"
JAVA_BIN="$JAVA_HOME/bin/java"
RUNTIME_JAR="$KOTLIN_HOME/kotlin-stdlib-js-1.6.21.jar"

if [[ ! -x "$JAVA_BIN" ]]; then
    echo "Java not found at $JAVA_HOME" >&2
    echo "Install openjdk@17, or set JAVA_HOME to an existing JDK 17." >&2
    exit 1
fi

if [[ ! -f "$RUNTIME_JAR" ]]; then
    echo "Kotlin/JS 1.6.21 runtime jar not found at $RUNTIME_JAR" >&2
    exit 1
fi

if [[ ! -f "$KOTLIN_HOME/kotlin-compiler-1.6.21.jar" ]]; then
    echo "Kotlin 1.6.21 compiler jar not found in $KOTLIN_HOME" >&2
    exit 1
fi

# K2JS discovers the JS runtime through lib/kotlin-stdlib-js.jar.
if [[ ! -f "$KOTLIN_HOME/lib/kotlin-stdlib-js.jar" ]]; then
    mkdir -p "$KOTLIN_HOME/lib"
    ln -sf "$RUNTIME_JAR" "$KOTLIN_HOME/lib/kotlin-stdlib-js.jar"
fi

mkdir -p "$ROOT/fmj_kt/build"
unzip -p "$RUNTIME_JAR" kotlin.js > "$ROOT/fmj_kt/build/kotlin.js"

"$JAVA_BIN" -cp "$KOTLIN_HOME/*" \
    org.jetbrains.kotlin.cli.js.K2JSCompiler \
    -kotlin-home "$KOTLIN_HOME" \
    -main noCall \
    -output "$ROOT/fmj_kt/build/game.core.js" \
    "$ROOT/fmj_kt/src"

node "$ROOT/scripts/build-fmj-core.mjs" \
    --module "$ROOT/fmj_kt/build/game.core.js" \
    --kotlin-js "$ROOT/fmj_kt/build/kotlin.js"
