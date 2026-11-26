# vPanel Pro Custom Installer

Installs [vPanel Pro](https://github.com/nobita329/vpanel-pro) on a fresh Debian/Ubuntu VPS.

## Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/froggylive/vpanel-pro-installer/main/install.sh -o install.sh
sudo bash install.sh -y --admin-user admin --admin-email admin@example.com --admin-pass 'ChangeMe123!'
```

## Options

```bash
sudo bash install.sh --help
```

- `--repo <url>` - source repo (default: nobita329/vpanel-pro)
- `--branch <name>` - branch (default: main)
- `--dir <path>` - install dir (default: /opt/vpanel-pro)
- `--admin-user/email/pass` - admin credentials
- `--no-pm2` - skip PM2
- `-y` - non-interactive

## Notes

- Requires root on Debian/Ubuntu.
- Installs Node.js 20, QEMU/cloud-image-utils, MongoDB (Docker or native), PM2.
- If `/dev/kvm` is unavailable, VMs run in TCG software emulation (slow). Enable nested virtualization/KVM on the host for normal VPS speed.
- For your own fork, pass `--repo https://github.com/<you>/<repo>.git`.
