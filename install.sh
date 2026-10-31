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
#    --dir PATH          where to install   (default: the current folder if it suits, else /opt/synapse)
#    --mode MODE         home | proxy | https | lan-https
#    --port N            Synapse's port (home / proxy: from 3001; lan-https: from 8443)
#    --trust-port N      lan-https: port for the "trust this server" page (from 8080)
#    --domain NAME       web address for https mode, e.g. notes.example.com
#    --storage KIND      where notes are kept: folder | volume | smb
#    --data-path PATH    folder storage: the folder           (default: <install folder>/data)
#    --volume NAME       volume storage: Docker volume name   (default: synapse-data)
#    --smb-share PATH    smb storage: e.g. //nas/share/synapse  (password from $SMB_PASSWORD)
#    --smb-user NAME     smb storage: user name
#    --yes               accept the defaults without asking
# ─────────────────────────────────────────────────────────────────────────────

# Everything is inside { … } so bash reads the whole script before running any of it. When
# piped from curl, the script arrives on standard input, and a command that reads input (like
# `docker compose exec`) would otherwise swallow the rest of it and the installer would stop early.
{
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/Stevy2191/synapse/main"
DIR=""
STORAGE=""
DATA_PATH=""
VOLUME_NAME=""
SMB_SHARE=""
SMB_USER=""
SMB_PASS="${SMB_PASSWORD:-}"
SMB_DOMAIN=""
MODE=""
PORT=""
TRUST_PORT=""
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
    --storage) STORAGE="$2"; shift 2 ;;
    --data-path) DATA_PATH="$2"; shift 2 ;;
    --volume) VOLUME_NAME="$2"; shift 2 ;;
    --smb-share) SMB_SHARE="$2"; shift 2 ;;
    --smb-user) SMB_USER="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --trust-port) TRUST_PORT="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,19p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done
case "$MODE" in ""|home|proxy|https|lan-https) ;; *) die "--mode must be home, proxy, https or lan-https" ;; esac
case "$STORAGE" in ""|folder|volume|smb) ;; *) die "--storage must be folder, volume or smb" ;; esac

# Files that ship next to this script (when run from a download of the repo rather than via curl).
SCRIPT_DIR=""
if [ -f "${BASH_SOURCE[0]:-}" ] && [ "$(basename "${BASH_SOURCE[0]}")" = install.sh ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
local_or_download() { # local_or_download REPO-PATH DEST
  if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/$1" ]; then cp "$SCRIPT_DIR/$1" "$2"
  else curl -fsSL "$REPO_RAW/$1" -o "$2"
  fi
}

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

# pick_port VAR "what it's for" START [PORT-TO-AVOID]
# Suggests the first free port from START, shows what's using busy ones, and checks the answer.
# If VAR already holds a value (from a command-line option), just checks that one.
pick_port() {
  local -n _out="$1"
  local label="$2" start="$3" avoid="${4:-}" suggested taken p
  if [ -n "$_out" ]; then
    port_in_use "$_out" && die "Port $_out is already used by $(port_owner "$_out")."
    [ "$_out" = "$avoid" ] && die "Port $_out is already taken by the other Synapse port."
    ok "Using port $_out for $label"; return
  fi
  suggested=$(next_free_port "$start")
  [ "$suggested" = "$avoid" ] && suggested=$(next_free_port $((suggested + 1)))
  if [ "$suggested" != "$start" ]; then info "Port $start is used by $(port_owner "$start")."; fi
  taken=""
  for p in $(seq $((start - 1)) $((start + 9))) 3001 8000 8080 8443 8888; do
    if port_in_use "$p" && [[ " $taken " != *" $p "* ]]; then taken+="$p "; fi
  done
  [ -n "$taken" ] && info "Ports already in use nearby: ${taken% }"
  while true; do
    ask "Port for $label?" "$suggested"
    if ! [[ "$REPLY" =~ ^[0-9]+$ ]] || [ "$REPLY" -lt 1024 ] || [ "$REPLY" -gt 65535 ]; then
      warn "Enter a number between 1024 and 65535."
      [ "$ASSUME_YES" = 1 ] && die "Invalid port"; continue
    fi
    if [ "$REPLY" = "$avoid" ]; then
      warn "Port $REPLY is already taken by the other Synapse port."
      [ "$ASSUME_YES" = 1 ] && die "Port clash"; continue
    fi
    if port_in_use "$REPLY"; then
      warn "Port $REPLY is already used by $(port_owner "$REPLY"). Try $(next_free_port "$REPLY")."
      [ "$ASSUME_YES" = 1 ] && die "Port in use"; continue
    fi
    _out="$REPLY"; ok "Port $_out is free"; break
  done
}

lan_ip() {
  local ip=""
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="src"){print $(i+1); exit}}') || true
  [ -z "$ip" ] && ip=$(hostname -I 2>/dev/null | awk '{print $1}') || true
  echo "${ip:-localhost}"
}

# Caddy config for HTTPS on an IP address. (The same text is written by `synapse set-ip`.)
write_lan_caddyfile() { # DIR IP HTTPS_PORT TRUST_PORT
  cat >"$1/Caddyfile" <<CADDY
# HTTPS on this server's IP address. Caddy runs a private certificate authority;
# each device trusts it once via the page on port $4. Rewritten by: synapse set-ip
{
	local_certs
	skip_install_trust
	default_sni $2
}

https://$2:$3, https://localhost:$3 {
	encode gzip
	reverse_proxy synapse:3001
}

# "Trust this server" page and certificate download (plain HTTP, so it opens without a warning)
http://:$4 {
	handle /synapse-ca.crt {
		root * /data/caddy/pki/authorities/local
		rewrite * /root.crt
		header Content-Type application/x-x509-ca-cert
		header Content-Disposition "attachment; filename=synapse-ca.crt"
		file_server
	}
	handle {
		root * /srv/trust
		file_server
	}
}
CADDY
}

random_string() { # random_string LENGTH ALPHABET
  local len="$1" alphabet="$2" out="" byte
  while [ "${#out}" -lt "$len" ]; do
    byte=$(od -An -N1 -tu1 /dev/urandom | tr -d ' ')
    out+="${alphabet:$((byte % ${#alphabet})):1}"
  done
  echo "$out"
}

# The `synapse` command, pointed at this install.
install_cli() {
  local dest="${SYNAPSE_CLI_DEST:-/usr/local/bin/synapse}"
  local_or_download scripts/synapse "$dest.tmp" || die "Couldn't download the synapse command."
  sed -i "s#^SYNAPSE_DIR=.*#SYNAPSE_DIR=\"\${SYNAPSE_DIR:-$DIR}\"#" "$dest.tmp"
  chmod 755 "$dest.tmp" && mv "$dest.tmp" "$dest"
  ok "Installed the 'synapse' command"
}

# Suggest an install folder: the current folder if it looks meant for Synapse,
# a "synapse" folder inside it if it holds other things, else /opt/synapse.
suggest_dir() {
  local here="$PWD" home_dir="${SUDO_USER:+$(getent passwd "$SUDO_USER" | cut -d: -f6)}"
  case "$here" in
    /|/root|/home|/tmp|/var|/usr|/usr/*|/etc|/etc/*|/bin|/sbin|/boot|/boot/*|/proc*|/sys*|/dev*|/run*|/opt|/srv|/mnt|/media|/var/lib*)
      echo /opt/synapse; return ;;
  esac
  if [ "$here" = "${home_dir:-/nonexistent}" ] || [ "$here" = "$HOME" ]; then echo /opt/synapse; return; fi
  if is_synapse_install "$here" || [ -z "$(ls -A "$here" 2>/dev/null)" ] || [[ "$(basename "${here,,}")" == *synapse* ]]; then
    echo "$here"
  else
    echo "$here/synapse"
  fi
}

# Is there a Synapse docker-compose setup in this folder (from this installer or by hand)?
is_synapse_install() {
  local f
  for f in "$1/docker-compose.yml" "$1/docker-compose.yaml" "$1/compose.yml" "$1/compose.yaml"; do
    [ -f "$f" ] && grep -qiE 'stevy2191/synapse' "$f" && return 0
  done
  return 1
}

human_free() { df -h --output=avail "$1" 2>/dev/null | tail -1 | tr -d ' '; }

# Mounted drives worth suggesting for notes (USB disks, second drives, NAS mounts).
list_drives() {
  df -h --output=target,size,avail,fstype -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null \
    | awk 'NR>1 && ($1 ~ "^/(mnt|media|srv|data|storage)" || $1 ~ "^/run/media") {printf "      %-32s %6s free of %s (%s)\n", $1, $3, $2, $4}'
}

# Try mounting the SMB share through Docker exactly as Synapse will, and report problems plainly.
SMB_VERS=""
test_smb() {
  local host="$1" share_path="$2" ip="$3" vol out v
  vol="synapse-smb-test-$$"
  for v in 3.1.1 3.0 2.1; do
    docker volume rm -f "$vol" >/dev/null 2>&1 || true
    docker volume create --driver local --opt type=cifs --opt "device=//$host/$share_path" \
      --opt "o=$(smb_options "$ip" "$v")" "$vol" >/dev/null
    if out=$(docker run --rm --entrypoint sh -v "$vol:/data" ghcr.io/stevy2191/synapse:latest -c 'touch /data/.synapse-write-test && rm /data/.synapse-write-test' </dev/null 2>&1); then
      docker volume rm -f "$vol" >/dev/null 2>&1 || true
      SMB_VERS="$v"; return 0
    fi
    out=$(echo "$out" | sed -E 's/password=[^,"]*/password=***/g')
    case "${out,,}" in *"invalid argument"*|*"not supported"*) continue ;; esac
    break
  done
  docker volume rm -f "$vol" >/dev/null 2>&1 || true
  case "${out,,}" in
    *"permission denied"*) warn "The share said no: check the user name and password, and that this user may write to the share." ;;
    *"no such file"*|*"no such device"*) warn "The share or folder wasn't found: check the share name (and that the folder exists)." ;;
    *"host is down"*|*"timed out"*|*"no route"*|*"refused"*) warn "Couldn't reach $host. Check it's switched on and on the same network." ;;
    *"invalid argument"*|*"not supported"*) warn "The share didn't accept any SMB version Synapse tried (3.1.1, 3.0, 2.1)." ;;
    *) warn "Couldn't use the share: $(echo "$out" | tail -1)" ;;
  esac
  return 1
}

# Mount options for the kernel's SMB client. Commas in the password are doubled, as it expects.
smb_options() { # IP SMB_VERSION
  local pass="${SMB_PASS//,/,,}"
  local o="addr=$1,username=$SMB_USER,password=$pass,vers=$2,nobrl,uid=0,gid=0,file_mode=0600,dir_mode=0700"
  [ -n "$SMB_DOMAIN" ] && o+=",domain=$SMB_DOMAIN"
  echo "$o"
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

# ── 2. Where ────────────────────────────────────────────────────────────────
step "Where to install"
if [ -z "$DIR" ]; then
  ask "Install folder:" "$(suggest_dir)"
  DIR="$REPLY"
fi
DIR=$(realpath -m "$DIR")
case "$DIR" in
  /|/root|/home|/etc|/usr|/var|/opt|/srv|/mnt|/media|/tmp|/bin|/sbin|/boot|/proc*|/sys*|/dev*)
    die "Please choose a folder of its own for Synapse, like $DIR/synapse — not $DIR itself." ;;
esac

# Already installed here (by this installer or by hand)? Offer an update instead.
if is_synapse_install "$DIR"; then
  warn "Synapse is already set up in $DIR."
  if confirm "Update it to the latest version and add the 'synapse' command? (your notes are kept)" Y; then
    if [ "$DRY_RUN" = 1 ]; then ok "(dry run) would update"; install_cli; exit 0; fi
    (cd "$DIR" && docker compose pull </dev/null && docker compose up -d </dev/null)
    ok "Updated. Your notes are untouched."
    install_cli
    say ""
    say "  Run ${B}synapse status${R} to see the address, or ${B}synapse help${R} for everything else."
    say ""
    exit 0
  fi
  die "Nothing changed. (To reinstall, choose another folder or run 'synapse uninstall' first.)"
fi
CONTAINER=synapse
# Never overwrite another app's setup.
for f in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do
  if [ -f "$DIR/$f" ]; then
    die "$DIR already has a Docker Compose file ($f) for another app. Choose an empty folder for Synapse, e.g. $DIR/synapse"
  fi
done
if [ "$DRY_RUN" != 1 ] && docker ps -a --format '{{.Names}}' | grep -qx synapse; then
  if docker inspect -f '{{.Config.Image}}' synapse 2>/dev/null | grep -q 'stevy2191/synapse'; then
    where=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' synapse 2>/dev/null || true)
    if [ -n "$where" ] && [ "$where" != "<no value>" ]; then
      die "Synapse is already running from $where. Run the installer from that folder (cd $where) to update it."
    fi
    die "A Synapse container already exists. Remove it with 'docker rm -f synapse' (your notes are not deleted), then run this again."
  fi
  # Something else (Matrix's Synapse chat server, for example) already uses the name.
  CONTAINER=synapse-notes
  info "Another app already has a container called \"synapse\"; this one will be called \"synapse-notes\"."
fi
ok "Synapse will live in $DIR"

# ── 3. How people reach it ──────────────────────────────────────────────────
step "How will you open Synapse?"
LAN_IP=$(lan_ip)
while true; do
  if [ -z "$MODE" ]; then
    say ""
    say "  ${B}1)${R} On my home or office network   ${D}e.g. http://$LAN_IP:3001 — simplest${R}"
    say "  ${B}2)${R} Through my reverse proxy       ${D}Nginx Proxy Manager, Cloudflare Tunnel, Traefik…${R}"
    say "  ${B}3)${R} At my own web address, HTTPS   ${D}e.g. https://notes.example.com — certificate set up for you${R}"
    say "  ${B}4)${R} HTTPS without a domain         ${D}e.g. https://$LAN_IP:8443 — each device trusts this server once${R}"
    say ""
    say "  ${D}Tip: offline mode (opening Synapse with no connection) needs HTTPS — options 2, 3 or 4.${R}"
    ask "Choose 1, 2, 3 or 4:" "1"
    case "$REPLY" in 1) MODE=home ;; 2) MODE=proxy ;; 3) MODE=https ;; 4) MODE=lan-https ;; *) warn "Please type 1, 2, 3 or 4."; continue ;; esac
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
    pick_port PORT "Synapse" 3001 ;;
  lan-https)
    [ "$LAN_IP" = localhost ] && die "Couldn't work out this server's network address, which HTTPS-by-IP needs."
    case "$LAN_IP" in
      10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|100.*) ;;
      *) info "This server's address ($LAN_IP) looks public. Option 3 with a domain gives a certificate that needs no setup on devices." ;;
    esac
    info "Synapse will use HTTPS on one port, plus a small plain-HTTP page on a second port"
    info "where each device downloads this server's certificate to trust it."
    pick_port PORT "Synapse (HTTPS)" 8443
    pick_port TRUST_PORT "the certificate page" 8080 "$PORT"
    info "Tip: give this server a fixed address in your router (a DHCP reservation)."
    info "If its address ever changes, run: synapse set-ip"
    ;;
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

# ── 4. Where notes are kept ─────────────────────────────────────────────────
step "Where should Synapse keep your notes?"
SYNAPSE_DATA="./data"
VOLUMES_BLOCK=""
NETWORK_STORAGE=false
while true; do
  if [ -z "$STORAGE" ]; then
    say ""
    say "  ${B}1)${R} A folder on this server     ${D}easy to see and back up; can be on another drive${R}"
    say "  ${B}2)${R} A Docker volume             ${D}Docker looks after it${R}"
    say "  ${B}3)${R} A network share (SMB)       ${D}a NAS, or a shared folder on a Windows PC${R}"
    say ""
    ask "Choose 1, 2 or 3:" "1"
    case "$REPLY" in 1) STORAGE=folder ;; 2) STORAGE=volume ;; 3) STORAGE=smb ;; *) warn "Please type 1, 2 or 3."; continue ;; esac
  fi

  case "$STORAGE" in
    folder)
      drives=$(list_drives)
      if [ -n "$drives" ]; then info "Drives on this server you could use:"; say "$drives"; fi
      if [ -z "$DATA_PATH" ]; then ask "Folder for your notes:" "$DIR/data"; DATA_PATH="$REPLY"; fi
      DATA_PATH=$(realpath -m "$DATA_PATH")
      if [ -f "$DATA_PATH/synapse.db" ]; then
        ok "Found existing Synapse notes in $DATA_PATH. They'll be used."
      elif [ -d "$DATA_PATH" ] && [ -n "$(ls -A "$DATA_PATH" 2>/dev/null)" ]; then
        warn "$DATA_PATH already has other files in it."
        if ! confirm "Keep Synapse's notes there anyway?" N; then DATA_PATH=""; [ "$ASSUME_YES" = 1 ] && die "Folder isn't empty"; continue; fi
      fi
      mkdir -p "$DATA_PATH" || { warn "Couldn't create $DATA_PATH."; DATA_PATH=""; [ "$ASSUME_YES" = 1 ] && exit 1; continue; }
      ok "Notes will be kept in $DATA_PATH ($(human_free "$DATA_PATH") free)"
      if [ "$DATA_PATH" = "$DIR/data" ]; then SYNAPSE_DATA="./data"; else SYNAPSE_DATA="$DATA_PATH"; fi
      ;;
    volume)
      if [ -z "$VOLUME_NAME" ]; then ask "Name for the Docker volume:" "synapse-data"; VOLUME_NAME="$REPLY"; fi
      [[ "$VOLUME_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { warn "Use letters, numbers, dots, dashes or underscores."; VOLUME_NAME=""; [ "$ASSUME_YES" = 1 ] && exit 1; continue; }
      if [ "$DRY_RUN" != 1 ] && docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
        ok "Docker volume \"$VOLUME_NAME\" already exists. Any notes in it will be used."
      else
        ok "Notes will be kept in the Docker volume \"$VOLUME_NAME\""
      fi
      SYNAPSE_DATA="$VOLUME_NAME"
      VOLUMES_BLOCK=$(printf 'volumes:\n  %s:\n    name: %s\n' "$VOLUME_NAME" "$VOLUME_NAME")
      ;;
    smb)
      if [ -z "$SMB_SHARE" ]; then
        info "Enter the share like \\\\nas\\notes, //nas/notes or smb://nas/notes, optionally with a folder after it."
        ask "Network share:" ""
        SMB_SHARE="$REPLY"
      fi
      # Normalise \\host\share\folder, smb://host/share/folder → host + share/folder
      share=$(echo "$SMB_SHARE" | sed -E 's#^smb://##; s#\\#/#g; s#^/+##; s#/+$##')
      SMB_HOST="${share%%/*}"; SMB_PATH="${share#*/}"
      if [ -z "$SMB_HOST" ] || [ "$SMB_PATH" = "$share" ] || [ -z "$SMB_PATH" ]; then
        warn "That should look like //server/share (with an optional /folder)."; SMB_SHARE=""; [ "$ASSUME_YES" = 1 ] && exit 1; continue
      fi
      SMB_IP=$(getent ahostsv4 "$SMB_HOST" 2>/dev/null | awk 'NR==1{print $1}' || true)
      [ -z "$SMB_IP" ] && [[ "$SMB_HOST" =~ ^[0-9.]+$ ]] && SMB_IP="$SMB_HOST"
      if [ -z "$SMB_IP" ]; then warn "Couldn't find \"$SMB_HOST\" on the network. Try its IP address instead."; SMB_SHARE=""; [ "$ASSUME_YES" = 1 ] && exit 1; continue; fi
      if [ -z "$SMB_USER" ]; then ask "User name for the share:" ""; SMB_USER="$REPLY"; fi
      if [ -z "$SMB_PASS" ] && have_tty && [ "$ASSUME_YES" != 1 ]; then
        printf '  Password for %s (not shown): ' "$SMB_USER" >"$TTY"; IFS= read -rs SMB_PASS <"$TTY" || true; printf '\n' >"$TTY"
      fi
      if [[ "$SMB_PASS" == *"'"* ]]; then
        warn "Passwords containing an apostrophe (') can't be used here. Please use a different password for this share account."
        SMB_PASS=""; SMB_USER=""; [ "$ASSUME_YES" = 1 ] && exit 1; continue
      fi
      if [[ "$SMB_USER" == *\\* ]]; then SMB_DOMAIN="${SMB_USER%%\\*}"; SMB_USER="${SMB_USER#*\\}"; fi
      if [ "$DRY_RUN" = 1 ]; then
        SMB_VERS=3.0; ok "(dry run) skipping the share test"
      else
        info "Testing //$SMB_HOST/$SMB_PATH …"
        if ! test_smb "$SMB_HOST" "$SMB_PATH" "$SMB_IP"; then
          SMB_SHARE=""; SMB_USER=""; SMB_PASS=""
          [ "$ASSUME_YES" = 1 ] && die "The network share didn't work"
          confirm "Try again?" Y && continue
          STORAGE=""; continue
        fi
        ok "Connected to //$SMB_HOST/$SMB_PATH (SMB $SMB_VERS), and Synapse can write there"
      fi
      SYNAPSE_DATA="synapse-data"
      NETWORK_STORAGE=true
      VOLUMES_BLOCK=$(printf 'volumes:\n  synapse-data:\n    name: synapse-share\n    driver: local\n    driver_opts:\n      type: cifs\n      device: "//%s/%s"\n      o: "${SMB_MOUNT_OPTIONS}"\n' "$SMB_HOST" "$SMB_PATH")
      info "The share's password is kept in $DIR/.env, readable only by root."
      ;;
  esac
  break
done

# ── 5. Write the configuration ──────────────────────────────────────────────
step "Setting up Synapse"
mkdir -p "$DIR"
umask 077

JWT_SECRET=$(random_string 64 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')
SETUP_CODE="$(random_string 4 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789')-$(random_string 4 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789')"

cat >"$DIR/.env" <<EOF
# Synapse settings. After changing anything here, run: synapse restart
SYNAPSE_MODE=$MODE
SYNAPSE_PORT=$PORT
SYNAPSE_DOMAIN=$DOMAIN
SYNAPSE_IP=$LAN_IP
SYNAPSE_TRUST_PORT=$TRUST_PORT
# Signs login sessions. Changing it signs everyone out.
JWT_SECRET=$JWT_SECRET
# Set to true to let anyone create an account (normally the admin adds people).
ALLOW_REGISTRATION=false
# One-time code for creating the admin account (unused once the admin exists).
SETUP_CODE=$SETUP_CODE
# Where notes are kept: a folder path, or a Docker volume name.
SYNAPSE_STORAGE=$STORAGE
SYNAPSE_DATA=$SYNAPSE_DATA
SYNAPSE_NETWORK_STORAGE=$NETWORK_STORAGE
SYNAPSE_CONTAINER=$CONTAINER
EOF
if [ "$STORAGE" = smb ]; then
  printf "SMB_MOUNT_OPTIONS='%s'\n" "$(smb_options "$SMB_IP" "$SMB_VERS")" >>"$DIR/.env"
fi

if [ "$MODE" = https ]; then
  cat >"$DIR/docker-compose.yml" <<'EOF'
# Synapse with automatic HTTPS (Caddy). Managed by the `synapse` command.
services:
  synapse:
    image: ghcr.io/stevy2191/synapse:latest
    container_name: ${SYNAPSE_CONTAINER:-synapse}
    restart: unless-stopped
    volumes:
      - ${SYNAPSE_DATA:-./data}:/data
    environment:
      - DATA_DIR=/data
      - JWT_SECRET=${JWT_SECRET}
      - ALLOW_REGISTRATION=${ALLOW_REGISTRATION:-false}
      - SETUP_CODE=${SETUP_CODE:-}
      - SYNAPSE_NETWORK_STORAGE=${SYNAPSE_NETWORK_STORAGE:-false}

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
elif [ "$MODE" = lan-https ]; then
  cat >"$DIR/docker-compose.yml" <<'EOF'
# Synapse with HTTPS on this server's IP address (Caddy's own certificate authority).
# Managed by the `synapse` command; ports are set in .env.
services:
  synapse:
    image: ghcr.io/stevy2191/synapse:latest
    container_name: ${SYNAPSE_CONTAINER:-synapse}
    restart: unless-stopped
    volumes:
      - ${SYNAPSE_DATA:-./data}:/data
    environment:
      - DATA_DIR=/data
      - JWT_SECRET=${JWT_SECRET}
      - ALLOW_REGISTRATION=${ALLOW_REGISTRATION:-false}
      - SETUP_CODE=${SETUP_CODE:-}
      - SYNAPSE_NETWORK_STORAGE=${SYNAPSE_NETWORK_STORAGE:-false}

  caddy:
    image: caddy:2
    container_name: synapse-caddy
    restart: unless-stopped
    depends_on: [synapse]
    ports:
      - "${SYNAPSE_PORT}:${SYNAPSE_PORT}"
      - "${SYNAPSE_TRUST_PORT}:${SYNAPSE_TRUST_PORT}"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./trust:/srv/trust:ro
      - ./caddy/data:/data
      - ./caddy/config:/config
EOF
  write_lan_caddyfile "$DIR" "$LAN_IP" "$PORT" "$TRUST_PORT"
  mkdir -p "$DIR/trust"
  local_or_download scripts/trust.html "$DIR/trust/index.html" || die "Couldn't download the certificate page."
  printf 'window.SYNAPSE = { httpsPort: %s };\n' "$PORT" >"$DIR/trust/config.js"
  local_or_download frontend/public/logo.svg "$DIR/trust/logo.svg" 2>/dev/null || true
  chmod 755 "$DIR/trust"; chmod 644 "$DIR/trust/"*
else
  cat >"$DIR/docker-compose.yml" <<'EOF'
# Synapse. Managed by the `synapse` command; the port is set in .env (SYNAPSE_PORT).
services:
  synapse:
    image: ghcr.io/stevy2191/synapse:latest
    container_name: ${SYNAPSE_CONTAINER:-synapse}
    restart: unless-stopped
    ports:
      - "${SYNAPSE_PORT:-3001}:3001"
    volumes:
      - ${SYNAPSE_DATA:-./data}:/data
    environment:
      - DATA_DIR=/data
      - JWT_SECRET=${JWT_SECRET}
      - ALLOW_REGISTRATION=${ALLOW_REGISTRATION:-false}
      - SETUP_CODE=${SETUP_CODE:-}
      - SYNAPSE_NETWORK_STORAGE=${SYNAPSE_NETWORK_STORAGE:-false}
EOF
fi
if [ -n "$VOLUMES_BLOCK" ]; then printf '\n%s\n' "$VOLUMES_BLOCK" >>"$DIR/docker-compose.yml"; fi
umask 022
ok "Configuration written"

# The `synapse` command
install_cli

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
  case "$MODE" in
    https) open_firewall 80; open_firewall 443 ;;
    lan-https) open_firewall "$PORT"; open_firewall "$TRUST_PORT" ;;
    *) open_firewall "$PORT" ;;
  esac
fi

# ── 6. Start ────────────────────────────────────────────────────────────────
step "Starting Synapse"
if [ "$DRY_RUN" = 1 ]; then
  ok "(dry run) skipping docker compose pull / up"
else
  (cd "$DIR" && docker compose pull --quiet </dev/null && docker compose up -d </dev/null) || die "Couldn't start Synapse. See the messages above, or run: cd $DIR && docker compose logs"
  printf '  Waiting for Synapse to be ready'
  ready=0
  for _ in $(seq 1 60); do
    if (cd "$DIR" && docker compose exec -T synapse wget -qO- http://127.0.0.1:3001/api/health </dev/null) >/dev/null 2>&1; then ready=1; break; fi
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
  if [ "$MODE" = lan-https ]; then
    ROOT_CRT="$DIR/caddy/data/caddy/pki/authorities/local/root.crt"
    cert=0
    for _ in $(seq 1 30); do
      if [ -f "$ROOT_CRT" ] && curl -fsS --max-time 3 --cacert "$ROOT_CRT" "https://$LAN_IP:$PORT/api/health" >/dev/null 2>&1; then cert=1; break; fi
      sleep 1
    done
    [ "$cert" = 1 ] && ok "HTTPS is working with this server's own certificate" || warn "HTTPS isn't answering yet. Check with: synapse logs caddy"
  fi
fi

# ── 7. Done ─────────────────────────────────────────────────────────────────
case "$MODE" in
  home)  URL="http://$LAN_IP:$PORT" ;;
  proxy) URL="http://$LAN_IP:$PORT" ;;
  https) URL="https://$DOMAIN" ;;
  lan-https) URL="https://$LAN_IP:$PORT"; TRUST_URL="http://$LAN_IP:$TRUST_PORT" ;;
esac

line() { printf '  %s│%s  %s\n' "$MAG" "$R" "$1"; }
printf '\n  %s╭──────────────────────────────────────────────────────────%s\n' "$MAG" "$R"
line "${B}${GRN}Synapse is ready!${R}"
line ""
line "Open        ${B}$URL${R}"
line "Setup code  ${B}$SETUP_CODE${R}"
case "$STORAGE" in
  folder) line "Notes in    $DATA_PATH" ;;
  volume) line "Notes in    Docker volume \"$VOLUME_NAME\"" ;;
  smb)    line "Notes on    //$SMB_HOST/$SMB_PATH" ;;
esac
line ""
[ "$MODE" = lan-https ] && line "Trust page  ${B}$TRUST_URL${R}  (open this first on each device)" && line ""
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
if [ "$MODE" = lan-https ]; then
  say ""
  say "  ${B}First, trust this server on each device${R} ${D}(once per phone or computer)${R}"
  say "    Open ${B}$TRUST_URL${R} and follow the steps for that device."
  say "    Until then the browser shows a security warning, and offline mode can't work."
  if ! command -v qrencode >/dev/null 2>&1 && [ "$DRY_RUN" != 1 ]; then
    if command -v apt-get >/dev/null 2>&1; then apt-get install -y -qq qrencode >/dev/null 2>&1 || true
    elif command -v dnf >/dev/null 2>&1; then dnf install -y -q qrencode >/dev/null 2>&1 || true
    fi
  fi
  if command -v qrencode >/dev/null 2>&1; then
    say ""
    say "    Or scan this with your phone's camera:"
    qrencode -t ANSIUTF8 -m 2 "$TRUST_URL" | sed 's/^/    /'
  fi
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

exit 0
}
