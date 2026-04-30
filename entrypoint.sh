#!/bin/sh
set -e

# Optional runtime install of rar (RARLAB, x86_64 only). Setting
# INSTALL_RAR=true means you accept the license at
# https://www.rarlab.com/license.htm. Skipped when rar is already present
# (e.g. bind-mounted from the host or installed by a previous start).
if [ "${INSTALL_RAR:-false}" = "true" ] && [ ! -x /usr/local/bin/rar ]; then
    rar_version="${RAR_VERSION:-720}"
    rar_url="https://www.rarlab.com/rar/rarlinux-x64-${rar_version}.tar.gz"
    echo "[entrypoint] Installing rar ${rar_version} from ${rar_url}"
    tmpdir="$(mktemp -d)"
    trap 'rm -rf "$tmpdir"' EXIT
    curl -fsSL "$rar_url" -o "$tmpdir/rar.tgz"
    tar -xzf "$tmpdir/rar.tgz" -C "$tmpdir"
    install -m 0755 "$tmpdir/rar/rar" /usr/local/bin/rar
    install -m 0755 "$tmpdir/rar/unrar" /usr/local/bin/unrar
    echo "[entrypoint] rar installed: $(/usr/local/bin/rar -? 2>/dev/null | head -1)"
fi

exec "$@"
