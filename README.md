# vPanel Pro Installer (bundled)

This repo contains the **vPanel Pro panel files** plus a custom installer.

## Install on a VPS

```bash
git clone https://github.com/froggylive/vpanel-pro-installer.git
cd vpanel-pro-installer
sudo bash install.sh -y --admin-user admin --admin-email admin@example.com --admin-pass 'ChangeMe123!'
```

Or one-liner after cloning is not required; clone includes all panel files.

## Options

- `--dir /opt/vpanel-pro` - install location
- `--admin-user / --admin-email / --admin-pass` - admin credentials
- `--no-pm2` - skip PM2
- `--git --repo <url> --branch <name>` - install from git instead of bundled files
- `-y` - non-interactive

## Notes

- Installs Node.js 20, QEMU/cloud-image-utils, MongoDB (Docker/native), dependencies, and PM2.
- Excludes `.env`, `node_modules`, `vms`, `data`, `storage`, uploads from git.
- If `/dev/kvm` is missing, VMs run in TCG (slow). Enable KVM/nested virtualization for normal speed.
