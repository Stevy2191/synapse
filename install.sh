#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Synapse installer
#
#    curl -fsSL https://raw.githubusercontent.com/Stevy2191/synapse/main/install.sh | sudo bash
#
#  Checks your system, installs Docker if needed, picks free ports, sets up
#  Synapse (with automatic HTTPS if you want it), and installs the `synapse`
#  command for updates and backups.
#
#  Options (all optional — you'll be asked otherwise):
#    --dir PATH          where to install            (default /opt/synapse)
#    --mode MODE         home | proxy | https
#    --port N            port for home / proxy mode   (default: first free from 3001)
#    --domain NAME       web address for https mode, e.g. notes.example.com
#    --yes               accept the defaults without asking
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/Stevy2191/synapse/main"
DIR="/opt/synapse"
MODE=""
PORT=""
DOMAIN=""
ASSUME_YES=0
DRY_RUN="${SYNAPSE_DRY_RUN:-0}"   # testing: write files only, don't touch Docker

# ── Output ──────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  B=$'\e[1m'; D=$'\e[2m'; R=$'\e[0m'; RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; BLU=$'\e[34m'; MAG=$'\e[35m'
else
  B=""; D=""; R=""; RED=""; GRN=""; YEL=""; BLU=""; MAG=""
fi
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "$B$MAG" "$*" "$R"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$R" "$*"; }
info() { printf '  %s•%s %s\n' "$BLU" "$R" "$*"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$R" "$*"; }
die()  { printf '\n  %s✗ %s%s\n\n' "$RED$B" "$*" "$R" >&2; exit 1; }

# Questions read from the terminal even when this script is piped from curl.
TTY=/dev/tty
have_tty() { [ -r "$TTY" ] && (exec <"$TTY") 2>/dev/null; }

ask() { # ask "Question" default -> REPLY
  local q="$1" def="${2:-}"
  if [ "$ASSUME_YES" = 1 ] || ! have_tty; then REPLY="$def"; return; fi
  if [ -n "$def" ]; then printf '  %s %s[%s]%s ' "$q" "$D" "$def" "$R" >"$TTY"; else printf '  %s ' "$q" >"$TTY"; fi
  IFS= read -r REPLY <"$TTY" || REPLY=""
  REPLY="${REPLY:-$def}"
}

confirm() { # confirm "Question" Y|N
  local def="${2:-Y}" hint="[Y/n]"
  [ "$def" = N ] && hint="[y/N]"
  if [ "$ASSUME_YES" = 1 ] || ! have_tty; then [ "$def" = Y ]; return; fi
  printf '  %s %s%s%s ' "$1" "$D" "$hint" "$R" >"$TTY"
  local a; IFS= read -r a <"$TTY" || a=""
  a="${a:-$def}"
  [[ "$a" =~ ^[Yy] ]]
}

# ── Arguments ───────────────────────────────────────────────────────────────
ORIG_ARGS=("$@")
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,19p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done
case "$MODE" in ""|home|proxy|https) ;; *) die "--mode must be home, proxy or https" ;; esac

# ── Ports ───────────────────────────────────────────────────────────────────
port_in_use() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -Hltn "sport = :$p" 2>/dev/null | grep -q . && return 0
    ss -Hlun "sport = :$p" 2>/dev/null | grep -q . && return 0
    return 1
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$p\$"
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null
  fi
}

port_owner() { # best-effort description of what is listening on a port
  local p="$1" who=""
  if command -v docker >/dev/null 2>&1; then
    who=$(docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null | awk -v p=":$p->" 'index($0,p){print $1; exit}')
    [ -n "$who" ] && { echo "Docker container \"$who\""; return; }
  fi
  if command -v ss >/dev/null 2>&1; then
    who=$(ss -Hltnp "sport = :$p" 2>/dev/null | grep -o 'users:(("[^"]*"' | head -1 | cut -d'"' -f2)
  fi
  [ -n "$who" ] && echo "$who" || echo "another program"
}

next_free_port() {
  local p="$1"
  while [ "$p" -lt 65535 ]; do
    port_in_use "$p" || { echo "$p"; return; }
    p=$((p + 1))
  done
  die "Couldn't find a free port"
}

choose_port() {
  local suggested taken
  suggested=$(next_free_port 3001)
  if [ -n "$PORT" ]; then
    port_in_use "$PORT" && die "Port $PORT is already used by $(port_owner "$PORT"). Pick another with --port."
    ok "Using port $PORT"; return
  fi
  if [ "$suggested" != 3001 ]; then
    info "Port 3001 is used by $(port_owner 3001)."
  fi
  taken=""
  for p in $(seq 3000 3010) 8080 8000 8888; do
    if port_in_use "$p"; then taken+="$p "; fi
  done
  [ -n "$taken" ] && info "Ports already in use nearby: ${taken% }"
  while true; do
    ask "Which port should Synapse use?" "$suggested"
    if ! [[ "$REPLY" =~ ^[0-9]+$ ]] || [ "$REPLY" -lt 1024 ] || [ "$REPLY" -gt 65535 ]; then
      warn "Enter a number between 1024 and 65535."
      [ "$ASSUME_YES" = 1 ] && die "Invalid port"; continue
    fi
    if port_in_use "$REPLY"; then
      warn "Port $REPLY is already used by $(port_owner "$REPLY"). Try $(next_free_port "$REPLY")."
      [ "$ASSUME_YES" = 1 ] && die "Port in use"; continue
    fi
    PORT="$REPLY"; ok "Port $PORT is free"; break
  done
}

lan_ip() {
  local ip=""
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="src"){print $(i+1); exit}}') || true
  [ -z "$ip" ] && ip=$(hostname -I 2>/dev/null | awk '{print $1}') || true
  echo "${ip:-localhost}"
}

random_string() { # random_string LENGTH ALPHABET
  local len="$1" alphabet="$2" out="" byte
  while [ "${#out}" -lt "$len" ]; do
    byte=$(od -An -N1 -tu1 /dev/urandom | tr -d ' ')
    out+="${alphabet:$((byte % ${#alphabet})):1}"
  done
  echo "$out"
}

# ─────────────────────────────────────────────────────────────────────────────
printf '\n%s   ◉  Synapse installer%s\n' "$B$MAG" "$R"
printf '%s   Your connected knowledge base%s\n' "$D" "$R"

# ── 1. System checks ────────────────────────────────────────────────────────
step "Checking your system"

[ "$(uname -s)" = Linux ] || die "This installer is for Linux. (On other systems, see the README for manual Docker steps.)"
case "$(uname -m)" in
  x86_64|amd64) ok "Linux $(uname -m)" ;;
  *) die "Synapse's Docker image is built for regular 64-bit PCs (x86_64). This machine is $(uname -m), which isn't supported yet." ;;
esac

if [ "$DRY_RUN" != 1 ] && [ "$(id -u)" -ne 0 ]; then
  if [ -f "$0" ] && command -v sudo >/dev/null 2>&1; then
    info "Administrator access is needed — asking sudo."
    exec sudo -E bash "$0" "${ORIG_ARGS[@]}"
  fi
  die "Please run the installer as root:  curl -fsSL $REPO_RAW/install.sh | sudo bash"
fi
command -v curl >/dev/null 2>&1 || die "curl is required (e.g. sudo apt install curl)."

if [ "$DRY_RUN" != 1 ]; then
  if ! command -v docker >/dev/null 2>&1; then
    warn "Docker isn't installed. Synapse runs inside Docker."
    if confirm "Install Docker now using Docker's official script?" Y; then
      curl -fsSL https://get.docker.com | sh
      systemctl enable --now docker >/dev/null 2>&1 || true
    else
      die "Install Docker (https://docs.docker.com/engine/install/) and run this again."
    fi
  fi
  if ! docker info >/dev/null 2>&1; then
    systemctl start docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1 || true
    sleep 2
    docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start it (sudo systemctl start docker) and try again."
  fi
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
  docker compose version >/dev/null 2>&1 || die "Docker Compose isn't available. Install the plugin (e.g. sudo apt install docker-compose-plugin) and try again."
  ok "Docker Compose $(docker compose version --short 2>/dev/null)"
fi

# Already installed? Offer an update instead.
if [ -f "$DIR/docker-compose.yml" ]; then
  warn "Synapse is already installed in $DIR."
  if confirm "Update it to the latest version? (your notes are kept)" Y; then
    [ "$DRY_RUN" = 1 ] && { ok "(dry run) would update"; exit 0; }
    (cd "$DIR" && docker compose pull && docker compose up -d)
    ok "Updated. Your notes are untouched."
    exit 0
  fi
  die "Nothing changed. (To reinstall, remove $DIR first — or run 'synapse uninstall'.)"
fi
if [ "$DRY_RUN" != 1 ] && docker ps -a --format '{{.Names}}' | grep -qx synapse; then
  die "A Docker container called \"synapse\" already exists (from an earlier manual install?). Remove it with 'docker rm -f synapse' — your notes folder is not deleted — then run this again."
fi

# ── 2. Where ────────────────────────────────────────────────────────────────
step "Where to install"
ask "Install folder:" "$DIR"
DIR="$REPLY"
ok "Synapse will live in $DIR (notes are kept in $DIR/data)"

# ── 3. How people reach it ──────────────────────────────────────────────────
step "How will you open Synapse?"
LAN_IP=$(lan_ip)
while true; do
  if [ -z "$MODE" ]; then
    say ""
    say "  ${B}1)${R} On my home or office network   ${D}e.g. http://$LAN_IP:3001 — simplest${R}"
    say "  ${B}2)${R} Through my reverse proxy       ${D}Nginx Proxy Manager, Cloudflare Tunnel, Traefik…${R}"
    say "  ${B}3)${R} At my own web address, HTTPS   ${D}e.g. https://notes.example.com — certificate set up for you${R}"
    say ""
    say "  ${D}Tip: offline mode (opening Synapse with no connection) needs HTTPS — options 2 or 3.${R}"
    ask "Choose 1, 2 or 3:" "1"
    case "$REPLY" in 1) MODE=home ;; 2) MODE=proxy ;; 3) MODE=https ;; *) warn "Please type 1, 2 or 3."; continue ;; esac
  fi

  if [ "$MODE" = https ]; then
    blocked=""
    for p in 80 443; do
      if port_in_use "$p"; then blocked+="$p ($(port_owner "$p")) "; fi
    done
    if [ -n "$blocked" ]; then
      warn "Automatic HTTPS needs ports 80 and 443, but these are in use: $blocked"
      warn "That usually means a web server or reverse proxy is already running here."
      if [ "$ASSUME_YES" != 1 ] && confirm "Use option 2 (through your existing proxy) instead?" Y; then MODE=proxy
      else MODE=""; [ "$ASSUME_YES" = 1 ] && die "Ports 80/443 are in use"; continue
      fi
    else
      ok "Ports 80 and 443 are free"
    fi
  fi
  break
done

case "$MODE" in
  home|proxy)
    choose_port ;;
  https)
    while true; do
      if [ -z "$DOMAIN" ]; then
        [ "$ASSUME_YES" = 1 ] && die "--domain is required for https mode"
        ask "Web address for Synapse (e.g. notes.example.com):" ""
        DOMAIN="$REPLY"
      fi
      # Accept "https://Notes.Example.com/" and similar.
      DOMAIN=$(echo "$DOMAIN" | sed -E 's#^https?://##; s#/.*$##' | tr 'A-Z' 'a-z')
      if [[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then break; fi
      warn "\"$DOMAIN\" doesn't look like a web address."
      DOMAIN=""
    done
    PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
    DNS_IPS=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)
    if [ -z "$DNS_IPS" ]; then
      target_ip="${PUBLIC_IP:-}"; [ -z "$target_ip" ] && target_ip="this server's public IP"
      warn "$DOMAIN doesn't point anywhere yet. Add a DNS \"A\" record for it pointing to $target_ip."
      confirm "Continue anyway? (the certificate will be issued once DNS is set up)" Y || die "Set up DNS, then run this again."
    elif [ -n "$PUBLIC_IP" ] && ! grep -qw "$PUBLIC_IP" <<<"$DNS_IPS"; then
      warn "$DOMAIN points to ${DNS_IPS% }, but this server's public IP is $PUBLIC_IP."
      warn "If you're behind a router, forward ports 80 and 443 to this machine ($LAN_IP)."
      confirm "Continue anyway?" Y || die "Fix DNS, then run this again."
    else
      ok "$DOMAIN points to this server"
    fi
    PORT=""
    ;;
esac

# ── 4. Write the configuration ──────────────────────────────────────────────
step "Setting up Synapse"
mkdir -p "$DIR/data"
umask 077

JWT_SECRET=$(random_string 64 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')
SETUP_CODE="$(random_string 4 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789')-$(random_string 4 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789')"

cat >"$DIR/.env" <<EOF
# Synapse settings. After changing anything here, run: synapse restart
SYNAPSE_MODE=$MODE
SYNAPSE_PORT=$PORT
SYNAPSE_DOMAIN=$DOMAIN
# Signs login sessions. Changing it signs everyone out.
JWT_SECRET=$JWT_SECRET
# Set to true to let anyone create an account (normally the admin adds people).
ALLOW_REGISTRATION=false
EOF

if [ "$MODE" = https ]; then
  cat >"$DIR/docker-compose.yml" <<'EOF'
# Synapse with automatic HTTPS (Caddy). Managed by the `synapse` command.
services:
  synapse:
    image: ghcr.io/stevy2191/synapse:latest
    container_name: synapse
    restart: unless-stopped
    volumes:
      - ./data:/data
    environment:
      - DATA_DIR=/data
      - JWT_SECRET=${JWT_SECRET}
      - ALLOW_REGISTRATION=${ALLOW_REGISTRATION:-false}

  caddy:
    image: caddy:2
    container_name: synapse-caddy
    restart: unless-stopped
    depends_on: [synapse]
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy/data:/data
      - ./caddy/config:/config
EOF
  cat >"$DIR/Caddyfile" <<EOF
# Caddy gets and renews the HTTPS certificate for this address automatically.
$DOMAIN {
	encode gzip
	reverse_proxy synapse:3001
}
EOF
else
  cat >"$DIR/docker-compose.yml" <<'EOF'
# Synapse. Managed by the `synapse` command; the port is set in .env (SYNAPSE_PORT).
services:
  synapse:
    image: ghcr.io/stevy2191/synapse:latest
    container_name: synapse
    restart: unless-stopped
    ports:
      - "${SYNAPSE_PORT:-3001}:3001"
    volumes:
      - ./data:/data
    environment:
      - DATA_DIR=/data
      - JWT_SECRET=${JWT_SECRET}
      - ALLOW_REGISTRATION=${ALLOW_REGISTRATION:-false}
EOF
fi
printf '%s\n' "$SETUP_CODE" >"$DIR/data/.setup_code"
umask 022
ok "Configuration written"

# The `synapse` command
CLI_SRC=""
if [ -f "$(dirname "$0")/scripts/synapse" ]; then CLI_SRC="$(dirname "$0")/scripts/synapse"; fi
CLI_DEST="${SYNAPSE_CLI_DEST:-/usr/local/bin/synapse}"
if [ -n "$CLI_SRC" ]; then cp "$CLI_SRC" "$CLI_DEST.tmp"
else curl -fsSL "$REPO_RAW/scripts/synapse" -o "$CLI_DEST.tmp" || die "Couldn't download the synapse command."
fi
sed -i "s#^SYNAPSE_DIR=.*#SYNAPSE_DIR=\"\${SYNAPSE_DIR:-$DIR}\"#" "$CLI_DEST.tmp"
chmod 755 "$CLI_DEST.tmp" && mv "$CLI_DEST.tmp" "$CLI_DEST"
ok "Installed the 'synapse' command"

# Firewall (only if one is active)
open_firewall() {
  local p="$1"
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    if ! ufw status | grep -qE "^$p(/tcp)?[[:space:]]"; then
      if confirm "Your firewall (ufw) is on. Allow port $p?" Y; then
        ufw allow "$p/tcp" >/dev/null && ok "Firewall: port $p allowed"
      else
        warn "Port $p stays blocked by the firewall; other devices won't reach Synapse."
      fi
    fi
  elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    if ! firewall-cmd --list-ports | grep -qw "$p/tcp"; then
      if confirm "Your firewall (firewalld) is on. Allow port $p?" Y; then
        firewall-cmd --permanent --add-port="$p/tcp" >/dev/null && firewall-cmd --reload >/dev/null && ok "Firewall: port $p allowed"
      else
        warn "Port $p stays blocked by the firewall; other devices won't reach Synapse."
      fi
    fi
  fi
  return 0
}
if [ "$DRY_RUN" != 1 ]; then
  if [ "$MODE" = https ]; then open_firewall 80; open_firewall 443; else open_firewall "$PORT"; fi
fi

# ── 5. Start ────────────────────────────────────────────────────────────────
step "Starting Synapse"
if [ "$DRY_RUN" = 1 ]; then
  ok "(dry run) skipping docker compose pull / up"
else
  (cd "$DIR" && docker compose pull --quiet && docker compose up -d) || die "Couldn't start Synapse. See the messages above, or run: cd $DIR && docker compose logs"
  printf '  Waiting for Synapse to be ready'
  ready=0
  for _ in $(seq 1 60); do
    if docker exec synapse wget -qO- http://127.0.0.1:3001/api/health >/dev/null 2>&1; then ready=1; break; fi
    printf '.'; sleep 1
  done
  echo
  [ "$ready" = 1 ] && ok "Synapse is running" || warn "Synapse is taking a while to start. Check with: synapse logs"
  if [ "$MODE" = https ]; then
    printf '  Getting the HTTPS certificate for %s' "$DOMAIN"
    cert=0
    for _ in $(seq 1 45); do
      curl -fsS --max-time 3 "https://$DOMAIN/api/health" >/dev/null 2>&1 && { cert=1; break; }
      printf '.'; sleep 2
    done
    echo
    [ "$cert" = 1 ] && ok "HTTPS is working" || warn "The certificate isn't ready yet. It usually needs DNS and ports 80/443 reachable from the internet. Check with: synapse logs caddy"
  fi
fi

# ── 6. Done ─────────────────────────────────────────────────────────────────
case "$MODE" in
  home)  URL="http://$LAN_IP:$PORT" ;;
  proxy) URL="http://$LAN_IP:$PORT" ;;
  https) URL="https://$DOMAIN" ;;
esac

line() { printf '  %s│%s  %s\n' "$MAG" "$R" "$1"; }
printf '\n  %s╭──────────────────────────────────────────────────────────%s\n' "$MAG" "$R"
line "${B}${GRN}Synapse is ready!${R}"
line ""
line "Open        ${B}$URL${R}"
line "Setup code  ${B}$SETUP_CODE${R}"
line ""
line "Open the address, enter the setup code and create your admin"
line "account. Then add family or teammates in Settings → Admin."
printf '  %s╰──────────────────────────────────────────────────────────%s\n' "$MAG" "$R"

if [ "$MODE" = proxy ]; then
  say ""
  say "  ${B}Reverse proxy settings${R}"
  say "    Nginx Proxy Manager:  Scheme http · Forward Hostname $LAN_IP · Port $PORT"
  say "                          Turn on \"Block Common Exploits\" and request an SSL certificate."
  say "    Cloudflare Tunnel:    Service http://$LAN_IP:$PORT"
  say "    Same Docker host?     You can also forward to http://synapse:3001 if the proxy shares a Docker network."
fi
if [ "$MODE" = home ]; then
  say ""
  say "  ${D}Want HTTPS or access from outside later? Re-run the installer, or put a reverse proxy in front.${R}"
fi

say ""
say "  ${B}Handy commands${R}"
say "    synapse status            is it running? what's the address?"
say "    synapse update            get the latest version"
say "    synapse backup            save a backup of all notes"
say "    synapse reset-password    if someone forgets their password"
say "    synapse help              everything else"
say ""
