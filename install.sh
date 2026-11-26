#!/usr/bin/env bash
# =============================================================================
#  vPanel Pro - Custom Installer
#  Installs vPanel Pro on Debian/Ubuntu with Node.js, MongoDB, QEMU, PM2
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log_info(){ printf "${CYAN}${BOLD}[vPanel]${NC} %b\n" "$*"; }
log_ok(){ printf "${GREEN}${BOLD}[OK]${NC} %b\n" "$*"; }
log_warn(){ printf "${YELLOW}${BOLD}[WARN]${NC} %b\n" "$*"; }
log_err(){ printf "${RED}${BOLD}[ERR]${NC} %b\n" "$*" >&2; }

REPO_URL="${VPANEL_REPO:-https://github.com/nobita329/vpanel-pro.git}"
BRANCH="${VPANEL_BRANCH:-main}"
INSTALL_DIR="${VPANEL_DIR:-/opt/vpanel-pro}"
APP_USER="${VPANEL_USER:-root}"
USE_PM2=1
NON_INTERACTIVE=0
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@vpanel.local}"
ADMIN_PASS="${ADMIN_PASS:-}"
PANEL_PORT="${PANEL_PORT:-3001}"
API_PORT="${API_PORT:-3002}"

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) shift; REPO_URL="$1" ;;
    --branch) shift; BRANCH="$1" ;;
    --dir) shift; INSTALL_DIR="$1" ;;
    --admin-user) shift; ADMIN_USER="$1" ;;
    --admin-email) shift; ADMIN_EMAIL="$1" ;;
    --admin-pass) shift; ADMIN_PASS="$1" ;;
    --no-pm2) USE_PM2=0 ;;
    -y|--non-interactive) NON_INTERACTIVE=1 ;;
    -h|--help)
      cat <<EOF
Usage: sudo bash install.sh [options]
  --repo <url>          Git repo to install (default: nobita329/vpanel-pro)
  --branch <name>       Git branch (default: main)
  --dir <path>          Install directory (default: /opt/vpanel-pro)
  --admin-user <user>   Admin username
  --admin-email <email> Admin email
  --admin-pass <pass>   Admin password
  --no-pm2              Do not install/use PM2
  -y                    Non-interactive
EOF
      exit 0
      ;;
    *) log_warn "Unknown arg: $1" ;;
  esac
  shift
done

[ "$(id -u)" -eq 0 ] || { log_err "Run as root: sudo bash install.sh"; exit 1; }

if [ -f /etc/os-release ]; then . /etc/os-release; else log_err "Unsupported OS"; exit 1; fi
case "$ID" in debian|ubuntu) log_ok "Detected $PRETTY_NAME" ;; *) log_warn "Untested OS: ${PRETTY_NAME:-$ID} (continuing)";; esac

export DEBIAN_FRONTEND=noninteractive
log_info "Installing system packages..."
apt-get update -y >/dev/null || true
apt-get install -y --no-install-recommends \
  git curl wget ca-certificates openssl tar gzip iproute2 procps lsof \
  build-essential python3 make g++ pkg-config \
  qemu-system-x86 qemu-utils cloud-image-utils genisoimage \
  >/dev/null

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 18 ]; then
  log_info "Installing Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs >/dev/null
fi
log_ok "Node $(node -v), npm $(npm -v)"

if [ -e /dev/kvm ]; then
  chmod 666 /dev/kvm || true
  log_ok "KVM detected (/dev/kvm)"
else
  log_warn "/dev/kvm not found - VMs will run in slow TCG mode unless nested virtualization/KVM is enabled"
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  log_info "Updating existing repo in $INSTALL_DIR..."
  git -C "$INSTALL_DIR" fetch --all --prune
  git -C "$INSTALL_DIR" checkout "$BRANCH" || true
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH" || true
else
  log_info "Cloning $REPO_URL ($BRANCH) to $INSTALL_DIR..."
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
log_info "Installing npm dependencies..."
npm install --no-audit --no-fund

if [ ! -f .env ]; then
  cp .env.example .env 2>/dev/null || cat > .env <<EOF
PANEL_PORT=$PANEL_PORT
API_PORT=$API_PORT
PANEL_URL=http://localhost:$PANEL_PORT
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRES=7d
MONGO_URI=mongodb://admin:password@127.0.0.1:27017/vpanel?authSource=admin
AUTO_PORT_MIN=25501
AUTO_PORT_MAX=25600
AUTO_VNC_PORT_MIN=25901
AUTO_VNC_PORT_MAX=26000
AUTO_AGENT_PORT_MIN=26101
AUTO_AGENT_PORT_MAX=26200
ALLOW_REGISTER=1
EOF
  log_ok ".env created"
else
  log_info ".env exists, keeping it"
fi

# MongoDB
mongo_ok=0
if node -e "require('dotenv').config();const {MongoClient}=require('mongodb');const c=new MongoClient(process.env.MONGO_URI||'mongodb://admin:password@127.0.0.1:27017/vpanel?authSource=admin',{serverSelectionTimeoutMS:2000});c.connect().then(()=>c.close()).then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  mongo_ok=1; log_ok "MongoDB reachable"
fi
if [ "$mongo_ok" -eq 0 ]; then
  if ! command -v docker >/dev/null 2>&1 && ! command -v mongod >/dev/null 2>&1; then
    log_info "Installing Docker for MongoDB..."
    apt-get install -y --no-install-recommends docker.io >/dev/null || true
    systemctl enable --now docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1 || true
  fi
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    if docker ps -a --format '{{.Names}}' | grep -qx mongodb; then
      docker start mongodb >/dev/null 2>&1 || true
    else
      docker run -d --name mongodb -p 27017:27017 \
        -e MONGO_INITDB_ROOT_USERNAME=admin -e MONGO_INITDB_ROOT_PASSWORD=password \
        -v mongodb_data:/data/db --restart unless-stopped mongo:latest >/dev/null
    fi
  elif command -v mongod >/dev/null 2>&1; then
    systemctl enable --now mongod >/dev/null 2>&1 || systemctl enable --now mongodb >/dev/null 2>&1 || true
  fi
  log_info "Waiting for MongoDB..."
  for i in $(seq 1 40); do
    if node -e "require('dotenv').config();const {MongoClient}=require('mongodb');const c=new MongoClient(process.env.MONGO_URI||'mongodb://admin:password@127.0.0.1:27017/vpanel?authSource=admin',{serverSelectionTimeoutMS:1500});c.connect().then(()=>c.close()).then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      mongo_ok=1; break
    fi
    sleep 1
  done
  [ "$mongo_ok" -eq 1 ] && log_ok "MongoDB ready" || log_warn "MongoDB not confirmed; check MONGO_URI/service"
fi

mkdir -p data vms public/uploads/logo public/uploads/favicon public/uploads/background public/uploads/music public/uploads/avatar storage/backups storage/logs data/tmp
node scripts/build.js >/dev/null 2>&1 || true

if [ -z "$ADMIN_PASS" ]; then
  if [ "$NON_INTERACTIVE" -eq 0 ] && [ -t 0 ]; then
    read -r -p "Admin username [$ADMIN_USER]: " i; ADMIN_USER="${i:-$ADMIN_USER}"
    read -r -p "Admin email [$ADMIN_EMAIL]: " i; ADMIN_EMAIL="${i:-$ADMIN_EMAIL}"
    read -r -s -p "Admin password (blank=generate): " i; echo; ADMIN_PASS="$i"
  fi
fi
[ -z "$ADMIN_PASS" ] && ADMIN_PASS="$(openssl rand -hex 6)" && log_warn "Generated admin password: $ADMIN_PASS"

CREATEUSER_USERNAME="$ADMIN_USER" CREATEUSER_EMAIL="$ADMIN_EMAIL" CREATEUSER_PASSWORD="$ADMIN_PASS" CREATEUSER_NAME="$ADMIN_USER" CREATEUSER_ROLE=admin node -e "
const auth=require('./src/services/authService'); const {initDb,closeDb,collections}=require('./src/lib/db');
(async()=>{ await initDb(); const u=process.env.CREATEUSER_USERNAME,e=process.env.CREATEUSER_EMAIL,p=process.env.CREATEUSER_PASSWORD;
  const ex=await collections.users.findOne({\$or:[{username:u},{email:e}]});
  if(ex){ await auth.updateUser(ex.id,{password:p,role:'admin',root_admin:1,suspended:0,verified:1}); console.log('Admin updated:',u); }
  else { const nu=await auth.createUser({username:u,email:e,password:p,name:u,role:'admin',verified:1}); await collections.users.updateOne({id:nu.id},{\$set:{root_admin:1}}); console.log('Admin created:',u); }
  await closeDb();
})().catch(e=>{console.error(e.message); process.exit(1);});" 

if [ "$USE_PM2" -eq 1 ]; then
  command -v pm2 >/dev/null 2>&1 || npm install -g pm2 --no-audit --no-fund >/dev/null
  pm2 delete vpanel >/dev/null 2>&1 || true
  pm2 start ecosystem.config.js --cwd "$INSTALL_DIR" || pm2 start src/server.js --name vpanel --cwd "$INSTALL_DIR"
  pm2 save >/dev/null 2>&1 || true
  pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
fi

IP=$(curl -s -4 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo localhost)
echo ""
log_ok "vPanel installed"
echo "  Panel:    http://$IP:$PANEL_PORT"
echo "  API:      http://$IP:$API_PORT/api"
echo "  Admin:    $ADMIN_USER"
echo "  Password: $ADMIN_PASS"
echo "  Dir:      $INSTALL_DIR"
echo ""
