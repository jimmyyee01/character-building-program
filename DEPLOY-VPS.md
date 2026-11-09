# Deploy Onomondo Clone to VPS (45.159.228.52)

**Important:** Port 22 is **SSH only** — you use it to log into the server.  
The web app runs on port **8080** (changeable) so it won't collide with SSH or other apps.

## What you need
- SSH access to `root` (or sudo user) at `45.159.228.52` on port 22
- The file `onomondo-clone-deploy.zip` (on your Desktop)
- PowerShell or any terminal on your local machine

## Step 1 — Copy the project to the VPS

From your local machine (PowerShell):

```powershell
scp -P 22 "$HOME\Desktop\onomondo-clone-deploy.zip" root@45.159.228.52:~/onomondo-clone-deploy.zip
```

If you use a non-root user with sudo, replace `root@` with your username and add `sudo` before commands below.

## Step 2 — Log into the VPS

```powershell
ssh -p 22 root@45.159.228.52
```

## Step 3 — Run the deploy script (on the VPS)

```bash
chmod +x onomondo-deploy.sh
bash onomondo-deploy.sh onomondo-clone-deploy.zip 8080
```

What this does:
1. Installs PHP (if missing)
2. Unpacks the app to `/opt/onomondo-clone`
3. Creates a `systemd` service (`onomondo.service`) that runs `php -S 0.0.0.0:8080 api.php`
4. Opens ports 22 and 8080 in the firewall
5. Starts and enables the service (survives reboots)

## Step 4 — Verify

On the VPS:
```bash
systemctl status onomondo --no-pager
curl -I http://127.0.0.1:8080/
```

From your local browser, open:

```
http://45.159.228.52:8080
```

Demo login: `demo@onomondo-clone.io` / `demo1234`

## Step 5 — Useful VPS commands

```bash
# Check if the app is running
systemctl status onomondo

# Restart after code changes
systemctl restart onomondo

# View live logs
journalctl -u onomondo -f

# Stop the app
systemctl stop onomondo

# Uninstall / remove app
systemctl stop onomondo
systemctl disable onomondo
rm -rf /opt/onomondo-clone /etc/systemd/system/onomondo.service
systemctl daemon-reload
```

## Notes
- If another app already uses port 8080, change it in Step 3 (e.g. `bash onomondo-deploy.sh onomondo-clone-deploy.zip 80`) and update the URL accordingly.
- The SQLite database lives at `/opt/onomondo-clone/onomondo.db`. Back it up before major changes.
- For production, put Nginx/Apache in front of PHP with SSL (Let's Encrypt). This deploy uses PHP's built-in server for simplicity.
